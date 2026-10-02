/**
 * React bindings for the i18n store.
 *
 * Intentionally dependency-free: a `useState` bump plus an effect
 * subscription, no `useSyncExternalStore` shim and no context value object
 * rebuilt on every render.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { i18n as defaultI18n } from './i18n';
import type { I18nStore } from './i18n';
import type { I18nApi, TranslateFn } from './types';

export const I18nContext = createContext<I18nApi>(defaultI18n);

export interface I18nProviderProps {
  children: ReactNode;
  /** Store to expose. Defaults to the app-wide {@link defaultI18n} singleton. */
  i18n?: I18nStore;
}

/**
 * Provides an i18n store and re-renders its subtree whenever the active locale
 * changes, so every `t()` call below re-evaluates.
 */
export function I18nProvider({ children, i18n = defaultI18n }: I18nProviderProps) {
  const [locale, setLocale] = useState(i18n.locale);

  useEffect(() => {
    // Subscribe only — no synchronous `setState` in the effect body. The store
    // announces its initial table through `localechange` once `ready()` settles,
    // so the value converges on its own; that also covers a provider handed a
    // different store after mount, which emits its own announcement.
    return i18n.subscribe((event) => setLocale(event.locale));
  }, [i18n]);

  const value = useMemo<I18nApi>(
    () => ({
      t: i18n.t,
      get locale() {
        return locale;
      },
      setLocale: i18n.setLocale,
      availableLocales: i18n.availableLocales,
      get longDatePattern() {
        return i18n.longDatePattern;
      },
    }),
    [i18n, locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The active store. Works with or without an {@link I18nProvider} above. */
export function useI18n(): I18nApi {
  return useContext(I18nContext);
}

/**
 * The translation function, ready to hand to a `<select>` or a list of options.
 *
 * ```
 * const t = useTranslate();
 * <option value="en">{t('English')}</option>
 * ```
 */
export function useTranslate(): TranslateFn {
  const i18n = useI18n();

  // `t` is stable for the lifetime of a store, so this never invalidates a
  // memoised caller's dependencies on its own.
  return useCallback<TranslateFn>((key, params) => i18n.t(key, params), [i18n]);
}