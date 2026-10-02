/**
 * WebSocket transport unit tests — the reconnect scheduler and message
 * dispatch that AriaNg got wrong (dead config, leaked in-flight requests,
 * falsy results treated as failures).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RpcProfile } from '@/config/types';
import type { SerializedRequest, TransportHandlers } from '../transport/types';
import { RPC_CONNECT_ERROR, RPC_WEBSOCKET_INIT_ERROR } from '../transport/types';
import { WebSocketRpcTransport } from '../transport/websocket';

class FakeSocket {
  static instances: FakeSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  closeCalls = 0;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  deliver(payload: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  drop(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, wasClean: false }));
  }
}

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

function makeRequest(overrides: Partial<SerializedRequest> = {}): SerializedRequest {
  return { jsonrpc: '2.0', method: 'aria2.tellStatus', id: 'req-1', params: ['gid-1'], ...overrides };
}

function recordHandlers() {
  const onResult = vi.fn();
  const onError = vi.fn();
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const onNotification = vi.fn();
  const handlers: TransportHandlers = { onResult, onError, onOpen, onClose, onNotification };
  return { handlers, onResult, onError, onOpen, onClose, onNotification };
}

function newTransport(profile = makeProfile(), reconnectInterval = 0, hooks = {}) {
  return new WebSocketRpcTransport({ profile, reconnectInterval, socketFactory: (url) => new FakeSocket(url) as unknown as WebSocket, ...hooks });
}

beforeEach(() => {
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('websocket transport', () => {
  it('opens lazily on first send and prefixes aria2 methods', () => {
    const transport = newTransport(makeProfile({ secret: 'sekret' }));
    expect(FakeSocket.instances).toHaveLength(0);

    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toBe('ws://localhost:6800/jsonrpc');

    // Buffered while CONNECTING, flushed on open.
    expect(FakeSocket.instances[0].sent).toHaveLength(0);
    FakeSocket.instances[0].open();
    expect(JSON.parse(FakeSocket.instances[0].sent[0])).toEqual({
      jsonrpc: '2.0',
      method: 'aria2.tellStatus',
      id: 'req-1',
      params: ['token:sekret', 'gid-1'],
    });
  });

  it('rejects with "Cannot initialize WebSocket!" when construction throws', () => {
    const transport = new WebSocketRpcTransport({
      profile: makeProfile(),
      socketFactory: () => {
        throw new Error('blocked');
      },
    });

    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    expect(recorder.onError).toHaveBeenCalledWith({ message: RPC_WEBSOCKET_INIT_ERROR }, 'req-1');
    expect(recorder.onResult).not.toHaveBeenCalled();
  });

  it('dispatches by id presence, so a falsy result is a success', () => {
    const transport = newTransport();
    const recorder = recordHandlers();
    transport.send(makeRequest({ id: 'a', method: 'aria2.changePosition' }), recorder.handlers);

    const socket = FakeSocket.instances[0];
    socket.open();
    socket.deliver({ jsonrpc: '2.0', id: 'a', result: 0 });

    expect(recorder.onResult).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'a', result: 0 });
  });

  it('forwards notifications through the transport-level sink', () => {
    const onNotification = vi.fn();
    const transport = newTransport(makeProfile(), 0, { onNotification });
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    const socket = FakeSocket.instances[0];
    socket.open();
    socket.deliver({ jsonrpc: '2.0', method: 'aria2.onDownloadStart', params: [{ gid: 'gid-1' }] });

    expect(onNotification).toHaveBeenCalledWith('aria2.onDownloadStart', [{ gid: 'gid-1' }]);
    // With a sink installed, the per-request handler is not used.
    expect(recorder.onNotification).not.toHaveBeenCalled();
  });

  it('falls back to per-request handlers when no sink is installed', () => {
    const transport = newTransport();
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    const socket = FakeSocket.instances[0];
    socket.open();
    socket.deliver({ jsonrpc: '2.0', method: 'aria2.onDownloadPause', params: [{ gid: 'gid-1' }] });

    expect(recorder.onNotification).toHaveBeenCalledWith('aria2.onDownloadPause', [{ gid: 'gid-1' }]);
  });

  it('rejects every in-flight request when the socket drops', () => {
    const transport = newTransport();
    const first = recordHandlers();
    const second = recordHandlers();
    transport.send(makeRequest({ id: 'a' }), first.handlers);
    transport.send(makeRequest({ id: 'b' }), second.handlers);

    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop();

    expect(first.onError).toHaveBeenCalledWith({ message: RPC_CONNECT_ERROR }, 'a');
    expect(second.onError).toHaveBeenCalledWith({ message: RPC_CONNECT_ERROR }, 'b');
  });

  it('close() rejects pending requests and does not schedule a reconnect', () => {
    vi.useFakeTimers();
    const transport = newTransport(makeProfile(), 500);
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);
    FakeSocket.instances[0].open();

    transport.close();
    expect(recorder.onError).toHaveBeenCalledWith({ message: RPC_CONNECT_ERROR }, 'req-1');
    expect(FakeSocket.instances[0].closeCalls).toBe(1);

    vi.advanceTimersByTime(5_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('does not reconnect when reconnectInterval is 0', () => {
    vi.useFakeTimers();
    const onReconnecting = vi.fn();
    const transport = newTransport(makeProfile(), 0, { onReconnecting });
    transport.open();
    FakeSocket.instances[0].drop();

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it('reconnects after exactly one interval and signals the reconnect', () => {
    vi.useFakeTimers();
    const onReconnecting = vi.fn();
    const onClose = vi.fn();
    const transport = newTransport(makeProfile(), 1_000, { onReconnecting, onClose });
    transport.open();

    FakeSocket.instances[0].drop();
    expect(onClose).toHaveBeenCalledWith({ code: 1006, reason: '' });
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(onReconnecting).toHaveBeenCalledTimes(1);

    FakeSocket.instances[1].open();
    expect(transport.connected).toBe(true);
  });

  it('reports an init failure and stops retrying instead of spinning', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    let failNext = false;
    const transport = new WebSocketRpcTransport({
      profile: makeProfile(),
      reconnectInterval: 100,
      onClose,
      socketFactory: (url) => {
        if (failNext) throw new Error('blocked');
        failNext = false;
        return new FakeSocket(url) as unknown as WebSocket;
      },
    });

    transport.open();
    failNext = true;
    FakeSocket.instances[0].drop();

    vi.advanceTimersByTime(100);
    expect(onClose).toHaveBeenLastCalledWith({ reason: RPC_WEBSOCKET_INIT_ERROR });

    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('ignores malformed frames', () => {
    const transport = newTransport();
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    const socket = FakeSocket.instances[0];
    socket.open();
    expect(() => {
      socket.onmessage?.(new MessageEvent('message', { data: 'not json' }));
      socket.onmessage?.(new MessageEvent('message', { data: '[1,2,3]' }));
      socket.deliver({ jsonrpc: '2.0', id: 'unknown-id', result: 'x' });
      socket.deliver({ jsonrpc: '2.0' });
    }).not.toThrow();

    expect(recorder.onResult).not.toHaveBeenCalled();
  });

  it('ignores binary frames', () => {
    const transport = newTransport();
    const recorder = recordHandlers();
    transport.send(makeRequest(), recorder.handlers);

    const socket = FakeSocket.instances[0];
    socket.open();
    // aria2 only ever sends text frames; a Blob/ArrayBuffer is not parseable JSON.
    socket.onmessage?.(new MessageEvent('message', { data: new ArrayBuffer(8) }));

    expect(recorder.onResult).not.toHaveBeenCalled();
  });
});