/**
 * The per-peer piece bar of the Peers tab.
 *
 * Port of AriaNg's `ngPieceBar` directive
 * (`src/scripts/directives/pieceBar.js`): a single-row canvas where every
 * completed piece advances the cursor by `count / pieceCount * width` pixels.
 *
 * ## Deliberate change: the colour
 *
 * AriaNg hard-coded `color="#208fe5"` on every piece bar, which is a 2013-era
 * flat blue that matches neither light nor dark mode nor the user's dynamic
 * scheme. Here the default is the **M3 primary role**
 * (`--mdui-color-primary`), resolved from the element's computed style and
 * repainted on the `themechange` event. A caller can still pass a literal
 * colour (or any CSS colour string) to override it.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { getCombinedPieces } from '@/domain/pieces';
import type { PieceRun } from '@/domain/pieces';
import {
  completedPieceColor,
  missingPieceColor,
  resolveTokenColor,
  themeTokenRoot,
} from './PieceMap';
import { THEME_CHANGE_EVENT } from '@/ui/mdui';

/** AriaNg's hard-coded bar colour, kept as the fallback for unresolvable tokens. */
export const LEGACY_PIECE_BAR_COLOR = '#208fe5';

/** Track colour of the *missing* part when the caller overrides the bar colour. */
const MISSING_BACKGROUND = 'rgb(var(--mdui-color-surface-container-highest))';

export interface PieceBarProps {
  /** Run-length encoded piece map, as carried by `TaskPeer.pieces`. */
  runs?: readonly PieceRun[];
  /** Raw bitfield + piece count, when the caller has no RLE map yet. */
  bitfield?: string;
  pieceCount?: number;
  /**
   * CSS colour for the completed part. `undefined` (the default) resolves the
   * M3 primary role from the element, so it follows dark mode and dynamic
   * colour; the missing part is derived from the same theme automatically.
   */
  color?: string;
  /** Track height in CSS pixels. AriaNg used 14. */
  height?: number;
  /** Accessible name, e.g. `Completed: 12, Total: 40`. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Collapses adjacent runs that share a state.
 *
 * `getCombinedPieces` already merges, but a peer's map can arrive from three
 * different sources (`peer.pieces` clamped to the task's piece count, a raw
 * bitfield, or the local pseudo-peer), and only one of them guarantees merged
 * runs. Merging here makes the draw loop's cost depend on *state changes*, not
 * on where the data came from.
 */
export function mergePieceRuns(runs: readonly PieceRun[]): PieceRun[] {
  const merged: PieceRun[] = [];

  for (const run of runs) {
    if (!Number.isFinite(run.count) || run.count <= 0) continue;

    const last = merged[merged.length - 1];
    if (last && last.isCompleted === run.isCompleted) {
      last.count += run.count;
    } else {
      merged.push({ isCompleted: run.isCompleted, count: Math.floor(run.count) });
    }
  }

  return merged;
}

/**
 * A single-row canvas bar showing which pieces a peer holds.
 *
 * The background (missing pieces) is painted first, then one `fillRect` per
 * completed run — the same `pieceWidth = count / pieceCount * width` arithmetic
 * AriaNg used.
 */
export function PieceBar({
  runs,
  bitfield,
  pieceCount,
  color,
  height = 14,
  label,
  className,
  style,
}: PieceBarProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  // Re-resolved on every `themechange`, which is what makes the bar follow dark
  // mode and the dynamic scheme. A fresh string identity re-runs the paint.
  const [tokenColor, setTokenColor] = useState<string>(() => completedPieceColor(themeTokenRoot()));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const refresh = (): void => setTokenColor(completedPieceColor(themeTokenRoot()));
    window.addEventListener(THEME_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, refresh);
  }, []);

  useLayoutEffect(() => {
    const node = hostRef.current;
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
  }, []);

  const merged = useMemo(
    () =>
      runs && runs.length > 0
        ? mergePieceRuns(runs)
        : typeof bitfield === 'string'
          ? mergePieceRuns(getCombinedPieces(bitfield, pieceCount ?? 0))
          : [],
    [runs, bitfield, pieceCount],
  );

  const total = useMemo(() => merged.reduce((sum, run) => sum + run.count, 0), [merged]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!context) return;

    const cssWidth = Math.max(width, 1);
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, height);

    context.fillStyle = color ?? tokenColor ?? LEGACY_PIECE_BAR_COLOR;
    context.fillRect(0, 0, cssWidth, height);

    // The missing pieces are the *unfilled* remainder, so repaint them on top.
    context.fillStyle = color ? MISSING_BACKGROUND : missingPieceColor(themeTokenRoot());

    let positionX = 0;
    for (const run of merged) {
      const pieceWidth = total > 0 ? (run.count / total) * cssWidth : 0;
      if (!run.isCompleted) {
        context.fillRect(positionX, 0, pieceWidth, height);
      }
      positionX += pieceWidth;
    }
  }, [merged, total, width, height, color, tokenColor]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={hostRef}
      className={className ? `ariang-piece-bar-wrapper ${className}` : 'ariang-piece-bar-wrapper'}
      style={style}
      role="img"
      aria-label={label}
    >
      <canvas className="ariang-piece-bar-canvas" data-piece-count={total} />
    </div>
  );
}

/**
 * Resolves the bar colour without painting — exported for the peer row, which
 * wants the same token for its percentage text.
 */
export function pieceBarColor(element: Element | null, override?: string): string {
  return override ?? resolveTokenColor(element, '--mdui-color-primary', LEGACY_PIECE_BAR_COLOR);
}

export default PieceBar;