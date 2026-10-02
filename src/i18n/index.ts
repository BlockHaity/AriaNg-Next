/**
 * Public surface of the i18n layer.
 *
 * ```
 * import { I18nProvider, useTranslate, readableVolume } from '@/i18n';
 * ```
 *
 * Nothing here is React-specific except `react.tsx`, so the same store can be
 * driven from a worker or a plain script.
 */

export type {
  I18nApi,
  LanguageMeta,
  LocaleCode,
  TranslateFn,
  TranslateParams,
  TranslationBundle,
  TranslationTable,
} from './types';

export { diffKeys, flattenTable, parseLanguageIni, unflattenTable } from './parser';

export {
  createEmitter,
  createI18n,
  getLocaleLoader,
  i18n,
  interpolate,
  resolveLocaleKey,
} from './i18n';
export type {
  CreateI18nOptions,
  Emitter,
  I18nStatus,
  I18nStatusEvent,
  I18nStatusListener,
  I18nStore,
  LocaleChangeEvent,
  LocaleChangeListener,
  Unsubscribe,
} from './i18n';

export {
  availableLocales,
  eagerLocales,
  getLanguageMeta,
  getLocaleLoaderFor,
  localeLoaders,
  LANGUAGES,
  FALLBACK_LOCALE,
} from './locales';
export type { LocaleLoader } from './locales';

export { I18nContext, I18nProvider, useI18n, useTranslate } from './react';
export type { I18nProviderProps } from './react';

export {
  currentIntlLocale,
  DEFAULT_LONG_DATE_PATTERN,
  formatBytesInput,
  formatDuration,
  formatLongDate,
  formatNumber,
  formatPercent,
  formatRemainTime,
  formatTimeOption,
  MORE_THAN_ONE_DAY_KEY,
  readableVolume,
  toIntlLocale,
  VOLUME_UNITS,
} from './format';