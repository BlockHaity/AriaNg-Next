import { describe, expect, it, vi } from 'vitest';

import { createI18n, interpolate, resolveLocaleKey } from '../i18n';
import { eagerLocales, getLocaleLoaderFor, localeLoaders } from '../locales';
import { parseLanguageIni } from '../parser';
import type { I18nStore, LocaleLoader } from '../i18n';
import type { TranslationTable } from '../types';

/**
 * A tiny loader over hand-written INI so the tests do not depend on the
 * generated data files' contents. The fallback locale is always `en`, and the
 * store preloads it, so the loader only has to answer for the requested locale.
 */
function makeLoader(tables: Record<string, string>): LocaleLoader {
  return (locale) => {
    const content = tables[locale];

    if (content === undefined) {
      return Promise.reject(new Error(`no table for ${locale}`));
    }

    return Promise.resolve(parseLanguageIni(content));
  };
}

const EN = ['[global]', 'Task Name=Task Name', 'Start=Start', 'Pause=Pause', 'Count={{count}} tasks', 'Twice={{count}} of {{count}}', 'Greeting={{missing}} stays', ''].join('\n');

const DE = ['[global]', 'Task Name=Aufgabenname', 'Count={{count}} Aufgaben', '', '[options]', 'dir.name=Verzeichnis', ''].join('\n');

const ZH = ['[global]', 'Task Name=任务名称', ''].join('\n');

/** A store wired to the fixtures above, with mdui out of the way. */
function makeStore(initialLocale?: string): I18nStore {
  return createI18n({
    initialLocale,
    loader: makeLoader({ en: EN, de_DE: DE, zh_Hans: ZH }),
    syncMdui: false,
  });
}

/**
 * `createI18n` loads the initial locale in the background, so anything that
 * asserts on it has to wait. `t()` is safe to call before this — it falls back
 * to English — but the German string is not there yet.
 */
async function makeStoreReady(initialLocale?: string): Promise<I18nStore> {
  const store = makeStore(initialLocale);
  await store.ready();
  return store;
}

describe('interpolate', () => {
  it('replaces a single placeholder', () => {
    expect(interpolate('{{count}} tasks', { count: 3 })).toBe('3 tasks');
  });

  it('replaces every occurrence of the same placeholder', () => {
    expect(interpolate('{{count}} of {{count}}', { count: 7 })).toBe('7 of 7');
  });

  it('leaves an unsupplied placeholder untouched', () => {
    expect(interpolate('{{nope}} stays', { other: 1 })).toBe('{{nope}} stays');
  });

  it('returns the template unchanged with no params', () => {
    expect(interpolate('{{count}} tasks')).toBe('{{count}} tasks');
  });

  it('stringifies numbers and booleans', () => {
    expect(interpolate('{{a}}/{{b}}', { a: 1.5, b: false })).toBe('1.5/false');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(interpolate('{{ count }}', { count: 9 })).toBe('9');
  });
});

describe('createI18n — t()', () => {
  it('resolves a key in the active locale', async () => {
    const store = await makeStoreReady('de_DE');

    expect(store.t('Task Name')).toBe('Aufgabenname');
  });

  it('falls back to English for a key the locale lacks', async () => {
    const store = await makeStoreReady('de_DE');

    expect(store.t('Pause')).toBe('Pause');
    expect(store.t('Start')).toBe('Start');
  });

  it('resolves a nested key through the dotted path', async () => {
    const store = await makeStoreReady('de_DE');

    expect(store.t('options.dir.name')).toBe('Verzeichnis');
  });

  it('returns the key itself when no table has it', async () => {
    const store = await makeStoreReady('de_DE');

    expect(store.t('Nope')).toBe('Nope');
    expect(store.t('options.nope.nope')).toBe('options.nope.nope');
  });

  it('interpolates parameters', async () => {
    const store = await makeStoreReady('de_DE');

    expect(store.t('Count', { count: 4 })).toBe('4 Aufgaben');
  });

  it('interpolates a repeated parameter', async () => {
    const store = await makeStoreReady('en');

    expect(store.t('Twice', { count: 2 })).toBe('2 of 2');
  });

  it('leaves an unknown parameter untouched', async () => {
    const store = await makeStoreReady('en');

    expect(store.t('Greeting')).toBe('{{missing}} stays');
  });

  it('is safe to call t() before the initial table has loaded', () => {
    const store = makeStore('de_DE');

    // Falls back to English rather than throwing or returning undefined.
    expect(store.t('Task Name')).toBe('Task Name');
    expect(store.locale).toBe('de_DE');
  });
});

describe('createI18n — setLocale()', () => {
  it('switches the active locale and notifies subscribers', async () => {
    const store = makeStore('en');
    await store.ready();

    const seen: string[] = [];

    store.subscribe((event) => seen.push(`${event.previous}->${event.locale}`));

    await store.setLocale('de_DE');

    expect(store.locale).toBe('de_DE');
    expect(store.t('Task Name')).toBe('Aufgabenname');
    expect(seen).toEqual(['en->de_DE']);
  });

  it('resolves an alias to its canonical key', async () => {
    const store = makeStore('en');

    await store.setLocale('zh_CN');

    expect(store.locale).toBe('zh_Hans');
  });

  it('persists the chosen locale through onLocalePersist', async () => {
    const onLocalePersist = vi.fn();
    const store = createI18n({
      loader: makeLoader({ en: EN, de_DE: DE }),
      onLocalePersist,
      syncMdui: false,
    });

    await store.setLocale('de_DE');

    expect(onLocalePersist).toHaveBeenCalledExactlyOnceWith('de_DE');
  });

  it('is a no-op when the requested locale is already active', async () => {
    const store = await makeStoreReady('de_DE');
    const listener = vi.fn();

    store.subscribe(listener);

    await store.setLocale('de_DE');

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const store = makeStore('en');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    await store.setLocale('de_DE');

    expect(listener).not.toHaveBeenCalled();
  });

  it('reports loading then ready through the status channel', async () => {
    const store = makeStore('en');
    const seen: string[] = [];

    store.subscribeStatus((event) => seen.push(event.status));

    await store.setLocale('de_DE');

    // `setLocale` marks itself ready once the table is in place; mdui is off
    // here, so there is no further transition.
    expect(seen).toContain('loading');
    expect(seen[seen.length - 1]).toBe('ready');
    expect(store.status).toBe('ready');
  });

  it('surfaces a load failure as an error and falls back to English', async () => {
    const store = makeStore('en');
    const statuses: string[] = [];

    store.subscribeStatus((event) => statuses.push(event.status));

    await store.setLocale('ja_JP');

    expect(store.locale).toBe('en');
    expect(statuses).toContain('error');
    expect(store.t('Task Name')).toBe('Task Name');
  });

  it('loads each table once', async () => {
    const loader = vi.fn(makeLoader({ en: EN, de_DE: DE }));
    const store = createI18n({ loader, syncMdui: false });

    await store.setLocale('de_DE');
    await store.setLocale('en');
    await store.setLocale('de_DE');

    expect(loader.mock.calls.filter(([locale]) => locale === 'de_DE')).toHaveLength(1);
  });

  it('exposes the active long-date pattern', async () => {
    const store = makeStore('en');

    expect(store.longDatePattern).toBe('MM/DD/YYYY HH:mm:ss');

    await store.setLocale('zh_Hans');

    expect(store.longDatePattern).toBe('YYYY年MM月DD日 HH:mm:ss');
  });

  it('announces the initial locale once its table lands', async () => {
    const store = makeStore('de_DE');
    const seen: string[] = [];

    store.subscribe((event) => seen.push(event.locale));
    await store.ready();

    expect(seen).toEqual(['de_DE']);
    expect(store.t('Task Name')).toBe('Aufgabenname');
  });

  it('announces the initial English table too, so consumers can re-render', async () => {
    const store = makeStore('en');
    const seen: string[] = [];

    store.subscribe((event) => seen.push(event.locale));
    await store.ready();

    expect(seen).toEqual(['en']);
  });

  it('falls back to English when the initial locale cannot be loaded', async () => {
    const store = createI18n({
      initialLocale: 'ja_JP',
      loader: makeLoader({ en: EN }),
      syncMdui: false,
    });

    await store.ready();

    expect(store.locale).toBe('en');
    expect(store.t('Task Name')).toBe('Task Name');
    expect(store.status).toBe('error');
  });

  it('lists the available locales', () => {
    const store = makeStore('en');

    expect(store.availableLocales.map((language) => language.key)).toContain('zh_Hant');
    expect(store.availableLocales[0].key).toBe('en');
  });
});

describe('resolveLocaleKey', () => {
  it('passes a canonical key through', () => {
    expect(resolveLocaleKey('de_DE')).toBe('de_DE');
  });

  it('resolves an alias', () => {
    expect(resolveLocaleKey('zh_TW')).toBe('zh_Hant');
  });

  it('is case-insensitive', () => {
    expect(resolveLocaleKey('ZH_HANS')).toBe('zh_Hans');
  });

  it('falls back to English for null, undefined and unknown locales', () => {
    expect(resolveLocaleKey(null)).toBe('en');
    expect(resolveLocaleKey(undefined)).toBe('en');
    expect(resolveLocaleKey('kl_GL')).toBe('en');
  });
});

describe('getLocaleLoaderFor', () => {
  const expectedKeys = [
    'en',
    'cz_CZ',
    'de_DE',
    'es',
    'fr_FR',
    'it_IT',
    'ja_JP',
    'pl_PL',
    'ru_RU',
    'zh_Hans',
    'zh_Hant',
  ];

  it('exposes every locale in the eager map', () => {
    expect(Object.keys(eagerLocales).sort()).toEqual([...expectedKeys].sort());
  });

  it('exposes every locale in the lazy map', () => {
    expect(Object.keys(localeLoaders).sort()).toEqual([...expectedKeys].sort());
  });

  it('keeps the hand-written eager import list in sync with the glob', () => {
    // `eagerLocales` is a named-import list (Rollup can only tree-shake that
    // form) while `localeLoaders` is a glob, so they can drift apart. A locale
    // missing from the list would work in the standard build and break in the
    // single-file one, which cannot use dynamic imports.
    expect(Object.keys(eagerLocales).sort()).toEqual(Object.keys(localeLoaders).sort());
  });

  it('resolves eagerly bundled tables for the single target', async () => {
    const loader = getLocaleLoaderFor('single');
    const table = (await loader('zh_Hans')) as unknown as Record<string, unknown>;

    // Spot-check real generated data rather than just the shape.
    expect(table['Task Name']).toBe('任务名称');
    const rpc = table.rpc as Record<string, Record<string, string>>;
    expect(rpc.error.unauthorized).toBe('认证失败!');
  });

  it("rejects an unknown locale for the 'single' target", async () => {
    await expect(getLocaleLoaderFor('single')('kl_GL')).rejects.toThrow(/unknown locale/);
  });

  it('serves the same data through the lazy target', async () => {
    const lazy = (await getLocaleLoaderFor('standard')('de_DE')) as unknown as Record<string, unknown>;
    const eager = (await getLocaleLoaderFor('single')('de_DE')) as unknown as Record<string, unknown>;

    expect(lazy['Task Name']).toBe(eager['Task Name']);
  });

  it("rejects an unknown locale for the 'standard' target", async () => {
    await expect(getLocaleLoaderFor('standard')('kl_GL')).rejects.toThrow(/unknown locale/);
  });

  it('feeds the store a usable table', async () => {
    const store = createI18n({
      loader: getLocaleLoaderFor('single'),
      syncMdui: false,
    });

    await store.setLocale('ru_RU');

    expect(store.t('Task Name')).toBe('Имя задачи');
    expect(store.t('More Than One Day')).toBe('Более одного дня');
    // Not translated upstream -> English.
    expect(store.t('Never Heard Of This')).toBe('Never Heard Of This');
  });
});

describe('HTML safety', () => {
  it('returns markup as literal text rather than parsing it', async () => {
    // AriaNg piped translations through ng-bind-html. Here a translation is
    // always a plain string the renderer must treat as a text child.
    const table: TranslationTable = parseLanguageIni(
      '[global]\nDanger=<img src=x onerror=alert(1)>\n',
    );
    const store = createI18n({ loader: () => Promise.resolve(table), syncMdui: false });

    await store.setLocale('en');

    expect(store.t('Danger')).toBe('<img src=x onerror=alert(1)>');
  });
});