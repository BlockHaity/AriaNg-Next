import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKey } from '@/config/types';
// TODO: switch to @/config/defaults once available
import { DEFAULT_SETTINGS } from '../_pending-defaults';

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
  toStorage(): Storage {
    const self = this;
    return {
      get length() {
        return self.length;
      },
      clear: () => self.clear(),
      getItem: (key: string) => self.getItem(key),
      key: (index: number) => self.key(index),
      removeItem: (key: string) => self.removeItem(key),
      setItem: (key: string, value: string) => self.setItem(key, value),
    } as Storage;
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

let local: FakeStorage;

function installLocation(protocol: string, hostname: string): void {
  vi.stubGlobal('location', {
    protocol,
    hostname,
    host: `${hostname}:8080`,
    origin: `${protocol}//${hostname}`,
  });
}

function readStoredOptions(): Record<string, unknown> {
  const raw = local.getItem(StorageKey.Options);
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
}

type SettingsModule = typeof import('../settings');

let store: SettingsModule;

beforeEach(async () => {
  vi.useFakeTimers();
  local = new FakeStorage();
  vi.stubGlobal('localStorage', local.toStorage());
  installLocation('http:', 'localhost');
  vi.resetModules();
  store = await import('../settings');
});

afterEach(() => {
  vi.useRealTimers();
  unblockCookies();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe('hydrate', () => {
  it('bootstraps defaults, fills rpcHost and flags the first visit', () => {
    const { useSettingsStore } = store;
    expect(useSettingsStore.getState().hydrated).toBe(false);

    useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.firstVisit).toBe(true);
    expect(state.storageBroken).toBe(false);
    expect(state.settings.rpcHost).toBe('localhost');
    expect(state.settings.rpcPort).toBe('6800');
    // Defaults are written immediately so the next boot is not a first visit.
    expect(local.getItem(StorageKey.Options)).toBeTypeOf('string');
  });

  it('fills an empty rpcHost from the page hostname', () => {
    local.map.set(StorageKey.Options, JSON.stringify({ rpcHost: '   ' }));
    installLocation('http:', 'aria2.local');

    store.useSettingsStore.getState().hydrate();

    expect(store.useSettingsStore.getState().settings.rpcHost).toBe('aria2.local');
    expect(readStoredOptions().rpcHost).toBe('aria2.local');
  });

  it('does not flag a first visit when options were stored', () => {
    local.map.set(StorageKey.Options, JSON.stringify({ title: 'kept' }));
    store.useSettingsStore.getState().hydrate();

    const state = store.useSettingsStore.getState();
    expect(state.firstVisit).toBe(false);
    expect(state.settings.title).toBe('kept');
  });

  it('back-fills missing keys and re-persists the blob', () => {
    local.map.set(StorageKey.Options, JSON.stringify({ title: 'legacy' }));
    store.useSettingsStore.getState().hydrate();

    const state = store.useSettingsStore.getState();
    expect(state.settings.title).toBe('legacy');
    expect(state.settings.rpcPort).toBe('6800');
    expect(state.settings.displayOrder).toBe('default:asc');
    expect(state.settings.extendRpcServers).toEqual([]);

    // The migration is durable: the stored blob now carries every key.
    const stored = readStoredOptions();
    expect(stored.title).toBe('legacy');
    expect(stored.rpcPort).toBe('6800');
    expect(stored.extendRpcServers).toEqual([]);
  });

  it('repairs an unsupported language', () => {
    const { useSettingsStore } = store;
    local.map.set(StorageKey.Options, JSON.stringify({ language: 'not a language!!' }));

    useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().settings.language).toBe(DEFAULT_SETTINGS.language);
    expect(readStoredOptions().language).toBe(DEFAULT_SETTINGS.language);
  });

  it('normalises legacy language aliases', () => {
    const { useSettingsStore } = store;
    local.map.set(StorageKey.Options, JSON.stringify({ language: 'zh_CN' }));

    useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().settings.language).toBe('zh_Hans');
  });

  it('forces https on an https page', () => {
    const { useSettingsStore } = store;
    local.map.set(StorageKey.Options, JSON.stringify({ protocol: 'http' }));
    installLocation('https:', 'secure.example');

    useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().settings.protocol).toBe('https');
    expect(readStoredOptions().protocol).toBe('https');
  });

  it('is idempotent', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore.getState().set('title', 'x');
    useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().settings.title).toBe('x');
  });
});

describe('set / update', () => {
  it('debounces the write and never persists per keystroke', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    local.clear();

    useSettingsStore.getState().set('title', 'a');
    useSettingsStore.getState().set('title', 'ab');
    useSettingsStore.getState().set('title', 'abc');

    expect(local.getItem(StorageKey.Options)).toBeNull();
    vi.advanceTimersByTime(299);
    expect(local.getItem(StorageKey.Options)).toBeNull();

    vi.advanceTimersByTime(1);
    expect(readStoredOptions().title).toBe('abc');
  });

  it('merges patches without dropping other keys', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({ title: 'merged', theme: 'dark' });
    vi.advanceTimersByTime(300);

    const state = useSettingsStore.getState();
    expect(state.get('title')).toBe('merged');
    expect(state.get('theme')).toBe('dark');
    expect(state.get('rpcPort')).toBe('6800');
  });

  it('ignores writes that change nothing', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    local.clear();

    const current = useSettingsStore.getState().get('title');
    useSettingsStore.getState().set('title', current);
    useSettingsStore.getState().update({ title: current });

    vi.advanceTimersByTime(300);
    expect(local.getItem(StorageKey.Options)).toBeNull();
  });

  it('stores the secret base64 encoded but exposes it decoded', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore.getState().set('secret', 'super secret');
    vi.advanceTimersByTime(300);

    expect(readStoredOptions().secret).toBe('c3VwZXIgc2VjcmV0');
    expect(useSettingsStore.getState().get('secret')).toBe('super secret');
  });

  it('reset() restores the defaults and writes them through synchronously', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({ title: 'dirty', theme: 'dark' });

    useSettingsStore.getState().reset();

    const state = useSettingsStore.getState();
    expect(state.settings.title).toBe(DEFAULT_SETTINGS.title);
    expect(state.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(readStoredOptions().title).toBe(DEFAULT_SETTINGS.title);
  });

  it('flushSettingsPersist writes a pending change immediately', () => {
    const { useSettingsStore, flushSettingsPersist } = store;
    useSettingsStore.getState().hydrate();
    local.clear();

    useSettingsStore.getState().set('title', 'flushed');
    flushSettingsPersist();

    expect(readStoredOptions().title).toBe('flushed');
  });
});

describe('session settings', () => {
  it('setSessionDebugMode never touches storage', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    const before = local.getItem(StorageKey.Options);

    useSettingsStore.getState().setSessionDebugMode(true);
    vi.advanceTimersByTime(1000);

    expect(useSettingsStore.getState().session.debugMode).toBe(true);
    expect(local.getItem(StorageKey.Options)).toBe(before);
  });
});

describe('export / import', () => {
  it('round-trips through exportAll / importAll', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({
      title: 'exported',
      theme: 'dark',
      secret: 'abc123',
      extendRpcServers: [
        {
          rpcId: 'id-1',
          rpcAlias: 'nas',
          rpcHost: '10.0.0.2',
          rpcPort: '6801',
          rpcInterface: 'jsonrpc',
          protocol: 'ws',
          httpMethod: 'POST',
          rpcRequestHeaders: 'X-A: 1',
          secret: 'entry-secret',
        },
      ],
    });
    vi.advanceTimersByTime(300);

    const json = useSettingsStore.getState().exportAll();
    // Pretty printed with a 2 space indent, secrets still base64.
    expect(json.split('\n')[1]).toMatch(/^ {2}"/);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.secret).toBe('YWJjMTIz');
    expect((parsed.extendRpcServers as Record<string, unknown>[])[0].secret).toBe(
      btoa('entry-secret'),
    );
    // A complete blob: defaults are merged in.
    expect(parsed.rpcPort).toBe('6800');

    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().settings.title).toBe('');

    expect(useSettingsStore.getState().importAll(json)).toEqual({ ok: true });
    const state = useSettingsStore.getState();
    expect(state.settings.title).toBe('exported');
    expect(state.settings.theme).toBe('dark');
    expect(state.settings.secret).toBe('abc123');
    expect(state.settings.extendRpcServers).toHaveLength(1);
    expect(state.settings.extendRpcServers[0].rpcAlias).toBe('nas');
    expect(state.settings.extendRpcServers[0].secret).toBe('entry-secret');
    // Written through immediately with the secret re-encoded.
    expect(readStoredOptions().secret).toBe('YWJjMTIz');
  });

  it('drops unknown keys and a hostile extendRpcServers blob', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();

    const result = useSettingsStore.getState().importAll(
      JSON.stringify({
        title: 'kept',
        evilKey: 'nope',
        theme: { nested: 'object' },
        titleRefreshInterval: 'not a number',
        extendRpcServers: { notAnArray: true, rpcHost: 'evil' },
      }),
    );

    expect(result).toEqual({ ok: true });
    const state = useSettingsStore.getState();
    expect(state.settings.title).toBe('kept');
    expect(state.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(state.settings.titleRefreshInterval).toBe(
      DEFAULT_SETTINGS.titleRefreshInterval,
    );
    expect(state.settings.extendRpcServers).toEqual([]);
    expect('evilKey' in state.settings).toBe(false);
    // A hostile object cannot land in a scalar slot either.
    expect(readStoredOptions().theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('rebuilds profile entries field by field, dropping unknown fields', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();

    const result = useSettingsStore.getState().importAll(
      JSON.stringify({
        extendRpcServers: [
          {
            rpcId: 'keep-me',
            rpcAlias: 'aliased',
            rpcHost: 'host',
            rpcPort: '1234',
            protocol: 'wss',
            httpMethod: 'GET',
            evil: 'dropped',
            isDefault: true,
          },
          'not-an-object',
        ],
      }),
    );

    expect(result).toEqual({ ok: true });
    const list = useSettingsStore.getState().settings.extendRpcServers;
    expect(list).toHaveLength(1);
    expect(list[0].rpcId).toBe('keep-me');
    expect(list[0].rpcAlias).toBe('aliased');
    expect(list[0].protocol).toBe('wss');
    expect(list[0].httpMethod).toBe('GET');
    expect(list[0].isDefault).toBe(false);
    expect('evil' in list[0]).toBe(false);
  });

  it('reports invalid JSON', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().importAll('{oops')).toEqual({
      ok: false,
      error: 'Invalid settings data format!',
    });
    expect(useSettingsStore.getState().importAll('[1,2,3]')).toEqual({
      ok: false,
      error: 'Invalid settings data format!',
    });
    expect(useSettingsStore.getState().importAll('null')).toEqual({
      ok: false,
      error: 'Invalid settings data format!',
    });
    // The previous settings survive a failed import.
    expect(useSettingsStore.getState().hydrated).toBe(true);
  });
});

describe('resolveDisplayOrder', () => {
  it('uses the shared order while the per-page orders are disabled', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({
      displayOrder: 'size:desc',
      waitingTaskListPageDisplayOrder: 'name:asc',
      stoppedTaskListPageDisplayOrder: 'percent:asc',
    });

    const state = useSettingsStore.getState();
    expect(state.resolveDisplayOrder('downloading')).toBe('size:desc');
    expect(state.resolveDisplayOrder('waiting')).toBe('size:desc');
    expect(state.resolveDisplayOrder('stopped')).toBe('size:desc');
  });

  it('switches to the per-page order when the flag flips', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore
      .getState()
      .update({
        displayOrder: 'size:desc',
        waitingTaskListPageDisplayOrder: 'name:asc',
        stoppedTaskListPageDisplayOrder: 'percent:asc',
        taskListIndependentDisplayOrder: true,
      });

    const state = useSettingsStore.getState();
    expect(state.resolveDisplayOrder('downloading')).toBe('size:desc');
    expect(state.resolveDisplayOrder('waiting')).toBe('name:asc');
    expect(state.resolveDisplayOrder('stopped')).toBe('percent:asc');
  });

  it('falls back to default:asc for an invalid order', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({ displayOrder: 'garbage' as never });
    expect(useSettingsStore.getState().resolveDisplayOrder('downloading')).toBe('default:asc');
  });

  it('setDisplayOrder targets the right key', () => {
    const { useSettingsStore } = store;
    useSettingsStore.getState().hydrate();

    // Independent orders off: every page shares `displayOrder`.
    useSettingsStore.getState().setDisplayOrder('waiting', 'name:asc');
    expect(useSettingsStore.getState().get('displayOrder')).toBe('name:asc');
    expect(useSettingsStore.getState().get('waitingTaskListPageDisplayOrder')).toBe(
      'default:asc',
    );

    // Independent orders on: each page gets its own slot.
    useSettingsStore.getState().update({ taskListIndependentDisplayOrder: true });
    useSettingsStore.getState().setDisplayOrder('stopped', 'percent:desc');
    expect(useSettingsStore.getState().get('stoppedTaskListPageDisplayOrder')).toBe(
      'percent:desc',
    );
    expect(useSettingsStore.getState().get('displayOrder')).toBe('name:asc');

    useSettingsStore.getState().setDisplayOrder('downloading', 'size:asc');
    expect(useSettingsStore.getState().get('displayOrder')).toBe('size:asc');
  });
});

describe('broken storage', () => {
  it('keeps state in memory but writes nothing', () => {
    const { useSettingsStore } = store;
    local.failSet = true;
    blockCookies();

    try {
      useSettingsStore.getState().hydrate();
      const state = useSettingsStore.getState();
      expect(state.storageBroken).toBe(true);
      expect(state.firstVisit).toBe(true);

      useSettingsStore.getState().set('title', 'in memory only');
      useSettingsStore.getState().update({ theme: 'dark' });
      vi.advanceTimersByTime(1000);

      expect(useSettingsStore.getState().get('title')).toBe('in memory only');
      expect(useSettingsStore.getState().get('theme')).toBe('dark');
      expect(local.getItem(StorageKey.Options)).toBeNull();
    } finally {
      unblockCookies();
    }
  });
});

describe('secret codec', () => {
  it('round-trips unicode secrets', () => {
    const { encodeSecret, decodeSecret } = store;
    expect(decodeSecret(encodeSecret('pässwörd 🔐'))).toBe('pässwörd 🔐');
    expect(encodeSecret('')).toBe('');
    expect(decodeSecret('')).toBe('');
    // Undecodable input is returned untouched (AriaNg's angular-base64).
    expect(decodeSecret('not base64!')).toBe('not base64!');
  });
});
