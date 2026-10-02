import { describe, expect, it } from 'vitest';

import {
  CANVAS_RENDER_THRESHOLD,
  DEFAULT_PIECES_INFO_SETTING,
  PIECE_CELL_PITCH,
  PIECE_MAP_PADDING_X,
  completedPiecesOf,
  computeNumPieces,
  computePieceLength,
  estimatePieceGridColumns,
  forEachPieceBit,
  getCombinedPieces,
  getPieceStatus,
  isPiecesInfoVisible,
  pieceRenderMode,
  shouldUseCanvas,
} from '@/domain/pieces';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pack a boolean array back into an aria2 hex bitfield (4 pieces per char,
 * first piece = most significant bit). Used to build fixtures the same way
 * aria2 would, so the decode tests cannot drift from the encode side.
 */
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

/** `pieces` repeated `times`. */
function repeat(times: number, pieces: boolean[]): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < times; i++) out.push(...pieces);
  return out;
}

/** `count` consecutive completed pieces followed by `count` missing ones. */
function halves(count: number): boolean[] {
  return [...repeat(count, [true]), ...repeat(count, [false])];
}

/* ------------------------------------------------------------------ */

describe('getPieceStatus', () => {
  it('decodes a nibble most-significant-bit first', () => {
    // 'a' === 0b1010
    expect(getPieceStatus('a', 4)).toEqual([true, false, true, false]);
    // '8' === 0b1000
    expect(getPieceStatus('8', 4)).toEqual([true, false, false, false]);
    // 'f' === 0b1111
    expect(getPieceStatus('f', 4)).toEqual([true, true, true, true]);
    // '0' === 0b0000
    expect(getPieceStatus('0', 4)).toEqual([false, false, false, false]);
    // '1' === 0b0001 — the LAST piece of the group
    expect(getPieceStatus('1', 4)).toEqual([false, false, false, true]);
  });

  it('continues across hex characters, MSB first in every one', () => {
    // 'a8' === 1010 1000
    expect(getPieceStatus('a8', 8)).toEqual([true, false, true, false, true, false, false, false]);
    // '50' === 0101 0000
    expect(getPieceStatus('50', 8)).toEqual([false, true, false, true, false, false, false, false]);
  });

  it('accepts upper-case hex like aria2 upper-cases some payloads', () => {
    expect(getPieceStatus('A8', 8)).toEqual(getPieceStatus('a8', 8));
  });

  it('treats an empty bitfield as "nothing downloaded"', () => {
    expect(getPieceStatus('', 6)).toEqual([false, false, false, false, false, false]);
  });

  it('pads a bitfield that is shorter than the piece count', () => {
    expect(getPieceStatus('a', 8)).toEqual([true, false, true, false, false, false, false, false]);
    expect(getPieceStatus('8', 5)).toEqual([true, false, false, false, false]);
  });

  it('truncates a bitfield that is longer than the piece count', () => {
    expect(getPieceStatus('ffff', 3)).toEqual([true, true, true]);
    expect(getPieceStatus('ffffffff', 2)).toHaveLength(2);
  });

  it('returns an empty array for a zero / negative piece count', () => {
    expect(getPieceStatus('ffff', 0)).toEqual([]);
    expect(getPieceStatus('ffff', -10)).toEqual([]);
  });

  it('always returns exactly pieceCount entries', () => {
    for (const [bitfield, count] of [
      ['', 5],
      ['a', 5],
      ['abcdef', 5],
      ['a', 0],
    ] as const) {
      expect(getPieceStatus(bitfield, count)).toHaveLength(count);
    }
  });

  it('treats non-hex characters as four zero bits (parseInt -> NaN in the original)', () => {
    expect(getPieceStatus('z', 4)).toEqual([false, false, false, false]);
    expect(getPieceStatus('z8', 8)).toEqual([false, false, false, false, true, false, false, false]);
  });

  it('survives a non-string bitfield coming off the wire', () => {
    expect(getPieceStatus(undefined as unknown as string, 4)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('round-trips through encodePieces', () => {
    const fixture = [
      true, false, true, false, false, true, true, true, true, false, false, true,
    ];
    expect(getPieceStatus(encodePieces(fixture), fixture.length)).toEqual(fixture);
  });
});

describe('forEachPieceBit', () => {
  it('visits every piece index in ascending order', () => {
    const seen: Array<[number, boolean]> = [];
    forEachPieceBit('a8', 8, (index, isCompleted) => seen.push([index, isCompleted]));
    expect(seen).toEqual([
      [0, true],
      [1, false],
      [2, true],
      [3, false],
      [4, true],
      [5, false],
      [6, false],
      [7, false],
    ]);
  });

  it('never visits anything for a non-positive piece count', () => {
    let calls = 0;
    forEachPieceBit('ffff', 0, () => calls++);
    expect(calls).toBe(0);
  });
});

describe('getCombinedPieces', () => {
  it('run-length encodes alternating pieces', () => {
    // 1110 0110 -> [t,t,t,f,f,t]
    expect(getCombinedPieces('e6', 6)).toEqual([
      { isCompleted: true, count: 3 },
      { isCompleted: false, count: 2 },
      { isCompleted: true, count: 1 },
    ]);
  });

  it('collapses a uniform map into a single run', () => {
    expect(getCombinedPieces('ff', 8)).toEqual([{ isCompleted: true, count: 8 }]);
    expect(getCombinedPieces('00', 8)).toEqual([{ isCompleted: false, count: 8 }]);
    expect(getCombinedPieces('', 5)).toEqual([{ isCompleted: false, count: 5 }]);
  });

  it('emits one run per change, starting with the first piece state', () => {
    const runs = getCombinedPieces('5', 4); // 0101
    expect(runs).toEqual([
      { isCompleted: false, count: 1 },
      { isCompleted: true, count: 1 },
      { isCompleted: false, count: 1 },
      { isCompleted: true, count: 1 },
    ]);
  });

  it('returns no runs for an empty piece map', () => {
    expect(getCombinedPieces('ffff', 0)).toEqual([]);
    expect(getCombinedPieces('', 0)).toEqual([]);
  });

  it('always accounts for exactly pieceCount pieces', () => {
    const total = (runs: { count: number }[]) => runs.reduce((sum, run) => sum + run.count, 0);
    expect(total(getCombinedPieces('e6', 6))).toBe(6);
    expect(total(getCombinedPieces('a', 9))).toBe(9);
    expect(total(getCombinedPieces(encodePieces(halves(50)), 100))).toBe(100);
  });

  it('never produces more runs than pieces', () => {
    const alternating = repeat(64, [true, false]);
    const runs = getCombinedPieces(encodePieces(alternating), alternating.length);
    expect(runs).toHaveLength(alternating.length);
  });
});

describe('completedPiecesOf', () => {
  it('counts the completed pieces', () => {
    expect(completedPiecesOf('a', 4)).toBe(2);
    expect(completedPiecesOf('f', 4)).toBe(4);
    expect(completedPiecesOf('0', 4)).toBe(0);
    expect(completedPiecesOf('', 8)).toBe(0);
    expect(completedPiecesOf('a', 8)).toBe(2);
    expect(completedPiecesOf('ffff', 3)).toBe(3);
    expect(completedPiecesOf('ffff', 0)).toBe(0);
  });

  it('agrees with getPieceStatus', () => {
    const fixture = [true, false, true, true, false, false, true, false, true, true, true];
    const bitfield = encodePieces(fixture);
    expect(completedPiecesOf(bitfield, fixture.length)).toBe(
      getPieceStatus(bitfield, fixture.length).filter(Boolean).length,
    );
  });
});

describe('computeNumPieces / computePieceLength', () => {
  it('divides the total length by the piece length, rounding up', () => {
    expect(computeNumPieces(1000, 100)).toBe(10);
    expect(computeNumPieces(1001, 100)).toBe(11);
    expect(computeNumPieces(999, 100)).toBe(10);
    expect(computeNumPieces(1, 1)).toBe(1);
  });

  it('divides the total length by the piece count, rounding up', () => {
    expect(computePieceLength(1000, 10)).toBe(100);
    expect(computePieceLength(1001, 10)).toBe(101);
    expect(computePieceLength(999, 10)).toBe(100);
    expect(computePieceLength(1, 1)).toBe(1);
  });

  it('returns 0 for an unknown divisor', () => {
    expect(computeNumPieces(1000, 0)).toBe(0);
    expect(computeNumPieces(1000, -5)).toBe(0);
    expect(computePieceLength(1000, 0)).toBe(0);
    expect(computePieceLength(1000, -5)).toBe(0);
  });

  it('returns 0 for an empty payload', () => {
    expect(computeNumPieces(0, 100)).toBe(0);
    expect(computePieceLength(0, 10)).toBe(0);
  });

  it('is a round trip for realistic piece counts', () => {
    for (const [total, pieces] of [
      [1000, 10],
      [1001, 10],
      [9999, 100],
      [4 * 1024 * 1024, 1024],
    ] as const) {
      expect(computeNumPieces(total, computePieceLength(total, pieces))).toBe(pieces);
    }
  });

  it('never over-counts when the round trip is lossy, and always covers the payload', () => {
    // 10 bytes over 6 pieces => 2 bytes each => only 5 whole pieces exist.
    const pieceLength = computePieceLength(10, 6);
    const numPieces = computeNumPieces(10, pieceLength);
    expect(numPieces).toBeLessThanOrEqual(6);
    expect(pieceLength * numPieces).toBeGreaterThanOrEqual(10);
  });

  it('agrees with each other on a large payload', () => {
    const total = 5 * 1024 * 1024 * 1024 + 7;
    const pieceLength = computePieceLength(total, 2048);
    expect(computeNumPieces(total, pieceLength)).toBeGreaterThanOrEqual(2048);
    expect(pieceLength).toBe(Math.ceil(total / 2048));
  });
});

describe('isPiecesInfoVisible', () => {
  it('honours always / never', () => {
    expect(isPiecesInfoVisible(1, 'always')).toBe(true);
    expect(isPiecesInfoVisible(102400, 'always')).toBe(true);
    expect(isPiecesInfoVisible(10_000_000, 'always')).toBe(true);
    expect(isPiecesInfoVisible(0, 'never')).toBe(false);
    expect(isPiecesInfoVisible(1, 'never')).toBe(false);
  });

  it('applies the le1024 threshold inclusively', () => {
    expect(isPiecesInfoVisible(1023, 'le1024')).toBe(true);
    expect(isPiecesInfoVisible(1024, 'le1024')).toBe(true);
    expect(isPiecesInfoVisible(1025, 'le1024')).toBe(false);
  });

  it('applies the le10240 threshold inclusively', () => {
    expect(isPiecesInfoVisible(10239, 'le10240')).toBe(true);
    expect(isPiecesInfoVisible(10240, 'le10240')).toBe(true);
    expect(isPiecesInfoVisible(10241, 'le10240')).toBe(false);
  });

  it('applies the le102400 threshold inclusively', () => {
    expect(isPiecesInfoVisible(102399, 'le102400')).toBe(true);
    expect(isPiecesInfoVisible(102400, 'le102400')).toBe(true);
    expect(isPiecesInfoVisible(102401, 'le102400')).toBe(false);
  });

  it('defaults to le10240, like AriaNg', () => {
    expect(DEFAULT_PIECES_INFO_SETTING).toBe('le10240');
    expect(isPiecesInfoVisible(10240)).toBe(true);
    expect(isPiecesInfoVisible(10241)).toBe(false);
  });

  it('falls through to "visible" for an unknown setting value', () => {
    expect(isPiecesInfoVisible(999999, 'nonsense' as never)).toBe(true);
  });
});

describe('shouldUseCanvas', () => {
  it('switches to canvas strictly above the threshold', () => {
    expect(shouldUseCanvas(CANVAS_RENDER_THRESHOLD - 1)).toBe(false);
    expect(shouldUseCanvas(CANVAS_RENDER_THRESHOLD)).toBe(false);
    expect(shouldUseCanvas(CANVAS_RENDER_THRESHOLD + 1)).toBe(true);
    expect(CANVAS_RENDER_THRESHOLD).toBe(1024);
  });

  it('never uses canvas without pieces', () => {
    expect(shouldUseCanvas(0)).toBe(false);
    expect(shouldUseCanvas(-1)).toBe(false);
    expect(shouldUseCanvas(0, 0)).toBe(false);
  });

  it('accepts a custom threshold', () => {
    expect(shouldUseCanvas(100, 100)).toBe(false);
    expect(shouldUseCanvas(101, 100)).toBe(true);
    expect(shouldUseCanvas(1, 0)).toBe(true);
  });

  it('reports the matching render mode', () => {
    expect(pieceRenderMode(10)).toBe('dom');
    expect(pieceRenderMode(102400)).toBe('canvas');
  });
});

describe('estimatePieceGridColumns', () => {
  it('fits whole cells into the container width', () => {
    // (800 - 8 padding) / 11 per cell = 72
    expect(PIECE_CELL_PITCH).toBe(11);
    expect(PIECE_MAP_PADDING_X).toBe(8);
    expect(estimatePieceGridColumns(102400, 800)).toEqual({ columns: 72, rows: 1423 });
  });

  it('never allocates more columns than there are pieces', () => {
    expect(estimatePieceGridColumns(10, 800)).toEqual({ columns: 10, rows: 1 });
    expect(estimatePieceGridColumns(1, 800)).toEqual({ columns: 1, rows: 1 });
  });

  it('degrades to one column for a container that has not been measured', () => {
    expect(estimatePieceGridColumns(102400, 0)).toEqual({ columns: 1, rows: 102400 });
    expect(estimatePieceGridColumns(10, Number.NaN)).toEqual({ columns: 1, rows: 10 });
  });

  it('reports an empty grid for an empty piece map', () => {
    expect(estimatePieceGridColumns(0, 800)).toEqual({ columns: 0, rows: 0 });
    expect(estimatePieceGridColumns(-5, 800)).toEqual({ columns: 0, rows: 0 });
  });

  it('covers every piece with the returned grid', () => {
    for (const [count, width] of [
      [102400, 1920],
      [10240, 360],
      [1023, 1200],
      [7, 40],
    ] as const) {
      const { columns, rows } = estimatePieceGridColumns(count, width);
      expect(columns).toBeGreaterThanOrEqual(1);
      expect(columns).toBeLessThanOrEqual(count);
      expect(columns * rows).toBeGreaterThanOrEqual(count);
      // no more than one partially filled row.
      expect((rows - 1) * columns).toBeLessThan(count);
    }
  });

  it('clamps to the maximum column count on absurdly wide containers', () => {
    const { columns, rows } = estimatePieceGridColumns(200000, 100_000);
    expect(columns).toBe(1024);
    expect(rows).toBe(Math.ceil(200000 / 1024));
  });

  it('only ever returns an integer, positive grid', () => {
    const grid = estimatePieceGridColumns(102400, 743.7);
    expect(Number.isInteger(grid.columns)).toBe(true);
    expect(Number.isInteger(grid.rows)).toBe(true);
    // (743.7 - 8) / 11 = 66.88 -> 66
    expect(grid.columns).toBe(66);
  });
});