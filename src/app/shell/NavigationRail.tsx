/**
 * The navigation rail — the `>= 840px` half of MD3's responsive navigation.
 *
 * A rail has room for the handful of destinations a user moves between, not for
 * the whole tree, so it carries:
 *
 * - the three task lists plus the aria2-next ED2K helper, each with its live
 *   task-count badge;
 * - the settings entries that are a single hop (`AriaNg Settings`,
 *   `Aria2 Status`, and `AriaNg Debug Console` when debug mode is on).
 *
 * The **full** tree (including the ten aria2 option groups) stays reachable
 * through the rail's menu button, which opens the very same navigation drawer
 * used on compact layouts as a modal overlay — which is what MD3 prescribes
 * ("a menu icon at the top of the rail opens a modal navigation drawer").
 *
 * Rail items are rendered as raw `<mdui-navigation-rail-item>` elements rather
 * than through `MduiNavigationRailItem`, because the wrapper exposes no
 * `onClick`: mdui never re-emits `click` as a `CustomEvent`, so the native
 * composed click has to be bound through a ref with `useMduiEvent`.
 */
import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { buildHashUrl } from '../hash-history';
import { isNavItemActive, NAV_DOWNLOAD_ENTRIES, NAV_SETTINGS_ENTRIES } from './NavigationDrawer';
import type { NavBadge } from './NavigationDrawer';
import { useTranslate } from '@/i18n';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import { useUiStore } from '@/store/ui';
import { MduiIcon, useMduiEvent } from '@/ui/mdui';

/* -------------------------------------------------------------------------- */
/* items                                                                      */
/* -------------------------------------------------------------------------- */

interface RailItemProps {
  path: string;
  label: string;
  icon: string;
  activeIcon?: string;
  badge?: number;
  onNavigate: (path: string, event: Event) => void;
}

function RailItem({ path, label, icon, activeIcon, badge, onNavigate }: RailItemProps) {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const active = isNavItemActive(pathname, path);

  useMduiEvent(ref, 'click', (_detail, event) => {
    onNavigate(path, event);
  });

  return (
    /* The icons go into the `icon` / `active-icon` **slots**, never the
       attributes. mdui's `icon` / `active-icon` attributes render
       `<mdui-icon name>`, a Material Icons webfont ligature: the `outline:`
       prefix mdui's font path cannot resolve (it splits variants on `--`, not
       `:`), so clicking a row — which hides `.icon`, shows `.active-icon` and
       animates `.indicator` from 2rem to 3.5rem — left the glyph missing and the
       icon visibly out of place. Both slots are filled because mdui shows one and
       hides the other; see navigation-rail-item-style.js. */
    <mdui-navigation-rail-item
      ref={ref}
      value={path}
      href={buildHashUrl(path)}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
    >
      <MduiIcon name={icon} slot="icon" />
      <MduiIcon name={activeIcon ?? icon} slot="active-icon" />
      <span className="ariang-rail-item-label">{label}</span>
      {badge === undefined || badge <= 0 ? null : (
        <mdui-badge slot="badge">{badge}</mdui-badge>
      )}
    </mdui-navigation-rail-item>
  );
}

/** The rail's menu button: opens the full navigation drawer. */
function RailMenuButton() {
  const t = useTranslate();
  const ref = useRef<HTMLElement>(null);

  useMduiEvent(ref, 'click', () => {
    useUiStore.getState().setDrawer(true);
  });

  return (
    /* `mdui-button-icon` has no icon slot: its default slot *is* the icon
       position, and a filled default slot is what makes it skip the font
       fallback. */
    <mdui-button-icon
      ref={ref}
      slot="top"
      aria-label={t('Toggle Navigation')}
      title={t('Toggle Navigation')}
    >
      <MduiIcon name="menu" />
    </mdui-button-icon>
  );
}

/* -------------------------------------------------------------------------- */
/* the rail                                                                   */
/* -------------------------------------------------------------------------- */

export function NavigationRail() {
  const t = useTranslate();
  const navigate = useNavigate();
  const globalStat = useRpcStore((state) => state.globalStat);
  const debugMode = useSettingsStore((state) => state.session.debugMode);
  const { pathname } = useLocation();

  const onNavigate = (path: string, rawEvent: Event): void => {
    const event = rawEvent as MouseEvent;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    // The href is the real `#!` url; the router still owns the navigation.
    event.preventDefault();
    navigate(path);
  };

  const countOf = (badge: NavBadge | undefined): number => {
    if (!badge) {
      return 0;
    }
    const value = Number(globalStat?.[badge] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const value = NAV_DOWNLOAD_ENTRIES.find((entry) => isNavItemActive(pathname, entry.path))?.path ??
    NAV_SETTINGS_ENTRIES.filter((entry) => entry.type === 'link')
      .find((entry) => isNavItemActive(pathname, entry.path))?.path;

  const singleHopSettings = NAV_SETTINGS_ENTRIES.filter(
    (entry) => entry.type === 'link' && (!('debugOnly' in entry) || !entry.debugOnly || debugMode),
  );

  return (
    <mdui-navigation-rail value={value} alignment="start" divider>
      <RailMenuButton />

      {NAV_DOWNLOAD_ENTRIES.map((entry) => (
        <RailItem
          key={entry.path}
          path={entry.path}
          label={t(entry.labelKey)}
          icon={entry.icon}
          activeIcon={`outline:${entry.icon}`}
          badge={countOf(entry.badge)}
          onNavigate={onNavigate}
        />
      ))}

      {singleHopSettings.map((entry) =>
        entry.type === 'link' ? (
          <RailItem
            key={entry.path}
            path={entry.path}
            label={t(entry.labelKey)}
            icon={entry.icon}
            activeIcon={`outline:${entry.icon}`}
            onNavigate={onNavigate}
          />
        ) : null,
      )}
    </mdui-navigation-rail>
  );
}