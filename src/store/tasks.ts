/**
 * The task list store — a port of AriaNg's `controllers/list.js` +
 * `aria2TaskService.js` list pipeline.
 *
 * The interesting part is the **incremental refresh** algorithm, which is
 * AriaNg's "only request incremental data" feature and the reason a 1000-task
 * list does not re-download every file list on every tick:
 *
 *   1. ask for the *basic* field set (no `files`, no `bittorrent`);
 *   2. merge the answer into the cached tasks **positionally, by gid**;
 *   3. as soon as anything structural changes (a task was added / removed /
 *      reordered), flag `needFullRefresh` and reload the list once with the
 *      full field set;
 *   4. if the cached list never contained full data at all, throw it away and
 *      force a full load — a basic-only list cannot render a task list.
 *
 * Every mutation allocates new objects. AriaNg merged into the cached objects
 * in place to keep `ng-repeat`'s row identity; in React that silently breaks
 * memoisation, so the merge below is strictly copy-on-write.
 */

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import { getAria2ClientOrNull } from '@/rpc';
import type { Aria2Client, ConnectionState, RpcResult } from '@/rpc/contract';
import { BASIC_TASK_PARAMS, FULL_TASK_PARAMS } from '@/rpc/contract';
import { isUnauthorized } from '@/rpc/errors';
import {
  DEFAULT_STOPPED_OFFSET,
  DEFAULT_TASK_LIST_SIZE,
  DEFAULT_WAITING_OFFSET,
  stripVolatileTaskKeys,
} from '@/rpc/params';
import { normalizeTask, normalizeTasks } from '@/domain/normalize';
import { normalizePeers } from '@/domain/peers';
import type { Aria2TaskStatusResult } from '@/rpc/types';
import type { NormalizedTask, TaskPeer, TaskTracker } from '@/domain/types';
import { RpcStatus, TaskListKind } from '@/config/rpc-constants';
import { naturalCompare } from '@/config/defaults';

/* ------------------------------------------------------------------ */
/* tuning                                                              */
/* ------------------------------------------------------------------ */

/** Upper bound for the gid→task detail cache. */
const MAX_DETAIL_CACHE = 200;

/** Shown when there is no client (not bootstrapped yet, or disposed). */
const NO_CLIENT_ERROR = 'aria2 is not connected';

/* ------------------------------------------------------------------ */
/* auth latch                                                          */
/* ------------------------------------------------------------------ */

/**
 * AriaNg *cancelled its refresh interval* when aria2 answered `Unauthorized`
 * — retrying with a wrong secret just spams the log. We keep the latch in the
 * module (not in the state) because it is a transport concern, and expose
 * {@link unblockRefresh} so a profile switch can recover from it.
 */
let blockedByAuth = false;

/** True while refreshes are suppressed after an `Unauthorized` answer. */
export function isRefreshBlocked(): boolean {
  return blockedByAuth;
}

/** Clears the {@link isRefreshBlocked} latch (profile switch / settings change). */
export function unblockRefresh(): void {
  blockedByAuth = false;
}

/* ------------------------------------------------------------------ */
/* sorting                                                             */
/* ------------------------------------------------------------------ */

/** AriaNg's `displayOrder` setting: `<type>:<direction>`. */
export const TASK_ORDER_TYPES = [
  'default',
  'name',
  'size',
  'percent',
  'remain',
  'dspeed',
  'uspeed',
] as const;

export type TaskOrderType = (typeof TASK_ORDER_TYPES)[number];
export type TaskOrder = `${TaskOrderType}:asc` | `${TaskOrderType}:desc` | TaskOrderType;

type SortKey = number | string | undefined | null;

function isMissing(value: SortKey): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value));
}

/**
 * Compares two tuples key by key (AriaNg's `remain` order is a 3-tuple).
 *
 * Missing values always sort last — in **both** directions. AriaNg built its
 * comparator with `_.sortBy` and then called `.reverse()`, which flipped
 * "missing last" into "missing first" for every `:desc` order. Sorting blanks
 * to the top of a "size ↓" list is never what the user wants, so the invariant
 * is kept instead of the quirk.
 */
function compareTuples(a: readonly SortKey[], b: readonly SortKey[], descending: boolean): number {
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i++) {
    const left = a[i] as SortKey;
    const right = b[i] as SortKey;
    const leftMissing = isMissing(left);
    const rightMissing = isMissing(right);

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        continue;
      }
      return leftMissing ? 1 : -1;
    }

    const result =
      typeof left === 'string' || typeof right === 'string'
        ? naturalCompare(String(left), String(right))
        : (left as number) - (right as number);

    if (result !== 0) {
      return descending ? -result : result;
    }
  }

  return 0;
}

/** The AriaNg `taskOrderBy` key tuple for one task. */
function sortKeysOf(task: NormalizedTask, type: TaskOrderType): SortKey[] {
  switch (type) {
    case 'name':
      return [task.taskName];
    case 'size':
      return [task.totalLength];
    case 'percent':
      return [task.completePercent];
    case 'remain':
      // `idle` first (a stalled task is "least remaining"), then the ETA,
      // then the raw byte count. `remainTime === null` (paused/complete) last.
      return [task.idle ? 1 : 0, task.remainTime ?? Number.POSITIVE_INFINITY, task.remainLength];
    case 'dspeed':
      return [task.downloadSpeed];
    case 'uspeed':
      return [task.uploadSpeed];
    case 'default':
    default:
      // Server order — the key list is empty, only the index tiebreaker applies.
      return [];
  }
}

function parseOrder(order: string): { type: TaskOrderType; descending: boolean } {
  const raw = (order ?? '').trim();
  const separator = raw.lastIndexOf(':');
  const head = separator >= 0 ? raw.slice(0, separator) : raw;
  const tail = separator >= 0 ? raw.slice(separator + 1) : 'asc';
  const type = (TASK_ORDER_TYPES as readonly string[]).includes(head)
    ? (head as TaskOrderType)
    : 'default';

  return { type, descending: tail === 'desc' };
}

/**
 * Stable sort by AriaNg's `taskOrderBy`.
 *
 * Stability is guaranteed explicitly (index tiebreaker) rather than relying on
 * `Array.prototype.sort` being stable in every engine, because the tiebreaker
 * is what keeps "default" order byte-identical to the server order.
 */
export function sortTasks(tasks: readonly NormalizedTask[], order: string): NormalizedTask[] {
  const { type, descending } = parseOrder(order);

  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const result = compareTuples(sortKeysOf(a.task, type), sortKeysOf(b.task, type), descending);
      return result !== 0 ? result : a.index - b.index;
    })
    .map((entry) => entry.task);
}

/** Case-insensitive `taskName` substring filter, exactly like AriaNg's. */
export function filterTasks(
  tasks: readonly NormalizedTask[],
  searchText: string,
): NormalizedTask[] {
  const needle = searchText.trim().toLowerCase();
  if (!needle) {
    return [...tasks];
  }
  return tasks.filter((task) => task.taskName.toLowerCase().includes(needle));
}

/* ------------------------------------------------------------------ */
/* the incremental merge                                               */
/* ------------------------------------------------------------------ */

/**
 * Fields a **basic** payload is allowed to overwrite.
 *
 * Everything else (`files`, `bittorrent`, `media`, `dir`, `uploadLength`,
 * `errorMessage`, …) is only ever populated by a full / detail load. Copying
 * the normalised basic task over the cached one would therefore *erase* the
 * full data, because normalisation defaults every missing wire field to
 * `''` / `0` / `[]`.
 *
 * Deliberately absent from the list (they are not in `BASIC_TASK_PARAMS`, so
 * aria2 never resends them): `uploadLength` / `shareRatio` / `dir` /
 * `bitfield` / `numPieces` / `errorMessage`. AriaNg had exactly the same
 * behaviour — the stale values simply survived until the next full refresh.
 */
const BASIC_MERGE_FIELDS = [
  'status',
  'totalLength',
  'completedLength',
  'completePercent',
  'remainLength',
  'remainPercent',
  'uploadSpeed',
  'downloadSpeed',
  'idle',
  'connections',
  'numSeeders',
  'seeder',
  'remainTime',
  'errorCode',
  'verifiedPercent',
  'verifyIntegrityPending',
] as const satisfies readonly (keyof NormalizedTask)[];

/** True when a task carries data only a full / detail load can provide. */
export function hasFullTaskData(task: NormalizedTask): boolean {
  return task.hasTaskName || task.files.length > 0 || task.bittorrent !== undefined;
}

/**
 * Drops the verify fields AriaNg deleted before merging a basic response.
 *
 * `stripVolatileTaskKeys` mutates its argument (it is a `delete`-based helper),
 * so it only ever sees a throwaway copy here — immutability first.
 *
 * It also deletes the *wire* key `verifiedLength`, which after normalisation
 * lives on the task as `verifiedPercent`; dropping only the helper's two keys
 * would leave a stale percentage on screen forever.
 */
function stripVolatile(task: NormalizedTask): NormalizedTask {
  const copy: NormalizedTask = { ...task };
  stripVolatileTaskKeys(copy);
  copy.verifiedPercent = undefined;
  copy.verifyIntegrityPending = false;
  return copy;
}

/** Positional merge of one basic payload onto one cached full task. */
function mergeBasicTask(cached: NormalizedTask, incoming: NormalizedTask): NormalizedTask {
  const next = stripVolatile(cached);

  for (const key of BASIC_MERGE_FIELDS) {
    (next as unknown as Record<string, unknown>)[key] = incoming[key];
  }

  return next;
}

/** True when `incoming` lines up with `previous` index-by-index, by gid. */
function isPositionalMatch(
  previous: readonly NormalizedTask[],
  incoming: readonly NormalizedTask[],
): boolean {
  if (previous.length !== incoming.length) {
    return false;
  }
  for (let i = 0; i < previous.length; i++) {
    if (previous[i]?.gid !== incoming[i]?.gid) {
      return false;
    }
  }
  return true;
}

/**
 * The pure core of the incremental refresh, extracted so it can be unit tested
 * without a client.
 *
 * @param previous the cached list (as last merged by this function)
 * @param incoming the freshly normalised payload
 * @param isFull   whether `incoming` was fetched with `FULL_TASK_PARAMS`
 */
export function mergeTaskList(
  previous: readonly NormalizedTask[],
  incoming: readonly NormalizedTask[],
  isFull: boolean,
): { list: NormalizedTask[]; needFullRefresh: boolean } {
  // (2) A full response is authoritative: replace, and stop asking for fulls.
  if (isFull) {
    return { list: [...incoming], needFullRefresh: false };
  }

  const structuralChange = !isPositionalMatch(previous, incoming);

  // (3) Basic response: merge in place, but only when the shape matches.
  const merged = structuralChange
    ? [...incoming]
    : incoming.map((task, index) => {
        const cached = previous[index] as NormalizedTask;
        return cached.gid === task.gid ? mergeBasicTask(cached, task) : task;
      });

  // (5) A list that never carried full data is useless — drop it and make the
  // next tick do a full load, rather than rendering nameless rows forever.
  const anyFullData = merged.some(hasFullTaskData);
  if (!anyFullData) {
    return { list: [], needFullRefresh: true };
  }

  return { list: merged, needFullRefresh: structuralChange };
}

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

export interface TasksState {
  list: NormalizedTask[];
  /** gid -> task, for detail pages. */
  byGid: Record<string, NormalizedTask>;
  page: TaskListKind;
  searchText: string;
  loading: boolean;
  /** Set when the last list fetch returned a structural change. */
  needFullRefresh: boolean;
  /** True when the current payload is "basic" (no files/bittorrent). */
  isBasicPayload: boolean;
  error?: string;
  connection: ConnectionState;

  setPage(page: TaskListKind): void;
  setSearchText(text: string): void;
  refresh(options?: { silent?: boolean; force?: boolean }): Promise<void>;
  refreshDetail(gid: string, options?: { withPeers?: boolean; addVirtualFileNode?: boolean }): Promise<void>;
  loadPeers(gid: string, options?: { includeLocalPeer?: boolean }): Promise<TaskPeer[]>;
  setTrackers(gid: string, trackers: TaskTracker[]): void;
  clear(): void;
  filtered(): NormalizedTask[];
  sorted(order: string): NormalizedTask[];

  /** Forces the next refresh to use the full field set (used after RPC events). */
  invalidate(): void;
}

const INITIAL_CONNECTION: ConnectionState = { status: RpcStatus.Disconnected, attempt: 0 };

function tellList(
  client: Aria2Client,
  page: TaskListKind,
  keys: readonly string[],
): Promise<RpcResult<Aria2TaskStatusResult[]>> {
  switch (page) {
    case TaskListKind.Downloading:
      return client.tellActive(keys);
    case TaskListKind.Waiting:
      return client.tellWaiting(DEFAULT_WAITING_OFFSET, DEFAULT_TASK_LIST_SIZE, keys);
    case TaskListKind.Stopped:
    default:
      // `-1` → newest stopped task first, exactly like AriaNg.
      return client.tellStopped(DEFAULT_STOPPED_OFFSET, DEFAULT_TASK_LIST_SIZE, keys);
  }
}

/** `byGid` = the current list plus whatever the detail pages cached before. */
function mergeByGid(
  cached: Record<string, NormalizedTask>,
  list: readonly NormalizedTask[],
): Record<string, NormalizedTask> {
  const next: Record<string, NormalizedTask> = {};
  const listed = new Set<string>();

  for (const task of list) {
    next[task.gid] = task;
    listed.add(task.gid);
  }

  const orphans: string[] = [];
  for (const [gid, task] of Object.entries(cached)) {
    if (listed.has(gid)) {
      continue;
    }
    next[gid] = task;
    orphans.push(gid);
  }

  // The detail cache must not grow without bound.
  const excess = orphans.length - MAX_DETAIL_CACHE;
  for (let i = 0; i < excess; i++) {
    delete next[orphans[i] as string];
  }

  return next;
}

/** Peers most recently seen for a task; `refreshDetail` warms this up. */
const detailPeers = new Map<string, TaskPeer[]>();

/** Peers from the last `loadPeers` / `refreshDetail`, possibly one round trip stale. */
export function getDetailPeers(gid: string): TaskPeer[] | undefined {
  return detailPeers.get(gid);
}

export const useTasksStore: UseBoundStore<StoreApi<TasksState>> = create<TasksState>()(
  (set, get) => {
    let inFlight: Promise<void> | null = null;

    const runRefresh = async (options: { silent?: boolean; force?: boolean }): Promise<void> => {
      const { silent = false, force = false } = options;

      if (blockedByAuth) {
        return;
      }

      const client = getAria2ClientOrNull();
      if (!client) {
        if (!silent) {
          set({ loading: false, error: NO_CLIENT_ERROR });
        }
        return;
      }

      const before = get();
      const page = before.page;
      // `needFullRefresh` (or an explicit `force`) asks for the heavy payload.
      const isFull = force || before.needFullRefresh;
      const keys = isFull ? FULL_TASK_PARAMS : BASIC_TASK_PARAMS;

      if (!silent) {
        // Silent ticks (the 1s poll) must not flash a skeleton over the list.
        set({ loading: true, error: undefined });
      }

      let result: RpcResult<Aria2TaskStatusResult[]>;
      try {
        result = await tellList(client, page, keys);
      } catch (error) {
        // A client must never throw, but a fake in a test might.
        set({ loading: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }

      // The user may have switched tabs while we were waiting.
      if (get().page !== page) {
        set({ loading: false });
        return;
      }

      if (!result.success) {
        if (isUnauthorized(result.error)) {
          // AriaNg cancelled the interval here; do not hammer a wrong secret.
          blockedByAuth = true;
        }
        set({ loading: false, error: result.error.message });
        return;
      }

      const incoming = normalizeTasks(result.data);
      const { list, needFullRefresh } = mergeTaskList(get().list, incoming, isFull);

      set({
        list,
        byGid: mergeByGid(get().byGid, list),
        needFullRefresh,
        isBasicPayload: !isFull,
        loading: false,
        error: undefined,
        connection: client.connection,
      });
    };

    return {
      list: [],
      byGid: {},
      page: TaskListKind.Downloading,
      searchText: '',
      loading: false,
      // The very first fetch must be a full one — there is nothing to merge into.
      needFullRefresh: true,
      isBasicPayload: false,
      connection: INITIAL_CONNECTION,

      setPage(page: TaskListKind): void {
        if (get().page === page) {
          return;
        }
        // The cached tasks belong to a *different* aria2 list, so a positional
        // merge would be nonsense: drop everything and start over.
        set({
          page,
          list: [],
          byGid: {},
          needFullRefresh: true,
          isBasicPayload: false,
          error: undefined,
          loading: false,
        });
      },

      setSearchText(text: string): void {
        set({ searchText: text });
      },

      refresh(options: { silent?: boolean; force?: boolean } = {}): Promise<void> {
        // Never overlap, even when two pages tick at the same millisecond.
        if (inFlight) {
          return inFlight;
        }
        const promise = runRefresh(options).finally(() => {
          inFlight = null;
        });
        inFlight = promise;
        return promise;
      },

      async refreshDetail(
        gid: string,
        options: { withPeers?: boolean; addVirtualFileNode?: boolean } = {},
      ): Promise<void> {
        const client = getAria2ClientOrNull();
        if (!client) {
          return;
        }

        const { withPeers = false, addVirtualFileNode = false } = options;
        const keys = withPeers ? [...FULL_TASK_PARAMS, 'peers'] : FULL_TASK_PARAMS;

        const result = await client.tellStatus(gid, keys);
        if (!result.success) {
          if (isUnauthorized(result.error)) {
            blockedByAuth = true;
            set({ error: result.error.message });
          }
          return;
        }

        const task = normalizeTask(result.data, { addVirtualFileNode });

        set((state) => ({
          byGid: { ...state.byGid, [gid]: task },
          list: state.list.map((entry) => (entry.gid === gid ? task : entry)),
        }));

        if (withPeers) {
          // Warm the peer cache so the detail page can render immediately.
          await get().loadPeers(gid);
        }
      },

      async loadPeers(gid: string, options: { includeLocalPeer?: boolean } = {}): Promise<TaskPeer[]> {
        const client = getAria2ClientOrNull();
        if (!client) {
          return [];
        }

        const task = get().byGid[gid];
        const result = await client.getPeers(gid);
        if (!result.success) {
          return [];
        }

        const peers = normalizePeers(result.data ?? [], {
          taskBitfield: task?.bitfield ?? '',
          taskNumPieces: task?.numPieces ?? 0,
          taskCompletedPieces: task?.completedPieces ?? 0,
          // `normalizePeers` works on 0..1 while the task view is 0..100.
          taskCompletePercent: (task?.completePercent ?? 0) / 100,
          includeLocalPeer: options.includeLocalPeer === true,
          taskDownloadSpeed: task?.downloadSpeed ?? 0,
          taskUploadSpeed: task?.uploadSpeed ?? 0,
          taskSeeder: task?.seeder ?? false,
        });

        detailPeers.set(gid, peers);
        return peers;
      },

      setTrackers(gid: string, trackers: TaskTracker[]): void {
        set((state) => {
          const existing = state.byGid[gid];
          return {
            byGid: existing ? { ...state.byGid, [gid]: { ...existing, trackers } } : state.byGid,
            list: state.list.map((entry) => (entry.gid === gid ? { ...entry, trackers } : entry)),
          };
        });
      },

      clear(): void {
        detailPeers.clear();
        unblockRefresh();
        set({
          list: [],
          byGid: {},
          needFullRefresh: true,
          isBasicPayload: false,
          loading: false,
          error: undefined,
          connection: INITIAL_CONNECTION,
        });
      },

      invalidate(): void {
        set({ needFullRefresh: true });
      },

      filtered(): NormalizedTask[] {
        const state = get();
        return filterTasks(state.list, state.searchText);
      },

      sorted(order: string): NormalizedTask[] {
        return sortTasks(get().list, order);
      },
    };
  },
);
