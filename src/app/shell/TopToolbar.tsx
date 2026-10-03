/**
 * The top app bar — AriaNg's toolbar, 1:1.
 *
 * ```
 * [New] [▶ Start] [⏸ Pause] [🗑 Delete ▾] [▦ Select All] [↕ Display Order ▾] [? Help]   [ search ] [ profile ▾ ]
 * ```
 *
 * Every enable/disable rule is AriaNg's, because each one exists for a reason:
 *
 * - **Start** is only offered when a **paused** task is selected — `unpause` on
 *   an active gid is an error in aria2;
 * - **Pause** only when an **active or waiting** task is selected — pausing a
 *   finished task is a no-op;
 * - **Remove Task** needs a selection, **Clear Stopped Tasks** needs the
 *   select-all control to be enabled *and* a stopped task to be on screen;
 * - **Select All** needs `selection.enabled && list.length > 0`.
 *
 * Icons come from the app's imported `@mdui/icons` set (inline SVG, no webfont),
 * so a name outside that set would render as a blank glyph — every icon below is
 * one of the imported ones.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Routes as RoutePaths } from '../route-paths';
import { RpcProfileSwitcher } from './RpcProfileSwitcher';
import { useIsCompactLayout } from './AppShell';
import { useTranslate } from '@/i18n';
import { Aria2TaskStatus, isRunningStatus, isTerminalStatus } from '@/config/rpc-constants';
import type { DisplayOrderType } from '@/config/types';
import { changeTasksState, clearStoppedTasks, removeTasks } from '@/store/commands';
import { useSelectionStore } from '@/store/selection';
import { useSettingsStore } from '@/store/settings';
import { filterTasks, useTasksStore } from '@/store/tasks';
import { useUiStore } from '@/store/ui';
import { MduiButton, MduiDropdown, MduiIconButton, MduiMenu, MduiMenuItem, MduiTextField } from '@/ui/mdui';
import { ConnectButton } from './ConnectButton';
import { ThemeSwitcher } from './ThemeSwitcher';

/** Where the "Help" button points — AriaNg's own project page. */
export const ARIANG_PROJECT_URL = 'https://github.com/mayswind/AriaNg';

/**
 * Dispatched on `window` to move focus into the search box — that is what
 * `⌘/Ctrl + F` does. The shortcut binder lives in `BootstrapGate`, the field
 * lives here, so they meet on a DOM event rather than on a shared ref.
 */
export const FOCUS_SEARCH_EVENT = 'ariang:focus-search';

/** AriaNg's seven display orders, in menu order. */
export const DISPLAY_ORDERS: readonly { type: DisplayOrderType; labelKey: string }[] = [
  { type: 'default', labelKey: 'Default' },
  { type: 'name', labelKey: 'By File Name' },
  { type: 'size', labelKey: 'By File Size' },
  { type: 'percent', labelKey: 'By Progress' },
  { type: 'remain', labelKey: 'By Remaining' },
  { type: 'dspeed', labelKey: 'By Download Speed' },
  { type: 'uspeed', labelKey: 'By Upload Speed' },
];

/** Which task list the display-order control is editing. */
function currentListPage(pathname: string): 'downloading' | 'waiting' | 'stopped' {
  if (pathname === RoutePaths.Waiting) {
    return 'waiting';
  }
  if (pathname === RoutePaths.Stopped) {
    return 'stopped';
  }
  return 'downloading';
}

export function TopToolbar() {
  const t = useTranslate();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const compact = useIsCompactLayout();
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const searchText = useUiStore((state) => state.searchText);
  const list = useTasksStore((state) => state.list);
  const taskSearchText = useTasksStore((state) => state.searchText);
  const selectedMap = useSelectionStore((state) => state.selected);
  const selectionEnabled = useSelectionStore((state) => state.enabled);
  const settings = useSettingsStore((state) => state.settings);

  /* --- search box ------------------------------------------------------- */

  useEffect(() => {
    const focus = (): void => {
      searchWrapRef.current?.querySelector('mdui-text-field')?.focus();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => {
      window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
    };
  }, []);

  const onSearch = (value: string): void => {
    // The shell owns the text (it survives a route change, like AriaNg's); the
    // tasks store reads the same string to filter `filtered()`.
    useUiStore.getState().setSearchText(value);
    useTasksStore.getState().setSearchText(value);
  };

  /* --- selection-dependent actions -------------------------------------- */

  // The list the page actually shows, and therefore the list a selection can refer
  // to: the raw list narrowed by the search box, exactly like the tasks store's
  // own `filtered()`.
  const visible = useMemo(() => filterTasks(list, taskSearchText), [list, taskSearchText]);
  const selectedTasks = useMemo(
    () => visible.filter((task) => selectedMap[task.gid] === true),
    [visible, selectedMap],
  );

  const canStart = selectedTasks.some((task) => task.status === Aria2TaskStatus.Paused);
  const canPause = selectedTasks.some((task) => isRunningStatus(task.status));
  const canRemove = selectedTasks.length > 0;
  // AriaNg only offered "Clear stopped tasks" when the select-all control was
  // live (i.e. the list has rows) and a stopped task was actually visible.
  const canClearStopped = selectionEnabled && visible.length > 0 && visible.some((task) => isTerminalStatus(task.status));

  const onStart = (): void => {
    void changeTasksState(selectedTasks, 'start');
  };
  const onPause = (): void => {
    void changeTasksState(selectedTasks, 'pause');
  };
  const onRemove = (): void => {
    void removeTasks(selectedTasks);
  };
  const onClearStopped = (): void => {
    void clearStoppedTasks();
  };
  const onSelectAll = (): void => {
    useSelectionStore.getState().selectAll();
  };

  /* --- display order ---------------------------------------------------- */

  const page = currentListPage(pathname);
  const currentOrder = settings.taskListIndependentDisplayOrder
    ? page === 'waiting'
      ? settings.waitingTaskListPageDisplayOrder
      : page === 'stopped'
        ? settings.stoppedTaskListPageDisplayOrder
        : settings.displayOrder
    : settings.displayOrder;
  const [activeType, activeDirection] = (currentOrder || 'default:asc').split(':');
  const direction = activeDirection === 'desc' ? 'desc' : 'asc';

  const orderItems = [
    <MduiMenu key="display-order" selects="single" value={activeType}>
      {DISPLAY_ORDERS.map((order) => (
        <MduiMenuItem
          key={order.type}
          value={order.type}
          icon={order.type === activeType ? 'check' : undefined}
          selected={order.type === activeType}
          onClick={() => {
            // Only the sort key changes here; the direction keeps its current
            // value, which is what AriaNg's menu did.
            useSettingsStore.getState().setDisplayOrder(page, `${order.type}:${direction}`);
          }}
        >
          {t(order.labelKey)}
        </MduiMenuItem>
      ))}
    </MduiMenu>,
  ];

  const deleteItems = [
    <MduiMenu key="delete">
      <MduiMenuItem disabled={!canRemove} selected={canRemove} onClick={onRemove}>
        {t('Remove Task')}
      </MduiMenuItem>
      <MduiMenuItem disabled={!canClearStopped} selected={canClearStopped} onClick={onClearStopped}>
        {t('Clear Stopped Tasks')}
      </MduiMenuItem>
    </MduiMenu>,
  ];

  /* --- render ----------------------------------------------------------- */

  return (
    <mdui-top-app-bar variant="small">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.125rem' }}>
        <MduiButton variant="text" icon="add" onClick={() => navigate(RoutePaths.New)}>
          {t('New')}
        </MduiButton>

        <MduiIconButton icon="play-arrow" label={t('Start')} disabled={!canStart} onClick={onStart} />
        <MduiIconButton icon="pause" label={t('Pause')} disabled={!canPause} onClick={onPause} />

        {/* Split buttons: the leading control opens the menu, exactly like
            AriaNg's trash + caret pair. */}
        <MduiDropdown
          trigger={
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <MduiIconButton icon="delete" label={t('Delete')} />
              <MduiIconButton
                icon="expand-more"
                label={t('Delete')}
                disabled={!canRemove && !canClearStopped}
              />
            </div>
          }
          items={deleteItems}
          placement="bottom"
        />

        <MduiIconButton
          icon="done-all"
          label={t('Select All')}
          disabled={!selectionEnabled || list.length === 0}
          onClick={onSelectAll}
        />

        <MduiDropdown
          trigger={
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <MduiIconButton icon="sort" label={t('Display Order')} />
              <MduiIconButton icon="expand-less" label={t('Display Order')} />
            </div>
          }
          items={orderItems}
          placement="bottom"
        />

        <MduiButton variant="text" icon="info" href={ARIANG_PROJECT_URL} target="_blank">
          {t('Help')}
        </MduiButton>
      </div>

      {/* AriaNg hid the search box on phones: below the compact breakpoint there
          is no room for it next to the toolbar buttons. */}
      {compact ? null : (
        <div
          ref={searchWrapRef}
          style={{ display: 'flex', alignItems: 'center', flexGrow: 1, marginLeft: '0.5rem' }}
        >
          <MduiTextField
            value={searchText}
            type="search"
            variant="filled"
            icon="search"
            placeholder={t('Search')}
            onInput={onSearch}
            style={{ width: '100%' }}
          />
        </div>
      )}

      <ThemeSwitcher />
      <RpcProfileSwitcher />
      {/* The manual escape hatch for an endpoint auto-connect cannot fix. */}
      <ConnectButton />
    </mdui-top-app-bar>
  );
}