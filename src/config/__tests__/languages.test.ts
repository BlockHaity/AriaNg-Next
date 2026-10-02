import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE_KEY,
  DEFAULT_LONG_DATE_PATTERN,
  LONG_DATE_PATTERNS,
  LANGUAGES,
  MDUI_LOCALE_FILES,
  detectBrowserLanguage,
  getLanguageByKey,
  getLongDatePattern,
  isMduiLocale,
  resolveLanguageByAlias,
  toMduiLocale,
} from '../languages';

/** AriaNg's `ariaNgLanguages`, 1:1. */
const ARIA_NG_LANGUAGES: Array<{ key: string; name: string; displayName: string; aliases: string[] }> =
  [
    { key: 'cz_CZ', name: 'Czech', displayName: 'Čeština', aliases: [] },
    { key: 'de_DE', name: 'German', displayName: 'Deutsch', aliases: [] },
    { key: 'en', name: 'English', displayName: 'English', aliases: [] },
    { key: 'es', name: 'Spanish', displayName: 'Español', aliases: [] },
    { key: 'fr_FR', name: 'French', displayName: 'Français', aliases: [] },
    { key: 'it_IT', name: 'Italian', displayName: 'Italiano', aliases: [] },
    { key: 'ja_JP', name: 'Japanese', displayName: '日本語', aliases: [] },
    { key: 'pl_PL', name: 'Polish', displayName: 'Polski', aliases: [] },
    { key: 'ru_RU', name: 'Russian', displayName: 'Русский', aliases: [] },
    { key: 'zh_Hans', name: 'Simplified Chinese', displayName: '简体中文', aliases: ['zh_CHS', 'zh_CN', 'zh_SG'] },
    { key: 'zh_Hant', name: 'Traditional Chinese', displayName: '繁體中文', aliases: ['zh_CHT', 'zh_TW', 'zh_HK', 'zh_MO'] },
  ];

describe('LANGUAGES', () => {
  it('ports all 11 languages in AriaNg\'s declaration order', () => {
    expect(LANGUAGES).toHaveLength(11);
    expect(LANGUAGES.map((language) => language.key)).toEqual(ARIA_NG_LANGUAGES.map((l) => l.key));
  });

  it('ports every name, endonym and alias', () => {
    for (const expected of ARIA_NG_LANGUAGES) {
      const language = getLanguageByKey(expected.key);
      expect(language, expected.key).toBeDefined();
      expect(language?.name).toBe(expected.name);
      expect(language?.displayName).toBe(expected.displayName);
      expect(language?.aliases).toEqual(expected.aliases);
    }
  });

  it('defaults to English', () => {
    expect(DEFAULT_LANGUAGE_KEY).toBe('en');
    expect(getLanguageByKey('en')?.name).toBe('English');
  });

  it('gives every language a lower-case hyphenated mdui locale', () => {
    for (const language of LANGUAGES) {
      expect(language.mduiLocale, language.key).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(language.mduiLocale).toBe(language.mduiLocale.toLowerCase());
    }

    expect(LANGUAGES.map((language) => language.mduiLocale)).toEqual([
      'cs',
      'de',
      'en',
      'es',
      'fr',
      'it',
      'ja',
      'pl',
      'ru',
      'zh-cn',
      'zh-tw',
    ]);
  });

  it('never repeats a key, an alias or an mdui locale', () => {
    const keys = LANGUAGES.map((language) => language.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);

    const aliases = LANGUAGES.flatMap((language) => language.aliases.map((alias) => alias.toLowerCase()));
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const alias of aliases) {
      expect(keys).not.toContain(alias);
    }

    const locales = LANGUAGES.map((language) => language.mduiLocale);
    expect(new Set(locales).size).toBe(locales.length);
  });
});

describe('getLanguageByKey', () => {
  it('finds a language by key, case-insensitively', () => {
    expect(getLanguageByKey('zh_Hans')?.displayName).toBe('简体中文');
    expect(getLanguageByKey('ZH_HANS')?.key).toBe('zh_Hans');
    expect(getLanguageByKey('ru_ru')?.key).toBe('ru_RU');
  });

  it('does not resolve aliases', () => {
    expect(getLanguageByKey('zh_CN')).toBeUndefined();
    expect(getLanguageByKey('zh-CN')).toBeUndefined();
  });

  it('is undefined for unknown or empty keys', () => {
    expect(getLanguageByKey('xx')).toBeUndefined();
    expect(getLanguageByKey('')).toBeUndefined();
  });
});

describe('resolveLanguageByAlias', () => {
  it('resolves exact keys', () => {
    expect(resolveLanguageByAlias('ja_JP')?.key).toBe('ja_JP');
    expect(resolveLanguageByAlias('ja_jp')?.key).toBe('ja_JP');
  });

  it('resolves Simplified Chinese aliases case-insensitively', () => {
    expect(resolveLanguageByAlias('zh_CN')?.key).toBe('zh_Hans');
    expect(resolveLanguageByAlias('zh_cn')?.key).toBe('zh_Hans');
    expect(resolveLanguageByAlias('ZH_CN')?.key).toBe('zh_Hans');
    expect(resolveLanguageByAlias('zh-CHS')?.key).toBe('zh_Hans');
    expect(resolveLanguageByAlias('zh_SG')?.key).toBe('zh_Hans');
  });

  it('resolves Traditional Chinese aliases case-insensitively', () => {
    expect(resolveLanguageByAlias('zh_TW')?.key).toBe('zh_Hant');
    expect(resolveLanguageByAlias('zh-TW')?.key).toBe('zh_Hant');
    expect(resolveLanguageByAlias('zh-HK')?.key).toBe('zh_Hant');
    expect(resolveLanguageByAlias('zh_hk')?.key).toBe('zh_Hant');
    expect(resolveLanguageByAlias('zh_MO')?.key).toBe('zh_Hant');
    expect(resolveLanguageByAlias('zh_CHT')?.key).toBe('zh_Hant');
  });

  it('is undefined for unknown or empty aliases', () => {
    expect(resolveLanguageByAlias('xx')).toBeUndefined();
    expect(resolveLanguageByAlias('')).toBeUndefined();
  });
});

describe('detectBrowserLanguage', () => {
  it('matches a hyphenated Simplified Chinese tag', () => {
    expect(detectBrowserLanguage(['zh-CN']).key).toBe('zh_Hans');
    expect(detectBrowserLanguage(['zh-HK']).key).toBe('zh_Hant');
    expect(detectBrowserLanguage(['zh']).key).toBe('en');
  });

  it('matches a bare language tag', () => {
    expect(detectBrowserLanguage(['ja']).key).toBe('ja_JP');
    expect(detectBrowserLanguage(['ja-JP']).key).toBe('ja_JP');
  });

  it('matches a full region tag', () => {
    expect(detectBrowserLanguage(['de-DE', 'en']).key).toBe('de_DE');
    expect(detectBrowserLanguage(['fr-FR']).key).toBe('fr_FR');
    expect(detectBrowserLanguage(['ru-RU']).key).toBe('ru_RU');
    expect(detectBrowserLanguage(['it-IT']).key).toBe('it_IT');
    expect(detectBrowserLanguage(['pl-PL']).key).toBe('pl_PL');
    expect(detectBrowserLanguage(['es']).key).toBe('es');

    // AriaNg's Czech key is `cz_CZ`, upstream spelling and all; the ISO code is
    // `cs`, so `cs-CZ` is not a hit and we land on English.
    expect(detectBrowserLanguage(['cs-CZ']).key).toBe('en');
    expect(detectBrowserLanguage(['cz']).key).toBe('cz_CZ');
    expect(detectBrowserLanguage(['cz-CZ']).key).toBe('cz_CZ');
  });

  it('walks the list in navigator.languages order', () => {
    expect(detectBrowserLanguage(['xx', 'de-DE', 'en']).key).toBe('de_DE');
    expect(detectBrowserLanguage(['xx', 'yy', 'en']).key).toBe('en');
  });

  it('narrows an unknown region down to the bare language', () => {
    expect(detectBrowserLanguage(['ja-JP-x', 'en']).key).toBe('ja_JP');
    expect(detectBrowserLanguage(['en-US']).key).toBe('en');
    expect(detectBrowserLanguage(['de-CH']).key).toBe('de_DE');
  });

  it('falls back to English', () => {
    expect(detectBrowserLanguage(['xx']).key).toBe('en');
    expect(detectBrowserLanguage([]).key).toBe('en');
    expect(detectBrowserLanguage(['']).key).toBe('en');
  });

  it('skips empty entries', () => {
    expect(detectBrowserLanguage(['', 'fr', '']).key).toBe('fr_FR');
  });
});

describe('isMduiLocale', () => {
  it('accepts the canonical subtags', () => {
    for (const language of LANGUAGES) {
      expect(isMduiLocale(language.mduiLocale)).toBe(true);
      expect(isMduiLocale(language.mduiLocale.toUpperCase())).toBe(true);
    }
  });

  it('accepts mdui\'s region-qualified bundle names', () => {
    expect(isMduiLocale('de-DE')).toBe(true);
    expect(isMduiLocale('de_de')).toBe(true);
    expect(isMduiLocale('ja-JP')).toBe(true);
    expect(isMduiLocale('zh-CN')).toBe(true);
    expect(isMduiLocale('en-GB')).toBe(true);
  });

  it('rejects unsupported and empty locales', () => {
    expect(isMduiLocale('zh-Hant')).toBe(false);
    expect(isMduiLocale('ko-KR')).toBe(false);
    expect(isMduiLocale('')).toBe(false);
  });
});

describe('toMduiLocale', () => {
  it('maps every language key', () => {
    expect(toMduiLocale('cz_CZ')).toBe('cs');
    expect(toMduiLocale('en')).toBe('en');
    expect(toMduiLocale('ja_JP')).toBe('ja');
    expect(toMduiLocale('zh_Hans')).toBe('zh-cn');
    expect(toMduiLocale('zh_Hant')).toBe('zh-tw');
  });

  it('accepts aliases and any casing', () => {
    expect(toMduiLocale('zh-CN')).toBe('zh-cn');
    expect(toMduiLocale('zh-HK')).toBe('zh-tw');
    expect(toMduiLocale('JA_jp')).toBe('ja');
  });

  it('falls back to English for unknown keys', () => {
    expect(toMduiLocale('xx')).toBe('en');
    expect(toMduiLocale('')).toBe('en');
  });
});

describe('MDUI_LOCALE_FILES', () => {
  it('covers every language with a bundle mdui actually ships', () => {
    expect(Object.keys(MDUI_LOCALE_FILES).sort()).toEqual(LANGUAGES.map((l) => l.key).sort());
    for (const bundle of Object.values(MDUI_LOCALE_FILES)) {
      expect(bundle).toMatch(/^[a-z]+-[a-z]+$/);
    }
  });
});

describe('LONG_DATE_PATTERNS', () => {
  it('recovers AriaNg\'s per-language format.longdate', () => {
    // AriaNg stored these in `src/langs/*.txt` under `[format] longdate=…`,
    // in moment.js syntax. These are the same patterns in Intl syntax.
    expect(LONG_DATE_PATTERNS).toEqual({
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
    });
  });

  it('defaults to the US pattern', () => {
    expect(DEFAULT_LONG_DATE_PATTERN).toBe('MM/dd/yyyy HH:mm:ss');
    expect(DEFAULT_LONG_DATE_PATTERN).toBe(LONG_DATE_PATTERNS.en);
  });

  it('uses Intl tokens only (never moment\'s YYYY / DD / RRRR)', () => {
    for (const [key, pattern] of Object.entries(LONG_DATE_PATTERNS)) {
      expect(pattern, key).not.toMatch(/[YDR](?![a-z])/);
      expect(pattern, key).toContain('HH:mm:ss');
      expect(pattern.replace(/[^a-z]/g, ''), key).toContain('yyyy');
    }
  });

  it('is mirrored onto every language and looked up with a fallback', () => {
    for (const language of LANGUAGES) {
      expect(language.longDatePattern).toBe(LONG_DATE_PATTERNS[language.key]);
      expect(getLongDatePattern(language.key)).toBe(LONG_DATE_PATTERNS[language.key]);
    }
    expect(getLongDatePattern('xx')).toBe(DEFAULT_LONG_DATE_PATTERN);
  });
});