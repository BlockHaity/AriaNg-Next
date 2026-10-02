/**
 * Per-option input history (AriaNg's `ariaNgHistoryService`).
 *
 * Storage layout: one `AriaNg.History.<optionKey>` entry per aria2 option,
 * holding a JSON array of strings, newest first, capped at
 * `HISTORY_MAX_STORE_COUNT` (10).
 *
 * NOTE: `storageKeys()` deliberately returns keys **without** the `AriaNg.`
 * prefix (AriaNg's actual behaviour), so the prefix has to be re-added before
 * a key can be removed again.
 */
import { HISTORY_MAX_STORE_COUNT, StorageKey } from '@/config/types';
import { STORAGE_PREFIX, storageGet, storageKeys, storageRemove, storageSet } from './storage';

/** The un-prefixed part of `StorageKey.HistoryPrefix`, used for filtering. */
const HISTORY_PREFIX = StorageKey.HistoryPrefix.slice(`${STORAGE_PREFIX}.`.length);

function fullKey(optionKey: string): string {
  return `${StorageKey.HistoryPrefix}${optionKey}`;
}

/** Newest first, capped. Always returns a fresh array. */
export function getSettingHistory(optionKey: string): string[] {
  const stored = storageGet<unknown>(fullKey(optionKey), []);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((value): value is string => typeof value === 'string')
    .slice(0, HISTORY_MAX_STORE_COUNT);
}

/** Prepends `value`, drops older duplicates and caps the list. */
export function addSettingHistory(optionKey: string, value: string): void {
  if (typeof value !== 'string' || value === '') return;
  const history = getSettingHistory(optionKey);
  const next = [value, ...history.filter((entry) => entry !== value)].slice(
    0,
    HISTORY_MAX_STORE_COUNT,
  );
  storageSet(fullKey(optionKey), next);
}

export function clearSettingHistory(optionKey: string): void {
  storageRemove(fullKey(optionKey));
}

/** Removes every `AriaNg.History.*` key, leaving `AriaNg.Options` alone. */
export function clearSettingHistories(): void {
  for (const bare of storageKeys(HISTORY_PREFIX)) {
    storageRemove(`${STORAGE_PREFIX}.${bare}`);
  }
}
