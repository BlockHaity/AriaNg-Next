/**
 * The high-level aria2 client contract.
 *
 * Everything above this file (stores, pages, components) depends ONLY on this
 * interface, never on the websocket / http transport.
 */

import type {
  Aria2Ed2kSearchState,
  Aria2File,
  Aria2GlobalStat,
  Aria2OptionMap,
  Aria2Peer,
  Aria2ResolveFilenameResult,
  Aria2SessionInfo,
  Aria2TaskStatusResult,
  Aria2VersionInfo,
} from './types';
import type { RpcProfile } from '@/config/types';
import type { RpcEvent, RpcStatus } from '@/config/rpc-constants';

export interface RpcError {
  code?: number;
  message: string;
  /** Translation key for well-known errors (e.g. `rpc.error.unauthorized`). */
  tipTextKey?: string;
}

export interface RpcRequestContext {
  /** Bare method name, e.g. `tellStatus` (system methods pass `system.listMethods`). */
  method: string;
  params?: unknown[];
  /** Suppress user-facing error toasts for this call. */
  silent?: boolean;
  /** `pause: 'true'` is injected for "Download Later". */
  pauseOnAdded?: boolean;
}

export interface RpcSuccess<T> {
  success: true;
  data: T;
  context: RpcRequestContext;
}

export interface RpcFailure {
  success: false;
  error: RpcError;
  context: RpcRequestContext;
}

export type RpcResult<T> = RpcSuccess<T> | RpcFailure;

/** Basic task fields — enough to render the list without heavy payloads. */
export const BASIC_TASK_PARAMS = [
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
] as const;

export const FULL_TASK_PARAMS = [...BASIC_TASK_PARAMS, 'files', 'bittorrent', 'infoHash'] as const;

/** Extra fields aria2-next adds on top of AriaNg's full set. */
export const ARIA2_NEXT_TASK_PARAMS = [
  'errorMessage',
  'media',
  'ed2k',
  'dir',
  'following',
  'belongsTo',
] as const;

export interface ConnectionState {
  status: RpcStatus;
  /** Last transport-level error message, if any. */
  lastError?: string;
  /** Consecutive reconnect attempts. */
  attempt: number;
}

export interface RpcEventPayloads {
  'aria2.onDownloadStart': { gid: string };
  'aria2.onDownloadPause': { gid: string };
  'aria2.onDownloadStop': { gid: string };
  'aria2.onDownloadComplete': { gid: string };
  'aria2.onDownloadError': { gid: string };
  'aria2.onBtDownloadComplete': { gid: string };
}

export type RpcEventPayload<K extends RpcEvent> = RpcEventPayloads[K];

/** Unsubscribes every listener registered by an `on*` call. */
export type Unsubscribe = () => void;

export interface Aria2Client {
  /* ---- lifecycle ---- */
  readonly profile: RpcProfile;
  readonly connection: ConnectionState;
  readonly supportsNotifications: boolean;
  /** Swap the active profile / transport at runtime (hot switch). */
  connect(profile: RpcProfile, options?: { reconnectInterval: number }): void;
  disconnect(): void;
  reconnect(): void;
  onConnectionChange(listener: (state: ConnectionState) => void): Unsubscribe;
  onEvent<K extends RpcEvent>(event: K, listener: (payload: RpcEventPayload<K>) => void): Unsubscribe;

  /* ---- raw invocation ---- */
  invoke<T = unknown>(context: RpcRequestContext): Promise<RpcResult<T>>;
  /** Builds a `system.multicall` payload without sending it. */
  buildCall(context: RpcRequestContext): [string, unknown[]];

  /* ---- task lifecycle ---- */
  addUri(urls: string[], options?: Aria2OptionMap, position?: string): Promise<RpcResult<string>>;
  addTorrent(content: string, uris: string[], options?: Aria2OptionMap, position?: string): Promise<RpcResult<string>>;
  addMetalink(content: string, options?: Aria2OptionMap, position?: string): Promise<RpcResult<string>>;
  inspectTorrent(content: string): Promise<RpcResult<unknown>>;

  remove(gid: string): Promise<RpcResult<string>>;
  forceRemove(gid: string): Promise<RpcResult<string>>;
  pause(gid: string): Promise<RpcResult<string>>;
  pauseAll(): Promise<RpcResult<string>>;
  forcePause(gid: string): Promise<RpcResult<string>>;
  forcePauseAll(): Promise<RpcResult<string>>;
  unpause(gid: string): Promise<RpcResult<string>>;
  unpauseAll(): Promise<RpcResult<string>>;
  changePosition(gid: string, pos: number, how?: 'POS_SET' | 'POS_CUR'): Promise<RpcResult<number>>;
  changeUri(
    gid: string,
    fileIndex: string,
    delUris: string[],
    addUris: string[],
    position?: string,
  ): Promise<RpcResult<unknown>>;
  selectFile(gid: string, indexes: number[]): Promise<RpcResult<string>>;

  purgeDownloadResult(): Promise<RpcResult<string>>;
  removeDownloadResult(gid: string): Promise<RpcResult<string>>;

  /* ---- queries ---- */
  tellStatus(gid: string, keys?: readonly string[]): Promise<RpcResult<Aria2TaskStatusResult>>;
  tellActive(keys?: readonly string[]): Promise<RpcResult<Aria2TaskStatusResult[]>>;
  tellWaiting(
    offset: number,
    num: number,
    keys?: readonly string[],
  ): Promise<RpcResult<Aria2TaskStatusResult[]>>;
  tellStopped(
    offset: number,
    num: number,
    keys?: readonly string[],
  ): Promise<RpcResult<Aria2TaskStatusResult[]>>;
  getUris(gid: string): Promise<RpcResult<unknown>>;
  getFiles(gid: string): Promise<RpcResult<Aria2File[]>>;
  getPeers(gid: string): Promise<RpcResult<Aria2Peer[]>>;
  getServers(gid: string): Promise<RpcResult<unknown[]>>;
  getOption(gid: string): Promise<RpcResult<Aria2OptionMap>>;
  changeOption(gid: string, options: Aria2OptionMap): Promise<RpcResult<string>>;
  getGlobalOption(): Promise<RpcResult<Aria2OptionMap>>;
  changeGlobalOption(options: Aria2OptionMap): Promise<RpcResult<string>>;
  getGlobalStat(): Promise<RpcResult<Aria2GlobalStat>>;
  getVersion(): Promise<RpcResult<Aria2VersionInfo>>;
  getSessionInfo(): Promise<RpcResult<Aria2SessionInfo>>;
  saveSession(): Promise<RpcResult<string>>;
  shutdown(): Promise<RpcResult<string>>;
  forceShutdown(): Promise<RpcResult<string>>;
  listMethods(): Promise<RpcResult<string[]>>;
  listNotifications(): Promise<RpcResult<string[]>>;

  /* ---- bittorrent extras ---- */
  getBtTrackers(gid: string): Promise<RpcResult<unknown[]>>;
  forceBtAnnounce(gid: string): Promise<RpcResult<string>>;
  addBtPeers(gid: string, peers: string[]): Promise<RpcResult<string>>;
  getBtSessionStatus(): Promise<RpcResult<unknown>>;
  forceBtRecheck(gid: string): Promise<RpcResult<string>>;

  /* ---- aria2-next: media ---- */
  finishMedia(gid: string): Promise<RpcResult<string>>;
  retryMedia(gid: string, options?: Aria2OptionMap): Promise<RpcResult<string>>;
  resolveFilename(url: string, contentDisposition?: number[]): Promise<RpcResult<Aria2ResolveFilenameResult>>;

  /* ---- aria2-next: ed2k ---- */
  ed2kSearch(keyword: string, options?: Aria2OptionMap): Promise<RpcResult<string>>;
  getEd2kSearchResults(gid: string): Promise<RpcResult<Aria2Ed2kSearchState>>;

  /* ---- batching helpers ---- */
  unpauseMany(gids: string[]): Promise<RpcResult<BatchOutcome>>;
  forcePauseMany(gids: string[]): Promise<RpcResult<BatchOutcome>>;
  forceRemoveMany(gids: string[]): Promise<RpcResult<BatchOutcome>>;
  removeDownloadResultMany(gids: string[]): Promise<RpcResult<BatchOutcome>>;
  addUriMany(
    entries: { urls: string[]; options?: Aria2OptionMap }[],
  ): Promise<RpcResult<BatchOutcome & { gids: string[] }>>;
}

export interface BatchOutcome {
  successCount: number;
  failedCount: number;
  hasSuccess: boolean;
  hasError: boolean;
}
