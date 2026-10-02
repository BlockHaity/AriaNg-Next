import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeStorage {
  readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
}

let local: FakeStorage;
let bar: typeof import('../index');

beforeEach(async () => {
  local = new FakeStorage();
  vi.stubGlobal('localStorage', {
    get length() {
      return local.length;
    },
    clear: () => local.clear(),
    getItem: (k: string) => local.getItem(k),
    key: (i: number) => local.key(i),
    removeItem: (k: string) => local.removeItem(k),
    setItem: (k: string, v: string) => local.setItem(k, v),
  } as Storage);
  vi.resetModules();
  bar = await import('../index');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('barrel', () => {
  it('re-exports the whole public API', () => {
    for (const name of [
      'useSettingsStore',
      'useProfilesStore',
      'storageGet',
      'storageSet',
      'storageRemove',
      'storageClearAll',
      'storageKeys',
      'getSettingHistory',
      'addSettingHistory',
      'clearSettingHistories',
      'clearSettingHistory',
      'useTranslateSetting',
      'useRpcProfile',
      'useRpcDisplayName',
      'useIsWebSocket',
      'useIsStorageBroken',
      'useStorageAvailable',
      'encodeSecret',
      'decodeSecret',
      'flushSettingsPersist',
    ]) {
      expect(bar, `missing export: ${name}`).toHaveProperty(name);
    }
    expect(bar.isStorageSupported).toBe(true);
  });
});

describe('hooks', () => {
  it('react to settings and profile changes', () => {
    act(() => bar.useSettingsStore.getState().hydrate());
    act(() => {
      bar.useSettingsStore.getState().set('title', 'hello');
      bar.useSettingsStore.getState().set('protocol', 'ws');
    });

    const { result } = renderHook(() => ({
      title: bar.useTranslateSetting('title'),
      profile: bar.useRpcProfile(),
      name: bar.useRpcDisplayName(),
      ws: bar.useIsWebSocket(),
      broken: bar.useIsStorageBroken(),
      available: bar.useStorageAvailable(),
    }));

    expect(result.current.title).toBe('hello');
    expect(result.current.ws).toBe(true);
    expect(result.current.broken).toBe(false);
    expect(result.current.available).toBe(true);
    expect(result.current.name).toBe('localhost');
    expect(result.current.profile.isDefault).toBe(true);

    const first = result.current.profile;
    act(() => {
      bar.useSettingsStore.getState().set('title', 'still hello');
    });
    // A settings change that does not touch the profile keeps its identity.
    expect(result.current.profile).toBe(first);
    expect(result.current.title).toBe('still hello');

    act(() => {
      bar.useProfilesStore.getState().add();
    });
    expect(result.current.profile).toBe(first);

    act(() => {
      bar.useSettingsStore.getState().set('rpcAlias', 'my aria2');
    });
    expect(result.current.name).toBe('my aria2');
  });
});
