/**
 * The framework-agnostic i18n store.
 *
 * Everything React-specific lives in `react.tsx`; this module knows nothing
 * about JSX, storage or the DOM beyond one optional event listener, which
 * makes it trivial to unit-test and safe to use from a Web Worker.
 *
 * ## Deliberate differences from AriaNg
 *
 * AriaNg fed translations straight into `ng-bind-html`, i.e. every translated
 * string was rendered as raw HTML. Several AriaNg strings do contain markup
 * (`<br/>`, `<code>`, `<a href=…>`) and some are built from RPC-supplied data,
 * so that pipeline was an XSS footgun. Here a translation is **always plain
 * text**: `t()` returns a string that must be rendered as a text child, never
 * through `dangerouslySetInnerHTML` / `innerHTML`. If a string needs a line
 * break or a link, the component that renders it builds the elements itself.
 *
 * AriaNg also cached language resources in `localStorage`. Here tables live in
 * a plain in-memory cache only (they are ~700 KB each, and a stale cached copy
 * was the reason for AriaNg's "language resource has been updated, please
 * reload" notification). Persisting the *chosen* locale is delegated to the
 * `onLocalePersist` callback so this module stays pure.
 */

import { flattenTable } from './parser';
import { ARIA2_NEXT_STRINGS } from './extensions';
import {
  BUILD_TARGET,
  FALLBACK_LOCALE,
  LANGUAGES,
  availableLocales,
  getLanguageMeta,
  getLocaleLoaderFor,
  resolveLocaleKey,
} from './locales';
import type { LocaleLoader } from './locales';
import type {
  I18nApi,
  LanguageMeta,
  LocaleCode,
  TranslateFn,
  TranslateParams,
  TranslationTable,
} from './types';

/* ------------------------------------------------------------------ */
/* Tiny emitter                                                         */
/* ------------------------------------------------------------------ */

/** Removes the listener it was returned for. Idempotent. */
export type Unsubscribe = () => void;

export interface Emitter<T> {
  subscribe(listener: (payload: T) => void): Unsubscribe;
  emit(payload: T): void;
  clear(): void;
}

/**
 * A deliberately minimal synchronous emitter.
 *
 * A snapshot is taken before dispatch so a listener that unsubscribes (React
 * unmounting during a locale change) cannot skip its neighbour.
 */
export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(payload: T) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    emit(payload) {
      for (const listener of [...listeners]) {
        listener(payload);
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

export interface LocaleChangeEvent {
  locale: LocaleCode;
  previous: LocaleCode;
}

export type LocaleChangeListener = (event: LocaleChangeEvent) => void;

/** Progress of a locale switch, mirroring mdui's `mdui-localize-status`. */
export type I18nStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface I18nStatusEvent {
  status: I18nStatus;
  locale: LocaleCode;
  /** Human-readable reason for `'error'`, otherwise `''`. */
  message: string;
}

export type I18nStatusListener = (event: I18nStatusEvent) => void;

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */

/**
 * The full store surface. It is an {@link I18nApi} plus the two subscription
 * channels `react.tsx` (and the settings page's progress indicator) need.
 */
export interface I18nStore extends I18nApi {
  /** Current progress of the last {@link I18nStore.setLocale} call. */
  readonly status: I18nStatus;
  /**
   * Resolves once the initial locale's table is loaded. `t()` works before
   * this settles (English, then the key), so it only matters for tests and for
   * a splash screen that wants to wait for the right strings.
   */
  ready(): Promise<void>;
  /** Subscribe to `localechange`; returns an unsubscribe function. */
  subscribe(listener: LocaleChangeListener): Unsubscribe;
  /** Subscribe to `loading` / `ready` / `error` transitions. */
  subscribeStatus(listener: I18nStatusListener): Unsubscribe;
}

export interface CreateI18nOptions {
  /** Locale to start on. Aliases are resolved; unknown values fall back to `en`. */
  initialLocale?: LocaleCode;
  /** How to obtain a table. Defaults to the build-target-appropriate loader. */
  loader?: LocaleLoader;
  /**
   * Called after a successful locale switch. The store never touches
   * `localStorage` itself — the app wires this to the settings slice.
   */
  onLocalePersist?: (locale: LocaleCode) => void;
  /** Drive mdui's own locale files via `setLocale`. Defaults to `true`. */
  syncMdui?: boolean;
  /** Locale metadata list exposed as `availableLocales`. */
  languages?: LanguageMeta[];
}

/** angular-translate's placeholder syntax, e.g. `{{count}}`. */
const PLACEHOLDER_PATTERN = /\{\{\s*([^}\s][^}]*?)\s*\}\}/g;

/**
 * Replaces every `{{param}}` occurrence.
 *
 * All occurrences of a parameter are replaced (angular-translate's
 * `replace` semantics). A parameter that was not supplied is left untouched —
 * AriaNg did the same, and it makes a missing binding obvious during review
 * instead of silently blanking part of the sentence.
 */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) {
    return template;
  }

  return template.replace(PLACEHOLDER_PATTERN, (match, rawName: string) => {
    const name = rawName.trim();

    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      return match;
    }

    const value = params[name];

    // `undefined` / `null` are not valid TranslateParams values, but a caller
    // can still smuggle them in through a wider type.
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Resolves a dotted path in a nested table; `undefined` when absent. */
function lookup(table: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function isWindowAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function';
}

/**
 * The `mdui-localize-status` payload mdui forwards from
 * `@lit/localize`. Kept structural so we do not depend on the dependency's
 * internal d.ts from application code.
 */
interface MduiLocalizeStatusEventDetail {
  status: 'loading' | 'ready' | 'error';
  loadingLocale?: string;
  readyLocale?: string;
  errorLocale?: string;
  errorMessage?: string;
}

function createStore(options: CreateI18nOptions): I18nStore {
  const languages = options.languages ?? availableLocales;
  const loader = options.loader ?? getLocaleLoaderFor(BUILD_TARGET);
  const onLocalePersist = options.onLocalePersist ?? (() => {});
  const syncMdui = options.syncMdui !== false;

  const localeChange = createEmitter<LocaleChangeEvent>();
  const statusChange = createEmitter<I18nStatusEvent>();

  /**
   * Flattened tables, keyed by locale. Flattening once per load keeps `t()` a
   * single hash lookup instead of a walk down a nested object on every render.
   */
  const cache = new Map<LocaleCode, Record<string, string>>();
  /** In-flight loads, so concurrent `setLocale` calls share one promise. */
  const pending = new Map<LocaleCode, Promise<Record<string, string>>>();

  let currentLocale = resolveLocaleKey(options.initialLocale ?? FALLBACK_LOCALE);
  /**
   * The locale whose table is currently *applied* to `t()`.
   *
   * Deliberately tracked separately from `cache`: the idempotence guard in
   * `setLocale` must not depend on the table still being in the cache, otherwise
   * re-selecting the active locale could emit a redundant change event and
   * re-render the whole tree. `null` until the first table is applied.
   */
  let appliedLocale: LocaleCode | null = null;
  let status: I18nStatus = 'idle';

  const setStatus = (next: I18nStatus, message = ''): void => {
    status = next;
    statusChange.emit({ status: next, locale: currentLocale, message });
  };

  async function loadTable(locale: LocaleCode): Promise<Record<string, string>> {
    const cached = cache.get(locale);

    if (cached) {
      return cached;
    }

    const inFlight = pending.get(locale);

    if (inFlight) {
      return inFlight;
    }

    const request = loader(locale)
      .then((table: TranslationTable) => {
        if (!table || typeof table !== 'object') {
          throw new Error(`[i18n] loader returned no table for "${locale}"`);
        }

        const flat = flattenTable(table);

        /**
         * Merge the aria2-next overlay **into English only**.
         *
         * AriaNg predates ED2K and native media, so those keys cannot exist in
         * any of its locale files. Merging them into the English table means
         * every locale inherits them through the existing English fallback, and
         * a real translation still wins the moment it exists in `langs/*.txt`
         * (because that locale is consulted before English).
         */
        if (locale === FALLBACK_LOCALE) {
          Object.assign(flat, ARIA2_NEXT_STRINGS);
        }

        cache.set(locale, flat);
        pending.delete(locale);
        return flat;
      })
      .catch((error: unknown) => {
        pending.delete(locale);
        throw error;
      });

    pending.set(locale, request);

    return request;
  }

  /**
   * English is the fallback for every locale, so it is preloaded eagerly.
   *
   * The promise is stored twice on purpose: once as a handle every caller can
   * await, and once with a no-op `catch` attached so a failure is reported
   * through the status channel instead of surfacing as an unhandled rejection.
   */
  const englishRequest = loadTable(FALLBACK_LOCALE);
  const englishPromise = englishRequest.catch((error: unknown) => {
    setStatus('error', error instanceof Error ? error.message : String(error));
    return {} as Record<string, string>;
  });

  /**
   * The initial locale starts loading straight away, so an app that renders
   * synchronously still ends up with the right strings. `t()` is safe to call
   * before this resolves: it falls back to English, then to the key.
   *
   * `localechange` is announced when it lands, which is what makes a React tree
   * re-render without anyone having to call `setLocale`.
   */
  const initialRequest = (async (): Promise<void> => {
    if (currentLocale !== FALLBACK_LOCALE) {
      setStatus('loading');

      try {
        await loadTable(currentLocale);
        appliedLocale = currentLocale;
        setStatus('ready');
        // Announced even though the locale did not change: consumers need to
        // know the table for `currentLocale` is now in the cache, because until
        // this resolves `t()` was answering out of English.
        localeChange.emit({ locale: currentLocale, previous: currentLocale });
        return;
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : String(error));

        const previous = currentLocale;
        await englishPromise;
        currentLocale = FALLBACK_LOCALE;
        localeChange.emit({ locale: currentLocale, previous });
        return;
      }
    }

    await englishPromise;
    appliedLocale = currentLocale;
    setStatus('ready');
    localeChange.emit({ locale: currentLocale, previous: currentLocale });
  })();

  /** Resolves once the initial locale's table is in the cache. Never rejects. */
  const ready = (): Promise<void> => initialRequest;

  const t: TranslateFn = (key, params) => {
    const active = cache.get(currentLocale);
    const fallback = cache.get(FALLBACK_LOCALE);

    // Active locale first, then English, then the key itself. Never `undefined`:
    // a missing string must be visible, not invisible.
    const template = lookup(active ?? {}, key) ?? lookup(fallback ?? {}, key) ?? key;

    return interpolate(template, params);
  };

  /**
   * Surfaces mdui's own locale-loading progress so the settings page can show a
   * spinner while the component strings swap in.
   */
  function attachMduiStatusListener(): void {
    if (!syncMdui || !isWindowAvailable()) {
      return;
    }

    window.addEventListener('mdui-localize-status', ((event: Event) => {
      const detail = (event as CustomEvent<MduiLocalizeStatusEventDetail>).detail;

      if (!detail) {
        return;
      }

      if (detail.status === 'error') {
        setStatus('error', detail.errorMessage ?? 'mdui locale failed to load');
      } else {
        setStatus(detail.status);
      }
    }) as EventListener);
  }

  let mduiListenerAttached = false;

  /**
   * Drives mdui's own translations. Imported dynamically so the module — and
   * with it the whole locale catalogue mdui pulls in — is only fetched when a
   * locale actually changes.
   */
  async function syncMduiLocale(locale: LocaleCode): Promise<void> {
    if (!syncMdui) {
      return;
    }

    if (!mduiListenerAttached) {
      attachMduiStatusListener();
      mduiListenerAttached = true;
    }

    const meta = getLanguageMeta(locale);

    try {
      const { setLocale } = await import('mdui/functions/setLocale.js');
      // `LanguageMeta.mduiLocale` is a plain `string`; mdui narrows it to its
      // own union of supported codes.
      await setLocale(meta.mduiLocale as Parameters<typeof setLocale>[0]);
    } catch (error) {
      // mdui throws "You must call `loadLocale` first" when the app never
      // initialised localisation. That must not take the whole locale switch
      // down — our own strings are already swapped by this point.
      setStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  async function setLocale(next: string): Promise<void> {
    const resolved = resolveLocaleKey(next);

    if (resolved === appliedLocale) {
      // Already applied (e.g. re-selecting the active locale in the picker).
      // No event: a redundant localechange would re-render every subscriber.
      return;
    }

    const previous = currentLocale;

    setStatus('loading');

    try {
      await loadTable(resolved);
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error));

      // English is always available, so degrade to it instead of leaving the UI
      // in a half-translated state.
      await englishPromise;
      currentLocale = FALLBACK_LOCALE;
      appliedLocale = FALLBACK_LOCALE;
      localeChange.emit({ locale: currentLocale, previous });
      return;
    }

    currentLocale = resolved;
    appliedLocale = resolved;
    localeChange.emit({ locale: resolved, previous });
    onLocalePersist(resolved);
    setStatus('ready');

    // Fire-and-forget: mdui's own strings are decorative, ours are not, so the
    // locale switch must not block on them.
    void syncMduiLocale(resolved);
  }

  const store: I18nStore = {
    t,
    get locale() {
      return currentLocale;
    },
    setLocale,
    availableLocales: languages,
    get longDatePattern() {
      return getLanguageMeta(currentLocale).longDatePattern ?? 'MM/DD/YYYY HH:mm:ss';
    },
    get status() {
      return status;
    },
    ready,
    subscribe: localeChange.subscribe,
    subscribeStatus: statusChange.subscribe,
  };

  return store;
}

/** Creates an independent store. Useful for tests and for multi-root apps. */
export function createI18n(options: CreateI18nOptions = {}): I18nStore {
  const store = createStore(options);

  // The initial table is fetched in the background; swallowing the rejection is
  // deliberate because the store has already surfaced it through
  // `subscribeStatus` and degrades to English.
  void store.ready().catch(() => undefined);

  return store;
}

/** The default loader for the current build target. */
export function getLocaleLoader(): LocaleLoader {
  return getLocaleLoaderFor(BUILD_TARGET);
}

/** App-wide store. */
export const i18n: I18nStore = createI18n();

export { FALLBACK_LOCALE, LANGUAGES, availableLocales, getLanguageMeta, resolveLocaleKey };
export type { LocaleLoader };