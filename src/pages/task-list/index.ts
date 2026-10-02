/**
 * Barrel for the task-list feature.
 *
 * `TaskListPage` (in `src/pages/`) owns the composition — the router lazy-loads
 * that one file — while everything it renders lives here.
 */

export { TaskTable, ROW_HEIGHT, VIRTUALIZE_THRESHOLD } from './TaskTable';
export type { TaskTableProps } from './TaskTable';

export { TaskRow, formatEta, isFileSelectionPending, mediaChipText, navigateToTaskDetail, seedersText, speedText, speedTooltip, statusTextKey, taskDetailHref, ETA_PLACEHOLDER } from './TaskRow';
export type { TaskRowProps } from './TaskRow';

export { TaskRowHeader, HEADER_COLUMNS, HEADER_DEFAULT_DIRECTION, ariaSortFor, nextOrderForHeader } from './TaskRowHeader';
export type { TaskRowHeaderProps } from './TaskRowHeader';

export { TaskProgress } from './TaskProgress';
export type { TaskProgressProps } from './TaskProgress';

export { TaskContextMenu, magnetLinkFor } from './TaskContextMenu';
export type { TaskContextMenuProps } from './TaskContextMenu';

export {
  TaskListToolbar,
  DISPLAY_ORDER_ENTRIES,
  canClearStopped,
  canDeleteTasks,
  canPauseTasks,
  canRetryTasks,
  canStartTasks,
  isOrderTypeActive,
  navigateTo,
  selectedTasksHaveEd2kLink,
  selectedTasksHaveInfoHash,
  selectedTasksHaveUrl,
  startableTasks,
  useTaskListActions,
} from './TaskListToolbar';
export type { TaskListActions, TaskListToolbarProps } from './TaskListToolbar';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps, EmptyStateVariant } from './EmptyState';

export {
  TASK_LIST_REFRESH_JOB_ID,
  TASK_LIST_SORTABLE_ID,
  applyTaskMove,
  createAnnouncements,
  dropIndexFromVisibleOrder,
  isDragSupported,
  parseOrderType,
  reorderGids,
  useTaskListSensors,
} from './dnd';
export type { AnnouncementContext, DragSupportOptions, DropIndexOptions } from './dnd';