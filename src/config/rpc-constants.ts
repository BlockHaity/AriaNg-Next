/**
 * aria2 / aria2-next JSON-RPC protocol constants.
 *
 * NOTE: the original AriaNg had no status enum at all (statuses were inline
 * string literals).  We introduce a typed enum + predicates so the whole app
 * shares one source of truth.
 */

export const RPC_SERVICE_VERSION = '2.0';
export const RPC_SERVICE_NAME = 'aria2';
export const RPC_SYSTEM_SERVICE_NAME = 'system';
export const RPC_TOKEN_PREFIX = 'token:';

export const DEFAULT_RPC_PORT = '6800';
export const DEFAULT_RPC_INTERFACE = 'jsonrpc';
export const DEFAULT_RPC_HOST = 'localhost';

/** aria2 task lifecycle. */
export const Aria2TaskStatus = {
  Active: 'active',
  Waiting: 'waiting',
  Paused: 'paused',
  Complete: 'complete',
  Error: 'error',
  Removed: 'removed',
} as const;

export type Aria2TaskStatus = (typeof Aria2TaskStatus)[keyof typeof Aria2TaskStatus];

export const TERMINAL_TASK_STATUSES: readonly Aria2TaskStatus[] = [
  Aria2TaskStatus.Complete,
  Aria2TaskStatus.Error,
  Aria2TaskStatus.Removed,
];

/** Statuses that can still be paused / resumed. */
export const PAUSABLE_TASK_STATUSES: readonly Aria2TaskStatus[] = [
  Aria2TaskStatus.Active,
  Aria2TaskStatus.Waiting,
  Aria2TaskStatus.Paused,
];

export function isTerminalStatus(status: string | undefined): boolean {
  return !!status && TERMINAL_TASK_STATUSES.includes(status as Aria2TaskStatus);
}

export function isRunningStatus(status: string | undefined): boolean {
  return status === Aria2TaskStatus.Active || status === Aria2TaskStatus.Waiting;
}

/** Which aria2 list a task currently belongs to. */
export const TaskListKind = {
  Downloading: 'downloading',
  Waiting: 'waiting',
  Stopped: 'stopped',
} as const;

export type TaskListKind = (typeof TaskListKind)[keyof typeof TaskListKind];

/**
 * aria2-next `bittorrent.fileSelectionState`.
 * A magnet task reported as `awaiting` MUST NOT be unpaused until a valid
 * `select-file` has been submitted.
 */
export const FileSelectionState = {
  None: 'none',
  Awaiting: 'awaiting',
  Ready: 'ready',
  Applying: 'applying',
} as const;

export type FileSelectionState = (typeof FileSelectionState)[keyof typeof FileSelectionState];

/** aria2-next BitTorrent lifecycle state. */
export const BittorrentState = {
  Adding: 'adding',
  DownloadingMetadata: 'downloadingMetadata',
  Checking: 'checking',
  Downloading: 'downloading',
  Recovering: 'recovering',
  Finished: 'finished',
  Seeding: 'seeding',
  Paused: 'paused',
  Stopping: 'stopping',
  Stopped: 'stopped',
  Error: 'error',
} as const;

export type BittorrentState = (typeof BittorrentState)[keyof typeof BittorrentState];

/** aria2-next native media (HLS / DASH) phases. */
export const MediaPhase = {
  Waiting: 'waiting',
  Probing: 'probing',
  AwaitingSelection: 'awaiting-selection',
  Downloading: 'downloading',
  Recording: 'recording',
  Finalizing: 'finalizing',
  Paused: 'paused',
  Complete: 'complete',
  Error: 'error',
  Removed: 'removed',
} as const;

export type MediaPhase = (typeof MediaPhase)[keyof typeof MediaPhase];

export const MEDIA_TERMINAL_PHASES: readonly MediaPhase[] = [
  MediaPhase.Complete,
  MediaPhase.Error,
  MediaPhase.Removed,
];

export const MediaProtocol = {
  Hls: 'hls',
  Dash: 'dash',
  Collection: 'collection',
  File: 'file',
} as const;

export type MediaProtocol = (typeof MediaProtocol)[keyof typeof MediaProtocol];

/** Structured media failure reasons advertised by aria2-next. */
export const MediaErrorCode = {
  UnsupportedSource: 'unsupported_source',
  AuthenticationRequired: 'authentication_required',
  ProtectedMedia: 'protected_media',
  UnsupportedSelection: 'unsupported_selection',
  ProbeFailed: 'probe_failed',
} as const;

export type MediaErrorCode = (typeof MediaErrorCode)[keyof typeof MediaErrorCode];

/** Websocket notification method names emitted by the RPC server. */
export const RpcEvent = {
  OnDownloadStart: 'aria2.onDownloadStart',
  OnDownloadPause: 'aria2.onDownloadPause',
  OnDownloadStop: 'aria2.onDownloadStop',
  OnDownloadComplete: 'aria2.onDownloadComplete',
  OnDownloadError: 'aria2.onDownloadError',
  OnBtDownloadComplete: 'aria2.onBtDownloadComplete',
} as const;

export type RpcEvent = (typeof RpcEvent)[keyof typeof RpcEvent];

export const RPC_EVENT_NAMES: readonly RpcEvent[] = Object.values(RpcEvent);

/** Client-side connection state machine (mirrors AriaNg's `taskContext.rpcStatus`). */
export const RpcStatus = {
  Connecting: 'Connecting',
  Connected: 'Connected',
  Disconnected: 'Disconnected',
  Reconnecting: 'Reconnecting',
  WaitingToReconnect: 'Waiting to reconnect',
} as const;

export type RpcStatus = (typeof RpcStatus)[keyof typeof RpcStatus];

/** Only the original `Unauthorized` error is special-cased, exactly like AriaNg. */
export const RPC_ERROR_UNAUTHORIZED = 'Unauthorized';
