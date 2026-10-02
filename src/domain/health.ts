/**
 * "Health" of a BitTorrent task — port of AriaNg's
 * `aria2TaskService.estimateHealthPercentFromPeers` (`aria2TaskService.js`
 * lines 992-1057).
 *
 * The number answers a question the plain completion percentage cannot:
 * *if this task stalls right now, how much of it can the connected peers still
 * deliver?*  Two things can rescue a stalled download:
 *
 *   1. **Layered coverage** — the union of every peer's bitfield.  No single
 *      peer needs the whole file; ten peers holding disjoint tenths together
 *      can still complete it.
 *   2. **The best single peer** — its own completion percentage.
 *
 * The health percentage is therefore `max(coveragePercent, bestPeerPercent)`,
 * floored by the task's own `completedPercent` (the original seeds the best
 * peer value with it, so the health figure can never look *worse* than what we
 * already have on disk).
 */

import { forEachPieceBit } from '@/domain/pieces';

/* ------------------------------------------------------------------ */
/* Input shapes                                                        */
/* ------------------------------------------------------------------ */

/** The subset of a peer row the health estimate needs. */
export interface HealthPeer {
  /** Hex bitfield, same MSB-first layout as the task's own. */
  bitfield: string;
  /**
   * Percentage of pieces this peer holds (0..100). Optional because it is
   * derived from `bitfield` when the caller has not normalised it yet.
   */
  completePercent?: number;
  /** aria2-next synthesises a `(local)` peer row for the task itself. */
  isLocal?: boolean;
}

export interface HealthInput {
  /** The task's own bitfield (unused for the arithmetic, kept for context). */
  bitfield: string;
  numPieces: number;
  /** Task completion, 0..100, as normalised by `@/domain/normalize`. */
  completedPercent: number;
  peers: HealthPeer[];
}

/* ------------------------------------------------------------------ */
/* Numeric helpers                                                     */
/* ------------------------------------------------------------------ */

function toPieceCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Percentages are clamped into 0..100 — aria2 never produces anything else. */
function toPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 100 ? 100 : value;
}

/**
 * Percentage a peer reports, falling back to the share of pieces its bitfield
 * actually covers (the computation `aria2TaskService.processBtPeers` does
 * when it normalises `peer.completePercent`).
 */
function peerPercent(peer: HealthPeer, heldPieces: number, numPieces: number): number {
  const reported = peer.completePercent;
  if (typeof reported === 'number' && Number.isFinite(reported)) return toPercent(reported);
  return (heldPieces / numPieces) * 100;
}

/* ------------------------------------------------------------------ */
/* Layered coverage                                                    */
/* ------------------------------------------------------------------ */

/**
 * How many of `numPieces` pieces are held by **at least one** of `bitfields` —
 * i.e. the OR of every peer bitfield.
 *
 * The original built a `numPieces`-long counter array, OR-ed every peer into
 * it and then peeled off one "layer" per pass, counting one unit per piece per
 * layer.  That final, half-consumed pass kept counting decrements for pieces
 * *after* the first exhausted one, so uneven coverage (e.g. counts `[1, 3]`)
 * reported 3 covered pieces instead of the 2 that are actually covered.
 *
 * Same O(pieces x peers) worst case, but a piece is only counted on the
 * transition `0 -> 1`, which is the exact OR semantics the algorithm was
 * reaching for — and coverage reaching `numPieces` ends the scan immediately
 * (once every piece is covered, no later peer can change the answer).
 */
export function layeredPeerCoverage(bitfields: string[], numPieces: number): number {
  const total = toPieceCount(numPieces);
  if (total === 0 || bitfields.length === 0) return 0;

  // 1 = covered by at least one peer so far.
  const covered = new Uint8Array(total);
  let coveredCount = 0;

  for (const bitfield of bitfields) {
    if (coveredCount >= total) break; // short-circuit: full coverage already
    forEachPieceBit(bitfield, total, (index, isCompleted) => {
      if (!isCompleted || covered[index] !== 0) return;
      covered[index] = 1;
      coveredCount++;
    });
  }

  return coveredCount;
}

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

/**
 * Health percentage of a task given its connected peers, 0..100.
 *
 * Falls back to `completedPercent` when there is nothing to learn from the
 * swarm (no peers, or a task without pieces — non-BT downloads, completed
 * metadata-less magnets), exactly like the original's guard clause.
 *
 * Otherwise `max(layered coverage, best single peer)`; the peers are scanned
 * once, collecting both numbers in a single pass over their bits.
 */
export function estimateHealthPercentFromPeers(task: HealthInput): number {
  const numPieces = toPieceCount(task.numPieces);
  const ownPercent = toPercent(task.completedPercent);
  const peers = Array.isArray(task.peers) ? task.peers : [];

  if (numPieces < 1 || peers.length === 0) return ownPercent;

  // Coverage accumulator (see layeredPeerCoverage) — reused for the best peer.
  const coveredByPeer = new Uint8Array(numPieces);
  let coveredCount = 0;

  // "Best peer" = the one holding the most pieces, ties broken by the higher
  // reported percentage.  Seeded with the task's own completion, which makes
  // the final `max` a floor instead of a separate branch.
  let bestHeldPieces = 0;
  let bestPercent = ownPercent;

  for (const peer of peers) {
    if (coveredCount >= numPieces) break; // short-circuit: full coverage

    let heldPieces = 0;
    forEachPieceBit(peer.bitfield, numPieces, (index, isCompleted) => {
      if (!isCompleted) return;
      heldPieces++;
      if (coveredByPeer[index] === 0) {
        coveredByPeer[index] = 1;
        coveredCount++;
      }
    });

    const percent = peerPercent(peer, heldPieces, numPieces);
    if (heldPieces > bestHeldPieces || (heldPieces === bestHeldPieces && percent > bestPercent)) {
      bestHeldPieces = heldPieces;
      bestPercent = percent;
    }
  }

  const coveragePercent = (coveredCount / numPieces) * 100;
  return toPercent(coveragePercent > bestPercent ? coveragePercent : bestPercent);
}