/**
 * HTTP transport unit tests.
 *
 * Focus: the three places where a faithful AriaNg port is easy to get subtly
 * wrong — the POST body, the base64 GET query string and the `name: value`
 * header parser — plus the two error paths (RPC error body vs. "no JSON at
 * all", i.e. *cannot connect*).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RpcProfile } from '@/config/types';
import type { JsonRpcResponse, SerializedRequest, TransportHandlers } from '../transport/types';
import { HttpRpcTransport, buildRpcUrl, parseRequestHeaders } from '../transport/http';
import { RPC_CONNECT_ERROR } from '../transport/types';

function makeProfile(overrides: Partial<RpcProfile> = {}): RpcProfile {
  return {
    rpcAlias: 'local',
    rpcHost: 'localhost',
    rpcPort: '6800',
    rpcInterface: 'jsonrpc',
    protocol: 'http',
    httpMethod: 'POST',
    rpcRequestHeaders: '',
    secret: '',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<SerializedRequest> = {}): SerializedRequest {
  return {
    jsonrpc: '2.0',
    method: 'aria2.tellStatus',
    id: 'QXJpYU5nXzE',
    params: ['gid-1'],
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function htmlResponse(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  } as unknown as Response;
}

interface RecordedHandlers {
  handlers: TransportHandlers;
  onResult: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onOpen: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  onNotification: ReturnType<typeof vi.fn>;
}

function recordHandlers(): RecordedHandlers {
  const onResult = vi.fn();
  const onError = vi.fn();
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const onNotification = vi.fn();

  return {
    handlers: { onResult, onError, onOpen, onClose, onNotification },
    onResult,
    onError,
    onOpen,
    onClose,
    onNotification,
  };
}

describe('http transport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /* ---------------- url / POST ---------------- */

  it('builds the url from protocol/host/port/interface without touching jsonrpc', () => {
    expect(buildRpcUrl(makeProfile())).toBe('http://localhost:6800/jsonrpc');
    expect(buildRpcUrl(makeProfile({ protocol: 'https', rpcPort: '6801', rpcInterface: 'rpc/custom' }))).toBe(
      'https://localhost:6801/rpc/custom',
    );
  });

  it('POSTs the exact request envelope as JSON and answers onResult', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', result: { gid: 'gid-1' } } satisfies JsonRpcResponse),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({ profile: makeProfile({ secret: 'sekret' }) });
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onResult).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:6800/jsonrpc');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer sekret' });
    expect(JSON.parse(String(init?.body))).toEqual({
      jsonrpc: '2.0',
      method: 'aria2.tellStatus',
      id: 'QXJpYU5nXzE',
      // aria2 takes the secret as params[0] ...
      params: ['token:sekret', 'gid-1'],
    });
    expect(recorder.onResult).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', result: { gid: 'gid-1' } });
    expect(recorder.onOpen).toHaveBeenCalledTimes(1);
  });

  it('never duplicates a token that the client already injected', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', result: 'ok' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({ profile: makeProfile({ secret: 'sekret' }) });
    const recorder = recordHandlers();
    // `client.invoke()` prepends the token itself; the transport must stay idempotent.
    transport.send(makeRequest({ params: ['token:sekret', 'gid-1'] }), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onResult).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { params: unknown[] };
    expect(body.params).toEqual(['token:sekret', 'gid-1']);
  });

  /* ---------------- GET ---------------- */

  it('encodes the GET query string params as base64 JSON', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', result: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({ profile: makeProfile({ httpMethod: 'GET', secret: 'sekret' }) });
    const recorder = recordHandlers();
    const params = ['token:sekret', 'gid-1', ['https://a/1.torrent', 'https://a/2.torrent']];
    transport.send(makeRequest({ params }), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onResult).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    // GET requests carry no body, hence no Content-Type (AriaNg behaved the same).
    expect(init?.headers).not.toHaveProperty('Content-Type');

    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe('http://localhost:6800/jsonrpc');
    expect(parsed.searchParams.get('method')).toBe('aria2.tellStatus');
    expect(parsed.searchParams.get('id')).toBe('QXJpYU5nXzE');

    const encoded = parsed.searchParams.get('params');
    expect(encoded).not.toBeNull();
    // URLSearchParams already percent-decodes; the value is aria2's base64 blob.
    expect(JSON.parse(atob(String(encoded)))).toEqual(params);
  });

  it('omits the GET params member when the call takes no arguments', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', result: '1.37.0' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // No secret on this profile, so the transport adds nothing to `params`.
    const transport = new HttpRpcTransport({ profile: makeProfile({ httpMethod: 'GET' }) });
    const recorder = recordHandlers();
    transport.send(makeRequest({ method: 'aria2.getVersion', params: [] }), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onResult).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('params=');
  });

  /* ---------------- secret ---------------- */

  it('omits the token for system.* methods', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', result: ['aria2.tellStatus'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({ profile: makeProfile({ secret: 'sekret' }) });
    const recorder = recordHandlers();
    transport.send(makeRequest({ method: 'system.listMethods', params: [] }), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onResult).toHaveBeenCalledTimes(1));

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(init?.body)) as { params: unknown[] };
    expect(body.params).toEqual([]);
    // The bearer header is still sent — it is harmless and keeps proxies happy.
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer sekret' });
  });

  /* ---------------- headers ---------------- */

  it('parses `name: value` lines and rejects lines with more than one colon', () => {
    expect(parseRequestHeaders('X-One: 1\n  X-Two :  two  ')).toEqual({ 'X-One': '1', 'X-Two': 'two' });
    // AriaNg skipped any line whose split produced != 2 parts, so a value with a
    // colon silently disabled the whole header.  Verbatim, documented behaviour.
    expect(parseRequestHeaders('Authorization: Bearer a:b')).toEqual({});
    expect(parseRequestHeaders('X-No-Value\nX-Ok: v')).toEqual({ 'X-Ok': 'v' });
    expect(parseRequestHeaders('')).toEqual({});
    expect(parseRequestHeaders(undefined)).toEqual({});
  });

  it('applies the parsed headers but not the rejected ones', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', result: 'ok' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({
      profile: makeProfile({ rpcRequestHeaders: 'X-Token: abc\nX-Broken: a:b:c\nX-Other: 1' }),
    });
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onResult).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Token': 'abc',
      'X-Other': '1',
    });
  });

  /* ---------------- errors ---------------- */

  it('synthesises a connect failure when the response has no JSON body', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => htmlResponse());
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({ profile: makeProfile() });
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onError).toHaveBeenCalledTimes(1));
    expect(recorder.onError).toHaveBeenCalledWith({ message: RPC_CONNECT_ERROR }, 'QXJpYU5nXzE');
    expect(recorder.onResult).not.toHaveBeenCalled();
    // A connect failure is *not* an RPC error: the connection is down.
    expect(recorder.onClose).toHaveBeenCalledWith({ code: 404, reason: RPC_CONNECT_ERROR });
    expect(transport.connected).toBe(false);
  });

  it('surfaces data.error for a JSON-RPC error body without reporting a connect failure', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jsonrpc: '2.0', id: 'QXJpYU5nXzE', error: { code: 1, message: 'Unauthorized' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({ profile: makeProfile() });
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    await vi.waitFor(() => expect(recorder.onError).toHaveBeenCalledTimes(1));
    expect(recorder.onError).toHaveBeenCalledWith({ message: 'Unauthorized', code: 1 }, 'QXJpYU5nXzE');
    expect(recorder.onClose).not.toHaveBeenCalled();
    expect(recorder.onResult).not.toHaveBeenCalled();
  });

  it('aborts the request after the 20s AriaNg timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpRpcTransport({ profile: makeProfile() });
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    expect(recorder.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(recorder.onError).toHaveBeenCalledWith({ message: RPC_CONNECT_ERROR }, 'QXJpYU5nXzE');
  });
});