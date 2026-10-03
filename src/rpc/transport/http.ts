/**
 * HTTP / HTTPS JSON-RPC transport.
 *
 * Faithful port of AriaNg's `src/scripts/services/aria2HttpRpcService.js`:
 *  - the URL is `<protocol>://<host>:<port>/<rpcInterface>` (the interface is
 *    the *full* path segment — it already contains `jsonrpc`);
 *  - `POST` sends the JSON body, `GET` builds aria2's documented
 *    `?method=&id=&params=<base64>` query string;
 *  - `rpcRequestHeaders` is parsed line by line and a line is only accepted
 *    when it splits into *exactly two* parts on `:`, exactly like AriaNg.
 *
 * Deliberate deviations (all commented at the point of change):
 *  - `fetch` + `AbortController` instead of angular `$http`.
 *  - A JSON body carrying a JSON-RPC `error` member is surfaced through
 *    `onError`; AriaNg only looked at `data.result` and reported an RPC-level
 *    failure as a successful call with `data === undefined`.
 *  - No retry logic at all — the scheduler above owns the retry cadence.
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
import {
  base64Encode,
  isRecord,
  RPC_CONNECT_ERROR,
  RPC_HTTP_TIMEOUT_MS,
  RPC_HTTP_UNREACHABLE,
  withSecretToken,
} from './types';

export interface HttpTransportOptions extends TransportConnectionHandlers {
  profile: RpcProfile;
  /** Defaults to AriaNg's `httpRequestTimeout` (20 s). */
  timeoutMs?: number;
  /** Injection seam for tests / non-browser runtimes. */
  fetchImpl?: typeof fetch;
}

/** `protocol://host:port/interface` — the interface already is the path. */
export function buildRpcUrl(profile: RpcProfile): string {
  return `${profile.protocol}://${profile.rpcHost}:${profile.rpcPort}/${profile.rpcInterface}`;
}

/**
 * aria2's GET interface: `?method=METHOD&id=ID&params=BASE64(JSON params)`.
 *
 * AriaNg appended *every* member of the request envelope (including
 * `jsonrpc=2.0`) because it iterated the body object; we emit exactly the three
 * documented members instead.  Values are percent-encoded because a base64 id /
 * base64 param blob contains `+`, `/` and `=` which most query parsers mangle.
 * `params` is omitted when the call takes no arguments.
 */
export function buildGetUrl(url: string, request: SerializedRequest, params: unknown[]): string {
  const parts = [`method=${encodeURIComponent(request.method)}`, `id=${encodeURIComponent(request.id)}`];

  if (params.length > 0) {
    parts.push(`params=${encodeURIComponent(base64Encode(JSON.stringify(params)))}`);
  }

  return `${url}${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

/**
 * `name: value` lines → header map.
 *
 * Only lines splitting into exactly two parts are accepted: AriaNg used
 * `line.split(':')` and skipped anything else, so a header value containing a
 * colon silently disabled the header.  Kept verbatim for compatibility — the
 * behaviour is covered by a unit test.
 */
export function parseRequestHeaders(raw: string | undefined | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;

  for (const line of raw.split('\n')) {
    const items = line.split(':');
    if (items.length !== 2) continue;
    headers[items[0].trim()] = items[1].trim();
  }

  return headers;
}

export class HttpRpcTransport implements ManagedRpcTransport {
  readonly kind = 'http' as const;
  readonly supportsNotifications = false;

  readonly #profile: RpcProfile;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #onOpen: (() => void) | undefined;
  readonly #onClose: ((event?: TransportCloseEvent) => void) | undefined;
  readonly #onNotification: ((method: string, params: unknown[]) => void) | undefined;
  readonly #controllers = new Set<AbortController>();

  #connected = false;
  #closed = false;

  constructor(options: HttpTransportOptions) {
    this.#profile = options.profile;
    this.#timeoutMs = options.timeoutMs ?? RPC_HTTP_TIMEOUT_MS;
    // Bound lazily: `fetch` must be read at call time so test doubles that are
    // installed after construction are still picked up.
    this.#fetch = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.#onOpen = options.onOpen;
    this.#onClose = options.onClose;
    this.#onNotification = options.onNotification;
  }

  get connected(): boolean {
    return this.#connected;
  }

  /** Exposed for diagnostics / the settings page preview. */
  get url(): string {
    return buildRpcUrl(this.#profile);
  }

  /** HTTP has no persistent connection — nothing to open eagerly. */
  open(): void {
    /* no-op */
  }

  send(request: SerializedRequest, handlers: TransportHandlers): void {
    if (this.#closed) {
      handlers.onError({ message: RPC_CONNECT_ERROR }, request.id);
      return;
    }

    const params = withSecretToken(this.#profile, request);
    const isPost = this.#profile.httpMethod !== 'GET';
    const url = isPost ? this.url : buildGetUrl(this.url, request, params);

    const controller = new AbortController();
    this.#controllers.add(controller);

    // AriaNg passed `timeout: 20000` to angular `$http`; AbortController is the
    // equivalent for `fetch` and additionally lets `close()` abort instantly.
    const timer = this.#timeoutMs > 0 ? setTimeout(() => controller.abort(), this.#timeoutMs) : null;

    const init: RequestInit = {
      method: this.#profile.httpMethod,
      headers: this.#buildHeaders(isPost),
      signal: controller.signal,
    };
    if (isPost) init.body = JSON.stringify({ ...request, params });

    void this.#fetch(url, init)
      .then((response) => this.#handleResponse(response, request, handlers))
      .catch(() => {
        // Network error, CORS rejection or timeout — AriaNg's `$http` reject branch,
        // which synthesised the very same "Cannot connect" message. That message says
        // nothing actionable, so the abort (our own timeout) is still reported as it
        // was and everything else becomes {@link RPC_HTTP_UNREACHABLE}, which at least
        // names both causes and both fixes. See the constant for why they cannot be
        // told apart.
        this.#reportConnectFailure(
          handlers,
          request.id,
          undefined,
          controller.signal.aborted ? RPC_CONNECT_ERROR : RPC_HTTP_UNREACHABLE,
        );
      })
      .finally(() => {
        if (timer !== null) clearTimeout(timer);
        this.#controllers.delete(controller);
      });
  }

  close(): void {
    this.#closed = true;
    this.#connected = false;
    for (const controller of [...this.#controllers]) controller.abort();
    this.#controllers.clear();
  }

  /* ---------------- internals ---------------- */

  #buildHeaders(includeContentType: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeContentType) headers['Content-Type'] = 'application/json';

    // Custom headers are applied *after* the default so a user supplied
    // `Content-Type` still wins — same order as AriaNg.
    Object.assign(headers, parseRequestHeaders(this.#profile.rpcRequestHeaders));

    if (this.#profile.secret) {
      // aria2 accepts the secret as a bearer token too; sending both forms keeps
      // old and new aria2 / aria2-next builds working behind proxies that strip
      // the body or the query string.
      headers.Authorization = `Bearer ${this.#profile.secret}`;
    }

    return headers;
  }

  async #handleResponse(
    response: Response,
    request: SerializedRequest,
    handlers: TransportHandlers,
  ): Promise<void> {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!isRecord(data)) {
      // AriaNg: `if (!data) { data = { id: '-1', error: { message: 'Cannot
      // connect to aria2!' } }; connectionFailedCallback(); }` — an HTML error
      // page (proxy, wrong port, aria2 not running) lands here.
      this.#reportConnectFailure(handlers, request.id, response.status);
      return;
    }

    const payload = data as JsonRpcResponse;
    const error = payload.error;

    if (error) {
      // The connection itself worked, so we do NOT report a connection failure;
      // AriaNg called `connectionSuccessCallback` for these as well.
      handlers.onError({ message: error.message, code: error.code }, typeof payload.id === 'string' ? payload.id : request.id);
      return;
    }

    this.#connected = true;
    this.#onOpen?.();
    handlers.onOpen();

    // aria2 never pushes notifications over HTTP, but a reverse proxy may pass a
    // websocket frame through; forward it when we happen to see one so the
    // listener layer stays transport agnostic.
    const forward = payload as { method?: unknown; params?: unknown };
    if (typeof forward.method === 'string' && forward.method.length > 0) {
      const params: unknown[] = Array.isArray(forward.params) ? (forward.params as unknown[]) : [];
      if (this.#onNotification) this.#onNotification(forward.method, params);
      else handlers.onNotification(forward.method, params);
    }

    handlers.onResult(payload);
  }

  #reportConnectFailure(
    handlers: TransportHandlers,
    requestId: string,
    status?: number,
    message: string = RPC_CONNECT_ERROR,
  ): void {
    this.#connected = false;
    handlers.onError({ message }, requestId);
    // The HTTP status is forwarded as the close "code" — AriaNg had no place to
    // show it, but "404" vs "0 (offline)" is the single most useful diagnostic
    // on the settings page.
    this.#onClose?.(status === undefined ? { reason: message } : { code: status, reason: message });
    handlers.onClose(status === undefined ? { reason: message } : { code: status, reason: message });
  }
}

export function createHttpTransport(options: HttpTransportOptions): HttpRpcTransport {
  return new HttpRpcTransport(options);
}