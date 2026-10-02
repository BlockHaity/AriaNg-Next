/**
 * The MD3 layout scaffold.
 *
 * ```
 * <mdui-layout>
 *   <mdui-top-app-bar>          (TopToolbar)
 *   <mdui-navigation-drawer>    < 840px  (NavigationDrawer, modal overlay)
 *   <mdui-navigation-rail>      >= 840px (NavigationRail)
 *   <mdui-layout-main>          the page outlet
 *   <mdui-bottom-app-bar>       (StatusBar, AriaNg's footer)
 * </mdui-layout>
 * ```
 *
 * The drawer / rail switch follows MD3's canonical responsive navigation:
 * **below the `md` breakpoint the navigation is a modal drawer, from `md` upwards
 * it is a rail.** The breakpoint value is read from mdui's own
 * `--mdui-breakpoint-md` token (so a theme that redefines it is honoured) and
 * falls back to the MD3 default of 840 px when the token is unavailable — which
 * is also what keeps this file working in jsdom, where `mdui.css` is not applied.
 *
 * Not one colour literal appears here (or anywhere in the shell): every colour
 * goes through a `var(--mdui-color-*)` token.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { breakpoint } from 'mdui/functions/breakpoint.js';

import { HASH_BANG } from '../route-paths';
import { ConnectionBanner } from './ConnectionBanner';
import { NavigationDrawer } from './NavigationDrawer';
import { NavigationRail } from './NavigationRail';
import { SnackbarHost } from './SnackbarHost';
import { StatusBar } from './StatusBar';
import { TopToolbar } from './TopToolbar';
import { useSelectionStore } from '@/store/selection';
import { useTasksStore } from '@/store/tasks';
import { useUiStore } from '@/store/ui';

/** MD3's `md` breakpoint — the drawer / rail switch. */
export const MD_BREAKPOINT_PX = 840;

const BREAKPOINT_TOKEN = '--mdui-breakpoint-md';

function mediumBreakpointPx(): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return MD_BREAKPOINT_PX;
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(BREAKPOINT_TOKEN).trim();
    // mdui ships `840px`; jsdom (no stylesheet) hands back an empty string.
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : MD_BREAKPOINT_PX;
  } catch {
    return MD_BREAKPOINT_PX;
  }
}

/**
 * `true` below the `md` breakpoint: the navigation is a **modal drawer**.
 *
 * Resized through `window.resize` rather than a media query because the value
 * has to be read in JS anyway (to switch components), and one shared listener
 * is cheaper than one `matchMedia` per component.
 */
export function useIsCompactLayout(): boolean {
  const read = (): boolean => {
    try {
      // mdui's own helper, so `--mdui-breakpoint-*` stays the source of truth.
      if (breakpoint().down('md')) {
        return true;
      }
    } catch {
      /* fall through to the manual check below */
    }
    return (typeof window === 'undefined' ? MD_BREAKPOINT_PX : window.innerWidth) < mediumBreakpointPx();
  };

  const [compact, setCompact] = useState<boolean>(read);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const update = (): void => {
      setCompact(read());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
    // `read` deliberately re-reads the breakpoint token on every event instead of
    // capturing it, so the dependency list is empty on purpose.
  }, []);

  return compact;
}

/* -------------------------------------------------------------------------- */
/* route change                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Closes every open dialog.
 *
 * AriaNg called `$mdDialog.cancel()` on `$locationChangeStart`, which dismissed
 * every dialog the framework had a handle on — including the ones mdui's
 * programmatic `dialog()` helper appends to `<body>`. There is no registry to
 * cancel here, so the live DOM is walked instead; `open` is a **property** on
 * every mdui overlay (never an attribute), hence the property read.
 */
function closeAllDialogs(): void {
  if (typeof document === 'undefined') {
    return;
  }
  for (const element of document.querySelectorAll('mdui-dialog')) {
    const dialog = element as HTMLElement & { open?: boolean };
    if (dialog.open) {
      dialog.open = false;
    }
  }
}

/**
 * The route the shell is currently showing.
 *
 * Published as a module value rather than through a React context because the
 * scheduler jobs live outside the router (`BootstrapGate` mounts above it) and
 * still have to know whether the current page owns a task list.
 */
let currentRoutePath = '/';

export function getCurrentRoutePath(): string {
  return currentRoutePath;
}

/**
 * Router navigation for code that lives outside `<HashBangRouter>`.
 *
 * The gate is mounted above the router (it has to be — the router may not exist
 * until the components are defined), yet the welcome notice has to end up on the
 * settings page. The shell registers its navigator here so that code can ask for
 * a route without owning the router.
 */
let shellNavigate: ((path: string) => void) | null = null;

export function setShellNavigate(navigate: ((path: string) => void) | null): void {
  shellNavigate = navigate;
}

/**
 * Navigate through the router when there is one.
 *
 * The fallback rewrites `location.hash` directly, which is the only thing a
 * `#!` router can be driven with from outside; a `hashchange` (rather than a
 * `popstate`) is all the browser emits there, so this is strictly a last resort
 * for the window between "gate rendered" and "shell mounted".
 */
export function navigateInShell(path: string): void {
  if (shellNavigate) {
    shellNavigate(path);
    return;
  }
  if (typeof window !== 'undefined') {
    window.location.hash = `${HASH_BANG}${path.replace(/^\//, '')}`;
  }
}

/**
 * Resets everything that belonged to the page being left.
 *
 * This is AriaNg's `$locationChangeStart` handler, reproduced 1:1:
 *
 * - dialogs are closed;
 * - the task list is dropped (it belongs to a page, and aria2 re-reads it on
 *   the next tick anyway);
 * - the selection is dropped — otherwise a selection made on one page would
 *   silently apply to the tasks of another;
 * - the per-page keyboard / swipe registrations are dropped, so a stale closure
 *   from an unmounted page can never fire.
 *
 * The drawer state and the search text are deliberately **kept**: they are shell
 * state that AriaNg kept too.
 *
 * The first run is skipped on purpose: on mount the child page's effect has
 * already registered its keyboard / swipe handlers, and resetting here would
 * wipe them (and StrictMode's double mount would wipe them twice).
 */
function useRouteChangeReset(pathname: string): void {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    currentRoutePath = pathname;

    if (previous.current === null) {
      previous.current = pathname;
      return;
    }
    if (previous.current === pathname) {
      // Same route: a StrictMode re-run, not a navigation.
      return;
    }
    previous.current = pathname;

    closeAllDialogs();
    useTasksStore.getState().clear();
    useSelectionStore.getState().clear();
    useUiStore.getState().resetForRoute();
  }, [pathname]);
}

/* -------------------------------------------------------------------------- */
/* page loading                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Suspense fallback.
 *
 * A centred circular progress, which is the MD3 idiom for "the content area is
 * working on it" (the top bar and the status bar stay interactive, exactly as
 * they did in AriaNg while a page resolved).
 */
function PageLoading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '8rem',
        color: 'rgb(var(--mdui-color-primary))',
      }}
      role="status"
      aria-live="polite"
    >
      {/* No `value` means indeterminate, which is mdui's own convention for
          `<mdui-circular-progress>`. */}
      <mdui-circular-progress />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* the shell                                                                  */
/* -------------------------------------------------------------------------- */

export interface AppShellProps {
  /** The routed page, rendered into `<mdui-layout-main>`. */
  children?: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useIsCompactLayout();
  const drawerOpen = useUiStore((state) => state.drawerOpen);

  useRouteChangeReset(location.pathname);

  useEffect(() => {
    setShellNavigate((path: string) => {
      navigate(path);
    });
    return () => {
      setShellNavigate(null);
    };
  }, [navigate]);

  return (
    <>
      <mdui-layout full-height>
        <TopToolbar />

        {/* The full navigation tree is always rendered. Below `md` it is the
            primary navigation; from `md` upwards it stays closed until the
            rail's menu button opens it over the content, which is exactly what
            MD3 prescribes for a modal navigation drawer. */}
        <NavigationDrawer modal open={drawerOpen} />

        {!compact ? <NavigationRail /> : null}

        <mdui-layout-main>
          <Suspense fallback={<PageLoading />}>{children}</Suspense>
        </mdui-layout-main>

        <StatusBar />
      </mdui-layout>

      {/* Overlays live outside <mdui-layout> so they are never clipped by a
          layout item's stacking context. */}
      <ConnectionBanner />
      <SnackbarHost />
    </>
  );
}