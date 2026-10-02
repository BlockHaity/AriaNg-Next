/**
 * The task-list page — one component behind `/downloading`, `/waiting` and
 * `/stopped`, exactly like AriaNg's single `views/list.html`.
 *
 * ## What this page owns
 *
 * 1. **which aria2 list is shown** — `setPage(kind)` then `refresh()` on mount and
 *    on every `kind` change. The store clears the cached tasks when the page
 *    changes, because a positional merge across two different aria2 lists would be
 *    nonsense;
 * 2. **the global shortcuts** — `selectAll` and `delete` are registered into
 *    `ui.keyActions` and unregistered on unmount, so a stale closure from the page
 *    that was just left can never fire;
 * 3. **the transport failure banner** — when the last refresh failed the grid is
 *    replaced by `Cannot connect to aria2!` instead of an empty table, which is
 *    indistinguishable from "no tasks";
 * 4. **the first-load spinner** — shown once, never per poll.
 *
 * The 1 s poll itself belongs to the shell's scheduler; this page only calls
 * `refresh()` explicitly (on mount, on `kind` change and after a user action,
 * through the shared action layer).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { TaskListKind } from '@/config/rpc-constants';
import { useTasksStore } from '@/store/tasks';
import { useUiStore } from '@/store/ui';
import { MduiBanner } from '@/ui/mdui';
import { useTranslate } from '@/i18n/react';
import { TaskTable } from './task-list/TaskTable';
import { TaskContextMenu } from './task-list/TaskContextMenu';
import { TaskListToolbar, useTaskListActions } from './task-list/TaskListToolbar';
import './task-list/styles.css';

export interface TaskListPageProps {
  /** Which aria2 list to show. The router passes it; `downloading` is the default. */
  kind?: TaskListKind;
}

/**
 * Resolves the list kind from the route when the router does not pass one.
 *
 * The three task routes are `#!/downloading`, `#!/waiting` and `#!/stopped`, so
 * the hash already carries the answer. Reading it directly keeps this component
 * usable from a bare hash router, a memory router or a test.
 */
function kindFromLocation(): TaskListKind {
  if (typeof window === 'undefined') {
    return 'downloading';
  }

  const hash = window.location.hash.replace(/^#!?/, '');
  const path = (hash.split('?')[0] ?? '').replace(/^\/+/, '');

  if (path === 'waiting' || path === 'stopped' || path === 'downloading') {
    return path;
  }
  return 'downloading';
}

export function TaskListPage({ kind: kindProp }: TaskListPageProps) {
  const t = useTranslate();

  // When the router does not drive `kind`, follow the hash so the same component
  // also works behind a plain `HashRouter`.
  const [locationKind, setLocationKind] = useState<TaskListKind>(kindFromLocation);
  const kind = kindProp ?? locationKind;

  const actions = useTaskListActions(kind);

  /* ---- which aria2 list is shown ------------------------------------ */

  useEffect(() => {
    const store = useTasksStore.getState();
    store.setPage(kind);
    void store.refresh();
  }, [kind]);

  useEffect(() => {
    if (kindProp !== undefined) {
      return;
    }

    const onHashChange = () => setLocationKind(kindFromLocation());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [kindProp]);

  /* ---- loading / error ---------------------------------------------- */

  const loading = useTasksStore((state) => state.loading);
  const error = useTasksStore((state) => state.error);

  /**
   * The spinner must not appear on every tick.
   *
   * `refresh({ silent: true })` never sets `loading`, so the 1 s poll leaves it
   * alone; this latch additionally covers the poll racing the first render, which
   * would otherwise flash the spinner once per page entry.
   */
  const firstLoadDone = useRef(false);
  if (!loading && !firstLoadDone.current) {
    firstLoadDone.current = true;
  }
  const showSpinner = loading && !firstLoadDone.current;

  /* ---- global shortcuts --------------------------------------------- */

  const registerKeyAction = useUiStore((state) => state.registerKeyAction);
  const { selectAll, remove } = actions;

  useEffect(() => {
    const unregisterSelectAll = registerKeyAction('selectAll', selectAll);
    const unregisterDelete = registerKeyAction('delete', () => void remove());
    return () => {
      unregisterSelectAll();
      unregisterDelete();
    };
  }, [registerKeyAction, remove, selectAll]);

  /* ---- the disconnected banner -------------------------------------- */

  const banner = useMemo(
    () =>
      error ? <MduiBanner open message={`${t('Cannot connect to aria2!')} ${error}`} icon="error" /> : null,
    [error, t],
  );

  return (
    <div className="task-list-page" data-testid="task-list-page" data-kind={kind}>
      <TaskListToolbar kind={kind} actions={actions} />

      {banner}

      <TaskTable
        kind={kind}
        actions={actions}
        contextMenu={<TaskContextMenu kind={kind} actions={actions} />}
        initialLoading={showSpinner}
        error={error ? t('Cannot connect to aria2!') : undefined}
      />
    </div>
  );
}

export default TaskListPage;