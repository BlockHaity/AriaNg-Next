/**
 * The aria2 / aria2-next JSON-RPC client.
 *
 * Faithful port of AriaNg's `aria2RpcService` (`src/scripts/services/`), split
 * into two layers:
 *
 *  - the **transport** (`./transport/*`) only puts envelopes on the wire;
 *  - this class owns aria2 semantics: method name qualification, the RPC
 *    secret, option bags, the connection state machine, event fan-out and the
 *    promise-shaped `RpcResult` API consumed by the stores.
 *
 * Every public call resolves — it never rejects — so a UI can `await` a call
 * without a `try`/`catch` around every interaction (AriaNg forced
 * `errorCallback` plumbing through every single call site).
 *
 * Documented deviations from AriaNg:
 *  - `system.multicall` entries are `[methodName, params]` tuples.  AriaNg
 *    serialised `{methodName, params}` objects, which aria2 silently rejects.
 *  - `onConnectionChange` / `onEvent` return an `Unsubscribe`; AriaNg had no
 *    way to remove a listener.
 *  - The RPC secret is also sent as `Authorization: Bearer <token>`.
 *  - The version is cached after the first success instead of being re-fetched.
 */

import type { RpcProfile } from '@/config/types';
import type {
  Aria2Client,
  BatchOutcome,
  ConnectionState,
  RpcError,
  RpcEventPayload,
  RpcRequestContext,
  RpcResult,
  Unsubscribe,
} from './contract';
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
import type { RpcEvent } from '@/config/rpc-constants';
import type { ManagedRpcTransport, TransportCloseEvent } from './transport/types';
import {
  RPC_EVENT_NAMES,
  RPC_SERVICE_NAME,
  RPC_SERVICE_VERSION,
  RPC_SYSTEM_SERVICE_NAME,
  RPC_TOKEN_PREFIX,
  RpcStatus,
} from '@/config/rpc-constants';
import {
  createTransport,
  generateUniqueId,
  isSystemMethod,
  RPC_CONNECT_ERROR,
  RPC_PROFILE_CHANGED,
} from './transport';
// Reuse the shared normaliser (owned by the errors module) so the tip-key table
// lives in exactly one place instead of being duplicated per transport.
import { mapRpcError } from './errors';
// Same for the method-name registry: `getAria2MethodFullName` already implements
// the AriaNg `checkIsSystemMethod() ? name : 'aria2.' + name` rule, including the
// `system.multicall` case which is not in `RPC_METHOD_CATALOG`.
import { getAria2MethodFullName } from './catalog';
// `joinIndexes` turns a 1-based index array into aria2's `select-file` value.
import { joinIndexes } from './params';

/** Methods whose option bag is the first plain-object parameter. */
const PAUSE_INJECT_METHODS = new Set(['addUri', 'addTorrent', 'addMetalink']);

/** `pauseOnAdded` — "Download Later". */
const PAUSE_ON_ADDED = 'true';

/** Options bag used when a caller passes none. */
const EMPTY_OPTIONS: Aria2OptionMap = {};

export interface Aria2ClientOptions {
  profile: RpcProfile;
  /** `0` disables websocket auto-reconnect (AriaNg's `webSocketReconnectInterval`). */
  webSocketReconnectInterval: number;
  /** Invoked for non-silent failures so the shell can raise a toast. */
  onError?: (error: RpcError, context: RpcRequestContext) => void;
}

/**
 * A request currently on the wire.
 *
 * The client aborts these on `disconnect()` / `connect()` so a caller awaiting
 * a reply from the previous RPC server never hangs.
 */
interface InFlightRequest {
  /** Local abort (profile switch / disconnect) — never raises a toast. */
  abort(error: RpcError): void;
}

export class Aria2ClientImpl implements Aria2Client {
  #profile: RpcProfile;
  #reconnectInterval: number;
  #onError: Aria2ClientOptions['onError'];

  #transport: ManagedRpcTransport | null = null;
  /** Bumped on every (re)connect so stale transport callbacks are ignored. */
  #generation = 0;

  #status: RpcStatus = RpcStatus.Connecting;
  #attempt = 0;
  #lastError: string | undefined;

  readonly #connectionListeners = new Set<(state: ConnectionState) => void>();
  readonly #eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  readonly #knownEvents = new Set<string>(RPC_EVENT_NAMES);
  readonly #inFlight = new Map<string, InFlightRequest>();

  #cachedVersion: Aria2VersionInfo | null = null;

  constructor(options: Aria2ClientOptions) {
    this.#profile = options.profile;
    this.#reconnectInterval = options.webSocketReconnectInterval ?? 0;
    this.#onError = options.onError;

    this.connect(options.profile, { reconnectInterval: options.webSocketReconnectInterval });
  }

  /* ================================================================ */
  /* lifecycle                                                         */
  /* ================================================================ */

  get profile(): RpcProfile {
    return this.#profile;
  }

  get connection(): ConnectionState {
    const state: ConnectionState = { status: this.#status, attempt: this.#attempt };
    if (this.#lastError !== undefined) state.lastError = this.#lastError;
    return state;
  }

  get supportsNotifications(): boolean {
    return this.#transport?.supportsNotifications ?? false;
  }

  /** Last successful `getVersion()` payload, or `null` when not known yet. */
  get cachedVersion(): Aria2VersionInfo | null {
    return this.#cachedVersion;
  }

  /**
   * Hot switch: the previous transport is torn down *and* its in-flight
   * requests are failed immediately with {@link RPC_PROFILE_CHANGED}, so a
   * pending `tellStatus` never resolves against the new server.
   */
  connect(profile: RpcProfile, options?: { reconnectInterval: number }): void {
    const interval = options?.reconnectInterval ?? this.#reconnectInterval;

    this.#teardown(RPC_PROFILE_CHANGED);
    this.#profile = profile;
    this.#reconnectInterval = interval;
    this.#cachedVersion = null;
    this.#attempt = 0;
    this.#lastError = undefined;
    this.#updateStatus(RpcStatus.Connecting);

    this.#transport = this.#createTransport();
    this.#transport.open();
  }

  disconnect(): void {
    this.#teardown(RPC_CONNECT_ERROR);
    this.#attempt = 0;
    this.#lastError = RPC_CONNECT_ERROR;
    this.#updateStatus(RpcStatus.Disconnected);
  }

  /** Manual reconnect.  `reconnectInterval` is irrelevant here — we go now. */
  reconnect(): void {
    if (!this.#transport) {
      this.#lastError = RPC_CONNECT_ERROR;
      this.#updateStatus(RpcStatus.Disconnected);
      return;
    }

    this.#attempt += 1;
    this.#lastError = undefined;
    this.#updateStatus(RpcStatus.Reconnecting);

    // The old socket has to go before the new one is created, otherwise the
    // client ends up holding two live transports.
    this.#transport.close();
    const transport = this.#createTransport();
    this.#transport = transport;
    transport.open();
  }

  onConnectionChange(listener: (state: ConnectionState) => void): Unsubscribe {
    this.#connectionListeners.add(listener);
    return () => {
      this.#connectionListeners.delete(listener);
    };
  }

  onEvent<K extends RpcEvent>(event: K, listener: (payload: RpcEventPayload<K>) => void): Unsubscribe {
    let listeners = this.#eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#eventListeners.set(event, listeners);
    }

    const wrapper = (payload: unknown): void => listener(payload as RpcEventPayload<K>);
    listeners.add(wrapper);

    return () => {
      this.#eventListeners.get(event)?.delete(wrapper);
    };
  }

  /* ================================================================ */
  /* raw invocation                                                    */
  /* ================================================================ */

  buildCall(context: RpcRequestContext): [string, unknown[]] {
    return this.#buildCall(context);
  }

  async invoke<T = unknown>(context: RpcRequestContext): Promise<RpcResult<T>> {
    const [method, params] = this.#buildCall(context);
    return this.#sendRequest<T>(context, method, params);
  }

  /**
   * `system.multicall` convenience.
   *
   * Every entry is built through {@link buildCall}, i.e. it carries its own
   * `token:<secret>` — aria2 wants exactly that for the inner calls, and the
   * outer `system.*` call must NOT have one.
   */
  async multicall<T = unknown>(contexts: RpcRequestContext[]): Promise<RpcResult<T>> {
    const calls = contexts.map((context) => this.#buildCall(context));
    return this.#sendRequest<T>({ method: `${RPC_SYSTEM_SERVICE_NAME}.multicall` }, `${RPC_SYSTEM_SERVICE_NAME}.multicall`, [calls]);
  }

  /* ================================================================ */
  /* task lifecycle                                                    */
  /* ================================================================ */

  addUri(urls: string[], options?: Aria2OptionMap, position?: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'addUri', params: [urls, options ?? EMPTY_OPTIONS, position] });
  }

  addTorrent(
    content: string,
    uris: string[],
    options?: Aria2OptionMap,
    position?: string,
  ): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'addTorrent', params: [content, uris, options ?? EMPTY_OPTIONS, position] });
  }

  addMetalink(content: string, options?: Aria2OptionMap, position?: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'addMetalink', params: [content, options ?? EMPTY_OPTIONS, position] });
  }

  inspectTorrent(content: string): Promise<RpcResult<unknown>> {
    return this.invoke({ method: 'inspectTorrent', params: [content] });
  }

  remove(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'remove', params: [gid] });
  }

  forceRemove(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'forceRemove', params: [gid] });
  }

  pause(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'pause', params: [gid] });
  }

  pauseAll(): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'pauseAll' });
  }

  forcePause(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'forcePause', params: [gid] });
  }

  forcePauseAll(): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'forcePauseAll' });
  }

  unpause(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'unpause', params: [gid] });
  }

  unpauseAll(): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'unpauseAll' });
  }

  changePosition(
    gid: string,
    pos: number,
    how?: 'POS_SET' | 'POS_CUR',
  ): Promise<RpcResult<number>> {
    return this.invoke<number>({ method: 'changePosition', params: [gid, pos, how] });
  }

  changeUri(
    gid: string,
    fileIndex: string,
    delUris: string[],
    addUris: string[],
    position?: string,
  ): Promise<RpcResult<unknown>> {
    return this.invoke({ method: 'changeUri', params: [gid, fileIndex, delUris, addUris, position] });
  }

  /**
   * Chooses which files of a torrent to download.
   *
   * There is **no** `aria2.selectFile` RPC method — verified against the
   * aria2-next manual, which documents `--select-file=<INDEX>...` as an option
   * and states: "Set `select-file` through `aria2.changeOption`" (and that a
   * magnet task reporting `bittorrent.fileSelectionState === 'awaiting'` must
   * not be unpaused until changeOption sets a valid `select-file`).
   *
   * Indexes are 1-based aria2 file indexes.
   */
  selectFile(gid: string, indexes: number[]): Promise<RpcResult<string>> {
    return this.invoke<string>({
      method: 'changeOption',
      params: [gid, { 'select-file': joinIndexes(indexes) }],
    });
  }

  purgeDownloadResult(): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'purgeDownloadResult' });
  }

  removeDownloadResult(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'removeDownloadResult', params: [gid] });
  }

  /* ================================================================ */
  /* queries                                                           */
  /* ================================================================ */

  tellStatus(gid: string, keys?: readonly string[]): Promise<RpcResult<Aria2TaskStatusResult>> {
    return this.invoke<Aria2TaskStatusResult>({ method: 'tellStatus', params: [gid, keys] });
  }

  tellActive(keys?: readonly string[]): Promise<RpcResult<Aria2TaskStatusResult[]>> {
    return this.invoke<Aria2TaskStatusResult[]>({ method: 'tellActive', params: [keys], silent: true });
  }

  tellWaiting(
    offset: number,
    num: number,
    keys?: readonly string[],
  ): Promise<RpcResult<Aria2TaskStatusResult[]>> {
    return this.invoke<Aria2TaskStatusResult[]>({ method: 'tellWaiting', params: [offset, num, keys], silent: true });
  }

  tellStopped(
    offset: number,
    num: number,
    keys?: readonly string[],
  ): Promise<RpcResult<Aria2TaskStatusResult[]>> {
    return this.invoke<Aria2TaskStatusResult[]>({ method: 'tellStopped', params: [offset, num, keys], silent: true });
  }

  getUris(gid: string): Promise<RpcResult<unknown>> {
    return this.invoke({ method: 'getUris', params: [gid], silent: true });
  }

  getFiles(gid: string): Promise<RpcResult<Aria2File[]>> {
    return this.invoke<Aria2File[]>({ method: 'getFiles', params: [gid], silent: true });
  }

  getPeers(gid: string): Promise<RpcResult<Aria2Peer[]>> {
    return this.invoke<Aria2Peer[]>({ method: 'getPeers', params: [gid], silent: true });
  }

  getServers(gid: string): Promise<RpcResult<unknown[]>> {
    return this.invoke<unknown[]>({ method: 'getServers', params: [gid], silent: true });
  }

  getOption(gid: string): Promise<RpcResult<Aria2OptionMap>> {
    return this.invoke<Aria2OptionMap>({ method: 'getOption', params: [gid] });
  }

  changeOption(gid: string, options: Aria2OptionMap): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'changeOption', params: [gid, options] });
  }

  getGlobalOption(): Promise<RpcResult<Aria2OptionMap>> {
    return this.invoke<Aria2OptionMap>({ method: 'getGlobalOption' });
  }

  changeGlobalOption(options: Aria2OptionMap): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'changeGlobalOption', params: [options] });
  }

  getGlobalStat(): Promise<RpcResult<Aria2GlobalStat>> {
    return this.invoke<Aria2GlobalStat>({ method: 'getGlobalStat', silent: true });
  }

  async getVersion(): Promise<RpcResult<Aria2VersionInfo>> {
    const result = await this.invoke<Aria2VersionInfo>({ method: 'getVersion', silent: true });
    if (result.success) this.#cachedVersion = result.data;
    return result;
  }

  /** Cache-first variant of {@link getVersion}; resolves `null` on failure. */
  async getVersionCached(): Promise<Aria2VersionInfo | null> {
    if (this.#cachedVersion) return this.#cachedVersion;
    const result = await this.getVersion();
    return result.success ? result.data : null;
  }

  getSessionInfo(): Promise<RpcResult<Aria2SessionInfo>> {
    return this.invoke<Aria2SessionInfo>({ method: 'getSessionInfo', silent: true });
  }

  saveSession(): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'saveSession' });
  }

  shutdown(): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'shutdown' });
  }

  forceShutdown(): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'forceShutdown' });
  }

  listMethods(): Promise<RpcResult<string[]>> {
    return this.invoke<string[]>({ method: `${RPC_SYSTEM_SERVICE_NAME}.listMethods`, silent: true });
  }

  listNotifications(): Promise<RpcResult<string[]>> {
    return this.invoke<string[]>({ method: `${RPC_SYSTEM_SERVICE_NAME}.listNotifications`, silent: true });
  }

  /* ================================================================ */
  /* bittorrent extras                                                 */
  /* ================================================================ */

  getBtTrackers(gid: string): Promise<RpcResult<unknown[]>> {
    return this.invoke<unknown[]>({ method: 'getBtTrackers', params: [gid], silent: true });
  }

  forceBtAnnounce(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'forceBtAnnounce', params: [gid] });
  }

  addBtPeers(gid: string, peers: string[]): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'addBtPeers', params: [gid, peers] });
  }

  getBtSessionStatus(): Promise<RpcResult<unknown>> {
    return this.invoke({ method: 'getBtSessionStatus', silent: true });
  }

  forceBtRecheck(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'forceBtRecheck', params: [gid] });
  }

  /* ================================================================ */
  /* aria2-next: media                                                */
  /* ================================================================ */

  finishMedia(gid: string): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'finishMedia', params: [gid] });
  }

  retryMedia(gid: string, options?: Aria2OptionMap): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'retryMedia', params: [gid, options ?? EMPTY_OPTIONS] });
  }

  resolveFilename(url: string, contentDisposition?: number[]): Promise<RpcResult<Aria2ResolveFilenameResult>> {
    return this.invoke<Aria2ResolveFilenameResult>({ method: 'resolveFilename', params: [url, contentDisposition] });
  }

  /* ================================================================ */
  /* aria2-next: ed2k                                                  */
  /* ================================================================ */

  ed2kSearch(keyword: string, options?: Aria2OptionMap): Promise<RpcResult<string>> {
    return this.invoke<string>({ method: 'ed2kSearch', params: [keyword, options ?? EMPTY_OPTIONS] });
  }

  getEd2kSearchResults(gid: string): Promise<RpcResult<Aria2Ed2kSearchState>> {
    return this.invoke<Aria2Ed2kSearchState>({ method: 'getEd2kSearchResults', params: [gid], silent: true });
  }

  /* ================================================================ */
  /* batching                                                          */
  /* ================================================================ */

  unpauseMany(gids: string[]): Promise<RpcResult<BatchOutcome>> {
    return this.#runMany(gids, (gid) => this.unpause(gid));
  }

  forcePauseMany(gids: string[]): Promise<RpcResult<BatchOutcome>> {
    return this.#runMany(gids, (gid) => this.forcePause(gid));
  }

  forceRemoveMany(gids: string[]): Promise<RpcResult<BatchOutcome>> {
    return this.#runMany(gids, (gid) => this.forceRemove(gid));
  }

  removeDownloadResultMany(gids: string[]): Promise<RpcResult<BatchOutcome>> {
    return this.#runMany(gids, (gid) => this.removeDownloadResult(gid));
  }

  async addUriMany(
    entries: { urls: string[]; options?: Aria2OptionMap }[],
  ): Promise<RpcResult<BatchOutcome & { gids: string[] }>> {
    const gids: string[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const entry of entries) {
      const result = await this.addUri(entry.urls, entry.options);
      if (!result.success) {
        failedCount += 1;
        continue;
      }
      successCount += 1;
      // Keep gids aligned with the request order so the caller can match them
      // back to the entries it passed in.
      if (typeof result.data === 'string') gids.push(result.data);
    }

    return {
      success: true,
      context: { method: 'addUriMany' },
      data: { ...countOutcome(successCount, failedCount), gids },
    };
  }

  /**
   * Sequential batch runner.
   *
   * AriaNg's `invokeMulti` fired every request at once and only aggregated the
   * `success` flags; aria2 handles bursts fine but the outcome ordering was
   * lost and a burst of 500 `forceRemove`s stalls the ui.  Chaining keeps the
   * call ordering observable and matches the `retryTasks` pattern.
   */
  async #runMany(
    gids: string[],
    action: (gid: string) => Promise<RpcResult<unknown>>,
  ): Promise<RpcResult<BatchOutcome>> {
    let successCount = 0;
    let failedCount = 0;

    for (const gid of gids) {
      const result = await action(gid);
      if (result.success) successCount += 1;
      else failedCount += 1;
    }

    return {
      success: true,
      context: { method: 'batch', silent: true },
      data: countOutcome(successCount, failedCount),
    };
  }

  /* ================================================================ */
  /* internals: request construction                                  */
  /* ================================================================ */

  /**
   * `[fullMethodName, params]` — the exact tuple aria2's `system.multicall`
   * expects.  This is also the single place where the secret is injected, so a
   * multicall entry is self-contained.
   */
  #buildCall(context: RpcRequestContext): [string, unknown[]] {
    const method = qualifyMethod(context.method);
    const args = dropTrailingEmpty((context.params ?? []).slice());

    if (context.pauseOnAdded) injectPauseOption(method, args);

    const params: unknown[] = [];
    // AriaNg: `if (secret && !isSystemMethod) finalParams.push('token:' + secret)`.
    if (this.#profile.secret && !isSystemMethod(method)) {
      params.push(`${RPC_TOKEN_PREFIX}${this.#profile.secret}`);
    }
    params.push(...args);

    return [method, params];
  }

  #sendRequest<T>(context: RpcRequestContext, method: string, params: unknown[]): Promise<RpcResult<T>> {
    const request = { jsonrpc: RPC_SERVICE_VERSION, method, id: generateUniqueId(), params };

    return new Promise<RpcResult<T>>((resolve) => {
      let settled = false;

      // The result is built lazily: building an `RpcFailure` has side effects
      // (state machine + user-facing toast), and the transport may deliver a
      // late `onError` after `abort()` already settled us — that late call must
      // not raise a toast for a request nobody is waiting on anymore.
      const finish = (build: () => RpcResult<T>): void => {
        if (settled) return;
        settled = true;
        this.#inFlight.delete(request.id);
        resolve(build());
      };

      this.#inFlight.set(request.id, {
        abort: (error) => finish(() => ({ success: false, error, context })),
      });

      const transport = this.#transport;
      if (!transport) {
        finish(() => this.#failure(context, RPC_CONNECT_ERROR));
        return;
      }

      try {
        transport.send(request, {
          onResult: (payload) => finish(() => this.#onResult(context, payload)),
          onError: (error) => finish(() => this.#failure(context, error.message, error.code)),
          onOpen: () => this.#handleOpen(),
          onClose: (event) => this.#handleClose(event),
          onNotification: (notificationMethod, notificationParams) =>
            this.#handleNotification(notificationMethod, notificationParams),
        });
      } catch (error) {
        finish(() => this.#failure(context, errorMessageOf(error)));
      }
    });
  }

  #onResult<T>(context: RpcRequestContext, payload: { result?: unknown; error?: { code?: number; message: string } }): RpcResult<T> {
    const error = payload.error;

    if (error) {
      // A JSON-RPC error means the round trip worked, so the connection stays
      // usable — AriaNg kept its `isConnected` latch in the same spirit.
      return this.#failure(context, error.message, error.code);
    }

    this.#lastError = undefined;
    this.#attempt = 0;
    this.#updateStatus(RpcStatus.Connected);

    return { success: true, data: payload.result as T, context };
  }

  /**
   * Builds an `RpcFailure` and, unless the call was marked `silent`, reports it
   * to the error hook.  `silent` mirrors AriaNg's
   * `if (!innerContext.silent) processError(error)`.
   */
#failure(context: RpcRequestContext, message: string, code?: number): RpcResult<never> {
    // Only a transport-level failure moves the state machine; a JSON-RPC error
    // means the daemon answered, so the connection stays usable.
    if (message === RPC_CONNECT_ERROR) this.#handleClose({ reason: message });

    const error: RpcError = mapRpcError(code === undefined ? message : { code, message });

    if (!context.silent) this.#onError?.(error, context);

    return { success: false, error, context };
  }

  /* ================================================================ */
  /* internals: connection state machine                              */
  /* ================================================================ */

  #createTransport(): ManagedRpcTransport {
    const generation = ++this.#generation;

    return createTransport({
      profile: this.#profile,
      reconnectInterval: this.#reconnectInterval,
      onOpen: () => {
        if (generation === this.#generation) this.#handleOpen();
      },
      onClose: (event) => {
        if (generation === this.#generation) this.#handleClose(event);
      },
      onNotification: (method, params) => {
        if (generation === this.#generation) this.#handleNotification(method, params);
      },
      onReconnecting: () => {
        if (generation === this.#generation) {
          this.#attempt += 1;
          this.#updateStatus(RpcStatus.Reconnecting);
        }
      },
    });
  }

  #teardown(message: string): void {
    for (const [id, entry] of [...this.#inFlight]) {
      this.#inFlight.delete(id);
      entry.abort({ message });
    }

    this.#generation += 1;
    this.#transport?.close();
    this.#transport = null;
  }

  #handleOpen(): void {
    this.#lastError = undefined;
    this.#attempt = 0;
    this.#updateStatus(RpcStatus.Connected);
  }

  #handleClose(event?: TransportCloseEvent): void {
    if (event?.reason) this.#lastError = event.reason;
    else this.#lastError = RPC_CONNECT_ERROR;

    // Only the websocket transport can bring itself back; AriaNg's
    // `canReconnect()` returned `false` for the HTTP service for the same
    // reason.
    if (this.#reconnectInterval > 0 && this.#transport?.kind === 'websocket') {
      this.#updateStatus(RpcStatus.WaitingToReconnect);
      return;
    }

    this.#updateStatus(RpcStatus.Disconnected);
  }

  #updateStatus(status: RpcStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    this.#emitConnectionChange();
  }

  #emitConnectionChange(): void {
    if (this.#connectionListeners.size === 0) return;
    const state = this.connection;
    for (const listener of [...this.#connectionListeners]) listener(state);
  }

  /* ================================================================ */
  /* internals: events                                                */
  /* ================================================================ */

  #handleNotification(method: string, params: unknown[]): void {
    // aria2 always sends the payload as `params[0]`.
    const payload = params.length > 0 ? params[0] : undefined;
    const listeners = this.#eventListeners.get(method);
    if (!listeners || !this.#knownEvents.has(method)) return;

    for (const listener of [...listeners]) listener(payload);
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * `tellStatus` → `aria2.tellStatus`, `system.listMethods` → unchanged.
 * AriaNg: `checkIsSystemMethod() ? methodName : 'aria2.' + methodName`.
 * Delegated to the catalogue so the client and the debug page cannot disagree.
 */
function qualifyMethod(method: string): string {
  return getAria2MethodFullName(method);
}

/**
 * aria2 rejects `null` placeholders, so the optional trailing arguments
 * (`position`, `how`, `keys`, …) must not be sent.  Only the tail is trimmed:
 * an intentional `null` in the middle would be a caller bug we do not hide.
 */
function dropTrailingEmpty(params: unknown[]): unknown[] {
  let end = params.length;
  while (end > 0) {
    const value = params[end - 1];
    if (value !== null && value !== undefined) break;
    end -= 1;
  }
  return params.slice(0, end);
}

/**
 * `pauseOnAdded` → `options.pause = 'true'`.
 *
 * The option bag is the first plain-object parameter of `addUri` / `addTorrent`
 * / `addMetalink` (AriaNg merged it in `buildRequestOptions`, i.e. *before* the
 * request context was built and therefore before the token was prepended).
 */
function injectPauseOption(method: string, params: unknown[]): void {
  if (!PAUSE_INJECT_METHODS.has(bareMethodName(method))) return;

  for (let i = 0; i < params.length; i++) {
    const value = params[i];
    if (isPlainObject(value)) {
      params[i] = { ...value, pause: PAUSE_ON_ADDED };
      return;
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `aria2.tellStatus` → `tellStatus`. */
function bareMethodName(method: string): string {
  const prefix = `${RPC_SERVICE_NAME}.`;
  return method.startsWith(prefix) ? method.slice(prefix.length) : method;
}

function countOutcome(successCount: number, failedCount: number): BatchOutcome {
  return { successCount, failedCount, hasSuccess: successCount > 0, hasError: failedCount > 0 };
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return RPC_CONNECT_ERROR;
}