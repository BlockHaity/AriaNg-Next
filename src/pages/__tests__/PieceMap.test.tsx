/**
 * Piece map: the DOM / canvas switch, the legend, and the redraw triggers.
 *
 * The canvas renderer is the interesting half: it has to redraw when the
 * bitfield changes, when the container is resized and when the theme flips,
 * because all three invalidate the token-derived colours or the grid geometry.
 * jsdom has no 2d context, so `getContext` is stubbed with a recording fake —
 * which is also what makes "did it repaint?" assertable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { CANVAS_RENDER_THRESHOLD } from '@/domain/pieces';
import { THEME_CHANGE_EVENT } from '@/ui/mdui';
import { bitfieldFromRuns, PieceMap } from '@/pages/task-detail/PieceMap';
import { PiecesTab } from '@/pages/task-detail/tabs/PiecesTab';
import type { NormalizedTask } from '@/domain/types';

/* ------------------------------------------------------------------ */
/* canvas fake                                                        */
/* ------------------------------------------------------------------ */

interface FakeContext {
  fillStyle: unknown;
  fillRect: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
}

/** Every 2d context handed out during the current test. */
let contexts: FakeContext[] = [];

function installCanvasFake(): void {
  contexts = [];

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: function fakeGetContext(this: HTMLCanvasElement) {
      const context: FakeContext = {
        fillStyle: '',
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        setTransform: vi.fn(),
      };
      contexts.push(context);
      // Returning a new context per call mirrors a real element closely enough
      // for the paint assertions.
      return context as unknown as CanvasRenderingContext2D;
    },
  });
}

/** Number of `fillRect` calls across every context created so far. */
function fillRectCount(): number {
  return contexts.reduce((sum, context) => sum + context.fillRect.mock.calls.length, 0);
}

/* ------------------------------------------------------------------ */
/* measurable layout                                                  */
/* ------------------------------------------------------------------ */

/**
 * jsdom reports `clientWidth === 0` and ships a no-op `ResizeObserver`, which
 * makes "does it repaint when the container changes?" untestable. Both are
 * replaced here with controllable stand-ins.
 */
let containerWidth = 0;
let resizeCallbacks: ResizeObserverCallback[] = [];

const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  installCanvasFake();

  containerWidth = 0;
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get: () => containerWidth,
  });

  resizeCallbacks = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (originalClientWidth) {
    Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
  }
  globalThis.ResizeObserver = originalResizeObserver;
});

/* ------------------------------------------------------------------ */
/* task fixture                                                        */
/* ------------------------------------------------------------------ */

function makeTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    gid: 'gid-1',
    status: 'active',
    taskName: 'test',
    hasTaskName: true,
    totalLength: 1024,
    completedLength: 512,
    completePercent: 50,
    remainLength: 512,
    remainPercent: 50,
    uploadLength: 0,
    shareRatio: 0,
    uploadSpeed: 0,
    downloadSpeed: 0,
    idle: true,
    connections: 0,
    numSeeders: 0,
    seeder: false,
    dir: '/tmp',
    numPieces: 16,
    completedPieces: 8,
    pieceLength: 64,
    // 0b11110000 = the first 4 of 16 pieces are done.
    bitfield: 'f0',
    remainTime: null,
    verifyIntegrityPending: false,
    errorDescription: '',
    files: [],
    fileTree: [],
    multiDir: false,
    selectedFileCount: 0,
    trackers: [],
    ...overrides,
  } as NormalizedTask;
}

/* ------------------------------------------------------------------ */
/* DOM mode                                                            */
/* ------------------------------------------------------------------ */

describe('PieceMap — DOM mode', () => {
  it('renders one cell per piece below the threshold', () => {
    const { container } = render(<PieceMap bitfield="f0" pieceCount={16} />);

    expect(container.querySelector('canvas')).toBeNull();

    const cells = container.querySelectorAll('.ariang-piece');
    expect(cells).toHaveLength(16);
    // MSB-first: `f` = 1111, `0` = 0000.
    expect(cells[0]?.className).toContain('ariang-piece-completed');
    expect(cells[3]?.className).toContain('ariang-piece-completed');
    expect(cells[4]?.className).not.toContain('ariang-piece-completed');
    expect(cells[15]?.className).not.toContain('ariang-piece-completed');
  });

  it('renders exactly at the threshold (DOM) and one piece above it (canvas)', () => {
    const atThreshold = render(<PieceMap bitfield="" pieceCount={CANVAS_RENDER_THRESHOLD} />);
    expect(atThreshold.container.querySelector('canvas')).toBeNull();
    expect(atThreshold.container.querySelectorAll('.ariang-piece')).toHaveLength(CANVAS_RENDER_THRESHOLD);
    atThreshold.unmount();

    const above = render(<PieceMap bitfield="" pieceCount={CANVAS_RENDER_THRESHOLD + 1} />);
    expect(above.container.querySelectorAll('.ariang-piece')).toHaveLength(0);
    expect(above.container.querySelector('canvas')).not.toBeNull();
  });

  it('updates the cells when the bitfield changes', () => {
    const { container, rerender } = render(<PieceMap bitfield="0" pieceCount={4} />);
    expect(container.querySelectorAll('.ariang-piece-completed')).toHaveLength(0);

    rerender(<PieceMap bitfield="f" pieceCount={4} />);
    expect(container.querySelectorAll('.ariang-piece-completed')).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* canvas mode                                                         */
/* ------------------------------------------------------------------ */

describe('PieceMap — canvas mode', () => {
  it('paints a single canvas above the threshold instead of 100k DOM cells', () => {
    const { container } = render(<PieceMap bitfield="ff" pieceCount={102400} />);

    expect(container.querySelectorAll('.ariang-piece')).toHaveLength(0);

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.dataset.renderMode).toBe('canvas');
    expect(Number(canvas?.dataset.pieceCount)).toBe(102400);
  });

  it('draws one rect per run, not one per piece', () => {
    // `ff…` = a single run of completed pieces; 102400 completed pieces must not
    // become 102400 `fillRect` calls.
    render(<PieceMap bitfield="ffff" pieceCount={102400} />);

    // jsdom reports a zero-width container, so the grid is one column and the
    // single run is split per row — still a handful of calls, never 102400.
    expect(fillRectCount()).toBeGreaterThan(0);
    expect(fillRectCount()).toBeLessThan(2000);
  });

  it('redraws when the bitfield changes', () => {
    const { rerender } = render(<PieceMap bitfield="0" pieceCount={4096} />);
    const before = fillRectCount();

    rerender(<PieceMap bitfield="ffff" pieceCount={4096} />);
    expect(fillRectCount()).toBeGreaterThan(before);
  });

  it('redraws when the theme changes', () => {
    render(<PieceMap bitfield="ffff" pieceCount={4096} />);
    const before = fillRectCount();

    act(() => {
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
    });

    expect(fillRectCount()).toBeGreaterThan(before);
  });

  it('redraws on resize', () => {
    containerWidth = 800;
    render(<PieceMap bitfield="ffff" pieceCount={4096} />);
    const before = fillRectCount();
    expect(resizeCallbacks.length).toBeGreaterThan(0);

    // A narrower container means fewer columns, i.e. a different grid — the
    // geometry (and therefore the painting) has to be recomputed.
    act(() => {
      containerWidth = 400;
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });

    expect(fillRectCount()).toBeGreaterThan(before);
  });
});

/* ------------------------------------------------------------------ */
/* legend                                                              */
/* ------------------------------------------------------------------ */

describe('PiecesTab legend', () => {
  it('shows both swatches with the pieceinfo tooltip', () => {
    const task = makeTask({ numPieces: 16, completedPieces: 8 });
    render(<PiecesTab task={task} />);

    const swatches = screen.getByText('Completed').closest('.ariang-piece-legend-item');
    const other = screen.getByText('Uncompleted').closest('.ariang-piece-legend-item');

    // `format.task.pieceinfo` = "Completed: {{completed}}, Total: {{total}}".
    expect(swatches?.getAttribute('title')).toBe('Completed: 8, Total: 16');
    expect(other?.getAttribute('title')).toBe('Completed: 8, Total: 16');
  });

  it('marks the completed swatch with the piece-completed class', () => {
    render(<PiecesTab task={makeTask()} />);

    const completed = screen.getByText('Completed').closest('.ariang-piece-legend-item');
    const uncompleted = screen.getByText('Uncompleted').closest('.ariang-piece-legend-item');

    expect(completed?.querySelector('.ariang-piece')?.className).toContain('ariang-piece-completed');
    expect(uncompleted?.querySelector('.ariang-piece')?.className).not.toContain('ariang-piece-completed');
  });

  it('switches to the canvas renderer for a large map', () => {
    const { container } = render(<PiecesTab task={makeTask({ numPieces: 20480, completedPieces: 0 })} />);

    expect(container.querySelector('canvas')).not.toBeNull();
    expect(screen.getByText('Completed').closest('.ariang-piece-legend-item')?.getAttribute('title')).toBe(
      'Completed: 0, Total: 20480',
    );
  });
});

/* ------------------------------------------------------------------ */
/* bitfield round-trip                                                 */
/* ------------------------------------------------------------------ */

describe('bitfieldFromRuns', () => {
  it('round-trips the run-length form back into the hex bitfield', () => {
    // 8 completed then 8 missing -> 0b11111111 0b00000000 = 'ff00'.
    expect(bitfieldFromRuns([{ isCompleted: true, count: 8 }, { isCompleted: false, count: 8 }])).toBe('ff00');
    expect(bitfieldFromRuns([{ isCompleted: true, count: 16 }])).toBe('ffff');
    expect(bitfieldFromRuns([{ isCompleted: false, count: 16 }])).toBe('0000');
    expect(bitfieldFromRuns([])).toBe('');
  });

  it('agrees with getCombinedPieces for a partial bitmap', () => {
    const runs = [
      { isCompleted: false, count: 3 },
      { isCompleted: true, count: 7 },
      { isCompleted: false, count: 6 },
    ];
    // 0001 1111 1100 0000
    expect(bitfieldFromRuns(runs)).toBe('1fc0');
  });
});