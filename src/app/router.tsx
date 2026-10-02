/**
 * The route table and the `#!` router.
 *
 * ## Two kinds of route
 *
 * - **Pages** render inside `<mdui-layout-main>` via `<AppShell>`'s outlet.
 *   Every one of them is `React.lazy`, so the standard build emits one chunk per
 *   page (required by the size budget) and the single-file build inlines them
 *   all through `inlineDynamicImports`.
 * - **Commands** (`/new/task`, `/settings/rpc/set`) render *no UI at all*: they
 *   perform an RPC call and redirect. AriaNg had them as `resolve`d templates
 *   with an empty body; see {@link ./CommandRoutes}.
 *
 * ## `otherwise`
 *
 * AriaNg ended its route table with `otherwise('/downloading')`, so an unknown
 * url is never a blank page — it lands on the task list, after saying why.
 */
import { Component, lazy, useMemo } from 'react';
import type { ComponentProps, ReactNode } from 'react';
// Aliased: JSX treats a lower-case identifier as a host element tag name, so
// `unstable_HistoryRouter` has to be bound to a capitalised local name.
import { Route, Routes, unstable_HistoryRouter as HistoryRouter } from 'react-router-dom';

import { aria2SettingsRoute, Routes as RoutePaths } from './route-paths';
import { CommandFallback, NewTaskCommand, RpcSetCommand } from './CommandRoutes';
import { createHashBangHistory } from './hash-history';
import type { HashBangHistory } from './hash-history';
import { I18nContext } from '@/i18n';
import type { I18nApi } from '@/i18n';
import { MduiButton, MduiIcon } from '@/ui/mdui';

/* -------------------------------------------------------------------------- */
/* pages                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One lazy chunk per page — the size budget depends on it.
 *
 * Contract with the page owners: `src/pages/<Name>Page.tsx`, **default** export,
 * no required props (the router never passes any). The aria2 settings page keeps
 * its module inside its own feature folder, like every other page's sub-modules.
 */
const TaskListPage = lazy(() => import('@/pages/TaskListPage'));
const NewTaskPage = lazy(() => import('@/pages/NewTaskPage'));
const TaskDetailPage = lazy(() => import('@/pages/TaskDetailPage'));
const AriaNgSettingsPage = lazy(() => import('@/pages/AriaNgSettingsPage'));
const Aria2SettingsPage = lazy(() => import('@/pages/aria2-settings/Aria2SettingsPage'));
const DebugPage = lazy(() => import('@/pages/DebugPage'));
const StatusPage = lazy(() => import('@/pages/StatusPage'));
const Ed2kSearchPage = lazy(() => import('@/pages/Ed2kSearchPage'));


/* -------------------------------------------------------------------------- */
/* PageBoundary                                                               */
/* -------------------------------------------------------------------------- */

interface PageBoundaryProps {
  children?: ReactNode;
}

interface PageBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Error boundary for one lazy page.
 *
 * A rejected chunk (`import()` of a page that failed to download, or a page
 * whose render threw) must not leave a blank content area, so it is reported
 * as an MD3 error card with a retry action instead.
 *
 * Deliberately a class component: `getDerivedStateFromError` has no hook
 * equivalent, and the translations are read through {@link I18nContext} rather
 * than `useTranslate` for the same reason.
 */
export class PageBoundary extends Component<PageBoundaryProps, PageBoundaryState> {
  constructor(props: PageBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): PageBoundaryState {
    return { error: toError(error) };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[app] page failed to render', error);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children ?? null;
    }

    return (
      <I18nContext.Consumer>
        {(i18n: I18nApi) => (
          <mdui-card
            variant="outlined"
            role="alert"
            style={{
              margin: '1rem',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              alignItems: 'flex-start',
              color: 'rgb(var(--mdui-color-on-error-container))',
              backgroundColor: 'rgb(var(--mdui-color-error-container))',
              borderRadius: 'var(--mdui-shape-corner-large)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MduiIcon name="error" />
              <span style={{ font: 'var(--mdui-typescale-title-medium-font)' }}>{i18n.t('Error')}</span>
            </div>
            {/* The message can carry a chunk-load url, so it is rendered as
                text — never as markup (see the i18n module's XSS note). */}
            <span style={{ font: 'var(--mdui-typescale-body-medium-font)' }}>{error.message}</span>
            <MduiButton variant="text" icon="refresh" onClick={this.retry}>
              {i18n.t('Refresh')}
            </MduiButton>
          </mdui-card>
        )}
      </I18nContext.Consumer>
    );
  }
}

/* -------------------------------------------------------------------------- */
/* HashBangRouter                                                             */
/* -------------------------------------------------------------------------- */

export interface HashBangRouterProps {
  children?: ReactNode;
  basename?: string;
  useTransitions?: boolean;
}

/**
 * `<HashRouter>`, but on `#!`.
 *
 * The history is built once for the lifetime of the router. Construction is
 * idempotent — it reads the current hash and normalises the `idx` entry
 * `window.history` keeps — so React StrictMode building it twice in development
 * costs one redundant `replaceState` and nothing else.
 *
 * React Router exports neither its `History` interface nor its `Action` enum (the
 * latter being nominally distinct from a string union), so the hand-written
 * {@link HashBangHistory} is bridged to it once, here.
 */
type HistoryRouterHistory = ComponentProps<typeof HistoryRouter>['history'];

export function HashBangRouter({ children, basename, useTransitions }: HashBangRouterProps) {
  const history = useMemo<HashBangHistory>(() => createHashBangHistory(), []);

  return (
    <HistoryRouter
      history={history as unknown as HistoryRouterHistory}
      basename={basename}
      useTransitions={useTransitions}
    >
      {children}
    </HistoryRouter>
  );
}

/* -------------------------------------------------------------------------- */
/* the route table                                                            */
/* -------------------------------------------------------------------------- */

/** Wraps a lazy page so a failed chunk shows the error card, not a blank area. */
function page(element: ReactNode): ReactNode {
  return <PageBoundary>{element}</PageBoundary>;
}

/**
 * Every route, mirroring `src/app/route-paths.ts` one for one.
 *
 * The three task lists share a single module on purpose — AriaNg had one
 * `list.html` for all of them and only the selected bucket differed.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path={RoutePaths.Downloading} element={page(<TaskListPage />)} />
      <Route path={RoutePaths.Waiting} element={page(<TaskListPage />)} />
      <Route path={RoutePaths.Stopped} element={page(<TaskListPage />)} />

      <Route path={RoutePaths.New} element={page(<NewTaskPage />)} />

      {/* Command routes: no UI, side effect + redirect only. */}
      <Route path={RoutePaths.NewCommand} element={<NewTaskCommand />} />
      <Route path={RoutePaths.RpcSetCommand} element={<RpcSetCommand />} />
      <Route path={RoutePaths.RpcSetCommandFull} element={<RpcSetCommand />} />

      <Route path={RoutePaths.TaskDetail} element={page(<TaskDetailPage />)} />

      <Route path={RoutePaths.AriaNgSettings} element={page(<AriaNgSettingsPage />)} />
      <Route path={RoutePaths.AriaNgSettingsExtended} element={page(<AriaNgSettingsPage />)} />
      {/* Built from the helper so the pattern can never drift from the drawer. */}
      <Route path={aria2SettingsRoute(':group')} element={page(<Aria2SettingsPage />)} />

      <Route path={RoutePaths.Debug} element={page(<DebugPage />)} />
      <Route path={RoutePaths.Status} element={page(<StatusPage />)} />
      <Route path={RoutePaths.Ed2kSearch} element={page(<Ed2kSearchPage />)} />

      {/* AriaNg's `otherwise('/downloading')`, with its `Parameter is invalid!`
          notice attached. */}
      <Route path="*" element={<CommandFallback />} />
    </Routes>
  );
}
