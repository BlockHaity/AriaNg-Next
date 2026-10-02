/**
 * Public entry point of the RPC layer.
 *
 * Everything the app needs is re-exported here:
 *   - `createAria2Client` / `initAria2Client` — the factory;
 *   - `getAria2Client` — the singleton accessor the stores and components use;
 *   - the contract + wire types, so no consumer has to reach into `./contract`
 *     or `./types` directly.
 *
 * The singleton is *not* created on import: it needs a live `RpcProfile`, which
 * only the settings layer knows.  Bootstrap with `initAria2Client(...)` once the
 * settings have been read (see `src/main.tsx`).
 */

import type { RpcProfile } from '@/config/types';
import type { Aria2Client } from './contract';
import type { Aria2ClientOptions } from './client';
import { Aria2ClientImpl } from './client';

export { Aria2ClientImpl, type Aria2ClientOptions } from './client';

export type {
  Aria2Client,
  BatchOutcome,
  ConnectionState,
  RpcError,
  RpcEventPayload,
  RpcEventPayloads,
  RpcFailure,
  RpcRequestContext,
  RpcResult,
  RpcSuccess,
  Unsubscribe,
} from './contract';
export { ARIA2_NEXT_TASK_PARAMS, BASIC_TASK_PARAMS, FULL_TASK_PARAMS } from './contract';

export { RPC_EVENT_NAMES, RpcStatus } from '@/config/rpc-constants';
export type { RpcEvent } from '@/config/rpc-constants';
export type { RpcProfile } from '@/config/types';

/* ------------------------------------------------------------------ */
/* factory                                                             */
/* ------------------------------------------------------------------ */

/** Builds a standalone client; the caller owns its lifecycle. */
export function createAria2Client(options: Aria2ClientOptions): Aria2Client {
  return new Aria2ClientImpl(options);
}

/* ------------------------------------------------------------------ */
/* singleton                                                           */
/* ------------------------------------------------------------------ */

let singleton: Aria2Client | null = null;

/**
 * Creates the process-wide client (disposing a previous one) and returns it.
 *
 * Called exactly once during bootstrap; `connect()` on the returned client is
 * what the settings page calls whenever the user edits the profile.
 */
export function initAria2Client(options: Aria2ClientOptions): Aria2Client {
  disposeAria2Client();
  singleton = new Aria2ClientImpl(options);
  return singleton;
}

/** `null` until {@link initAria2Client} ran (and after `disposeAria2Client`). */
export function getAria2ClientOrNull(): Aria2Client | null {
  return singleton;
}

/** The process-wide client. Throws when bootstrap did not run yet. */
export function getAria2Client(): Aria2Client {
  if (!singleton) {
    throw new Error('[rpc] getAria2Client() called before initAria2Client()');
  }
  return singleton;
}

/** Swaps the singleton (used by tests and by the settings layer). */
export function setAria2Client(client: Aria2Client | null): void {
  disposeAria2Client();
  singleton = client;
}

/** Disconnects and drops the singleton. */
export function disposeAria2Client(): void {
  singleton?.disconnect();
  singleton = null;
}

/**
 * Convenience for the settings layer: apply a (possibly new) profile to the
 * live client, creating it on demand.
 */
export function ensureAria2Client(
  profile: RpcProfile,
  webSocketReconnectInterval: number,
  onError?: Aria2ClientOptions['onError'],
): Aria2Client {
  const client = singleton ?? initAria2Client({ profile, webSocketReconnectInterval, onError });
  client.connect(profile, { reconnectInterval: webSocketReconnectInterval });
  return client;
}