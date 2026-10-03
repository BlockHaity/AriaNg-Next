/**
 * aria2-next translation overlay (English).
 *
 * AriaNg has no ED2K or native-media support, so 109 of the 269 option keys in
 * our catalogue — and every string on the ED2K search page and the media tab —
 * have no upstream translation to inherit. Those live here instead of being
 * regenerated into `src/i18n/en.ts`, which must stay a faithful, reproducible
 * conversion of AriaNg's own table.
 *
 * Resolution order for `t()` is: active locale → English → this overlay → the
 * key itself. Merging the overlay into the English table means every locale
 * inherits it automatically, and a real translation only has to override the
 * key in `src/langs/*.txt` when one exists.
 *
 * Keys are FLAT and dotted (the same shape `flattenTable` produces), so this
 * can be merged without walking a nested object.
 */

/** Page-level strings for the aria2-next features. */
export const ARIA2_NEXT_UI_STRINGS: Record<string, string> = {
  /* navigation + tab labels */
  Media: 'Media',
  ED2K: 'ED2K',
  ED2KSearch: 'ED2K Search',
  Clear: 'Clear',
  Overview: 'Overview',
  Pieces: 'Pieces',
  Files: 'Files',
  Peers: 'Peers',

  /* media tab */
  'format.media.protocol': 'Protocol',
  'format.media.phase': 'Phase',
  'format.media.live': 'Live',
  'format.media.tracks': 'Tracks',
  'format.media.no-tracks': 'No tracks have been published yet.',
  'format.media.select-tracks': 'Select Tracks',
  'format.media.probe-hint':
    'Add the task with "Pause After Probe" enabled to publish the available representations, choose the tracks, then clear the flag and resume.',
  'format.media.finish': 'Finish Recording',
  'format.media.finish-hint': 'End an active or paused live recording and finalise the media recorded so far.',
  'format.media.retry': 'Retry',
  'format.media.retry-hint':
    'Requeue this failed media task with the same GID and its retained recovery data. Removing the result instead would discard that state.',
  'format.media.duration-unknown':
    'The total duration is not known yet, so no percentage is shown. Progress is measured in media time, not output bytes.',
  'format.media.frame-rate': '{{value}} fps',
  'format.media.bandwidth': '{{value}} bps',
  'format.media.select-to-continue': 'Select files to continue',
  'format.media.awaiting-selection':
    'This magnet task has its metadata but is waiting for a file selection. Submit a valid select-file before resuming it.',

  /* ed2k search */
  'format.ed2k.keyword': 'Keyword',
  'format.ed2k.searching': 'Searching…',
  'format.ed2k.more-results': 'More results are still arriving.',
  'format.ed2k.result-count': '(Total Count: {{count}})',
  'format.ed2k.sources': '{{count}} sources',
  'format.ed2k.source-network': 'Source Network',
  'format.ed2k.media-codec': 'Media Codec',
  'format.ed2k.not-downloadable': 'This result carries no ED2K link, so it cannot be downloaded.',
  'format.ed2k.advanced': 'Advanced',
  'format.ed2k.download-selected': 'Download Selected',
  'format.ed2k.unsupported':
    'ED2K search requires aria2-next with ED2K support. The daemon in use does not report that feature.',
  'format.ed2k.intro':
    'Results are gathered asynchronously from the configured ED2K servers and Kad bootstrap nodes. With none configured, aria2-next falls back to its built-in bootstrap servers, so results may be sparse.',

  /* option editor: removed / renamed aria2 options */
  'format.options.removed': 'Removed in aria2-next',
  'format.options.requires-aria2-next': 'Requires aria2-next',
};

/**
 * `options.<key>.name` / `options.<key>.description` for the catalogue keys
 * AriaNg never had. Descriptions deliberately explain what changed rather than
 * restating the option name — that is the only information the user lacks.
 */
export const ARIA2_NEXT_RPC_STRINGS: Record<string, string> = {
  /*
   * AriaNg's catalogue only defines `rpc.error.unauthorized`, so every other
   * `rpc.error.*` key `RPC_ERROR_HINTS` can produce resolves to itself. The tip has to
   * name both causes and both fixes, because the browser makes them indistinguishable:
   * a CORS rejection and a refused connection are both an opaque `TypeError` from
   * `fetch`.
   */
  // `Connect` has no AriaNg key; the five status strings it sits next to all do.
  'Connect': 'Connect',
  'rpc.error.httpUnreachable': 'The browser could not reach aria2. Either aria2 is not running, or the page and the RPC url are on different origins — aria2 sends no CORS headers and has no option to, so an http:// RPC url cannot be called cross-origin. Use a ws:// RPC url (websockets are not subject to CORS), or serve this page from the same origin as aria2.',
};

export const ARIA2_NEXT_CONF_STRINGS: Record<string, string> = {
  'Export aria2.conf': '导出 aria2.conf',
  'aria2.conf data': 'aria2.conf 内容',
  'This is a snapshot of the running daemon. aria2.changeGlobalOption never writes to disk, so options changed here are lost on restart unless this file is applied.':
    '这是运行中守护进程的快照。aria2.changeGlobalOption 从不写入磁盘,在此处修改的选项在重启后就会丢失,除非应用本文件。',
  'Omitted: {{keys}} — the value cannot be written on one line.':
    '已省略:{{keys}} —— 该值无法写在同一行上。',
};

export const ARIA2_NEXT_OPTION_STRINGS: Record<string, string> = {
  /* ---- streaming / naming ---- */
  'filename-hint': 'File Name Hint',
  'filename-hint.description':
    'A suggested output name. Unlike --out it is a hint, so the engine still applies its own precedence and never guesses a path from it.',
  'filename-hint-source': 'File Name Hint Source',
  'filename-hint-source.description':
    'Where the hint came from (for example "title"). A title hint is already decoded text: dots are preserved and the selected container extension is appended.',
  'stream-max-connections': 'Max Connections Per Host',
  'stream-max-connections.description':
    'Maximum number of connections aria2-next opens to a single host for one download.',
  'stream-max-range-size': 'Max Range Size Per Request',
  'stream-max-range-size.description':
    'Caps how much of a file a single HTTP request may ask for.',

  /* ---- TLS / certificates / SFTP ---- */
  'ca-certificate': 'CA Certificate File',
  'ca-certificate.description': 'Path to a PEM file of trusted certificate authorities.',
  certificate: 'Client Certificate File',
  'certificate.description': 'Path to the client certificate presented to the server.',
  'private-key': 'Client Private Key File',
  'private-key.description': 'Path to the private key matching the client certificate.',
  'load-cookies': 'Cookies File',
  'load-cookies.description': 'Load cookies from a file in the Netscape cookie format.',
  'sftp-user': 'SFTP User',
  'sftp-user.description': 'User name for SFTP authentication.',
  'sftp-passwd': 'SFTP Password',
  'sftp-passwd.description': 'Password for SFTP authentication.',
  'ssh-host-key-sha256': 'SSH Host Key Fingerprint',
  'ssh-host-key-sha256.description':
    'Expected SHA-256 fingerprint of the SFTP host key. Replaces the retired --ssh-host-key-md, which relied on MD5.',
  'min-tls-version': 'Minimum TLS Version',
  'min-tls-version.description': 'Refuse TLS connections older than this version.',

  /* ---- per-task ---- */
  'select-file': 'Selected Files',
  'select-file.description':
    'Comma-separated 1-based file indexes to download, or a range such as 1-4,8. Set through aria2.changeOption; a magnet task whose bittorrent.fileSelectionState is "awaiting" must not be resumed until a valid value is set.',
  'index-out': 'Index File Mapping',
  'index-out.description': 'Maps the indexes of a multi-file download to output paths.',
  'torrent-file': 'Torrent File',
  'torrent-file.description': 'Local .torrent file to read.',

  /* ---- bittorrent: interface, transport, discovery ---- */
  'bt-interface': 'BitTorrent Interface',
  'bt-interface.description': 'Network interfaces BitTorrent may bind to.',
  'bt-dht-bootstrap-nodes': 'DHT Bootstrap Nodes',
  'bt-dht-bootstrap-nodes.description':
    'DHT bootstrap routers. aria2-next persists native IPv4 and IPv6 DHT routing state in --state-dir.',
  'bt-encryption': 'Peer Encryption',
  'bt-encryption.description':
    'Transport encryption policy. Replaces the retired --bt-require-crypto / --bt-force-encryption / --bt-min-crypto-level trio.',
  'bt-transport': 'Peer Transport',
  'bt-transport.description': 'Whether to use TCP, uTP, or both.',
  'bt-external-port': 'External Port',
  'bt-external-port.description': 'Port announced to trackers when it differs from the listening port.',

  /* ---- bittorrent: disk and io ---- */
  'bt-io-threads': 'Disk IO Threads',
  'bt-io-threads.description': 'Threads libtorrent uses for disk IO.',
  'bt-hashing-threads': 'Hashing Threads',
  'bt-hashing-threads.description': 'Threads used for piece hashing.',
  'bt-connection-speed': 'Connection Speed',
  'bt-connection-speed.description': 'Lowest upload speed at which an idle connection is closed, in KiB/s. 0 disables it.',
  'bt-max-out-request-queue': 'Max Outgoing Requests',
  'bt-max-out-request-queue.description': 'Maximum number of block requests queued for upload.',
  'bt-max-in-request-queue': 'Max Incoming Requests',
  'bt-max-in-request-queue.description': 'Maximum number of block requests accepted from a peer.',
  'bt-disk-queue-size': 'Disk Queue Size',
  'bt-disk-queue-size.description': 'Number of outstanding disk operations before the disk thread applies backpressure.',
  'bt-disk-io': 'Disk IO Method',
  'bt-disk-io.description':
    'How files are read and written. Replaces the retired --bt-request-peer-speed-limit related disk tuning; cannot be changed at runtime.',
  'bt-disk-read-cache': 'Disk Read Cache',
  'bt-disk-read-cache.description': 'Whether reads go through the OS page cache.',
  'bt-disk-write-cache': 'Disk Write Cache',
  'bt-disk-write-cache.description': 'Whether writes are buffered, or written through to disk.',
  'bt-checking-memory': 'Hash Checking Memory',
  'bt-checking-memory.description': 'Memory budget for the hash check.',
  'bt-piece-extent-affinity': 'Piece Extent Affinity',
  'bt-piece-extent-affinity.description':
    'Keep the pieces of a file on the same extents, so a partially selected download writes fewer, larger ranges.',

  /* ---- bittorrent: peer turnover and upload scheduling ---- */
  'bt-peer-turnover': 'Peer Turnover Rate',
  'bt-peer-turnover.description':
    'Percentage of peers to replace over an interval. Keeps the swarm from stagnating without churning connections needlessly.',
  'bt-peer-turnover-cutoff': 'Peer Turnover Cutoff',
  'bt-peer-turnover-cutoff.description': 'Never churn more than this percentage of peers.',
  'bt-peer-turnover-interval': 'Peer Turnover Interval',
  'bt-peer-turnover-interval.description': 'How often peer turnover runs.',
  'bt-mixed-mode': 'Mixed Mode',
  'bt-mixed-mode.description': 'Whether TCP and uTP connections share slots proportionally or by preference.',
  'bt-upload-slot-algorithm': 'Upload Slot Algorithm',
  'bt-upload-slot-algorithm.description': 'How upload slots are handed out to peers.',
  'bt-seed-choking-algorithm': 'Seed Choking Algorithm',
  'bt-seed-choking-algorithm.description': 'How a seeder decides which peers to unchoke.',
  'bt-seeding-outgoing-connections': 'Seeding Outgoing Connections',
  'bt-seeding-outgoing-connections.description':
    'Allow a completed torrent to keep making outgoing connections while seeding.',
  'bt-max-connections': 'Max Connections',
  'bt-max-connections.description': 'Maximum number of connections per torrent.',
  'bt-max-uploads': 'Max Uploads',
  'bt-max-uploads.description': 'Maximum number of upload slots per torrent.',
  'bt-max-uploads-per-torrent': 'Max Uploads Per Torrent',
  'bt-max-uploads-per-torrent.description': 'Overall upload slot ceiling for this torrent.',
  'bt-max-peers': 'Max Peers',
  'bt-max-peers.description': 'Maximum number of peers tracked for this torrent.',

  /* ---- bittorrent: send buffers and overhead ---- */
  'bt-send-buffer-low-watermark': 'Send Buffer Low Watermark',
  'bt-send-buffer-low-watermark.description': 'Watermark at which buffered data starts being written out.',
  'bt-send-buffer-watermark': 'Send Buffer Watermark',
  'bt-send-buffer-watermark.description': 'Target size of the per-peer send buffer.',
  'bt-send-buffer-watermark-factor': 'Send Buffer Watermark Factor',
  'bt-send-buffer-watermark-factor.description':
    'Multiplier applied to the send rate when sizing the send buffer.',
  'bt-rate-limit-overhead': 'Rate Limit Overhead',
  'bt-rate-limit-overhead.description': 'Apply the global upload limit to protocol overhead as well as payload.',

  /* ---- bittorrent: trackers, resume, metadata ---- */
  'bt-stop-tracker-timeout': 'Tracker Stop Timeout',
  'bt-stop-tracker-timeout.description':
    'How long to keep answering trackers after a torrent stops.',
  'bt-blocklist-scope': 'Blocklist Scope',
  'bt-blocklist-scope.description': 'Whether the peer blocklist also filters peers, trackers, or both.',
  'bt-peer-blocklist': 'Peer Blocklist File',
  'bt-peer-blocklist.description': 'File of blocked peers. Served through aria2.setBtPeerBlocklist.',
  'bt-max-concurrent-http-announces': 'Max Concurrent HTTP Announces',
  'bt-max-concurrent-http-announces.description': 'Concurrency limit for HTTP tracker announces.',
  'bt-tracker-completion-timeout': 'Tracker Completion Timeout',
  'bt-tracker-completion-timeout.description': 'How long to wait for a tracker response before completing.',
  'bt-tracker-receive-timeout': 'Tracker Receive Timeout',
  'bt-tracker-receive-timeout.description': 'How long to keep reading a tracker response.',
  'bt-announce-all-tiers': 'Announce All Tiers',
  'bt-announce-all-tiers.description':
    'Announce to every tracker tier instead of stopping at the first that works. Lowest-priority excess tiers are compacted.',
  'bt-announce-all-trackers': 'Announce All Trackers',
  'bt-announce-all-trackers.description': 'Announce to every tracker in the list.',
  'bt-resume-save-interval': 'Resume Save Interval',
  'bt-resume-save-interval.description':
    'How often libtorrent checkpoints fast-resume data. Retired --bt-save-metadata state is not imported.',
  'bt-upload-suggestions': 'Upload Suggestions',
  'bt-upload-suggestions.description': 'Send the upload slot suggestion message to peers.',
  'bt-first-last-piece-first': 'First And Last Piece First',
  'bt-first-last-piece-first.description': 'Prioritise the first and last pieces of a file.',
  'bt-file-priority': 'File Priority',
  'bt-file-priority.description':
    'Per-file priority as INDEX=LEVEL pairs. Listed priorities override --select-file.',
  'bt-super-seeding': 'Super Seeding',
  'bt-super-seeding.description': 'Upload only the pieces nobody else has, to conserve upload bandwidth.',
  'bt-anonymous-mode': 'Anonymous Mode',
  'bt-anonymous-mode.description': 'Do not send the peer id, tracker id or user agent to peers.',
  'bt-user-agent': 'BitTorrent User Agent',
  'bt-user-agent.description': 'User agent announced to trackers. Renamed from the retired --peer-agent.',
  'bt-peer-id-prefix': 'BitTorrent Peer ID Prefix',
  'bt-peer-id-prefix.description': 'Client prefix of the generated peer id.',
  'bt-port-mapping': 'UPnP / NAT-PMP Port Mapping',
  'bt-port-mapping.description': 'Map the listening port automatically through UPnP or NAT-PMP.',
  'bt-proxy': 'BitTorrent Proxy',
  'bt-proxy.description': 'Proxy URI used for BitTorrent traffic.',

  /* ---- ed2k ---- */
  'ed2k-server': 'ED2K Server',
  'ed2k-server.description':
    'ED2K servers used to discover sources, as HOST:PORT. Comma-separated. With none configured, aria2-next uses its built-in bootstrap servers.',
  'ed2k-server-list': 'ED2K Server List File',
  'ed2k-server-list.description': 'Path to a server.met file to load ED2K servers from.',
  'ed2k-node-list': 'ED2K Node List File',
  'ed2k-node-list.description': 'Path to a nodes.dat file to load Kad bootstrap nodes from.',
  'ed2k-listen-port': 'ED2K Listen Port',
  'ed2k-listen-port.description': 'TCP port for incoming ED2K peer connections. 0 lets the engine choose.',
  'ed2k-udp-listen-port': 'ED2K UDP Listen Port',
  'ed2k-udp-listen-port.description': 'UDP port for Kad and peer reask packets. 0 lets the engine choose.',
  'ed2k-upload-slots': 'ED2K Upload Slots',
  'ed2k-upload-slots.description': 'Maximum number of active ED2K upload slots. Default: 3',
  'ed2k-max-connections': 'ED2K Max Connections',
  'ed2k-max-connections.description': 'Maximum number of concurrent ED2K peer connections.',
  'ed2k-min-split-size': 'ED2K Min Split Size',
  'ed2k-min-split-size.description': 'Keep at least this many bytes between parallel ED2K ranges.',
  'ed2k-piece-selector': 'ED2K Piece Selector',
  'ed2k-piece-selector.description':
    'Piece selection algorithm. "earliest" takes the earliest piece and "random" a random one, both honouring the minimum split size.',
  'ed2k-preview-priority': 'ED2K Preview Priority',
  'ed2k-preview-priority.description':
    'Prioritise the first and last ED2K parts after rare parts, which can make previews feel faster.',
  'detach-share-only': 'Detach When Complete',
  'detach-share-only.description':
    'Move a completed task out of the active queue while it keeps sharing. P2P sharing option covering both BitTorrent and ED2K; replaces the retired --bt-detach-seed-only.',

  /* ---- native media ---- */
  media: 'Media Mode',
  'media.description':
    'How to treat the source. "auto" recognises manifest URL suffixes and HTTP content types; explicit hls or dash also accept extensionless endpoints. "file" saves the resource unchanged.',
  'media-format': 'Media Container',
  'media-format.description':
    'Output container. MP4 cannot represent every subtitle and codec combination — use MKV when the selection needs it. No transcoding is performed.',
  'media-video': 'Media Video Track',
  'media-video.description':
    'Highest bandwidth video source by default. "none" drops video. A language code or an opaque track id from the task\'s media.tracks is also accepted; treat ids as opaque.',
  'media-audio': 'Media Audio Track',
  'media-audio.description':
    'Audio source: "best", "none", a language code, or an opaque track id from the task\'s media.tracks.',
  'media-subtitles': 'Media Subtitle Track',
  'media-subtitles.description':
    'Subtitle source: "none", "best", a language code, or an opaque track id. WebVTT is retained in Matroska.',
  'media-pause-after-probe': 'Pause After Probe',
  'media-pause-after-probe.description':
    'Publish the available representations and pause before fetching payload segments. Choose the tracks, clear this, then resume. Inspecting a manifest does not start downloading it.',
  'media-request-contexts': 'Media Request Contexts',
  'media-request-contexts.description':
    'JSON array of per-origin HTTP request contexts, each with a source url and header name/value pairs. At most eight origins, 32 headers and 16 KiB per origin; transport and conditional headers are rejected. These are sensitive credentials and are retained in the session file.',
  'media-record-time': 'Media Record Time',
  'media-record-time.description':
    'Duration limit in seconds for live media. 0 records until stopped or the source ends, always stopping at a complete segment boundary.',
  'media-start-time': 'Media Start Time',
  'media-start-time.description':
    'Select a finite HLS or DASH boundary in seconds; 0 means the source boundary. This is lossless segment selection, not frame-accurate editing. Collections and live sources reject it.',
  'media-end-time': 'Media End Time',
  'media-end-time.description': 'End boundary in seconds; 0 means the source boundary.',
  'media-input': 'Media Captured Input',
  'media-input.description':
    'Captured-inputs plan (JSON with manifests, tracks and keys). Keys and IVs are 16-byte hexadecimal values; keep this value out of application history.',

  /* ---- state, logging, daemon ---- */
  'state-dir': 'State Directory',
  'state-dir.description':
    'Directory for resume state. BitTorrent fast-resume data, ED2K runtime state and media checkpoints all live below it. Nothing is written next to the downloaded files.',
  'state-save-interval': 'State Save Interval',
  'state-save-interval.description':
    'How often session state is written. Renamed from the retired --auto-save-interval.',
  'disk-cache': 'Disk Cache Size',
  'disk-cache.description': 'Size of the disk cache used while writing output.',
  'no-file-allocation-limit': 'No File Allocation Limit',
  'no-file-allocation-limit.description':
    'Disable file preallocation once a file exceeds this size.',
  interface: 'Network Interface',
  'interface.description': 'Network interface to bind to.',
  'multiple-interface': 'Multiple Interfaces',
  'multiple-interface.description': 'Interfaces to try in order until one works.',
  dscp: 'DSCP Value',
  'dscp.description': 'Differentiated services code point applied to outgoing packets.',
  'log-max-size': 'Log Max Size',
  'log-max-size.description': 'Maximum size of the log file before it is rotated.',
  'log-max-files': 'Log Max Files',
  'log-max-files.description': 'Number of rotated log files to keep.',
  'metalink-file': 'Metalink File',
  'metalink-file.description': 'Local metalink file to read.',
  'rpc-certificate': 'RPC Certificate File',
  'rpc-certificate.description': 'Certificate presented by the RPC server.',
  'rpc-private-key': 'RPC Private Key File',
  'rpc-private-key.description': 'Private key matching the RPC certificate.',
  'rpc-secret': 'RPC Secret Token',
  'rpc-secret.description': 'Secret required by every JSON-RPC call, sent as params[0] as "token:<secret>".',

  /* ---- hooks ---- */
  'on-download-start': 'On Download Start',
  'on-download-start.description': 'Command run when a download starts.',
  'on-download-complete': 'On Download Complete',
  'on-download-complete.description': 'Command run when a download completes.',
  'on-download-error': 'On Download Error',
  'on-download-error.description': 'Command run when a download fails.',
  'on-download-pause': 'On Download Pause',
  'on-download-pause.description': 'Command run when a download is paused.',
  'on-download-stop': 'On Download Stop',
  'on-download-stop.description': 'Command run when a download is stopped.',
  'on-bt-download-complete': 'On BitTorrent Download Complete',
  'on-bt-download-complete.description': 'Command run when a BitTorrent download completes.',

  /* ---- console / process ---- */
  stderr: 'Redirect Console To STDERR',
  'stderr.description': 'Write console output to stderr instead of stdout.',
  'force-sequential': 'Force Sequential Download',
  'force-sequential.description':
    'Download a single file sequentially. aria2-next applies its own range scheduler, which this overrides for that task.',
  'stop-with-process': 'Stop With Process',
  'stop-with-process.description': 'Stop the daemon when the given process exits.',
};

/**
 * Every overlay string, merged over English by `i18n.ts`.
 *
 * `ARIA2_NEXT_OPTION_STRINGS` is authored as `{ '<option-key>': … }` for names
 * and `{ '<option-key>.description': … }` for descriptions, because that mirrors
 * the option catalogue. `t()` looks up fully-qualified keys, so the `options.`
 * prefix and the `.name` suffix are applied here. Authoring by option key means
 * a typo in a key is a typo in exactly one place.
 */
export const ARIA2_NEXT_STRINGS: Record<string, string> = {
  ...ARIA2_NEXT_UI_STRINGS,
  ...ARIA2_NEXT_CONF_STRINGS,
  ...ARIA2_NEXT_RPC_STRINGS,
  ...Object.fromEntries(
    Object.entries(ARIA2_NEXT_OPTION_STRINGS).map(([key, value]) => [
      key.endsWith('.description') ? `options.${key}` : `options.${key}.name`,
      value,
    ]),
  ),
};
