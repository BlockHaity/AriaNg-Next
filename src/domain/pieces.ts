/**
 * Bitfield ("piece") maths — a faithful port of AriaNg's
 * `aria2TaskService.getPieceStatus` / `getCombinedPieces` plus the small
 * helpers the piece map, the piece bar and the peer list need.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BIT ORDER (read this before touching anything below)
 * ─────────────────────────────────────────────────────────────────────────
 * aria2 reports `bitfield` as a **hex string**, 4 pieces per character, and
 * inside each character the bits are **most-significant first**:
 *
 *     bitfield "a"  ->  'a' === 0b1010  ->  pieces [true, false, true, false]
 *     bitfield "8"  ->  '8' === 0b1000  ->  pieces [true, false, false, false]
 *     bitfield "f"  ->  'f' === 0b1111  ->  pieces [true, true,  true,  true ]
 *
 * Piece index i therefore lives in hex character `floor(i / 4)` at bit
 * position `3 - (i % 4)`, i.e. `(nibble >> (3 - (i % 4))) & 1`.  It is *not*
 * LSB-first (unlike the `BitVector` in aria2's C++ core, which packs bits the
 * other way round) and it is *not* one hex character per piece.
 *
 * This is the single reason piece maps used to look "mirrored" in AriaNg
 * re-implementations: `getPieceStatus` is the only place allowed to know it.
 * Everything else (RLE, coverage, counts) goes through `forEachPieceBit`.
 *
 * Degenerate inputs are treated as "no bits set" instead of throwing, because
 * aria2 sends `bitfield: ''` for non-BitTorrent tasks and omits `numPieces`
 * entirely in that case:
 *   - missing hex characters  -> the trailing pieces are `false`
 *   - surplus hex characters  -> ignored (truncated at `pieceCount`)
 *   - unknown characters      -> all four bits clear (`parseInt('z', 16)` is
 *                                NaN in the original, and `NaN & bit` is 0)
 */

import type { PiecesInfoSetting } from '@/config/types';

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

/**
 * One run of consecutive pieces that share the same completion state — the
 * unit the canvas piece bar draws. Structurally identical to
 * `TaskListEntry['pieces']` / `TaskPeer['pieces']` in `@/domain/types`.
 */
export interface PieceRun {
  isCompleted: boolean;
  count: number;
}

/** How a piece map should be painted. */
export type PieceRenderMode = 'dom' | 'canvas';

/* ------------------------------------------------------------------ */
/* Numeric helpers                                                     */
/* ------------------------------------------------------------------ */

/** Coerce anything (including `NaN`, `Infinity`, negatives) to an int >= 0. */
function toCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** Same as {@link toCount} but keeps non-positive values as 0 and clamps high. */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Hex character code -> nibble value, or 0 for anything that is not a hex
 * digit.  `Number.parseInt(ch, 16)` would return `NaN`, and every
 * `NaN & mask === mask` test then fails, which is how the original ended up
 * treating garbage as "piece not completed".
 */
function nibbleOf(charCode: number): number {
  // '0'-'9'
  if (charCode >= 0x30 && charCode <= 0x39) return charCode - 0x30;
  // 'a'-'f' / 'A'-'F' — fold the case with a single OR.
  const lowered = charCode | 0x20;
  if (lowered >= 0x61 && lowered <= 0x66) return lowered - 0x61 + 10;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

/**
 * Stream the bits of `bitfield` to `visit`, in piece order, stopping at
 * `pieceCount`.
 *
 * This is THE primitive that owns the MSB-first nibble layout described at
 * the top of this file; every other helper is built on it so the ordering can
 * only ever be defined once.
 *
 * `visit` is never called when `pieceCount <= 0`, and is called exactly
 * `pieceCount` times otherwise (padding short bitfields with `false`).
 */
export function forEachPieceBit(
  bitfield: string,
  pieceCount: number,
  visit: (index: number, isCompleted: boolean) => void,
): void {
  const total = toCount(pieceCount);
  if (total === 0) return;

  const field = typeof bitfield === 'string' ? bitfield : '';
  if (field.length === 0) {
    // Short-circuit: aria2 omits the bitfield for non-BT tasks, and a BT task
    // before the metadata arrives reports ''. Every piece is "not completed".
    for (let index = 0; index < total; index++) visit(index, false);
    return;
  }

  let index = 0;
  for (let charIndex = 0; charIndex < field.length && index < total; charIndex++) {
    const nibble = nibbleOf(field.charCodeAt(charIndex));
    // 3 -> 0 : most significant bit of the nibble is the first piece.
    for (let shift = 3; shift >= 0 && index < total; shift--) {
      visit(index, ((nibble >> shift) & 1) === 1);
      index++;
    }
  }
  // Bitfield shorter than the piece count: the remaining pieces stay missing.
  for (; index < total; index++) visit(index, false);
}

/**
 * Expand a hex bitfield into one boolean per piece — port of AriaNg
 * `getPieceStatus`.
 *
 * The result always has exactly `pieceCount` entries (never shorter, never
 * longer), which the piece map relies on for stable indexing.
 */
export function getPieceStatus(bitfield: string, pieceCount: number): boolean[] {
  const total = toCount(pieceCount);
  const pieces: boolean[] = new Array<boolean>(total);
  if (total === 0) return pieces;
  forEachPieceBit(bitfield, total, (index, isCompleted) => {
    pieces[index] = isCompleted;
  });
  return pieces;
}

/**
 * Run-length encode the piece status — port of AriaNg `getCombinedPieces`.
 *
 * The canvas piece bar draws `count / pieceCount * width` pixels per run, so
 * an alternating bitfield collapses from 100k booleans into a few thousand
 * runs instead of a few thousand `fillRect` calls.
 *
 * An empty/zero-length piece map yields `[]` (no runs at all).
 */
export function getCombinedPieces(bitfield: string, pieceCount: number): PieceRun[] {
  const runs: PieceRun[] = [];
  forEachPieceBit(bitfield, pieceCount, (_index, isCompleted) => {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.isCompleted === isCompleted) {
      last.count += 1;
    } else {
      runs.push({ isCompleted, count: 1 });
    }
  });
  return runs;
}

/** Number of completed pieces — `aria2NgCommonService.countArray(status, true)`. */
export function completedPiecesOf(bitfield: string, pieceCount: number): number {
  let completed = 0;
  forEachPieceBit(bitfield, pieceCount, (_index, isCompleted) => {
    if (isCompleted) completed++;
  });
  return completed;
}

/* ------------------------------------------------------------------ */
/* Piece geometry                                                      */
/* ------------------------------------------------------------------ */

/**
 * aria2 divides the payload into `numPieces` pieces of `pieceLength` bytes
 * (`ceil`), the last one being the short remainder:
 *
 *     numPieces   = ceil(totalLength / pieceLength)
 *     pieceLength = ceil(totalLength / numPieces)
 *
 * Both are 0 when the divisor is unknown; the caller is expected to treat that
 * as "no piece map".
 */
export function computeNumPieces(totalLength: number, pieceLength: number): number {
  const total = toCount(totalLength);
  const piece = toCount(pieceLength);
  if (piece === 0) return 0;
  return Math.ceil(total / piece);
}

/**
 * Inverse of {@link computeNumPieces}. Note the round trip is only exact when
 * the requested count is close to `totalLength / pieceLength`: recomputing
 * `computeNumPieces(total, computePieceLength(total, n))` yields a value
 * `<= n` (a very fine piece count collapses onto the coarse one that actually
 * tiles the file), which is exactly aria2's own behaviour.
 */
export function computePieceLength(totalLength: number, numPieces: number): number {
  const total = toCount(totalLength);
  const pieces = toCount(numPieces);
  if (pieces === 0) return 0;
  return Math.ceil(total / pieces);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** AriaNg's `showPiecesInfoInTaskDetailPage` default (`ariaNg.defaultOptions`). */
export const DEFAULT_PIECES_INFO_SETTING: PiecesInfoSetting = 'le10240';

/** Upper piece count accepted by each `le<N>` setting value. */
export const PIECES_INFO_LIMITS = {
  le1024: 1024,
  le10240: 10240,
  le102400: 102400,
} as const satisfies Partial<Record<PiecesInfoSetting, number>>;

/**
 * Should the "Pieces" tab / piece map be shown for a task with `numPieces`
 * pieces?  Port of `task-detail.isShowPiecesInfo`.
 *
 * `always`/`never` are absolute, the `le<N>` variants compare inclusively
 * (1024 pieces is still visible under `le1024`), and an unrecognised value
 * falls through to "visible" like the original's `return true`.
 */
export function isPiecesInfoVisible(
  numPieces: number,
  setting: PiecesInfoSetting = DEFAULT_PIECES_INFO_SETTING,
): boolean {
  if (setting === 'never') return false;
  if (setting === 'always') return true;
  const limit = PIECES_INFO_LIMITS[setting as keyof typeof PIECES_INFO_LIMITS];
  if (limit === undefined) return true;
  return toCount(numPieces) <= limit;
}

/* ------------------------------------------------------------------ */
/* Rendering scale                                                     */
/* ------------------------------------------------------------------ */

/** One piece cell in the piece map — matches AriaNg's `.piece-map .piece`. */
export const PIECE_CELL_SIZE = 10;
/** Gap between two cells (`.piece { margin-right: 1px }`). */
export const PIECE_CELL_GAP = 1;
/** Horizontal advance per cell. */
export const PIECE_CELL_PITCH = PIECE_CELL_SIZE + PIECE_CELL_GAP;
/** `.piece-map` horizontal padding (6px left + 2px right). */
export const PIECE_MAP_PADDING_X = 8;
/** Guard rails so a pathological container width cannot produce silly grids. */
export const MIN_PIECE_GRID_COLUMNS = 1;
export const MAX_PIECE_GRID_COLUMNS = 1024;

/**
 * How many piece cells fit on one row of a `containerWidth`-wide piece map.
 *
 * The cells stay 10x10 px (hence square) — only the wrap column count depends
 * on the container: `floor((width - padding) / 11)`.  For a huge map such as
 * 102400 pieces in a 800 px pane this yields 72 columns / 1423 rows, which is
 * why anything above {@link CANVAS_RENDER_THRESHOLD} should be painted on a
 * canvas instead (see {@link shouldUseCanvas}).
 *
 * Columns are clamped to `[1, min(count, 1024)]` and to `count` itself (no
 * point in empty trailing cells), so a 0-piece map reports `0 x 0`.
 */
export function estimatePieceGridColumns(
  count: number,
  containerWidth: number,
): { columns: number; rows: number } {
  const total = toCount(count);
  if (total === 0) return { columns: 0, rows: 0 };

  const width = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
  const usable = Math.max(0, width - PIECE_MAP_PADDING_X);
  const columns = clamp(
    Math.floor(usable / PIECE_CELL_PITCH),
    MIN_PIECE_GRID_COLUMNS,
    Math.min(MAX_PIECE_GRID_COLUMNS, total),
  );

  return { columns, rows: Math.ceil(total / columns) };
}

/**
 * Above this many pieces a DOM node per piece becomes unusable (React keeps
 * 102k nodes alive for a 102400-piece torrent), so the piece map switches to
 * a single canvas element.
 */
export const CANVAS_RENDER_THRESHOLD = 1024;

/** Would a piece map with `numPieces` pieces be rendered on a canvas? */
export function shouldUseCanvas(numPieces: number, threshold: number = CANVAS_RENDER_THRESHOLD): boolean {
  return toCount(numPieces) > toCount(threshold);
}

/** Convenience wrapper: the render mode implied by {@link shouldUseCanvas}. */
export function pieceRenderMode(
  numPieces: number,
  threshold: number = CANVAS_RENDER_THRESHOLD,
): PieceRenderMode {
  return shouldUseCanvas(numPieces, threshold) ? 'canvas' : 'dom';
}