/**
 * mdui localisation wiring.
 *
 * mdui 2 does not ship its translations in the component bundles. It defers to
 * `@lit/localize`, and until the app calls `loadLocale()` with a loader function,
 * mdui's `setLocale()` throws:
 *
 *     You must call `loadLocale` first to set up the localized template.
 *
 * The app called `setLocale()` on every language change without ever calling
 * `loadLocale()`, so that error was raised on every switch — and then swallowed
 * into the status channel, which surfaced it as an in-page error notification
 * instead of a visible failure. Every string mdui owns (menu affordances, dialog
 * buttons, the text field's pattern-error message) stayed in the source locale.
 *
 * The mocks below reproduce the real coupling rather than asserting on call
 * counts alone: `setLocale` throws unless `loadLocale` has run, exactly as mdui
 * does. That way a regression to the old order fails here.
 */

import { describe, expect, it, vi } from 'vitest';

import { createI18n } from '../i18n';
import { LANGUAGES } from '../locales';
import type { I18nStore } from '../i18n';
import type { TranslationTable } from '../types';

const EN: TranslationTable = { TaskName: 'Task Name', Start: 'Start' };
const DE: TranslationTable = { TaskName: 'Aufgabenname', Start: 'Starten' };
const ZH: TranslationTable = { TaskName: '任务名称', Start: '开始' };

/** mdui's own source locale; lit never asks the loader for it. */
const SOURCE_LOCALE = 'en-us';

/** Set once `loadLocale` has run, mirroring `mdui/internal/localize.js`. */
let loadLocaleCalls = 0;
/** The loader mdui was handed, so a test can ask it for a bundle. */
let handedLoader: ((locale: string) => Promise<unknown>) | null = null;
/** Codes mdui asked for, in order. */
const requested: string[] = [];
/** Locale the app last pushed into mdui. */
let appliedToMdui: string | null = null;

vi.mock('mdui/functions/loadLocale.js', () => ({
  loadLocale: (loadFunc: (locale: string) => Promise<unknown>) => {
    loadLocaleCalls += 1;
    handedLoader = loadFunc;
  },
}));

vi.mock('mdui/functions/setLocale.js', () => ({
  setLocale: async (locale: string) => {
    if (handedLoader === null) {
      throw new Error('You must call `loadLocale` first to set up the localized template.');
    }
    requested.push(locale);
    await handedLoader(locale);
    appliedToMdui = locale;
  },
}));

function makeStore(initialLocale = 'en'): I18nStore {
  loadLocaleCalls = 0;
  handedLoader = null;
  requested.length = 0;
  appliedToMdui = null;

  return createI18n({
    initialLocale,
    loader: (locale) =>
      Promise.resolve(
        locale === 'en' ? EN : locale === 'de_DE' ? DE : locale === 'zh_Hans' ? ZH : EN,
      ),
    syncMdui: true,
  });
}

describe('mdui locale wiring', () => {
  it('initialises localisation before asking mdui to switch', async () => {
    const store = makeStore();
    // Would throw "You must call `loadLocale` first…" if the order regressed.
    await store.setLocale('de_DE');
    await store.mduiLocaleReady();
    expect(loadLocaleCalls).toBe(1);
    expect(appliedToMdui).toBe('de-de');
  });

  it('reports no error status on a normal switch', async () => {
    const store = makeStore();
    const statuses: string[] = [];
    store.subscribeStatus((event) => statuses.push(event.status));

    await store.setLocale('de_DE');
    await store.mduiLocaleReady();

    expect(statuses).not.toContain('error');
    expect(store.status).not.toBe('error');
  });

  it('calls loadLocale exactly once, however many times the language changes', async () => {
    const store = makeStore();

    for (const locale of ['de_DE', 'zh_Hans', 'en', 'de_DE'] as const) {
      await store.setLocale(locale);
      await store.mduiLocaleReady();
    }

    // `configureLocalization` also installs the `mdui-localize-status` bridge, so
    // calling it again would double every status event.
    expect(loadLocaleCalls).toBe(1);
    // `en-us` is mdui's sourceLocale: lit serves it without asking the loader.
    expect(requested).toEqual(['de-de', 'zh-cn', 'en-us', 'de-de']);
  });

  it('hands mdui a loader that can actually fetch each bundle', async () => {
    const store = makeStore();
    await store.setLocale('zh_Hans');
    await store.mduiLocaleReady();

    expect(handedLoader).not.toBeNull();
    // The real mdui bundle, imported through the same map the app uses.
    const bundle = (await handedLoader!('zh-cn')) as { templates: Record<string, string> };

    expect(typeof bundle.templates).toBe('object');
    // These are the ids mdui's own components ask for; if the bundle were empty or
    // the wrong file, mdui would fall back to the source locale silently.
    expect(bundle.templates['functions.alert.confirmText']).toBeDefined();
    expect(bundle.templates['functions.confirm.cancelText']).toBeDefined();
    expect(bundle.templates['components.textField.patternError']).toBeDefined();
  });

  it('rejects a locale it has no bundle for, rather than importing nothing', async () => {
    const store = makeStore();
    await store.setLocale('de_DE');
    await store.mduiLocaleReady();

    await expect(handedLoader!('xx-yy')).rejects.toThrow(/no locale bundle registered/);
  });

  it('has a real, non-empty bundle behind every language the app offers', async () => {
    // The loader map in i18n.ts and `LANGUAGES` are two lists that must not drift: a
    // language present in one and missing from the other would silently fall back to
    // English component strings, with no error anywhere. English is the one code
    // with no bundle, because it is mdui's `sourceLocale`.
    const store = makeStore();
    await store.setLocale('de_DE');
    await store.mduiLocaleReady();

    const offered = LANGUAGES.map((language) => language.mduiLocale);
    expect(offered.length).toBeGreaterThanOrEqual(11);
    expect(new Set(offered).size).toBe(offered.length);

    for (const code of offered) {
      if (code === SOURCE_LOCALE) continue;
      const bundle = (await handedLoader!(code)) as { templates: Record<string, string> };
      expect(Object.keys(bundle.templates ?? {}).length, `${code} produced an empty bundle`).toBeGreaterThan(0);
      // The three ids mdui's own components ask for; a bundle missing them means
      // dialog buttons and the text field's error text stay in English.
      expect(bundle.templates['functions.alert.confirmText'], code).toBeDefined();
      expect(bundle.templates['functions.confirm.cancelText'], code).toBeDefined();
      expect(bundle.templates['components.textField.patternError'], code).toBeDefined();
    }
  });
});