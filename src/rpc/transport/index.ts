/**
 * Transport factory + re-exports.
 *
 * `ws` / `wss` pick the websocket transport (notifications), `http` / `https`
 * pick the polling transport — exactly AriaNg's
 * `ariaNgSettingService.isCurrentRpcUseWebSocket()`.
 */

import type { RpcProfile } from '@/config/types';
import type { ManagedRpcTransport, TransportConnectionHandlers } from './types';
import { createHttpTransport } from './http';
import { createWebSocketTransport } from './websocket';

export interface TransportOptions extends TransportConnectionHandlers {
  profile: RpcProfile;
  /** Only meaningful for the websocket transport. */
  reconnectInterval?: number;
  /** Only meaningful for the HTTP transport. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  socketFactory?: (url: string) => WebSocket;
}

export function isWebSocketProtocol(protocol: RpcProfile['protocol']): boolean {
  return protocol === 'ws' || protocol === 'wss';
}

/** Builds the transport a profile asks for. */
export function createTransport(options: TransportOptions): ManagedRpcTransport {
  const { profile, reconnectInterval = 0, timeoutMs, fetchImpl, socketFactory } = options;

  if (isWebSocketProtocol(profile.protocol)) {
    return createWebSocketTransport({
      profile,
      reconnectInterval,
      socketFactory,
      onOpen: options.onOpen,
      onClose: options.onClose,
      onNotification: options.onNotification,
      onReconnecting: options.onReconnecting,
    });
  }

  return createHttpTransport({
    profile,
    timeoutMs,
    fetchImpl,
    onOpen: options.onOpen,
    onClose: options.onClose,
    onNotification: options.onNotification,
  });
}

export type {
  JsonRpcError,
  JsonRpcResponse,
  ManagedRpcTransport,
  RpcTransport,
  SerializedRequest,
  TransportCloseEvent,
  TransportConnectionHandlers,
  TransportHandlers,
} from './types';
export {
  base64Encode,
  generateUniqueId,
  isRecord,
  isSystemMethod,
  RPC_CONNECT_ERROR,
  RPC_HTTP_TIMEOUT_MS,
  RPC_PROFILE_CHANGED,
  RPC_WEBSOCKET_INIT_ERROR,
  withSecretToken,
} from './types';
export { buildGetUrl, buildRpcUrl, createHttpTransport, HttpRpcTransport, parseRequestHeaders } from './http';
export type { HttpTransportOptions } from './http';
export { createWebSocketTransport, WebSocketRpcTransport } from './websocket';
export type { WebSocketTransportOptions } from './websocket';