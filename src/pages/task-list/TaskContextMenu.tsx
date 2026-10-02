/**
 * The right-click menu — the 13 items (plus 4 conditional dividers) of
 * AriaNg's `#task-table-contextmenu` block, with the **exact** visibility
 * conditions from `list.html`:
 *
 * | #  | item | shown when |
 * |----|------|------------|
 * | 1  | Retry Selected Tasks | `isSelectedTaskRetryable()` — **every** selected task is retryable |
 * | 2  | *(divider)*          | same |
 * | 3  | Start                | a `paused` task is selected (and not awaiting file selection) |
 * | 4  | Pause                | an `active` **or** `waiting` task is selected |
 * | 5  | Delete               | any task is selected |
 * | 6  | *(divider)*          | same |
 * | 7  | Display Order ▸      | always (7 sub-entries) |
 * | 8  | Select All Failed Tasks   | `hasRetryableTask()` |
 * | 9  | Select All Completed Tasks | `hasCompletedTask()` |
 * | 10 | Select All           | always |
 * | 11 | *(divider)*          | a copy item is available |
 * | 12 | Copy Download Url    | **every** selected task has a `singleUrl` |
 * | 13 | Copy Magnet Link     | **every** selected task is a torrent with an `infoHash` |
 * | +  | Copy ED2K Link       | aria2-next: **every** selected task has `ed2k.ed2kLink` |
 *
 * ## How it is hosted
 *
 * This component renders only the `<mdui-menu>` **panel**; `TaskTable` wraps it in
 * a `<mdui-dropdown trigger="contextmenu" open-on-pointer>` whose `slot="trigger"`
 * is the scrollable table body. That is deliberate: mdui positions the panel at
 * `offsetX/offsetY` measured inside the trigger's rect, so making the *body* the
 * trigger is what puts the menu exactly under the cursor — and it also means one
 * `contextmenu` listener covers every row, including ones scrolled in later.
 */

import { useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import type { NormalizedTask } from '@/domain/types';
import { isTaskRetryable } from '@/domain/normalize';
import { Aria2TaskStatus } from '@/config/rpc-constants';
import type { TaskListKind } from '@/config/rpc-constants';
import { useTranslate } from '@/i18n/react';
import { MduiDivider, MduiIcon } from '@/ui/mdui';
import { useMduiEvent } from '@/ui/mdui/use-mdui';
import { useSelectionStore } from '@/store/selection';
import { useSettingsStore } from '@/store/settings';
import { useTasksStore } from '@/store/tasks';
import { copyText } from '@/utils/clipboard';
import {
  DISPLAY_ORDER_ENTRIES,
  canDeleteTasks,
  canPauseTasks,
  canRetryTasks,
  canStartTasks,
  isOrderTypeActive,
  selectedTasksHaveEd2kLink,
  selectedTasksHaveInfoHash,
  selectedTasksHaveUrl,
  useTaskListActions,
} from './TaskListToolbar';
import type { TaskListActions } from './TaskListToolbar';

/* ------------------------------------------------------------------ */
/* link builders                                                       */
/* ------------------------------------------------------------------ */

/** `magnet:?xt=urn:btih:<infoHash>` — AriaNg's `copySelectedTasksMagnetLink`. */
export function magnetLinkFor(task: NormalizedTask): string {
  return `magnet:?xt=urn:btih:${task.infoHash ?? ''}`;
}

/** Newline-joined, exactly like AriaNg's `result += '\n'` loop. */
function joinLinks(tasks: readonly NormalizedTask[], build: (task: NormalizedTask) => string): string {
  return tasks.map(build).join('\n');
}

/* ------------------------------------------------------------------ */
/* one menu entry                                                      */
/* ------------------------------------------------------------------ */

interface ContextMenuItemProps {
  icon?: string;
  title: string;
  selected?: boolean;
  onClick: () => void;
  children?: ReactNode;
}

/**
 * `<mdui-menu-item>` with the three things this menu needs and
 * `<MduiMenuItem>` does not expose:
 *
 * - `title` — AriaNg labelled **every** entry with a tooltip;
 * - the click has to be bound through the ref, because `<mdui-menu-item>` has no
 *   React event and mdui's own listener (`this.addEventListener('click', …)`) is
 *   the native one that bubbles out of the shadow root;
 * - `selected` is reflected as `aria-selected` so a screen reader can announce
 *   which Display Order is active.
 */
function ContextMenuItem({ icon, title, selected = false, onClick, children }: ContextMenuItemProps) {
  const ref = useRef<HTMLElement>(null);
  useMduiEvent(ref, 'click', () => onClick());

  return (
    <mdui-menu-item ref={ref} icon={icon} title={title} aria-selected={selected}>
      {children}
    </mdui-menu-item>
  );
}

/* ------------------------------------------------------------------ */
/* the menu                                                            */
/* ------------------------------------------------------------------ */

export interface TaskContextMenuProps {
  kind: TaskListKind;
  /** Share the page's action layer; optional so the menu renders standalone. */
  actions?: TaskListActions;
}

export function TaskContextMenu({ kind, actions: provided }: TaskContextMenuProps) {
  const t = useTranslate();
  const own = useTaskListActions(kind);
  const actions = provided ?? own;

  // Every condition below depends on the live selection, so this has to be a
  // subscription — a render-time read would show a stale menu for one tick.
  const selectedRecord = useSelectionStore((state) => state.selected);
  const list = useTasksStore((state) => state.list);
  const searchText = useTasksStore((state) => state.searchText);
  const order = useSettingsStore((state) => state.resolveDisplayOrder(kind));

  const visible = useMemo(() => useSelectionStore.getState().visible(), [list, searchText]);
  const selectedTasks = useMemo(
    () => visible.filter((task) => selectedRecord[task.gid] === true),
    [visible, selectedRecord],
  );

  const showRetry = canRetryTasks(selectedTasks);
  const showStart = canStartTasks(selectedTasks);
  const showPause = canPauseTasks(selectedTasks);
  const showDelete = canDeleteTasks(selectedTasks);
  const showCopyUrl = selectedTasksHaveUrl(selectedTasks);
  const showCopyMagnet = selectedTasksHaveInfoHash(selectedTasks);
  const showCopyEd2k = selectedTasksHaveEd2kLink(selectedTasks);
  const showBulkFailed = visible.some((task) => isTaskRetryable(task));
  const showBulkCompleted = visible.some((task) => task.status === Aria2TaskStatus.Complete);

  const copyUrls = useCallback(() => {
    const text = joinLinks(useSelectionStore.getState().selectedTasks(), (task) => task.singleUrl ?? '');
    if (text) {
      void copyText(text);
    }
  }, []);

  const copyMagnets = useCallback(() => {
    const text = joinLinks(useSelectionStore.getState().selectedTasks(), magnetLinkFor);
    if (text) {
      void copyText(text);
    }
  }, []);

  const copyEd2kLinks = useCallback(() => {
    const text = joinLinks(useSelectionStore.getState().selectedTasks(), (task) => task.ed2k?.ed2kLink ?? '');
    if (text) {
      void copyText(text);
    }
  }, []);

  const item = (key: string, icon: string | undefined, label: string, onClick: () => void): ReactNode => (
    <ContextMenuItem key={key} icon={icon} title={label} selected={false} onClick={onClick}>
      {label}
    </ContextMenuItem>
  );

  return (
    <mdui-menu
      className="task-context-menu"
      data-testid="task-context-menu"
      submenu-trigger="hover click focus"
    >
      {showRetry ? item('retry', 'refresh', t('Retry Selected Tasks'), () => void actions.retry()) : null}
      {showRetry ? <MduiDivider key="divider-retry" /> : null}

      {showStart ? item('start', 'play-arrow', t('Start'), () => void actions.start()) : null}
      {showPause ? item('pause', 'pause', t('Pause'), () => void actions.pause()) : null}
      {showDelete ? item('delete', 'delete', t('Delete'), () => void actions.remove()) : null}

      {showDelete ? <MduiDivider key="divider-delete" /> : null}

      {/* item 7 — always present; the 7 order types live in a real mdui submenu
          (`slot="submenu"`), which AriaNg hand-rolled with Bootstrap. */}
      <mdui-menu-item key="order" icon="sort" className="task-context-submenu-trigger">
        {t('Display Order')}
        <mdui-menu slot="submenu">
          {DISPLAY_ORDER_ENTRIES.map((entry) => {
            const active = isOrderTypeActive(order, entry.type);

            return (
              <ContextMenuItem
                key={entry.type}
                title={t(entry.label)}
                selected={active}
                onClick={() => actions.setDisplayOrder(entry.value)}
              >
                <span className="task-order-entry">
                  <span>{t(entry.label)}</span>
                  {active ? <MduiIcon name="check" size="1rem" /> : null}
                </span>
              </ContextMenuItem>
            );
          })}
        </mdui-menu>
      </mdui-menu-item>

      {showBulkFailed
        ? item('select-failed', undefined, t('Select All Failed Tasks'), () => actions.selectFailed())
        : null}
      {showBulkCompleted
        ? item('select-completed', undefined, t('Select All Completed Tasks'), () => actions.selectCompleted())
        : null}
      {item('select-all', 'table-chart', t('Select All'), () => actions.selectAll())}

      {showCopyUrl || showCopyMagnet || showCopyEd2k ? <MduiDivider key="divider-copy" /> : null}
      {showCopyUrl ? item('copy-url', 'content-copy', t('Copy Download Url'), copyUrls) : null}
      {showCopyMagnet ? item('copy-magnet', 'content-copy', t('Copy Magnet Link'), copyMagnets) : null}
      {showCopyEd2k ? item('copy-ed2k', 'content-copy', t('Copy ED2K Link'), copyEd2kLinks) : null}
    </mdui-menu>
  );
}

export default TaskContextMenu;