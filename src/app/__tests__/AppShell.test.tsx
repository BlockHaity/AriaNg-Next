/**
 * Tests for the MD3 layout scaffold.
 *
 * ## The mdui elements are deliberately left inert
 *
 * `vi.hoisted` runs before any import, so mdui's `customElements.define` calls are
 * intercepted and every `mdui-*` tag stays an unknown element. Two reasons:
 *
 * 1. jsdom has neither a layout engine nor the Web Animations API, so mdui's Lit
 *    lifecycle (floating-ui positioning, drawer animation, `focusElement` lookups)
 *    rejects asynchronously and drowns the run in unhandled errors that have
 *    nothing to do with the shell;
 * 2. what the shell is responsible for is *the output it produces* — which tags,
 *    which attributes, which slot content — and that is exactly what is asserted
 *    here. The wrapper layer that turns those attributes into mdui properties is
 *    covered by `src/ui/__tests__`.
 *
 * The stores are the real ones, seeded through `setState` rather than replaced with
 * mocks: "a route change drops the task list and the selection" is an interaction
 * between the shell and those stores, and a mock would only prove that the mock was
 * called.
 */
vi.hoisted(() => {
  const original = customElements.define.bind(customElements);
  customElements.define = ((
    name: string,
    constructor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void => {
    if (name.startsWith('mdui-')) {
      return;
    }
    original(name, constructor, options);
  }) as typeof customElements.define;
});

import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { unstable_HistoryRouter as HistoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { I18nProvider } from '@/i18n';
import { DEFAULT_ROUTE, Routes as RoutePaths, aria2SettingsRoute } from '../route-paths';
import { createHashBangHistory } from '../hash-history';
import { AppShell } from '../shell';
import type { NormalizedTask } from '@/domain/types';
import { RpcStatus } from '@/config/rpc-constants';
import { OPTION_GROUP_ROUTES } from '@/config/types';
import { useRpcStore } from '@/store/rpc-store';
import { useSelectionStore } from '@/store/selection';
import { useSettingsStore } from '@/store/settings';
import { useTasksStore } from '@/store/tasks';
import { useUiStore } from '@/store/ui';

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

/** Written by {@link TestOutlet}; lets a test drive the router. */
let navigate: (to: string) => void = () => {};
let currentPath = '/';

/**
 * A stand-in for `<AppRoutes />`: one route, plus a hook that lets the test drive
 * the router.
 *
 * The router is assembled here out of `createHashBangHistory()` instead of being
 * imported from `../router`, because that module also pulls in the lazy page
 * chunks — which do not exist until the page agents land them, and a missing chunk
 * fails Vite's import analysis at *transform* time rather than at runtime.
 */
function TestOutlet() {
  const routerNavigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    navigate = (to: string) => {
      routerNavigate(to);
    };
    currentPath = location.pathname;
  }, [location.pathname, routerNavigate]);

  return <span data-testid="outlet">{location.pathname}</span>;
}

/**
 * React Router keeps its `History` interface unexported (and its `Action` enum
 * nominally distinct), so the hand-written history is bridged to it once — exactly
 * as `HashBangRouter` does for the real app.
 */
type HistoryRouterHistory = ComponentProps<typeof HistoryRouter>['history'];

function TestRouter({ children }: { children?: ReactNode }) {
  return (
    <HistoryRouter history={createHashBangHistory() as unknown as HistoryRouterHistory}>{children}</HistoryRouter>
  );
}

function renderShell(hash = `#!${DEFAULT_ROUTE}`) {
  window.location.hash = hash;
  return render(
    <I18nProvider>
      <TestRouter>
        <AppShell>
          <TestOutlet />
        </AppShell>
      </TestRouter>
    </I18nProvider>,
  );
}

/* --- DOM probes ----------------------------------------------------------- */

/**
 * `open` is the one piece of mdui state the shell writes as a **property**
 * (`useMduiProperty`), so it is read as an expando. Everything else React writes as
 * an attribute, and a boolean attribute is present when true, absent when false.
 */
interface MduiOverlay extends HTMLElement {
  open?: boolean;
}

/** Every `<mdui-list-item>` the shell rendered, with its `#!` href. */
function navLinks(container: HTMLElement): { href: string; text: string; active: boolean }[] {
  return [...container.querySelectorAll('mdui-list-item')].map((element) => ({
    href: element.getAttribute('href') ?? '',
    text: element.textContent ?? '',
    active: element.hasAttribute('active'),
  }));
}

/** The nav row for one route. */
function navLink(container: HTMLElement, path: string): HTMLElement | undefined {
  return [...container.querySelectorAll('mdui-list-item')].find(
    (element) => element.getAttribute('href') === `#!${path}`,
  );
}

function iconButton(container: HTMLElement, label: string): Element | null {
  return container.querySelector(`mdui-button-icon[aria-label="${label}"]`);
}

function isDisabled(element: Element | null | undefined): boolean {
  return !!element && element.hasAttribute('disabled');
}

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
}

function fakeTask(gid: string, overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    gid,
    taskName: `task-${gid}`,
    status: 'active',
    totalLength: 100,
    completedLength: 0,
    completePercent: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    remainLength: 100,
    remainPercent: 100,
    connections: 0,
    errorCode: 0,
    files: [],
    trackers: [],
    seeders: false,
    idle: false,
    hasTaskName: true,
    ...overrides,
  } as unknown as NormalizedTask;
}

beforeEach(() => {
  setViewport(1024);
  useUiStore.setState({ drawerOpen: false, searchText: '', keyActions: {}, swipeActions: {} });
  useSelectionStore.setState({ selected: {}, enabled: false });
  useTasksStore.setState({ list: [], byGid: {} });
  useSettingsStore.getState().setSessionDebugMode(false);
  useRpcStore.setState({ connection: { status: RpcStatus.Connected, attempt: 0 }, globalStat: undefined });
  window.location.hash = `#!${DEFAULT_ROUTE}`;
});

/* -------------------------------------------------------------------------- */
/* layout                                                                     */
/* -------------------------------------------------------------------------- */

describe('AppShell layout', () => {
  it('renders the MD3 scaffold inside <mdui-layout>', () => {
    const { container } = renderShell();

    const layout = container.querySelector('mdui-layout');
    expect(layout).not.toBeNull();

    // The pieces of MD3's canonical responsive navigation.
    expect(layout?.querySelector('mdui-top-app-bar')).not.toBeNull();
    expect(layout?.querySelector('mdui-navigation-drawer')).not.toBeNull();
    expect(layout?.querySelector('mdui-layout-main')).not.toBeNull();
    expect(layout?.querySelector('mdui-bottom-app-bar')).not.toBeNull();

    // The page outlet lives inside <mdui-layout-main>.
    const main = layout?.querySelector('mdui-layout-main');
    expect(main?.querySelector('[data-testid="outlet"]')?.textContent).toBe(DEFAULT_ROUTE);
  });

  it('uses the rail as the primary navigation on a wide viewport', () => {
    const { container } = renderShell();
    // jsdom reports 1024px, i.e. `>= md`: the rail carries the destinations and
    // the drawer stays closed until the rail's menu button opens it.
    expect(container.querySelector('mdui-navigation-rail')).not.toBeNull();
    expect(container.querySelector<MduiOverlay>('mdui-navigation-drawer')?.open).toBe(false);
  });

  it('uses a modal drawer and hides the rail on a compact viewport', () => {
    setViewport(480);
    const { container } = renderShell();

    expect(container.querySelector('mdui-navigation-rail')).toBeNull();
    expect(container.querySelector('mdui-navigation-drawer')?.hasAttribute('modal')).toBe(true);
    // AriaNg's `hidden-xs` search box.
    expect(container.querySelector('mdui-top-app-bar mdui-text-field')).toBeNull();
  });

  it('shows the search box on a wide viewport', () => {
    const { container } = renderShell();
    expect(container.querySelector('mdui-top-app-bar mdui-text-field')).not.toBeNull();
  });

  it('marks itself mounted for the snackbar host', () => {
    renderShell();
    expect(useUiStore.getState().snackbarHost).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* navigation tree                                                            */
/* -------------------------------------------------------------------------- */

describe('AppShell navigation tree', () => {
  it('contains every AriaNg destination', () => {
    const { container } = renderShell();
    const hrefs = navLinks(container).map((link) => link.href);

    for (const path of [
      RoutePaths.Downloading,
      RoutePaths.Waiting,
      RoutePaths.Stopped,
      RoutePaths.Ed2kSearch,
      RoutePaths.AriaNgSettings,
      RoutePaths.Status,
    ]) {
      expect(hrefs).toContain(`#!${path}`);
    }

    // All ten aria2 option groups.
    for (const group of OPTION_GROUP_ROUTES) {
      expect(hrefs).toContain(`#!${aria2SettingsRoute(group)}`);
    }
  });

  it('labels the tree with the AriaNg names', () => {
    const { container } = renderShell();
    const text = navLinks(container)
      .map((link) => link.text)
      .join(' | ');

    expect(text).toContain('Downloading');
    expect(text).toContain('Waiting');
    expect(text).toContain('Finished / Stopped');
    expect(text).toContain('AriaNg Settings');
    expect(text).toContain('Aria2 Status');
    expect(text).toContain('Basic Settings');
    expect(text).toContain('Advanced Settings');
  });

  it('offers the debug console only while debug mode is on', () => {
    const { container, unmount } = renderShell();
    expect(navLinks(container).map((link) => link.href)).not.toContain(`#!${RoutePaths.Debug}`);
    unmount();

    useSettingsStore.getState().setSessionDebugMode(true);
    const second = renderShell();
    expect(navLinks(second.container).map((link) => link.href)).toContain(`#!${RoutePaths.Debug}`);
  });

  it('shows the live task counts from globalStat', () => {
    useRpcStore.setState({ globalStat: { numActive: 3, numWaiting: 2, numStopped: 1 } as never });
    const { container } = renderShell();
    const text = navLinks(container)
      .map((link) => link.text)
      .join(' | ');

    expect(text).toContain('Downloading (3)');
    expect(text).toContain('Waiting (2)');
    expect(text).toContain('Finished / Stopped (1)');
  });

  it('marks the current route active, with AriaNg prefix matching', () => {
    const { container } = renderShell(`#!${RoutePaths.Downloading}`);
    const links = navLinks(container);

    expect(links.find((link) => link.href === `#!${RoutePaths.Downloading}`)?.active).toBe(true);
    expect(links.find((link) => link.href === `#!${RoutePaths.Waiting}`)?.active).toBe(false);
    // `/downloading` must not swallow a longer path.
    expect(links.find((link) => link.href === `#!${RoutePaths.Ed2kSearch}`)?.active).toBe(false);
  });

  it('keeps a settings parent active on its extended child (data-href-match)', () => {
    const { container } = renderShell(`#!${RoutePaths.AriaNgSettings}/language`);
    const links = navLinks(container);

    expect(links.find((link) => link.href === `#!${RoutePaths.AriaNgSettings}`)?.active).toBe(true);
  });

  it('marks the active aria2 settings group', () => {
    const { container } = renderShell(`#!${aria2SettingsRoute('bt')}`);
    const links = navLinks(container);

    expect(links.find((link) => link.href === `#!${aria2SettingsRoute('bt')}`)?.active).toBe(true);
    expect(links.find((link) => link.href === `#!${aria2SettingsRoute('http')}`)?.active).toBe(false);
  });

  it('shows the connection state next to Aria2 Status', () => {
    useRpcStore.setState({ connection: { status: RpcStatus.Reconnecting, attempt: 2 } });
    const { container } = renderShell();

    expect(navLink(container, RoutePaths.Status)?.textContent).toContain('Reconnecting');
  });

  it('navigates through the router and keeps the `#!` url', () => {
    const { container } = renderShell();
    const waiting = navLink(container, RoutePaths.Waiting) as HTMLElement;

    act(() => {
      fireEvent.click(waiting);
    });

    expect(currentPath).toBe(RoutePaths.Waiting);
    expect(window.location.hash).toBe('#!/waiting');
  });

  it('closes the modal drawer after navigating from it', () => {
    setViewport(480);
    const { container } = renderShell();
    const waiting = navLink(container, RoutePaths.Waiting) as HTMLElement;

    act(() => {
      useUiStore.getState().setDrawer(true);
    });
    act(() => {
      fireEvent.click(waiting);
    });

    expect(useUiStore.getState().drawerOpen).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* route change                                                               */
/* -------------------------------------------------------------------------- */

describe('AppShell route change', () => {
  it('drops the task list, the selection and the per-page registrations', () => {
    useTasksStore.setState({
      list: [fakeTask('a'), fakeTask('b')],
      byGid: { a: fakeTask('a'), b: fakeTask('b') },
    });
    useSelectionStore.setState({ selected: { a: true }, enabled: true });
    useUiStore.setState({
      keyActions: { selectAll: () => {} },
      swipeActions: { extendLeftSwipe: () => false },
    });

    renderShell();

    // Exactly what AriaNg's `$locationChangeStart` did.
    act(() => {
      navigate(RoutePaths.Stopped);
    });

    expect(useTasksStore.getState().list).toEqual([]);
    expect(useSelectionStore.getState().selected).toEqual({});
    expect(useUiStore.getState().keyActions).toEqual({});
    expect(useUiStore.getState().swipeActions).toEqual({});
  });

  it('closes every open dialog', () => {
    renderShell();

    const dialog = document.createElement('mdui-dialog') as MduiOverlay;
    dialog.open = true;
    document.body.appendChild(dialog);

    act(() => {
      navigate(RoutePaths.Waiting);
    });

    expect(dialog.open).toBe(false);
    dialog.remove();
  });

  it('keeps the drawer state and the search text (shell state, not page state)', () => {
    useUiStore.setState({ drawerOpen: true, searchText: 'ubuntu' });
    renderShell();

    act(() => {
      navigate(RoutePaths.Stopped);
    });

    expect(useUiStore.getState().drawerOpen).toBe(true);
    expect(useUiStore.getState().searchText).toBe('ubuntu');
  });

  it('does not reset on the first render (a page registers its own handlers)', () => {
    useUiStore.setState({ keyActions: { selectAll: () => {} } });
    renderShell();
    expect(useUiStore.getState().keyActions.selectAll).toBeTypeOf('function');
  });
});

/* -------------------------------------------------------------------------- */
/* toolbar                                                                    */
/* -------------------------------------------------------------------------- */

describe('AppShell toolbar', () => {
  it('disables Start / Pause / Select All until the list justifies them', () => {
    const { container } = renderShell();

    // No tasks at all: nothing is actionable.
    expect(isDisabled(iconButton(container, 'Start'))).toBe(true);
    expect(isDisabled(iconButton(container, 'Pause'))).toBe(true);
    expect(isDisabled(iconButton(container, 'Select All'))).toBe(true);
  });

  it('enables Start for a paused task and keeps Pause disabled', () => {
    useTasksStore.setState({ list: [fakeTask('a', { status: 'paused' })] });
    useSelectionStore.setState({ selected: { a: true }, enabled: true });

    const { container } = renderShell();

    expect(isDisabled(iconButton(container, 'Start'))).toBe(false);
    expect(isDisabled(iconButton(container, 'Pause'))).toBe(true);
  });

  it('enables Pause for an active task and keeps Start disabled', () => {
    useTasksStore.setState({ list: [fakeTask('a', { status: 'active' })] });
    useSelectionStore.setState({ selected: { a: true }, enabled: true });

    const { container } = renderShell();

    expect(isDisabled(iconButton(container, 'Pause'))).toBe(false);
    expect(isDisabled(iconButton(container, 'Start'))).toBe(true);
  });

  it('enables Select All once the list has rows', () => {
    useTasksStore.setState({ list: [fakeTask('a')] });
    useSelectionStore.setState({ selected: {}, enabled: true });

    const { container } = renderShell();

    expect(isDisabled(iconButton(container, 'Select All'))).toBe(false);
  });

  it('offers "Remove Task" and "Clear Stopped Tasks" in the delete menu', () => {
    const { container } = renderShell();
    const items = [...container.querySelectorAll('mdui-top-app-bar mdui-menu-item')].map(
      (item) => item.textContent?.trim() ?? '',
    );

    expect(items).toContain('Remove Task');
    expect(items).toContain('Clear Stopped Tasks');
  });

  it('links Help to the AriaNg project page', () => {
    const { container } = renderShell();
    const help = [...container.querySelectorAll('mdui-button')].find(
      (button) => button.getAttribute('href') === 'https://github.com/mayswind/AriaNg',
    );

    expect(help).toBeDefined();
    expect(help?.getAttribute('target')).toBe('_blank');
  });
});

/* -------------------------------------------------------------------------- */
/* display order                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The toolbar renders two menus (remove / clear and display order) and the status
 * bar a third. The display-order menu is the only one with seven entries, which is
 * exactly the invariant under test.
 */
function displayOrderMenu(container: HTMLElement): Element {
  const found = [...container.querySelectorAll('mdui-top-app-bar mdui-menu')].find(
    (menu) => menu.querySelectorAll('mdui-menu-item').length === 7,
  );
  if (!found) {
    throw new Error('the display-order menu was not rendered');
  }
  return found;
}

describe('AppShell display order menu', () => {
  it('lists exactly the seven AriaNg entries', () => {
    const { container } = renderShell();
    const items = [...displayOrderMenu(container).querySelectorAll('mdui-menu-item')].map(
      (item) => item.textContent?.trim() ?? '',
    );

    expect(items).toEqual([
      'Default',
      'By File Name',
      'By File Size',
      'By Progress',
      'By Remaining',
      'By Download Speed',
      'By Upload Speed',
    ]);
  });

  it('puts a check mark on the active type only', () => {
    const { container } = renderShell();
    const items = [...displayOrderMenu(container).querySelectorAll('mdui-menu-item')];

    // The check mark is the icon mdui projects into the row's leading `icon`
    // slot. It is deliberately *not* the `icon` attribute: that attribute is
    // font-only (it renders `<mdui-icon name>`, which needs the Material Icons
    // webfont) and would show the literal word "check" instead of a tick.
    const checked = items.filter((item) => item.querySelector('mdui-icon-check[slot="icon"]'));

    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent?.trim()).toBe('Default');
  });
});
/* -------------------------------------------------------------------------- */
/* theme                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Dark mode was reported as missing. The machinery was all present — mdui's
 * `mdui-theme-*` class, `setTheme()`, the `prefers-color-scheme` resolution — but
 * with the default pinned to `light` and the only control buried in
 * Settings → AriaNg → Global, there was nothing on screen to find.
 *
 * These tests pin the two things that were actually wrong: the default follows
 * the OS, and the toolbar carries a switch that writes through the same
 * `setTheme()` single write path everything else uses.
 */
describe('AppShell theme switch', () => {
  /** The mdui theme classes mdui's `setTheme` maintains on `<html>`. */
  function themeClasses(): string[] {
    return [...document.documentElement.classList].filter((name) => name.startsWith('mdui-theme-'));
  }

  function themeButton(container: HTMLElement): Element {
    const found = [...container.querySelectorAll('mdui-top-app-bar mdui-button-icon')].find(
      (button) => button.querySelector('mdui-icon-light-mode, mdui-icon-dark-mode, mdui-icon-contrast'),
    );
    if (!found) throw new Error('the theme switch was not rendered');
    return found;
  }

  it('ships a theme switch in the top app bar', () => {
    const { container } = renderShell();
    expect(themeButton(container)).toBeTruthy();
  });

  it('cycles light → dark → system and writes each step to the store', () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, theme: 'light' } }));
    const { container } = renderShell();

    // Boot applies the class (`BootstrapGate` does that in the real app), so the
    // first assertion here is about what a click writes, not the initial state.
    fireEvent.click(themeButton(container));
    expect(useSettingsStore.getState().settings.theme).toBe('dark');
    expect(themeClasses()).toEqual(['mdui-theme-dark']);

    fireEvent.click(themeButton(container));
    expect(useSettingsStore.getState().settings.theme).toBe('system');
    expect(themeClasses()).toEqual(['mdui-theme-auto']);

    // The cycle wraps rather than sticking at the end.
    fireEvent.click(themeButton(container));
    expect(useSettingsStore.getState().settings.theme).toBe('light');
    expect(themeClasses()).toEqual(['mdui-theme-light']);
  });

  it('emits themechange so token-driven charts restyle with the switch', () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, theme: 'light' } }));
    const { container } = renderShell();

    const seen: string[] = [];
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<{ setting: string }>).detail.setting);
    };
    window.addEventListener('themechange', listener);

    fireEvent.click(themeButton(container));
    window.removeEventListener('themechange', listener);

    expect(seen).toContain('dark');
  });
});
