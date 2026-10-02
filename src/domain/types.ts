/**
 * Normalised, render-ready domain models.
 *
 * Everything here is IMMUTABLE — the original AriaNg relied on in-place
 * mutation (`extendArray` / `copyObjectTo`) to keep `ng-repeat` identity,
 * which is a footgun in React.
 */

import type { Aria2Status } from '@/rpc/types';
import type {
  BittorrentState,
  FileSelectionState,
  MediaPhase,
  MediaProtocol,
} from '@/config/rpc-constants';

export interface FileTypeInfo {
  index: number;
  aria2Index: number;
  fileName: string;
  path: string;
  length: number;
  completedLength: number;
  completePercent: number;
  selected: boolean;
  /** Extension (lowercase, without dot) used by the file-type filters. */
  extension: string;
  /** Present only inside a multi-directory tree. */
  relativePath?: string;
  level?: number;
}

export interface DirectoryNode extends FileTypeInfo {
  isDir: true;
  nodePath: string;
  nodeName: string;
  children: FileNode[];
  subDirs: DirectoryNode[];
  /** true when every descendant is selected. */
  allSelected: boolean;
  /** true when only some descendants are selected. */
  partialSelected: boolean;
}

export interface FileNode extends FileTypeInfo {
  isDir: false;
}

export type FileTreeNode = DirectoryNode | FileNode;

export interface PeerClient {
  name: string;
  version?: string;
  info?: string;
}

export interface TaskPeer {
  peerId: string;
  ip: string;
  port: string;
  name: string;
  /** aria2 reports these from the *peer's* point of view; we swap them. */
  downloadSpeed: number;
  uploadSpeed: number;
  completePercent: number;
  seeder: boolean;
  amChoking: boolean;
  peerChoking: boolean;
  client?: PeerClient;
  isLocal?: boolean;
  /** Run-length encoded piece map for the canvas piece bar. */
  pieces?: { isCompleted: boolean; count: number }[];
}

export interface TaskErrorInfo {
  code: string;
  descriptionKey?: string;
  message?: string;
}

export interface MediaTrackView {
  id: string;
  type: string;
  language?: string;
  label?: string;
  bandwidth?: string;
  frameRate?: string;
  width?: string;
  height?: string;
  selected: boolean;
}

export interface TaskMediaView {
  state?: MediaPhase;
  protocol?: MediaProtocol;
  live: boolean;
  /** milliseconds */
  duration?: number;
  completedDuration?: number;
  downloadedLength: number;
  /** 0..1 media-duration based; `null` when the total duration is unknown. */
  progress: number | null;
  lengthKnown: boolean;
  error?: string;
  errorCode?: string;
  tracks: MediaTrackView[];
}

export interface TaskEd2kView {
  hash?: string;
  name?: string;
  fileLength?: number;
  ed2kLink?: string;
  numPieces?: number;
  numServers?: number;
  connectedServers?: number;
  numPeers?: number;
  numPeersWithUploadQueueRank?: number;
  numPeersWithUploadRequest?: number;
  numPeersInRetryBackoff?: number;
  lowIdPeers?: number;
  lowIdPeersWaitingForServerCallback?: number;
  searching?: boolean;
  searchMoreResults?: boolean;
  searchResultCount?: number;
  shareSeconds?: number;
  uploadSlotsUsed?: number;
  uploadQueuePeers?: number;
  uploadQueuePeerCreditCount?: number;
}

export interface TaskBittorrentView {
  mode?: 'single' | 'multi';
  comment?: string;
  creationDate?: number;
  infoName?: string;
  privateTorrent: boolean;
  fileSelectionState?: FileSelectionState;
  state?: BittorrentState;
  errorCode?: number;
  errorKind?: string;
  errorCategory?: string;
  errorMessage?: string;
  errorRecoverable?: boolean;
  errorOperation?: string;
  errorFile?: string;
  infoHashV1?: string;
  infoHashV2?: string;
  currentTracker?: string;
  numPeers?: number;
  connectingPeers?: number;
  handshakingPeers?: number;
  numSeeds?: number;
  /** 0..1 over *selected* files. */
  progress?: number;
  activeTime?: number;
  finishedTime?: number;
  seedingTime?: number;
}

export interface TaskTracker {
  id: string;
  url: string;
}

export interface NormalizedTask {
  gid: string;
  status: Aria2Status;
  taskName: string;
  hasTaskName: boolean;

  totalLength: number;
  completedLength: number;
  completePercent: number;
  remainLength: number;
  remainPercent: number;
  uploadLength: number;
  shareRatio: number;
  uploadSpeed: number;
  downloadSpeed: number;
  /** downloadSpeed === 0 — used as the primary sort key for "remaining". */
  idle: boolean;

  connections: number;
  numSeeders: number;
  seeder: boolean;
  dir: string;

  numPieces: number;
  completedPieces: number;
  pieceLength: number;
  bitfield: string;

  /** aria2 reports this in seconds; `null` when not applicable. */
  remainTime: number | null;

  verifiedPercent: number | undefined;
  verifyIntegrityPending: boolean;

  errorCode?: string;
  errorMessage?: string;
  errorDescription: string;

  files: FileTypeInfo[];
  /** Populated when the task is a multi-file torrent with >1 directory node. */
  fileTree: FileTreeNode[];
  multiDir: boolean;
  selectedFileCount: number;
  /** Only set when the task has exactly one file with a single unique URL. */
  singleUrl?: string;

  infoHash?: string;
  bittorrent?: TaskBittorrentView;
  trackers: TaskTracker[];
  media?: TaskMediaView;
  ed2k?: TaskEd2kView;

  following?: string;
  belongsTo?: string;
}

/** A task + the transient state that only the list/detail pages own. */
export interface TaskListEntry {
  task: NormalizedTask;
  /** Run-length encoded piece map, recomputed only when the bitfield changes. */
  pieces?: { isCompleted: boolean; count: number }[];
}

export interface SpeedSample {
  /** unix seconds */
  time: number;
  downloadSpeed: number;
  uploadSpeed: number;
  /** media tasks report retained payload instead of network speed. */
  mediaDownloadedLength?: number;
}

export const GLOBAL_STAT_CAPACITY = 120;
export const TASK_STAT_CAPACITY = 300;
