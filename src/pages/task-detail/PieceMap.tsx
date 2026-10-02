/**
 * The piece bitmap ("piece map") of the Pieces tab.
 *
 * Port of AriaNg's `ngPieceMap` directive
 * (`src/scripts/directives/pieceMap.js`): 10 px squares separated by a 1 px gap
 * (an 11 px pitch), wrapped into as many columns as the container is wide.
 *
 * ## Why there are two renderers
 *
 * AriaNg always built one DOM node per piece. That is fine for the piece counts
 * it was written for, but `showPiecesInfoInTaskDetailPage: 'always'` happily
 * accepts a 100 000-piece torrent, and 100 000 live DOM nodes is unusable in
 * React (every poll re-reconciles them). Above
 * {@link CANVAS_RENDER_THRESHOLD} this component paints a single `<canvas>`
 * instead.
 *
 * The canvas path never iterates per piece: it walks the **run-length encoded**
 * output of `getCombinedPieces`, so a 102 400-piece map is a handful of
 * `fillRect` calls (one per run, split at row boundaries) rather than 102 400.
 *
 * Both paths are driven by the same bit order — `getCombinedPieces` /
 * `getPieceStatus` own that, this file only paints.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import {
  PIECE_CELL_GAP,
  PIECE_CELL_PITCH,
  PIECE_CELL_SIZE,
  estimatePieceGridColumns,
  getCombinedPieces,
  getPieceStatus,
  pieceRenderMode,
} from '@/domain/pieces';
import { CANVAS_RENDER_THRESHOLD } from '@/domain/pieces';
import { THEME_CHANGE_EVENT } from '@/ui/mdui';

/** Re-exported so a caller can compare against the switch-over point. */
export { CANVAS_RENDER_THRESHOLD };

/** MD3 role used for a **completed** piece (AriaNg hard-coded `#4d90fe`). */
export const PIECE_COMPLETED_TOKEN = '--mdui-color-primary';
/** MD3 role used for a **missing** piece (AriaNg's empty `.piece` background). */
export const PIECE_MISSING_TOKEN = '--mdui-color-surface-container-highest';

const FALLBACK_COMPLETED = 'rgb(var(--mdui-color-primary))';
const FALLBACK_MISSING = 'rgb(var(--mdui-color-surface-container-highest))';

/**
 * Resolve an `--mdui-*` custom property to a value `ctx.fillStyle` accepts.
 *
 * Canvas cannot resolve `var()` in a colour string, so the token has to be read
 * from the element's computed style. mdui stores its colours as bare
 * `R G B` triplets (that is why every consumer writes
 * `rgb(var(--mdui-color-primary))`), hence the `rgb(...)` wrapper here.
 *
 * Falls back to the `rgb(var(...))` expression when the token is not resolvable
 * (jsdom, a detached node, a very old engine) — a canvas simply ignores an
 * unparseable `fillStyle` and keeps the previous colour, so a paint degrades
 * instead of crashing.
 */
export function resolveTokenColor(element: Element | null, token: string, fallback: string): string {
  if (!element || typeof getComputedStyle !== 'function') {
    return fallback;
  }

  try {
    const raw = getComputedStyle(element).getPropertyValue(token).trim();
    if (raw === '') return fallback;
    // Already a full colour (`rgb(...)`, `#abc`, `color(...)`)?
    if (raw.startsWith('rgb') || raw.startsWith('#') || raw.startsWith('color') || raw.startsWith('hsl')) {
      return raw;
    }
    return `rgb(${raw})`;
  } catch {
    return fallback;
  }
}

/** CSS paint for a completed piece; shared with {@link PieceBar}. */
export function completedPieceColor(element: Element | null): string {
  return resolveTokenColor(element, PIECE_COMPLETED_TOKEN, FALLBACK_COMPLETED);
}

/** CSS paint for a missing piece. */
export function missingPieceColor(element: Element | null): string {
  return resolveTokenColor(element, PIECE_MISSING_TOKEN, FALLBACK_MISSING);
}

export interface PieceMapProps {
  /** MSB-first hex bitfield, exactly as aria2 reports it. */
  bitfield: string;
  pieceCount: number;
  /** Accessible description; the legend already spells out the counts. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Splits a run-length encoded piece map into per-row rectangles.
 *
 * A run can straddle a row boundary, so it is emitted once per row it touches.
 * `emit(absoluteX, y, width, isCompleted)` receives **CSS pixel** coordinates.
 */
function forEachRunRow(
  runs: readonly { isCompleted: boolean; count: number }[],
  columns: number,
  emit: (x: number, y: number, width: number, isCompleted: boolean) => void,
): void {
  if (columns <= 0) return;

  let index = 0;

  for (const run of runs) {
    let remaining = run.count;

    while (remaining > 0) {
      const column = index % columns;
      const inRow = Math.min(remaining, columns - column);

      emit(
        column * PIECE_CELL_PITCH,
        Math.floor(index / columns) * PIECE_CELL_PITCH,
        // The trailing 1 px of a row is the gap, not a cell.
        inRow * PIECE_CELL_PITCH - PIECE_CELL_GAP,
        run.isCompleted,
      );

      index += inRow;
      remaining -= inRow;
    }
  }
}

/**
 * The inverse of {@link getCombinedPieces}: rebuild the MSB-first hex bitfield
 * a run-length encoded map came from.
 *
 * `domain/health`'s `estimateHealthPercentFromPeers` works on hex bitfields,
 * while `normalizePeers` stores the RLE form, so the health estimate has to
 * convert back. Round-tripping through the hex string keeps the bit-order
 * knowledge inside this one module.
 */
export function bitfieldFromRuns(runs: readonly { isCompleted: boolean; count: number }[]): string {
  if (!runs || runs.length === 0) return '';

  const nibbles: number[] = [];
  let nibble = 0;
  let filled = 0;

  for (const run of runs) {
    let remaining = Number.isFinite(run.count) ? Math.max(0, Math.floor(run.count)) : 0;

    while (remaining > 0) {
      // MSB first, matching `forEachPieceBit`.
      if (run.isCompleted) nibble |= 1 << (3 - filled);
      filled += 1;
      remaining -= 1;

      if (filled === 4) {
        nibbles.push(nibble);
        nibble = 0;
        filled = 0;
      }
    }
  }

  if (filled > 0) {
    nibbles.push(nibble);
  }

  return nibbles.map((value) => value.toString(16)).join('');
}

/**
 * Increments whenever mdui's resolved theme changes, so a canvas repaints its
 * token-derived colours when the user flips light/dark or the OS scheme changes.
 *
 * Listens on the window `themechange` event rather than the settings store: the
 * event is emitted by `notifyThemeChange()` for *every* source (explicit
 * toggle, profile change, OS-driven flip while the setting is `system`), which
 * is exactly the set of changes a canvas cannot observe on its own.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onThemeChange = (): void => setVersion((current) => current + 1);
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);

  return version;
}

/** Tracks an element's content-box width through a `ResizeObserver`. */
export function useElementWidth(element: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;

    const measure = (): void => {
      const next = node.clientWidth || node.getBoundingClientRect().width || 0;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      if (typeof window === 'undefined') return;
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);

  return width;
}

/**
 * `devicePixelRatio`-aware canvas sizing.
 *
 * Returns the context plus the CSS size that was applied, so the caller can draw
 * in CSS pixels (`ctx.scale(dpr, dpr)` is applied for it).
 */
function prepareCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): CanvasRenderingContext2D | null {
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!context) return null;

  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
  const targetHeight = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  // Draw in CSS pixels; `setTransform` also resets any leftover transform.
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  return context;
}

/**
 * The piece map.
 *
 * Renders one `<span class="ariang-piece">` per piece below
 * {@link CANVAS_RENDER_THRESHOLD} pieces and a single `<canvas>` above it.
 *
 * The two renderers are separate components on purpose: hooks must not be
 * called conditionally, and switching renderer should start from a clean
 * element rather than reuse the other's.
 */
export function PieceMap({ bitfield, pieceCount, label, className, style }: PieceMapProps) {
  const rootClass = className ? `ariang-piece-map ${className}` : 'ariang-piece-map';

  return pieceRenderMode(pieceCount, CANVAS_RENDER_THRESHOLD) === 'canvas' ? (
    <CanvasPieceMap bitfield={bitfield} pieceCount={pieceCount} label={label} className={rootClass} style={style} />
  ) : (
    <DomPieceMap bitfield={bitfield} pieceCount={pieceCount} label={label} className={rootClass} style={style} />
  );
}

/** One DOM node per piece — the faithful AriaNg renderer, for small maps. */
function DomPieceMap({
  bitfield,
  pieceCount,
  label,
  className,
  style,
}: {
  bitfield: string;
  pieceCount: number;
  label?: string;
  className: string;
  style?: CSSProperties;
}) {
  const pieces = useMemo(() => getPieceStatus(bitfield, pieceCount), [bitfield, pieceCount]);

  return (
    <div className={className} style={style} role="img" aria-label={label}>
      {pieces.map((isCompleted, index) => (
        <span
          key={index}
          className={isCompleted ? 'ariang-piece ariang-piece-completed' : 'ariang-piece'}
          data-piece={index}
          data-completed={isCompleted ? 'true' : 'false'}
        />
      ))}
    </div>
  );
}

/** Canvas renderer — see the module comment for why it exists. */
function CanvasPieceMap({
  bitfield,
  pieceCount,
  label,
  className,
  style,
}: {
  bitfield: string;
  pieceCount: number;
  label?: string;
  className: string;
  style?: CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(hostRef);
  // Reading the version is what makes the effect below re-run on a theme flip.
  const themeVersion = useThemeVersion();

  const runs = useMemo(() => getCombinedPieces(bitfield, pieceCount), [bitfield, pieceCount]);
  const columns = useMemo(
    () => estimatePieceGridColumns(pieceCount, width).columns,
    [pieceCount, width],
  );
  const rows = columns > 0 ? Math.ceil(pieceCount / columns) : 0;
  const cssHeight = rows > 0 ? rows * PIECE_CELL_PITCH - PIECE_CELL_GAP : 0;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const context = prepareCanvas(canvas, Math.max(width, PIECE_CELL_PITCH), Math.max(cssHeight, PIECE_CELL_SIZE));
    if (!context) return;

    // AriaNg painted only the completed pieces over the (already styled)
    // background; painting both explicitly keeps the canvas identical to the
    // DOM variant regardless of the surrounding theme.
    context.fillStyle = missingPieceColor(host);
    context.fillRect(0, 0, Math.max(width, PIECE_CELL_PITCH), Math.max(cssHeight, PIECE_CELL_SIZE));

    context.fillStyle = completedPieceColor(host);
    forEachRunRow(runs, Math.max(columns, 1), (x, y, runWidth, isCompleted) => {
      if (isCompleted && runWidth > 0) {
        context.fillRect(x, y, runWidth, PIECE_CELL_SIZE);
      }
    });
  }, [runs, columns, width, cssHeight]);

  useEffect(() => {
    draw();
  }, [draw, themeVersion]);

  return (
    <div ref={hostRef} className={className} style={style} role="img" aria-label={label}>
      <canvas
        ref={canvasRef}
        className="ariang-piece-canvas"
        style={{ width: '100%', height: `${cssHeight}px` }}
        data-render-mode="canvas"
        data-piece-count={pieceCount}
        data-completed-runs={runs.filter((run) => run.isCompleted).length}
      />
    </div>
  );
}

export default PieceMap;