/**
 * Peers tab.
 *
 * Port of `views/task-detail.html` lines 288-366 (the peer table and its
 * context menu) plus `changePeerListDisplayOrder` / `getPeerListOrderType`
 * (`task-detail.js:653-673`).
 *
 * Details that are easy to get wrong and are therefore reproduced exactly:
 *
 * - **Address and Client are two independent sortable links** separated by a
 *   literal `/`, both inside one header cell, and each has its own sort type
 *   (`address` = ip + port, `client` = client.name + client.version).
 * - **Status** holds the peer's piece bar; **Progress** (right aligned) shares
 *   that cell and is sortable on its own.
 * - The synthetic `(local)` pseudo-peer is part of the list (AriaNg always
 *   passed `includeLocalPeer: true`), and it carries no address, so the row
 *   falls back to the peer's `name`, which normalisation set to `(local)`.
 * - The empty state is AriaNg's `No connected peers`.
 *
 * aria2-next additions: `bittorrent.connectingPeers` / `handshakingPeers` are
 * surfaced above the table (they explain why the peer count looks low), and the
 * structured `bittorrent.error` object is rendered when the swarm has one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { naturalCompare } from '@/config/defaults';
import type { PeerOrderBy, PeerOrderType } from '@/config/types';
import type { TaskPeer } from '@/domain/types';
import { formatPercent, readableVolume } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import { useSettingsStore } from '@/store/settings';
import { MduiIcon } from '@/ui/mdui';
import { PieceBar } from '../PieceBar';

/** The six sort types of the Display Order submenu. */
export const PEER_ORDER_TYPES: readonly PeerOrderType[] = [
  'default',
  'address',
  'client',
  'percent',
  'dspeed',
  'uspeed',
];

export const PEER_ORDER_LABELS: Record<PeerOrderType, string> = {
  default: 'Default',
  address: 'By Peer Address',
  client: 'By Client Name',
  percent: 'By Progress',
  dspeed: 'By Download Speed',
  uspeed: 'By Upload Speed',
};

/** The concrete order each Display Order entry applies. */
export function contextMenuPeerOrder(type: PeerOrderType): PeerOrderBy {
  switch (type) {
    case 'address':
      return 'address:asc';
    case 'client':
      return 'client:asc';
    case 'percent':
      return 'percent:desc';
    case 'dspeed':
      return 'dspeed:desc';
    case 'uspeed':
      return 'uspeed:desc';
    case 'default':
    default:
      return 'default:asc';
  }
}

export interface ParsedPeerOrder {
  type: PeerOrderType;
  desc: boolean;
}

export function parsePeerOrder(value: string | undefined): ParsedPeerOrder {
  const raw = (value ?? '').trim();
  const separator = raw.lastIndexOf(':');
  const head = separator >= 0 ? raw.slice(0, separator) : raw;
  const tail = separator >= 0 ? raw.slice(separator + 1) : 'asc';
  const type = (PEER_ORDER_TYPES as readonly string[]).includes(head) ? (head as PeerOrderType) : 'default';

  return { type, desc: tail === 'desc' };
}

/** AriaNg's `equals` with a direction. */
export function matchesPeerOrder(current: string | undefined, value: PeerOrderBy): boolean {
  const a = parsePeerOrder(current);
  const b = parsePeerOrder(value);
  return a.type === b.type && a.desc === b.desc;
}

function comparePeers(a: TaskPeer, b: TaskPeer, type: PeerOrderType): number {
  switch (type) {
    case 'address':
      return naturalCompare(a.ip, b.ip) || naturalCompare(a.port, b.port);
    case 'client':
      return (
        naturalCompare(a.client?.name ?? '', b.client?.name ?? '') ||
        naturalCompare(a.client?.version ?? '', b.client?.version ?? '')
      );
    case 'percent':
      return a.completePercent - b.completePercent;
    case 'dspeed':
      return a.downloadSpeed - b.downloadSpeed;
    case 'uspeed':
      return a.uploadSpeed - b.uploadSpeed;
    case 'default':
    default:
      return 0;
  }
}

/** Stable sort, matching AriaNg's `$filter('orderBy')(array, keys, reverse)`. */
export function sortPeers(peers: readonly TaskPeer[], order: string | undefined): TaskPeer[] {
  const { type, desc } = parsePeerOrder(order);
  if (type === 'default') return [...peers];

  return peers
    .map((peer, index) => ({ peer, index }))
    .sort((a, b) => {
      const result = comparePeers(a.peer, b.peer, type);
      if (result !== 0) return desc ? -result : result;
      return a.index - b.index;
    })
    .map((entry) => entry.peer);
}

export interface PeersTabProps {
  peers: readonly TaskPeer[];
  /** The task's piece count, so a peer bar lines up with the task's map. */
  numPieces: number;
  /** Health percentage, announced next to the table. */
  healthPercent: number;
  /** `bittorrent.connectingPeers` / `handshakingPeers` (aria2-next). */
  connectingPeers?: number;
  handshakingPeers?: number;
  /** aria2-next structured torrent error. */
  error?: {
    code?: number;
    kind?: string;
    category?: string;
    message?: string;
    recoverable?: boolean;
  };
}

export function PeersTab({
  peers,
  numPieces,
  healthPercent,
  connectingPeers,
  handshakingPeers,
  error,
}: PeersTabProps) {
  const t = useTranslate();
  const order = useSettingsStore((state) => state.settings.peerListDisplayOrder);
  const setSetting = useSettingsStore((state) => state.set);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Dismiss the menu the same way the overview's does.
  useEffect(() => {
    if (!contextMenu) return;

    const onPointerDown = (): void => setContextMenu(null);
    const onKeyDown = (event: Event): void => {
      if ((event as KeyboardEvent).key === 'Escape') setContextMenu(null);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const sorted = useMemo(() => sortPeers(peers, order), [peers, order]);

  const changeDisplayOrder = useCallback(
    (next: PeerOrderBy, autoSetReverse: boolean) => {
      const previous = parsePeerOrder(order);
      const target = parsePeerOrder(next);
      const resolved =
        autoSetReverse && previous.type === target.type ? { ...target, desc: !previous.desc } : target;

      setSetting('peerListDisplayOrder', `${resolved.type}:${resolved.desc ? 'desc' : 'asc'}` as PeerOrderBy);
    },
    [order, setSetting],
  );

  const sortLink = (entry: { labelKey: string; order: PeerOrderBy }) => (
    <button
      type="button"
      className="ariang-sort-button"
      aria-label={t(entry.labelKey)}
      onClick={() => changeDisplayOrder(entry.order, true)}
    >
      <span>{t(entry.labelKey)}</span>
      {parsePeerOrder(order).type === parsePeerOrder(entry.order).type ? (
        <MduiIcon
          name={parsePeerOrder(order).desc ? 'expand-less' : 'expand-more'}
          size="1rem"
          className="ariang-sort-indicator"
        />
      ) : null}
    </button>
  );

  const showPending =
    (connectingPeers !== undefined && connectingPeers > 0) ||
    (handshakingPeers !== undefined && handshakingPeers > 0);

  return (
    <div className="ariang-task-detail">
      {error ? (
        <div className="ariang-warning-row" role="status">
          <MduiIcon name="warning" size="1.25rem" />
          <span>
            {[
              error.kind,
              error.category,
              error.code !== undefined ? String(error.code) : '',
              error.recoverable ? 'recoverable' : '',
            ]
              .filter((part) => !!part)
              .join(' · ')}
            {error.message ? ` — ${error.message}` : ''}
          </span>
        </div>
      ) : null}

      <div className="ariang-task-table" role="table" aria-label={t('Peers')}>
        <div className="ariang-task-table-head" role="row">
          {/* Address and Client are two independent sort links in one cell. */}
          <div className="ariang-cell-name" role="columnheader">
            {sortLink({ labelKey: 'Address', order: 'address:asc' })}
            <span aria-hidden="true">/</span>
            {sortLink({ labelKey: 'Client', order: 'client:asc' })}
          </div>

          <div className="ariang-cell-peer-status" role="columnheader">
            <span style={{ flex: '1 1 auto' }}>{t('Status')}</span>
            <span className="ariang-text-end">{sortLink({ labelKey: 'Progress', order: 'percent:desc' })}</span>
          </div>

          <div className="ariang-cell-peer-speed" role="columnheader">
            {sortLink({ labelKey: 'Download', order: 'dspeed:desc' })}
            <span aria-hidden="true">/</span>
            {sortLink({ labelKey: 'Upload', order: 'uspeed:desc' })}
            <span>{t('Speed')}</span>
          </div>
        </div>

        <div role="rowgroup">
          {sorted.map((peer) => {
            const client = peer.client;
            const address = peer.ip ? `${peer.ip}:${peer.port}` : peer.name;

            return (
              <div
                key={peer.peerId}
                className="ariang-task-table-row"
                role="row"
                data-peer-id={peer.peerId}
                data-local={peer.isLocal ? 'true' : 'false'}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY });
                }}
              >
                <div className="ariang-cell-name" role="cell">
                  <span
                    className="ariang-ellipsis"
                    title={[client?.info, peer.seeder ? t('Seeding') : ''].filter((part) => !!part).join(', ')}
                  >
                    <span>{address}</span>
                    {peer.seeder ? <MduiIcon name="keyboard-arrow-up" size="0.875rem" /> : null}
                    {client ? (
                      <span className="ariang-track-meta">
                        {` (${client.name}${client.version ? ` ${client.version}` : ''})`}
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="ariang-cell-peer-status" role="cell">
                  <PieceBar
                    runs={peer.pieces}
                    pieceCount={numPieces}
                    label={`${address} ${formatPercent(peer.completePercent, 2)}%`}
                  />
                  <span className="ariang-mono ariang-text-end" style={{ flex: '0 0 auto' }}>
                    {formatPercent(peer.completePercent, 2)}%
                  </span>
                </div>

                <div className="ariang-cell-peer-speed" role="cell">
                  {/* aria2's arrows: what we pull from the peer and what we push. */}
                  <MduiIcon name="download" size="0.875rem" />
                  <span>{`${readableVolume(peer.downloadSpeed)}/s`}</span>
                  <MduiIcon name="upload" size="0.875rem" />
                  <span>{`${readableVolume(peer.uploadSpeed)}/s`}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {sorted.length === 0 ? <p className="ariang-empty-state">{t('No connected peers')}</p> : null}

      <p className="ariang-helper-text">
        {`${t('Health Percentage')}: ${formatPercent(healthPercent, 2)}%`}
        {showPending
          ? ` · ${t('Connecting')}: ${connectingPeers ?? 0} · ${t('Handshaking')}: ${handshakingPeers ?? 0}`
          : ''}
      </p>

      {contextMenu ? (
        <div className="ariang-context-menu" role="menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}>
          {PEER_ORDER_TYPES.map((type) => {
            const orderValue = contextMenuPeerOrder(type);
            return (
              <button
                key={type}
                type="button"
                role="menuitemradio"
                aria-checked={matchesPeerOrder(order, orderValue)}
                className="ariang-context-menu-item"
                onClick={() => {
                  changeDisplayOrder(orderValue, false);
                  setContextMenu(null);
                }}
              >
                <span>{t(PEER_ORDER_LABELS[type])}</span>
                {parsePeerOrder(order).type === type ? (
                  <MduiIcon name="check" size="1rem" className="ariang-context-menu-check" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default PeersTab;