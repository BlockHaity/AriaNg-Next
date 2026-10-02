/**
 * WebSocket / Secure WebSocket JSON-RPC transport.
 *
 * Ported from AriaNg's `src/scripts/services/aria2WebSocketRpcService.js`, but
 * restructured around a single explicitly owned socket plus a *real* reconnect
 * scheduler:
 *
 *  - AriaNg handed `maxTimeout: 1` and `reconnectInterval: N` to angular
 *    `$websocket`, which kept its own (dead, unread) config and only ever used
 *    them inside its internal state machine.  Here the interval drives one
 *    single-flight timer that this class owns, and `0` means "do not retry"
 *    (the close is then reported as a hard failure, exactly like AriaNg's
 *    `connectionFailedCallback` branch).
 *  - In-flight ids are tracked so `close()` can reject every pending request;
 *    AriaNg only did that from `reconnect()` and leaked the rest.
 *  - Messages are dispatched on the *presence of `id`* instead of the truthiness
 *    of `result`.  AriaNg treated `0`, `''`, `false` and `null` results as
 *    failures (`if (content.result && ...)`), which silently broke every method
 *    returning a falsy value.
 */

import type { RpcProfile } from '@/config/types';
import type {
  JsonRpcResponse,
  ManagedRpcTransport,
  SerializedRequest,
  TransportCloseEvent,
  TransportConnectionHandlers,
  TransportHandlers,
} from './types';
import { isRecord, RPC_CONNECT_ERROR, RPC_WEBSOCKET_INIT_ERROR, withSecretToken } from './types';

/** AriaNg's `websocketStatusConnecting` / `websocketStatusOpen`. */
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/** Upper bound for frames buffered while the socket is still connecting. */
const MAX_OUTBOX = 256;

export interface WebSocketTransportOptions extends TransportConnectionHandlers {
  profile: RpcProfile;
  /** ms; `0` disables auto-reconnect (AriaNg's `webSocketReconnectInterval`). */
  reconnectInterval?: number;
  /** Injection seam for tests / alternative socket implementations. */
  socketFactory?: (url: string) => WebSocket;
}

interface QueuedRequest {
  request: SerializedRequest;
  handlers: TransportHandlers;
}

export class WebSocketRpcTransport implements ManagedRpcTransport {
  readonly kind = 'websocket' as const;
  readonly supportsNotifications = true;

  readonly #url: string;
  readonly #profile: RpcProfile;
  readonly #reconnectInterval: number;
  readonly #socketFactory: (url: string) => WebSocket;
  readonly #onOpen: (() => void) | undefined;
  readonly #onClose: ((event?: TransportCloseEvent) => void) | undefined;
  readonly #onNotification: ((method: string, params: unknown[]) => void) | undefined;
  readonly #onReconnecting: (() => void) | undefined;

  readonly #pending = new Map<string, TransportHandlers>();
  #outbox: QueuedRequest[] = [];
  #socket: WebSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #initError: string | null = null;
  #connected = false;
  #disposed = false;

  constructor(options: WebSocketTransportOptions) {
    this.#profile = options.profile;
    this.#url = `${options.profile.protocol}://${options.profile.rpcHost}:${options.profile.rpcPort}/${options.profile.rpcInterface}`;
    this.#reconnectInterval = options.reconnectInterval ?? 0;
    this.#socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.#onOpen = options.onOpen;
    this.#onClose = options.onClose;
    this.#onNotification = options.onNotification;
    this.#onReconnecting = options.onReconnecting;
  }

  get connected(): boolean {
    return this.#connected;
  }

  get url(): string {
    return this.#url;
  }

  open(): void {
    if (this.#disposed) return;
    this.#ensureSocket();
  }

  send(request: SerializedRequest, handlers: TransportHandlers): void {
    // AriaNg's `getSocketClient` returned `{success:false, error:'Cannot
    // initialize WebSocket!'}` and `request()` reported it through the *first*
    // request that hit the failure.  Keep that exact message.
    if (this.#initError) {
      handlers.onError({ message: this.#initError }, request.id);
      return;
    }

    const socket = this.#ensureSocket();
    if (!socket) {
      handlers.onError({ message: this.#initError ?? RPC_WEBSOCKET_INIT_ERROR }, request.id);
      return;
    }

    this.#pending.set(request.id, handlers);

    if (socket.readyState === SOCKET_OPEN) {
      this.#write(socket, request);
      return;
    }

    // Still handshaking: buffer and flush from `onopen` (angular `$websocket`
    // did the same, which is why the first aria2 call never failed).
    if (socket.readyState === SOCKET_CONNECTING) {
      this.#enqueue(request, handlers);
      return;
    }

    // CLOSING / CLOSED: keep the frame and let the reconnect pump deliver it,
    // unless the socket is gone for good.
    this.#enqueue(request, handlers);
    this.#scheduleReconnect();
  }

  close(): void {
    this.#disposed = true;
    this.#clearReconnectTimer();

    this.#failAllPending({ message: RPC_CONNECT_ERROR });
    this.#outbox = [];

    const socket = this.#socket;
    this.#socket = null;
    this.#connected = false;

    if (socket) {
      // Detach first: a `close()` triggered by us must not be reported as a
      // lost connection to the client that just asked for it.
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING) socket.close();
    }
  }

  /* ---------------- socket lifecycle ---------------- */

  #ensureSocket(): WebSocket | null {
    if (this.#disposed) return null;
    if (this.#socket) return this.#socket;

    let socket: WebSocket;
    this.#initError = null;
    try {
      socket = this.#socketFactory(this.#url);
    } catch {
      this.#initError = RPC_WEBSOCKET_INIT_ERROR;
      return null;
    }

    this.#socket = socket;
    socket.onopen = () => this.#handleOpen();
    socket.onclose = (event: CloseEvent) => this.#handleClose(event);
    // Browsers always fire `close` after `error`; there is nothing to add.
    socket.onerror = () => undefined;
    socket.onmessage = (event: MessageEvent) => this.#handleMessage(event);

    return socket;
  }

  #handleOpen(): void {
    this.#connected = true;
    this.#clearReconnectTimer();

    const queued = this.#outbox;
    this.#outbox = [];
    const socket = this.#socket;
    if (socket) {
      for (const item of queued) this.#write(socket, item.request);
    }

    this.#onOpen?.();
  }

  #handleClose(event?: CloseEvent): void {
    this.#connected = false;
    this.#socket = null;

    // Every request that was on the wire is lost with the socket.
    this.#failAllPending({ message: RPC_CONNECT_ERROR });

    const closeEvent: TransportCloseEvent = { code: event?.code, reason: event?.reason };
    this.#onClose?.(closeEvent);

    if (this.#disposed || this.#reconnectInterval <= 0) return;
    this.#scheduleReconnect();
  }

  /**
   * Single-flight reconnect timer.
   *
   * AriaNg guarded with `pendingReconnect`, but it only ever replaced a
   * *brand new* `$websocket` instance (the factory captured the closure of its
   * first creation, so a real reconnect was impossible without a page reload).
   */
  #scheduleReconnect(): void {
    if (this.#disposed || this.#reconnectInterval <= 0) return;
    if (this.#reconnectTimer !== null) return;

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#disposed) return;

      const current = this.#socket;
      if (current && (current.readyState === SOCKET_OPEN || current.readyState === SOCKET_CONNECTING)) return;

      this.#onReconnecting?.();

      if (!this.#ensureSocket()) {
        // A construction failure (bad url, blocked socket) is a configuration
        // problem, not a transient one — report it and stop retrying instead of
        // spinning forever.
        this.#onClose?.({ reason: RPC_WEBSOCKET_INIT_ERROR });
      }
    }, this.#reconnectInterval);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  /* ---------------- io ---------------- */

  #enqueue(request: SerializedRequest, handlers: TransportHandlers): void {
    // Drop the oldest frame rather than growing without bound while the socket
    // stays down; the client re-issues through its own scheduler anyway.
    if (this.#outbox.length >= MAX_OUTBOX) this.#outbox.shift();
    this.#outbox.push({ request, handlers });
  }

  #write(socket: WebSocket, request: SerializedRequest): void {
    socket.send(JSON.stringify({ ...request, params: withSecretToken(this.#profile, request) }));
  }

  #handleMessage(event: MessageEvent): void {
    const data: unknown = event.data;
    if (typeof data !== 'string') return;

    let content: unknown;
    try {
      content = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(content)) return;

    const id = content.id;
    if (typeof id === 'string' && id.length > 0) {
      const handlers = this.#pending.get(id);
      if (!handlers) return;
      this.#pending.delete(id);
      handlers.onResult(content as JsonRpcResponse);
      return;
    }

    const method = content.method;
    if (typeof method !== 'string' || method.length === 0) return;

    const rawParams = content.params;
    const params: unknown[] = Array.isArray(rawParams) ? (rawParams as unknown[]) : [];

    if (this.#onNotification) {
      this.#onNotification(method, params);
      return;
    }
    // Fallback so a caller that never configured a sink still observes the
    // server push while its own request is in flight.
    for (const handlers of [...this.#pending.values()]) {
      handlers.onNotification(method, params);
    }
  }

  #failAllPending(error: { message: string }): void {
    const queued = this.#outbox;
    this.#outbox = [];
    for (const item of queued) item.handlers.onError({ message: error.message }, item.request.id);

    for (const [id, handlers] of [...this.#pending]) {
      this.#pending.delete(id);
      handlers.onError({ message: error.message }, id);
    }
  }
}

export function createWebSocketTransport(options: WebSocketTransportOptions): WebSocketRpcTransport {
  return new WebSocketRpcTransport(options);
}