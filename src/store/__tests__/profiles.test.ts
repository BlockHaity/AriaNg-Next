import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKey } from '@/config/types';
import type { RpcProfile } from '@/config/types';

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

function storedProfiles(): Record<string, unknown>[] {
  const list = readStoredOptions().extendRpcServers;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

type ProfilesModule = typeof import('../profiles');
type SettingsModule = typeof import('../settings');
type HooksModule = typeof import('../hooks');

let profiles: ProfilesModule;
let settings: SettingsModule;
let hooks: HooksModule;

beforeEach(async () => {
  vi.useFakeTimers();
  local = new FakeStorage();
  vi.stubGlobal('localStorage', local.toStorage());
  installLocation('http:', 'localhost');
  vi.resetModules();
  settings = await import('../settings');
  profiles = await import('../profiles');
  hooks = await import('../hooks');
  settings.useSettingsStore.getState().hydrate();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function server(overrides: Partial<RpcProfile> = {}): RpcProfile {
  return {
    rpcId: `id-${Math.random().toString(36).slice(2, 8)}`,
    isDefault: false,
    rpcAlias: 'server',
    rpcHost: '10.0.0.1',
    rpcPort: '6800',
    rpcInterface: 'jsonrpc',
    protocol: 'http',
    httpMethod: 'POST',
    rpcRequestHeaders: '',
    secret: '',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */

describe('profile list shape', () => {
  it('always keeps the default profile at index 0', () => {
    const first = profiles.useProfilesStore.getState().add();
    profiles.useProfilesStore.getState().add();

    const list = profiles.useProfilesStore.getState().profiles;
    expect(list).toHaveLength(3);
    expect(list[0].isDefault).toBe(true);
    expect(list[0].rpcId).toBeUndefined();
    expect(list[0].rpcHost).toBe('localhost');
    expect(list[1].rpcId).toBe(first.rpcId);
    expect(list[2].isDefault).toBe(false);
    expect(profiles.useProfilesStore.getState().activeProfileIndex).toBe(0);
    expect(profiles.useProfilesStore.getState().activeProfile()).toBe(list[0]);
  });

  it('mirrors the top-level settings into the default profile', () => {
    settings.useSettingsStore
      .getState()
      .update({ rpcAlias: 'top', rpcHost: 'nas', rpcPort: '6801', protocol: 'ws' });

    const [first] = profiles.useProfilesStore.getState().profiles;
    expect(first.rpcAlias).toBe('top');
    expect(first.rpcHost).toBe('nas');
    expect(first.rpcPort).toBe('6801');
    expect(first.protocol).toBe('ws');
    expect(first.isDefault).toBe(true);
  });

  it('rebuilds from the settings store on demand', () => {
    const store = profiles.useProfilesStore;
    store.getState().add();
    settings.useSettingsStore.getState().update({ rpcHost: 'changed' });

    expect(store.getState().profiles[0].rpcHost).toBe('changed');
    // Unchanged entries keep their object identity (narrow selectors).
    const before = store.getState().profiles[1];
    settings.useSettingsStore.getState().update({ title: 'unrelated' });
    expect(store.getState().profiles[1]).toBe(before);
    // Even a structural change (a new entry) leaves the others untouched.
    store.getState().add();
    expect(store.getState().profiles[1]).toBe(before);
  });
});

describe('add / remove', () => {
  it('add() appends a fresh profile with an rpcId', () => {
    const created = profiles.useProfilesStore.getState().add();

    expect(created.rpcId).toBeTruthy();
    expect(created.isDefault).toBe(false);
    expect(profiles.useProfilesStore.getState().profiles).toHaveLength(2);
    vi.advanceTimersByTime(300);
    expect(storedProfiles()).toHaveLength(1);
    expect(storedProfiles()[0].rpcId).toBe(created.rpcId);
  });

  it('refuses to remove the default profile', () => {
    const store = profiles.useProfilesStore;
    store.getState().add();

    store.getState().remove(store.getState().profiles[0]);

    expect(store.getState().profiles).toHaveLength(2);
    expect(storedProfiles()).toHaveLength(0);
  });

  it('removes an extended profile by rpcId', () => {
    const store = profiles.useProfilesStore;
    const a = store.getState().add();
    store.getState().add();

    store.getState().remove(a);

    expect(store.getState().profiles).toHaveLength(2);
    expect(store.getState().profiles.filter((p) => !p.isDefault)).toHaveLength(1);
  });

  it('keeps the active selection when another profile is removed', () => {
    const store = profiles.useProfilesStore;
    const a = store.getState().add();
    const b = store.getState().add();
    store.getState().update(b, { rpcAlias: 'b' });
    store.getState().setActiveProfileIndex(2);
    expect(store.getState().activeProfile().rpcAlias).toBe('b');

    store.getState().remove(a);

    expect(store.getState().profiles).toHaveLength(2);
    // Still pointed at the same server, now at index 1.
    expect(store.getState().activeProfileIndex).toBe(1);
    expect(store.getState().activeProfile().rpcAlias).toBe('b');
  });

  it('falls back to the default profile when the active one is removed', () => {
    const store = profiles.useProfilesStore;
    const a = store.getState().add();
    store.getState().add();
    store.getState().setActiveProfileIndex(1);
    expect(store.getState().activeProfile().rpcId).toBe(a.rpcId);

    store.getState().remove(a);

    expect(store.getState().activeProfileIndex).toBe(0);
    expect(store.getState().activeProfile().isDefault).toBe(true);
  });
});

describe('update', () => {
  it('routes default profile updates into the top-level settings', () => {
    const store = profiles.useProfilesStore;
    const [first] = store.getState().profiles;

    store.getState().update(first, { rpcHost: '10.1.1.1', rpcAlias: 'lan', secret: 'topsecret' });

    const current = settings.useSettingsStore.getState();
    expect(current.get('rpcHost')).toBe('10.1.1.1');
    expect(current.get('rpcAlias')).toBe('lan');
    expect(current.get('secret')).toBe('topsecret');
    expect(store.getState().profiles[0].rpcHost).toBe('10.1.1.1');
    // Nothing leaked into extendRpcServers.
    expect(current.get('extendRpcServers')).toEqual([]);

    vi.advanceTimersByTime(300);
    expect(readStoredOptions().secret).toBe(btoa('topsecret'));
  });

  it('routes extended profile updates into extendRpcServers by rpcId', () => {
    const store = profiles.useProfilesStore;
    const created = store.getState().add();

    store.getState().update(created, { rpcHost: '10.2.2.2', secret: 'entry' });

    expect(settings.useSettingsStore.getState().get('extendRpcServers')[0]).toMatchObject({
      rpcId: created.rpcId,
      rpcHost: '10.2.2.2',
      secret: 'entry',
    });
    // The top-level slot is untouched.
    expect(settings.useSettingsStore.getState().get('rpcHost')).toBe('localhost');
    expect(store.getState().profiles[0].rpcHost).toBe('localhost');

    vi.advanceTimersByTime(300);
    expect(storedProfiles()[0].secret).toBe(btoa('entry'));
  });

  it('coerces the port with Math.max(parseInt(v) || 0, 0)', () => {
    const store = profiles.useProfilesStore;
    const [first] = store.getState().profiles;
    const created = store.getState().add();

    store.getState().update(first, { rpcPort: '6801' });
    expect(store.getState().profiles[0].rpcPort).toBe('6801');

    store.getState().update(created, { rpcPort: '-42' });
    expect(store.getState().profiles[1].rpcPort).toBe('0');

    store.getState().update(created, { rpcPort: 'not a port' });
    expect(store.getState().profiles[1].rpcPort).toBe('0');
  });
});

describe('setDefault', () => {
  it('promotes an extended profile into the top-level slot', () => {
    const store = profiles.useProfilesStore;
    const created = store.getState().add();
    store.getState().update(created, { rpcPort: '6801', rpcHost: '10.0.0.7' });
    settings.useSettingsStore.getState().update({ rpcHost: 'old-default', rpcAlias: 'old' });

    store.getState().setDefault(created);

    const current = settings.useSettingsStore.getState();
    expect(current.get('rpcAlias')).toBe(created.rpcAlias);
    expect(current.get('rpcHost')).toBe('10.0.0.7');
    expect(current.get('rpcPort')).toBe('6801');
    // The promoted profile leaves the extended list.
    expect(current.get('extendRpcServers')).toEqual([]);

    const list = store.getState().profiles;
    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true);
    expect(list[0].rpcHost).toBe('10.0.0.7');
  });

  it('coerces the promoted port like every other write', () => {
    const store = profiles.useProfilesStore;
    const created = store.getState().add(); // blank port
    store.getState().setDefault(created);
    expect(settings.useSettingsStore.getState().get('rpcPort')).toBe('0');
  });

  it('keeps the previous default as the first entry when asked', () => {
    const store = profiles.useProfilesStore;
    settings.useSettingsStore.getState().update({ rpcHost: 'old-default', rpcAlias: 'old' });
    const created = store.getState().add();

    store.getState().setDefault(created, { keepPreviousAsEntry: true });

    const extended = settings.useSettingsStore.getState().get('extendRpcServers');
    expect(extended).toHaveLength(1);
    expect(extended[0].rpcHost).toBe('old-default');
    expect(extended[0].rpcAlias).toBe('old');
    expect(extended[0].rpcId).toBeTruthy();
    expect(extended[0].isDefault).toBe(false);

    const list = store.getState().profiles;
    expect(list).toHaveLength(2);
    expect(list[0].isDefault).toBe(true);
    expect(list[0].rpcHost).toBe(created.rpcHost);
    expect(list[1].rpcHost).toBe('old-default');
  });

  it('forceSet trusts the passed copy and re-encodes its secret', () => {
    const store = profiles.useProfilesStore;
    const draft = server({ rpcAlias: 'draft', rpcHost: '10.9.9.9', secret: 'forced' });

    store.getState().setDefault(draft, { forceSet: true });

    const current = settings.useSettingsStore.getState();
    expect(current.get('rpcAlias')).toBe('draft');
    expect(current.get('rpcHost')).toBe('10.9.9.9');
    expect(current.get('secret')).toBe('forced');

    vi.advanceTimersByTime(300);
    expect(readStoredOptions().secret).toBe(btoa('forced'));
  });

  it('selecting a new default resets the active index', () => {
    const store = profiles.useProfilesStore;
    const created = store.getState().add();
    store.getState().add();
    store.getState().setActiveProfileIndex(2);

    store.getState().setDefault(created);

    expect(store.getState().activeProfileIndex).toBe(0);
    expect(store.getState().activeProfile().rpcHost).toBe(created.rpcHost);
  });
});

describe('isEqualToDefault', () => {
  it('compares against the current top-level profile', () => {
    const store = profiles.useProfilesStore;
    const [first] = store.getState().profiles;
    const created = store.getState().add();

    expect(store.getState().isEqualToDefault({ ...first, rpcId: 'x' })).toBe(true);
    expect(store.getState().isEqualToDefault(created)).toBe(false);

    store.getState().update(first, { rpcHost: 'other' });
    expect(store.getState().isEqualToDefault({ ...first, rpcId: 'x' })).toBe(false);
  });
});

describe('ordered()', () => {
  beforeEach(() => {
    const store = profiles.useProfilesStore;
    settings.useSettingsStore
      .getState()
      .update({ rpcAlias: 'zzz default', rpcHost: 'default-host' });
    const a = store.getState().add();
    const b = store.getState().add();
    store.getState().update(a, { rpcAlias: 'alpha 10' });
    store.getState().update(b, { rpcAlias: 'alpha 2' });
  });

  it('sorts by alias with naturalCompare for rpcAlias order', () => {
    settings.useSettingsStore.getState().update({ rpcListDisplayOrder: 'rpcAlias' });
    expect(
      profiles.useProfilesStore.getState().ordered().map((p) => p.rpcAlias),
    ).toEqual(['alpha 2', 'alpha 10', 'zzz default']);
  });

  it('keeps natural order (default first) for recentlyUsed', () => {
    settings.useSettingsStore.getState().update({ rpcListDisplayOrder: 'recentlyUsed' });
    expect(
      profiles.useProfilesStore.getState().ordered().map((p) => p.rpcAlias),
    ).toEqual(['zzz default', 'alpha 10', 'alpha 2']);
  });
});

describe('displayName', () => {
  it('prefers the alias, falls back to the host, then to "Default"', () => {
    const store = profiles.useProfilesStore;
    expect(store.getState().displayName(server({ rpcAlias: 'nas' }))).toBe('nas');
    expect(
      store.getState().displayName(server({ rpcAlias: '', rpcHost: '10.0.0.9' })),
    ).toBe('10.0.0.9');
    expect(
      store.getState().displayName(server({ rpcAlias: '', rpcHost: '' })),
    ).toBe('Default');
  });
});

describe('isProtocolDisabled', () => {
  it('allows everything on an http page', () => {
    installLocation('http:', 'localhost');
    const { isProtocolDisabled } = profiles.useProfilesStore.getState();
    expect(isProtocolDisabled('http')).toBe(false);
    expect(isProtocolDisabled('ws')).toBe(false);
    expect(isProtocolDisabled('https')).toBe(false);
    expect(isProtocolDisabled('wss')).toBe(false);
  });

  it('disables the insecure protocols on an https page', () => {
    installLocation('https:', 'secure.example');
    const { isProtocolDisabled } = profiles.useProfilesStore.getState();
    expect(isProtocolDisabled('http')).toBe(true);
    expect(isProtocolDisabled('ws')).toBe(true);
    expect(isProtocolDisabled('https')).toBe(false);
    expect(isProtocolDisabled('wss')).toBe(false);
  });
});

describe('selector hooks', () => {
  it('expose the active profile and follow settings changes', () => {
    const { result } = renderHook(() => ({
      profile: hooks.useRpcProfile(),
      name: hooks.useRpcDisplayName(),
      ws: hooks.useIsWebSocket(),
      title: hooks.useTranslateSetting('title'),
      broken: hooks.useIsStorageBroken(),
    }));

    expect(result.current.profile.isDefault).toBe(true);
    expect(result.current.name).toBe('localhost');
    expect(result.current.ws).toBe(false);
    expect(result.current.broken).toBe(false);

    const first = result.current.profile;
    act(() => {
      settings.useSettingsStore.getState().set('title', 'hello');
      profiles.useProfilesStore.getState().add();
    });
    // Adding a profile must not invalidate the default profile's identity.
    expect(result.current.profile).toBe(first);
    expect(result.current.title).toBe('hello');

    act(() => {
      settings.useSettingsStore.getState().set('rpcAlias', 'my aria2');
    });
    expect(result.current.name).toBe('my aria2');

    act(() => {
      settings.useSettingsStore.getState().set('protocol', 'wss');
    });
    expect(result.current.ws).toBe(true);
  });
});
