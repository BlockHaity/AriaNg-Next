/**
 * The `#!` (hashbang) history adapter.
 *
 * ## Why this file exists
 *
 * AriaNg ran AngularJS in `hashPrefix('!')` mode, so **every** documented URL in
 * its README looks like `#!/downloading` or `#!/new/task?url=…`. React Router's
 * `<HashRouter>` writes `#/downloading` instead, which would break every
 * bookmark, browser shortcut and CLI integration that exists in the wild.
 *
 * So the router is mounted at `#!` and this module is the adapter:
 *
 * - **reading** strips the `!` banner after the `#` (`getHashPath`);
 * - **writing** puts it back (`buildHashUrl`);
 * - {@link createHashBangHistory} drives React Router's own
 *   `createHashHistory` through a proxied `window` so the *address bar* always
 *   keeps the `#!/` prefix while the router internally sees a plain
 *   `/downloading` path.
 *
 * ## Tolerance
 *
 * Old bookmarks, hand-typed URLs and AriaNg's own `#!new/task` (no leading
 * slash — AngularJS emitted both) must not 404:
 *
 * - `#!` / `#` / no hash at all → {@link DEFAULT_ROUTE} (`/downloading`),
 *   mirroring AriaNg's `otherwise('/downloading')`;
 * - `#/downloading` (no `!`) → routed normally;
 * - `#!downloading` → treated as `/downloading`.
 *
 * A real fragment can only ever contain one `#`, so everything after the first
 * one is part of the in-app path (`?query` included) and never a sub-fragment.
 */

import { UNSAFE_createHashHistory, UNSAFE_createMemoryHistory } from 'react-router-dom';
import type { Location, Path, To } from 'react-router-dom';

import { DEFAULT_ROUTE, HASH_BANG } from './route-paths';

/** React Router's `Action`, spelled out locally (it is not re-exported). */
export type HashBangAction = 'POP' | 'PUSH' | 'REPLACE';

/** One history notification. Structurally identical to React Router's `Update`. */
export interface HashBangUpdate {
  action: HashBangAction;
  location: Location;
  delta: number | null;
}

export type HashBangListener = (update: HashBangUpdate) => void;

/**
 * The history object `<unstable_HistoryRouter>` expects.
 *
 * It is declared here instead of imported because React Router does not export
 * its `History` interface — this is the same shape, which is all TypeScript's
 * structural typing needs.
 */
export interface HashBangHistory {
  readonly action: HashBangAction;
  readonly location: Location;
  createHref(to: To): string;
  createURL(to: To): URL;
  encodeLocation(to: To): Path;
  push(to: To, state?: unknown): void;
  replace(to: To, state?: unknown): void;
  go(delta: number): void;
  listen(listener: HashBangListener): () => void;
}

export interface CreateHashBangHistoryOptions {
  /** Defaults to `window`. Only overridden by tests. */
  window?: Window;
}

/* -------------------------------------------------------------------------- */
/* pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `location.hash` → the in-app path the router should see.
 *
 * ```
 * '#!/new?url=x' -> '/new?url=x'
 * '#!new?url=x'  -> '/new?url=x'      (AngularJS also emitted this shape)
 * '#/waiting'    -> '/waiting'        (banner tolerated)
 * '#!' | '#' | ''-> '/downloading'   (AriaNg's `otherwise`)
 * ```
 */
export function getHashPath(hash: string): string {
  if (typeof hash !== 'string') {
    return DEFAULT_ROUTE;
  }

  let raw = hash;
  if (raw.startsWith('#')) {
    raw = raw.slice(1);
  }
  // The hashbang banner. Absent in a handful of old links, hence tolerated.
  if (raw.startsWith('!')) {
    raw = raw.slice(1);
  }
  if (raw === '') {
    return DEFAULT_ROUTE;
  }
  if (!raw.startsWith('/')) {
    raw = `/${raw}`;
  }
  return raw;
}

/**
 * The inverse of {@link getHashPath}: `'/new?url=x'` → `'#!/new?url=x'`.
 *
 * Also used for `href`s, so a right-click / "copy link address" in the shell
 * yields the exact URL AriaNg would have produced.
 */
export function buildHashUrl(path: string): string {
  const raw = path === '' || path.startsWith('/') ? path : `/${path}`;
  return `${HASH_BANG}${raw}`;
}

/**
 * `'!/downloading'` / `'/!/downloading'` → `'/downloading'`.
 *
 * The underlying hash history reads `#!…` as the path `!/…` and prepends a slash
 * for the router's benefit, which leaves the banner sitting *between* the slash
 * and the first segment. `''`, `'/'` and `'/!'` are the "no route" shapes and
 * resolve to {@link DEFAULT_ROUTE}, exactly like AriaNg's `otherwise`.
 */
function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/' || pathname === '/!') {
    return DEFAULT_ROUTE;
  }
  if (pathname.startsWith('/!')) {
    return pathname.slice(2) || DEFAULT_ROUTE;
  }
  if (pathname.startsWith('!')) {
    return pathname.slice(1) || DEFAULT_ROUTE;
  }
  return pathname;
}

/**
 * Inserts the `!` banner into the fragment of an url `pushState`/`replaceState`
 * is about to write.
 *
 * `'#/downloading'` → `'#!/downloading'`. Already-banged fragments and urls
 * without a fragment are returned untouched (an empty url means "keep the
 * current one").
 */
function toHashBangUrl(url: string | URL | null | undefined): string | URL | null | undefined {
  if (url === null || url === undefined) {
    return url;
  }
  const raw = typeof url === 'string' ? url : url.toString();
  const hashIndex = raw.indexOf('#');
  if (hashIndex < 0) {
    return url;
  }
  const prefix = raw.slice(0, hashIndex);
  const fragment = raw.slice(hashIndex + 1);
  if (fragment.startsWith('!')) {
    return url;
  }
  return `${prefix}${HASH_BANG}${fragment}`;
}

/** `'#/downloading'` → `'#!/downloading'`, for `createHref`. */
function toHashBangHref(href: string): string {
  if (href.indexOf('#') < 0) {
    // Only the in-memory fallback (no DOM, no fragment) lands here: there the
    // banner has to *become* the fragment.
    return buildHashUrl(href);
  }
  const next = toHashBangUrl(href);
  return typeof next === 'string' ? next : href;
}

/* -------------------------------------------------------------------------- */
/* the proxied window                                                         */
/* -------------------------------------------------------------------------- */

/**
 * `window.history` with the hashbang rewrite wired into `pushState` /
 * `replaceState`.
 *
 * The write path is the only thing that cannot be fixed from the history
 * wrapper: React Router computes the url with its *own* internal `createHref`
 * (a closure, not a property), so the only interception point is the browser
 * history object itself.
 */
function proxyHistory(real: History): History {
  return {
    get length() {
      return real.length;
    },
    get scrollRestoration() {
      return real.scrollRestoration;
    },
    set scrollRestoration(value) {
      real.scrollRestoration = value;
    },
    get state() {
      return real.state;
    },
    pushState(data: unknown, unused: string, url?: string | URL | null): void {
      real.pushState(data, unused, toHashBangUrl(url));
    },
    replaceState(data: unknown, unused: string, url?: string | URL | null): void {
      real.replaceState(data, unused, toHashBangUrl(url));
    },
    go(delta: number): void {
      real.go(delta);
    },
    back(): void {
      real.back();
    },
    forward(): void {
      real.forward();
    },
  } as History;
}

/**
 * The `window` React Router's hash history is built with.
 *
 * Deliberately *not* a `Proxy`: a plain object with the four members the
 * history factory touches (`location`, `history`, `document`, the event
 * methods) is easier to reason about, and `addEventListener` is bound to the
 * real window so `popstate` still arrives from the browser.
 */
function createHashBangWindow(view: Window): Window {
  const proxiedHistory = proxyHistory(view.history);

  return {
    get document() {
      return view.document;
    },
    get location() {
      return view.location;
    },
    get history() {
      return proxiedHistory;
    },
    addEventListener: view.addEventListener.bind(view),
    removeEventListener: view.removeEventListener.bind(view),
    dispatchEvent: view.dispatchEvent.bind(view),
  } as unknown as Window;
}

/* -------------------------------------------------------------------------- */
/* the history itself                                                         */
/* -------------------------------------------------------------------------- */

function decorate(
  base: {
    readonly action: string;
    readonly location: Location;
    createHref(to: To): string;
    push(to: To, state?: unknown): void;
    replace(to: To, state?: unknown): void;
    go(delta: number): void;
    listen(listener: (update: HashBangUpdate) => void): () => void;
  },
  urlBase: string,
): HashBangHistory {
  const history: HashBangHistory = {
    get action() {
      return base.action as HashBangAction;
    },
    get location() {
      return { ...base.location, pathname: normalizePathname(base.location.pathname) };
    },
    createHref(to) {
      return toHashBangHref(base.createHref(to));
    },
    createURL(to) {
      return new URL(history.createHref(to), urlBase);
    },
    encodeLocation(to) {
      const url = history.createURL(to);
      return { pathname: url.pathname, search: url.search, hash: url.hash };
    },
    push(to, state) {
      base.push(to, state);
    },
    replace(to, state) {
      base.replace(to, state);
    },
    go(delta) {
      base.go(delta);
    },
    listen(listener) {
      return base.listen((update) => {
        listener({
          action: update.action as HashBangAction,
          location: { ...update.location, pathname: normalizePathname(update.location.pathname) },
          delta: update.delta,
        });
      });
    },
  };

  return history;
}

/**
 * A `#!`-aware history for `<unstable_HistoryRouter>`.
 *
 * Thin wrapper over React Router's own `createHashHistory`, so popstate
 * handling, index bookkeeping and `basename` support stay exactly as upstream
 * implements them. Outside a DOM (a future SSR / node-host test) it degrades to
 * a memory history seeded with the initial `location.hash`.
 */
export function createHashBangHistory(options: CreateHashBangHistoryOptions = {}): HashBangHistory {
  const view = options.window ?? (typeof window === 'undefined' ? undefined : window);

  if (!view) {
    const memory = UNSAFE_createMemoryHistory({ initialEntries: [DEFAULT_ROUTE], v5Compat: true });
    return decorate(memory, 'http://localhost');
  }

  const base = UNSAFE_createHashHistory({
    window: createHashBangWindow(view),
    // `v5Compat` is what React Router's own `<HashRouter>` and `createHashRouter`
    // pass: without it `push` / `replace` mutate the url but never notify the
    // listener, so a declarative router would only ever react to a back/forward.
    v5Compat: true,
  });
  return decorate(base, view.location.href);
}