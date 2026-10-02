/**
 * Transport primitives shared by the HTTP and WebSocket implementations.
 *
 * The transport layer is intentionally dumb: it knows how to put a JSON-RPC
 * envelope on the wire and how to hand the reply back, nothing about aria2
 * semantics, retries or UI state.  Everything above (`src/rpc/client.ts`) builds
 * on these three types only, which is what makes the two transports
 * hot-swappable at runtime.
 */

import { RPC_SYSTEM_SERVICE_NAME, RPC_TOKEN_PREFIX } from '@/config/rpc-constants';

/* ------------------------------------------------------------------ */
/* Wire envelopes                                                      */
/* ------------------------------------------------------------------ */

/** A JSON-RPC request that is ready to be serialised. */
export interface SerializedRequest {
  jsonrpc: string;
  /** Fully qualified, e.g. `aria2.tellStatus` or `system.listMethods`. */
  method: string;
  id: string;
  params: unknown[];
}

/** Error member of a JSON-RPC response (aria2 always sends `message`). */
export interface JsonRpcError {
  code?: number;
  message: string;
  data?: unknown;
}

/**
 * A JSON-RPC response.
 *
 * Note that aria2 answers with an `error` member *and* HTTP 200, therefore the
 * receiver has to look at the body — the transport does not map HTTP status
 * codes onto JSON-RPC errors (AriaNg did, and it lost the RPC message).
 */
export interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string;
  result?: unknown;
  error?: JsonRpcError;
}

/** Minimal close-event shape shared with the browser `CloseEvent`. */
export interface TransportCloseEvent {
  code?: number;
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Callbacks                                                           */
/* ------------------------------------------------------------------ */

export interface TransportHandlers {
  /** The server answered.  `payload.error` may still be set. */
  onResult(payload: JsonRpcResponse): void;
  /** The request could not be completed at all (connect / timeout / abort). */
  onError(error: { message: string; code?: number }, requestId?: string): void;
  /** Connection became usable (websocket open / first successful HTTP body). */
  onOpen(): void;
  /** Connection was lost. */
  onClose(event?: TransportCloseEvent): void;
  /**
   * Server-pushed notification.
   *
   * Delivery is transport-wide, not per request: when the transport was built
   * with a notification sink every event goes there, otherwise the handlers of
   * the requests that are currently in flight receive it, so a one-shot caller
   * still observes `aria2.onDownloadStart` while it waits for its own reply.
   */
  onNotification(method: string, params: unknown[]): void;
}

export interface RpcTransport {
  readonly kind: 'websocket' | 'http';
  readonly supportsNotifications: boolean;
  readonly connected: boolean;
  send(request: SerializedRequest, handlers: TransportHandlers): void;
  close(): void;
}

/**
 * Both concrete transports additionally support eager connection setup and
 * reconnect scheduling.  `RpcTransport` stays minimal (and is what the client
 * contract talks about); the client uses this richer shape internally.
 */
export interface ManagedRpcTransport extends RpcTransport {
  /** Create the connection now instead of lazily on the first request. */
  open(): void;
}

/** Transport-level (connection wide) callbacks, passed at construction time. */
export interface TransportConnectionHandlers {
  onOpen?: () => void;
  onClose?: (event?: TransportCloseEvent) => void;
  onNotification?: (method: string, params: unknown[]) => void;
  /**
   * Fired right before the transport opens a *replacement* connection on its
   * own (websocket auto-reconnect).  AriaNg had no such hook, so the client
   * could never tell "waiting for the timer" apart from "reconnecting now".
   */
  onReconnecting?: () => void;
}

/* ------------------------------------------------------------------ */
/* Shared messages (ported verbatim from AriaNg)                       */
/* ------------------------------------------------------------------ */

/** AriaNg: `aria2HttpRpcService` / `aria2WebSocketRpcService`. */
export const RPC_CONNECT_ERROR = 'Cannot connect to aria2!';
/** AriaNg: `Cannot initialize WebSocket!` (thrown branch of `getSocketClient`). */
export const RPC_WEBSOCKET_INIT_ERROR = 'Cannot initialize WebSocket!';
/** AriaNg-next: local message used when the user switches the RPC profile. */
export const RPC_PROFILE_CHANGED = 'RPC profile changed';

/** aria2 constants `httpRequestTimeout: 20000`. */
export const RPC_HTTP_TIMEOUT_MS = 20_000;

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

/** Runtime type guard for parsed JSON objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `system.*` methods are the only ones that must never receive a token. */
export function isSystemMethod(method: string): boolean {
  return method.startsWith(`${RPC_SYSTEM_SERVICE_NAME}.`);
}

/**
 * Base64 of the UTF-8 bytes of `value`.
 *
 * AriaNg used the angular `base64` module, which encodes UTF-8 — `btoa` alone
 * throws on non-Latin1 input, and GET query strings happily carry non-ASCII
 * JSON (file names, seeds, ...).  Hence `TextEncoder` + a manual fallback for
 * the (unlikely) environments without `btoa`.
 */
export function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);

  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  return bytesToBase64(bytes);
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

/**
 * `AriaNg_<unixSeconds>_<random>` encoded as base64.
 *
 * Byte-for-byte AriaNg's `ariaNgCommonService.generateUniqueId`: the prefix
 * makes aria2 log entries recognisable, the timestamp + entropy make the id
 * unique enough to correlate requests across transports.
 */
export function generateUniqueId(): string {
  const unixSeconds = Math.round(Date.now() / 1000);
  return base64Encode(`AriaNg_${unixSeconds}_${Math.random()}`);
}

/**
 * Prepend `token:<secret>` for `aria2.*` methods.
 *
 * aria2 accepts the RPC secret either as `params[0]` or as an
 * `Authorization: Bearer <token>` header; the header is set by the transports
 * and this helper covers the parameter form.
 *
 * Idempotent on purpose: `client.invoke()` already injects the token so that
 * `buildCall()` produces self-contained `system.multicall` entries, and this
 * function must not add a second one when the transport is used directly.
 */
export function withSecretToken(profile: RpcProfileLike, request: SerializedRequest): unknown[] {
  const params = request.params ?? [];
  if (!profile.secret || isSystemMethod(request.method)) return params;

  const first = params[0];
  if (typeof first === 'string' && first.startsWith(RPC_TOKEN_PREFIX)) return params;

  return [`${RPC_TOKEN_PREFIX}${profile.secret}`, ...params];
}

/** Structural subset of `RpcProfile` needed by the helpers above. */
export interface RpcProfileLike {
  secret: string;
}