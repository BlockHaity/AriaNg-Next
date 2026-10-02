/**
 * The AriaNg sidebar, 1:1 — and the nav model the rail re-uses.
 *
 * ```
 * Download
 *   /downloading  "Downloading"          (numActive)
 *   /waiting      "Waiting"              (numWaiting)
 *   /stopped      "Finished / Stopped"   (numStopped)
 *   /ed2k/search  "ED2K Search"                       ← aria2-next
 * Settings
 *   /settings/ariang                    "AriaNg Settings"
 *   Aria2 Settings (collapsible, the 10 option groups)
 *   /status  "Aria2 Status" + the live connection label
 *   /debug   "AriaNg Debug Console"     (only with debug mode on)
 * ```
 *
 * ## Active matching
 *
 * AriaNg marked a nav entry active through `data-href-match`: a link is active
 * when the current url **equals** it or continues with a `/`. So
 * `/settings/ariang` stays active on `/settings/ariang/language`, while a link
 * to `/settings` would never swallow `/settings/ariang`. See
 * {@link isNavItemActive}.
 *
 * ## Why every link is an anchor *and* a router navigation
 *
 * `href` carries the real `#!` url — middle-click, "copy link address" and the
 * tests all see the AriaNg url — but the click handler calls `preventDefault()`
 * and hands the navigation to React Router. Letting the browser follow a bare
 * `#!…` fragment moves the address bar without the router ever hearing about it,
 * which is exactly how hash routers lose a navigation.
 */
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { buildHashUrl } from '../hash-history';
import { aria2SettingsRoute, Routes as RoutePaths } from '../route-paths';
import { useTranslate } from '@/i18n';
import { RpcStatus } from '@/config/rpc-constants';
import { OPTION_GROUP_ROUTES } from '@/config/types';
import type { OptionGroupRoute } from '@/config/types';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import { useUiStore } from '@/store/ui';
import {
  MduiCollapse,
  MduiCollapseItem,
  MduiList,
  MduiListItem,
  MduiListSubheader,
  MduiNavigationDrawer,
} from '@/ui/mdui';

/* -------------------------------------------------------------------------- */
/* the model                                                                  */
/* -------------------------------------------------------------------------- */

/** Which `aria2.getGlobalStat` counter decorates a link. */
export type NavBadge = 'numActive' | 'numWaiting' | 'numStopped';

export interface NavLink {
  type: 'link';
  path: string;
  /** i18n key (a literal label when the locale table has no entry yet). */
  labelKey: string;
  icon: string;
  badge?: NavBadge;
  /** Render the live connection status next to the label. */
  connection?: boolean;
  /** Only offered while the session debug mode is on. */
  debugOnly?: boolean;
}

export interface NavCollapseItem {
  path: string;
  labelKey: string;
  icon: string;
}

export interface NavCollapse {
  type: 'collapse';
  labelKey: string;
  icon: string;
  items: readonly NavCollapseItem[];
}

export type NavEntry = NavLink | NavCollapse;

/**
 * TODO(i18n-agent): `ARIA2_GLOBAL_GROUPS[].labelKey` points at `optionGroup.*`
 * keys that the locale tables do not carry yet, so `t()` would echo
 * `optionGroup.basic` back at the user. These are the keys AriaNg actually used
 * — 8 of the 10 exist verbatim; `ed2k` / `media` fall back to their own label
 * until the i18n agent adds them.
 */
const ARIA2_GROUP_LABEL_KEYS: Record<OptionGroupRoute, string> = {
  basic: 'Basic Settings',
  'http-ftp-sftp': 'HTTP/FTP/SFTP Settings',
  http: 'HTTP Settings',
  'ftp-sftp': 'FTP/SFTP Settings',
  bt: 'BitTorrent Settings',
  ed2k: 'ED2K Settings',
  media: 'Media Settings',
  metalink: 'Metalink Settings',
  rpc: 'RPC Settings',
  advanced: 'Advanced Settings',
};

/** Icons per group, chosen to stay inside the app's imported icon set. */
const ARIA2_GROUP_ICONS: Record<OptionGroupRoute, string> = {
  basic: 'tune',
  'http-ftp-sftp': 'public',
  http: 'language',
  'ftp-sftp': 'folder-open',
  bt: 'hub',
  ed2k: 'bolt',
  media: 'movie',
  metalink: 'link',
  rpc: 'dns',
  advanced: 'terminal',
};

/** The 10 aria2 settings pages, in navigation order. */
export const ARIA2_SETTINGS_ITEMS: readonly NavCollapseItem[] = OPTION_GROUP_ROUTES.map((group) => ({
  path: aria2SettingsRoute(group),
  labelKey: ARIA2_GROUP_LABEL_KEYS[group],
  icon: ARIA2_GROUP_ICONS[group],
}));

export const NAV_DOWNLOAD_ENTRIES: readonly NavLink[] = [
  { type: 'link', path: RoutePaths.Downloading, labelKey: 'Downloading', icon: 'download', badge: 'numActive' },
  { type: 'link', path: RoutePaths.Waiting, labelKey: 'Waiting', icon: 'schedule', badge: 'numWaiting' },
  {
    type: 'link',
    path: RoutePaths.Stopped,
    labelKey: 'Finished / Stopped',
    icon: 'archive',
    badge: 'numStopped',
  },
  // aria2-next: the ED2K search helper sits with the task lists because that is
  // where it is used from — it creates a task.
  { type: 'link', path: RoutePaths.Ed2kSearch, labelKey: 'ED2K Search', icon: 'public' },
];

export const NAV_SETTINGS_ENTRIES: readonly NavEntry[] = [
  { type: 'link', path: RoutePaths.AriaNgSettings, labelKey: 'AriaNg Settings', icon: 'settings' },
  {
    type: 'collapse',
    labelKey: 'Aria2 Settings',
    icon: 'tune',
    items: ARIA2_SETTINGS_ITEMS,
  },
  { type: 'link', path: RoutePaths.Status, labelKey: 'Aria2 Status', icon: 'hub', connection: true },
  {
    type: 'link',
    path: RoutePaths.Debug,
    labelKey: 'AriaNg Debug Console',
    icon: 'bug-report',
    debugOnly: true,
  },
];

/**
 * AriaNg's `data-href-match` rule: an entry is active when the current path
 * **equals** it, or continues with a `/`.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/' || href === '') {
    return pathname === '/';
  }
  if (pathname === href) {
    return true;
  }
  return pathname.startsWith(href.endsWith('/') ? href : `${href}/`);
}

/* -------------------------------------------------------------------------- */
/* connection status                                                          */
/* -------------------------------------------------------------------------- */

/**
 * MD3 role per connection status.
 *
 * MD3 has no `success` role, so `Connected` uses `tertiary` — the same
 * substitution mdui's own components make for non-error tones. The rest map
 * onto `primary`, `on-surface-variant` and `error`.
 */
export function connectionTone(status: RpcStatus): string {
  switch (status) {
    case RpcStatus.Connecting:
    case RpcStatus.Reconnecting:
      return 'primary';
    case RpcStatus.WaitingToReconnect:
      return 'on-surface-variant';
    case RpcStatus.Connected:
      return 'tertiary';
    case RpcStatus.Disconnected:
    default:
      return 'error';
  }
}

/* -------------------------------------------------------------------------- */
/* rows                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Builds the click handler for one nav link.
 *
 * Ctrl/cmd/shift-click and a non-primary button keep the browser's own
 * behaviour (new tab / new window), everything else is a router navigation.
 *
 * The event is mdui's *native* click (mdui never re-emits `click` as a
 * `CustomEvent`), so the DOM `MouseEvent` is used directly.
 */
function useNavClick(modal: boolean) {
  const navigate = useNavigate();

  return (path: string) => (rawEvent: Event) => {
    const event = rawEvent as MouseEvent;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    navigate(path);
    if (modal) {
      // A modal drawer covers the page it just navigated to.
      useUiStore.getState().setDrawer(false);
    }
  };
}

function ConnectionLabel({ status }: { status: RpcStatus }) {
  const t = useTranslate();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: '0.5rem',
        padding: '0 0.5rem',
        borderRadius: 'var(--mdui-shape-corner-small)',
        font: 'var(--mdui-typescale-label-small-font)',
        color: `rgb(var(--mdui-color-${connectionTone(status)}))`,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'rgb(var(--mdui-color-outline-variant))',
      }}
    >
      {t(status)}
    </span>
  );
}

function NavLinkRow({ entry, modal }: { entry: NavLink; modal: boolean }) {
  const t = useTranslate();
  const onClick = useNavClick(modal);
  const { pathname } = useLocation();
  const globalStat = useRpcStore((state) => state.globalStat);
  const status = useRpcStore((state) => state.connection.status);

  const count = entry.badge ? Number(globalStat?.[entry.badge] ?? 0) : 0;

  return (
    <MduiListItem
      href={buildHashUrl(entry.path)}
      active={isNavItemActive(pathname, entry.path)}
      onClick={onClick(entry.path)}
    >
      <span>{t(entry.labelKey)}</span>
      {/* AriaNg appended the live count in parentheses, and only when there is
          something to report — a "Downloading (0)" row is noise. */}
      {entry.badge && count > 0 ? <span>{` (${count})`}</span> : null}
      {entry.connection ? <ConnectionLabel status={status} /> : null}
    </MduiListItem>
  );
}

/* -------------------------------------------------------------------------- */
/* the drawer                                                                 */
/* -------------------------------------------------------------------------- */

export interface NavigationDrawerProps {
  open: boolean;
  /** `true` below the `md` breakpoint: the drawer overlays the content. */
  modal: boolean;
}

export function NavigationDrawer({ open, modal }: NavigationDrawerProps) {
  const t = useTranslate();
  const onClick = useNavClick(modal);
  const { pathname } = useLocation();
  const debugMode = useSettingsStore((state) => state.session.debugMode);

  const settingsEntries = useMemo(
    () =>
      NAV_SETTINGS_ENTRIES.filter(
        (entry) => entry.type !== 'link' || !entry.debugOnly || debugMode,
      ),
    [debugMode],
  );

  return (
    <MduiNavigationDrawer
      className="ariang-nav-drawer"
      modal={modal}
      open={open}
      closeOnEsc
      closeOnOverlayClick
    >
      <MduiList>
        <MduiListSubheader>{t('Download')}</MduiListSubheader>
        {NAV_DOWNLOAD_ENTRIES.map((entry) => (
          <NavLinkRow key={entry.path} entry={entry} modal={modal} />
        ))}

        <MduiListSubheader>{t('Settings')}</MduiListSubheader>
        {settingsEntries.map((entry) =>
          entry.type === 'link' ? (
            <NavLinkRow key={entry.path} entry={entry} modal={modal} />
          ) : (
            <MduiCollapse key={entry.labelKey} variant="accordion">
              <MduiCollapseItem
                value={entry.labelKey}
                header={<span style={{ display: 'flex', minHeight: '2.75rem', alignItems: 'center' }}>{t(entry.labelKey)}</span>}
              >
                {entry.items.map((item) => (
                  <MduiListItem
                    key={item.path}
                    href={buildHashUrl(item.path)}
                    active={isNavItemActive(pathname, item.path)}
                    onClick={onClick(item.path)}
                  >
                    {t(item.labelKey)}
                  </MduiListItem>
                ))}
              </MduiCollapseItem>
            </MduiCollapse>
          ),
        )}
      </MduiList>
    </MduiNavigationDrawer>
  );
}