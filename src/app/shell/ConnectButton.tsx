/**
 * The connect control in the app bar.
 *
 * ## Why it exists
 *
 * The RPC client connects on boot and, for the websocket transport, keeps
 * reconnecting on its own. That covers almost everything — but not the case that
 * actually strands a user: a **wrong endpoint**, where automatic retry can never
 * succeed and the app just sits there quietly failing.
 *
 * Two concrete cases, both hit in practice:
 *
 * 1. **A cross-origin `http://` RPC url.** aria2 sends no `Access-Control-Allow-Origin`
 *    header and has no option to, so the browser rejects every `fetch` at the CORS
 *    preflight. No amount of retrying helps, and the console only says "blocked by
 *    CORS policy". The websocket transport is not subject to CORS, which makes the
 *    protocol the one setting a user has to change by hand.
 * 2. **aria2 not started yet.** Auto-reconnect only covers the websocket transport;
 *    over HTTP the client settles on `Disconnected` and stays there until something
 *    asks it to try again.
 *
 * So the button is a manual escape hatch: it re-runs the handshake on demand, and it
 * carries the last transport error so the reason is on screen rather than only in
 * devtools.
 *
 * It is deliberately **not** a replacement for auto-connect — nothing here disables
 * the automatic path. It is the alternative for when the automatic one cannot help.
 */

import { useCallback } from 'react';
import { useTranslate } from '@/i18n';
import { RpcStatus } from '@/config/rpc-constants';
import { useRpcStore } from '@/store/rpc-store';
import { MduiButton, MduiIconButton, MduiTooltip } from '@/ui/mdui';

/**
 * Statuses where the button offers to *connect*, rather than to report progress or to
 * retry something already retrying by itself.
 */
const IDLE_STATUSES: readonly string[] = [RpcStatus.Disconnected];

/** Statuses during which a click would be a duplicate of work already under way. */
const BUSY_STATUSES: readonly string[] = [RpcStatus.Connecting, RpcStatus.Reconnecting];

export function ConnectButton() {
  const t = useTranslate();

  const status = useRpcStore((state) => state.connection.status);
  const attempt = useRpcStore((state) => state.connection.attempt);
  const lastError = useRpcStore((state) => state.connection.lastError);
  const client = useRpcStore((state) => state.client);
  const profiles = useRpcStore((state) => state.profiles);
  const activeIndex = useRpcStore((state) => state.activeIndex);

  const busy = BUSY_STATUSES.includes(status);
  const idle = IDLE_STATUSES.includes(status);
  const connected = status === RpcStatus.Connected;

  /**
   * The reason, if there is one worth showing.
   *
   * Skipped while the transport is already retrying on its own: an error the app is
   * actively working through belongs in the console, not in a label the user is trying
   * to read.
   */
  const reason =
    lastError === undefined || busy || status === RpcStatus.WaitingToReconnect ? undefined : t(lastError);

  const label = reason === undefined ? t(status) : `${t(status)} — ${reason}`;

  const connect = useCallback(() => {
    client?.reconnect();
  }, [client]);

  const disconnect = useCallback(() => {
    client?.disconnect();
  }, [client]);

  const control = connected ? (
    <MduiIconButton icon="hub" label={label} onClick={disconnect} />
  ) : (
    <MduiButton
      variant="text"
      icon="refresh"
      // Disabled while a handshake is in flight: the client serialises, but the button
      // should not invite a user to queue several.
      disabled={busy}
      onClick={connect}
    >
      {idle ? t('Connect') : t('Reconnect')}
      {attempt > 0 && !idle ? ` (${attempt})` : ''}
    </MduiButton>
  );

  /**
   * The tooltip: which endpoint, what state, and why.
   *
   * Naming the endpoint matters most for the CORS case — it is only actionable if the
   * user can see *which* url the browser refused, since the protocol is the thing that
   * has to change.
   */
  const profile = profiles[activeIndex];
  const detail =
    reason === undefined
      ? undefined
      : [
          `${profile?.protocol ?? 'ws'}://${profile?.rpcHost ?? 'localhost'}:${profile?.rpcPort ?? '6800'}/jsonrpc`,
          t(status),
          reason,
        ].join(' — ');

  return detail === undefined ? (
    control
  ) : (
    <MduiTooltip content={detail} placement="bottom">
      {control}
    </MduiTooltip>
  );
}

export default ConnectButton;