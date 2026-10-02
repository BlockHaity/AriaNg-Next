/**
 * Theme control.
 *
 * mdui themes are three CSS classes on `<html>` (`mdui-theme-light`,
 * `mdui-theme-dark`, `mdui-theme-auto`). `mdui-theme-auto` is resolved by mdui
 * through a `prefers-color-scheme` media query inside `mdui.css`, so nothing in
 * JS knows which one is actually active — but the app does need to know, for the
 * `<meta name="theme-color">` value and for ECharts, which must be told when to
 * re-theme instead of polling.
 *
 * So this module keeps a single media-query listener alive for as long as
 * somebody is subscribed, recomputes the resolved scheme, syncs the meta tag and
 * dispatches a `themechange` CustomEvent on `window`.
 */

import { getTheme as mduiGetTheme } from 'mdui/functions/getTheme.js';
import { setTheme as mduiSetTheme } from 'mdui/functions/setTheme.js';
import { setColorScheme as mduiSetColorScheme } from 'mdui/functions/setColorScheme.js';
import { removeColorScheme as mduiRemoveColorScheme } from 'mdui/functions/removeColorScheme.js';
import { getColorFromImage } from 'mdui/functions/getColorFromImage.js';

/* -------------------------------------------------------------------------- */
/* types                                                                      */
/* -------------------------------------------------------------------------- */

export type ThemeSetting = 'light' | 'dark' | 'system';
/** mdui spells "follow the OS" `auto`. */
type MduiTheme = 'light' | 'dark' | 'auto';

export type ResolvedTheme = 'light' | 'dark';

/** Detail payload of the `themechange` event dispatched on `window`. */
export interface ThemeChangeDetail {
  resolved: ResolvedTheme;
  setting: ThemeSetting;
}

export const THEME_CHANGE_EVENT = 'themechange';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]';

/**
 * MD3 baseline tonal palette seeds.
 *
 * `nameKey` is an i18n key resolved by the caller; the hex values are the
 * official Material Design 3 baseline palette seeds (the first twelve of the
 * standard 13-entry baseline set).
 */
export const M3_SEED_COLORS: readonly { nameKey: string; hex: string }[] = [
  { nameKey: 'theme.color.purple', hex: '#6750a4' },
  { nameKey: 'theme.color.blue', hex: '#415f91' },
  { nameKey: 'theme.color.teal', hex: '#006a6a' },
  { nameKey: 'theme.color.green', hex: '#386a20' },
  { nameKey: 'theme.color.magenta', hex: '#7d5260' },
  { nameKey: 'theme.color.red', hex: '#8f4c38' },
  { nameKey: 'theme.color.olive', hex: '#616200' },
  { nameKey: 'theme.color.pink', hex: '#984061' },
  { nameKey: 'theme.color.lime', hex: '#3f6837' },
  { nameKey: 'theme.color.cyan', hex: '#006874' },
  { nameKey: 'theme.color.indigo', hex: '#3f4b7f' },
  { nameKey: 'theme.color.slate', hex: '#5c5f77' },
] as const;

/* -------------------------------------------------------------------------- */
/* detection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `true` when the OS currently prefers a dark UI.
 *
 * Tolerant of a missing `matchMedia` (old browsers, some SSR shims) — it simply
 * reports `false` there rather than throwing during render.
 */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Collapse a setting into the scheme that is actually in effect. */
export function resolveTheme(setting: ThemeSetting): ResolvedTheme {
  if (setting === 'dark') return 'dark';
  if (setting === 'light') return 'light';
  return prefersDark() ? 'dark' : 'light';
}

/* -------------------------------------------------------------------------- */
/* application                                                                */
/* -------------------------------------------------------------------------- */

let currentSchemeHex: string | undefined;

/** The hex currently pushed through `setColorScheme`, if any. */
export function currentColorScheme(): string | undefined {
  return currentSchemeHex;
}

function toMduiTheme(setting: ThemeSetting): MduiTheme {
  return setting === 'system' ? 'auto' : setting;
}

function fromMduiTheme(theme: MduiTheme): ThemeSetting {
  return theme === 'auto' ? 'system' : theme;
}

/**
 * Read the setting currently applied to `<html>`.
 *
 * Backed by mdui so there is a single source of truth; falls back to
 * `prefersDark()`-resolved `system` if mdui's helper is unavailable.
 */
function readSetting(): ThemeSetting {
  try {
    return fromMduiTheme(mduiGetTheme());
  } catch {
    return 'system';
  }
}

/** The scheme actually in effect right now. */
export function getTheme(): ResolvedTheme {
  return resolveTheme(readSetting());
}

/**
 * Keep `<meta name="theme-color">` in step with the scheme.
 *
 * The value is read from the resolved MD3 surface token rather than a literal,
 * so the browser chrome always matches the active theme — including a custom
 * dynamic palette installed by {@link setColorScheme}.
 *
 * `index.html` ships **two** media-scoped tags (one per scheme) so the very first
 * painted frame is already right, before any JavaScript runs. Every matching tag
 * is rewritten here: only the one whose `media` query currently applies is the one
 * the browser honours, so updating both is correct and keeps the tags in sync with
 * whatever the active scheme turns out to be.
 *
 * `data-scheme` is always recorded so callers (and tests) can observe what was
 * resolved even when the token is not available — e.g. in jsdom, where `mdui.css`
 * is not applied.
 */
function syncThemeColor(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const metas = document.querySelectorAll<HTMLMetaElement>(THEME_COLOR_META_SELECTOR);
  if (metas.length === 0) return;
  const surface = getComputedStyle(document.documentElement)
    .getPropertyValue('--mdui-color-surface')
    .trim();
  for (const meta of metas) {
    meta.setAttribute('data-scheme', resolved);
    if (surface) meta.content = `rgb(${surface})`;
  }
}

function emitThemeChange(setting: ThemeSetting, resolved: ResolvedTheme): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, {
      detail: { resolved, setting },
    }),
  );
}

/**
 * Apply a theme.
 *
 * Pass `'system'` to follow the OS: mdui's `mdui-theme-auto` class plus the
 * live media-query subscription installed by {@link onThemeChange} keeps
 * everything (including ECharts) in sync when the OS flips.
 *
 * This is the **single write path**, so it also emits `themechange` itself.
 * Without that, a change made from Settings → AriaNg → Global would restyle the
 * mdui components but leave every token-driven consumer — the speed chart, the
 * piece map — reading the old colours, because those re-read the MD3 tokens only
 * when the event fires.
 */
export function setTheme(setting: ThemeSetting): void {
  try {
    mduiSetTheme(toMduiTheme(setting));
  } catch (error) {
    console.warn('[mdui] setTheme failed', error);
  }
  syncThemeColor(resolveTheme(setting));
  emitThemeChange(setting, resolveTheme(setting));
  for (const listener of listeners) {
    try {
      listener(resolveTheme(setting));
    } catch (error) {
      console.warn('[mdui] themechange listener failed', error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* subscription                                                               */
/* -------------------------------------------------------------------------- */

type ThemeListener = (resolved: ResolvedTheme) => void;

const listeners = new Set<ThemeListener>();
let mediaQuery: MediaQueryList | null = null;
let detachMediaListener: (() => void) | null = null;

function handleMediaChange(): void {
  if (readSetting() !== 'system') return;
  const resolved = resolveTheme('system');
  syncThemeColor(resolved);
  emitThemeChange('system', resolved);
  for (const listener of listeners) {
    try {
      listener(resolved);
    } catch (error) {
      console.warn('[mdui] themechange listener failed', error);
    }
  }
}

function attachMediaListener(): void {
  // Already attached, or there is no `matchMedia` to attach to (old browsers,
  // some SSR shims) — in both cases there is nothing to do.
  if (detachMediaListener !== null || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  try {
    const query = window.matchMedia(DARK_QUERY);
    mediaQuery = query;
    query.addEventListener('change', handleMediaChange);
    detachMediaListener = () => {
      query.removeEventListener('change', handleMediaChange);
    };
  } catch {
    detachMediaListener = null;
  }
}

function detachMediaListenerIfIdle(): void {
  if (listeners.size > 0) return;
  detachMediaListener?.();
  detachMediaListener = null;
  mediaQuery = null;
}

/**
 * Subscribe to resolved-theme changes (OS dark-mode flip while in `system`).
 *
 * The listener is only invoked while the effective setting is `'system'`; an
 * explicit `light` / `dark` choice does not move on its own.
 *
 * @returns an unsubscribe function. The `matchMedia` listener is removed once the
 *          last subscriber goes away.
 */
export function onThemeChange(listener: ThemeListener): () => void {
  listeners.add(listener);
  attachMediaListener();

  return () => {
    listeners.delete(listener);
    detachMediaListenerIfIdle();
  };
}

/**
 * Cycle the theme setting: light → dark → system → light.
 *
 * Used by the single theme-toggle button in the app bar. Note this cycles the
 * *setting*, not just the resolved scheme, so the third press genuinely hands
 * control back to the OS.
 */
export function nextThemeSetting(current: ThemeSetting): ThemeSetting {
  switch (current) {
    case 'light':
      return 'dark';
    case 'dark':
      return 'system';
    case 'system':
    default:
      return 'light';
  }
}

/** The media query backing `system`, exposed for tests and debugging. */
export function themeMediaQuery(): MediaQueryList | null {
  return mediaQuery;
}

/** Re-emit the current theme to every subscriber (e.g. after `setTheme`). */
export function notifyThemeChange(): void {
  const setting = readSetting();
  const resolved = resolveTheme(setting);
  syncThemeColor(resolved);
  emitThemeChange(setting, resolved);
  for (const listener of listeners) {
    try {
      listener(resolved);
    } catch (error) {
      console.warn('[mdui] themechange listener failed', error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* dynamic colour                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Generate an MD3 tonal palette from a seed colour and apply it.
 *
 * mdui injects a `<style>` element into `<head>` and adds a class to the target;
 * it does not touch any of our components directly.
 */
export function setColorScheme(hex: string, options?: { target?: HTMLElement }): void {
  mduiSetColorScheme(hex, { target: options?.target });
  if (!options?.target) currentSchemeHex = hex;
}

/** Drop the dynamic palette previously installed by {@link setColorScheme}. */
export function removeColorScheme(target?: HTMLElement): void {
  mduiRemoveColorScheme(target);
  if (!target) currentSchemeHex = undefined;
}

/**
 * Extract the dominant colour of an image URL.
 *
 * mdui's `getColorFromImage()` needs an `<img>` element that is already in the
 * document and decodable, so the URL is loaded into a detached image first
 * (`crossOrigin="anonymous"` so the canvas is not tainted).
 */
export function getColorSchemeFromImage(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('[mdui] Image is unavailable in this environment'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        void getColorFromImage(img).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error(`[mdui] failed to load image: ${url}`));
    img.src = url;
  });
}