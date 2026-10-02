/**
 * Supported UI languages — a 1:1 port of AriaNg's `ariaNgLanguages`
 * (`src/scripts/config/languages.js`), plus the two derived tables AriaNg kept
 * elsewhere:
 *
 * - `mduiLocale`: AriaNg had no component library, AriaNg-Next has mdui.
 * - `LONG_DATE_PATTERNS`: AriaNg stored one `format.longdate` per language
 *   (`src/langs/*.txt`, `[format] longdate=…`) and fed it to moment.js. The
 *   patterns below are the same fields in `Intl.DateTimeFormat` syntax.
 *
 * `resolveLanguageByAlias` / `detectBrowserLanguage` replicate
 * `ariaNgSettingService.getLanguageNameFromAlias` + `getDefaultLanguage`.
 */

import type { LanguageMeta } from '@/i18n/types';

/** Used whenever nothing else matches — mirrors `ariaNgConstants.defaultLanguage`. */
export const DEFAULT_LANGUAGE_KEY = 'en';

/**
 * `format.longdate` per language.
 *
 * AriaNg's moment.js patterns, converted to the `Intl.DateTimeFormat` dialect:
 * `YYYY` → `yyyy`, `DD` → `dd`. Two deliberate notes:
 *
 * - `cz_CZ` ships `MM/DD/RRRR HH:mm:ss` upstream. `RRRR` is a broken moment
 *   token (a typo for `YYYY`), so it is rendered here as `yyyy`.
 * - `zh_*` embed the CJK date markers as literal text, which is exactly what
 *   AriaNg did (`YYYY年MM月DD日 HH:mm:ss`).
 */
export const LONG_DATE_PATTERNS: Readonly<Record<string, string>> = {
  cz_CZ: 'MM/dd/yyyy HH:mm:ss',
  de_DE: 'MM/dd/yyyy HH:mm:ss',
  en: 'MM/dd/yyyy HH:mm:ss',
  es: 'MM/dd/yyyy HH:mm:ss',
  fr_FR: 'dd/MM/yyyy HH:mm:ss',
  it_IT: 'dd/MM/yyyy HH:mm:ss',
  ja_JP: 'yyyy/MM/dd HH:mm:ss',
  pl_PL: 'MM/dd/yyyy HH:mm:ss',
  ru_RU: 'dd/MM/yyyy HH:mm:ss',
  zh_Hans: 'yyyy年MM月dd日 HH:mm:ss',
  zh_Hant: 'yyyy年MM月dd日 HH:mm:ss',
};

/** English's pattern; the fallback for unknown keys. */
export const DEFAULT_LONG_DATE_PATTERN = LONG_DATE_PATTERNS[DEFAULT_LANGUAGE_KEY];

/** Declaration order is AriaNg's order; the picker renders in this order. */
export const LANGUAGES: readonly LanguageMeta[] = [
  {
    key: 'cz_CZ',
    name: 'Czech',
    displayName: 'Čeština',
    aliases: [],
    mduiLocale: 'cs',
    longDatePattern: LONG_DATE_PATTERNS.cz_CZ,
  },
  {
    key: 'de_DE',
    name: 'German',
    displayName: 'Deutsch',
    aliases: [],
    mduiLocale: 'de',
    longDatePattern: LONG_DATE_PATTERNS.de_DE,
  },
  {
    key: 'en',
    name: 'English',
    displayName: 'English',
    aliases: [],
    mduiLocale: 'en',
    longDatePattern: LONG_DATE_PATTERNS.en,
  },
  {
    key: 'es',
    name: 'Spanish',
    displayName: 'Español',
    aliases: [],
    mduiLocale: 'es',
    longDatePattern: LONG_DATE_PATTERNS.es,
  },
  {
    key: 'fr_FR',
    name: 'French',
    displayName: 'Français',
    aliases: [],
    mduiLocale: 'fr',
    longDatePattern: LONG_DATE_PATTERNS.fr_FR,
  },
  {
    key: 'it_IT',
    name: 'Italian',
    displayName: 'Italiano',
    aliases: [],
    mduiLocale: 'it',
    longDatePattern: LONG_DATE_PATTERNS.it_IT,
  },
  {
    key: 'ja_JP',
    name: 'Japanese',
    displayName: '日本語',
    aliases: [],
    mduiLocale: 'ja',
    longDatePattern: LONG_DATE_PATTERNS.ja_JP,
  },
  {
    key: 'pl_PL',
    name: 'Polish',
    displayName: 'Polski',
    aliases: [],
    mduiLocale: 'pl',
    longDatePattern: LONG_DATE_PATTERNS.pl_PL,
  },
  {
    key: 'ru_RU',
    name: 'Russian',
    displayName: 'Русский',
    aliases: [],
    mduiLocale: 'ru',
    longDatePattern: LONG_DATE_PATTERNS.ru_RU,
  },
  {
    key: 'zh_Hans',
    name: 'Simplified Chinese',
    displayName: '简体中文',
    aliases: ['zh_CHS', 'zh_CN', 'zh_SG'],
    mduiLocale: 'zh-cn',
    longDatePattern: LONG_DATE_PATTERNS.zh_Hans,
  },
  {
    key: 'zh_Hant',
    name: 'Traditional Chinese',
    displayName: '繁體中文',
    aliases: ['zh_CHT', 'zh_TW', 'zh_HK', 'zh_MO'],
    mduiLocale: 'zh-tw',
    longDatePattern: LONG_DATE_PATTERNS.zh_Hant,
  },
];

const LANGUAGE_BY_KEY: ReadonlyMap<string, LanguageMeta> = new Map(
  LANGUAGES.map((language) => [normalizeTag(language.key), language]),
);

const LANGUAGE_BY_ALIAS: ReadonlyMap<string, LanguageMeta> = (() => {
  const index = new Map<string, LanguageMeta>();

  for (const language of LANGUAGES) {
    for (const alias of language.aliases) {
      index.set(normalizeTag(alias), language);
    }
  }

  return index;
})();

/**
 * Language subtag (`ja` → `ja_JP`, `de` → `de_DE`) → language.
 *
 * Ambiguous subtags are dropped, so `zh` resolves to nothing and the caller
 * falls back to English rather than guessing a script. The brief's negotiation
 * chain ends on the bare `lang`; AriaNg only ever compared that bare tag against
 * keys and aliases, which made `navigator.language === 'ja'` (very common — IE
 * and older Safari report the bare tag) fall back to English. This index fixes
 * that without touching the ported data.
 *
 * Note `cz_CZ` is AriaNg's own (upstream) spelling of Czech; the ISO 639-1 code
 * is `cs`, so `cs-CZ` still resolves to English.
 */
const LANGUAGE_BY_SUBTAG: ReadonlyMap<string, LanguageMeta> = (() => {
  const grouped = new Map<string, LanguageMeta[]>();

  for (const language of LANGUAGES) {
    const subtag = normalizeTag(language.key).split('_')[0] as string;
    const group = grouped.get(subtag);
    if (group) {
      group.push(language);
    } else {
      grouped.set(subtag, [language]);
    }
  }

  const index = new Map<string, LanguageMeta>();
  for (const [subtag, group] of grouped) {
    if (group.length === 1) {
      index.set(subtag, group[0] as LanguageMeta);
    }
  }

  return index;
})();

/**
 * The mdui 2.x locale bundles actually shipped by `mdui/locales/*.js`.
 *
 * mdui's locale codes are region qualified (`de-de`, `ja-jp`, `en-gb`, …) and
 * its `loadLocale` throws for anything outside its target list, so the values
 * above (canonical CLDR subtags) are not what you hand to `mdui.setLocale()`.
 */
export const MDUI_LOCALE_FILES: Readonly<Record<string, string>> = {
  cz_CZ: 'cs-cz',
  de_DE: 'de-de',
  en: 'en-gb',
  es: 'es-es',
  fr_FR: 'fr-fr',
  it_IT: 'it-it',
  ja_JP: 'ja-jp',
  pl_PL: 'pl-pl',
  ru_RU: 'ru-ru',
  zh_Hans: 'zh-cn',
  zh_Hant: 'zh-tw',
};

/* ------------------------------------------------------------------ */
/* lookups                                                             */
/* ------------------------------------------------------------------ */

/** `zh-TW`, `zh_TW` and `zh_tw` are the same request. */
function normalizeTag(tag: string): string {
  return tag.replace(/-/g, '_').toLowerCase();
}

/** Exact key lookup. Case-insensitive, no alias resolution. */
export function getLanguageByKey(key: string): LanguageMeta | undefined {
  if (!key) {
    return undefined;
  }

  return LANGUAGE_BY_KEY.get(normalizeTag(key));
}

/**
 * AriaNg's `getLanguageNameFromAlias`: matches a key **or** any of its aliases,
 * case-insensitively and regardless of `-` vs `_`. `zh-CN`, `zh_cn` and `ZH-CHS`
 * all resolve to `zh_Hans`.
 */
export function resolveLanguageByAlias(alias: string): LanguageMeta | undefined {
  if (!alias) {
    return undefined;
  }

  const normalized = normalizeTag(alias);
  return LANGUAGE_BY_KEY.get(normalized) ?? LANGUAGE_BY_ALIAS.get(normalized);
}

/** Long date pattern for a language key, falling back to English. */
export function getLongDatePattern(languageKey: string): string {
  return LONG_DATE_PATTERNS[languageKey] ?? DEFAULT_LONG_DATE_PATTERN;
}

/** One candidate tag: exact key → alias → `lang_REGION` → bare `lang`. */
function matchLanguageTag(tag: string): LanguageMeta | undefined {
  const exact = resolveLanguageByAlias(tag);
  if (exact) {
    return exact;
  }

  const parts = normalizeTag(tag).split('_');
  if (parts.length > 1) {
    // "maybe language-script-region": drop everything past the region.
    const withRegion = resolveLanguageByAlias(`${parts[0]}_${parts[1]}`);
    if (withRegion) {
      return withRegion;
    }
  }

  const base = parts[0] as string;
  return resolveLanguageByAlias(base) ?? LANGUAGE_BY_SUBTAG.get(base);
}

/**
 * AriaNg's `getDefaultLanguage`, made testable.
 *
 * Accepts a `navigator.languages`-style list (`navigator.language` is just a
 * one-element list) and walks it in order. Per candidate: `-` → `_`, then exact
 * key → alias → `lang_REGION` → `lang`. Falls back to `en`.
 */
export function detectBrowserLanguage(navLanguages: readonly string[]): LanguageMeta {
  for (const raw of navLanguages ?? []) {
    if (!raw) {
      continue;
    }

    const language = matchLanguageTag(raw);
    if (language) {
      return language;
    }
  }

  return LANGUAGE_BY_KEY.get(DEFAULT_LANGUAGE_KEY) as LanguageMeta;
}

/**
 * True when `locale` is one of our mdui locales, either the canonical subtag
 * (`zh-cn`) or the region-qualified bundle name (`zh-CN`, `zh_CN`).
 */
export function isMduiLocale(locale: string): boolean {
  if (!locale) {
    return false;
  }

  const normalized = locale.replace(/_/g, '-').toLowerCase();

  for (const language of LANGUAGES) {
    if (language.mduiLocale === normalized) {
      return true;
    }

    const bundle = MDUI_LOCALE_FILES[language.key];
    if (bundle === normalized) {
      return true;
    }

    if (bundle.startsWith(`${normalized}-`)) {
      return true;
    }
  }

  return false;
}

/** The canonical mdui subtag for a language key; `en` for unknown keys. */
export function toMduiLocale(languageKey: string): string {
  const language = getLanguageByKey(languageKey) ?? resolveLanguageByAlias(languageKey);
  return language?.mduiLocale ?? (LANGUAGE_BY_KEY.get(DEFAULT_LANGUAGE_KEY)?.mduiLocale ?? 'en');
}