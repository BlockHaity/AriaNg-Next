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

export interface Aria2File {
  index: number;
  path: string;
  /** 1-based aria2 file index, kept for `select-file`. */
  aria2Index: number;
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

/** aria2-next structured BitTorrent error (`bittorrent.error`). */
export interface Aria2BittorrentError extends Aria2TorrentError {}

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

/** aria2-next ED2K/eMule state. */
export interface Aria2Ed2k {
  hash?: string;
  name?: string;
  fileLength?: string;
  ed2kLink?: string;
  numPieces?: string;
  numServers?: string;
  connectedServers?: string;
  numPeers?: string;
  numPeersWithUploadQueueRank?: string;
  numPeersWithUploadRequest?: string;
  numPeersInRetryBackoff?: string;
  lowIdPeers?: string;
  lowIdPeersWaitingForServerCallback?: string;
  searching?: boolean;
  searchMoreResults?: boolean;
  searchResultCount?: string;
  shareSeconds?: string;
  uploadSlotsUsed?: string;
  uploadQueuePeers?: string;
  uploadQueuePeerCreditCount?: string;
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

/** aria2-next `aria2.ed2kSearch` / `aria2.getEd2kSearchResults`. */
export interface Aria2Ed2kSearchResult {
  ed2kLink: string;
  filename?: string;
  fileLength?: string;
  fileHash?: string;
  mediaCodec?: string;
  sourceNetwork?: string;
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
