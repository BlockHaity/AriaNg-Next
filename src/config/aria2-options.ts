/**
 * The aria2 / aria2-next option catalogue.
 *
 * Three sources are merged here, in this order of authority:
 *
 * 1. `aria2-next(1)` — the aria2-next manual (`docs/manual/en/aria2-next.rst`),
 *    206 `.. option::` directives. Anything documented there is `support: 'current'`.
 * 2. `docs/media-downloads.md` — the eleven `media-*` options, which are RPC-settable
 *    but deliberately absent from the manual's option list.
 * 3. AriaNg's `aria2AllOptions` (162 entries), whose legacy metadata (types,
 *    suffixes, separators, `required`, `readonly`, `overrideMode`, `submitFormat`,
 *    `showCount`, `trimCount`, min/max and patterns) is carried over verbatim so
 *    the editor keeps rendering the rows it always rendered.
 *
 * `support` records aria2-next compatibility. The manual states that
 * "Retired aria2 option names are accepted at the command-line, configuration,
 * task-input, RPC, and libaria2 boundaries", so every retired name is marked
 * `'removed'`: the editor must never offer a name aria2-next no longer honours.
 * `aria2NextNote` says which way it went — "Renamed in aria2-next" for keys that
 * are normalized to a current equivalent, "Dropped in aria2-next" for keys whose
 * behaviour is owned or removed by a native engine.
 *
 * `since` is either a concrete aria2 version (AriaNg's values), `'aria2'` when
 * the manual does not state one, or `'aria2-next'` for options that only exist in
 * aria2-next — the tooltip reads "requires aria2-next" for those.
 *
 * `category` always equals the settings route the key is listed under in
 * `option-groups.ts`, so the two files cannot drift apart. The `file` and `hook`
 * members of `OptionCategory` are reserved for the task/file editors.
 */

import type { Aria2OptionMeta } from '@/config/types';

/**
 * `Aria2OptionMeta` plus AriaNg's `trimCount` flag.
 *
 * `trimCount` is part of AriaNg's `aria2AllOptions` contract — `header` carries
 * `showCount` + `trimCount` so the rendered list is capped.
 */
export type OptionMeta = Aria2OptionMeta;

/**
 * aria2 size syntax: a plain byte count with an optional case-insensitive K/M
 * suffix (1K = 1024, 1M = 1024K). Kept identical to AriaNg's pattern, so the
 * rows it guards validate exactly as they always did. aria2-next additionally
 * accepts fractional values (`1.5M`); that is a server-side tolerance, not a
 * client-side contract, so the stricter pattern stays.
 */
const BYTE_PATTERN = '^(0|[1-9]\\d*(K|k|M|m)?)$';

/**
 * Same, but aria2-next also documents a `G` suffix (for example
 * `--stream-max-range-size` up to 1G).
 */
const BYTE_PATTERN_G = '^(0|[1-9]\\d*(K|k|M|m|G|g)?)$';

/** Every option key known to AriaNg, ported and extended for aria2-next. */
export const ARIA2_ALL_OPTIONS: Record<string, OptionMeta> = {
  /* ------------------------------- Basic ------------------------------- */
  /** `--dir` */
  'dir': {
    key: 'dir',
    since: 'aria2',
    type: 'string',
    category: 'basic',
    required: true,
    support: 'current',
  },
  /** `--log` */
  'log': {
    key: 'log',
    since: 'aria2',
    type: 'string',
    category: 'basic',
    required: true,
    support: 'current',
  },
  /** `--max-concurrent-downloads` */
  'max-concurrent-downloads': {
    key: 'max-concurrent-downloads',
    since: 'aria2',
    type: 'integer',
    category: 'basic',
    defaultValue: '5',
    required: true,
    min: 1,
    support: 'current',
  },
  /** `--check-integrity` */
  'check-integrity': {
    key: 'check-integrity',
    since: 'aria2',
    type: 'boolean',
    category: 'basic',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--continue` */
  'continue': {
    key: 'continue',
    since: 'aria2',
    type: 'boolean',
    category: 'basic',
    required: true,
    support: 'current',
  },
  /**
   * `--input-file`
   * aria2-next: Startup-only input; not part of getGlobalOption.
   */
  'input-file': {
    key: 'input-file',
    since: 'aria2-next',
    type: 'string',
    category: 'basic',
    readonly: true,
    support: 'current',
    aria2NextNote: 'Startup-only input; not part of getGlobalOption.',
  },
  /** `--gid` */
  'gid': {
    key: 'gid',
    since: 'aria2',
    type: 'string',
    category: 'basic',
    readonly: true,
    required: true,
    support: 'current',
  },
  /** `--show-files` */
  'show-files': {
    key: 'show-files',
    since: 'aria2',
    type: 'boolean',
    category: 'basic',
    readonly: true,
    support: 'current',
  },
  /**
   * `--help`
   * aria2-next: Command-line only; not an RPC global option.
   */
  'help': {
    key: 'help',
    since: 'aria2-next',
    type: 'option',
    category: 'basic',
    defaultValue: '#basic',
    readonly: true,
    options: [
      '#basic', '#advanced', '#http', '#https', '#metalink', '#bittorrent', '#ed2k', '#cookie',
      '#hook', '#file', '#rpc', '#checksum', '#experimental', '#help', '#all',
    ],
    support: 'current',
    aria2NextNote: 'Command-line only; not an RPC global option.',
  },
  /**
   * `--version`
   * aria2-next: Command-line only; not an RPC global option.
   */
  'version': {
    key: 'version',
    since: 'aria2-next',
    type: 'boolean',
    category: 'basic',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
    aria2NextNote: 'Command-line only; not an RPC global option.',
  },
  /* ------------------------------- HTTP / FTP / SFTP shared ------------------------------- */
  /** `--all-proxy` */
  'all-proxy': {
    key: 'all-proxy',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    support: 'current',
  },
  /** `--all-proxy-user` */
  'all-proxy-user': {
    key: 'all-proxy-user',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    support: 'current',
  },
  /** `--all-proxy-passwd` */
  'all-proxy-passwd': {
    key: 'all-proxy-passwd',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    support: 'current',
  },
  /** `--connect-timeout` */
  'connect-timeout': {
    key: 'connect-timeout',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '60',
    required: true,
    suffix: 'Seconds',
    min: 1,
    max: 600,
    support: 'current',
  },
  /** `--dry-run` */
  'dry-run': {
    key: 'dry-run',
    since: 'aria2',
    type: 'boolean',
    category: 'http-ftp-sftp',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--lowest-speed-limit` */
  'lowest-speed-limit': {
    key: 'lowest-speed-limit',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    defaultValue: '0',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
  },
  /**
   * `--max-connection-per-server`
   * aria2-next: Renamed in aria2-next: normalized to --stream-max-connections (1-256).
   */
  'max-connection-per-server': {
    key: 'max-connection-per-server',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '1',
    required: true,
    min: 1,
    max: 16,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --stream-max-connections (1-256).',
  },
  /** `--max-file-not-found` */
  'max-file-not-found': {
    key: 'max-file-not-found',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '0',
    required: true,
    min: 0,
    support: 'current',
  },
  /** `--max-tries` */
  'max-tries': {
    key: 'max-tries',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '5',
    required: true,
    min: 0,
    support: 'current',
  },
  /**
   * `--min-split-size`
   * aria2-next: Renamed in aria2-next: normalized to --stream-max-range-size.
   */
  'min-split-size': {
    key: 'min-split-size',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    defaultValue: '20M',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --stream-max-range-size.',
  },
  /** `--netrc-path` */
  'netrc-path': {
    key: 'netrc-path',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    defaultValue: '$(HOME)/.netrc',
    readonly: true,
    support: 'current',
  },
  /** `--no-netrc` */
  'no-netrc': {
    key: 'no-netrc',
    since: 'aria2',
    type: 'boolean',
    category: 'http-ftp-sftp',
    required: true,
    support: 'current',
  },
  /**
   * `--no-proxy`
   * aria2-next: Host names are not resolved for comparison; the option only matches numeric IP
   * addresses.
   */
  'no-proxy': {
    key: 'no-proxy',
    since: 'aria2',
    type: 'text',
    category: 'http-ftp-sftp',
    separator: ',',
    showCount: true,
    support: 'current',
    aria2NextNote:
      'Host names are not resolved for comparison; the option only matches numeric IP addresses.',
  },
  /**
   * `--proxy-method`
   * aria2-next: Dropped in aria2-next: libcurl owns the HTTP method, so there is no proxy method
   * selector.
   */
  'proxy-method': {
    key: 'proxy-method',
    since: 'aria2',
    type: 'option',
    category: 'http-ftp-sftp',
    defaultValue: 'get',
    required: true,
    options: ['get', 'tunnel'],
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: libcurl owns the HTTP method, so there is no proxy method selector.',
  },
  /** `--remote-time` */
  'remote-time': {
    key: 'remote-time',
    since: 'aria2',
    type: 'boolean',
    category: 'http-ftp-sftp',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--reuse-uri`
   * aria2-next: Dropped in aria2-next: HTTP(S) connections are reused natively by libcurl without
   * an option.
   */
  'reuse-uri': {
    key: 'reuse-uri',
    since: 'aria2',
    type: 'boolean',
    category: 'http-ftp-sftp',
    defaultValue: 'true',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: HTTP(S) connections are reused natively by libcurl without an option.',
  },
  /** `--retry-wait` */
  'retry-wait': {
    key: 'retry-wait',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '0',
    required: true,
    suffix: 'Seconds',
    min: 0,
    max: 600,
    support: 'current',
  },
  /**
   * `--server-stat-of`
   * aria2-next: Dropped in aria2-next: the --server-stat feature is gone.
   */
  'server-stat-of': {
    key: 'server-stat-of',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: the --server-stat feature is gone.',
  },
  /**
   * `--server-stat-timeout`
   * aria2-next: Dropped in aria2-next: the --server-stat feature is gone.
   */
  'server-stat-timeout': {
    key: 'server-stat-timeout',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '86400',
    readonly: true,
    suffix: 'Seconds',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: the --server-stat feature is gone.',
  },
  /**
   * `--split`
   * aria2-next: Dropped in aria2-next: concurrency is derived from --stream-max-connections, there
   * is no fixed split count.
   */
  'split': {
    key: 'split',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '5',
    required: true,
    min: 1,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: concurrency is derived from --stream-max-connections, there is no fixed split count.',
  },
  /**
   * `--stream-piece-selector`
   * aria2-next: Dropped in aria2-next: piece selection is owned by libtorrent (rarest-first);
   * --force-sequential switches to sequential mode.
   */
  'stream-piece-selector': {
    key: 'stream-piece-selector',
    since: 'aria2',
    type: 'option',
    category: 'http-ftp-sftp',
    defaultValue: 'default',
    required: true,
    options: ['default', 'inorder', 'random', 'geom'],
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: piece selection is owned by libtorrent (rarest-first); --force-sequential switches to sequential mode.',
  },
  /** `--timeout` */
  'timeout': {
    key: 'timeout',
    since: 'aria2',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '60',
    required: true,
    suffix: 'Seconds',
    min: 1,
    max: 600,
    support: 'current',
  },
  /**
   * `--uri-selector`
   * aria2-next: Dropped in aria2-next: mirror selection is internal to the libcurl HTTP engine.
   */
  'uri-selector': {
    key: 'uri-selector',
    since: 'aria2',
    type: 'option',
    category: 'http-ftp-sftp',
    defaultValue: 'feedback',
    required: true,
    options: ['inorder', 'feedback', 'adaptive'],
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: mirror selection is internal to the libcurl HTTP engine.',
  },
  /** `--checksum` */
  'checksum': {
    key: 'checksum',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    required: true,
    pattern: '^(md5|sha-(1|224|256|384|512))=[a-zA-Z0-9]+$',
    support: 'current',
  },
  /** `--out` */
  'out': {
    key: 'out',
    since: 'aria2',
    type: 'string',
    category: 'http-ftp-sftp',
    support: 'current',
  },
  /**
   * `--filename-hint`
   * aria2-next: A decoded filename *hint*, not an output path; Content-Disposition wins for HTTP
   * and --out takes precedence.
   */
  'filename-hint': {
    key: 'filename-hint',
    since: 'aria2-next',
    type: 'string',
    category: 'http-ftp-sftp',
    required: true,
    support: 'current',
    aria2NextNote:
      'A decoded filename *hint*, not an output path; Content-Disposition wins for HTTP and --out takes precedence.',
  },
  /**
   * `--filename-hint-source`
   * aria2-next: ``browser`` resolves names ahead of Content-Disposition; ``title`` preserves dots
   * and appends the selected container extension.
   */
  'filename-hint-source': {
    key: 'filename-hint-source',
    since: 'aria2-next',
    type: 'option',
    category: 'http-ftp-sftp',
    defaultValue: 'suggested',
    required: true,
    options: ['suggested', 'browser', 'title'],
    support: 'current',
    aria2NextNote:
      '``browser`` resolves names ahead of Content-Disposition; ``title`` preserves dots and appends the selected container extension.',
  },
  /**
   * `--stream-max-connections`
   * aria2-next: Replaces --max-connection-per-server/--split. aria2-next lowers the effective count
   * for small files or servers that ignore Range; SFTP stays single-stream.
   */
  'stream-max-connections': {
    key: 'stream-max-connections',
    since: 'aria2-next',
    type: 'integer',
    category: 'http-ftp-sftp',
    defaultValue: '6',
    required: true,
    min: 1,
    max: 256,
    support: 'current',
    aria2NextNote:
      'Replaces --max-connection-per-server/--split. aria2-next lowers the effective count for small files or servers that ignore Range; SFTP stays single-stream.',
  },
  /**
   * `--stream-max-range-size`
   * aria2-next: Replaces --min-split-size. Accepts bytes or a K/M/G suffix up to 1G; 0 leaves range
   * sizing automatic.
   */
  'stream-max-range-size': {
    key: 'stream-max-range-size',
    since: 'aria2-next',
    type: 'string',
    category: 'http-ftp-sftp',
    defaultValue: '0',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN_G,
    support: 'current',
    aria2NextNote:
      'Replaces --min-split-size. Accepts bytes or a K/M/G suffix up to 1G; 0 leaves range sizing automatic.',
  },
  /* ------------------------------- HTTP specific ------------------------------- */
  /**
   * `--check-certificate`
   * aria2-next: aria2-next lets the RPC server change this at runtime; AriaNg still rendered it
   * read-only.
   */
  'check-certificate': {
    key: 'check-certificate',
    since: 'aria2',
    type: 'boolean',
    category: 'http',
    defaultValue: 'true',
    readonly: true,
    support: 'current',
    aria2NextNote:
      'aria2-next lets the RPC server change this at runtime; AriaNg still rendered it read-only.',
  },
  /** `--http-accept-gzip` */
  'http-accept-gzip': {
    key: 'http-accept-gzip',
    since: 'aria2',
    type: 'boolean',
    category: 'http',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--http-auth-challenge`
   * aria2-next: Dropped in aria2-next: libcurl handles HTTP auth challenges natively.
   */
  'http-auth-challenge': {
    key: 'http-auth-challenge',
    since: 'aria2',
    type: 'boolean',
    category: 'http',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: libcurl handles HTTP auth challenges natively.',
  },
  /** `--http-no-cache` */
  'http-no-cache': {
    key: 'http-no-cache',
    since: 'aria2',
    type: 'boolean',
    category: 'http',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--http-user` */
  'http-user': {
    key: 'http-user',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--http-passwd` */
  'http-passwd': {
    key: 'http-passwd',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--http-proxy` */
  'http-proxy': {
    key: 'http-proxy',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--http-proxy-user` */
  'http-proxy-user': {
    key: 'http-proxy-user',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--http-proxy-passwd` */
  'http-proxy-passwd': {
    key: 'http-proxy-passwd',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--https-proxy` */
  'https-proxy': {
    key: 'https-proxy',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--https-proxy-user` */
  'https-proxy-user': {
    key: 'https-proxy-user',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--https-proxy-passwd` */
  'https-proxy-passwd': {
    key: 'https-proxy-passwd',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--referer` */
  'referer': {
    key: 'referer',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /** `--enable-http-keep-alive` */
  'enable-http-keep-alive': {
    key: 'enable-http-keep-alive',
    since: 'aria2',
    type: 'boolean',
    category: 'http',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /**
   * `--enable-http-pipelining`
   * aria2-next: Dropped in aria2-next: HTTP/2 stream multiplexing through --stream-max-connections
   * replaces it.
   */
  'enable-http-pipelining': {
    key: 'enable-http-pipelining',
    since: 'aria2',
    type: 'boolean',
    category: 'http',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: HTTP/2 stream multiplexing through --stream-max-connections replaces it.',
  },
  /**
   * `--header`
   * aria2-next: applies to the source origin only for media tasks.
   */
  'header': {
    key: 'header',
    since: 'aria2',
    type: 'text',
    category: 'http',
    separator: '\n',
    overrideMode: 'append',
    submitFormat: 'array',
    showCount: true,
    trimCount: true,
    support: 'current',
    aria2NextNote: 'applies to the source origin only for media tasks.',
  },
  /** `--save-cookies` */
  'save-cookies': {
    key: 'save-cookies',
    since: 'aria2',
    type: 'string',
    category: 'http',
    support: 'current',
  },
  /**
   * `--use-head`
   * aria2-next: Dropped in aria2-next: HEAD requests are an internal optimisation and --dry-run
   * covers availability checks.
   */
  'use-head': {
    key: 'use-head',
    since: 'aria2',
    type: 'boolean',
    category: 'http',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: HEAD requests are an internal optimisation and --dry-run covers availability checks.',
  },
  /** `--user-agent` */
  'user-agent': {
    key: 'user-agent',
    since: 'aria2',
    type: 'string',
    category: 'http',
    defaultValue: 'aria2-next/$VERSION',
    support: 'current',
  },
  /**
   * `--ca-certificate`
   * aria2-next: PEM bundle; without it libcurl uses the platform trust configuration.
   */
  'ca-certificate': {
    key: 'ca-certificate',
    since: 'aria2-next',
    type: 'string',
    category: 'http',
    support: 'current',
    aria2NextNote: 'PEM bundle; without it libcurl uses the platform trust configuration.',
  },
  /**
   * `--certificate`
   * aria2-next: PKCS12 (.p12/.pfx) or PEM; PEM also needs --private-key.
   */
  'certificate': {
    key: 'certificate',
    since: 'aria2-next',
    type: 'string',
    category: 'http',
    support: 'current',
    aria2NextNote: 'PKCS12 (.p12/.pfx) or PEM; PEM also needs --private-key.',
  },
  /**
   * `--private-key`
   * aria2-next: Must be a decrypted PEM key; pairs with --certificate.
   */
  'private-key': {
    key: 'private-key',
    since: 'aria2-next',
    type: 'string',
    category: 'http',
    support: 'current',
    aria2NextNote: 'Must be a decrypted PEM key; pairs with --certificate.',
  },
  /**
   * `--load-cookies`
   * aria2-next: Netscape-format cookie file loaded through libcurl.
   */
  'load-cookies': {
    key: 'load-cookies',
    since: 'aria2-next',
    type: 'string',
    category: 'http',
    support: 'current',
    aria2NextNote: 'Netscape-format cookie file loaded through libcurl.',
  },
  /* ------------------------------- FTP (removed) and SFTP ------------------------------- */
  /**
   * `--ftp-user`
   * aria2-next: Dropped in aria2-next: FTP was removed, only SFTP remains. Use --sftp-user.
   */
  'ftp-user': {
    key: 'ftp-user',
    since: 'aria2',
    type: 'string',
    category: 'ftp-sftp',
    defaultValue: 'anonymous',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: FTP was removed, only SFTP remains. Use --sftp-user.',
  },
  /**
   * `--ftp-passwd`
   * aria2-next: Dropped in aria2-next: FTP was removed, only SFTP remains. Use --sftp-passwd.
   */
  'ftp-passwd': {
    key: 'ftp-passwd',
    since: 'aria2',
    type: 'string',
    category: 'ftp-sftp',
    defaultValue: 'ARIA2USER@',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: FTP was removed, only SFTP remains. Use --sftp-passwd.',
  },
  /**
   * `--ftp-pasv`
   * aria2-next: Dropped in aria2-next: FTP was removed and SFTP has no passive mode.
   */
  'ftp-pasv': {
    key: 'ftp-pasv',
    since: 'aria2',
    type: 'boolean',
    category: 'ftp-sftp',
    defaultValue: 'true',
    required: true,
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: FTP was removed and SFTP has no passive mode.',
  },
  /**
   * `--ftp-proxy`
   * aria2-next: Dropped in aria2-next: FTP was removed; route SFTP through --all-proxy.
   */
  'ftp-proxy': {
    key: 'ftp-proxy',
    since: 'aria2',
    type: 'string',
    category: 'ftp-sftp',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: FTP was removed; route SFTP through --all-proxy.',
  },
  /**
   * `--ftp-proxy-user`
   * aria2-next: Dropped in aria2-next: FTP was removed.
   */
  'ftp-proxy-user': {
    key: 'ftp-proxy-user',
    since: 'aria2',
    type: 'string',
    category: 'ftp-sftp',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: FTP was removed.',
  },
  /**
   * `--ftp-proxy-passwd`
   * aria2-next: Dropped in aria2-next: FTP was removed.
   */
  'ftp-proxy-passwd': {
    key: 'ftp-proxy-passwd',
    since: 'aria2',
    type: 'string',
    category: 'ftp-sftp',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: FTP was removed.',
  },
  /**
   * `--ftp-type`
   * aria2-next: Dropped in aria2-next: FTP was removed and SFTP is always binary.
   */
  'ftp-type': {
    key: 'ftp-type',
    since: 'aria2',
    type: 'option',
    category: 'ftp-sftp',
    defaultValue: 'binary',
    required: true,
    options: ['binary', 'ascii'],
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: FTP was removed and SFTP is always binary.',
  },
  /**
   * `--ftp-reuse-connection`
   * aria2-next: Dropped in aria2-next: FTP was removed and SFTP connections are reused natively.
   */
  'ftp-reuse-connection': {
    key: 'ftp-reuse-connection',
    since: 'aria2',
    type: 'boolean',
    category: 'ftp-sftp',
    defaultValue: 'true',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: FTP was removed and SFTP connections are reused natively.',
  },
  /**
   * `--ssh-host-key-md`
   * aria2-next: Renamed in aria2-next: normalized to --ssh-host-key-sha256.
   */
  'ssh-host-key-md': {
    key: 'ssh-host-key-md',
    since: 'aria2',
    type: 'string',
    category: 'ftp-sftp',
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --ssh-host-key-sha256.',
  },
  /**
   * `--sftp-user`
   * aria2-next: FTP support was removed from aria2-next; SFTP is the only remote filesystem.
   */
  'sftp-user': {
    key: 'sftp-user',
    since: 'aria2-next',
    type: 'string',
    category: 'ftp-sftp',
    support: 'current',
    aria2NextNote: 'FTP support was removed from aria2-next; SFTP is the only remote filesystem.',
  },
  /**
   * `--sftp-passwd`
   * aria2-next: FTP support was removed from aria2-next; SFTP is the only remote filesystem.
   */
  'sftp-passwd': {
    key: 'sftp-passwd',
    since: 'aria2-next',
    type: 'string',
    category: 'ftp-sftp',
    support: 'current',
    aria2NextNote: 'FTP support was removed from aria2-next; SFTP is the only remote filesystem.',
  },
  /**
   * `--ssh-host-key-sha256`
   * aria2-next: Replaces --ssh-host-key-md; validates the SFTP host key through the libcurl SHA-256
   * contract.
   */
  'ssh-host-key-sha256': {
    key: 'ssh-host-key-sha256',
    since: 'aria2-next',
    type: 'string',
    category: 'ftp-sftp',
    support: 'current',
    aria2NextNote:
      'Replaces --ssh-host-key-md; validates the SFTP host key through the libcurl SHA-256 contract.',
  },
  /* ------------------------------- BitTorrent ------------------------------- */
  /**
   * `--bt-detach-seed-only`
   * aria2-next: Renamed in aria2-next: normalized to --detach-share-only.
   */
  'bt-detach-seed-only': {
    key: 'bt-detach-seed-only',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    readonly: true,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --detach-share-only.',
  },
  /**
   * `--bt-enable-hook-after-hash-check`
   * aria2-next: Dropped in aria2-next: hash checking runs on the native libtorrent checking queue,
   * so no per-task hook gate remains.
   */
  'bt-enable-hook-after-hash-check': {
    key: 'bt-enable-hook-after-hash-check',
    since: '1.19.3',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: hash checking runs on the native libtorrent checking queue, so no per-task hook gate remains.',
  },
  /**
   * `--bt-enable-lpd`
   * aria2-next: aria2-next enables Local Peer Discovery by default.
   */
  'bt-enable-lpd': {
    key: 'bt-enable-lpd',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    support: 'current',
    aria2NextNote: 'aria2-next enables Local Peer Discovery by default.',
  },
  /** `--bt-exclude-tracker` */
  'bt-exclude-tracker': {
    key: 'bt-exclude-tracker',
    since: 'aria2',
    type: 'text',
    category: 'bt',
    separator: ',',
    showCount: true,
    support: 'current',
  },
  /** `--bt-external-ip` */
  'bt-external-ip': {
    key: 'bt-external-ip',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    support: 'current',
  },
  /**
   * `--bt-force-encryption`
   * aria2-next: Renamed in aria2-next: normalized to --bt-encryption=required.
   */
  'bt-force-encryption': {
    key: 'bt-force-encryption',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --bt-encryption=required.',
  },
  /**
   * `--bt-hash-check-seed`
   * aria2-next: Dropped in aria2-next: verification is owned by the native checking queue; use
   * --bt-seed-unverified to skip it.
   */
  'bt-hash-check-seed': {
    key: 'bt-hash-check-seed',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: verification is owned by the native checking queue; use --bt-seed-unverified to skip it.',
  },
  /**
   * `--bt-load-saved-metadata`
   * aria2-next: Dropped in aria2-next: uploaded torrent metadata is stored by the engine under
   * --state-dir/bittorrent.
   */
  'bt-load-saved-metadata': {
    key: 'bt-load-saved-metadata',
    since: '1.33.0',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: uploaded torrent metadata is stored by the engine under --state-dir/bittorrent.',
  },
  /** `--bt-max-open-files` */
  'bt-max-open-files': {
    key: 'bt-max-open-files',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '100',
    required: true,
    min: 1,
    support: 'current',
  },
  /**
   * `--bt-max-peers`
   * aria2-next: The aria2-next per-torrent peer limit defaults to 100; the session-wide limit is
   * --bt-max-connections.
   */
  'bt-max-peers': {
    key: 'bt-max-peers',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '100',
    required: true,
    min: 0,
    support: 'current',
    aria2NextNote:
      'The aria2-next per-torrent peer limit defaults to 100; the session-wide limit is --bt-max-connections.',
  },
  /**
   * `--bt-metadata-only`
   * aria2-next: Replaced in aria2-next by --pause-metadata, which pauses the same GID awaiting
   * --select-file.
   */
  'bt-metadata-only': {
    key: 'bt-metadata-only',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Replaced in aria2-next by --pause-metadata, which pauses the same GID awaiting --select-file.',
  },
  /**
   * `--bt-min-crypto-level`
   * aria2-next: Renamed in aria2-next: normalized to --bt-encryption, where encrypted handshakes
   * negotiate plain or RC4 payloads.
   */
  'bt-min-crypto-level': {
    key: 'bt-min-crypto-level',
    since: 'aria2',
    type: 'option',
    category: 'bt',
    defaultValue: 'plain',
    required: true,
    options: ['plain', 'arc4'],
    support: 'removed',
    aria2NextNote:
      'Renamed in aria2-next: normalized to --bt-encryption, where encrypted handshakes negotiate plain or RC4 payloads.',
  },
  /**
   * `--bt-prioritize-piece`
   * aria2-next: Replaced in aria2-next by --bt-first-last-piece-first; rarest-first selection is
   * native.
   */
  'bt-prioritize-piece': {
    key: 'bt-prioritize-piece',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    support: 'removed',
    aria2NextNote:
      'Replaced in aria2-next by --bt-first-last-piece-first; rarest-first selection is native.',
  },
  /**
   * `--bt-remove-unselected-file`
   * aria2-next: Dropped in aria2-next: unselected files are removed with the task, there is no
   * per-task switch.
   */
  'bt-remove-unselected-file': {
    key: 'bt-remove-unselected-file',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: unselected files are removed with the task, there is no per-task switch.',
  },
  /**
   * `--bt-require-crypto`
   * aria2-next: Renamed in aria2-next: normalized to --bt-encryption=required.
   */
  'bt-require-crypto': {
    key: 'bt-require-crypto',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --bt-encryption=required.',
  },
  /**
   * `--bt-request-peer-speed-limit`
   * aria2-next: Dropped in aria2-next: rate limiting is native; use --max-upload-limit /
   * --max-download-limit.
   */
  'bt-request-peer-speed-limit': {
    key: 'bt-request-peer-speed-limit',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    defaultValue: '50K',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: rate limiting is native; use --max-upload-limit / --max-download-limit.',
  },
  /**
   * `--bt-save-metadata`
   * aria2-next: Dropped in aria2-next: metadata persistence is owned by --state-dir and
   * --rpc-save-upload-metadata.
   */
  'bt-save-metadata': {
    key: 'bt-save-metadata',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: metadata persistence is owned by --state-dir and --rpc-save-upload-metadata.',
  },
  /** `--bt-seed-unverified` */
  'bt-seed-unverified': {
    key: 'bt-seed-unverified',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--bt-stop-timeout`
   * aria2-next: Dropped in aria2-next: stopping a stalled swarm is no longer configurable.
   */
  'bt-stop-timeout': {
    key: 'bt-stop-timeout',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '0',
    required: true,
    suffix: 'Seconds',
    min: 0,
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: stopping a stalled swarm is no longer configurable.',
  },
  /** `--bt-tracker` */
  'bt-tracker': {
    key: 'bt-tracker',
    since: 'aria2',
    type: 'text',
    category: 'bt',
    separator: ',',
    showCount: true,
    support: 'current',
  },
  /**
   * `--bt-tracker-connect-timeout`
   * aria2-next: Renamed in aria2-next: normalized to --bt-tracker-receive-timeout.
   */
  'bt-tracker-connect-timeout': {
    key: 'bt-tracker-connect-timeout',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '60',
    required: true,
    suffix: 'Seconds',
    min: 1,
    max: 600,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --bt-tracker-receive-timeout.',
  },
  /**
   * `--bt-tracker-interval`
   * aria2-next: Dropped in aria2-next: tracker announce scheduling is native;
   * --bt-stop-tracker-timeout only covers shutdown announces.
   */
  'bt-tracker-interval': {
    key: 'bt-tracker-interval',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '0',
    required: true,
    suffix: 'Seconds',
    min: 0,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: tracker announce scheduling is native; --bt-stop-tracker-timeout only covers shutdown announces.',
  },
  /**
   * `--bt-tracker-timeout`
   * aria2-next: Renamed in aria2-next: normalized to --bt-tracker-completion-timeout.
   */
  'bt-tracker-timeout': {
    key: 'bt-tracker-timeout',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '60',
    required: true,
    suffix: 'Seconds',
    min: 1,
    max: 600,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --bt-tracker-completion-timeout.',
  },
  /**
   * `--dht-file-path`
   * aria2-next: Dropped in aria2-next: the native libtorrent routing table is restored from
   * --state-dir/bittorrent.
   */
  'dht-file-path': {
    key: 'dht-file-path',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    defaultValue: '$HOME/.aria2/dht.dat',
    readonly: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: the native libtorrent routing table is restored from --state-dir/bittorrent.',
  },
  /**
   * `--dht-file-path6`
   * aria2-next: Dropped in aria2-next: IPv6 DHT shares the native routing table with IPv4.
   */
  'dht-file-path6': {
    key: 'dht-file-path6',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    defaultValue: '$HOME/.aria2/dht6.dat',
    readonly: true,
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: IPv6 DHT shares the native routing table with IPv4.',
  },
  /**
   * `--bt-lpd-interface`
   *
   * aria2-next: Local Peer Discovery listen interface. Reported by the live daemon
   * (aria2-next 2.8.3 `getGlobalOption`) but missing from this catalogue, so the
   * option was invisible in the UI.
   */
  'bt-lpd-interface': {
    key: 'bt-lpd-interface',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '',
    support: 'deprecated',
    aria2NextNote: 'Legacy conf alias for --bt-interface. Not rendered; configure --bt-interface instead.'
  },
  /**
   * `--dht-listen-addr`
   *
   * aria2-next: The per-address DHT listen socket. aria2-next retired
   * `--dht-listen-port` because DHT now shares the BitTorrent listener, and this
   * is what replaced it.
   */
  'dht-listen-addr': {
    key: 'dht-listen-addr',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '',
    support: 'deprecated',
    aria2NextNote: 'Legacy conf alias for --bt-interface. Not rendered; configure --bt-interface instead.'
  },
  /**
   * `--dht-listen-addr6`
   *
   * aria2-next: The IPv6 counterpart of `dht-listen-addr`.
   */
  'dht-listen-addr6': {
    key: 'dht-listen-addr6',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '',
    support: 'deprecated',
    aria2NextNote: 'Legacy conf alias for --bt-interface. Not rendered; configure --bt-interface instead.'
  },
  /**
   * `--dht-entry-point`
   *
   * aria2-next: Bootstrap nodes for the native DHT stack. This is where aria2-next
   * moved the node list that upstream aria2 read from `dht-file-path`.
   */
  'dht-entry-point': {
    key: 'dht-entry-point',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    separator: ',',
    defaultValue: 'dht.libtorrent.org:25401,dht.transmissionbt.com:6881,router.bt.ouinet.work:6881',
    support: 'deprecated',
    aria2NextNote: 'Legacy conf alias for --bt-dht-bootstrap-nodes. Not rendered; configure --bt-dht-bootstrap-nodes instead.'
  },
  /**
   * `--dht-entry-point6`
   *
   * aria2-next: The IPv6 counterpart of `dht-entry-point`.
   */
  'dht-entry-point6': {
    key: 'dht-entry-point6',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    separator: ',',
    defaultValue: 'dht.libtorrent.org:25401,dht.transmissionbt.com:6881,router.bt.ouinet.work:6881',
    support: 'deprecated',
    aria2NextNote: 'Legacy conf alias for --bt-dht-bootstrap-nodes. Not rendered; configure --bt-dht-bootstrap-nodes instead.'
  },
  /**
   * `--dht-listen-port`
   * aria2-next: Dropped in aria2-next: DHT shares --listen-port with the rest of the BitTorrent
   * listener.
   */
  'dht-listen-port': {
    key: 'dht-listen-port',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    defaultValue: '6881-6999',
    readonly: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: DHT shares --listen-port with the rest of the BitTorrent listener.',
  },
  /**
   * `--dht-message-timeout`
   * aria2-next: Dropped in aria2-next: DHT timing is native.
   */
  'dht-message-timeout': {
    key: 'dht-message-timeout',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '10',
    readonly: true,
    suffix: 'Seconds',
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: DHT timing is native.',
  },
  /** `--enable-dht` */
  'enable-dht': {
    key: 'enable-dht',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    readonly: true,
    support: 'current',
  },
  /**
   * `--enable-dht6`
   * aria2-next: Dropped in aria2-next: --enable-dht covers both IPv4 and IPv6 DHT.
   */
  'enable-dht6': {
    key: 'enable-dht6',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    readonly: true,
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: --enable-dht covers both IPv4 and IPv6 DHT.',
  },
  /** `--enable-peer-exchange` */
  'enable-peer-exchange': {
    key: 'enable-peer-exchange',
    since: 'aria2',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /**
   * `--follow-torrent`
   * aria2-next: libtorrent owns the torrent session, so a downloaded .torrent file is always parsed
   * unless ``false``.
   */
  'follow-torrent': {
    key: 'follow-torrent',
    since: 'aria2',
    type: 'option',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    options: ['true', 'false', 'mem'],
    support: 'current',
    aria2NextNote:
      'libtorrent owns the torrent session, so a downloaded .torrent file is always parsed unless ``false``.',
  },
  /**
   * `--listen-port`
   * aria2-next: aria2-next binds a single dual-stack port; the aria2 port range (6881-6999) is
   * gone. Announce a different port with --bt-external-port.
   */
  'listen-port': {
    key: 'listen-port',
    since: 'aria2',
    type: 'integer',
    category: 'bt',
    defaultValue: '6881',
    readonly: true,
    min: 1024,
    max: 65535,
    support: 'current',
    aria2NextNote:
      'aria2-next binds a single dual-stack port; the aria2 port range (6881-6999) is gone. Announce a different port with --bt-external-port.',
  },
  /** `--max-overall-upload-limit` */
  'max-overall-upload-limit': {
    key: 'max-overall-upload-limit',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    defaultValue: '0',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
  },
  /** `--max-upload-limit` */
  'max-upload-limit': {
    key: 'max-upload-limit',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    defaultValue: '0',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
  },
  /**
   * `--peer-id-prefix`
   * aria2-next: Renamed in aria2-next: normalized to --bt-peer-id-prefix.
   */
  'peer-id-prefix': {
    key: 'peer-id-prefix',
    since: 'aria2',
    type: 'string',
    category: 'bt',
    defaultValue: 'A2-$MAJOR-$MINOR-$PATCH-',
    readonly: true,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --bt-peer-id-prefix.',
  },
  /**
   * `--peer-agent`
   * aria2-next: Renamed in aria2-next: normalized to --bt-user-agent.
   */
  'peer-agent': {
    key: 'peer-agent',
    since: '1.33.0',
    type: 'string',
    category: 'bt',
    defaultValue: 'aria2/$MAJOR.$MINOR.$PATCH',
    readonly: true,
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --bt-user-agent.',
  },
  /** `--seed-ratio` */
  'seed-ratio': {
    key: 'seed-ratio',
    since: 'aria2',
    type: 'float',
    category: 'bt',
    defaultValue: '1.0',
    required: true,
    min: 0,
    support: 'current',
  },
  /** `--seed-time` */
  'seed-time': {
    key: 'seed-time',
    since: 'aria2',
    type: 'float',
    category: 'bt',
    required: true,
    suffix: 'Minutes',
    min: 0,
    support: 'current',
  },
  /**
   * `--select-file`
   * aria2-next: One-based indices; ``,`` separates entries and ``-`` builds a range (e.g.
   * ``1-5,8,9``). Task option.
   */
  'select-file': {
    key: 'select-file',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    required: true,
    pattern: '^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$',
    support: 'current',
    aria2NextNote:
      'One-based indices; ``,`` separates entries and ``-`` builds a range (e.g. ``1-5,8,9``). Task option.',
  },
  /**
   * `--index-out`
   * aria2-next: ``INDEX=PATH`` relative to --dir; repeatable, BitTorrent task-creation only.
   */
  'index-out': {
    key: 'index-out',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    readonly: true,
    support: 'current',
    aria2NextNote: '``INDEX=PATH`` relative to --dir; repeatable, BitTorrent task-creation only.',
  },
  /**
   * `--torrent-file`
   * aria2-next: Local .torrent path; task-creation only.
   */
  'torrent-file': {
    key: 'torrent-file',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    readonly: true,
    support: 'current',
    aria2NextNote: 'Local .torrent path; task-creation only.',
  },
  /**
   * `--bt-interface`
   * aria2-next: Bind name or numeric address of every libtorrent socket; independent of
   * --interface/--multiple-interface.
   */
  'bt-interface': {
    key: 'bt-interface',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    support: 'current',
    aria2NextNote:
      'Bind name or numeric address of every libtorrent socket; independent of --interface/--multiple-interface.',
  },
  /**
   * `--bt-dht-bootstrap-nodes`
   * aria2-next: Comma-separated HOST:PORT list used only when no routing nodes are saved.
   */
  'bt-dht-bootstrap-nodes': {
    key: 'bt-dht-bootstrap-nodes',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: 'dht.libtorrent.org:25401,dht.transmissionbt.com:6881,router.bt.ouinet.work:6881',
    required: true,
    support: 'current',
    aria2NextNote: 'Comma-separated HOST:PORT list used only when no routing nodes are saved.',
  },
  /**
   * `--bt-encryption`
   * aria2-next: Replaces --bt-require-crypto and --bt-min-crypto-level.
   */
  'bt-encryption': {
    key: 'bt-encryption',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'preferred',
    required: true,
    options: ['preferred', 'required', 'disabled'],
    support: 'current',
    aria2NextNote: 'Replaces --bt-require-crypto and --bt-min-crypto-level.',
  },
  /** `--bt-transport` */
  'bt-transport': {
    key: 'bt-transport',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'both',
    required: true,
    options: ['tcp', 'utp', 'both'],
    support: 'current',
  },
  /**
   * `--bt-external-port`
   * aria2-next: 0 announces --listen-port; a nonzero value only changes the announced port.
   */
  'bt-external-port': {
    key: 'bt-external-port',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '0',
    required: true,
    min: 0,
    max: 65535,
    support: 'current',
    aria2NextNote: '0 announces --listen-port; a nonzero value only changes the announced port.',
  },
  /** `--bt-io-threads` */
  'bt-io-threads': {
    key: 'bt-io-threads',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '10',
    required: true,
    min: 0,
    support: 'current',
  },
  /**
   * `--bt-hashing-threads`
   * aria2-next: Additional threads for complete rechecks; download-time hashing stays in the I/O
   * pool.
   */
  'bt-hashing-threads': {
    key: 'bt-hashing-threads',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '1',
    required: true,
    min: 0,
    support: 'current',
    aria2NextNote:
      'Additional threads for complete rechecks; download-time hashing stays in the I/O pool.',
  },
  /**
   * `--bt-connection-speed`
   * aria2-next: Outgoing peer connection attempts per second; 0 disables outgoing peer connections.
   */
  'bt-connection-speed': {
    key: 'bt-connection-speed',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '30',
    required: true,
    min: 0,
    support: 'current',
    aria2NextNote:
      'Outgoing peer connection attempts per second; 0 disables outgoing peer connections.',
  },
  /** `--bt-max-out-request-queue` */
  'bt-max-out-request-queue': {
    key: 'bt-max-out-request-queue',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '500',
    required: true,
    min: 0,
    support: 'current',
  },
  /** `--bt-max-in-request-queue` */
  'bt-max-in-request-queue': {
    key: 'bt-max-in-request-queue',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '2000',
    required: true,
    min: 0,
    support: 'current',
  },
  /** `--bt-disk-queue-size` */
  'bt-disk-queue-size': {
    key: 'bt-disk-queue-size',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '100M',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN_G,
    support: 'current',
  },
  /**
   * `--bt-disk-io`
   * aria2-next: Applied when the BitTorrent session starts; not changeable at runtime.
   */
  'bt-disk-io': {
    key: 'bt-disk-io',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'default',
    readonly: true,
    required: true,
    options: ['default', 'pread', 'mmap', 'posix'],
    support: 'current',
    aria2NextNote: 'Applied when the BitTorrent session starts; not changeable at runtime.',
  },
  /** `--bt-disk-read-cache` */
  'bt-disk-read-cache': {
    key: 'bt-disk-read-cache',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'enabled',
    required: true,
    options: ['enabled', 'disabled'],
    support: 'current',
  },
  /** `--bt-disk-write-cache` */
  'bt-disk-write-cache': {
    key: 'bt-disk-write-cache',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'enabled',
    required: true,
    options: ['enabled', 'disabled', 'write-through'],
    support: 'current',
  },
  /** `--bt-checking-memory` */
  'bt-checking-memory': {
    key: 'bt-checking-memory',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '32M',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN_G,
    support: 'current',
  },
  /** `--bt-piece-extent-affinity` */
  'bt-piece-extent-affinity': {
    key: 'bt-piece-extent-affinity',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--bt-peer-turnover`
   * aria2-next: Percent of connected peers replaced per turnover pass.
   */
  'bt-peer-turnover': {
    key: 'bt-peer-turnover',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '4',
    required: true,
    min: 0,
    max: 100,
    support: 'current',
    aria2NextNote: 'Percent of connected peers replaced per turnover pass.',
  },
  /**
   * `--bt-peer-turnover-cutoff`
   * aria2-next: Percent of the peer limit at which turnover starts.
   */
  'bt-peer-turnover-cutoff': {
    key: 'bt-peer-turnover-cutoff',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '90',
    required: true,
    min: 0,
    max: 100,
    support: 'current',
    aria2NextNote: 'Percent of the peer limit at which turnover starts.',
  },
  /** `--bt-peer-turnover-interval` */
  'bt-peer-turnover-interval': {
    key: 'bt-peer-turnover-interval',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '300',
    required: true,
    suffix: 'Seconds',
    min: 0,
    support: 'current',
  },
  /** `--bt-mixed-mode` */
  'bt-mixed-mode': {
    key: 'bt-mixed-mode',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'prefer-tcp',
    required: true,
    options: ['prefer-tcp', 'peer-proportional'],
    support: 'current',
  },
  /** `--bt-upload-slot-algorithm` */
  'bt-upload-slot-algorithm': {
    key: 'bt-upload-slot-algorithm',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'fixed',
    required: true,
    options: ['fixed', 'rate-based'],
    support: 'current',
  },
  /** `--bt-seed-choking-algorithm` */
  'bt-seed-choking-algorithm': {
    key: 'bt-seed-choking-algorithm',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'fastest-upload',
    required: true,
    options: ['round-robin', 'fastest-upload', 'anti-leech'],
    support: 'current',
  },
  /** `--bt-send-buffer-low-watermark` */
  'bt-send-buffer-low-watermark': {
    key: 'bt-send-buffer-low-watermark',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '10K',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN_G,
    support: 'current',
  },
  /** `--bt-send-buffer-watermark` */
  'bt-send-buffer-watermark': {
    key: 'bt-send-buffer-watermark',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '500K',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN_G,
    support: 'current',
  },
  /**
   * `--bt-send-buffer-watermark-factor`
   * aria2-next: Percent; scales the per-peer send buffer from the current upload rate.
   */
  'bt-send-buffer-watermark-factor': {
    key: 'bt-send-buffer-watermark-factor',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '50',
    required: true,
    min: 0,
    max: 100,
    support: 'current',
    aria2NextNote: 'Percent; scales the per-peer send buffer from the current upload rate.',
  },
  /** `--bt-seeding-outgoing-connections` */
  'bt-seeding-outgoing-connections': {
    key: 'bt-seeding-outgoing-connections',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /**
   * `--bt-rate-limit-overhead`
   * aria2-next: Includes estimated TCP/IP overhead in BitTorrent rate limits.
   */
  'bt-rate-limit-overhead': {
    key: 'bt-rate-limit-overhead',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
    aria2NextNote: 'Includes estimated TCP/IP overhead in BitTorrent rate limits.',
  },
  /**
   * `--bt-stop-tracker-timeout`
   * aria2-next: Replaces --bt-tracker-interval/--bt-tracker-timeout for shutdown announces; 0
   * disables them.
   */
  'bt-stop-tracker-timeout': {
    key: 'bt-stop-tracker-timeout',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '2',
    required: true,
    suffix: 'Seconds',
    min: 0,
    support: 'current',
    aria2NextNote:
      'Replaces --bt-tracker-interval/--bt-tracker-timeout for shutdown announces; 0 disables them.',
  },
  /**
   * `--bt-blocklist-scope`
   * aria2-next: ``all`` also filters DHT nodes.
   */
  'bt-blocklist-scope': {
    key: 'bt-blocklist-scope',
    since: 'aria2-next',
    type: 'option',
    category: 'bt',
    defaultValue: 'peers',
    required: true,
    options: ['peers', 'peers-and-trackers', 'all'],
    support: 'current',
    aria2NextNote: '``all`` also filters DHT nodes.',
  },
  /**
   * `--bt-resume-save-interval`
   * aria2-next: Fast-resume save interval; 0 disables periodic saves (pause/metadata/config changes
   * still save).
   */
  'bt-resume-save-interval': {
    key: 'bt-resume-save-interval',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '60',
    required: true,
    suffix: 'Minutes',
    min: 0,
    support: 'current',
    aria2NextNote:
      'Fast-resume save interval; 0 disables periodic saves (pause/metadata/config changes still save).',
  },
  /** `--bt-upload-suggestions` */
  'bt-upload-suggestions': {
    key: 'bt-upload-suggestions',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--bt-max-connections`
   * aria2-next: Session-wide peer limit; per-torrent limit is --bt-max-peers.
   */
  'bt-max-connections': {
    key: 'bt-max-connections',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '500',
    required: true,
    min: 0,
    support: 'current',
    aria2NextNote: 'Session-wide peer limit; per-torrent limit is --bt-max-peers.',
  },
  /**
   * `--bt-max-uploads`
   * aria2-next: Session-wide unchoked peers.
   */
  'bt-max-uploads': {
    key: 'bt-max-uploads',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '20',
    required: true,
    min: 0,
    support: 'current',
    aria2NextNote: 'Session-wide unchoked peers.',
  },
  /** `--bt-max-uploads-per-torrent` */
  'bt-max-uploads-per-torrent': {
    key: 'bt-max-uploads-per-torrent',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '4',
    required: true,
    min: 0,
    support: 'current',
  },
  /**
   * `--bt-first-last-piece-first`
   * aria2-next: Replaces --bt-prioritize-piece for the first/last 1% of each selected file; the
   * rest still uses rarest-first.
   */
  'bt-first-last-piece-first': {
    key: 'bt-first-last-piece-first',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
    aria2NextNote:
      'Replaces --bt-prioritize-piece for the first/last 1% of each selected file; the rest still uses rarest-first.',
  },
  /**
   * `--bt-file-priority`
   * aria2-next: ``INDEX=LEVEL`` pairs (off|normal|high|top), comma separated. Settable through
   * changeOption once magnet metadata is available; listed priorities override --select-file.
   */
  'bt-file-priority': {
    key: 'bt-file-priority',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    support: 'current',
    aria2NextNote:
      '``INDEX=LEVEL`` pairs (off|normal|high|top), comma separated. Settable through changeOption once magnet metadata is available; listed priorities override --select-file.',
  },
  /** `--bt-super-seeding` */
  'bt-super-seeding': {
    key: 'bt-super-seeding',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--bt-anonymous-mode` */
  'bt-anonymous-mode': {
    key: 'bt-anonymous-mode',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--bt-user-agent`
   * aria2-next: Replaces --peer-agent; the default mirrors the current stable qBittorrent identity.
   */
  'bt-user-agent': {
    key: 'bt-user-agent',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: 'qBittorrent/5.2.3',
    support: 'current',
    aria2NextNote:
      'Replaces --peer-agent; the default mirrors the current stable qBittorrent identity.',
  },
  /**
   * `--bt-peer-id-prefix`
   * aria2-next: Replaces --peer-id-prefix. Max 20 bytes; an empty value yields an unbranded peer
   * ID.
   */
  'bt-peer-id-prefix': {
    key: 'bt-peer-id-prefix',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    defaultValue: '-qB5230-',
    support: 'current',
    aria2NextNote:
      'Replaces --peer-id-prefix. Max 20 bytes; an empty value yields an unbranded peer ID.',
  },
  /** `--bt-announce-all-tiers` */
  'bt-announce-all-tiers': {
    key: 'bt-announce-all-tiers',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /** `--bt-announce-all-trackers` */
  'bt-announce-all-trackers': {
    key: 'bt-announce-all-trackers',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--bt-max-concurrent-http-announces` */
  'bt-max-concurrent-http-announces': {
    key: 'bt-max-concurrent-http-announces',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '50',
    required: true,
    min: 1,
    support: 'current',
  },
  /**
   * `--bt-peer-blocklist`
   * aria2-next: One IPv4/IPv6 address or CIDR range per line; ``#`` comments allowed. Reloaded by
   * changeGlobalOption; empty string clears it. See --bt-blocklist-scope.
   */
  'bt-peer-blocklist': {
    key: 'bt-peer-blocklist',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    support: 'current',
    aria2NextNote:
      'One IPv4/IPv6 address or CIDR range per line; ``#`` comments allowed. Reloaded by changeGlobalOption; empty string clears it. See --bt-blocklist-scope.',
  },
  /**
   * `--bt-port-mapping`
   * aria2-next: UPnP/NAT-PMP mapping; forced off while --bt-proxy is active.
   */
  'bt-port-mapping': {
    key: 'bt-port-mapping',
    since: 'aria2-next',
    type: 'boolean',
    category: 'bt',
    defaultValue: 'true',
    required: true,
    support: 'current',
    aria2NextNote: 'UPnP/NAT-PMP mapping; forced off while --bt-proxy is active.',
  },
  /**
   * `--bt-proxy`
   * aria2-next: http://, socks4:// or socks5:// URI with a mandatory port. SOCKS5 carries DHT UDP;
   * HTTP and SOCKS4 disable DHT.
   */
  'bt-proxy': {
    key: 'bt-proxy',
    since: 'aria2-next',
    type: 'string',
    category: 'bt',
    support: 'current',
    aria2NextNote:
      'http://, socks4:// or socks5:// URI with a mandatory port. SOCKS5 carries DHT UDP; HTTP and SOCKS4 disable DHT.',
  },
  /**
   * `--bt-tracker-completion-timeout`
   * aria2-next: Replaces --bt-tracker-timeout.
   */
  'bt-tracker-completion-timeout': {
    key: 'bt-tracker-completion-timeout',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '10',
    required: true,
    suffix: 'Seconds',
    min: 1,
    support: 'current',
    aria2NextNote: 'Replaces --bt-tracker-timeout.',
  },
  /**
   * `--bt-tracker-receive-timeout`
   * aria2-next: Replaces --bt-tracker-connect-timeout.
   */
  'bt-tracker-receive-timeout': {
    key: 'bt-tracker-receive-timeout',
    since: 'aria2-next',
    type: 'integer',
    category: 'bt',
    defaultValue: '10',
    required: true,
    suffix: 'Seconds',
    min: 1,
    support: 'current',
    aria2NextNote: 'Replaces --bt-tracker-connect-timeout.',
  },
  /* ------------------------------- ED2K / eMule ------------------------------- */
  /**
   * `--ed2k-server`
   * aria2-next: Comma-separated HOST:PORT list; built-in bootstrap servers are used when nothing is
   * configured.
   */
  'ed2k-server': {
    key: 'ed2k-server',
    since: 'aria2-next',
    type: 'string',
    category: 'ed2k',
    support: 'current',
    aria2NextNote:
      'Comma-separated HOST:PORT list; built-in bootstrap servers are used when nothing is configured.',
  },
  /**
   * `--ed2k-server-list`
   * aria2-next: Local eMule ``server.met`` file.
   */
  'ed2k-server-list': {
    key: 'ed2k-server-list',
    since: 'aria2-next',
    type: 'string',
    category: 'ed2k',
    support: 'current',
    aria2NextNote: 'Local eMule ``server.met`` file.',
  },
  /**
   * `--ed2k-node-list`
   * aria2-next: Local eMule ``nodes.dat`` Kad bootstrap file.
   */
  'ed2k-node-list': {
    key: 'ed2k-node-list',
    since: 'aria2-next',
    type: 'string',
    category: 'ed2k',
    support: 'current',
    aria2NextNote: 'Local eMule ``nodes.dat`` Kad bootstrap file.',
  },
  /**
   * `--ed2k-listen-port`
   * aria2-next: 0 lets the OS pick an available port.
   */
  'ed2k-listen-port': {
    key: 'ed2k-listen-port',
    since: 'aria2-next',
    type: 'integer',
    category: 'ed2k',
    defaultValue: '4662',
    min: 0,
    max: 65535,
    support: 'current',
    aria2NextNote: '0 lets the OS pick an available port.',
  },
  /**
   * `--ed2k-udp-listen-port`
   * aria2-next: Kad and peer reask packets; 0 lets the OS pick a port.
   */
  'ed2k-udp-listen-port': {
    key: 'ed2k-udp-listen-port',
    since: 'aria2-next',
    type: 'integer',
    category: 'ed2k',
    defaultValue: '4672',
    min: 0,
    max: 65535,
    support: 'current',
    aria2NextNote: 'Kad and peer reask packets; 0 lets the OS pick a port.',
  },
  /** `--ed2k-upload-slots` */
  'ed2k-upload-slots': {
    key: 'ed2k-upload-slots',
    since: 'aria2-next',
    type: 'integer',
    category: 'ed2k',
    defaultValue: '3',
    min: 0,
    support: 'current',
  },
  /** `--ed2k-max-connections` */
  'ed2k-max-connections': {
    key: 'ed2k-max-connections',
    since: 'aria2-next',
    type: 'integer',
    category: 'ed2k',
    defaultValue: '20',
    min: 1,
    support: 'current',
  },
  /**
   * `--ed2k-min-split-size`
   * aria2-next: Manual documents the range 1M - 1024M.
   */
  'ed2k-min-split-size': {
    key: 'ed2k-min-split-size',
    since: 'aria2-next',
    type: 'string',
    category: 'ed2k',
    defaultValue: '20M',
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
    aria2NextNote: 'Manual documents the range 1M - 1024M.',
  },
  /** `--ed2k-piece-selector` */
  'ed2k-piece-selector': {
    key: 'ed2k-piece-selector',
    since: 'aria2-next',
    type: 'option',
    category: 'ed2k',
    defaultValue: 'default',
    options: ['default', 'inorder', 'random', 'geom'],
    support: 'current',
  },
  /**
   * `--ed2k-preview-priority`
   * aria2-next: Prioritise the first and last ED2K parts after rare parts.
   */
  'ed2k-preview-priority': {
    key: 'ed2k-preview-priority',
    since: 'aria2-next',
    type: 'boolean',
    category: 'ed2k',
    defaultValue: 'false',
    support: 'current',
    aria2NextNote: 'Prioritise the first and last ED2K parts after rare parts.',
  },
  /**
   * `--detach-share-only`
   * aria2-next: Replaces --bt-detach-seed-only for both BitTorrent and ED2K. Share-only tasks still
   * report as active over RPC.
   */
  'detach-share-only': {
    key: 'detach-share-only',
    since: 'aria2-next',
    type: 'boolean',
    category: 'ed2k',
    defaultValue: 'false',
    support: 'current',
    aria2NextNote:
      'P2P sharing option — replaces --bt-detach-seed-only and applies to BitTorrent **and** ED2K. Filed under the ed2k category because it replaced that retired key, but it is not ED2K-specific. Share-only tasks still report as active over RPC.',
  },
  /* ------------------------------- Native media (HLS / DASH) ------------------------------- */
  /**
   * `--media`
   * aria2-next: ``auto`` sniffs manifest URL suffixes and HTTP content types; explicit hls/dash
   * also accept extensionless endpoints.
   */
  'media': {
    key: 'media',
    since: 'aria2-next',
    type: 'option',
    category: 'media',
    defaultValue: 'auto',
    options: ['auto', 'file', 'hls', 'dash', 'collection'],
    support: 'current',
    aria2NextNote:
      '``auto`` sniffs manifest URL suffixes and HTTP content types; explicit hls/dash also accept extensionless endpoints.',
  },
  /**
   * `--media-format`
   * aria2-next: ``vtt`` is subtitle-only. Use MKV when MP4 cannot represent the selected
   * subtitle/codec combination.
   */
  'media-format': {
    key: 'media-format',
    since: 'aria2-next',
    type: 'option',
    category: 'media',
    defaultValue: 'mp4',
    options: ['mp4', 'mkv', 'vtt'],
    support: 'current',
    aria2NextNote:
      '``vtt`` is subtitle-only. Use MKV when MP4 cannot represent the selected subtitle/codec combination.',
  },
  /**
   * `--media-video`
   * aria2-next: ``best`` picks the highest bandwidth source, ``none`` drops video. An opaque track
   * ID from ``media.tracks`` is also accepted; treat IDs as opaque.
   */
  'media-video': {
    key: 'media-video',
    since: 'aria2-next',
    type: 'string-or-option',
    category: 'media',
    defaultValue: 'best',
    options: ['best', 'none'],
    support: 'current',
    aria2NextNote:
      '``best`` picks the highest bandwidth source, ``none`` drops video. An opaque track ID from ``media.tracks`` is also accepted; treat IDs as opaque. Rendered as a dropdown plus a free-text field because track IDs only exist at runtime.',
  },
  /**
   * `--media-audio`
   * aria2-next: Also accepts a language code or an opaque track ID.
   */
  'media-audio': {
    key: 'media-audio',
    since: 'aria2-next',
    type: 'string-or-option',
    category: 'media',
    defaultValue: 'best',
    options: ['best', 'none'],
    support: 'current',
    aria2NextNote: 'Also accepts a language code or an opaque track ID.',
  },
  /**
   * `--media-subtitles`
   * aria2-next: Also accepts a language code or an opaque track ID.
   */
  'media-subtitles': {
    key: 'media-subtitles',
    since: 'aria2-next',
    type: 'string-or-option',
    category: 'media',
    defaultValue: 'none',
    options: ['none', 'best'],
    support: 'current',
    aria2NextNote: 'Also accepts a language code or an opaque track ID.',
  },
  /**
   * `--media-pause-after-probe`
   * aria2-next: Publishes ``media.tracks`` and pauses before fetching payload segments; select
   * tracks via changeOption, then clear this and unpause.
   */
  'media-pause-after-probe': {
    key: 'media-pause-after-probe',
    since: 'aria2-next',
    type: 'boolean',
    category: 'media',
    defaultValue: 'false',
    support: 'current',
    aria2NextNote:
      'Publishes ``media.tracks`` and pauses before fetching payload segments; select tracks via changeOption, then clear this and unpause.',
  },
  /**
   * `--media-request-contexts`
   * aria2-next: Captured browser request contexts as a JSON array (max 8 origins, 32 headers and 16
   * KiB of names/values per origin). Never place it in input history.
   */
  'media-request-contexts': {
    key: 'media-request-contexts',
    since: 'aria2-next',
    type: 'string',
    category: 'media',
    support: 'current',
    aria2NextNote:
      'Captured browser request contexts as a JSON array (max 8 origins, 32 headers and 16 KiB of names/values per origin), settable through changeOption. Credentials are sensitive: they persist in the session file, so never place this value in input history.',
  },
  /**
   * `--media-record-time`
   * aria2-next: Live duration limit in seconds; 0 records until stopped. Stops on a complete
   * segment boundary.
   */
  'media-record-time': {
    key: 'media-record-time',
    since: 'aria2-next',
    type: 'integer',
    category: 'media',
    defaultValue: '0',
    suffix: 'Seconds',
    min: 0,
    support: 'current',
    aria2NextNote:
      'Live duration limit in seconds; 0 records until stopped. Stops on a complete segment boundary.',
  },
  /**
   * `--media-start-time`
   * aria2-next: Finite HLS/DASH start boundary in seconds; 0 means the source boundary. Collections
   * and live sources reject it.
   */
  'media-start-time': {
    key: 'media-start-time',
    since: 'aria2-next',
    type: 'integer',
    category: 'media',
    suffix: 'Seconds',
    min: 0,
    support: 'current',
    aria2NextNote:
      'Finite HLS/DASH start boundary in seconds; 0 means the source boundary. Collections and live sources reject it.',
  },
  /**
   * `--media-end-time`
   * aria2-next: Finite HLS/DASH end boundary in seconds; 0 means the source boundary. Segment
   * selection only, not frame-accurate editing.
   */
  'media-end-time': {
    key: 'media-end-time',
    since: 'aria2-next',
    type: 'integer',
    category: 'media',
    suffix: 'Seconds',
    min: 0,
    support: 'current',
    aria2NextNote:
      'Finite HLS/DASH end boundary in seconds; 0 means the source boundary. Segment selection only, not frame-accurate editing.',
  },
  /**
   * `--media-input`
   * aria2-next: Captured ``captured-inputs`` plan (JSON with ``manifests``, ``tracks`` and
   * ``keys``) for the ``captured-inputs`` capability. Keys/IVs are 16-byte hex; keep it out of
   * application history.
   */
  'media-input': {
    key: 'media-input',
    since: 'aria2-next',
    type: 'string',
    category: 'media',
    support: 'current',
    aria2NextNote:
      'Captured ``captured-inputs`` plan (JSON with ``manifests``, ``tracks`` and ``keys``), settable through changeOption. Keys/IVs are 16-byte hex; keep it out of application history.',
  },
  /* ------------------------------- Metalink ------------------------------- */
  /** `--follow-metalink` */
  'follow-metalink': {
    key: 'follow-metalink',
    since: 'aria2',
    type: 'option',
    category: 'metalink',
    defaultValue: 'true',
    required: true,
    options: ['true', 'false', 'mem'],
    support: 'current',
  },
  /** `--metalink-base-uri` */
  'metalink-base-uri': {
    key: 'metalink-base-uri',
    since: 'aria2',
    type: 'string',
    category: 'metalink',
    support: 'current',
  },
  /** `--metalink-language` */
  'metalink-language': {
    key: 'metalink-language',
    since: 'aria2',
    type: 'string',
    category: 'metalink',
    support: 'current',
  },
  /** `--metalink-location` */
  'metalink-location': {
    key: 'metalink-location',
    since: 'aria2',
    type: 'string',
    category: 'metalink',
    support: 'current',
  },
  /** `--metalink-os` */
  'metalink-os': {
    key: 'metalink-os',
    since: 'aria2',
    type: 'string',
    category: 'metalink',
    support: 'current',
  },
  /** `--metalink-version` */
  'metalink-version': {
    key: 'metalink-version',
    since: 'aria2',
    type: 'string',
    category: 'metalink',
    support: 'current',
  },
  /**
   * `--metalink-preferred-protocol`
   * aria2-next: ``ftp`` was dropped together with FTP support.
   */
  'metalink-preferred-protocol': {
    key: 'metalink-preferred-protocol',
    since: 'aria2',
    type: 'option',
    category: 'metalink',
    defaultValue: 'none',
    required: true,
    options: ['http', 'https', 'none'],
    support: 'current',
    aria2NextNote: '``ftp`` was dropped together with FTP support.',
  },
  /** `--metalink-enable-unique-protocol` */
  'metalink-enable-unique-protocol': {
    key: 'metalink-enable-unique-protocol',
    since: 'aria2',
    type: 'boolean',
    category: 'metalink',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /**
   * `--metalink-file`
   * aria2-next: Local .meta4/.metalink path; task-creation only.
   */
  'metalink-file': {
    key: 'metalink-file',
    since: 'aria2-next',
    type: 'string',
    category: 'metalink',
    readonly: true,
    support: 'current',
    aria2NextNote: 'Local .meta4/.metalink path; task-creation only.',
  },
  /* ------------------------------- JSON-RPC server ------------------------------- */
  /** `--enable-rpc` */
  'enable-rpc': {
    key: 'enable-rpc',
    since: 'aria2',
    type: 'boolean',
    category: 'rpc',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /**
   * `--pause-metadata`
   * aria2-next: Gates --select-file: the paused magnet task reports
   * bittorrent.fileSelectionState=awaiting until a valid selection is submitted.
   */
  'pause-metadata': {
    key: 'pause-metadata',
    since: 'aria2',
    type: 'boolean',
    category: 'rpc',
    defaultValue: 'false',
    required: true,
    support: 'current',
    aria2NextNote:
      'Gates --select-file: the paused magnet task reports bittorrent.fileSelectionState=awaiting until a valid selection is submitted.',
  },
  /** `--rpc-allow-origin-all` */
  'rpc-allow-origin-all': {
    key: 'rpc-allow-origin-all',
    since: 'aria2',
    type: 'boolean',
    category: 'rpc',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /** `--rpc-listen-all` */
  'rpc-listen-all': {
    key: 'rpc-listen-all',
    since: 'aria2',
    type: 'boolean',
    category: 'rpc',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /**
   * `--rpc-listen-port`
   * aria2-next: The manual documents the accepted range 1024-65535.
   */
  'rpc-listen-port': {
    key: 'rpc-listen-port',
    since: 'aria2',
    type: 'integer',
    category: 'rpc',
    defaultValue: '6800',
    readonly: true,
    min: 1024,
    max: 65535,
    support: 'current',
    aria2NextNote: 'The manual documents the accepted range 1024-65535.',
  },
  /** `--rpc-max-request-size` */
  'rpc-max-request-size': {
    key: 'rpc-max-request-size',
    since: 'aria2',
    type: 'string',
    category: 'rpc',
    defaultValue: '2M',
    readonly: true,
    suffix: 'Bytes',
    support: 'current',
  },
  /** `--rpc-save-upload-metadata` */
  'rpc-save-upload-metadata': {
    key: 'rpc-save-upload-metadata',
    since: 'aria2',
    type: 'boolean',
    category: 'rpc',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /** `--rpc-secure` */
  'rpc-secure': {
    key: 'rpc-secure',
    since: 'aria2',
    type: 'boolean',
    category: 'rpc',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /**
   * `--pause`
   * aria2-next: Only effective with --enable-rpc=true.
   */
  'pause': {
    key: 'pause',
    since: 'aria2-next',
    type: 'boolean',
    category: 'rpc',
    defaultValue: 'false',
    support: 'current',
    aria2NextNote: 'Only effective with --enable-rpc=true.',
  },
  /**
   * `--rpc-certificate`
   * aria2-next: PKCS12 or PEM; pair with --rpc-private-key and --rpc-secure.
   */
  'rpc-certificate': {
    key: 'rpc-certificate',
    since: 'aria2-next',
    type: 'string',
    category: 'rpc',
    support: 'current',
    aria2NextNote: 'PKCS12 or PEM; pair with --rpc-private-key and --rpc-secure.',
  },
  /**
   * `--rpc-private-key`
   * aria2-next: Decrypted PEM key for the RPC server.
   */
  'rpc-private-key': {
    key: 'rpc-private-key',
    since: 'aria2-next',
    type: 'string',
    category: 'rpc',
    support: 'current',
    aria2NextNote: 'Decrypted PEM key for the RPC server.',
  },
  /**
   * `--rpc-secret`
   * aria2-next: JSON-RPC authorization token, sent as ``token:<secret>``.
   */
  'rpc-secret': {
    key: 'rpc-secret',
    since: 'aria2-next',
    type: 'string',
    category: 'rpc',
    support: 'current',
    aria2NextNote: 'JSON-RPC authorization token, sent as ``token:<secret>``.',
  },
  /* ------------------------------- Advanced and CLI-only ------------------------------- */
  /** `--allow-overwrite` */
  'allow-overwrite': {
    key: 'allow-overwrite',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--allow-piece-length-change`
   * aria2-next: Dropped in aria2-next: libtorrent owns torrent storage and the piece length cannot
   * change after creation.
   */
  'allow-piece-length-change': {
    key: 'allow-piece-length-change',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: libtorrent owns torrent storage and the piece length cannot change after creation.',
  },
  /**
   * `--always-resume`
   * aria2-next: Dropped in aria2-next: resume is automatic and driven by the persistent state
   * database.
   */
  'always-resume': {
    key: 'always-resume',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: resume is automatic and driven by the persistent state database.',
  },
  /**
   * `--async-dns`
   * aria2-next: Dropped in aria2-next: name resolution is handled by the threaded libcurl resolver.
   */
  'async-dns': {
    key: 'async-dns',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: name resolution is handled by the threaded libcurl resolver.',
  },
  /** `--auto-file-renaming` */
  'auto-file-renaming': {
    key: 'auto-file-renaming',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /**
   * `--auto-save-interval`
   * aria2-next: Renamed in aria2-next: normalized to --state-save-interval.
   */
  'auto-save-interval': {
    key: 'auto-save-interval',
    since: 'aria2',
    type: 'integer',
    category: 'advanced',
    defaultValue: '60',
    readonly: true,
    suffix: 'Seconds',
    support: 'removed',
    aria2NextNote: 'Renamed in aria2-next: normalized to --state-save-interval.',
  },
  /**
   * `--conditional-get`
   * aria2-next: Dropped in aria2-next: conditional requests are issued internally when a strong
   * ETag or Last-Modified validator exists.
   */
  'conditional-get': {
    key: 'conditional-get',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: conditional requests are issued internally when a strong ETag or Last-Modified validator exists.',
  },
  /** `--conf-path` */
  'conf-path': {
    key: 'conf-path',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    defaultValue: '$XDG_CONFIG_HOME/aria2/aria2.conf',
    readonly: true,
    support: 'current',
  },
  /**
   * `--console-log-level`
   * aria2-next: ``notice`` was renamed to ``info`` and ``trace`` was added.
   */
  'console-log-level': {
    key: 'console-log-level',
    since: 'aria2',
    type: 'option',
    category: 'advanced',
    defaultValue: 'info',
    readonly: true,
    options: ['trace', 'debug', 'info', 'warn', 'error'],
    support: 'current',
    aria2NextNote: '``notice`` was renamed to ``info`` and ``trace`` was added.',
  },
  /**
   * `--content-disposition-default-utf8`
   * aria2-next: Replaced in aria2-next by --filename-hint / --filename-hint-source, which decode
   * names per protocol boundary.
   */
  'content-disposition-default-utf8': {
    key: 'content-disposition-default-utf8',
    since: '1.31.0',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    support: 'removed',
    aria2NextNote:
      'Replaced in aria2-next by --filename-hint / --filename-hint-source, which decode names per protocol boundary.',
  },
  /** `--daemon` */
  'daemon': {
    key: 'daemon',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /** `--deferred-input` */
  'deferred-input': {
    key: 'deferred-input',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /** `--disable-ipv6` */
  'disable-ipv6': {
    key: 'disable-ipv6',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /** `--disk-cache` */
  'disk-cache': {
    key: 'disk-cache',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    defaultValue: '16M',
    readonly: true,
    suffix: 'Bytes',
    support: 'current',
  },
  /** `--download-result` */
  'download-result': {
    key: 'download-result',
    since: 'aria2',
    type: 'option',
    category: 'advanced',
    defaultValue: 'default',
    required: true,
    options: ['default', 'full', 'hide'],
    support: 'current',
  },
  /** `--dscp` */
  'dscp': {
    key: 'dscp',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    readonly: true,
    support: 'current',
  },
  /** `--rlimit-nofile` */
  'rlimit-nofile': {
    key: 'rlimit-nofile',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    readonly: true,
    support: 'current',
  },
  /** `--enable-color` */
  'enable-color': {
    key: 'enable-color',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    readonly: true,
    support: 'current',
  },
  /** `--enable-mmap` */
  'enable-mmap': {
    key: 'enable-mmap',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /**
   * `--event-poll`
   * aria2-next: ``port`` was removed; aria2-next documents epoll, kqueue, poll and select.
   */
  'event-poll': {
    key: 'event-poll',
    since: 'aria2',
    type: 'option',
    category: 'advanced',
    readonly: true,
    options: ['epoll', 'kqueue', 'poll', 'select'],
    support: 'current',
    aria2NextNote: '``port`` was removed; aria2-next documents epoll, kqueue, poll and select.',
  },
  /**
   * `--file-allocation`
   * aria2-next: The aria2-next default is ``trunc``; aria2 defaulted to ``prealloc``.
   */
  'file-allocation': {
    key: 'file-allocation',
    since: 'aria2',
    type: 'option',
    category: 'advanced',
    defaultValue: 'trunc',
    required: true,
    options: ['none', 'prealloc', 'trunc', 'falloc'],
    support: 'current',
    aria2NextNote: 'The aria2-next default is ``trunc``; aria2 defaulted to ``prealloc``.',
  },
  /** `--force-save` */
  'force-save': {
    key: 'force-save',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--save-not-found` */
  'save-not-found': {
    key: 'save-not-found',
    since: '1.27.0',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /** `--hash-check-only` */
  'hash-check-only': {
    key: 'hash-check-only',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--human-readable` */
  'human-readable': {
    key: 'human-readable',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    readonly: true,
    support: 'current',
  },
  /** `--keep-unfinished-download-result` */
  'keep-unfinished-download-result': {
    key: 'keep-unfinished-download-result',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /** `--max-download-result` */
  'max-download-result': {
    key: 'max-download-result',
    since: 'aria2',
    type: 'integer',
    category: 'advanced',
    defaultValue: '1000',
    required: true,
    min: 0,
    support: 'current',
  },
  /** `--max-mmap-limit` */
  'max-mmap-limit': {
    key: 'max-mmap-limit',
    since: '1.20.0',
    type: 'string',
    category: 'advanced',
    defaultValue: '9223372036854775807',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
  },
  /**
   * `--max-resume-failure-tries`
   * aria2-next: Dropped in aria2-next: resume state is validated by the stream state database.
   */
  'max-resume-failure-tries': {
    key: 'max-resume-failure-tries',
    since: 'aria2',
    type: 'integer',
    category: 'advanced',
    defaultValue: '0',
    required: true,
    min: 0,
    support: 'removed',
    aria2NextNote: 'Dropped in aria2-next: resume state is validated by the stream state database.',
  },
  /**
   * `--min-tls-version`
   * aria2-next: SSLv3 and TLSv1 were dropped and TLSv1.3 was added; aria2-next also accepts changes
   * at runtime, which AriaNg did not allow.
   */
  'min-tls-version': {
    key: 'min-tls-version',
    since: 'aria2',
    type: 'option',
    category: 'advanced',
    defaultValue: 'TLSv1.2',
    readonly: true,
    options: ['TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
    support: 'current',
    aria2NextNote:
      'SSLv3 and TLSv1 were dropped and TLSv1.3 was added; aria2-next also accepts changes at runtime, which AriaNg did not allow.',
  },
  /**
   * `--log-level`
   * aria2-next: ``notice`` was renamed to ``info`` and ``trace`` was added.
   */
  'log-level': {
    key: 'log-level',
    since: 'aria2',
    type: 'option',
    category: 'advanced',
    defaultValue: 'debug',
    required: true,
    options: ['trace', 'debug', 'info', 'warn', 'error'],
    support: 'current',
    aria2NextNote: '``notice`` was renamed to ``info`` and ``trace`` was added.',
  },
  /**
   * `--optimize-concurrent-downloads`
   * aria2-next: The aria2-next signature is ``[true|false|<A>:<B>]``; ``A:B`` customises N = A +
   * B·Log10(Mbps) (defaults A=5, B=25).
   */
  'optimize-concurrent-downloads': {
    key: 'optimize-concurrent-downloads',
    since: '1.22.0',
    type: 'option',
    category: 'advanced',
    defaultValue: 'false',
    options: ['true', 'false', '<A>:<B>'],
    support: 'current',
    aria2NextNote:
      'The aria2-next signature is ``[true|false|<A>:<B>]``; ``A:B`` customises N = A + B·Log10(Mbps) (defaults A=5, B=25).',
  },
  /** `--piece-length` */
  'piece-length': {
    key: 'piece-length',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    defaultValue: '1M',
    required: true,
    suffix: 'Bytes',
    pattern: '^(0|[1-9]\\d*(M|m)?)$',
    support: 'current',
  },
  /** `--show-console-readout` */
  'show-console-readout': {
    key: 'show-console-readout',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    readonly: true,
    support: 'current',
  },
  /** `--summary-interval` */
  'summary-interval': {
    key: 'summary-interval',
    since: 'aria2',
    type: 'integer',
    category: 'advanced',
    defaultValue: '60',
    readonly: true,
    suffix: 'Seconds',
    support: 'current',
  },
  /** `--max-overall-download-limit` */
  'max-overall-download-limit': {
    key: 'max-overall-download-limit',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    defaultValue: '0',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
  },
  /** `--max-download-limit` */
  'max-download-limit': {
    key: 'max-download-limit',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    defaultValue: '0',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
  },
  /** `--no-conf` */
  'no-conf': {
    key: 'no-conf',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    readonly: true,
    support: 'current',
  },
  /** `--no-file-allocation-limit` */
  'no-file-allocation-limit': {
    key: 'no-file-allocation-limit',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    defaultValue: '5M',
    required: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN,
    support: 'current',
  },
  /** `--parameterized-uri` */
  'parameterized-uri': {
    key: 'parameterized-uri',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    required: true,
    support: 'current',
  },
  /** `--quiet` */
  'quiet': {
    key: 'quiet',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /** `--realtime-chunk-checksum` */
  'realtime-chunk-checksum': {
    key: 'realtime-chunk-checksum',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    required: true,
    support: 'current',
  },
  /**
   * `--remove-control-file`
   * aria2-next: Dropped in aria2-next: no adjacent .aria2 control files are kept, state lives under
   * --state-dir.
   */
  'remove-control-file': {
    key: 'remove-control-file',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    required: true,
    support: 'removed',
    aria2NextNote:
      'Dropped in aria2-next: no adjacent .aria2 control files are kept, state lives under --state-dir.',
  },
  /** `--save-session` */
  'save-session': {
    key: 'save-session',
    since: 'aria2',
    type: 'string',
    category: 'advanced',
    support: 'current',
  },
  /** `--save-session-interval` */
  'save-session-interval': {
    key: 'save-session-interval',
    since: 'aria2',
    type: 'integer',
    category: 'advanced',
    defaultValue: '0',
    readonly: true,
    suffix: 'Seconds',
    support: 'current',
  },
  /** `--socket-recv-buffer-size` */
  'socket-recv-buffer-size': {
    key: 'socket-recv-buffer-size',
    since: '1.19.3',
    type: 'string',
    category: 'advanced',
    defaultValue: '0',
    readonly: true,
    suffix: 'Bytes',
    support: 'current',
  },
  /** `--stop` */
  'stop': {
    key: 'stop',
    since: 'aria2',
    type: 'integer',
    category: 'advanced',
    defaultValue: '0',
    readonly: true,
    suffix: 'Seconds',
    support: 'current',
  },
  /** `--truncate-console-readout` */
  'truncate-console-readout': {
    key: 'truncate-console-readout',
    since: 'aria2',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'true',
    readonly: true,
    support: 'current',
  },
  /**
   * `--state-save-interval`
   * aria2-next: Replaces --auto-save-interval; the manual documents 0 to 600.
   */
  'state-save-interval': {
    key: 'state-save-interval',
    since: 'aria2-next',
    type: 'integer',
    category: 'advanced',
    defaultValue: '60',
    required: true,
    suffix: 'Seconds',
    min: 0,
    max: 600,
    support: 'current',
    aria2NextNote: 'Replaces --auto-save-interval; the manual documents 0 to 600.',
  },
  /**
   * `--state-dir`
   * aria2-next: Persistent engine state root (stream/state.db, bittorrent/, ed2k/state.db,
   * media/state.db). Defaults to the native per-user application state directory.
   */
  'state-dir': {
    key: 'state-dir',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    required: true,
    support: 'current',
    aria2NextNote:
      'Persistent engine state root (stream/state.db, bittorrent/, ed2k/state.db, media/state.db). Defaults to the native per-user application state directory.',
  },
  /**
   * `--interface`
   * aria2-next: Binds all non-BitTorrent sockets; BitTorrent uses --bt-interface.
   */
  'interface': {
    key: 'interface',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote: 'Binds all non-BitTorrent sockets; BitTorrent uses --bt-interface.',
  },
  /**
   * `--multiple-interface`
   * aria2-next: Comma-separated interfaces for link aggregation; ignored when --interface is set.
   */
  'multiple-interface': {
    key: 'multiple-interface',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote:
      'Comma-separated interfaces for link aggregation; ignored when --interface is set.',
  },
  /** `--log-max-size` */
  'log-max-size': {
    key: 'log-max-size',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    defaultValue: '10M',
    readonly: true,
    suffix: 'Bytes',
    pattern: BYTE_PATTERN_G,
    support: 'current',
  },
  /** `--log-max-files` */
  'log-max-files': {
    key: 'log-max-files',
    since: 'aria2-next',
    type: 'integer',
    category: 'advanced',
    defaultValue: '4',
    readonly: true,
    min: 1,
    max: 100,
    support: 'current',
  },
  /**
   * `--on-bt-download-complete`
   * aria2-next: Runs after completion but before seeding; takes precedence over
   * --on-download-complete for torrents.
   */
  'on-bt-download-complete': {
    key: 'on-bt-download-complete',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote:
      'Runs after completion but before seeding; takes precedence over --on-download-complete for torrents.',
  },
  /**
   * `--on-download-complete`
   * aria2-next: Receives GID, file count and the first selected file path.
   */
  'on-download-complete': {
    key: 'on-download-complete',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote: 'Receives GID, file count and the first selected file path.',
  },
  /**
   * `--on-download-error`
   * aria2-next: Runs when a download aborts with an error.
   */
  'on-download-error': {
    key: 'on-download-error',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote: 'Runs when a download aborts with an error.',
  },
  /**
   * `--on-download-pause`
   * aria2-next: Runs when a download is paused.
   */
  'on-download-pause': {
    key: 'on-download-pause',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote: 'Runs when a download is paused.',
  },
  /**
   * `--on-download-start`
   * aria2-next: Runs when a download starts.
   */
  'on-download-start': {
    key: 'on-download-start',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote: 'Runs when a download starts.',
  },
  /**
   * `--on-download-stop`
   * aria2-next: Not executed when --on-download-complete or --on-download-error is set.
   */
  'on-download-stop': {
    key: 'on-download-stop',
    since: 'aria2-next',
    type: 'string',
    category: 'advanced',
    support: 'current',
    aria2NextNote: 'Not executed when --on-download-complete or --on-download-error is set.',
  },
  /** `--stderr` */
  'stderr': {
    key: 'stderr',
    since: 'aria2-next',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    readonly: true,
    support: 'current',
  },
  /**
   * `--force-sequential`
   * aria2-next: Command-line URIs are fetched sequentially; for a torrent it enables libtorrent
   * sequential piece mode and can be changed while active.
   */
  'force-sequential': {
    key: 'force-sequential',
    since: 'aria2-next',
    type: 'boolean',
    category: 'advanced',
    defaultValue: 'false',
    support: 'current',
    aria2NextNote:
      'Command-line URIs are fetched sequentially; for a torrent it enables libtorrent sequential piece mode and can be changed while active.',
  },
  /**
   * `--stop-with-process`
   * aria2-next: Shuts down when the given parent PID disappears.
   */
  'stop-with-process': {
    key: 'stop-with-process',
    since: 'aria2-next',
    type: 'integer',
    category: 'advanced',
    min: 0,
    support: 'current',
    aria2NextNote: 'Shuts down when the given parent PID disappears.',
  },
};

/** Every option key in {@link ARIA2_ALL_OPTIONS}, in declaration order. */
export const ARIA2_ALL_OPTION_KEYS: string[] = Object.keys(ARIA2_ALL_OPTIONS);

/** Look up the metadata of one option key, or `undefined` when unknown. */
/**
 * Is this `since` a product name rather than an aria2 version number?
 *
 * `since` carries two different things: a release (`'1.19.3'`) and a *product*
 * (`'aria2-next'`). aria2-next is a fork with its own option set, not a later aria2,
 * so `aria2-next` must not be rendered through a template that says "Requires aria2
 * v{{version}} or higher" — that produced "需要 aria2 varia2-next 或更高版本" on all
 * 112 aria2-next rows.
 *
 * A leading digit is the discriminator: every upstream release starts with one and no
 * product name does.
 */
export function isProductSince(since: string): boolean {
  return !/^\d/.test(since);
}

export function getOptionMeta(key: string): OptionMeta | undefined {
  return Object.hasOwn(ARIA2_ALL_OPTIONS, key) ? ARIA2_ALL_OPTIONS[key] : undefined;
}

/** Whether `key` is an option this frontend knows how to render. */
export function isOptionKeyValid(key: string): boolean {
  return Object.hasOwn(ARIA2_ALL_OPTIONS, key);
}

/** Whether aria2-next retired `key` without leaving a replacement behind. */
export function isOptionRemoved(key: string): boolean {
  return getOptionMeta(key)?.support === 'removed';
}

/**
 * i18n key for one value of an `option`-type row.
 *
 * All allowed values share a single `option.<value>` namespace, so the option
 * key is accepted purely for call-site symmetry with {@link getOptionMeta} and
 * is intentionally unused.
 */
export function optionValueLabel(_key: string, value: string): string {
  return `option.${value}`;
}

/** Split a `text` option into its trimmed, non-empty items. */
function splitTextValue(meta: OptionMeta, raw: string): string[] {
  const separator = meta.separator ?? ',';
  return raw
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Trim trailing zeros so `1.50` renders as `1.5`. */
function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, '');
}

const BYTE_UNITS: Readonly<Record<string, { multiplier: number; label: string }>> = {
  K: { multiplier: 1024, label: 'KiB' },
  M: { multiplier: 1024 ** 2, label: 'MiB' },
  G: { multiplier: 1024 ** 3, label: 'GiB' },
  T: { multiplier: 1024 ** 4, label: 'TiB' },
};

/**
 * Render an aria2 size literal (`0`, `20M`, `1.5K`, ...) as an input hint.
 *
 * Returns `'1 KiB (1024 B)'` for `'1K'`. Anything that is not a size literal
 * is echoed back untouched so the caller can still display the raw value.
 */
export function humanizeByteValue(value: string): string {
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]*)$/.exec(value.trim());
  if (!match) return value.trim();
  const unit = match[2].toUpperCase();
  if (unit === '') return `${formatNumber(Number.parseFloat(match[1]))} B`;
  const size = BYTE_UNITS[unit];
  if (!size) return value.trim();
  const bytes = Number.parseFloat(match[1]) * size.multiplier;
  if (!Number.isFinite(bytes)) return value.trim();
  return `${formatNumber(Number.parseFloat(match[1]))} ${size.label} (${formatNumber(bytes)} B)`;
}

/**
 * Turn the raw editor value into the payload shape `aria2.changeGlobalOption`
 * expects: `boolean` for switches, a `number` for numeric rows, an array for
 * `text` rows submitted as `submitFormat: 'array'`, and a trimmed string
 * otherwise. Unparseable numbers are passed through as strings so the editor
 * can surface a validation error instead of silently submitting `NaN`.
 */
export function coerceOptionValue(
  meta: OptionMeta,
  raw: string,
): string | string[] | number | boolean {
  const value = (raw ?? '').trim();
  switch (meta.type) {
    case 'boolean':
      return value === 'true';
    case 'integer': {
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case 'float': {
      const parsed = Number.parseFloat(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case 'text':
      return meta.submitFormat === 'array' ? splitTextValue(meta, value) : value;
    case 'option':
    case 'readonly':
    case 'string':
    default:
      return value;
  }
}
