/**
 * Locale registry and the dual loading strategy.
 *
 * ## Why both an eager and a lazy map exist
 *
 * AriaNg-Next ships two build targets (see `vite.config.ts`):
 *
 * - **`standard`** — a normal multi-file build served from a web server (or any
 *   sub-path). `import.meta.glob()` is free here, so each locale becomes its
 *   own on-demand chunk and a user who only ever sees English never downloads
 *   the other ~700 KB of translation data.
 * - **`single`** — everything inlined into one `dist-single/index.html` that
 *   has to run straight off `file://`. A dynamic `import()` cannot be resolved
 *   in a classic IIFE bundle, so this target needs every table statically
 *   bundled up front.
 *
 * The `__BUILD_TARGET__` define (declared in `src/vite-env.d.ts`) is a
 * compile-time constant, so the dead branch is folded away by the minifier and
 * only one of the two maps survives into the bundle.
 */

import type { LanguageMeta, LocaleCode, TranslationTable } from '../types';

/**
 * Vite replaces this with a literal at build time (`define` in
 * `vite.config.ts`).
 *
 * `__BUILD_TARGET__` is declared globally by `src/vite-env.d.ts`.
 */

/** The build target this bundle was compiled for. */
export const BUILD_TARGET: 'standard' | 'single' = __BUILD_TARGET__;

// TODO: switch to config/languages.ts once available.
// Kept local so this module stands on its own; the values are copied 1:1 from
// AriaNg's `src/scripts/config/languages.js` plus each locale's own
// `format.longdate` from its `src/langs/*.txt`.

/** `null` rather than `undefined` so the array shape is stable. */
export const LANGUAGES: LanguageMeta[] = [
  {
    key: 'en',
    name: 'English',
    displayName: 'English',
    aliases: [],
    mduiLocale: 'en-us',
    longDatePattern: 'MM/DD/YYYY HH:mm:ss',
  },
  {
    key: 'cz_CZ',
    name: 'Czech',
    displayName: 'Čeština',
    aliases: [],
    mduiLocale: 'cs-cz',
    // AriaNg's `cz_CZ.txt` ships `MM/DD/RRRR HH:mm:ss`; `RRRR` is a moment
    // week-numbering token that `Intl.DateTimeFormat` cannot express, so it is
    // normalised to a plain calendar year here.
    longDatePattern: 'MM/DD/YYYY HH:mm:ss',
  },
  {
    key: 'de_DE',
    name: 'German',
    displayName: 'Deutsch',
    aliases: [],
    mduiLocale: 'de-de',
    longDatePattern: 'MM/DD/YYYY HH:mm:ss',
  },
  {
    key: 'es',
    name: 'Spanish',
    displayName: 'Español',
    aliases: [],
    mduiLocale: 'es-es',
    longDatePattern: 'MM/DD/YYYY HH:mm:ss',
  },
  {
    key: 'fr_FR',
    name: 'French',
    displayName: 'Français',
    aliases: [],
    mduiLocale: 'fr-fr',
    longDatePattern: 'DD/MM/YYYY HH:mm:ss',
  },
  {
    key: 'it_IT',
    name: 'Italian',
    displayName: 'Italiano',
    aliases: [],
    mduiLocale: 'it-it',
    longDatePattern: 'DD/MM/YYYY HH:mm:ss',
  },
  {
    key: 'ja_JP',
    name: 'Japanese',
    displayName: '日本語',
    aliases: [],
    mduiLocale: 'ja-jp',
    longDatePattern: 'YYYY/MM/DD HH:mm:ss',
  },
  {
    key: 'pl_PL',
    name: 'Polish',
    displayName: 'Polski',
    aliases: [],
    mduiLocale: 'pl-pl',
    longDatePattern: 'MM/DD/YYYY HH:mm:ss',
  },
  {
    key: 'ru_RU',
    name: 'Russian',
    displayName: 'Русский',
    aliases: [],
    mduiLocale: 'ru-ru',
    longDatePattern: 'DD/MM/YYYY HH:mm:ss',
  },
  {
    key: 'zh_Hans',
    name: 'Simplified Chinese',
    displayName: '简体中文',
    aliases: ['zh_CHS', 'zh_CN', 'zh_SG'],
    mduiLocale: 'zh-cn',
    longDatePattern: 'YYYY年MM月DD日 HH:mm:ss',
  },
  {
    key: 'zh_Hant',
    name: 'Traditional Chinese',
    displayName: '繁體中文',
    aliases: ['zh_CHT', 'zh_TW', 'zh_HK', 'zh_MO'],
    mduiLocale: 'zh-tw',
    longDatePattern: 'YYYY年MM月DD日 HH:mm:ss',
  },
];

/** Storage key of the English master table; also AriaNg's `fallbackLanguage`. */
export const FALLBACK_LOCALE = 'en';

/** Every locale AriaNg supports, master table first. */
export const availableLocales: LanguageMeta[] = LANGUAGES;

/** Alias -> canonical key (`zh_CN` -> `zh_Hans`), as AriaNg's `languageAliases`. */
const ALIAS_TO_KEY: Record<string, LocaleCode> = (() => {
  const map: Record<string, LocaleCode> = {};

  for (const language of LANGUAGES) {
    for (const alias of language.aliases) {
      map[alias] = language.key;
    }
  }

  return map;
})();

/**
 * Resolves a user-supplied locale to a canonical key.
 *
 * Accepts the canonical key itself, any declared alias, and a case-insensitive
 * match, so a stale `zh_CN` in someone's saved settings still resolves. Unknown
 * locales fall back to {@link FALLBACK_LOCALE}.
 */
export function resolveLocaleKey(locale: string | null | undefined): LocaleCode {
  if (!locale) {
    return FALLBACK_LOCALE;
  }

  const alias = ALIAS_TO_KEY[locale];

  if (alias) {
    return alias;
  }

  const lowered = locale.toLowerCase();
  const byLowercase = LANGUAGES.find(
    (language) =>
      language.key.toLowerCase() === lowered ||
      language.aliases.some((alias) => alias.toLowerCase() === lowered),
  );

  if (byLowercase) {
    return byLowercase.key;
  }

  return FALLBACK_LOCALE;
}

/** Language metadata for a locale (already canonicalised). */
export function getLanguageMeta(locale: string | null | undefined): LanguageMeta {
  const key = resolveLocaleKey(locale);

  return LANGUAGES.find((language) => language.key === key) ?? LANGUAGES[0];
}

/* ------------------------------------------------------------------ */
/* Loading strategy                                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolves a table for a locale key. Rejects for unknown locales — the store
 * decides what to do about that, and it always has English to fall back to.
 */
export type LocaleLoader = (locale: LocaleCode) => Promise<TranslationTable>;

/**
 * `import.meta.glob` keys are module paths (`'./zh_Hans.ts'`, `'../en.ts'`),
 * so recover the locale key from the basename.
 */
function localeKeyFromModulePath(modulePath: string): LocaleCode {
  const base = modulePath.substring(modulePath.lastIndexOf('/') + 1);
  return base.replace(/\.ts$/, '');
}

/**
 * The single-file target cannot resolve dynamic imports, so every table is
 * *also* imported statically. Rollup drops all eleven of these from the
 * standard build, because the only thing that reads them is the dead `single`
 * branch of {@link getLocaleLoaderFor}.
 *
 * This is deliberately a hand-written list of **named imports** rather than a
 * second `import.meta.glob({ eager: true })`. Vite emits an eager glob as an
 * object literal of module-namespace reads, which Rollup treats as having side
 * effects and keeps unconditionally — measured, that put all ~700 kB of
 * translations into the standard build's main chunk. Named imports are shaken
 * out instead, and a test asserts the two maps expose identical key sets so a
 * locale added to the glob cannot be forgotten here.
 */
import { en } from '../en';
import { cz_CZ } from './cz_CZ';
import { de_DE } from './de_DE';
import { es } from './es';
import { fr_FR } from './fr_FR';
import { it_IT } from './it_IT';
import { ja_JP } from './ja_JP';
import { pl_PL } from './pl_PL';
import { ru_RU } from './ru_RU';
import { zh_Hans } from './zh_Hans';
import { zh_Hant } from './zh_Hant';

/** All tables, statically bundled. Read only by the `single` target. */
export const eagerLocales: Record<string, TranslationTable> = {
  cz_CZ,
  de_DE,
  en,
  es,
  fr_FR,
  it_IT,
  ja_JP,
  pl_PL,
  ru_RU,
  zh_Hans,
  zh_Hant,
};

/**
 * One dynamic import per table, so the standard build emits a separate chunk
 * per locale and only fetches the one the user picked. This one *is* a glob, so
 * it picks up newly generated locale files automatically.
 *
 * The pattern list must stay a literal: Vite only statically analyses
 * `import.meta.glob` when its first argument is inline. `!./index.ts` keeps
 * this module from importing itself, and `../en.ts` picks up the master table,
 * which lives one directory up.
 *
 * With `import: 'default'` Vite resolves the **default export itself**, not a
 * module namespace — so each loader resolves to a `TranslationTable`.
 */
const lazyGlob = import.meta.glob<TranslationTable>(['./*.ts', '!./index.ts', '../en.ts'], {
  import: 'default',
});

function rekey<T>(glob: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {};

  for (const modulePath of Object.keys(glob)) {
    result[localeKeyFromModulePath(modulePath)] = glob[modulePath];
  }

  return result;
}

/** All tables, behind a per-locale dynamic import. Used by `standard` only. */
export const localeLoaders: Record<string, () => Promise<TranslationTable>> = rekey(lazyGlob);

export function getLocaleLoaderFor(target: 'standard' | 'single'): LocaleLoader {
  if (target === 'single') {
    return (locale) => {
      const table = eagerLocales[locale];

      if (!table) {
        return Promise.reject(new Error(`[i18n] unknown locale "${locale}"`));
      }

      return Promise.resolve(table);
    };
  }

  return (locale) => {
    const loader = localeLoaders[locale];

    if (!loader) {
      return Promise.reject(new Error(`[i18n] unknown locale "${locale}"`));
    }

    return loader();
  };
}