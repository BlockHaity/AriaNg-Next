/**
 * Wire-level types for the aria2 / aria2-next JSON-RPC contract.
 *
 * Everything the server sends is a *string* unless stated otherwise; the
 * normalisers in `src/domain` are responsible for coercing them.
 * All newer aria2-next members are optional and must be parsed defensively.
 */

import type {
  BittorrentState,
  FileSelectionState,
  MediaPhase,
  MediaProtocol,
  TaskListKind,
} from '@/config/rpc-constants';

export type Aria2Status = 'active' | 'waiting' | 'paused' | 'complete' | 'error' | 'removed';

export interface Aria2Uri {
  uri: string;
  status: 'used' | 'waiting';
}

/**
 * One entry of `getFiles` / `tellStatus().files`.
 *
 * "Values are strings." — and `index` is **already 1-based**
 * ("Index of the file, starting at 1, in the same order as files appear in the
 * multi-file torrent"). That index is exactly what `select-file` takes, so it
 * must be forwarded unchanged.
 */
export interface Aria2File {
  /** 1-based file index, as a decimal string. */
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: 'true' | 'false';
  uris?: Aria2Uri[];
}

export interface Aria2TorrentError {
  code?: number;
  kind?: string;
  category?: string;
  message?: string;
  recoverable?: boolean;
  operation?: string;
  file?: string;
}

/**
 * aria2-next structured BitTorrent error (`bittorrent.error`).
 *
 * The shape is currently identical to {@link Aria2TorrentError}; it is a
 * distinct alias so the two concepts can diverge without touching call sites.
 */
export type Aria2BittorrentError = Aria2TorrentError;

/** `bittorrent.info` — the Info dictionary subset aria2 exposes. */
export interface Aria2BittorrentInfo {
  name?: string;
  'name.utf-8'?: string;
  comment?: string;
  'comment.utf-8'?: string;
  creationDate?: string;
  mode?: 'single' | 'multi';
  privateTorrent?: 'true' | 'false';
}

export interface Aria2Bittorrent {
  mode?: 'single' | 'multi';
  comment?: string;
  creationDate?: string;
  info?: Aria2BittorrentInfo;
  privateTorrent?: 'true' | 'false';

  /* ---- aria2-next extensions ---- */
  /** Authoritative file-selection transaction state. */
  fileSelectionState?: FileSelectionState;
  state?: BittorrentState;
  error?: Aria2BittorrentError;
  infoHashV1?: string;
  infoHashV2?: string;
  currentTracker?: string;
  numPeers?: string;
  connectingPeers?: string;
  handshakingPeers?: string;
  numSeeds?: string;
  /** 0..1, based on the *selected* files only. */
  progress?: string;
  activeTime?: string;
  finishedTime?: string;
  seedingTime?: string;
}

export interface Aria2MediaTrack {
  id: string;
  type?: 'video' | 'audio' | 'subtitle' | string;
  language?: string;
  label?: string;
  bandwidth?: string;
  frameRate?: string;
  mimeType?: string;
  width?: string;
  height?: string;
  selected?: 'true' | 'false';
}

export interface Aria2MediaRequestContext {
  url: string;
  headers?: { name: string; value: string }[];
}

export interface Aria2MediaInputManifest {
  url?: string;
  content?: string;
  contentType?: string;
}

export interface Aria2MediaInput {
  manifests?: Aria2MediaInputManifest[];
  tracks?: unknown[];
  keys?: unknown[];
}

/** aria2-next native media (HLS / DASH) state, present on media tasks only. */
export interface Aria2Media {
  state?: MediaPhase;
  protocol?: MediaProtocol;
  live?: 'true' | 'false';
  /** milliseconds */
  duration?: string;
  /** milliseconds */
  completedDuration?: string;
  downloadedLength?: string;
  /** 0..1, media-duration based. */
  progress?: string;
  lengthKnown?: 'true' | 'false';
  error?: string;
  errorCode?: string;
  tracks?: Aria2MediaTrack[];
  input?: Aria2MediaInput;
}

/**
 * aria2-next ED2K/eMule state, as reported in `tellStatus().ed2k`.
 *
 * Field names are transcribed from the literal keys of the aria2-next manual's
 * `ed2k` struct (docs/manual/en/aria2-next.rst) — **not** inferred from its
 * prose descriptions. Numeric values are decimal strings; `kadFirewalled` and
 * `searchActive` are real booleans. Present for active ED2K downloads and for
 * ED2K search tasks.
 */
export interface Aria2Ed2k {
  /** ED2K file hash as lowercase hexadecimal. */
  hash?: string;
  name?: string;
  /** File length in bytes. */
  length?: string;
  /** Number of known MD4 part hashes. */
  partHashCount?: string;
  /** AICH root hash, when the file has one. */
  aichRoot?: string;

  serverCount?: string;
  connectedServerCount?: string;

  peerCount?: string;
  /** Peers currently reporting an upload queue rank. */
  queuedPeerCount?: string;
  /** Peers that accepted an upload request. */
  acceptedPeerCount?: string;
  deadPeerCount?: string;
  lowIdPeerCount?: string;
  /** LowID peers still waiting for a server callback. */
  callbackWaitingPeerCount?: string;

  kadNodeCount?: string;
  kadRouterCount?: string;
  kadFirewalled?: boolean;
  kadObservedAddressCount?: string;

  /** True while this task is an ED2K search. */
  searchActive?: boolean;
  searchMoreResults?: boolean;
  searchResultCount?: string;

  /** Whole seconds this completed task has actively shared. */
  sharingTime?: string;
  uploadingPeerCount?: string;
  waitingUploadPeerCount?: string;
  peerCreditCount?: string;
}

export interface Aria2TaskStatusResult {
  gid: string;
  status: Aria2Status;
  totalLength: string;
  completedLength: string;
  uploadLength?: string;
  downloadSpeed: string;
  uploadSpeed: string;
  connections: string;
  numSeeders: string;
  seeder?: 'true' | 'false';
  errorCode?: string;
  errorMessage?: string;
  dir: string;
  files?: Aria2File[];
  bittorrent?: Aria2Bittorrent;
  infoHash?: string;
  verifiedLength?: string;
  verifyIntegrityPending?: 'true' | 'false';
  following?: string;
  belongsTo?: string;
  media?: Aria2Media;
  ed2k?: Aria2Ed2k;
}

export interface Aria2GlobalStat {
  downloadSpeed: string;
  uploadSpeed: string;
  numActive: string;
  numWaiting: string;
  numStopped: string;
}

export interface Aria2VersionInfo {
  product?: string;
  rpcVersion?: string;
  version: string;
  enabledFeatures: string[];
  downloadFeatures?: string[];
  mediaFeatures?: string[];
}

export interface Aria2SessionInfo {
  sessionId: string;
}

export interface Aria2Peer {
  peerId: string;
  ip: string;
  port: string;
  /** Percentage of pieces the peer has, aria2's own semantics. */
  bitfield: string;
  amChoking: 'true' | 'false';
  peerChoking: 'true' | 'false';
  downloadSpeed: string;
  uploadSpeed: string;
  seeder: 'true' | 'false';
  /** Optional extended peer id (percent-encoded). */
  peerIdRaw?: string;
}

export interface Aria2Server {
  index: string;
  servers: { uri: string; currentUri: string; downloadSpeed: string }[];
}

export interface Aria2FileAllocation {
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: 'true' | 'false';
}

export type Aria2OptionValue = string;
export type Aria2OptionMap = Record<string, Aria2OptionValue>;

/**
 * One entry of `aria2.getEd2kSearchResults().results`.
 *
 * Field names are transcribed verbatim from the aria2-next manual, which lists
 * them as: `hash`, `name`, `length`, `sourceCount`, `completeSourceCount`,
 * `fileType`, `extension`, `mediaArtist`, `mediaAlbum`, `mediaTitle`,
 * `mediaLength`, `mediaBitrate`, `mediaCodec`, `sourceNetwork`, `ed2kLink`.
 * Numeric values are decimal strings.
 *
 * Only `ed2kLink` can be handed to `aria2.addUri`, and a hit may arrive without
 * one while its metadata is still being resolved — hence every other field is
 * optional and `ed2kLink` is only *expected*, not guaranteed.
 */
export interface Aria2Ed2kSearchResult {
  hash?: string;
  name?: string;
  /** File length in bytes, as a decimal string. */
  length?: string;
  /** How many sources reported this file. */
  sourceCount?: string;
  completeSourceCount?: string;
  fileType?: string;
  extension?: string;
  mediaArtist?: string;
  mediaAlbum?: string;
  mediaTitle?: string;
  mediaLength?: string;
  mediaBitrate?: string;
  mediaCodec?: string;
  sourceNetwork?: string;
  ed2kLink?: string;
}

export interface Aria2Ed2kSearchState {
  gid: string;
  moreResults: boolean;
  results: Aria2Ed2kSearchResult[];
}

export interface Aria2Tracker {
  id: string;
  url: string;
}

export interface Aria2WebSeed {
  uri: string;
}

/** Result of `aria2.resolveFilename` (aria2-next). */
export interface Aria2ResolveFilenameResult {
  filename?: string;
  suggested?: string;
  [key: string]: unknown;
}

export type { Aria2Status as Aria2TaskLifecycle, TaskListKind };
