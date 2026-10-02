import { describe, expect, it } from 'vitest';
import { BASIC_TASK_PARAMS, FULL_TASK_PARAMS } from '../contract';
import {
  buildTellStoppedParams,
  buildTellWaitingParams,
  DEFAULT_STOPPED_OFFSET,
  DEFAULT_TASK_LIST_SIZE,
  DEFAULT_WAITING_OFFSET,
  getAria2NextTaskParams,
  getBasicTaskParams,
  getFullTaskParams,
  joinIndexes,
  keysToParams,
  splitOptionText,
  stripVolatileTaskKeys,
  VOLATILE_TASK_KEYS,
} from '../params';
import type { Aria2TaskStatusResult } from '../types';

describe('task key lists', () => {
  it('exposes the basic fields', () => {
    expect(getBasicTaskParams()).toEqual([
      'gid',
      'totalLength',
      'completedLength',
      'uploadSpeed',
      'downloadSpeed',
      'connections',
      'numSeeders',
      'seeder',
      'status',
      'errorCode',
      'verifiedLength',
      'verifyIntegrityPending',
    ]);
  });

  it('exposes the full fields as basic + the heavy ones', () => {
    expect(getFullTaskParams()).toEqual([
      ...getBasicTaskParams(),
      'files',
      'bittorrent',
      'infoHash',
    ]);
  });

  it('does not duplicate the contract lists', () => {
    expect(getBasicTaskParams()).toEqual([...BASIC_TASK_PARAMS]);
    expect(getFullTaskParams()).toEqual([...FULL_TASK_PARAMS]);
  });

  it('exposes the aria2-next fields', () => {
    expect(getAria2NextTaskParams()).toEqual([
      'errorMessage',
      'media',
      'ed2k',
      'dir',
      'following',
      'belongsTo',
    ]);
  });

  it('hands out a fresh array every time', () => {
    const first = getBasicTaskParams();
    first.push('mutated');
    expect(getBasicTaskParams()).not.toContain('mutated');
    expect(getFullTaskParams()).not.toContain('mutated');
  });
});

describe('stripVolatileTaskKeys', () => {
  it('removes the verified fields and keeps everything else', () => {
    const task = {
      gid: '2089b05ecca3d829',
      status: 'complete',
      verifiedLength: '1024',
      verifyIntegrityPending: 'false',
      infoHash: 'abc',
    };

    stripVolatileTaskKeys(task);

    expect(task).toEqual({ gid: '2089b05ecca3d829', status: 'complete', infoHash: 'abc' });
    expect('verifiedLength' in task).toBe(false);
    expect('verifyIntegrityPending' in task).toBe(false);
  });

  it('mutates in place and returns the same object, like the original delete', () => {
    const task = { gid: '1', verifiedLength: '10' };
    expect(stripVolatileTaskKeys(task)).toBe(task);
  });

  it('keeps a cached full task free of stale verified values', () => {
    const cached: Aria2TaskStatusResult = {
      gid: '1',
      status: 'active',
      totalLength: '100',
      completedLength: '50',
      downloadSpeed: '10',
      uploadSpeed: '0',
      connections: '1',
      numSeeders: '0',
      dir: '/tmp',
      verifiedLength: '0',
      verifyIntegrityPending: 'true',
      infoHash: 'hash',
    };

    // A *basic* response never carries the verified fields, so the cached ones
    // would otherwise survive forever once aria2 stopped reporting them.
    const response = { gid: '1', status: 'active', downloadSpeed: '20' };
    Object.assign(cached, response);
    stripVolatileTaskKeys(cached);

    expect(cached.verifiedLength).toBeUndefined();
    expect(cached.verifyIntegrityPending).toBeUndefined();
    // The heavy cached fields and the merged ones both survive.
    expect(cached.infoHash).toBe('hash');
    expect(cached.dir).toBe('/tmp');
    expect(cached.downloadSpeed).toBe('20');
  });

  it('can strip the incoming response instead of the cache', () => {
    const response = { gid: '1', verifiedLength: '50', verifyIntegrityPending: 'false' };
    const stripped = stripVolatileTaskKeys(response);
    expect(stripped).toBe(response);
    expect(stripped).toEqual({ gid: '1' });
  });

  it('tolerates a task that never had the volatile keys', () => {
    const task = { gid: '1', status: 'waiting' };
    expect(stripVolatileTaskKeys(task)).toEqual({ gid: '1', status: 'waiting' });
  });

  it('lists the keys it strips', () => {
    expect([...VOLATILE_TASK_KEYS]).toEqual(['verifiedLength', 'verifyIntegrityPending']);
  });
});

describe('keysToParams', () => {
  it('returns an empty list for missing keys', () => {
    expect(keysToParams(undefined)).toEqual([]);
    expect(keysToParams(null)).toEqual([]);
    expect(keysToParams([])).toEqual([]);
  });

  it('keeps the given keys in order', () => {
    expect(keysToParams(['gid', 'status', 'files'])).toEqual(['gid', 'status', 'files']);
  });

  it('trims and drops empty entries', () => {
    expect(keysToParams([' gid', '', '   ', 'status '])).toEqual(['gid', 'status']);
  });

  it('ignores non-string entries', () => {
    expect(keysToParams(['gid', 5 as unknown as string])).toEqual(['gid']);
  });
});

describe('buildTellWaitingParams', () => {
  it('defaults to the queue head and AriaNg page size', () => {
    expect(buildTellWaitingParams()).toEqual([DEFAULT_WAITING_OFFSET, DEFAULT_TASK_LIST_SIZE]);
    expect(DEFAULT_WAITING_OFFSET).toBe(0);
    expect(DEFAULT_TASK_LIST_SIZE).toBe(1000);
  });

  it('passes the explicit offset and num through', () => {
    expect(buildTellWaitingParams(20, 50)).toEqual([20, 50]);
  });

  it('appends the key filter when there is one', () => {
    expect(buildTellWaitingParams(0, 1000, ['gid', 'status'])).toEqual([0, 1000, ['gid', 'status']]);
    expect(buildTellWaitingParams(0, 1000, getBasicTaskParams())).toEqual([
      0,
      1000,
      getBasicTaskParams(),
    ]);
  });

  it('omits an empty key filter, aria2 rejects it', () => {
    expect(buildTellWaitingParams(0, 1000, [])).toEqual([0, 1000]);
    expect(buildTellWaitingParams(0, 1000, undefined)).toEqual([0, 1000]);
    expect(buildTellWaitingParams(0, 1000, [''])).toEqual([0, 1000]);
  });
});

describe('buildTellStoppedParams', () => {
  it('defaults to offset -1 (newest task first)', () => {
    expect(buildTellStoppedParams()).toEqual([-1, DEFAULT_TASK_LIST_SIZE]);
    expect(DEFAULT_STOPPED_OFFSET).toBe(-1);
  });

  it('passes the explicit offset and num through', () => {
    expect(buildTellStoppedParams(-10, 25)).toEqual([-10, 25]);
  });

  it('appends the key filter when there is one', () => {
    expect(buildTellStoppedParams(-1, 1000, ['gid'])).toEqual([-1, 1000, ['gid']]);
  });
});

describe('splitOptionText', () => {
  it('splits a header list on newlines', () => {
    expect(splitOptionText('Referer: https://example.com\nX-Token: 1', '\n')).toEqual([
      'Referer: https://example.com',
      'X-Token: 1',
    ]);
  });

  it('strips the carriage return of CRLF line endings', () => {
    expect(splitOptionText('A: 1\r\nB: 2\r\n', '\n')).toEqual(['A: 1', 'B: 2']);
  });

  it('drops a trailing separator instead of producing an empty item', () => {
    expect(splitOptionText('a, b,', ',')).toEqual(['a', 'b']);
    expect(splitOptionText('a\n', '\n')).toEqual(['a']);
  });

  it('drops a leading and repeated separators', () => {
    expect(splitOptionText(',a,,b,', ',')).toEqual(['a', 'b']);
  });

  it('drops whitespace-only items', () => {
    expect(splitOptionText(' , , ', ',')).toEqual([]);
    expect(splitOptionText('a, \t, b', ',')).toEqual(['a', 'b']);
  });

  it('trims each item but keeps the whitespace inside it', () => {
    expect(splitOptionText('  User  Agent: ariang  ', '\n')).toEqual(['User  Agent: ariang']);
  });

  it('returns an empty list for an empty value', () => {
    expect(splitOptionText('', ',')).toEqual([]);
    expect(splitOptionText('   ', '\n')).toEqual([]);
    expect(splitOptionText('', '\n')).toEqual([]);
  });

  it('returns a single item when there is no separator', () => {
    expect(splitOptionText('tracker.example.com:6969/announce', ',')).toEqual([
      'tracker.example.com:6969/announce',
    ]);
  });

  it('supports a multi-character separator', () => {
    expect(splitOptionText('a, b, c', ', ')).toEqual(['a', 'b', 'c']);
  });

  it('never splits per character when the separator is empty', () => {
    expect(splitOptionText('abc', '')).toEqual(['abc']);
    expect(splitOptionText('', '')).toEqual([]);
  });
});

describe('joinIndexes', () => {
  it('joins the select-file indexes with commas', () => {
    expect(joinIndexes([1, 3, 5])).toBe('1,3,5');
  });

  it('handles the degenerate cases', () => {
    expect(joinIndexes([])).toBe('');
    expect(joinIndexes([1])).toBe('1');
    expect(joinIndexes([0])).toBe('0');
  });
});