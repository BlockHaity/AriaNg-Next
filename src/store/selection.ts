/**
 * Task selection — a port of AriaNg's `root.js` `taskContext.selected` helpers
 * (`getSelectedTaskList`, `isAllTaskSelected`, `isTaskSelected`, …).
 *
 * The store deliberately keeps *only* a `gid -> boolean` map and reads the task
 * list from {@link useTasksStore} on demand: duplicating the list here would
 * mean two sources of truth for the same rows, and the list is replaced on
 * every 1s tick.
 */

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import { isTaskRetryable } from '@/domain/normalize';
import type { NormalizedTask } from '@/domain/types';
import { Aria2TaskStatus } from '@/config/rpc-constants';
import { useTasksStore } from './tasks';

export interface SelectionState {
  /** gid -> selected. A `Record` (not a `Set`) so it stays serialisable. */
  selected: Record<string, boolean>;
  /**
   * AriaNg's `enableSelectAll`: selection is only offered while the list has
   * rows to select. Recomputed from the task list, never set by hand.
   */
  enabled: boolean;

  /** The filtered list from the tasks store (search text applied). */
  visible(): NormalizedTask[];
  isSelected(gid: string): boolean;
  toggle(gid: string): void;
  /** Toggles every task of the *filtered* list. */
  selectAll(): void;
  /** Toggles the retryable tasks (AriaNg's `isTaskRetryable`). */
  selectFailed(): void;
  /** Toggles the completed tasks. */
  selectCompleted(): void;
  clear(): void;
  selectedTasks(): NormalizedTask[];
  hasRetryable(): boolean;
  hasCompleted(): boolean;
  isAllSelected(): boolean;
}

function areAllSelected(tasks: readonly NormalizedTask[], selected: Record<string, boolean>): boolean {
  if (tasks.length === 0) {
    return false;
  }
  return tasks.every((task) => selected[task.gid] === true);
}

/**
 * AriaNg's three bulk buttons are *toggles*: pressing "Select all failed
 * tasks" twice clears the selection again. Returns the gids that should end up
 * selected.
 */
function resolveToggle(
  candidates: readonly NormalizedTask[],
  selected: Record<string, boolean>,
): { next: Record<string, boolean>; select: boolean } {
  const select = !areAllSelected(candidates, selected);
  const next: Record<string, boolean> = { ...selected };

  for (const task of candidates) {
    if (select) {
      next[task.gid] = true;
    } else {
      delete next[task.gid];
    }
  }

  return { next, select };
}

export const useSelectionStore: UseBoundStore<StoreApi<SelectionState>> = create<SelectionState>()(
  (set, get) => ({
    selected: {},
    enabled: false,

    visible(): NormalizedTask[] {
      return useTasksStore.getState().filtered();
    },

    isSelected(gid: string): boolean {
      return get().selected[gid] === true;
    },

    toggle(gid: string): void {
      set((state) => {
        const next = { ...state.selected };
        if (next[gid]) {
          delete next[gid];
        } else {
          next[gid] = true;
        }
        return { selected: next };
      });
    },

    selectAll(): void {
      set((state) => ({ selected: resolveToggle(get().visible(), state.selected).next }));
    },

    selectFailed(): void {
      const candidates = get().visible().filter((task) => isTaskRetryable(task));
      set((state) => ({ selected: resolveToggle(candidates, state.selected).next }));
    },

    selectCompleted(): void {
      const candidates = get()
        .visible()
        .filter((task) => task.status === Aria2TaskStatus.Complete);
      set((state) => ({ selected: resolveToggle(candidates, state.selected).next }));
    },

    clear(): void {
      set({ selected: {} });
    },

    selectedTasks(): NormalizedTask[] {
      const { selected } = get();
      return get().visible().filter((task) => selected[task.gid] === true);
    },

    hasRetryable(): boolean {
      return get().visible().some((task) => isTaskRetryable(task));
    },

    hasCompleted(): boolean {
      return get().visible().some((task) => task.status === Aria2TaskStatus.Complete);
    },

    isAllSelected(): boolean {
      return areAllSelected(get().visible(), get().selected);
    },
  }),
);

/**
 * `enabled` mirrors AriaNg: the bulk-selection controls only exist while the
 * list has rows. Wiring it to the store keeps it honest without every mutator
 * having to remember to update it.
 */
useSelectionStore.subscribe((state) => {
  const enabled = useTasksStore.getState().filtered().length > 0;
  if (state.enabled !== enabled) {
    useSelectionStore.setState({ enabled });
  }
});
