/**
 * Faithful port of AriaNg's `ariaNgStorageService` (which wrapped
 * `angular-localstorage` configured with `prefix: 'AriaNg'`).
 *
 * Behaviour that MUST NOT be "improved":
 *
 * - Every key is namespaced as `AriaNg.<key>`.  The `StorageKey` constants in
 *   `@/config/types` (`AriaNg.Options`, `AriaNg.History.*`, …) **already carry
 *   that prefix**, so they are passed through verbatim — `normalizeKey()` never
 *   double-prefixes an already prefixed key, it only adds the namespace to a
 *   bare one.
 * - Values are JSON.  A stored `null` (or the literal string `"null"`) means
 *   *absent*: `storageGet` returns the caller's fallback.
 * - When `localStorage` is missing **or `setItem` throws** (quota exhausted,
 *   Safari private browsing) writes silently fall through to
 *   `document.cookie`.  AriaNg never disabled `defaultToCookie`, and this
 *   cookie fallback is the only reason the app stays usable in private mode.
 * - `storageKeys()` returns keys **without** the `AriaNg.` prefix.  This
 *   inversion is AriaNg's actual (surprising) behaviour and other modules rely
 *   on it — see `history.ts`, which filters by `'History.'` and re-adds the
 *   prefix before removing.  Keep it.
 * - `storageClearAll()` only ever removes keys inside the `AriaNg.` namespace.
 * - There is deliberately **no cross-tab `storage` event sync**: AriaNg did
 *   not do it and silently merging two tabs produces conflicting writes.
 *
 * If both `localStorage` and `document.cookie` are unavailable (some
 * `file://` + hardened browser combinations, `document.cookie` accessors
 * throwing) the module degrades to an in-memory `Map` and flips
 * `storageIsEphemeral()` so the shell can warn the user that settings will
 * not survive a reload.
 */

/** Namespace for every persisted key. */
export const STORAGE_PREFIX = 'AriaNg';

const NAMESPACE = `${STORAGE_PREFIX}.`;
/** Key used to probe `localStorage` writability (quota / private mode check). */
const PROBE_KEY = `${NAMESPACE}__ariang_probe__`;
const PROBE_VALUE = '1';
/** AriaNg wrote `max-age=365`; kept literal for byte-compatibility. */
const COOKIE_MAX_AGE = 365;
const COOKIE_PATH = '/';

/* ------------------------------------------------------------------ */
/* capability probes                                                   */
/* ------------------------------------------------------------------ */

function getWindow(): Window | null {
  // `typeof` keeps this safe under the node test environment.
  return typeof window === 'undefined' ? null : window;
}

function getDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

/**
 * Reading `window.localStorage` itself throws `SecurityError` when cookies are
 * blocked for the origin, hence the try/catch around the *access*, not only
 * around the calls.
 */
function getLocalStorage(): Storage | null {
  const w = getWindow();
  if (!w) return null;
  try {
    return w.localStorage ?? null;
  } catch {
    return null;
  }
}

/** `setItem` is the only reliable capability test (Safari private mode). */
function probeLocalStorage(): boolean {
  const ls = getLocalStorage();
  if (!ls) return false;
  try {
    ls.setItem(PROBE_KEY, PROBE_VALUE);
    ls.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

function readCookieName(doc: Document, name: string): string | null {
  const jar = doc.cookie;
  if (!jar) return null;
  const target = `${name}=`;
  for (const part of jar.split(';')) {
    const entry = part.trim();
    if (entry.startsWith(target)) {
      const raw = entry.slice(target.length);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function hasCookieName(doc: Document, name: string): boolean {
  try {
    return readCookieName(doc, name) !== null;
  } catch {
    return false;
  }
}

function listCookieNames(doc: Document): string[] {
  const jar = doc.cookie;
  if (!jar) return [];
  const names: string[] = [];
  for (const part of jar.split(';')) {
    const entry = part.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    names.push(eq < 0 ? entry : entry.slice(0, eq));
  }
  return names;
}

function writeCookie(doc: Document, name: string, value: string): void {
  doc.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=${COOKIE_PATH}`;
}

function clearCookie(doc: Document, name: string): void {
  doc.cookie = `${name}=; max-age=0; path=${COOKIE_PATH}`;
}

function probeCookies(): boolean {
  const doc = getDocument();
  if (!doc) return false;
  try {
    writeCookie(doc, PROBE_KEY, PROBE_VALUE);
    const ok = hasCookieName(doc, PROBE_KEY);
    clearCookie(doc, PROBE_KEY);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Snapshot of the environment taken at module-evaluation time, mirroring
 * AriaNg's one-shot `isLocalStorageSupported` / `isCookiesSupported` flags.
 *
 * NOTE: these are constants, so a test that swaps `localStorage` must
 * re-import the module (`vi.resetModules()` + dynamic `import()`) for the
 * flags to reflect the new environment.  The exported functions re-probe on
 * demand and are what the stores use.
 */
export const isLocalStorageSupported: boolean = probeLocalStorage();
export const isCookiesSupported: boolean = probeCookies();
export const isStorageSupported: boolean = isLocalStorageSupported || isCookiesSupported;

/* ------------------------------------------------------------------ */
/* ephemeral (last resort) backend + change notification                */
/* ------------------------------------------------------------------ */

const memory = new Map<string, string>();
const listeners = new Set<() => void>();

let ephemeral = false;

function setEphemeral(value: boolean): void {
  if (ephemeral === value) return;
  ephemeral = value;
  for (const listener of [...listeners]) listener();
}

/** True when every write currently lands in the in-memory `Map`. */
export function storageIsEphemeral(): boolean {
  return ephemeral;
}

/**
 * True when writes currently reach `localStorage` or `document.cookie`.
 *
 * Re-probed on every call on purpose: storage can degrade (or come back) at
 * any moment — a quota error on the first write, cookies blocked by a policy
 * change — and the settings store must notice on its next `hydrate()`.
 */
export function storageIsAvailable(): boolean {
  if (ephemeral) return false;
  return probeLocalStorage() || probeCookies();
}

/** Notified whenever `storageIsEphemeral()` / `storageIsAvailable()` change. */
export function subscribeStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ */
/* key helpers                                                         */
/* ------------------------------------------------------------------ */

/** `Options` -> `AriaNg.Options`, `AriaNg.Options` -> `AriaNg.Options`. */
export function normalizeStorageKey(key: string): string {
  return key.startsWith(NAMESPACE) ? key : `${NAMESPACE}${key}`;
}

function normalizePrefixFilter(prefix: string | undefined): string | null {
  if (prefix === undefined || prefix === '') return null;
  return prefix.startsWith(NAMESPACE) ? prefix.slice(NAMESPACE.length) : prefix;
}

function readRaw(fullKey: string): string | null {
  const ls = getLocalStorage();
  if (ls) {
    try {
      const raw = ls.getItem(fullKey);
      // A readable-but-unwritable store (Safari private mode) can still serve
      // values that were written before the store degraded.
      if (raw !== null && raw !== undefined) return raw;
    } catch {
      /* fall through to cookies / memory */
    }
  }
  const doc = getDocument();
  if (doc) {
    try {
      const fromCookie = readCookieName(doc, fullKey);
      if (fromCookie !== null) return fromCookie;
    } catch {
      /* `document.cookie` accessors can throw when cookies are blocked */
    }
  }
  return memory.get(fullKey) ?? null;
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

export function storageGet<T>(key: string, fallback: T): T {
  const raw = readRaw(normalizeStorageKey(key));
  if (raw === null) return fallback;
  // Both `JSON.stringify(null)` (`null`) and a JSON string `"null"` mean
  // "nothing stored" for AriaNg.
  const trimmed = raw.trim();
  if (trimmed === 'null' || trimmed === '"null"') return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (parsed === null || parsed === undefined) return fallback;
  return parsed as T;
}

export function storageSet(key: string, value: unknown): void {
  const fullKey = normalizeStorageKey(key);
  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    json = 'null';
  }

  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.setItem(fullKey, json);
      setEphemeral(false);
      return;
    } catch {
      // Quota exceeded or private browsing: fall through to cookies.
    }
  }

  const doc = getDocument();
  if (doc) {
    try {
      writeCookie(doc, fullKey, json);
      if (hasCookieName(doc, fullKey)) {
        setEphemeral(false);
        return;
      }
    } catch {
      /* cookies blocked: fall through to memory */
    }
  }

  memory.set(fullKey, json);
  setEphemeral(true);
}

export function storageRemove(key: string): void {
  const fullKey = normalizeStorageKey(key);
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.removeItem(fullKey);
    } catch {
      /* ignore */
    }
  }
  const doc = getDocument();
  if (doc) {
    try {
      clearCookie(doc, fullKey);
    } catch {
      /* ignore */
    }
  }
  memory.delete(fullKey);
}

/** Removes **only** keys inside the `AriaNg.` namespace. */
export function storageClearAll(): void {
  for (const bare of storageKeys()) storageRemove(`${NAMESPACE}${bare}`);
  memory.clear();
}

/**
 * Keys currently stored, **without** the `AriaNg.` prefix.
 *
 * The optional `prefix` is matched against the *un-prefixed* name, so
 * `storageKeys('History.')` yields `['History.dir', ...]`.
 */
export function storageKeys(prefix?: string): string[] {
  const wanted = normalizePrefixFilter(prefix);
  const names = new Set<string>();

  const ls = getLocalStorage();
  if (ls) {
    try {
      for (let i = 0; i < ls.length; i += 1) {
        const key = ls.key(i);
        if (key) names.add(key);
      }
    } catch {
      /* ignore */
    }
  }

  const doc = getDocument();
  if (doc) {
    try {
      for (const name of listCookieNames(doc)) names.add(name);
    } catch {
      /* ignore */
    }
  }

  for (const name of memory.keys()) names.add(name);

  const out: string[] = [];
  for (const name of names) {
    if (!name.startsWith(NAMESPACE)) continue;
    const bare = name.slice(NAMESPACE.length);
    if (wanted !== null && !bare.startsWith(wanted)) continue;
    out.push(bare);
  }
  return out.sort();
}
