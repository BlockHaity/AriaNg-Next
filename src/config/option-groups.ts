/**
 * Settings navigation and per-task option rules.
 *
 * `ARIA2_GLOBAL_GROUPS` is a 1:1 port of AriaNg's `aria2GlobalAvailableOptions`
 * (eight arrays), extended with the two groups aria2-next adds — `ed2k` and
 * `media` — plus every new key mapped to the group it belongs to. The table is
 * exhaustive: each entry carries `category: '<route>'` in `aria2-options.ts`.
 *
 * `labelKey` values live under the `optionGroup.` i18n namespace, mirroring the
 * camelCase names AriaNg used for its own settings categories.
 */

import { getOptionMeta, isOptionRemoved } from '@/config/aria2-options';
import type { OptionGroupRoute, TaskOptionContext, TaskOptionRule } from '@/config/types';

/** One settings page: its i18n label and the option keys it renders. */
export interface GlobalOptionGroup {
  labelKey: string;
  keys: string[];
}


/** Every settings route, in navigation order. */
export const ARIA2_GLOBAL_GROUPS: Record<OptionGroupRoute, GlobalOptionGroup> = {
  /* AriaNg basicOptions + input-file and the CLI-only gid/show-files/help/version */
  'basic': {
    labelKey: 'optionGroup.basic',
    keys: [
      'dir', 'log', 'max-concurrent-downloads', 'check-integrity', 'continue', 'input-file', 'gid',
      'show-files', 'help', 'version',
    ],
  },
  /* everything shared by HTTP(S), FTP and SFTP transfers */
  'http-ftp-sftp': {
    labelKey: 'optionGroup.httpFtpSftp',
    keys: [
      'all-proxy', 'all-proxy-user', 'all-proxy-passwd', 'connect-timeout', 'dry-run',
      'lowest-speed-limit', 'max-connection-per-server', 'max-file-not-found', 'max-tries',
      'min-split-size', 'netrc-path', 'no-netrc', 'no-proxy', 'proxy-method', 'remote-time',
      'reuse-uri', 'retry-wait', 'server-stat-of', 'server-stat-timeout', 'split',
      'stream-piece-selector', 'timeout', 'uri-selector', 'checksum', 'out', 'filename-hint',
      'filename-hint-source', 'stream-max-connections', 'stream-max-range-size',
    ],
  },
  /* HTTP-only knobs (libcurl) */
  'http': {
    labelKey: 'optionGroup.http',
    keys: [
      'check-certificate', 'http-accept-gzip', 'http-auth-challenge', 'http-no-cache', 'http-user',
      'http-passwd', 'http-proxy', 'http-proxy-user', 'http-proxy-passwd', 'https-proxy',
      'https-proxy-user', 'https-proxy-passwd', 'referer', 'enable-http-keep-alive',
      'enable-http-pipelining', 'header', 'save-cookies', 'use-head', 'user-agent',
      'ca-certificate', 'certificate', 'private-key', 'load-cookies',
    ],
  },
  /* FTP is retired in aria2-next; SFTP replaces it */
  'ftp-sftp': {
    labelKey: 'optionGroup.ftpSftp',
    keys: [
      'ftp-user', 'ftp-passwd', 'ftp-pasv', 'ftp-proxy', 'ftp-proxy-user', 'ftp-proxy-passwd',
      'ftp-type', 'ftp-reuse-connection', 'ssh-host-key-md', 'sftp-user', 'sftp-passwd',
      'ssh-host-key-sha256',
    ],
  },
  /* libtorrent-rasterbar session settings + tracker/announce tuning */
  'bt': {
    labelKey: 'optionGroup.bt',
    keys: [
      'bt-detach-seed-only', 'bt-enable-hook-after-hash-check', 'bt-enable-lpd',
      'bt-exclude-tracker', 'bt-external-ip', 'bt-force-encryption', 'bt-hash-check-seed',
      'bt-load-saved-metadata', 'bt-max-open-files', 'bt-max-peers', 'bt-metadata-only',
      'bt-min-crypto-level', 'bt-prioritize-piece', 'bt-remove-unselected-file',
      'bt-require-crypto', 'bt-request-peer-speed-limit', 'bt-save-metadata', 'bt-seed-unverified',
      'bt-stop-timeout', 'bt-tracker', 'bt-tracker-connect-timeout', 'bt-tracker-interval',
      'bt-tracker-timeout', 'dht-file-path', 'dht-file-path6', 'dht-listen-port',
      'dht-message-timeout', 'enable-dht', 'enable-dht6', 'enable-peer-exchange', 'follow-torrent',
      // aria2-next moved DHT and LPD into its native BitTorrent stack; these five
      // are what that produced, and are absent from the aria2 manual (verified
      // against aria2-next 2.8.3 `getGlobalOption`).
      'bt-lpd-interface', 'dht-listen-addr', 'dht-listen-addr6', 'dht-entry-point', 'dht-entry-point6',
      'listen-port', 'max-overall-upload-limit', 'max-upload-limit', 'peer-id-prefix', 'peer-agent',
      'seed-ratio', 'seed-time', 'select-file', 'index-out', 'torrent-file', 'bt-interface',
      'bt-dht-bootstrap-nodes', 'bt-encryption', 'bt-transport', 'bt-external-port',
      'bt-io-threads', 'bt-hashing-threads', 'bt-connection-speed', 'bt-max-out-request-queue',
      'bt-max-in-request-queue', 'bt-disk-queue-size', 'bt-disk-io', 'bt-disk-read-cache',
      'bt-disk-write-cache', 'bt-checking-memory', 'bt-piece-extent-affinity', 'bt-peer-turnover',
      'bt-peer-turnover-cutoff', 'bt-peer-turnover-interval', 'bt-mixed-mode',
      'bt-upload-slot-algorithm', 'bt-seed-choking-algorithm', 'bt-send-buffer-low-watermark',
      'bt-send-buffer-watermark', 'bt-send-buffer-watermark-factor',
      'bt-seeding-outgoing-connections', 'bt-rate-limit-overhead', 'bt-stop-tracker-timeout',
      'bt-blocklist-scope', 'bt-resume-save-interval', 'bt-upload-suggestions',
      'bt-max-connections', 'bt-max-uploads', 'bt-max-uploads-per-torrent',
      'bt-first-last-piece-first', 'bt-file-priority', 'bt-super-seeding', 'bt-anonymous-mode',
      'bt-user-agent', 'bt-peer-id-prefix', 'bt-announce-all-tiers', 'bt-announce-all-trackers',
      'bt-max-concurrent-http-announces', 'bt-peer-blocklist', 'bt-port-mapping', 'bt-proxy',
      'bt-tracker-completion-timeout', 'bt-tracker-receive-timeout',
    ],
  },
  /* aria2-next native ED2K/eMule engine + P2P sharing */
  'ed2k': {
    labelKey: 'optionGroup.ed2k',
    keys: [
      'ed2k-server', 'ed2k-server-list', 'ed2k-node-list', 'ed2k-listen-port',
      'ed2k-udp-listen-port', 'ed2k-upload-slots', 'ed2k-max-connections', 'ed2k-min-split-size',
      'ed2k-piece-selector', 'ed2k-preview-priority', 'detach-share-only',
    ],
  },
  /* aria2-next native HLS/DASH media engine (not in the manual option list) */
  'media': {
    labelKey: 'optionGroup.media',
    keys: [
      'media', 'media-format', 'media-video', 'media-audio', 'media-subtitles',
      'media-pause-after-probe', 'media-request-contexts', 'media-record-time', 'media-start-time',
      'media-end-time', 'media-input',
    ],
  },
  /* metalink 3/4 parsing */
  'metalink': {
    labelKey: 'optionGroup.metalink',
    keys: [
      'follow-metalink', 'metalink-base-uri', 'metalink-language', 'metalink-location',
      'metalink-os', 'metalink-version', 'metalink-preferred-protocol',
      'metalink-enable-unique-protocol', 'metalink-file',
    ],
  },
  /* JSON-RPC/XML-RPC server */
  'rpc': {
    labelKey: 'optionGroup.rpc',
    keys: [
      'enable-rpc', 'pause-metadata', 'rpc-allow-origin-all', 'rpc-listen-all', 'rpc-listen-port',
      'rpc-max-request-size', 'rpc-save-upload-metadata', 'rpc-secure', 'pause', 'rpc-certificate',
      'rpc-private-key', 'rpc-secret',
    ],
  },
  /* engine, logging, event hooks and CLI-only switches */
  'advanced': {
    labelKey: 'optionGroup.advanced',
    keys: [
      'allow-overwrite', 'allow-piece-length-change', 'always-resume', 'async-dns',
      'auto-file-renaming', 'auto-save-interval', 'conditional-get', 'conf-path',
      'console-log-level', 'content-disposition-default-utf8', 'daemon', 'deferred-input',
      'disable-ipv6', 'disk-cache', 'download-result', 'dscp', 'rlimit-nofile', 'enable-color',
      'enable-mmap', 'event-poll', 'file-allocation', 'force-save', 'save-not-found',
      'hash-check-only', 'human-readable', 'keep-unfinished-download-result', 'max-download-result',
      'max-mmap-limit', 'max-resume-failure-tries', 'min-tls-version', 'log-level',
      'optimize-concurrent-downloads', 'piece-length', 'show-console-readout', 'summary-interval',
      'max-overall-download-limit', 'max-download-limit', 'no-conf', 'no-file-allocation-limit',
      'parameterized-uri', 'quiet', 'realtime-chunk-checksum', 'remove-control-file',
      'save-session', 'save-session-interval', 'socket-recv-buffer-size', 'stop',
      'truncate-console-readout', 'state-save-interval', 'state-dir', 'interface',
      'multiple-interface', 'log-max-size', 'log-max-files', 'on-bt-download-complete',
      'on-download-complete', 'on-download-error', 'on-download-pause', 'on-download-start',
      'on-download-stop', 'stderr', 'force-sequential', 'stop-with-process',
    ],
  },
};

/**
 * Options promoted to the global quick-settings bar.
 *
 * 1:1 with AriaNg's `aria2QuickSettingsAvailableOptions`.
 */
export const ARIA2_QUICK_SETTINGS: { globalSpeedLimit: string[] } = {
  globalSpeedLimit: ['max-overall-download-limit', 'max-overall-upload-limit'],
};

/**
 * Build an AriaNg `canShow`/`canUpdate` mask, e.g. `pipe('new', 'waiting')`.
 *
 * `TaskOptionRule` types those fields as `TaskOptionContext | \`${TaskOptionContext}\``,
 * which models concatenated values such as `'newactive'` but not the pipe-separated
 * masks AriaNg actually used. Keeping the join in one typed helper confines that
 * mismatch to a single assertion instead of casting 20 data rows.
 */
function pipe(...contexts: TaskOptionContext[]): TaskOptionRule['canShow'] {
  return contexts.join('|') as TaskOptionRule['canShow'];
}

/**
 * Per-task option rules, ported 1:1 from AriaNg's `aria2TaskAvailableOptions`
 * (`taskOptions`, 32 entries) and extended with the options aria2-next lets
 * `aria2.changeOption` write.
 *
 * - `category` decides whether the row applies to the task at hand:
 *   `'http'` rows are hidden for torrents, `'bittorrent'` rows for everything else.
 * - `canShow` restricts the task states the row appears in, `canUpdate` the states
 *   it stays writable in. `pipe('new', 'waiting')` is AriaNg's `'new|waiting'`.
 * - `showHistory` enables the per-option input history dropdown and is only
 *   meaningful for `string` rows — `dir` is the only one.
 *
 * Retired aria2 keys are kept verbatim so the rules stay a faithful port; they
 * are dropped at render time by {@link getTaskOptionKeys}.
 */
export const ARIA2_TASK_OPTIONS: TaskOptionRule[] = [
  { key: 'dir', category: 'global', canUpdate: 'new', showHistory: true },
  { key: 'out', category: 'http', canUpdate: 'new' },
  { key: 'allow-overwrite', category: 'global', canShow: 'new' },
  { key: 'max-download-limit', category: 'global' },
  { key: 'max-upload-limit', category: 'bittorrent' },
  { key: 'split', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'min-split-size', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'max-connection-per-server', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'lowest-speed-limit', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'stream-piece-selector', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'http-user', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'http-passwd', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'all-proxy', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'all-proxy-user', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'all-proxy-passwd', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'checksum', category: 'http' },
  { key: 'continue', category: 'http', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'referer', category: 'http', canUpdate: 'new' },
  { key: 'header', category: 'http', canUpdate: 'new' },
  { key: 'bt-max-peers', category: 'bittorrent' },
  { key: 'bt-request-peer-speed-limit', category: 'bittorrent' },
  { key: 'bt-remove-unselected-file', category: 'bittorrent' },
  { key: 'bt-stop-timeout', category: 'bittorrent', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'bt-tracker', category: 'bittorrent', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'seed-ratio', category: 'bittorrent', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'seed-time', category: 'bittorrent', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'pause-metadata', category: 'bittorrent', canUpdate: 'new' },
  { key: 'conditional-get', category: 'global', canShow: 'new' },
  { key: 'check-integrity', category: 'global' },
  { key: 'file-allocation', category: 'global', canShow: 'new' },
  { key: 'parameterized-uri', category: 'global', canShow: 'new' },
  { key: 'force-save', category: 'global' },
  /* ---- aria2-next additions ---- */
  { key: 'filename-hint', category: 'http', canUpdate: 'new' },
  { key: 'filename-hint-source', category: 'http', canUpdate: 'new' },
  { key: 'stream-max-connections', category: 'http' },
  { key: 'stream-max-range-size', category: 'http' },
  { key: 'select-file', category: 'bittorrent', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'bt-file-priority', category: 'bittorrent', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'media', category: 'media', canUpdate: 'new' },
  { key: 'media-format', category: 'media', canUpdate: 'new' },
  { key: 'media-video', category: 'media', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'media-audio', category: 'media', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'media-subtitles', category: 'media', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'media-pause-after-probe', category: 'media', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'media-record-time', category: 'media', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'media-start-time', category: 'media', canUpdate: pipe('new', 'waiting', 'paused') },
  { key: 'media-end-time', category: 'media', canUpdate: pipe('new', 'waiting', 'paused') },
];

/**
 * A task rule resolved against one task context: the read-only flag is folded
 * in because AriaNg stamped it onto the rule object at render time.
 */
export interface ResolvedTaskOptionRule extends TaskOptionRule {
  /** aria2 refuses `changeOption` for this key in the resolved context. */
  readonly: boolean;
}

/** Whether `context` is listed in a `canShow`/`canUpdate` mask (absent = all). */
function matchesContext(mask: string | undefined, context: TaskOptionContext): boolean {
  return mask === undefined || mask.split('|').includes(context);
}

/**
 * Option keys of one settings route, or `false` when the route is unknown —
 * AriaNg answered `Type is illegal!` in that case.
 *
 * Keys aria2-next retired are filtered out so the editor only offers rows the
 * engine honours; the renamed replacements stay.
 */
export function getGlobalOptionKeys(group: string): string[] | false {
  if (!Object.hasOwn(ARIA2_GLOBAL_GROUPS, group)) return false;
  const keys = (ARIA2_GLOBAL_GROUPS as Record<string, GlobalOptionGroup>)[group];
  return keys.keys.filter((key) => !isOptionRemoved(key));
}

/**
 * Task option rules that apply to `context`, with the read-only flag resolved.
 *
 * `'http'` rows are dropped for torrents and `'bittorrent'` rows for everything
 * else, matching AriaNg. A rule is read-only when `canUpdate` does not list the
 * current context.
 */
export function getTaskOptionKeys(
  context: TaskOptionContext,
  isBittorrent: boolean,
): ResolvedTaskOptionRule[] {
  return ARIA2_TASK_OPTIONS.filter((rule) => {
    if (!matchesContext(rule.canShow, context)) return false;
    if (rule.category === 'http' && isBittorrent) return false;
    if (rule.category === 'bittorrent' && !isBittorrent) return false;
    return getOptionMeta(rule.key)?.support !== 'removed';
  }).map((rule) => ({ ...rule, readonly: !matchesContext(rule.canUpdate, context) }));
}

/** Option keys of one quick-settings bar. */
export function getQuickSettingKeys(type: 'globalSpeedLimit'): string[] {
  return ARIA2_QUICK_SETTINGS[type];
}
