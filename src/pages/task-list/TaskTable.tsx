/**
 * The task table — mdui has no data-table component, so this is one built
 * straight from MD3 tokens.
 *
 * ## Columns
 *
 * AriaNg's three Bootstrap column groups, 1:1, expressed as CSS grid tracks
 * (never `.col-*` classes):
 *
 * | group | `md` (≥992) | `sm` (≥768) | `xs` (<768) |
 * |-------|-------------|-------------|-------------|
 * | A — name + size    | `8fr` | `7fr` | full width |
 * | B — progress + ETA | `2fr` | `3fr` | full width |
 * | C — download speed | `2fr` | `2fr` | **hidden** |
 * | chevron            | `auto`, and only from `lg` (≥1200) up |
 *
 * The header runs its own five-track grid because AriaNg split groups A and B in
 * half again; `styles.css` keeps both templates in step.
 *
 * ## Narrow selectors
 *
 * The 1 s poll replaces every task object, so a row re-renders whenever *its*
 * task changed. The subscription that actually matters for interactions — the
 * selection map — is read per row as `selected[gid]`, so toggling one row
 * re-renders exactly that row.
 *
 * ## Virtualisation
 *
 * Past {@link VIRTUALIZE_THRESHOLD} rows only the visible window is rendered:
 * a fixed row height (64 px compact / 72 px comfortable) plus a scroll handler.
 * AriaNg rendered all of them; with a 1000-task queue that is 1000 live rows and
 * 1000 progress bars, which is what makes the list feel sticky on a phone.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { DndContext } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import type { NormalizedTask } from '@/domain/types';
import type { TaskListKind } from '@/config/rpc-constants';
import { filterTasks, sortTasks, useTasksStore } from '@/store/tasks';
import { useSettingsStore } from '@/store/settings';
import { MduiProgressBar } from '@/ui/mdui';
import { TaskRow } from './TaskRow';
import { TaskRowHeader } from './TaskRowHeader';
import { TaskContextMenu } from './TaskContextMenu';
import { EmptyState } from './EmptyState';
import type { TaskListActions } from './TaskListToolbar';
import {
  applyTaskMove,
  createAnnouncements,
  dropIndexFromVisibleOrder,
  isDragSupported,
  useTaskListSensors,
} from './dnd';
import './styles.css';

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/** Above this many rows the window is rendered instead of the whole list. */
export const VIRTUALIZE_THRESHOLD = 200;

/** Row heights, mirrored by `styles.css`. Compact matches AriaNg's dense list. */
export const ROW_HEIGHT = { compact: 64, comfortable: 72 } as const;

/** Rows rendered above and below the window so a fast scroll never shows a gap. */
const OVERSCAN = 8;

/** Fallback viewport height when the container has not been laid out (jsdom, first paint). */
const FALLBACK_VIEWPORT = 600;

/** AriaNg's Bootstrap `max-width: 767px`. */
const COMPACT_QUERY = '(max-width: 767px)';

/* ------------------------------------------------------------------ */
/* the table                                                           */
/* ------------------------------------------------------------------ */

export interface TaskTableProps {
  kind: TaskListKind;
  /** Share the page's action layer; the table builds its own when omitted. */
  actions?: TaskListActions;
  /** Right-click panel. The page passes its own so it owns the composition. */
  contextMenu?: ReactNode;
  /** `true` on the very first load only — a 1 s poll must not flash a skeleton. */
  initialLoading?: boolean;
  /** Set when the last refresh failed; replaces the grid with the offline state. */
  error?: string;
}

export const TaskTable = memo(function TaskTable({
  kind,
  actions,
  contextMenu,
  initialLoading = false,
  error,
}: TaskTableProps) {
  const list = useTasksStore((state) => state.list);
  const searchText = useTasksStore((state) => state.searchText);
  const order = useSettingsStore((state) => state.resolveDisplayOrder(kind));
  const dragEnabledSetting = useSettingsStore((state) => state.settings.dragAndDropTasks);

  const dragEnabled = isDragSupported({
    enabledBySetting: dragEnabledSetting,
    page: kind,
    orderType: order,
  });

  const changeOrder = useCallback(
    (next: string) => {
      useSettingsStore.getState().setDisplayOrder(kind, next);
    },
    [kind],
  );

  const onRetryTask = useCallback(
    (task: NormalizedTask) => {
      void actions?.retryOne(task);
    },
    [actions],
  );

  /* ---- rows: search filter first, then the page's display order ---- */

  const visible = useMemo(() => sortTasks(filterTasks(list, searchText), order), [list, order, searchText]);
  const visibleGids = useMemo(() => visible.map((task) => task.gid), [visible]);
  const serverGids = useMemo(() => list.map((task) => task.gid), [list]);

  /* ---- windowing ---- */

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    const measure = () => {
      setViewport(node.clientHeight > 0 ? node.clientHeight : FALLBACK_VIEWPORT);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const rowHeight = useIsCompact() ? ROW_HEIGHT.compact : ROW_HEIGHT.comfortable;
  const virtualised = visible.length > VIRTUALIZE_THRESHOLD;

  const window_ = useMemo(() => {
    if (!virtualised) {
      return { start: 0, end: visible.length, topPad: 0, bottomPad: 0 };
    }

    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const count = Math.ceil(viewport / rowHeight) + OVERSCAN * 2;
    const end = Math.min(visible.length, start + count);

    return {
      start,
      end,
      topPad: start * rowHeight,
      bottomPad: (visible.length - end) * rowHeight,
    };
  }, [rowHeight, scrollTop, viewport, virtualised, visible.length]);

  const windowedTasks = useMemo(
    () => (virtualised ? visible.slice(window_.start, window_.end) : visible),
    [virtualised, visible, window_.end, window_.start],
  );

  /* ---- drag & drop ---- */

  const sensors = useTaskListSensors();
  const [announcement, setAnnouncement] = useState('');

  const dndAnnouncements = useMemo(
    () =>
      createAnnouncements({
        nameOf: (gid) => visible.find((task) => task.gid === gid)?.taskName ?? '',
        indexOf: (gid) => visibleGids.indexOf(gid),
        total: () => visibleGids.length,
      }),
    [visible, visibleGids],
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    setAnnouncement(String(event.active.id));
  }, []);

  const onDragCancel = useCallback(() => {
    setAnnouncement('');
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setAnnouncement('');

      if (!dragEnabled) {
        return;
      }

      const overId = event.over?.id;
      if (overId === undefined || overId === null) {
        return;
      }

      const dragged = String(event.active.id);
      const over = String(overId);
      if (dragged === over) {
        return;
      }

      const overIndex = visibleGids.indexOf(over);
      if (overIndex < 0) {
        return;
      }

      // The visible list may be filtered, so the drop position has to be mapped
      // back onto a *server* queue index before it is written to aria2.
      const serverIndex = dropIndexFromVisibleOrder({
        gids: serverGids,
        visibleGids,
        activeGid: dragged,
        overIndex,
      });

      void applyTaskMove({
        gid: dragged,
        index: serverIndex,
        refresh: () => useTasksStore.getState().refresh({ silent: true, force: true }),
      });
    },
    [dragEnabled, serverGids, visibleGids],
  );

  /* ---- the three "nothing to show" states ---- */

  if (initialLoading) {
    return (
      <div className="task-table-loading" data-testid="task-table-loading" role="status" aria-live="polite">
        <MduiProgressBar variant="circular" value={0} height={48} />
      </div>
    );
  }

  if (error) {
    return <EmptyState variant="disconnected" />;
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        variant={searchText.trim() ? 'search' : 'empty'}
        searchText={searchText}
        pageLabel={pageLabelKey(kind)}
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{ announcements: dndAnnouncements }}
    >
      <div
        role="grid"
        aria-rowcount={visible.length}
        className={dragEnabled ? 'task-table-body task-table-body--draggable' : 'task-table-body'}
        data-testid="task-table"
        data-kind={kind}
      >
        <TaskRowHeader order={order} onChangeOrder={changeOrder} />

        {/* mdui's dropdown needs the *scrollable body* as its contextmenu trigger,
            so the panel opens exactly under the cursor: `open-on-pointer` uses
            `offsetX/offsetY` measured inside this element's rect. */}
        <mdui-dropdown trigger="contextmenu" open-on-pointer placement="bottom-start">
          <div slot="trigger" ref={scrollRef} className="task-table-rows" onScroll={onScroll}>
            <SortableContext items={visibleGids} strategy={verticalListSortingStrategy}>
              {window_.topPad > 0 ? (
                <div className="task-table-pad" style={{ height: `${window_.topPad}px` }} aria-hidden="true" />
              ) : null}

              {windowedTasks.map((task) => (
                <TaskRow key={task.gid} task={task} draggable={dragEnabled} onRetryTask={onRetryTask} />
              ))}

              {window_.bottomPad > 0 ? (
                <div className="task-table-pad" style={{ height: `${window_.bottomPad}px` }} aria-hidden="true" />
              ) : null}
            </SortableContext>
          </div>

          {contextMenu ?? <TaskContextMenu kind={kind} actions={actions} />}
        </mdui-dropdown>
      </div>

      {/* dnd-kit keeps its own live region for the drag announcements; this one
          states the outcome of a completed reorder, which no event reports. */}
      <p className="ariang-visually-hidden" aria-live="polite" data-testid="task-dnd-announcer">
        {announcement}
      </p>
    </DndContext>
  );
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function pageLabelKey(kind: TaskListKind): string {
  switch (kind) {
    case 'waiting':
      return 'Waiting';
    case 'stopped':
      return 'Finished / Stopped';
    case 'downloading':
    default:
      return 'Downloading';
  }
}

/** `matchMedia` for the compact breakpoint, with the legacy API as a fallback. */
function useIsCompact(): boolean {
  const [compact, setCompact] = useState(queryCompact);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const list = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(list.matches);

    onChange();

    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    // jsdom's polyfill in `src/test/setup.ts` only implements the legacy API.
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, []);

  return compact;
}

function queryCompact(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia(COMPACT_QUERY).matches;
}

export default TaskTable;