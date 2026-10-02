/**
 * The per-page toolbar **and** the action layer the whole task list shares.
 *
 * The action layer lives here (rather than in the page) because three callers
 * need the identical behaviour and the identical post-action navigation:
 * this toolbar, the right-click menu, and the two global shortcuts
 * (`selectAll` / `delete`) the shell dispatches through `ui.keyActions`.
 *
 * ## The navigation rules (AriaNg's, 1:1)
 *
 * | action              | where it goes                    |
 * |---------------------|----------------------------------|
 * | delete              | `/stopped` — **always**, whichever page you were on |
 * | start               | `/downloading`, but only when you started from `/waiting` |
 * | pause               | `/waiting`, only when you paused from `/downloading` |
 * | clear stopped       | `/stopped`                       |
 * | retry               | per `settings.afterRetryingTask` |
 *
 * In every other case AriaNg called `$route.reload()` — i.e. "stay here, refetch".
 * `refresh(true)` is that same intent without throwing the React tree away.
 */

import { useCallback, useMemo } from 'react';

import type { NormalizedTask } from '@/domain/types';
import { isTaskRetryable } from '@/domain/normalize';
import { Aria2TaskStatus, TaskListKind, isTerminalStatus } from '@/config/rpc-constants';
import type { AfterRetryingTask } from '@/config/types';
import { useTranslate } from '@/i18n/react';
import { alertDialog, confirmDialog } from '@/ui/mdui/dialogs';
import { MduiButton, MduiChip, MduiIcon, MduiMenu, MduiMenuItem } from '@/ui/mdui';
import { useSelectionStore } from '@/store/selection';
import { useSettingsStore } from '@/store/settings';
import { useTasksStore } from '@/store/tasks';
import {
  changeTasksState,
  clearStoppedTasks,
  removeTasks,
  retryTask,
  retryTasks,
} from '@/store/commands';
import { Routes, appUrl } from '@/app/route-paths';
import { isFileSelectionPending, navigateToTaskDetail } from './TaskRow';
import type { DisplayOrderTypeName } from './dnd';
import { parseOrderType } from './dnd';

/* ------------------------------------------------------------------ */
/* navigation                                                          */
/* ------------------------------------------------------------------ */

/** In-app navigation without a router dependency (see `navigateToTaskDetail`). */
export function navigateTo(path: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.location.hash = appUrl(path);
}

/* ------------------------------------------------------------------ */
/* the seven display-order entries                                     */
/* ------------------------------------------------------------------ */

/**
 * AriaNg's Display Order menu, in order, with the value each entry writes.
 *
 * Note the *asymmetric* defaults: name / size / remaining sort ascending,
 * progress and download speed sort descending — sorting downloads by ascending
 * speed puts the idle ones first, which is never what the button means.
 */
export const DISPLAY_ORDER_ENTRIES: ReadonlyArray<{ type: DisplayOrderTypeName; label: string; value: string }> = [
  { type: 'default', label: 'Default', value: 'default:asc' },
  { type: 'name', label: 'By File Name', value: 'name:asc' },
  { type: 'size', label: 'By File Size', value: 'size:asc' },
  { type: 'percent', label: 'By Progress', value: 'percent:desc' },
  { type: 'remain', label: 'By Remaining', value: 'remain:asc' },
  { type: 'dspeed', label: 'By Download Speed', value: 'dspeed:desc' },
  { type: 'uspeed', label: 'By Upload Speed', value: 'uspeed:desc' },
];

/** `true` when the page's display order has this *type* (direction ignored). */
export function isOrderTypeActive(order: string, type: string): boolean {
  return parseOrderType(order).type === type;
}

/* ------------------------------------------------------------------ */
/* selection predicates                                                */
/* ------------------------------------------------------------------ */

/**
 * Tasks that `aria2.unpause` will actually accept.
 *
 * aria2-next rejects `unpause` while `bittorrent.fileSelectionState` is
 * `awaiting`: the torrent has no file selection yet, so there is nothing to
 * start. Those tasks are filtered out instead of being sent and failing.
 */
export function startableTasks(tasks: readonly NormalizedTask[]): NormalizedTask[] {
  return tasks.filter((task) => task.status === Aria2TaskStatus.Paused && !isFileSelectionPending(task));
}

/** `true` when at least one selected task can be started. */
export function canStartTasks(tasks: readonly NormalizedTask[]): boolean {
  return startableTasks(tasks).length > 0;
}

/** AriaNg's `isSpecifiedTaskSelected('active', 'waiting')`. */
export function canPauseTasks(tasks: readonly NormalizedTask[]): boolean {
  return tasks.some((task) => task.status === Aria2TaskStatus.Active || task.status === Aria2TaskStatus.Waiting);
}

/** AriaNg's `isSelectedTaskRetryable()` — *every* selected task must be retryable. */
export function canRetryTasks(tasks: readonly NormalizedTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => isTaskRetryable(task));
}

/** AriaNg's `isTaskSelected()`. */
export function canDeleteTasks(tasks: readonly NormalizedTask[]): boolean {
  return tasks.length > 0;
}

/** AriaNg's `isSpecifiedTaskShowing('complete','error','removed')` over the visible list. */
export function canClearStopped(tasks: readonly NormalizedTask[]): boolean {
  return tasks.length > 0 && tasks.some((task) => isTerminalStatus(task.status));
}

/** Every selected task exposes a single unambiguous download URL. */
export function selectedTasksHaveUrl(tasks: readonly NormalizedTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => !!task.singleUrl);
}

/** Every selected task is a torrent with an info hash. */
export function selectedTasksHaveInfoHash(tasks: readonly NormalizedTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => !!task.bittorrent && !!task.infoHash);
}

/** aria2-next: every selected task is an eDonkey2000 download with its link. */
export function selectedTasksHaveEd2kLink(tasks: readonly NormalizedTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => !!task.ed2k?.ed2kLink);
}

/* ------------------------------------------------------------------ */
/* the action layer                                                    */
/* ------------------------------------------------------------------ */

export interface TaskListActions {
  start(): Promise<void>;
  pause(): Promise<void>;
  remove(): Promise<void>;
  clearStopped(): Promise<void>;
  /** Retries the whole selection (or the single selected task). */
  retry(): Promise<void>;
  /** Retries one row's Retry link. */
  retryOne(task: NormalizedTask): Promise<void>;
  /** `Ctrl/⌘+A`. */
  selectAll(): void;
  selectFailed(): void;
  selectCompleted(): void;
  /** The toolbar / context-menu dropdown calls this with one of the 7 values. */
  setDisplayOrder(value: string): void;
}

export interface TaskListActionsOptions {
  /** Lets the caller inject a refresh (the page owns the poll). */
  refresh?: (options?: { silent?: boolean; force?: boolean }) => Promise<void>;
}

/**
 * Builds the shared action layer for one task-list page.
 *
 * `kind` decides the after-action navigation; everything else is read from the
 * stores at call time so a settings change takes effect without a remount.
 */
export function useTaskListActions(kind: TaskListKind, options: TaskListActionsOptions = {}): TaskListActions {
  const t = useTranslate();
  const settings = useSettingsStore((state) => state.settings);
  const { refresh } = options;

  const refetch = useCallback(
    async (force = true) => {
      await refresh?.({ silent: true, force });
    },
    [refresh],
  );

  const selectedTasks = useCallback(() => useSelectionStore.getState().selectedTasks(), []);

  /* ---- start / pause ---- */

  const start = useCallback(async () => {
    const tasks = selectedTasks();
    if (tasks.length === 0) {
      return;
    }

    const outcome = await changeTasksState(tasks, 'start');
    // AriaNg only navigated on a clean batch, so a half-failed start leaves the
    // user where they are and can see which task refused.
    if (!outcome.hasSuccess || outcome.hasError) {
      return;
    }

    await refetch();
    if (kind === TaskListKind.Waiting) {
      navigateTo(Routes.Downloading);
    }
  }, [kind, refetch, selectedTasks]);

  const pause = useCallback(async () => {
    const tasks = selectedTasks();
    if (tasks.length === 0) {
      return;
    }

    const outcome = await changeTasksState(tasks, 'pause');
    if (!outcome.hasSuccess || outcome.hasError) {
      return;
    }

    await refetch();
    if (kind === TaskListKind.Downloading) {
      navigateTo(Routes.Waiting);
    }
  }, [kind, refetch, selectedTasks]);

  /* ---- delete / clear ---- */

  const remove = useCallback(async () => {
    const tasks = selectedTasks();
    if (tasks.length === 0) {
      return;
    }

    // AriaNg gates the confirmation on `confirmTaskRemoval`; with it off the
    // removal is immediate.
    if (settings.confirmTaskRemoval) {
      const confirmed = await confirmDialog({
        heading: t('Confirm Remove'),
        text: t('Are you sure you want to remove the selected task?'),
        okText: t('Confirm'),
        cancelText: t('Cancel'),
        icon: 'warning',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }

    const outcome = await removeTasks(tasks);
    if (!outcome.hasSuccess || outcome.hasError) {
      return;
    }

    await refetch();
    // Unconditional: a removed task lands in the stopped bucket, whatever page
    // the user removed it from.
    navigateTo(Routes.Stopped);
  }, [refetch, selectedTasks, settings.confirmTaskRemoval, t]);

  const clearStopped = useCallback(async () => {
    // Always confirmed, even with `confirmTaskRemoval` off: this one is
    // irreversible for *every* stopped task, not a selection.
    const confirmed = await confirmDialog({
      heading: t('Confirm Clear'),
      text: t('Are you sure you want to clear stopped tasks?'),
      okText: t('Confirm'),
      cancelText: t('Cancel'),
      icon: 'warning',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    await clearStoppedTasks();
    await refetch();
    navigateTo(Routes.Stopped);
  }, [refetch, t]);

  /* ---- retry ---- */

  const afterRetry = useCallback(
    async (action: AfterRetryingTask, singleGid?: string) => {
      if (action === 'task-list-downloading') {
        navigateTo(Routes.Downloading);
        return;
      }
      if (action === 'task-detail' && singleGid) {
        // aria2 assigns the retried task a **new** gid; `retryTask` does not
        // surface it, so the best available destination is the gid we retried.
        navigateToTaskDetail(singleGid);
        return;
      }
      // 'current-page' — and 'task-detail' for a bulk retry, where there is no
      // single destination: stay and refetch, exactly like AriaNg's $route.reload().
      await refetch();
    },
    [refetch],
  );

  const confirmRetry = useCallback(async (): Promise<boolean> => {
    const confirmed = await confirmDialog({
      heading: t('Confirm Retry'),
      text: t('Are you sure you want to retry the selected task? AriaNg will create same task after clicking OK.'),
      okText: t('Confirm'),
      cancelText: t('Cancel'),
      icon: 'info',
    });
    return confirmed;
  }, [t]);

  const retryOne = useCallback(
    async (task: NormalizedTask) => {
      if (!(await confirmRetry())) {
        return;
      }

      const result = await retryTask(task.gid);
      if (!result.ok) {
        await alertDialog({
          heading: t('Error'),
          text: `${t('Failed to retry this task.')}${result.error ? `\n${result.error}` : ''}`,
          okText: t('OK'),
          icon: 'warning',
        });
        return;
      }

      await afterRetry(settings.afterRetryingTask, task.gid);
    },
    [afterRetry, confirmRetry, settings.afterRetryingTask, t],
  );

  const retry = useCallback(async () => {
    const tasks = selectedTasks();
    if (tasks.length === 0) {
      return;
    }

    // AriaNg routed a single selection through the single-task path, which has
    // no result dialog — one task cannot be "partly retried".
    if (tasks.length === 1) {
      await retryOne(tasks[0] as NormalizedTask);
      return;
    }

    if (!(await confirmRetry())) {
      return;
    }

    const outcome = await retryTasks(
      tasks.filter((task) => isTaskRetryable(task)).map((task) => task.gid),
    );

    await alertDialog({
      heading: t('Operation Result'),
      text: t('{successCount} tasks have been retried and {failedCount} tasks are failed.', {
        successCount: outcome.successCount,
        failedCount: outcome.failedCount,
      }),
      okText: t('OK'),
      icon: 'info',
    });

    if (outcome.hasSuccess) {
      // A bulk retry has no single destination, so 'task-detail' degrades to
      // staying put — exactly what AriaNg did for everything but the downloading
      // list.
      await afterRetry(settings.afterRetryingTask);
    }
  }, [afterRetry, confirmRetry, retryOne, selectedTasks, settings.afterRetryingTask, t]);

  /* ---- selection + sorting ---- */

  const selectAll = useCallback(() => {
    useSelectionStore.getState().selectAll();
  }, []);

  const selectFailed = useCallback(() => {
    useSelectionStore.getState().selectFailed();
  }, []);

  const selectCompleted = useCallback(() => {
    useSelectionStore.getState().selectCompleted();
  }, []);

  const setDisplayOrder = useCallback(
    (value: string) => {
      useSettingsStore.getState().setDisplayOrder(kind, value);
    },
    [kind],
  );

  return useMemo(
    () => ({
      start,
      pause,
      remove,
      clearStopped,
      retry,
      retryOne,
      selectAll,
      selectFailed,
      selectCompleted,
      setDisplayOrder,
    }),
    [
      clearStopped,
      pause,
      remove,
      retry,
      retryOne,
      selectAll,
      selectCompleted,
      selectFailed,
      setDisplayOrder,
      start,
    ],
  );
}

/* ------------------------------------------------------------------ */
/* the toolbar                                                         */
/* ------------------------------------------------------------------ */

/** `true` when every candidate task is already selected (so a toggle would clear). */
function allSelected(tasks: readonly NormalizedTask[], selected: Record<string, boolean>): boolean {
  if (tasks.length === 0) {
    return false;
  }
  return tasks.every((task) => selected[task.gid] === true);
}

export interface TaskListToolbarProps {
  kind: TaskListKind;
  /**
   * Share the page's action layer instead of building a second one. Optional so
   * the toolbar still works standalone.
   */
  actions?: TaskListActions;
}

export function TaskListToolbar({ kind, actions: provided }: TaskListToolbarProps) {
  const t = useTranslate();
  const own = useTaskListActions(kind);
  const actions = provided ?? own;

  const order = useSettingsStore((state) => state.resolveDisplayOrder(kind));
  const selectedRecord = useSelectionStore((state) => state.selected);
  const list = useTasksStore((state) => state.list);
  const searchText = useTasksStore((state) => state.searchText);

  const visible = useMemo(
    () => useTasksStore.getState().filtered(),
    // `filtered()` reads the list + search text out of the store; both are
    // already dependencies here, which is what keeps the memo honest.
    [list, searchText],
  );

  const failedTasks = useMemo(() => visible.filter((task) => isTaskRetryable(task)), [visible]);
  const completedTasks = useMemo(
    () => visible.filter((task) => task.status === Aria2TaskStatus.Complete),
    [visible],
  );

  const selectedTasksNow = useMemo(
    () => visible.filter((task) => selectedRecord[task.gid] === true),
    [visible, selectedRecord],
  );

  const showRemove = selectedTasksNow.length > 0;
  const showClear = visible.length > 0 && visible.some((task) => isTerminalStatus(task.status));

  const menuItems = (
    <MduiMenu>
      {DISPLAY_ORDER_ENTRIES.map((entry) => {
        const active = isOrderTypeActive(order, entry.type);

        return (
          <MduiMenuItem key={entry.type} selected={active} onClick={() => actions.setDisplayOrder(entry.value)}>
            <span className="task-order-entry">
              <span>{t(entry.label)}</span>
              {active ? <MduiIcon name="check" size="1rem" /> : null}
            </span>
          </MduiMenuItem>
        );
      })}
    </MduiMenu>
  );

  return (
    <div className="task-list-toolbar" data-testid="task-list-toolbar">
      {/* Raw tags rather than `<MduiDropdown>` / `<MduiButton>`:
          - `MduiDropdown` renders its trigger as a plain child, but mdui reads the
            trigger from the `trigger` *slot*
            (`queryAssignedElements({ slot: 'trigger' })`) and throws inside
            `getOverflowAncestors(undefined)` when it finds nothing;
          - `MduiButton` does not forward a `slot`, so it cannot carry one.
          `src/ui/**` is not this page's to change, so both are set up here. */}
      <mdui-dropdown trigger="click" placement="bottom-start">
        <mdui-button slot="trigger" variant="text" icon="sort" end-icon="expand-more">
          {t('Display Order')}
        </mdui-button>
        {menuItems}
      </mdui-dropdown>

      <div className="task-list-toolbar__toggles">
        <MduiChip
          variant="filter"
          selectable
          selected={allSelected(visible, selectedRecord)}
          disabled={visible.length === 0}
          onChange={() => actions.selectAll()}
        >
          {t('Select All Tasks')}
        </MduiChip>

        <MduiChip
          variant="filter"
          selectable
          selected={allSelected(failedTasks, selectedRecord)}
          disabled={failedTasks.length === 0}
          onChange={() => actions.selectFailed()}
        >
          {t('Select All Failed Tasks')}
        </MduiChip>

        <MduiChip
          variant="filter"
          selectable
          selected={allSelected(completedTasks, selectedRecord)}
          disabled={completedTasks.length === 0}
          onChange={() => actions.selectCompleted()}
        >
          {t('Select All Completed Tasks')}
        </MduiChip>
      </div>

      <div className="task-list-toolbar__actions">
        <MduiButton variant="text" icon="delete" disabled={!showRemove} onClick={() => void actions.remove()}>
          {t('Delete')}
        </MduiButton>

        <MduiButton variant="text" icon="done-all" disabled={!showClear} onClick={() => void actions.clearStopped()}>
          {t('Clear Stopped Tasks')}
        </MduiButton>

        <MduiButton variant="text" icon="refresh" disabled={selectedTasksNow.length === 0} onClick={() => void actions.retry()}>
          {t('Retry Selected Tasks')}
        </MduiButton>
      </div>
    </div>
  );
}

export default TaskListToolbar;