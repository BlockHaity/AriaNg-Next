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

/** `/settings/aria2/:group` — built dynamically, listed in the nav drawer. */
export const aria2SettingsRoute = (group: string) => `/settings/aria2/${group}`;

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
