/**
 * Drag reordering for the task list — a port of AriaNg's `dragula` setup in
 * `controllers/list.js`.
 *
 * AriaNg handed dragula two pieces of information: the `task-list` model and a
 * `moves()` predicate that re-evaluated `isSupportDragTask()` on every pointer
 * move. `dragula` was replaced by `@dnd-kit/core` + `@dnd-kit/sortable` here,
 * but the **predicate's rule is preserved verbatim** and, more importantly, it is
 * extracted into pure functions so it can be unit tested without a DOM.
 *
 * ## Why dragging is so restricted
 *
 * `isSupportDragTask()` (list.js:81-89) returns true only when
 *
 *   1. `dragAndDropTasks` is enabled in the settings, **and**
 *   2. the page is `/waiting`, **and**
 *   3. the current display-order *type* is `default`.
 *
 * Rule 3 is not cosmetic: `aria2.changePosition` addresses a slot in the
 * server-side waiting queue, so a server-ordered list is the only view where
 * "the third visible row" and "position 2 in the queue" are the same thing.
 * Any sorting would make the drag write a meaningless index.
 *
 * AriaNg ignored the search filter and happily wrote the *visible* index into
 * `changePosition`, which corrupted the queue whenever a filter was active. That
 * is what {@link dropIndexFromVisibleOrder} fixes.
 */

import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { Announcements, SensorDescriptor, SensorOptions } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

import { TaskListKind } from '@/config/rpc-constants';
import { changeTaskPosition } from '@/store/commands';
import { scheduler } from '@/store/scheduler';

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/** `<SortableContext>` id. Stable so the sensor registry can find it again. */
export const TASK_LIST_SORTABLE_ID = 'task-list';

/**
 * The scheduler job id the page's 1 s poll registers under.
 *
 * It is paused for the duration of a drop so the in-flight poll cannot restore
 * the server order underneath the user mid-drop (AriaNg's
 * `pauseDownloadTaskRefresh`).
 */
export const TASK_LIST_REFRESH_JOB_ID = 'task-list';

/** Distances below this are a click, not the start of a drag (a touch drag would eat row clicks). */
const POINTER_ACTIVATION_DISTANCE = 6;

/* ------------------------------------------------------------------ */
/* display-order parsing                                               */
/* ------------------------------------------------------------------ */

/** The head of a `<type>:<direction>` display order. */
export type DisplayOrderTypeName = 'default' | 'name' | 'size' | 'percent' | 'remain' | 'dspeed' | 'uspeed';

/** AriaNg's `ariaNgCommonService.parseOrderType`. */
export function parseOrderType(order: string): { type: DisplayOrderTypeName; descending: boolean } {
  const raw = (order ?? '').trim();
  const separator = raw.lastIndexOf(':');
  const head = separator >= 0 ? raw.slice(0, separator) : raw;
  const tail = separator >= 0 ? raw.slice(separator + 1) : 'asc';
  const known: readonly string[] = [
    'default',
    'name',
    'size',
    'percent',
    'remain',
    'dspeed',
    'uspeed',
  ];

  return {
    type: (known.includes(head) ? head : 'default') as DisplayOrderTypeName,
    descending: tail === 'desc',
  };
}

/* ------------------------------------------------------------------ */
/* the drag predicate                                                  */
/* ------------------------------------------------------------------ */

export interface DragSupportOptions {
  /** `settings.dragAndDropTasks`. */
  enabledBySetting: boolean;
  page: TaskListKind;
  /** The page's resolved display order, e.g. `'default:asc'`. */
  orderType: string;
}

/**
 * AriaNg's `isSupportDragTask()`, verbatim: `dragAndDropTasks` **AND**
 * `/waiting` **AND** the `default` order type.
 *
 * Anything else disables dragging *entirely* — not just for the rows it would
 * corrupt. A partially enabled drag is worse than none: the user gets a handle
 * that silently writes the wrong index.
 */
export function isDragSupported(options: DragSupportOptions): boolean {
  if (!options.enabledBySetting) {
    return false;
  }
  if (options.page !== TaskListKind.Waiting) {
    return false;
  }
  return parseOrderType(options.orderType).type === 'default';
}

/* ------------------------------------------------------------------ */
/* pure list arithmetic                                                */
/* ------------------------------------------------------------------ */

/**
 * Moves `activeGid` to `overGid`'s slot.
 *
 * AriaNg let dragula mutate the array in place; here the array is rebuilt, which
 * is what keeps the `NormalizedTask[]` identity rules intact. Dropping onto the
 * element that is already being dragged, or onto an unknown gid, is a no-op.
 */
export function reorderGids(gids: readonly string[], activeGid: string, overGid: string): string[] {
  const from = gids.indexOf(activeGid);
  const to = gids.indexOf(overGid);

  if (from < 0 || to < 0 || from === to) {
    return [...gids];
  }

  const next = [...gids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as string);
  return next;
}

export interface DropIndexOptions {
  /** Every gid the server reports for this list, in **server** order. */
  gids: readonly string[];
  /** The rendered rows (search filter applied), in the same relative order. */
  visibleGids: readonly string[];
  activeGid: string;
  /** Index in {@link DropIndexOptions.visibleGids} the row was dropped on. */
  overIndex: number;
}

/**
 * Translates a drop position in the **visible** list into a `changePosition`
 * index in the **server** queue.
 *
 * ## The problem
 *
 * `aria2.changePosition(gid, pos, 'POS_SET')` is 0-based over the whole waiting
 * queue, but the user dropped onto row *n* of the rendered list. AriaNg passed
 * *n* straight through, which is only correct when no row is filtered out.
 *
 * ## The rule
 *
 * The dragged task takes over the target's slot in the queue. Concretely, with
 * the dragged task removed (`rest`), the answer is `rest.indexOf(target)` —
 * shifted by one when the dragged task used to sit *before* the target, because
 * removing it moved everything after it one slot to the left.
 *
 * Worked example (search hides `C`):
 *
 * ```
 * server   [A, B, C, D]      drag B onto D (visible index 2)
 * rest     [A, C, D]         indexOf(D) = 2, B was before D -> +1
 * result   3                 changePosition(B, 3) -> [A, C, D, B]
 * visible  [A, D, B]         which is reorderGids([A, B, D], B, D) ✓
 * ```
 *
 * Dropping past the last visible row appends to the end of the queue.
 */
export function dropIndexFromVisibleOrder(options: DropIndexOptions): number {
  const { gids, visibleGids, activeGid, overIndex } = options;
  const rest = gids.filter((gid) => gid !== activeGid);

  if (rest.length === 0) {
    return 0;
  }

  const target = visibleGids[overIndex];
  if (target === undefined) {
    // Dropped into the trailing padding: append at the end of the queue.
    return rest.length;
  }

  const targetAt = gids.indexOf(target);
  if (targetAt < 0) {
    // Defensive: a visible gid that the server did not report. Fall back to the
    // number of rows above the drop point, clamped into range.
    return clamp(overIndex, 0, rest.length);
  }

  const slot = rest.indexOf(target);
  const activeAt = gids.indexOf(activeGid);
  const shift = activeAt >= 0 && targetAt > activeAt ? 1 : 0;

  return clamp(slot + shift, 0, rest.length);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/* ------------------------------------------------------------------ */
/* sensors                                                             */
/* ------------------------------------------------------------------ */

/**
 * A pointer + keyboard sensor pair.
 *
 * The keyboard sensor is **not optional**: MD3 requires every reorderable list to
 * be operable from the keyboard, and dragula gave AriaNg no such affordance at
 * all. `sortableKeyboardCoordinates` makes <kbd>Space</kbd> pick a row up and
 * the arrow keys move it, with <kbd>Esc</kbd> cancelling.
 */
export function useTaskListSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/* ------------------------------------------------------------------ */
/* screen reader announcements                                         */
/* ------------------------------------------------------------------ */

export interface AnnouncementContext {
  /** gid -> task name, so the announcement names the row, not its index. */
  nameOf: (gid: string) => string;
  /** The row currently under the pointer / keyboard cursor. */
  indexOf: (gid: string) => number;
  total: () => number;
}

/**
 * The `aria-live` copy dnd-kit publishes while a row is being dragged.
 *
 * dnd-kit's defaults say "draggable item N" / "droppable area N", which is
 * meaningless in a task list. These name the task and report the new position.
 */
export function createAnnouncements(context: AnnouncementContext): Announcements {
  const describe = (gid: string | number | undefined): string => {
    if (gid === undefined) {
      return '';
    }
    const key = String(gid);
    return context.nameOf(key) || `#${context.indexOf(key) + 1}`;
  };

  return {
    onDragStart: ({ active }) => `Picked up ${describe(active.id)}.`,
    onDragOver: ({ over }) => (over ? `Moved over ${describe(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => {
      if (!over) {
        return `Dropped ${describe(active.id)}.`;
      }
      const position = context.indexOf(String(over.id)) + 1;
      return `Dropped ${describe(active.id)} at position ${position} of ${context.total()}.`;
    },
    onDragCancel: ({ active }) => `Put ${describe(active.id)} back.`,
  };
}

/** The `screenReaderInstructions` hint announced when the list first gains a drag handle. */
export const TASK_LIST_SCREEN_READER_INSTRUCTIONS = {
  draggable:
    'Press Space or Enter to pick up a task, use the arrow keys to move it, Space or Enter again to drop it, and Escape to cancel.',
};

/* ------------------------------------------------------------------ */
/* applying a move                                                    */
/* ------------------------------------------------------------------ */

export interface ApplyTaskMoveOptions {
  gid: string;
  /** Server index, as computed by {@link dropIndexFromVisibleOrder}. */
  index: number;
  /** Called once the position was written, to pull the new order in. */
  refresh?: () => void | Promise<void>;
}

/**
 * Writes a reorder to aria2 with the poll paused around it.
 *
 * AriaNg's `pauseDownloadTaskRefresh = true` / `false` pair around
 * `changeTaskPosition`; the scheduler's `pause` / `resume` is the same latch, and
 * it is released in a `finally` so a failed RPC cannot leave the list frozen.
 */
export async function applyTaskMove(options: ApplyTaskMoveOptions): Promise<void> {
  const { gid, index, refresh } = options;

  scheduler.pause(TASK_LIST_REFRESH_JOB_ID);
  try {
    await changeTaskPosition(gid, index);
  } finally {
    scheduler.resume(TASK_LIST_REFRESH_JOB_ID);
    await refresh?.();
  }
}