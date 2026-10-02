/**
 * Request parameter helpers.
 *
 * These mirror the argument shapes AriaNg sent to aria2 — especially the
 * `keys` filters used by the task-list refresh (a basic response is much
 * cheaper than a full one) and the trimming rules of the `text` option inputs.
 */

import { ARIA2_NEXT_TASK_PARAMS, BASIC_TASK_PARAMS, FULL_TASK_PARAMS } from './contract';

/** `aria2.tellStatus` / `aria2.tellActive` argument list. */
export type TaskListCallParams = (number | string[])[];

/** Number of tasks a list refresh asks for by default. */
export const DEFAULT_TASK_LIST_SIZE = 1000;
/** `tellWaiting` starts at the front of the queue. */
export const DEFAULT_WAITING_OFFSET = 0;
/**
 * `tellStopped` starts at `-1`: newest stopped task first, exactly like
 * AriaNg — the stopped list is consumed from the end.
 */
export const DEFAULT_STOPPED_OFFSET = -1;

/**
 * Task fields that only make sense while a single task is being inspected.
 * AriaNg deletes them before merging a *basic* list response into a cached
 * full task, otherwise the stale values of the cached copy survive.
 */
export const VOLATILE_TASK_KEYS = ['verifiedLength', 'verifyIntegrityPending'] as const;

/** Fields needed to render the task list. */
export function getBasicTaskParams(): string[] {
  return [...BASIC_TASK_PARAMS];
}

/** Basic fields plus everything the task detail page needs. */
export function getFullTaskParams(): string[] {
  return [...FULL_TASK_PARAMS];
}

/** The extra fields only aria2-next reports. */
export function getAria2NextTaskParams(): string[] {
  return [...ARIA2_NEXT_TASK_PARAMS];
}

/**
 * Removes `verifiedLength` / `verifyIntegrityPending` from a task.
 *
 * Mutates in place (AriaNg used `delete`) and returns the same object, so both
 * `stripVolatileTaskKeys(task)` and `Object.assign(cached, stripVolatileTaskKeys(task))`
 * behave as expected.
 */
export function stripVolatileTaskKeys<T extends object>(task: T): T {
  const record = task as Record<string, unknown>;
  for (const key of VOLATILE_TASK_KEYS) {
    delete record[key];
  }
  return task;
}

/**
 * Normalises a `keys` list into the `string[]` aria2 expects. Empty entries
 * are dropped, because aria2 answers `Bad request` for an empty key.
 */
export function keysToParams(keys: readonly string[] | undefined | null): string[] {
  if (!keys || keys.length === 0) {
    return [];
  }
  const params: string[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') {
      continue;
    }
    const trimmed = key.trim();
    if (trimmed) {
      params.push(trimmed);
    }
  }
  return params;
}

function buildTaskListParams(
  offset: number,
  num: number,
  keys: readonly string[] | undefined | null,
): TaskListCallParams {
  const params: TaskListCallParams = [offset, num];
  const keyParams = keysToParams(keys);
  if (keyParams.length > 0) {
    // aria2 only accepts the third argument when it is a non-empty array.
    params.push(keyParams);
  }
  return params;
}

/** `aria2.tellWaiting(offset, num, keys?)` — defaults to the queue head. */
export function buildTellWaitingParams(
  offset: number = DEFAULT_WAITING_OFFSET,
  num: number = DEFAULT_TASK_LIST_SIZE,
  keys?: readonly string[] | null,
): TaskListCallParams {
  return buildTaskListParams(offset, num, keys);
}

/** `aria2.tellStopped(offset, num, keys?)` — defaults to the newest task. */
export function buildTellStoppedParams(
  offset: number = DEFAULT_STOPPED_OFFSET,
  num: number = DEFAULT_TASK_LIST_SIZE,
  keys?: readonly string[] | null,
): TaskListCallParams {
  return buildTaskListParams(offset, num, keys);
}

/**
 * Splits the value of a `text` option into the items aria2 expects.
 *
 * AriaNg trims every item (which is what removes the stray `\r` a textarea
 * leaves behind for CRLF input) and drops the empty ones — a trailing
 * separator or a blank line must not turn into an empty header / host.
 */
export function splitOptionText(value: string, separator: string): string[] {
  const text = value ?? '';
  if (!separator) {
    const only = cleanOptionItem(text);
    return only ? [only] : [];
  }
  const items: string[] = [];
  for (const raw of text.split(separator)) {
    const item = cleanOptionItem(raw);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

function cleanOptionItem(item: string): string {
  return item.replace(/\r/g, '').trim();
}

/** `select-file` takes 1-based indexes as a comma separated string. */
export function joinIndexes(indexes: readonly number[]): string {
  return indexes.join(',');
}