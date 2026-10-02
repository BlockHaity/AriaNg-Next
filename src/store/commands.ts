/**
 * High-level task operations — a port of AriaNg's `controllers/main.js` +
 * the mutating half of `aria2TaskService.js`.
 *
 * Every function here is **total**: a disconnected client, a missing session,
 * an aria2 that answers `Unauthorized` — all of them resolve to a failed
 * outcome instead of throwing, because these are called straight from click
 * handlers in a page that must not blow up.
 *
 * AriaNg returned `$q` promise chains; this module resolves plain objects and
 * reports per-item counts (`BatchOutcome`) so the UI can say "3 of 5 removed".
 */

import { getAria2ClientOrNull } from '@/rpc';
import type { Aria2Client, BatchOutcome } from '@/rpc/contract';
import { FULL_TASK_PARAMS } from '@/rpc/contract';
import type { Aria2OptionMap, Aria2TaskStatusResult } from '@/rpc/types';
import { isTerminalStatus, PAUSABLE_TASK_STATUSES, Aria2TaskStatus } from '@/config/rpc-constants';
import { normalizeTask } from '@/domain/normalize';
import type { NormalizedTask } from '@/domain/types';
import { getAppSettings } from './rpc-store';

/* ------------------------------------------------------------------ */
/* messages                                                            */
/* ------------------------------------------------------------------ */

/** Shown when there is no client (not bootstrapped, or shut down). */
export const NOT_CONNECTED_MESSAGE = 'aria2 is not connected';

/** AriaNg's retry guard, verbatim. */
export const RETRY_UNSUPPORTED_MESSAGE =
  'Only supports retrying a task with a single file and without BitTorrent';

/**
 * Media tasks are a different animal: `aria2.retryMedia` keeps the **same GID**
 * and the recovery data (partial segments, playlist position), so re-adding the
 * URL would throw all of that away and break every open detail page.
 */
export const RETRY_MEDIA_MESSAGE =
  'Media tasks must be retried with retryMediaTask, which keeps the GID and the recovery data';

export interface CommandOutcome extends BatchOutcome {
  /** First failure message, when there is one. */
  message?: string;
}

/* ------------------------------------------------------------------ */
/* outcome helpers                                                     */
/* ------------------------------------------------------------------ */

/** Nothing to do — not an error. */
export function emptyOutcome(): CommandOutcome {
  return { successCount: 0, failedCount: 0, hasSuccess: false, hasError: false };
}

/** The whole call could not even be attempted. */
export function failedOutcome(reason: string, count = 0): CommandOutcome {
  return { successCount: 0, failedCount: count, hasSuccess: false, hasError: true, message: reason };
}

/** Sum of two batch results (AriaNg's `processBatchResult` merge). */
export function mergeOutcomes(a: CommandOutcome, b: CommandOutcome): CommandOutcome {
  const outcome: CommandOutcome = {
    successCount: a.successCount + b.successCount,
    failedCount: a.failedCount + b.failedCount,
    hasSuccess: a.hasSuccess || b.hasSuccess,
    hasError: a.hasError || b.hasError,
  };

  const message = a.message ?? b.message;
  if (message !== undefined) {
    outcome.message = message;
  }

  return outcome;
}

function fromBatch(batch: BatchOutcome): CommandOutcome {
  const outcome: CommandOutcome = {
    successCount: batch.successCount,
    failedCount: batch.failedCount,
    hasSuccess: batch.hasSuccess,
    hasError: batch.hasError,
  };
  return outcome;
}

function toGids(tasks: readonly NormalizedTask[]): string[] {
  return tasks.map((task) => task.gid);
}

/* ------------------------------------------------------------------ */
/* start / pause                                                       */
/* ------------------------------------------------------------------ */

/**
 * `start` → `aria2.unpauseMany`, `pause` → `aria2.forcePauseMany`.
 *
 * AriaNg filtered the selection by status first (the buttons are only offered
 * where they mean something) and aria2 answers `unpause` on an active gid with
 * an error, so the filter is reproduced here rather than letting the batch come
 * back half red.
 */
export async function changeTasksState(
  tasks: NormalizedTask[],
  action: 'start' | 'pause',
): Promise<BatchOutcome> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return failedOutcome(NOT_CONNECTED_MESSAGE, tasks.length);
  }

  const candidates =
    action === 'pause'
      ? tasks.filter((task) => PAUSABLE_TASK_STATUSES.includes(task.status))
      : tasks.filter((task) => task.status === Aria2TaskStatus.Paused);

  if (candidates.length === 0) {
    return emptyOutcome();
  }

  const gids = toGids(candidates);
  const result =
    action === 'pause' ? await client.forcePauseMany(gids) : await client.unpauseMany(gids);

  return result.success ? fromBatch(result.data) : failedOutcome(result.error.message, gids.length);
}

/* ------------------------------------------------------------------ */
/* removal                                                             */
/* ------------------------------------------------------------------ */

/**
 * Removes a mixed selection.
 *
 * aria2 has no single call for this: a *running* task needs `forceRemove`,
 * while a task that already reached a terminal status lives in the download
 * result and is cleared with `removeDownloadResult`. AriaNg split the same way
 * in `main.js`, and both halves run even when the selection spans both buckets.
 */
export async function removeTasks(tasks: NormalizedTask[]): Promise<BatchOutcome> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return failedOutcome(NOT_CONNECTED_MESSAGE, tasks.length);
  }

  const terminal = tasks.filter((task) => isTerminalStatus(task.status));
  const running = tasks.filter((task) => !isTerminalStatus(task.status));

  if (tasks.length === 0) {
    return emptyOutcome();
  }

  const [runningResult, terminalResult] = await Promise.all([
    running.length > 0 ? client.forceRemoveMany(toGids(running)) : Promise.resolve(null),
    terminal.length > 0 ? client.removeDownloadResultMany(toGids(terminal)) : Promise.resolve(null),
  ]);

  let outcome = emptyOutcome();

  if (runningResult) {
    outcome = mergeOutcomes(
      outcome,
      runningResult.success
        ? fromBatch(runningResult.data)
        : failedOutcome(runningResult.error.message, running.length),
    );
  }

  if (terminalResult) {
    outcome = mergeOutcomes(
      outcome,
      terminalResult.success
        ? fromBatch(terminalResult.data)
        : failedOutcome(terminalResult.error.message, terminal.length),
    );
  }

  return outcome;
}

/** `aria2.purgeDownloadResult` — the "Clear stopped" button. */
export async function clearStoppedTasks(): Promise<void> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return;
  }
  await client.purgeDownloadResult();
}

/* ------------------------------------------------------------------ */
/* retry                                                               */
/* ------------------------------------------------------------------ */

/** One `system.multicall` entry, as aria2 answers it. */
interface MulticallEntry {
  result?: unknown;
  error?: { code?: number; message?: string };
}

type EntryRead<T> = { ok: true; data: T } | { ok: false; error: string };

function readEntry<T>(entry: unknown, what: string): EntryRead<T> {
  if (typeof entry !== 'object' || entry === null) {
    return { ok: false, error: `${what}: malformed multicall answer` };
  }

  const record = entry as MulticallEntry;
  if (record.error) {
    return { ok: false, error: record.error.message ?? `${what} failed` };
  }
  if (!('result' in record)) {
    return { ok: false, error: `${what}: malformed multicall answer` };
  }

  return { ok: true, data: record.result as T };
}

/**
 * AriaNg's `retryTask` opens with `$q.all([tellStatus, getOption])`; the same
 * pair is expressed as one `system.multicall` round trip here so the retry is
 * a single request instead of two racing ones.
 *
 * The multicall helper itself lives on `Aria2ClientImpl` but is not part of the
 * `Aria2Client` contract, so the payload is assembled from `buildCall` (which is
 * also what injects `token:<secret>` into the inner calls).
 */
async function fetchRetryInputs(
  client: Aria2Client,
  gid: string,
): Promise<EntryRead<{ status: Aria2TaskStatusResult; options: Aria2OptionMap }>> {
  const calls = [
    client.buildCall({ method: 'tellStatus', params: [gid, [...FULL_TASK_PARAMS]], silent: true }),
    client.buildCall({ method: 'getOption', params: [gid], silent: true }),
  ];

  const result = await client.invoke<unknown>({
    method: 'system.multicall',
    params: [calls],
    silent: true,
  });

  if (!result.success) {
    return { ok: false, error: result.error.message };
  }

  const entries = Array.isArray(result.data) ? result.data : [];
  const status = readEntry<Aria2TaskStatusResult>(entries[0], 'tellStatus');
  if (!status.ok) {
    return status;
  }

  const options = readEntry<Aria2OptionMap>(entries[1], 'getOption');
  if (!options.ok) {
    return options;
  }

  return { ok: true, data: { status: status.data, options: options.data ?? {} } };
}

/** `gid` is a read-only field of the task's options; aria2 rejects it on add. */
function sanitizableOptions(options: Aria2OptionMap): Aria2OptionMap {
  const next: Aria2OptionMap = { ...options };
  delete next['gid'];
  return next;
}

function readUriList(data: unknown): string[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const urls: string[] = [];
  for (const item of data) {
    const uri = (item as { uri?: unknown } | null)?.uri;
    if (typeof uri === 'string' && uri !== '') {
      urls.push(uri);
    }
  }
  return urls;
}

/**
 * Re-adds a failed single-file HTTP task (`aria2TaskService.js:641-746`).
 *
 * It deliberately supports **only** a single-file, non-BitTorrent task: with
 * several files there is no single `uris` list that would reproduce the task,
 * and for a torrent the `.torrent` metadata (and its peers) lives in the
 * download result, which `addUri` cannot bring back.
 */
export async function retryTask(gid: string): Promise<{ ok: boolean; error?: string }> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return { ok: false, error: NOT_CONNECTED_MESSAGE };
  }

  const inputs = await fetchRetryInputs(client, gid);
  if (!inputs.ok) {
    return { ok: false, error: inputs.error };
  }

  const task = normalizeTask(inputs.data.status);

  if (task.media) {
    // Not a failure of this call: it is the wrong call for this task.
    return { ok: false, error: RETRY_MEDIA_MESSAGE };
  }

  if (task.bittorrent) {
    return { ok: false, error: RETRY_UNSUPPORTED_MESSAGE };
  }

  if (task.files.length !== 1) {
    return { ok: false, error: RETRY_UNSUPPORTED_MESSAGE };
  }

  const urisResult = await client.getUris(gid);
  if (!urisResult.success) {
    return { ok: false, error: urisResult.error.message };
  }

  const urls = readUriList(urisResult.data);
  if (urls.length === 0) {
    return { ok: false, error: 'Task has no URI to retry' };
  }

  const addResult = await client.addUri(urls, sanitizableOptions(inputs.data.options));
  if (!addResult.success) {
    return { ok: false, error: addResult.error.message };
  }

  // AriaNg's `removeOldTaskAfterRetrying` — the stale download result is only
  // dropped when the user asked for it, because it is what a *manual* retry
  // needs for a torrent.
  if (getAppSettings().removeOldTaskAfterRetrying) {
    await client.removeDownloadResult(gid);
  }

  return { ok: true };
}

/**
 * aria2-next media retry: same GID, same recovery data, no `addUri`.
 *
 * This — not {@link retryTask} — is the correct operation for an HLS/DASH task.
 */
export async function retryMediaTask(gid: string): Promise<{ ok: boolean; error?: string }> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return { ok: false, error: NOT_CONNECTED_MESSAGE };
  }

  const result = await client.retryMedia(gid);
  return result.success ? { ok: true } : { ok: false, error: result.error.message };
}

/** Bulk retry; every gid is attempted, failures are counted. */
export async function retryTasks(
  gids: string[],
): Promise<BatchOutcome & { successCount: number; failedCount: number }> {
  if (gids.length === 0) {
    return emptyOutcome();
  }

  const results = await Promise.all(gids.map((gid) => retryTask(gid)));
  const successCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - successCount;
  const firstError = results.find((result) => !result.ok)?.error;

  const outcome: CommandOutcome = {
    successCount,
    failedCount,
    hasSuccess: successCount > 0,
    hasError: failedCount > 0,
  };

  if (firstError !== undefined) {
    outcome.message = firstError;
  }

  return outcome;
}

/* ------------------------------------------------------------------ */
/* per-task operations                                                 */
/* ------------------------------------------------------------------ */

/** Drag & drop reordering. `POS_SET` because AriaNg dropped the task at an index. */
export async function changeTaskPosition(gid: string, pos: number): Promise<void> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return;
  }
  await client.changePosition(gid, pos, 'POS_SET');
}

/** `aria2.selectFile` — 1-based indexes inside the option bag. */
export async function selectTaskFiles(gid: string, indexes: number[]): Promise<void> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return;
  }
  await client.selectFile(gid, indexes);
}

/** AriaNg only accepted the change when aria2 answered exactly `OK`. */
export async function changeTaskOption(gid: string, key: string, value: string): Promise<boolean> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return false;
  }

  const result = await client.changeOption(gid, { [key]: value });
  return result.success && result.data === 'OK';
}

/** Same `data === 'OK'` check as the per-task variant. */
export async function changeGlobalOption(key: string, value: string): Promise<boolean> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return false;
  }

  const result = await client.changeGlobalOption({ [key]: value });
  return result.success && result.data === 'OK';
}

export async function saveSession(): Promise<boolean> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return false;
  }

  const result = await client.saveSession();
  return result.success && result.data === 'OK';
}

export async function shutdownAria2(): Promise<boolean> {
  const client = getAria2ClientOrNull();
  if (!client) {
    return false;
  }

  const result = await client.shutdown();
  return result.success && result.data === 'OK';
}
