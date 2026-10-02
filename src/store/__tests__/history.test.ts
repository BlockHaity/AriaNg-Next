import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_MAX_STORE_COUNT, StorageKey } from '@/config/types';
import type * as HistoryModule from '../history';

/** Minimal in-memory `Storage`; `failSet` simulates quota / private mode. */
class FakeStorage {
  readonly map = new Map<string, string>();
  failSet = false;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new DOMException('QuotaExceededError');
    this.map.set(key, String(value));
  }
}

let local: FakeStorage;
let history: typeof HistoryModule;

beforeEach(async () => {
  local = new FakeStorage();
  vi.stubGlobal('localStorage', local as unknown as Storage);
  vi.resetModules();
  history = await import('../history');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSettingHistory / addSettingHistory', () => {
  it('returns an empty list for an unknown option', () => {
    expect(history.getSettingHistory('dir')).toEqual([]);
  });

  it('prepends the newest value and persists it', () => {
    history.addSettingHistory('dir', '/first');
    expect(history.getSettingHistory('dir')).toEqual(['/first']);
    expect(JSON.parse(local.getItem(`${StorageKey.HistoryPrefix}dir`) as string)).toEqual([
      '/first',
    ]);

    history.addSettingHistory('dir', '/second');
    expect(history.getSettingHistory('dir')).toEqual(['/second', '/first']);
  });

  it('moves a repeated value back to the front instead of duplicating it', () => {
    history.addSettingHistory('dir', 'a');
    history.addSettingHistory('dir', 'b');
    history.addSettingHistory('dir', 'c');
    expect(history.getSettingHistory('dir')).toEqual(['c', 'b', 'a']);

    history.addSettingHistory('dir', 'a');
    expect(history.getSettingHistory('dir')).toEqual(['a', 'c', 'b']);
  });

  it(`caps the list at ${HISTORY_MAX_STORE_COUNT} entries`, () => {
    for (let i = 0; i < HISTORY_MAX_STORE_COUNT + 5; i += 1) {
      history.addSettingHistory('dir', `value-${i}`);
    }
    const stored = history.getSettingHistory('dir');
    expect(stored).toHaveLength(HISTORY_MAX_STORE_COUNT);
    expect(stored[0]).toBe(`value-${HISTORY_MAX_STORE_COUNT + 4}`);
    expect(stored[stored.length - 1]).toBe('value-5');
  });

  it('ignores empty values', () => {
    history.addSettingHistory('dir', '');
    expect(history.getSettingHistory('dir')).toEqual([]);
  });

  it('keeps options isolated from each other', () => {
    history.addSettingHistory('dir', '/a');
    history.addSettingHistory('out', '/b');
    expect(history.getSettingHistory('dir')).toEqual(['/a']);
    expect(history.getSettingHistory('out')).toEqual(['/b']);
  });

  it('survives a corrupted stored value', () => {
    local.map.set(`${StorageKey.HistoryPrefix}dir`, JSON.stringify({ nope: true }));
    expect(history.getSettingHistory('dir')).toEqual([]);

    local.map.set(`${StorageKey.HistoryPrefix}dir`, JSON.stringify(['ok', 42, 'fine']));
    expect(history.getSettingHistory('dir')).toEqual(['ok', 'fine']);
  });
});

describe('clearing', () => {
  it('clearSettingHistory removes a single option', () => {
    history.addSettingHistory('dir', '/a');
    history.addSettingHistory('out', '/b');

    history.clearSettingHistory('dir');

    expect(history.getSettingHistory('dir')).toEqual([]);
    expect(history.getSettingHistory('out')).toEqual(['/b']);
    expect(local.getItem(`${StorageKey.HistoryPrefix}dir`)).toBeNull();
  });

  it('leaves sibling keys that only share the prefix text', () => {
    history.addSettingHistory('dir', '/a');
    local.map.set('AriaNg.HistoryCache.dir', '[]');

    history.clearSettingHistories();

    expect(history.getSettingHistory('dir')).toEqual([]);
    expect(local.getItem('AriaNg.HistoryCache.dir')).toBe('[]');
  });

  it('clearSettingHistories removes only History.* keys', () => {
    history.addSettingHistory('dir', '/a');
    history.addSettingHistory('out', '/b');
    local.map.set(StorageKey.Options, JSON.stringify({ title: 'keep me' }));
    local.map.set('Unrelated.App', 'keep me too');

    history.clearSettingHistories();

    expect(local.getItem(`${StorageKey.HistoryPrefix}dir`)).toBeNull();
    expect(local.getItem(`${StorageKey.HistoryPrefix}out`)).toBeNull();
    // Untouched: the options blob and any foreign key.
    expect(local.getItem(StorageKey.Options)).toBe(JSON.stringify({ title: 'keep me' }));
    expect(local.getItem('Unrelated.App')).toBe('keep me too');
  });

  it('clearSettingHistories works with the cookie fallback', async () => {
    local.failSet = true;
    history = await import('../history');

    history.addSettingHistory('dir', '/a');
    history.addSettingHistory('out', '/b');
    expect(document.cookie).toContain(`${StorageKey.HistoryPrefix}dir`);

    history.clearSettingHistories();

    expect(history.getSettingHistory('dir')).toEqual([]);
    expect(history.getSettingHistory('out')).toEqual([]);
    expect(document.cookie).not.toContain(`${StorageKey.HistoryPrefix}`);
  });
});
