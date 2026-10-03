/**
 * Navigation rail tests.
 *
 * The rail renders **raw** `<mdui-navigation-rail-item>` elements rather than
 * going through `MduiNavigationRailItem`, because the wrapper exposes no
 * `onClick`: mdui never re-emits `click` as a `CustomEvent`, so the native
 * composed click has to be bound through a ref with `useMduiEvent`.
 *
 * That bypass is exactly why the rail kept rendering icons the webfont way, and
 * why the misplacement only showed up *after a click*:
 *
 *   - `mdui-navigation-rail-item` takes the icon through an `icon` /
 *     `active-icon` **slot** as well as through attributes; the attributes are the
 *     Material Icons webfont path.
 *   - The rail's `activeIcon` is `outline:<name>` — a spelling only the SVG set
 *     understands. mdui-icon splits font variants on `--`, not `:`, so the font
 *     path could not resolve it at all.
 *   - Clicking a row sets `active`, which hides `.icon`, shows `.active-icon`, and
 *     animates `.indicator` from 2rem to 3.5rem. With the attribute path the glyph
 *     for the active state was missing while its 1.5rem box was still reserved, so
 *     the icon visibly jumped.
 *
 * These tests assert the light DOM the rail produces, which is the part that was
 * wrong.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n';
import { useSettingsStore } from '@/store/settings';
import { useUiStore } from '@/store/ui';
import { DEFAULT_ROUTE, Routes as RoutePaths } from '../route-paths';
import { buildHashUrl, createHashBangHistory } from '../hash-history';
import { unstable_HistoryRouter as HistoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { NAV_DOWNLOAD_ENTRIES, NAV_SETTINGS_ENTRIES } from '../shell/NavigationDrawer';
import type { NavLink } from '../shell/NavigationDrawer';
import { NavigationRail } from '../shell/NavigationRail';
import { aria2SettingsRoute, aria2SettingsSectionRoute } from '../route-paths';

type HistoryRouterHistory = ComponentProps<typeof HistoryRouter>['history'];

function renderRail(hash = `#!${DEFAULT_ROUTE}`) {
  window.location.hash = hash;
  return render(
    <I18nProvider>
      <HistoryRouter history={createHashBangHistory() as unknown as HistoryRouterHistory}>
        <NavigationRail />
      </HistoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  useUiStore.setState({ drawerOpen: false });
  useSettingsStore.getState().hydrate();
  window.location.hash = `#!${DEFAULT_ROUTE}`;
});

/**
 * The rail rows, in document order.
 *
 * Identified by their visible label rather than by `value`: React 19 writes
 * `value` as a property on a custom element, so it is not readable back off the
 * attribute map.
 */
function railItems(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('mdui-navigation-rail-item')];
}

/**
 * The settings rows the rail shows: the single-hop `link` entries, minus the
 * debug-only one while debug mode is off — the same filter the rail applies.
 */
function singleHopSettings(): NavLink[] {
  return NAV_SETTINGS_ENTRIES.filter(
    (entry): entry is NavLink => entry.type === 'link' && (!('debugOnly' in entry) || !entry.debugOnly),
  );
}

/**
 * The rows the rail is expected to render, in the order it renders them.
 *
 * The aria2 settings section sits between the task lists and the other settings
 * links — it is the one `NAV_SETTINGS_ENTRIES` models as a `collapse`, so the rail
 * carries it as a plain row pointing at the first group.
 *
 * Matched positionally rather than by label: comparing against a translated string
 * would mean calling `useTranslate` from outside a component, and `value` / `href`
 * are written as DOM properties by React 19, so neither is readable from the
 * attribute map.
 */
function expectedPaths(): string[] {
  return [
    ...NAV_DOWNLOAD_ENTRIES.map((entry) => entry.path),
    aria2SettingsSectionRoute,
    ...singleHopSettings().map((entry) => entry.path),
  ];
}

/** The row for `path`, by position. */
function rowFor(container: HTMLElement, path: string): Element {
  const rows = railItems(container);
  const index = expectedPaths().indexOf(path);
  const row = index >= 0 ? rows[index] : undefined;
  if (!row) throw new Error(`no rail row for ${path}`);
  return row;
}

describe('NavigationRail icons', () => {
  it('renders a row per navigation entry', () => {
    const { container } = renderRail();
    // The rail is deliberately shallower than the drawer: only the single-hop
    // settings links appear here, the ten aria2 option groups live behind the
    // rail's menu button in the drawer.
    expect(railItems(container).length).toBe(expectedPaths().length);
  });

  it('projects the icon into the icon slot, never the attribute', () => {
    const { container } = renderRail();
    for (const item of railItems(container)) {
      expect(item.hasAttribute('icon'), 'the `icon` attribute is the webfont path').toBe(false);
      expect(item.hasAttribute('active-icon')).toBe(false);
      const slotted = item.querySelector('[slot="icon"]');
      expect(slotted, 'the icon must be projected into the icon slot').not.toBeNull();
      expect(slotted?.tagName.toLowerCase()).toMatch(/^mdui-icon-/);
    }
  });

  it('fills the active-icon slot too, since clicking swaps which one shows', () => {
    const { container } = renderRail();
    for (const item of railItems(container)) {
      const active = item.querySelector('[slot="active-icon"]');
      expect(active, 'mdui hides `.icon` and shows `.active-icon` when active').not.toBeNull();
      expect(active?.tagName.toLowerCase()).toMatch(/^mdui-icon-/);
    }
  });

  it('uses the outlined SVG variant for the active state', () => {
    const { container } = renderRail();
    // `outline:<name>` is the app's own spelling for the outlined SVG variant; the
    // font path could not resolve it at all, which is why the active icon used to
    // come out empty.
    const actives = [...container.querySelectorAll('[slot="active-icon"]')];
    expect(actives.length).toBeGreaterThan(0);
    for (const element of actives) {
      expect(element.tagName.toLowerCase()).toMatch(/^mdui-icon-[a-z0-9-]+--outlined$/);
    }
  });

  it('keeps the filled and outlined icons a matched pair', () => {
    const { container } = renderRail();
    for (const item of railItems(container)) {
      const base = item.querySelector('[slot="icon"]')!.tagName.toLowerCase().replace(/^mdui-icon-/, '');
      const outlined = item
        .querySelector('[slot="active-icon"]')!
        .tagName.toLowerCase()
        .replace(/^mdui-icon-/, '')
        .replace(/--outlined$/, '');
      expect(outlined, `row ${base} has a mismatched active icon`).toBe(base);
    }
  });

  it('projects the menu button icon into the default slot of mdui-button-icon', () => {
    const { container } = renderRail();
    const button = container.querySelector('mdui-button-icon')!;
    expect(button.hasAttribute('icon')).toBe(false);
    expect(button.querySelector('mdui-icon-menu')).not.toBeNull();
  });

  it('still links each row to its hash-bang URL', () => {
    const { container } = renderRail();
    for (const path of expectedPaths()) {
      // `href` is read as a property: React 19 writes it as one on a custom
      // element, so it is not in the attribute map.
      const row = rowFor(container, path) as Element & { href?: string };
      expect(row.href ?? row.getAttribute('href')).toBe(buildHashUrl(path));
    }
  });

  it('marks the row for the current route as the current page', () => {
    const { container } = renderRail(`#!${RoutePaths.Waiting}`);
    expect(rowFor(container, RoutePaths.Waiting).getAttribute('aria-current')).toBe('page');
    expect(rowFor(container, RoutePaths.Downloading).hasAttribute('aria-current')).toBe(false);
  });

  it('carries a row for the aria2 settings section, between the lists and settings', () => {
    const { container } = renderRail();
    const labels = railItems(container).map((item) => item.getAttribute('aria-label'));

    expect(labels).toContain('Aria2 Settings');
    // Position is the point: the section row must not displace the other settings
    // links, which the positional match in `rowFor` also relies on.
    expect(labels.indexOf('Aria2 Settings')).toBe(NAV_DOWNLOAD_ENTRIES.length);
  });

  it('keeps the aria2 section row selected on every group', () => {
    for (const group of ['basic', 'http-ftp-sftp', 'bt', 'ed2k', 'advanced'] as const) {
      const { container } = renderRail(`#!${aria2SettingsRoute(group)}`);
      const selected = railItems(container)
        .filter((item) => item.hasAttribute('aria-current'))
        .map((item) => item.getAttribute('aria-label'));
      expect(selected, group).toEqual(['Aria2 Settings']);
    }
  });
});
