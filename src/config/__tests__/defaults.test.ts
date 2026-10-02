import { describe, expect, it } from 'vitest';
import {
  APP_CONSTANTS,
  DEFAULT_RPC_PROFILE,
  DEFAULT_SESSION_SETTINGS,
  DEFAULT_SETTINGS,
  cloneRpcProfile,
  createDefaultSettings,
  createNewRpcProfile,
  createSessionSettings,
  isWebSocketProfile,
  naturalCompare,
  rpcProfileDisplayName,
  rpcProfileUrl,
  rpcProfilesEqual,
} from '../defaults';
import type { RpcProfile } from '../types';

describe('APP_CONSTANTS', () => {
  it('ports ariaNgConstants', () => {
    expect(APP_CONSTANTS).toEqual({
      title: 'AriaNg',
      appPrefix: 'AriaNg',
      defaultLanguage: 'en',
      defaultHost: 'localhost',
      defaultSecureProtocol: 'https',
      defaultPathSeparator: '/',
      httpRequestTimeout: 20000,
      lazySaveTimeout: 500,
      errorTooltipDelay: 500,
      notificationInPageTimeout: 2000,
      historyMaxStoreCount: 10,
      cachedDebugLogsLimit: 100,
    });
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('ports ariaNgDefaultOptions', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      language: 'en',
      theme: 'light',
      title: '${downspeed}, ${upspeed} - ${title}',
      titleRefreshInterval: 5000,
      browserNotification: false,
      browserNotificationSound: true,
      browserNotificationFrequency: 'unlimited',
      rpcAlias: '',
      rpcHost: '',
      rpcPort: '6800',
      rpcInterface: 'jsonrpc',
      protocol: 'http',
      httpMethod: 'POST',
      rpcRequestHeaders: '',
      secret: '',
      extendRpcServers: [],
      webSocketReconnectInterval: 5000,
      globalStatRefreshInterval: 1000,
      downloadTaskRefreshInterval: 1000,
      keyboardShortcuts: true,
      swipeGesture: true,
      dragAndDropTasks: true,
      rpcListDisplayOrder: 'recentlyUsed',
      afterCreatingNewTask: 'task-list',
      removeOldTaskAfterRetrying: false,
      confirmTaskRemoval: true,
      includePrefixWhenCopyingFromTaskDetails: true,
      showPiecesInfoInTaskDetailPage: 'le10240',
      afterRetryingTask: 'task-list-downloading',
      taskListIndependentDisplayOrder: false,
      displayOrder: 'default:asc',
      waitingTaskListPageDisplayOrder: 'default:asc',
      stoppedTaskListPageDisplayOrder: 'default:asc',
      fileListDisplayOrder: 'default:asc',
      peerListDisplayOrder: 'default:asc',
    });
  });

  it('leaves the rpc host empty on purpose', () => {
    // Filled from the page host on first run (AriaNg: `initRpcSettingWithDefaultHostAndProtocol`).
    expect(DEFAULT_SETTINGS.rpcHost).toBe('');
  });
});

describe('createDefaultSettings', () => {
  it('returns an independent deep clone', () => {
    const settings = createDefaultSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    expect(settings.extendRpcServers).not.toBe(DEFAULT_SETTINGS.extendRpcServers);

    settings.language = 'ja_JP';
    settings.theme = 'dark';
    settings.rpcPort = '1234';
    settings.extendRpcServers.push(cloneRpcProfile(DEFAULT_RPC_PROFILE));

    expect(DEFAULT_SETTINGS.language).toBe('en');
    expect(DEFAULT_SETTINGS.theme).toBe('light');
    expect(DEFAULT_SETTINGS.rpcPort).toBe('6800');
    expect(DEFAULT_SETTINGS.extendRpcServers).toEqual([]);
  });

  it('hands out a fresh object every call', () => {
    const a = createDefaultSettings();
    const b = createDefaultSettings();

    expect(a).not.toBe(b);
    expect(a.extendRpcServers).not.toBe(b.extendRpcServers);
  });

  it('is mutable even though the constant is frozen', () => {
    const settings = createDefaultSettings();
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(settings)).toBe(false);
    expect(() => {
      settings.rpcAlias = 'home';
    }).not.toThrow();
  });
});

describe('DEFAULT_SESSION_SETTINGS', () => {
  it('is debug mode off', () => {
    expect(DEFAULT_SESSION_SETTINGS).toEqual({ debugMode: false });
    expect(createSessionSettings()).toEqual({ debugMode: false });
    expect(createSessionSettings()).not.toBe(DEFAULT_SESSION_SETTINGS);
  });
});

describe('DEFAULT_RPC_PROFILE', () => {
  it('is the default flag on top of the settings rpc fields', () => {
    expect(DEFAULT_RPC_PROFILE).toEqual({
      isDefault: true,
      rpcAlias: '',
      rpcHost: 'localhost',
      rpcPort: '6800',
      rpcInterface: 'jsonrpc',
      protocol: 'http',
      httpMethod: 'POST',
      rpcRequestHeaders: '',
      secret: '',
    });
    expect(DEFAULT_RPC_PROFILE.rpcId).toBeUndefined();
  });
});

describe('createNewRpcProfile', () => {
  it('defaults to the localhost http profile', () => {
    const profile = createNewRpcProfile();

    expect(profile.rpcHost).toBe('localhost');
    expect(profile.protocol).toBe('http');
    expect(profile.rpcPort).toBe('6800');
    expect(profile.rpcInterface).toBe('jsonrpc');
    expect(profile.httpMethod).toBe('POST');
    expect(profile.isDefault).toBe(false);
    expect(profile.rpcAlias).toBe('');
  });

  it('uses the page host when one is given', () => {
    expect(createNewRpcProfile('aria2.local').rpcHost).toBe('aria2.local');
    expect(createNewRpcProfile('').rpcHost).toBe('localhost');
  });

  it('forces https when the page was served over https', () => {
    expect(createNewRpcProfile('aria2.local', true).protocol).toBe('https');
    expect(createNewRpcProfile('aria2.local', false).protocol).toBe('http');
    expect(createNewRpcProfile(undefined, true).protocol).toBe('https');
  });

  it('mints a unique rpcId', () => {
    const a = createNewRpcProfile();
    const b = createNewRpcProfile();

    expect(a.rpcId).toBeTypeOf('string');
    expect(a.rpcId).not.toBe('');
    expect(a.rpcId).not.toBe(b.rpcId);
  });
});

describe('cloneRpcProfile', () => {
  it('copies every field, identity included', () => {
    const profile: RpcProfile = {
      rpcId: 'abc',
      isDefault: false,
      rpcAlias: 'home',
      rpcHost: 'nas',
      rpcPort: '6801',
      rpcInterface: 'jsonrpc',
      protocol: 'ws',
      httpMethod: 'GET',
      rpcRequestHeaders: 'X-A: 1',
      secret: 'c2VjcmV0',
    };
    const copy = cloneRpcProfile(profile);

    expect(copy).toEqual(profile);
    expect(copy).not.toBe(profile);
  });
});

describe('rpcProfileDisplayName', () => {
  it('prefers the alias', () => {
    expect(rpcProfileDisplayName({ ...DEFAULT_RPC_PROFILE, rpcAlias: 'home' })).toBe('home');
  });

  it('falls back to host:port', () => {
    expect(rpcProfileDisplayName(DEFAULT_RPC_PROFILE)).toBe('localhost:6800');
    expect(
      rpcProfileDisplayName({
        ...DEFAULT_RPC_PROFILE,
        rpcAlias: '',
        rpcHost: 'aria2.local',
        rpcPort: '6801',
      }),
    ).toBe('aria2.local:6801');
  });
});

describe('rpcProfileUrl', () => {
  it('builds the JSON-RPC endpoint for every protocol', () => {
    const base = { ...DEFAULT_RPC_PROFILE, rpcHost: 'aria2.local', rpcPort: '6800' };

    expect(rpcProfileUrl({ ...base, protocol: 'http' })).toBe('http://aria2.local:6800/jsonrpc');
    expect(rpcProfileUrl({ ...base, protocol: 'https' })).toBe('https://aria2.local:6800/jsonrpc');
    expect(rpcProfileUrl({ ...base, protocol: 'ws' })).toBe('ws://aria2.local:6800/jsonrpc');
    expect(rpcProfileUrl({ ...base, protocol: 'wss' })).toBe('wss://aria2.local:6800/jsonrpc');
  });

  it('honours a custom interface', () => {
    expect(rpcProfileUrl({ ...DEFAULT_RPC_PROFILE, rpcInterface: 'rpc' })).toBe(
      'http://localhost:6800/rpc',
    );
  });
});

describe('isWebSocketProfile', () => {
  it('is true only for ws / wss', () => {
    expect(isWebSocketProfile({ ...DEFAULT_RPC_PROFILE, protocol: 'ws' })).toBe(true);
    expect(isWebSocketProfile({ ...DEFAULT_RPC_PROFILE, protocol: 'wss' })).toBe(true);
    expect(isWebSocketProfile({ ...DEFAULT_RPC_PROFILE, protocol: 'http' })).toBe(false);
    expect(isWebSocketProfile({ ...DEFAULT_RPC_PROFILE, protocol: 'https' })).toBe(false);
  });
});

describe('rpcProfilesEqual', () => {
  const base: RpcProfile = {
    rpcId: 'a',
    isDefault: false,
    rpcAlias: 'home',
    rpcHost: 'nas',
    rpcPort: '6800',
    rpcInterface: 'jsonrpc',
    protocol: 'http',
    httpMethod: 'POST',
    rpcRequestHeaders: '',
    secret: 'c2VjcmV0',
  };

  it('is true for two identical profiles', () => {
    expect(rpcProfilesEqual(base, cloneRpcProfile(base))).toBe(true);
  });

  it('ignores the identity fields', () => {
    expect(rpcProfilesEqual(base, { ...base, rpcId: 'b', isDefault: true })).toBe(true);
  });

  it('detects a difference in each of the eight compared fields', () => {
    const changed: Array<[keyof RpcProfile, RpcProfile]> = [
      ['rpcAlias', { ...base, rpcAlias: 'other' }],
      ['rpcHost', { ...base, rpcHost: 'other' }],
      ['rpcPort', { ...base, rpcPort: '6801' }],
      ['rpcInterface', { ...base, rpcInterface: 'rpc' }],
      ['protocol', { ...base, protocol: 'https' }],
      ['httpMethod', { ...base, httpMethod: 'GET' }],
      ['rpcRequestHeaders', { ...base, rpcRequestHeaders: 'X-A: 1' }],
      ['secret', { ...base, secret: '' }],
    ];

    expect(changed).toHaveLength(8);
    for (const [, other] of changed) {
      expect(rpcProfilesEqual(base, other)).toBe(false);
      expect(rpcProfilesEqual(other, base)).toBe(false);
    }
  });
});

describe('naturalCompare', () => {
  it('sorts digit runs numerically', () => {
    expect(['item2', 'item10', 'item1'].sort(naturalCompare)).toEqual(['item1', 'item2', 'item10']);
    expect(['Server 10', 'Server 2', 'Server 1'].sort(naturalCompare)).toEqual([
      'Server 1',
      'Server 2',
      'Server 10',
    ]);
    expect(['x9', 'x10', 'x1'].sort(naturalCompare)).toEqual(['x1', 'x9', 'x10']);
  });

  it('is a total order over the sign of the comparison', () => {
    expect(naturalCompare('a', 'a')).toBe(0);
    expect(naturalCompare('a', 'b')).toBe(-1);
    expect(naturalCompare('b', 'a')).toBe(1);
    expect(naturalCompare('abc', 'abcd')).toBe(-1);
    expect(naturalCompare('', 'a')).toBe(-1);
  });

  it('keeps natural-compare\'s leading-zero and casing quirks', () => {
    // A run may not *start* with 0, so '01' compares as text.
    expect(naturalCompare('file01', 'file1')).toBe(-1);
    // Uppercase sorts before lowercase.
    expect(naturalCompare('a', 'A')).toBe(1);
  });

  it('sorts rpc aliases the way AriaNg did', () => {
    const aliases = ['rpc10', 'rpc2', 'RPC1', 'rpc1'];
    expect([...aliases].sort(naturalCompare)).toEqual(['RPC1', 'rpc1', 'rpc2', 'rpc10']);
  });
});