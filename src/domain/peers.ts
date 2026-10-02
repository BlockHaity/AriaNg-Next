/**
 * BitTorrent peer normalisation — port of AriaNg's `processBtPeers`
 * (`aria2TaskService.js:385-464`).
 *
 * The rules below look odd in places (the speed swap in particular) but they
 * are load-bearing for the peer table and the peer piece bars, so they are
 * reproduced verbatim.
 *
 * Pure module: no React, no I/O, no network.
 */

import type { Aria2Peer } from '@/rpc/types';
import { completedPiecesOf, getCombinedPieces } from './pieces';
import type { PieceRun } from './pieces';
import { parsePeerClient } from './peer-id';
import type { TaskPeer } from './types';

/** Re-exported so consumers only need to import from `./peers`. */
export type { PieceRun };

/** Name of the synthetic pseudo-peer standing in for the local client. */
export const LOCAL_PEER_NAME = '(local)';

/** `peerId` of the synthetic pseudo-peer standing in for the local client. */
export const LOCAL_PEER_ID = 'local';

export interface NormalizePeersOptions {
  /** MSB-first hex bitfield of the local task. */
  taskBitfield?: string;
  taskNumPieces?: number;
  taskCompletedPieces?: number;
  /** 0..1 over the task's *selected* pieces. */
  taskCompletePercent?: number;
  /** Adds the synthetic `(local)` pseudo-peer. */
  includeLocalPeer?: boolean;
  /** Speeds/seeder flag of the local task, used by the `(local)` peer. */
  taskDownloadSpeed?: number;
  taskUploadSpeed?: number;
  taskSeeder?: boolean;
}

function toNumber(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Re-derive a peer's piece map, clamped to the task's piece count.
 *
 * Peer bitfields can be longer than `numPieces` (padded hex digit) — the
 * trailing bits are dropped so the bar lines up with the task piece bar.  With
 * `numPieces <= 0` the peer's own map is used as-is.
 */
export function getCombinedPeerPieces(peer: TaskPeer, numPieces: number): PieceRun[] {
  const source = peer.pieces ?? [];
  if (source.length === 0) {
    return [];
  }

  let remaining = numPieces > 0 ? numPieces : Number.POSITIVE_INFINITY;
  const pieces: PieceRun[] = [];
  for (const run of source) {
    if (remaining <= 0) {
      break;
    }
    const count = Math.min(run.count, remaining);
    remaining -= count;
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.isCompleted === run.isCompleted) {
      last.count += count;
    } else {
      pieces.push({ isCompleted: run.isCompleted, count });
    }
  }
  return pieces;
}

/** Resolved task-level values the synthetic `(local)` peer needs. */
interface LocalPeerContext {
  bitfield: string;
  numPieces: number;
  completePercent: number;
  seeder: boolean;
  downloadSpeed: number;
  uploadSpeed: number;
}

function buildLocalPeer(task: LocalPeerContext): TaskPeer {
  return {
    peerId: LOCAL_PEER_ID,
    // `port` stays a string: `TaskPeer.port` is `string` because aria2 reports
    // every other peer's port as a string.
    port: '0',
    ip: '',
    name: LOCAL_PEER_NAME,
    // NOTE: the local peer is NOT swapped — aria2 already reports the task
    // speeds from our own point of view.
    downloadSpeed: task.downloadSpeed,
    uploadSpeed: task.uploadSpeed,
    completePercent: task.completePercent,
    seeder: task.seeder,
    amChoking: false,
    peerChoking: false,
    pieces: getCombinedPieces(task.bitfield, task.numPieces),
    isLocal: true,
  };
}

/**
 * Normalise `aria2.tellStatus(..., ['peers'])` for rendering.
 *
 * Input order is preserved (AriaNg did not sort here — the UI does it), and the
 * synthetic `(local)` peer is appended last.
 */
export function normalizePeers(
  peers: Aria2Peer[],
  options: NormalizePeersOptions = {},
): TaskPeer[] {
  const {
    taskBitfield = '',
    taskNumPieces = 0,
    taskCompletedPieces,
    taskCompletePercent = 0,
    includeLocalPeer = false,
    taskDownloadSpeed = 0,
    taskUploadSpeed = 0,
    taskSeeder = false,
  } = options;

  const result: TaskPeer[] = peers.map((peer) => {
    const client = parsePeerClient(peer.peerIdRaw ?? peer.peerId);
    const completedPieces = completedPiecesOf(peer.bitfield, taskNumPieces);

    let completePercent = taskNumPieces > 0 ? completedPieces / taskNumPieces : 0;
    // AriaNg quirk: a peer that has exactly as many pieces as we do is
    // rendered with OUR progress, so equally-advanced peers stay consistent
    // (a peer can legitimately hold a different set of the same amount).
    if (taskCompletedPieces !== undefined && completedPieces === taskCompletedPieces) {
      completePercent = taskCompletePercent;
    }

    return {
      peerId: peer.peerId,
      ip: peer.ip,
      port: peer.port,
      name: `${peer.ip}:${peer.port}`,
      client,
      // ------------------------------------------------------------------------
      // NOT A BUG: aria2 reports a peer's `downloadSpeed`/`uploadSpeed` from
      // that PEER's point of view (what it sends us / what it takes from us),
      // while the UI column means "what we send / what we receive".  The two
      // are therefore swapped here.  Keep it that way.
      // ------------------------------------------------------------------------
      downloadSpeed: toNumber(peer.uploadSpeed),
      uploadSpeed: toNumber(peer.downloadSpeed),
      completePercent,
      seeder: peer.seeder === 'true',
      amChoking: peer.amChoking === 'true',
      peerChoking: peer.peerChoking === 'true',
      pieces: getCombinedPieces(peer.bitfield, taskNumPieces),
    };
  });

  if (includeLocalPeer) {
    result.push(
      buildLocalPeer({
        bitfield: taskBitfield,
        numPieces: taskNumPieces,
        completePercent: taskCompletePercent,
        seeder: taskSeeder,
        downloadSpeed: taskDownloadSpeed,
        uploadSpeed: taskUploadSpeed,
      }),
    );
  }

  return result;
}