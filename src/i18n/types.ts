export type TranslateParams = Record<string, string | number | boolean>;

/**
 * Translation lookup. Keys are the exact strings AriaNg used, e.g.
 * `t('File Name')` or `t('options.dir.name')`.
 * Never returns `undefined` — falls back to English, then to the key itself.
 */
export type TranslateFn = (key: string, params?: TranslateParams) => string;

export type LocaleCode = string;

export interface LanguageMeta {
  /** Storage / file key, e.g. `zh_Hans`. */
  key: LocaleCode;
  /** English name. */
  name: string;
  /** Endonym shown in the language picker. */
  displayName: string;
  aliases: string[];
  /** mdui locale code used for component-level strings, e.g. `zh-cn`. */
  mduiLocale: string;
  /** `format.longdate` style pattern used by `Intl.DateTimeFormat`. */
  longDatePattern?: string;
}

export interface TranslationBundle {
  [key: string]: string;
}

/** Nested bundle as produced by parsing the original `[section]` INI files. */
export interface TranslationTable {
  [section: string]: TranslationBundle | TranslationTable;
}

export interface I18nApi {
  t: TranslateFn;
  locale: LocaleCode;
  setLocale(locale: LocaleCode): Promise<void>;
  availableLocales: LanguageMeta[];
  /** Long date pattern for the active locale. */
  longDatePattern: string;
}
