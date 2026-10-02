/**
 * The RPC/connection store — owns the single {@link Aria2Client} instance and
 * mirrors everything the shell needs to know about the connection.
 *
 * Responsibilities, all ported from AriaNg's `rpcStatus` handling in `root.js`:
 *
 *   - construct the client from the active profile (`init`);
 *   - **hot switch** to another profile without a page reload (`applyProfile`);
 *   - keep `version` / `globalStat` fresh;
 *   - translate the six `aria2.on*` notifications into a single event stream
 *     the notification UI can subscribe to (`onTaskEvent`).
 *
 * AriaNg kept the client in an Angular service and rebuilt everything on a
 * profile change (`location.reload`); `applyProfile` below replaces that with a
 * transport swap plus a `system.multicall`-free state reset.
 */

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import { createAria2Client, setAria2Client } from '@/rpc';
import type {
  Aria2Client,
  ConnectionState,
  RpcEventPayload,
  Unsubscribe,
} from '@/rpc/contract';
import type { Aria2GlobalStat, Aria2VersionInfo } from '@/rpc/types';
import { RpcEvent, RpcStatus } from '@/config/rpc-constants';
import type { RpcEvent as RpcEventName } from '@/config/rpc-constants';
import type { AriaNgSettings, RpcProfile } from '@/config/types';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { useSettingsStore } from './settings';
import { recordGlobalStat, resetStats } from './monitor';
import { useTasksStore } from './tasks';

/* ------------------------------------------------------------------ */
/* settings access                                                     */
/* ------------------------------------------------------------------ */

/**
 * The current application settings.
 *
 * Falls back to AriaNg's documented defaults only if the settings store cannot
 * answer yet (it is always constructed, so this is really a defensive guard for
 * a partially initialised bootstrap).
 */
export function getAppSettings(): AriaNgSettings {
  try {
    return useSettingsStore.getState().settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Builds the "default" RPC profile out of the flat settings. */
export function profileFromSettings(settings: AriaNgSettings = getAppSettings()): RpcProfile {
  return {
    rpcAlias: settings.rpcAlias,
    rpcHost: settings.rpcHost,
    rpcPort: settings.rpcPort,
    rpcInterface: settings.rpcInterface,
    protocol: settings.protocol,
    httpMethod: settings.httpMethod,
    rpcRequestHeaders: settings.rpcRequestHeaders,
    secret: settings.secret,
  };
}

/* ------------------------------------------------------------------ */
/* task event registry                                                 */
/* ------------------------------------------------------------------ */

export type TaskEventKind = 'complete' | 'btComplete' | 'error' | 'start' | 'pause' | 'stop';

export interface TaskEvent {
  kind: TaskEventKind;
  gid: string;
  /** unix milliseconds. */
  at: number;
}

/**
 * The notification UI is owned by another agent; rather than importing it here
 * (which would invert the dependency), the store publishes events and lets
 * whoever cares subscribe.
 */
export type TaskEventListener = (event: TaskEvent) => void;

const taskEventListeners = new Set<TaskEventListener>();

export function subscribeTaskEvents(listener: TaskEventListener): () => void {
  taskEventListeners.add(listener);
  return () => {
    taskEventListeners.delete(listener);
  };
}

const RPC_EVENT_KINDS: readonly { event: RpcEventName; kind: TaskEventKind }[] = [
  { event: RpcEvent.OnDownloadStart, kind: 'start' },
  { event: RpcEvent.OnDownloadPause, kind: 'pause' },
  { event: RpcEvent.OnDownloadStop, kind: 'stop' },
  { event: RpcEvent.OnDownloadComplete, kind: 'complete' },
  { event: RpcEvent.OnDownloadError, kind: 'error' },
  { event: RpcEvent.OnBtDownloadComplete, kind: 'btComplete' },
];

/* ------------------------------------------------------------------ */
/* error sink                                                          */
/* ------------------------------------------------------------------ */

/** Non-silent RPC failures land here; the shell swaps in its toast handler. */
export type RpcErrorHandler = (message: string) => void;

let rpcErrorHandler: RpcErrorHandler | null = null;

export function setRpcErrorHandler(handler: RpcErrorHandler | null): void {
  rpcErrorHandler = handler;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function toNumber(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== 'string' || value === '') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function describeProfile(profile: RpcProfile | undefined): string {
  if (!profile) {
    return '(none)';
  }
  return `${profile.rpcAlias || profile.rpcHost || 'default'}:${profile.rpcPort}${profile.rpcInterface ? `/${profile.rpcInterface}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

export interface RpcStoreState {
  client: Aria2Client | null;
  connection: ConnectionState;
  version?: Aria2VersionInfo;
  globalStat?: Aria2GlobalStat & { totalRunningCount: number };
  /** Mirrored from the profiles store for convenience. */
  profiles: RpcProfile[];
  activeIndex: number;

  init(): void;
  /** Injects an externally built client (tests, the shell). */
  attachClient(client: Aria2Client | null): void;
  applyProfile(profile: RpcProfile, reconnectInterval: number): void;
  reconnect(): void;
  setProfiles(profiles: RpcProfile[], activeIndex: number): void;
  refreshVersion(): Promise<void>;
  refreshGlobalStat(): Promise<void>;
  onTaskEvent(kind: TaskEventKind, gid: string): void;
  dispose(): void;
}

/** Unsubscribes from the previous client when one is swapped in. */
let teardown: Unsubscribe[] = [];

/**
 * AriaNg's "first success" latch: the very first successful connection after a
 * (re)connect triggers a version + task reload exactly once.
 */
let firstSuccessPending = true;

export const useRpcStore: UseBoundStore<StoreApi<RpcStoreState>> = create<RpcStoreState>()(
  (set, get) => {
    const wire = (client: Aria2Client): void => {
      for (const off of teardown) {
        off();
      }
      teardown = [];

      let lastStatus = client.connection.status;

      teardown.push(
        client.onConnectionChange((state: ConnectionState) => {
          set({ connection: state });
          // The task store mirrors the connection so the list can show it.
          useTasksStore.setState({ connection: state });

          const becameConnected = state.status === RpcStatus.Connected && lastStatus !== RpcStatus.Connected;
          lastStatus = state.status;

          if (!becameConnected) {
            return;
          }

          // AriaNg watched `rpcStatus` and refreshed the version on every
          // transition into `Connected`.
          void get().refreshVersion();
          firstSuccessPending = false;
        }),
      );

      for (const { event, kind } of RPC_EVENT_KINDS) {
        teardown.push(
          client.onEvent(event, (payload: RpcEventPayload<RpcEventName>) => {
            const gid = payload?.gid;
            if (gid) {
              get().onTaskEvent(kind, gid);
            }
          }),
        );
      }
    };

    return {
      client: null,
      connection: { status: RpcStatus.Disconnected, attempt: 0 },
      profiles: [],
      activeIndex: 0,

      init(): void {
        if (get().client) {
          return;
        }

        const settings = getAppSettings();
        const client = createAria2Client({
          profile: profileFromSettings(settings),
          webSocketReconnectInterval: settings.webSocketReconnectInterval,
          onError: (error) => {
            if (rpcErrorHandler) {
              rpcErrorHandler(error.message);
            } else {
              console.error(`[rpc] ${error.message}`);
            }
          },
        });

        // Publish as the process-wide singleton so the task / command stores
        // can reach it without importing this module (which would cycle).
        setAria2Client(client);

        set({ client, connection: client.connection });
        wire(client);
      },

      attachClient(client: Aria2Client | null): void {
        for (const off of teardown) {
          off();
        }
        teardown = [];

        if (!client) {
          setAria2Client(null);
          set({
            client: null,
            connection: { status: RpcStatus.Disconnected, attempt: 0 },
          });
          return;
        }

        setAria2Client(client);
        set({ client, connection: client.connection });
        wire(client);
      },

      applyProfile(profile: RpcProfile, reconnectInterval: number): void {
        const previous = get().profiles[get().activeIndex];
        // AriaNg reloaded the whole page here; we log the reason instead.
        console.info(
          `[rpc] hot switch ${describeProfile(previous)} -> ${describeProfile(profile)} (profile changed, no reload)`,
        );

        // Everything cached belongs to the *old* server.
        firstSuccessPending = true;
        resetStats('global');
        useTasksStore.getState().clear();

        set({ version: undefined, globalStat: undefined });

        const index = get().profiles.findIndex(
          (entry) =>
            entry.rpcId === profile.rpcId ||
            (entry.rpcHost === profile.rpcHost &&
              entry.rpcPort === profile.rpcPort &&
              entry.rpcInterface === profile.rpcInterface),
        );

        if (index >= 0) {
          set({ activeIndex: index });
        }

        const client = get().client;
        if (client) {
          client.connect(profile, { reconnectInterval });
        } else {
          const created = createAria2Client({
            profile,
            webSocketReconnectInterval: reconnectInterval,
            onError: (error) => {
              if (rpcErrorHandler) {
                rpcErrorHandler(error.message);
              } else {
                console.error(`[rpc] ${error.message}`);
              }
            },
          });
          setAria2Client(created);
          set({ client: created, connection: created.connection });
          wire(created);
        }
      },

      reconnect(): void {
        get().client?.reconnect();
      },

      setProfiles(profiles: RpcProfile[], activeIndex: number): void {
        set({ profiles, activeIndex });
      },

      async refreshVersion(): Promise<void> {
        const client = get().client;
        if (!client) {
          return;
        }
        const result = await client.getVersion();
        if (result.success) {
          set({ version: result.data });
        }
      },

      async refreshGlobalStat(): Promise<void> {
        const client = get().client;
        if (!client) {
          return;
        }
        const result = await client.getGlobalStat();
        if (!result.success) {
          return;
        }

        const stat = result.data;
        // AriaNg's `processStatResult` derived the "downloading" count itself.
        const totalRunningCount = toNumber(stat.numActive) + toNumber(stat.numWaiting);
        const downloadSpeed = toNumber(stat.downloadSpeed);
        const uploadSpeed = toNumber(stat.uploadSpeed);

        set({ globalStat: { ...stat, totalRunningCount } });
        recordGlobalStat({ downloadSpeed, uploadSpeed });
      },

      onTaskEvent(kind: TaskEventKind, gid: string): void {
        const event: TaskEvent = { kind, gid, at: Date.now() };
        for (const listener of [...taskEventListeners]) {
          try {
            listener(event);
          } catch (error) {
            console.error('[rpc] task event listener failed', error);
          }
        }

        // Every notification means the list may have moved a task between
        // aria2's active / waiting / stopped buckets, which is exactly the
        // structural change the incremental refresh cannot detect. The next
        // tick therefore reloads the list with the full field set.
        useTasksStore.getState().invalidate();
      },

      dispose(): void {
        for (const off of teardown) {
          off();
        }
        teardown = [];
        firstSuccessPending = true;
        get().client?.disconnect();
        setAria2Client(null);
        set({ client: null, connection: { status: RpcStatus.Disconnected, attempt: 0 } });
      },
    };
  },
);

/** Exposed for tests / the shell: is a first successful connect still pending? */
export function isFirstSuccessPending(): boolean {
  return firstSuccessPending;
}
