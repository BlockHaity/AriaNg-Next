/**
 * Route table — the single source of truth for every URL in the app.
 *
 * The `#!` prefix is part of the public contract: AriaNg's documented
 * command-line API URLs (`#!/new/task?url=…`, `#!/settings/rpc/set?…`)
 * must keep working, so the hash history is mounted at `#!/`.
 */

export const HASH_BANG = '#!';

export const Routes = {
  Downloading: '/downloading',
  Waiting: '/waiting',
  Stopped: '/stopped',
  New: '/new',
  NewCommand: '/new/task',
  TaskDetail: '/task/detail/:gid',
  AriaNgSettings: '/settings/ariang',
  AriaNgSettingsExtended: '/settings/ariang/:extendType',
  RpcSetCommand: '/settings/rpc/set',
  RpcSetCommandFull: '/settings/rpc/set/:protocol/:host/:port/:interface/:secret',
  Debug: '/debug',
  Status: '/status',
  Ed2kSearch: '/ed2k/search',
} as const;

/**
 * The ten aria2 option groups, in the order AriaNg listed them.
 *
 * Re-exported from `@/config/types` rather than redeclared: the drawer's collapse,
 * the settings page's switcher and `ARIA2_GLOBAL_GROUPS` all have to agree about
 * which groups exist, and a second copy of this array is exactly how they stop
 * agreeing.
 */
export { OPTION_GROUP_ROUTES } from '@/config/types';
export type { OptionGroupRoute } from '@/config/types';

/** The group the aria2 settings section opens on. */
export const DEFAULT_ARIA2_GROUP = 'basic' as const;

/** `/settings/aria2/:group` — built dynamically, listed in the nav drawer. */
export const aria2SettingsRoute = (group: string) => `/settings/aria2/${group}`;

/** The shared `/settings/aria2` prefix every group route sits under. */
export const ARIA2_SETTINGS_SECTION_PREFIX = '/settings/aria2';

/** Where the "Aria2 Settings" navigation entry points when no group is chosen. */
export const aria2SettingsSectionRoute = aria2SettingsRoute(DEFAULT_ARIA2_GROUP);

/**
 * Is this pathname somewhere inside the aria2 settings section?
 *
 * The section spans ten sibling routes, so a navigation entry pointing at one of
 * them (the rail row points at the default group) has to claim all of them or it
 * stops being highlighted the moment the user picks a different group.
 */
export function isAria2SettingsPath(pathname: string): boolean {
  return pathname === ARIA2_SETTINGS_SECTION_PREFIX || pathname.startsWith(`${ARIA2_SETTINGS_SECTION_PREFIX}/`);
}

export const DEFAULT_ROUTE = Routes.Downloading;

/** Builds an absolute in-app url, including the `#!` prefix. */
export function appUrl(path: string, query?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, value);
  }
  const search = params.toString();
  return `${HASH_BANG}${path}${search ? `?${search}` : ''}`;
}

/** Strips everything from `#` onwards — used to build command API urls. */
export function stripHash(href: string): string {
  const index = href.indexOf('#');
  return index >= 0 ? href.slice(0, index) : href;
}

/**
 * Base url used by the "Export Command API" dialog. Resolved relative to the
 * document so it works from any sub-path and from `file://`.
 */
export function basePageUrl(): string {
  if (typeof window === 'undefined') return '/';
  const { protocol, host, pathname, search } = window.location;
  if (protocol === 'file:') return stripHash(window.location.href);
  return `${protocol}//${host}${pathname}${search}`;
}
