import { act, renderHook } from '@testing-library/react';
import type * as StorageModule from '../storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/* fake storage backends                                               */
/* ------------------------------------------------------------------ */

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

function clearCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.trim().split('=')[0];
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  }
}

function blockCookies(): void {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() {
      throw new DOMException('cookies are blocked');
    },
    set() {
      throw new DOMException('cookies are blocked');
    },
  });
}

function unblockCookies(): void {
  delete (document as unknown as Record<string, unknown>).cookie;
}

let storage: typeof StorageModule;
let local: FakeStorage;

async function loadStorage() {
  // The capability flags are module-evaluation constants, so every test needs
  // a fresh module instance to observe its own fake environment.
  vi.resetModules();
  return import('../storage');
}

beforeEach(async () => {
  local = new FakeStorage();
  vi.stubGlobal('localStorage', local as unknown as Storage);
  clearCookies();
  storage = await loadStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  unblockCookies();
  clearCookies();
});

/* ------------------------------------------------------------------ */

describe('storage capabilities', () => {
  it('detects localStorage and cookies at module load', () => {
    expect(storage.isLocalStorageSupported).toBe(true);
    expect(storage.isCookiesSupported).toBe(true);
    expect(storage.isStorageSupported).toBe(true);
    expect(storage.storageIsAvailable()).toBe(true);
    expect(storage.storageIsEphemeral()).toBe(false);
    // The probe must not leave anything behind.
    expect(storage.storageKeys()).toEqual([]);
  });

  it('reports no cookie support when document.cookie throws', async () => {
    blockCookies();
    const fresh = await loadStorage();
    expect(fresh.isCookiesSupported).toBe(false);
    // localStorage still works, so the app stays usable.
    expect(fresh.isLocalStorageSupported).toBe(true);
    expect(fresh.isStorageSupported).toBe(true);
  });

  it('reports no localStorage support when the getter throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('access denied');
      },
    });
    const fresh = await loadStorage();
    expect(fresh.isLocalStorageSupported).toBe(false);
    expect(fresh.isStorageSupported).toBe(true); // cookies still work
    delete (window as unknown as Record<string, unknown>).localStorage;
  });
});

describe('storageGet / storageSet', () => {
  it('namespaces every key with the AriaNg prefix', () => {
    storage.storageSet('Options', { a: 1 });
    expect([...local.map.keys()]).toEqual(['AriaNg.Options']);

    // The canonical constants already contain the prefix: no double prefix.
    storage.storageSet('AriaNg.Options', { a: 2 });
    expect([...local.map.keys()]).toEqual(['AriaNg.Options']);
    expect(storage.storageGet('AriaNg.Options', null)).toEqual({ a: 2 });
  });

  it('round-trips JSON values', () => {
    storage.storageSet('AriaNg.Options', { title: 'hi', n: 3, list: [1, '2', true] });
    expect(JSON.parse(local.getItem('AriaNg.Options') as string)).toEqual({
      title: 'hi',
      n: 3,
      list: [1, '2', true],
    });
    expect(storage.storageGet('AriaNg.Options', null)).toEqual({
      title: 'hi',
      n: 3,
      list: [1, '2', true],
    });
  });

  it('treats null and the literal string "null" as absent', () => {
    expect(storage.storageGet('AriaNg.Missing', 'fallback')).toBe('fallback');

    storage.storageSet('AriaNg.Nulled', null);
    expect(local.getItem('AriaNg.Nulled')).toBe('null');
    expect(storage.storageGet('AriaNg.Nulled', 'fallback')).toBe('fallback');

    local.map.set('AriaNg.Literal', '"null"');
    expect(storage.storageGet('AriaNg.Literal', 'fallback')).toBe('fallback');
  });

  it('falls back when the stored value is not valid JSON', () => {
    local.map.set('AriaNg.Broken', '{not json');
    expect(storage.storageGet('AriaNg.Broken', { ok: true })).toEqual({ ok: true });
  });
});

describe('storageKeys', () => {
  it('returns keys WITHOUT the AriaNg prefix (AriaNg behaviour)', () => {
    storage.storageSet('AriaNg.Options', {});
    storage.storageSet('AriaNg.History.dir', []);
    // A foreign key written by some other app must never show up.
    local.map.set('Other.App', 'kept');

    expect(storage.storageKeys()).toEqual(['History.dir', 'Options']);
  });

  it('filters by prefix and accepts a pre-prefixed filter', () => {
    storage.storageSet('AriaNg.History.dir', []);
    storage.storageSet('AriaNg.History.out', []);
    storage.storageSet('AriaNg.Options', {});

    expect(storage.storageKeys('History.')).toEqual(['History.dir', 'History.out']);
    expect(storage.storageKeys('AriaNg.History.')).toEqual(['History.dir', 'History.out']);
    expect(storage.storageKeys('Options')).toEqual(['Options']);
  });
});

describe('storageRemove / storageClearAll', () => {
  it('removes a single namespaced key', () => {
    storage.storageSet('AriaNg.Options', {});
    storage.storageSet('AriaNg.History.dir', []);
    storage.storageRemove('AriaNg.Options');
    expect(storage.storageKeys()).toEqual(['History.dir']);
  });

  it('clears only the AriaNg namespace', () => {
    local.map.set('Unrelated', 'do not touch');
    storage.storageSet('AriaNg.Options', {});
    storage.storageSet('AriaNg.History.dir', []);

    storage.storageClearAll();

    expect(storage.storageKeys()).toEqual([]);
    expect(local.map.get('Unrelated')).toBe('do not touch');
  });
});

describe('cookie fallback', () => {
  it('falls back to document.cookie when setItem throws', () => {
    local.failSet = true;
    storage.storageSet('AriaNg.Options', { title: 'from cookie' });

    expect(storage.storageIsEphemeral()).toBe(false);
    expect(document.cookie).toContain('AriaNg.Options=');
    // Value is `encodeURIComponent(json)`.
    expect(document.cookie).toContain(encodeURIComponent(JSON.stringify({ title: 'from cookie' })));
    expect(storage.storageGet('AriaNg.Options', null)).toEqual({ title: 'from cookie' });
  });

  it('keeps the cookie jar inside the AriaNg namespace for keys()', () => {
    local.failSet = true;
    storage.storageSet('AriaNg.Options', { a: 1 });
    storage.storageSet('AriaNg.History.dir', ['/tmp']);
    expect(storage.storageKeys()).toEqual(['History.dir', 'Options']);

    storage.storageClearAll();
    expect(storage.storageKeys()).toEqual([]);
  });
});

describe('ephemeral in-memory fallback', () => {
  it('keeps working in memory when both backends fail', () => {
    local.failSet = true;
    blockCookies();
    const seen: boolean[] = [];
    const unsubscribe = storage.subscribeStorage(() => seen.push(storage.storageIsEphemeral()));

    storage.storageSet('AriaNg.Options', { title: 'volatile' });

    expect(storage.storageIsEphemeral()).toBe(true);
    expect(storage.storageIsAvailable()).toBe(false);
    expect(seen).toEqual([true]);
    expect(storage.storageGet('AriaNg.Options', null)).toEqual({ title: 'volatile' });
    expect(storage.storageKeys()).toEqual(['Options']);

    unsubscribe();
    storage.storageRemove('AriaNg.Options');
    expect(storage.storageKeys()).toEqual([]);
  });
});

describe('storage hooks', () => {
  it('follow the live availability of the storage backends', async () => {
    const hooks = await import('../hooks');
    const { result } = renderHook(() => ({
      available: hooks.useStorageAvailable(),
      ephemeral: hooks.useStorageEphemeral(),
    }));

    expect(result.current).toEqual({ available: true, ephemeral: false });

    act(() => {
      local.failSet = true;
      blockCookies();
      storage.storageSet('AriaNg.Options', { title: 'volatile' });
    });

    // The shell can now warn that settings will not survive a reload.
    expect(result.current).toEqual({ available: false, ephemeral: true });
    unblockCookies();
  });
});
