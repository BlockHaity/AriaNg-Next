import { describe, expect, it } from 'vitest';
import {
  getAria2MethodFullName,
  getMethodMeta,
  isSupportedMethod,
  isSystemMethod,
  parseRpcMethodInput,
  RPC_METHOD_CATALOG,
  type RpcMethodMeta,
} from '../catalog';

/** Every method reachable through `Aria2Client`, plus `system.multicall`. */
const EXPECTED_BARE_NAMES = [
  'addUri',
  'addTorrent',
  'addMetalink',
  'inspectTorrent',
  'remove',
  'forceRemove',
  'pause',
  'pauseAll',
  'forcePause',
  'forcePauseAll',
  'unpause',
  'unpauseAll',
  'changePosition',
  'changeUri',
  'selectFile',
  'purgeDownloadResult',
  'removeDownloadResult',
  'tellStatus',
  'tellActive',
  'tellWaiting',
  'tellStopped',
  'getUris',
  'getFiles',
  'getPeers',
  'getServers',
  'getOption',
  'changeOption',
  'getGlobalOption',
  'changeGlobalOption',
  'getGlobalStat',
  'getVersion',
  'getSessionInfo',
  'saveSession',
  'shutdown',
  'forceShutdown',
  'getBtTrackers',
  'forceBtAnnounce',
  'addBtPeers',
  'getBtSessionStatus',
  'forceBtRecheck',
  'finishMedia',
  'retryMedia',
  'resolveFilename',
  'ed2kSearch',
  'getEd2kSearchResults',
  'system.multicall',
  'system.listMethods',
  'system.listNotifications',
];

const EXPECTED_DESTRUCTIVE = [
  'remove',
  'forceRemove',
  'purgeDownloadResult',
  'removeDownloadResult',
  'shutdown',
  'forceShutdown',
];

const EXPECTED_ARIA2_NEXT_ONLY = [
  'inspectTorrent',
  'forceBtRecheck',
  'finishMedia',
  'retryMedia',
  'resolveFilename',
  'ed2kSearch',
  'getEd2kSearchResults',
];

describe('RPC_METHOD_CATALOG', () => {
  it('exposes every aria2 method plus the system ones', () => {
    const names = RPC_METHOD_CATALOG.map((meta) => meta.name);
    // Completeness, independent of the grouping order.
    expect([...names].sort()).toEqual([...EXPECTED_BARE_NAMES].sort());
    expect(names).toHaveLength(EXPECTED_BARE_NAMES.length);
  });

  it('starts with the add methods and ends with the system ones', () => {
    const names = RPC_METHOD_CATALOG.map((meta) => meta.name);
    expect(names[0]).toBe('addUri');
    expect(names.slice(-3)).toEqual([
      'system.multicall',
      'system.listMethods',
      'system.listNotifications',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(RPC_METHOD_CATALOG.map((meta) => meta.name)).size).toBe(RPC_METHOD_CATALOG.length);
    expect(new Set(RPC_METHOD_CATALOG.map((meta) => meta.fullName)).size).toBe(
      RPC_METHOD_CATALOG.length,
    );
  });

  it('derives fullName from service and name, and keeps the dot on system methods', () => {
    for (const meta of RPC_METHOD_CATALOG) {
      // aria2 methods gain the prefix, system methods already carry it.
      const expected = meta.service === 'system' ? `system.${meta.name}` : `aria2.${meta.name}`;
      expect(meta.fullName).toBe(meta.name.startsWith('system.') ? meta.name : expected);
      expect(meta.fullName.startsWith(`${meta.service}.`)).toBe(true);
      expect(meta.summary.length).toBeGreaterThan(0);
    }
    expect(getMethodMeta('system.multicall')?.name).toBe('system.multicall');
    expect(getMethodMeta('system.multicall')?.fullName).toBe('system.multicall');
  });

  it('flags exactly the destructive methods', () => {
    const destructive = RPC_METHOD_CATALOG.filter((meta) => meta.destructive).map((meta) => meta.name);
    expect(destructive).toEqual(EXPECTED_DESTRUCTIVE);
    expect(getMethodMeta('tellStatus')?.destructive).toBeUndefined();
    expect(getMethodMeta('remove')?.destructive).toBe(true);
  });

  it('flags exactly the aria2-next methods', () => {
    const aria2NextOnly = RPC_METHOD_CATALOG.filter((meta) => meta.aria2NextOnly).map(
      (meta) => meta.name,
    );
    expect(aria2NextOnly).toEqual(EXPECTED_ARIA2_NEXT_ONLY);
  });

  it('marks every aria2 method as such and every system method as system', () => {
    for (const meta of RPC_METHOD_CATALOG) {
      expect(meta.service).toBe(meta.name.startsWith('system.') ? 'system' : 'aria2');
    }
  });
});

describe('getMethodMeta', () => {
  it('accepts a bare name', () => {
    expect(getMethodMeta('tellStatus')?.fullName).toBe('aria2.tellStatus');
  });

  it('accepts a full name', () => {
    expect(getMethodMeta('aria2.tellStatus')?.name).toBe('tellStatus');
  });

  it('trims the input', () => {
    expect(getMethodMeta('  aria2.tellStatus  ')?.name).toBe('tellStatus');
  });

  it('returns the same object for both spellings', () => {
    expect(getMethodMeta('addUri')).toBe(getMethodMeta('aria2.addUri'));
  });

  it('returns undefined for unknown methods', () => {
    expect(getMethodMeta('aria2.nope')).toBeUndefined();
    expect(getMethodMeta('nope')).toBeUndefined();
    expect(getMethodMeta('')).toBeUndefined();
  });

  it('does not confuse the service prefix with the method name', () => {
    expect(getMethodMeta('aria2')).toBeUndefined();
    expect(getMethodMeta('aria2.aria2.tellStatus')).toBeUndefined();
  });

  it('resolves system methods by their dotted bare name', () => {
    expect(getMethodMeta('system.listMethods')?.service).toBe('system');
    // `listMethods` alone is the client-side alias, not a wire name.
    expect(getMethodMeta('listMethods')).toBeUndefined();
  });
});

describe('isSystemMethod', () => {
  it('is true only for the system service', () => {
    expect(isSystemMethod('system.multicall')).toBe(true);
    expect(isSystemMethod('system.listNotifications')).toBe(true);
  });

  it('is false for aria2 methods, bare system aliases and unknown input', () => {
    expect(isSystemMethod('aria2.tellStatus')).toBe(false);
    expect(isSystemMethod('tellStatus')).toBe(false);
    expect(isSystemMethod('multicall')).toBe(false);
    expect(isSystemMethod('system')).toBe(false);
    expect(isSystemMethod('system.nope')).toBe(false);
    expect(isSystemMethod('')).toBe(false);
  });
});

describe('getAria2MethodFullName', () => {
  it('prefixes a bare aria2 method', () => {
    expect(getAria2MethodFullName('tellStatus')).toBe('aria2.tellStatus');
    expect(getAria2MethodFullName(' ed2kSearch ')).toBe('aria2.ed2kSearch');
  });

  it('keeps an already qualified name', () => {
    expect(getAria2MethodFullName('aria2.tellStatus')).toBe('aria2.tellStatus');
    expect(getAria2MethodFullName('system.multicall')).toBe('system.multicall');
  });

  it('keeps an unknown but qualified name, and prefixes an unknown bare one', () => {
    expect(getAria2MethodFullName('system.nope')).toBe('system.nope');
    expect(getAria2MethodFullName('nope')).toBe('aria2.nope');
  });

  it('resolves the dotted system names', () => {
    expect(getAria2MethodFullName('system.listMethods')).toBe('system.listMethods');
  });
});

describe('isSupportedMethod', () => {
  it('accepts bare and full names of catalogue methods', () => {
    expect(isSupportedMethod('tellStatus')).toBe(true);
    expect(isSupportedMethod('aria2.tellStatus')).toBe(true);
    expect(isSupportedMethod('system.listMethods')).toBe(true);
    expect(isSupportedMethod('getEd2kSearchResults')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSupportedMethod('aria2.nope')).toBe(false);
    expect(isSupportedMethod('nope')).toBe(false);
    expect(isSupportedMethod('tellstatus')).toBe(false);
    expect(isSupportedMethod('')).toBe(false);
  });
});

describe('parseRpcMethodInput', () => {
  it('accepts a known full name', () => {
    expect(parseRpcMethodInput('aria2.tellStatus')).toEqual({ ok: true, name: 'aria2.tellStatus' });
    expect(parseRpcMethodInput('system.multicall')).toEqual({ ok: true, name: 'system.multicall' });
  });

  it('trims the input before validating', () => {
    expect(parseRpcMethodInput('  aria2.tellStatus \n')).toEqual({
      ok: true,
      name: 'aria2.tellStatus',
    });
  });

  it('reports a bare name as illegal (no dot)', () => {
    expect(parseRpcMethodInput('tellStatus')).toEqual({ ok: false, reason: 'illegal' });
  });

  it('reports an unknown dotted name as unsupported', () => {
    expect(parseRpcMethodInput('aria2.nope')).toEqual({ ok: false, reason: 'unsupported' });
    expect(parseRpcMethodInput('system.nope')).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('rejects an illegal shape before looking the method up', () => {
    for (const input of ['', '   ', '.', 'aria2.', '.tellStatus', 'aria2.tellStatus.extra']) {
      expect(parseRpcMethodInput(input)).toEqual({ ok: false, reason: 'illegal' });
    }
  });

  it('never returns a name for a rejected input', () => {
    const result = parseRpcMethodInput('aria2.nope');
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('name');
  });

  it('agrees with isSupportedMethod for every catalogue entry', () => {
    const catalog: readonly RpcMethodMeta[] = RPC_METHOD_CATALOG;
    for (const meta of catalog) {
      expect(parseRpcMethodInput(meta.fullName)).toEqual({ ok: true, name: meta.fullName });
    }
  });
});