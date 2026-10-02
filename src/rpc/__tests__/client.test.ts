/**
 * `Aria2ClientImpl` unit tests.
 *
 * The client is exercised against a scripted websocket mock so that request
 * construction (secret, option bags, `system.multicall` tuples) can be asserted
 * on the *wire frames*, and against fake timers for the reconnect state machine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RpcProfile } from '@/config/types';
import { RpcStatus } from '@/config/rpc-constants';
import { Aria2ClientImpl } from '../client';
import { RPC_CONNECT_ERROR, RPC_PROFILE_CHANGED } from '../transport/types';

/* ------------------------------------------------------------------ */
/* websocket mock                                                      */
/* ------------------------------------------------------------------ */

interface Frame {
  jsonrpc: string;
  method: string;
  id: string;
  params: unknown[];
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket the code under test constructed, in order. */
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: Frame[] = [];
  closeCalls = 0;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  /* ---- server-side driving helpers ---- */

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  reply(frame: Frame, result: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) }));
  }

  replyError(frame: Frame, error: { code: number; message: string }): void {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, error }) }),
    );
  }

  notify(method: string, params: unknown[]): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', method, params }) }));
  }

  dropFromServer(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, wasClean: false }));
  }
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeProfile(overrides: Partial<RpcProfile> = {}): RpcProfile {
  return {
    rpcAlias: 'local',
    rpcHost: 'localhost',
    rpcPort: '6800',
    rpcInterface: 'jsonrpc',
    protocol: 'ws',
    httpMethod: 'POST',
    rpcRequestHeaders: '',
    secret: '',
    ...overrides,
  };
}

function createClient(overrides: Partial<RpcProfile> = {}, reconnectInterval = 0) {
  const onError = vi.fn();
  const client = new Aria2ClientImpl({ profile: makeProfile(overrides), webSocketReconnectInterval: reconnectInterval, onError });
  return { client, onError, socket: FakeWebSocket.instances[0] };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */

describe('aria2 client — request construction', () => {
  it('prepends token:<secret> for aria2.* calls', async () => {
    const { client, socket } = createClient({ secret: 'sekret' });
    socket.open();

    const pending = client.invoke<string>({ method: 'tellStatus', params: ['gid-1'] });
    socket.reply(socket.sent[0], 'status');

    await expect(pending).resolves.toMatchObject({ success: true, data: 'status' });
    expect(socket.sent[0]).toEqual({
      jsonrpc: '2.0',
      method: 'aria2.tellStatus',
      id: expect.any(String),
      params: ['token:sekret', 'gid-1'],
    });
  });

  it('does not prepend a token for system.* calls', () => {
    const { client, socket } = createClient({ secret: 'sekret' });
    socket.open();

    void client.listMethods();
    expect(socket.sent[0].method).toBe('system.listMethods');
    expect(socket.sent[0].params).toEqual([]);
  });

  it('builds the AriaNg_ request id', () => {
    const { client, socket } = createClient();
    socket.open();

    void client.getVersion();
    expect(atob(socket.sent[0].id)).toMatch(/^AriaNg_\d+_0\.\d+$/);
  });

  it('merges pause:"true" into the option bag when pauseOnAdded is set', () => {
    const { client, socket } = createClient({ secret: 'sekret' });
    socket.open();

    void client.invoke({
      method: 'addUri',
      params: [['magnet:?xt=urn:btih:abc'], { dir: '/downloads' }],
      pauseOnAdded: true,
    });

    expect(socket.sent[0].params).toEqual([
      'token:sekret',
      ['magnet:?xt=urn:btih:abc'],
      // Merged, not replaced — the caller's options survive.
      { dir: '/downloads', pause: 'true' },
    ]);
  });

  it('drops trailing undefined params (changePosition without how)', () => {
    const { client, socket } = createClient();
    socket.open();

    void client.changePosition('gid-1', 3);
    expect(socket.sent[0].params).toEqual(['gid-1', 3]);
  });

  it('selectFile goes through changeOption with a comma joined select-file', () => {
    // aria2-next has NO `aria2.selectFile` method: the aria2-next manual
    // documents `--select-file=<INDEX>...` as an option and states that it is
    // set through `aria2.changeOption`. Calling a non-existent method would
    // return "Method not found", so this asserts the real wire shape.
    const { client, socket } = createClient();
    socket.open();

    void client.selectFile('gid-1', [1, 3, 5]);

    expect(socket.sent[0].method).toBe('aria2.changeOption');
    expect(socket.sent[0].params).toEqual(['gid-1', { 'select-file': '1,3,5' }]);
  });

  it('buildCall returns a system.multicall tuple, not an object', () => {
    const { client } = createClient({ secret: 'sekret' });

    expect(client.buildCall({ method: 'tellStatus', params: ['gid-1'] })).toEqual([
      'aria2.tellStatus',
      ['token:sekret', 'gid-1'],
    ]);
    expect(client.buildCall({ method: 'system.multicall' })).toEqual(['system.multicall', []]);
  });

  it('addUriMany collects gids in request order', async () => {
    const { client, socket } = createClient();
    socket.open();

    const pending = client.addUriMany([
      { urls: ['https://a/1'] },
      { urls: ['https://a/2'] },
      { urls: ['https://a/3'] },
    ]);

    // Sequential: exactly one request in flight at a time.
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.reply(socket.sent[0], 'gid-1');

    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.replyError(socket.sent[1], { code: 1, message: 'boom' });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    socket.reply(socket.sent[2], 'gid-3');

    const result = await pending;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    // The failed entry contributes no gid; gids stay aligned with the successes.
    expect(result.data).toEqual({
      successCount: 2,
      failedCount: 1,
      hasSuccess: true,
      hasError: true,
      gids: ['gid-1', 'gid-3'],
    });
  });
});

describe('aria2 client — result handling', () => {
  it('never rejects: a JSON-RPC error resolves to a failure result', async () => {
    const { client, socket, onError } = createClient();
    socket.open();

    const pending = client.tellStatus('gid-1');
    socket.replyError(socket.sent[0], { code: 1, message: 'Invalid GID' });

    const result = await pending;
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.message).toBe('Invalid GID');
    expect(result.error.code).toBe(1);
    expect(result.error.tipTextKey).toBe('rpc.error.invalidGid');
    expect(result.context.method).toBe('tellStatus');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not raise a user-facing error for silent calls', async () => {
    const { client, socket, onError } = createClient();
    socket.open();

    const pending = client.tellActive();
    socket.replyError(socket.sent[0], { code: 1, message: 'Unauthorized' });

    const result = await pending;
    expect(result.success).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('resolves (not rejects) when the socket dies mid-request', async () => {
    const { client, socket } = createClient();
    socket.open();

    const pending = client.tellStatus('gid-1');
    socket.dropFromServer();

    const result = await pending;
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.message).toBe(RPC_CONNECT_ERROR);
  });

  it('caches getVersion and getVersionCached reads the cache', async () => {
    const { client, socket } = createClient();
    socket.open();

    const first = client.getVersion();
    socket.reply(socket.sent[0], { version: '1.37.0', enabledFeatures: ['HTTP'] });
    await first;

    // Second call goes through the cache, no new frame on the wire.
    await expect(client.getVersionCached()).resolves.toEqual({ version: '1.37.0', enabledFeatures: ['HTTP'] });
    expect(socket.sent).toHaveLength(1);
    expect(client.cachedVersion?.version).toBe('1.37.0');
  });

  it('getVersionCached resolves null when the daemon is unreachable', async () => {
    const { client, socket } = createClient();
    socket.open();

    const pending = client.getVersionCached();
    socket.dropFromServer();
    await expect(pending).resolves.toBeNull();
  });

  it('falsy results are treated as successes, not failures', async () => {
    const { client, socket } = createClient();
    socket.open();

    const pending = client.changePosition('gid-1', 0);
    // `0` is falsy — AriaNg's `if (content.result && ...)` dropped these.
    socket.reply(socket.sent[0], 0);

    await expect(pending).resolves.toMatchObject({ success: true, data: 0 });
  });
});

describe('aria2 client — connection state machine', () => {
  it('moves Connecting -> Connected on socket open and notifies subscribers', () => {
    const { client, socket } = createClient();
    const seen: string[] = [];
    client.onConnectionChange((state) => seen.push(state.status));

    expect(client.connection.status).toBe(RpcStatus.Connecting);
    socket.open();
    expect(client.connection.status).toBe(RpcStatus.Connected);
    expect(seen).toEqual([RpcStatus.Connected]);
  });

  it('unsubscribes a connection listener', () => {
    const { client, socket } = createClient();
    const listener = vi.fn();
    const unsubscribe = client.onConnectionChange(listener);

    socket.open();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    client.disconnect();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports Disconnected on socket loss when auto-reconnect is off', () => {
    const { client, socket } = createClient({}, 0);
    socket.open();
    socket.dropFromServer();

    expect(client.connection.status).toBe(RpcStatus.Disconnected);
    expect(client.connection.lastError).toBe(RPC_CONNECT_ERROR);
  });

  it('waits, then reconnects on a timer when the interval is set', () => {
    vi.useFakeTimers();
    const { client, socket } = createClient({}, 500);
    socket.open();

    socket.dropFromServer();
    expect(client.connection.status).toBe(RpcStatus.WaitingToReconnect);

    // Nothing happens before the interval elapses.
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.connection.status).toBe(RpcStatus.Reconnecting);
    expect(client.connection.attempt).toBe(1);

    // Success resets the attempt counter.
    FakeWebSocket.instances[1].open();
    expect(client.connection.status).toBe(RpcStatus.Connected);
    expect(client.connection.attempt).toBe(0);
  });

  it('only reconnects once per close even with repeated close events', () => {
    vi.useFakeTimers();
    const { socket } = createClient({}, 500);
    socket.open();
    socket.dropFromServer();
    socket.dropFromServer();
    socket.dropFromServer();

    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('disconnect() stops the reconnect pump', () => {
    vi.useFakeTimers();
    const { client, socket } = createClient({}, 500);
    socket.open();

    client.disconnect();
    vi.advanceTimersByTime(5_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.connection.status).toBe(RpcStatus.Disconnected);
  });

  it('reconnect() opens a fresh socket and reports Reconnecting', () => {
    const { client, socket } = createClient();
    socket.open();

    client.reconnect();
    expect(client.connection.status).toBe(RpcStatus.Reconnecting);
    expect(client.connection.attempt).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(socket.closeCalls).toBe(1);
  });
});

describe('aria2 client — hot switch', () => {
  it('rejects in-flight requests from the old transport with "RPC profile changed"', async () => {
    const { client, socket, onError } = createClient({ secret: 'sekret' });
    socket.open();

    const pending = client.tellStatus('gid-1');
    expect(socket.sent).toHaveLength(1);

    client.connect(makeProfile({ rpcPort: '6801', secret: 'other' }));

    const result = await pending;
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.message).toBe(RPC_PROFILE_CHANGED);
    // A local decision is not an aria2 failure, so no toast.
    expect(onError).not.toHaveBeenCalled();

    // The new profile's socket exists and uses the new secret from now on.
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toBe('ws://localhost:6801/jsonrpc');
    expect(socket.closeCalls).toBe(1);
    expect(client.profile.rpcPort).toBe('6801');

    const next = client.tellStatus('gid-2');
    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].reply(FakeWebSocket.instances[1].sent[0], 'ok');
    await expect(next).resolves.toMatchObject({ success: true, data: 'ok' });
  });

  it('drops the cached version on a profile switch', async () => {
    const { client, socket } = createClient();
    socket.open();

    const pending = client.getVersion();
    socket.reply(socket.sent[0], { version: '1.37.0', enabledFeatures: [] });
    await pending;
    expect(client.cachedVersion).not.toBeNull();

    client.connect(makeProfile());
    expect(client.cachedVersion).toBeNull();
  });
});

describe('aria2 client — notifications', () => {
  it('fans out aria2.onDownloadStart and honours unsubscribe', () => {
    const { client, socket } = createClient();
    socket.open();

    const listener = vi.fn();
    const unsubscribe = client.onEvent('aria2.onDownloadStart', listener);

    socket.notify('aria2.onDownloadStart', [{ gid: 'gid-1' }]);
    expect(listener).toHaveBeenCalledWith({ gid: 'gid-1' });

    unsubscribe();
    socket.notify('aria2.onDownloadStart', [{ gid: 'gid-2' }]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores events nobody subscribed to', () => {
    const { socket } = createClient();
    socket.open();
    // Must not throw even with zero listeners.
    expect(() => socket.notify('aria2.onDownloadStop', [{ gid: 'gid-1' }])).not.toThrow();
  });

  it('supports notifications only on the websocket transport', () => {
    const ws = createClient().client;
    expect(ws.supportsNotifications).toBe(true);

    const httpClient = new Aria2ClientImpl({
      profile: makeProfile({ protocol: 'http' }),
      webSocketReconnectInterval: 0,
    });
    expect(httpClient.supportsNotifications).toBe(false);
    httpClient.disconnect();
  });
});

describe('aria2 client — batching', () => {
  it('counts successes and failures across a sequential batch', async () => {
    const { client, socket } = createClient();
    socket.open();

    const pending = client.unpauseMany(['a', 'b', 'c']);

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.reply(socket.sent[0], 'a');

    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.replyError(socket.sent[1], { code: 1, message: 'bad' });

    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    socket.reply(socket.sent[2], 'c');

    await expect(pending).resolves.toMatchObject({
      success: true,
      data: { successCount: 2, failedCount: 1, hasSuccess: true, hasError: true },
    });
  });

  it('reports an all-failed batch as hasError without throwing', async () => {
    const { client, socket } = createClient();
    socket.open();

    const pending = client.forceRemoveMany(['a', 'b']);

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.replyError(socket.sent[0], { code: 1, message: 'nope' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.replyError(socket.sent[1], { code: 1, message: 'nope' });

    await expect(pending).resolves.toMatchObject({
      success: true,
      data: { successCount: 0, failedCount: 2, hasSuccess: false, hasError: true },
    });
  });

  it('handles an empty batch', async () => {
    const { client } = createClient();
    await expect(client.unpauseMany([])).resolves.toMatchObject({
      success: true,
      data: { successCount: 0, failedCount: 0, hasSuccess: false, hasError: false },
    });
  });
});