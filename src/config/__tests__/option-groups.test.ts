import { describe, expect, it } from 'vitest';

import { ARIA2_ALL_OPTIONS } from '@/config/aria2-options';
import {
  ARIA2_GLOBAL_GROUPS,
  ARIA2_QUICK_SETTINGS,
  ARIA2_TASK_OPTIONS,
  getGlobalOptionKeys,
  getQuickSettingKeys,
  getTaskOptionKeys,
} from '@/config/option-groups';
import { OPTION_GROUP_ROUTES } from '@/config/types';
import type { OptionGroupRoute, TaskOptionContext } from '@/config/types';

const CONTEXTS: readonly TaskOptionContext[] = ['new', 'active', 'waiting', 'paused'];

const groupKeys = (route: OptionGroupRoute): string[] => ARIA2_GLOBAL_GROUPS[route].keys;

const allGroupKeys = Object.values(ARIA2_GLOBAL_GROUPS).flatMap((group) => group.keys);

describe('ARIA2_GLOBAL_GROUPS', () => {
  it('covers every settings route', () => {
    expect(Object.keys(ARIA2_GLOBAL_GROUPS).sort()).toEqual([...OPTION_GROUP_ROUTES].sort());
  });

  it('gives every route an i18n label key', () => {
    for (const route of OPTION_GROUP_ROUTES) {
      expect(ARIA2_GLOBAL_GROUPS[route].labelKey, route).toMatch(/^optionGroup\./);
    }
  });

  it('only references keys that resolve in the catalogue', () => {
    for (const key of allGroupKeys) {
      expect(Object.hasOwn(ARIA2_ALL_OPTIONS, key), key).toBe(true);
    }
  });

  it('lists every current option in at least one route', () => {
    const listed = new Set(allGroupKeys);
    const orphans = Object.entries(ARIA2_ALL_OPTIONS)
      .filter(([, meta]) => meta.support === 'current')
      .map(([key]) => key)
      .filter((key) => !listed.has(key));
    expect(orphans).toEqual([]);
  });

  it('lists every option exactly once', () => {
    const duplicates = allGroupKeys.filter((key, index) => allGroupKeys.indexOf(key) !== index);
    expect([...new Set(duplicates)]).toEqual([]);
  });

  it('agrees with each entry category, so the two tables cannot drift', () => {
    for (const route of OPTION_GROUP_ROUTES) {
      for (const key of groupKeys(route)) {
        expect(ARIA2_ALL_OPTIONS[key].category, `${route} / ${key}`).toBe(route);
      }
    }
  });

  it('keeps AriaNg legacy membership', () => {
    expect(groupKeys('basic')).toEqual(
      expect.arrayContaining(['dir', 'log', 'max-concurrent-downloads', 'check-integrity', 'continue']),
    );
    expect(groupKeys('bt')).toEqual(expect.arrayContaining(['bt-tracker', 'seed-ratio', 'listen-port']));
    expect(groupKeys('metalink')).toEqual(expect.arrayContaining(['follow-metalink', 'metalink-os']));
    expect(groupKeys('rpc')).toEqual(expect.arrayContaining(['rpc-secret', 'rpc-listen-port']));
  });

  it('puts the aria2-next families in their own routes', () => {
    expect(groupKeys('ed2k')).toContain('detach-share-only');
    expect(groupKeys('ed2k').filter((key) => key.startsWith('ed2k-'))).toHaveLength(10);
    expect(groupKeys('media')).toHaveLength(11);
    expect(groupKeys('ftp-sftp')).toEqual(expect.arrayContaining(['sftp-user', 'ssh-host-key-sha256']));
  });
});

describe('getGlobalOptionKeys', () => {
  it('rejects an unknown route', () => {
    expect(getGlobalOptionKeys('nope')).toBe(false);
    expect(getGlobalOptionKeys('')).toBe(false);
    expect(getGlobalOptionKeys('constructor')).toBe(false);
    expect(getGlobalOptionKeys('toString')).toBe(false);
  });

  it('returns the route keys for a known route', () => {
    expect(getGlobalOptionKeys('ed2k')).toEqual(
      expect.arrayContaining(['ed2k-piece-selector', 'detach-share-only']),
    );
  });

  it('hides every retired key, renamed or dropped alike', () => {
    const keys = getGlobalOptionKeys('ftp-sftp');
    expect(keys).not.toContain('ftp-pasv');
    expect(keys).not.toContain('ssh-host-key-md');
    expect(keys).toEqual(expect.arrayContaining(['sftp-user', 'ssh-host-key-sha256']));

    const bt = getGlobalOptionKeys('bt');
    expect(bt).not.toContain('peer-id-prefix');
    expect(bt).not.toContain('peer-agent');
    expect(bt).toEqual(expect.arrayContaining(['bt-peer-id-prefix', 'bt-user-agent']));
  });
});

describe('ARIA2_QUICK_SETTINGS', () => {
  it('matches AriaNg globalSpeedLimitOptions', () => {
    expect(ARIA2_QUICK_SETTINGS.globalSpeedLimit).toEqual([
      'max-overall-download-limit',
      'max-overall-upload-limit',
    ]);
    expect(getQuickSettingKeys('globalSpeedLimit')).toBe(ARIA2_QUICK_SETTINGS.globalSpeedLimit);
  });
});

describe('ARIA2_TASK_OPTIONS', () => {
  it('ports every AriaNg rule plus the aria2-next additions', () => {
    expect(ARIA2_TASK_OPTIONS).toHaveLength(47);
    expect(ARIA2_TASK_OPTIONS.slice(0, 32).map((rule) => rule.key)).toEqual([
      'dir',
      'out',
      'allow-overwrite',
      'max-download-limit',
      'max-upload-limit',
      'split',
      'min-split-size',
      'max-connection-per-server',
      'lowest-speed-limit',
      'stream-piece-selector',
      'http-user',
      'http-passwd',
      'all-proxy',
      'all-proxy-user',
      'all-proxy-passwd',
      'checksum',
      'continue',
      'referer',
      'header',
      'bt-max-peers',
      'bt-request-peer-speed-limit',
      'bt-remove-unselected-file',
      'bt-stop-timeout',
      'bt-tracker',
      'seed-ratio',
      'seed-time',
      'pause-metadata',
      'conditional-get',
      'check-integrity',
      'file-allocation',
      'parameterized-uri',
      'force-save',
    ]);
  });

  it('only references keys that resolve in the catalogue', () => {
    for (const rule of ARIA2_TASK_OPTIONS) {
      expect(Object.hasOwn(ARIA2_ALL_OPTIONS, rule.key), rule.key).toBe(true);
    }
  });

  it('lists every key exactly once', () => {
    const keys = ARIA2_TASK_OPTIONS.map((rule) => rule.key);
    expect([...new Set(keys)]).toHaveLength(keys.length);
  });

  it('keeps showHistory on --dir and nowhere else', () => {
    const withHistory = ARIA2_TASK_OPTIONS.filter((rule) => rule.showHistory);
    expect(withHistory.map((rule) => rule.key)).toEqual(['dir']);
    expect(withHistory[0].showHistory).toBe(true);
  });

  it('uses pipe-separated canShow/canUpdate masks', () => {
    const split = ARIA2_TASK_OPTIONS.find((rule) => rule.key === 'dir');
    expect(split?.canUpdate).toBe('new');
    const tracker = ARIA2_TASK_OPTIONS.find((rule) => rule.key === 'bt-tracker');
    expect(tracker?.canUpdate).toBe('new|waiting|paused');
  });
});

describe('getTaskOptionKeys', () => {
  it('drops http rules for torrents', () => {
    const keys = getTaskOptionKeys('new', true).map((rule) => rule.key);
    expect(keys).not.toContain('header');
    expect(keys).not.toContain('checksum');
    expect(keys).toContain('seed-ratio');
    expect(keys).toContain('dir');
  });

  it('drops bittorrent rules for everything else', () => {
    const keys = getTaskOptionKeys('new', false).map((rule) => rule.key);
    expect(keys).not.toContain('seed-ratio');
    expect(keys).not.toContain('bt-max-peers');
    expect(keys).toContain('header');
    expect(keys).toContain('dir');
  });

  it('keeps media rules for both task kinds', () => {
    for (const isBittorrent of [true, false]) {
      const keys = getTaskOptionKeys('new', isBittorrent).map((rule) => rule.key);
      expect(keys, String(isBittorrent)).toEqual(
        expect.arrayContaining(['media', 'media-video', 'media-pause-after-probe']),
      );
    }
  });

  it('marks a rule read-only when canUpdate lacks the context', () => {
    const active = getTaskOptionKeys('active', false);
    const dir = active.find((rule) => rule.key === 'dir');
    expect(dir?.readonly).toBe(true);

    const torrent = getTaskOptionKeys('active', true);
    const peers = torrent.find((rule) => rule.key === 'bt-max-peers');
    expect(peers?.readonly).toBe(false);
  });

  it('resolves read-only exactly like the raw masks', () => {
    for (const context of CONTEXTS) {
      for (const isBittorrent of [true, false]) {
        for (const rule of getTaskOptionKeys(context, isBittorrent)) {
          const mask = rule.canUpdate === undefined ? null : String(rule.canUpdate).split('|');
          expect(rule.readonly, `${context} ${rule.key}`).toBe(
            mask === null ? false : !mask.includes(context),
          );
        }
      }
    }
  });

  it('hides rows whose canShow excludes the context', () => {
    const active = getTaskOptionKeys('active', false).map((rule) => rule.key);
    expect(active).not.toContain('allow-overwrite');
    expect(getTaskOptionKeys('new', false).map((rule) => rule.key)).toContain('allow-overwrite');
  });

  it('drops rules whose option aria2-next retired', () => {
    const keys = getTaskOptionKeys('new', false).map((rule) => rule.key);
    expect(keys).not.toContain('split');
    expect(keys).not.toContain('conditional-get');
    expect(keys).not.toContain('max-connection-per-server');
    expect(keys).toContain('stream-max-connections');
  });

  it('exposes the aria2-next task options', () => {
    const torrent = getTaskOptionKeys('waiting', true).map((rule) => rule.key);
    expect(torrent).toEqual(expect.arrayContaining(['select-file', 'pause-metadata']));
    const media = getTaskOptionKeys('paused', false).map((rule) => rule.key);
    expect(media).toEqual(
      expect.arrayContaining([
        'filename-hint',
        'filename-hint-source',
        'stream-max-connections',
        'stream-max-range-size',
        'media-format',
        'media-video',
        'media-audio',
        'media-subtitles',
        'media-record-time',
        'media-start-time',
        'media-end-time',
      ]),
    );
  });
});
