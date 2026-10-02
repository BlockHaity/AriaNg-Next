import { describe, expect, it } from 'vitest';

import type { HealthInput, HealthPeer } from '@/domain/health';
import { estimateHealthPercentFromPeers, layeredPeerCoverage } from '@/domain/health';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Pack a boolean array into an aria2 hex bitfield (4 pieces per char, MSB first). */
function encodePieces(pieces: readonly boolean[]): string {
  let out = '';
  for (let i = 0; i < pieces.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      nibble = (nibble << 1) | (pieces[i + j] === true ? 1 : 0);
    }
    out += nibble.toString(16);
  }
  return out;
}

function rangePieces(count: number, from: number, to: number): boolean[] {
  const pieces: boolean[] = [];
  for (let i = 0; i < count; i++) pieces.push(i >= from && i < to);
  return pieces;
}

/** A peer holding `[from, to)` out of `count` pieces, percent derived. */
function peerHolding(count: number, from: number, to: number): HealthPeer {
  return { bitfield: encodePieces(rangePieces(count, from, to)) };
}

/** A peer with an explicitly reported percentage (possibly inconsistent). */
function peerWith(bitfield: string, completePercent: number): HealthPeer {
  return { bitfield, completePercent };
}

function task(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    bitfield: '00',
    numPieces: 8,
    completedPercent: 0,
    peers: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */

describe('estimateHealthPercentFromPeers', () => {
  it('falls back to the task completion when there are no peers', () => {
    expect(
      estimateHealthPercentFromPeers(task({ numPieces: 16, completedPercent: 25, peers: [] })),
    ).toBe(25);
  });

  it('falls back to the task completion when the task has no pieces', () => {
    expect(
      estimateHealthPercentFromPeers(
        task({ numPieces: 0, completedPercent: 42, peers: [peerWith('ffff', 100)] }),
      ),
    ).toBe(42);
  });

  it('survives a missing peers array', () => {
    expect(
      estimateHealthPercentFromPeers(
        task({ numPieces: 8, completedPercent: 12.5, peers: undefined as unknown as HealthPeer[] }),
      ),
    ).toBe(12.5);
  });

  it('keeps the task completion as a floor when no peer holds anything', () => {
    expect(
      estimateHealthPercentFromPeers(
        task({ numPieces: 10, completedPercent: 40, peers: [{ bitfield: '' }, { bitfield: '000' }] }),
      ),
    ).toBe(40);
  });

  it('uses the peer percent when a single peer holds more pieces than we do', () => {
    // we have 1 of 8 pieces (12.5%), the peer holds 6 of 8.
    const health = estimateHealthPercentFromPeers(
      task({
        bitfield: '80',
        numPieces: 8,
        completedPercent: 12.5,
        peers: [peerHolding(8, 0, 6)],
      }),
    );
    expect(health).toBe(75);
  });

  it('takes the union of two peers holding disjoint halves', () => {
    // Neither peer alone is a seeder, but together they cover all 100 pieces.
    const first = peerHolding(100, 0, 50);
    const second = peerHolding(100, 50, 100);

    expect(layeredPeerCoverage([first.bitfield, second.bitfield], 100)).toBe(100);
    expect(
      estimateHealthPercentFromPeers(
        task({ numPieces: 100, completedPercent: 0, peers: [first, second] }),
      ),
    ).toBe(100);
  });

  it('never counts a piece twice when peers overlap', () => {
    const peers = [peerHolding(10, 0, 6), peerHolding(10, 4, 10), peerHolding(10, 0, 10)];

    // union is all 10 pieces, not 6 + 6 + 10
    expect(layeredPeerCoverage(peers.map((peer) => peer.bitfield), 10)).toBe(10);
    expect(estimateHealthPercentFromPeers(task({ numPieces: 10, peers }))).toBe(100);
  });

  it('returns the best single peer when the union is smaller', () => {
    // Piece counts per piece: A=[1,1,1,0,0,0,0,0], B=[1,0,0,0,0,0,0,0] -> union
    // 3 of 8 pieces = 37.5%. A reports 90% (it just hashed pieces it has not
    // advertised yet), so "can this task still be rescued" answers 90%, not the
    // union's 37.5%.
    const health = estimateHealthPercentFromPeers(
      task({
        numPieces: 8,
        completedPercent: 0,
        peers: [peerWith('e000', 90), peerWith('8000', 10)],
      }),
    );
    expect(health).toBe(90);
  });

  it('does not over-count uneven coverage (the original decrement loop did)', () => {
    // Per-piece peer counts are [2, 1]: A has piece 0 only, B has both.
    // The layered count must be 2 pieces, i.e. 100% — not 3/2 * 100 = 150%.
    const peers = [peerHolding(2, 0, 1), peerHolding(2, 0, 2)];
    expect(layeredPeerCoverage(peers.map((peer) => peer.bitfield), 2)).toBe(2);
    expect(estimateHealthPercentFromPeers(task({ numPieces: 2, peers }))).toBe(100);
  });

  it('short-circuits once every piece is covered', () => {
    const numPieces = 4;
    let reads = 0;

    // `bitfield` is only touched while the peer is actually needed, so the
    // counter doubles as a probe for the early exit.
    const tracked = (bitfield: string): HealthPeer => ({
      get bitfield() {
        reads++;
        return bitfield;
      },
    });

    // The first peer alone covers everything, so the remaining peers are never
    // even read (their bitfields cannot change the answer).
    const health = estimateHealthPercentFromPeers(
      task({ numPieces, peers: [tracked('f'), tracked('f'), tracked('f')] }),
    );

    expect(health).toBe(100);
    expect(reads).toBe(1);
  });

  it('still scans every peer while coverage is incomplete', () => {
    let reads = 0;
    const counting = (bitfield: string): HealthPeer => ({
      get bitfield() {
        reads++;
        return bitfield;
      },
    });

    // Eight peers, one distinct piece each, out of 16 -> never full coverage.
    const peers = [0, 1, 2, 3, 4, 5, 6, 7].map((index) =>
      counting(encodePieces(rangePieces(16, index, index + 1))),
    );

    const health = estimateHealthPercentFromPeers(task({ numPieces: 16, peers }));

    expect(reads).toBe(8);
    expect(health).toBe(50); // union 8/16, best peer 1/16
  });

  it('includes the local peer row like the original does', () => {
    const withLocal = estimateHealthPercentFromPeers(
      task({
        bitfield: 'f0',
        numPieces: 8,
        completedPercent: 50,
        peers: [peerHolding(8, 0, 4), { bitfield: 'f0', completePercent: 50, isLocal: true }],
      }),
    );
    expect(withLocal).toBe(50);
  });

  it('derives the peer percent from its bitfield when none is reported', () => {
    // 2 of 8 pieces, no completePercent -> 25%.
    expect(estimateHealthPercentFromPeers(task({ numPieces: 8, peers: [{ bitfield: 'c000' }] }))).toBe(
      25,
    );
  });

  it('clamps the result into 0..100', () => {
    expect(
      estimateHealthPercentFromPeers(task({ numPieces: 4, completedPercent: 150, peers: [] })),
    ).toBe(100);
    expect(
      estimateHealthPercentFromPeers(
        task({ numPieces: 4, completedPercent: -5, peers: [peerWith('f', 120)] }),
      ),
    ).toBe(100);
    expect(
      estimateHealthPercentFromPeers(task({ numPieces: 4, completedPercent: -5, peers: [] })),
    ).toBe(0);
  });
});

describe('layeredPeerCoverage', () => {
  it('returns 0 without peers or pieces', () => {
    expect(layeredPeerCoverage([], 100)).toBe(0);
    expect(layeredPeerCoverage(['ffff'], 0)).toBe(0);
    expect(layeredPeerCoverage(['ffff'], -1)).toBe(0);
    expect(layeredPeerCoverage([], 0)).toBe(0);
  });

  it('returns 0 for peers that hold nothing', () => {
    expect(layeredPeerCoverage(['', '0', '0000'], 8)).toBe(0);
  });

  it('counts the union of arbitrary overlapping bitfields', () => {
    // 12 pieces in three disjoint groups of four.
    const disjoint = [
      encodePieces(rangePieces(12, 0, 4)),
      encodePieces(rangePieces(12, 4, 8)),
      encodePieces(rangePieces(12, 8, 12)),
    ];
    expect(layeredPeerCoverage(disjoint, 12)).toBe(12);
    // 8 pieces: 'f0' = 11110000 (0..3), '18' = 00011000 (3..4) -> 4 + 2 - 1 = 5.
    expect(layeredPeerCoverage(['f0', '18'], 8)).toBe(5);
  });

  it('is capped by the piece count even for oversized bitfields', () => {
    expect(layeredPeerCoverage(['ffffffffffff'], 4)).toBe(4);
    expect(layeredPeerCoverage(['ffff'], 2)).toBe(2);
  });

  it('handles a bitfield shorter than the piece count', () => {
    expect(layeredPeerCoverage(['f'], 8)).toBe(4);
  });
});