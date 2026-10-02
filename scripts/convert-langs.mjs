#!/usr/bin/env node
/**
 * Generates the i18n data modules from the original AriaNg translation sources.
 *
 *   node scripts/convert-langs.mjs            # write only when content changes
 *   node scripts/convert-langs.mjs --check    # exit 1 if any file is stale
 *   ARIANG_SRC=/path/to/AriaNg node scripts/convert-langs.mjs
 *
 * Inputs:
 *   <src>/src/scripts/config/defaultLanguage.js  -> src/i18n/en.ts
 *   <src>/src/langs/*.txt                       -> src/i18n/locales/<key>.ts
 *
 * The INI dialect accepted by `langs/*.txt` is AriaNg's, not a real INI
 * format, and is ported verbatim from
 * `src/scripts/services/ariaNgLanguageLoader.js` (`getLanguageObject` /
 * `getCategory` / `getKeyValuePair`) so that the generated tables are
 * byte-for-byte what AriaNg itself would have produced at runtime.
 *
 * The script is idempotent: it only rewrites a file when the rendered text
 * differs, and it prints a per-locale summary (total / missing / extra keys
 * relative to English). Missing keys are fine — English fills the gap at
 * runtime. Extra keys are a real inconsistency and are reported loudly.
 *
 * AriaNg is MIT licensed, Copyright (c) 2015 MaysWind. See NOTICE.md.
 */

/* global process, console */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');

const ARIANG_SRC = process.env.ARIANG_SRC ?? '/tmp/opencode/research/AriaNg';
const DEFAULT_LANGUAGE_FILE = join(ARIANG_SRC, 'src', 'scripts', 'config', 'defaultLanguage.js');
const LANGS_DIR = join(ARIANG_SRC, 'src', 'langs');
const OUT_DIR = join(PROJECT_ROOT, 'src', 'i18n', 'locales');
const EN_OUT_FILE = join(PROJECT_ROOT, 'src', 'i18n', 'en.ts');

const CHECK_ONLY = process.argv.includes('--check');

/**
 * Expected key total of the English master table.
 *
 * The census is `[global]` 307 + `[error]` 30 + `[languages]` 11 + `[format]` 17
 * + `[rpc.error]` 1 + `[option]` 38 + `[options]` 320 = 724 — but upstream
 * `defaultLanguage.js` only ships **10** `[languages]` entries (it is missing
 * `'Japanese'`), so the real unique total is 723. See
 * {@link KNOWN_UPSTREAM_EXTRAS}.
 */
const EXPECTED_EN_KEYS = 723;

/**
 * Extra keys that are upstream AriaNg defects rather than conversion bugs.
 *
 * They are still reported — loudly, in their own block — but they do not fail
 * the run, because we cannot fix them from here without inventing English
 * data. `t()` simply never resolves them (they resolve to the key itself),
 * exactly like AriaNg behaved for the missing `languages.Japanese` lookup.
 *
 * - `languages.Japanese` (every locale): AriaNg's `defaultLanguage.js` forgot
 *   to include `'Japanese'` in its `languages` block, so every `langs/*.txt`
 *   legitimately has one key the English table does not.
 * - `options.metalink-os.descriptionURI di base` (fr_FR only): an unescaped
 *   typo in AriaNg's `fr_FR.txt` — the key should read `description`.
 */
const KNOWN_UPSTREAM_EXTRAS = {
  cz_CZ: ['languages.Japanese'],
  de_DE: ['languages.Japanese'],
  es: ['languages.Japanese'],
  fr_FR: ['languages.Japanese', 'options.metalink-os.descriptionURI di base'],
  it_IT: ['languages.Japanese'],
  ja_JP: ['languages.Japanese'],
  pl_PL: ['languages.Japanese'],
  ru_RU: ['languages.Japanese'],
  zh_Hans: ['languages.Japanese'],
  zh_Hant: ['languages.Japanese'],
};

/* ------------------------------------------------------------------ */
/* AriaNg INI parser (verbatim port)                                    */
/* ------------------------------------------------------------------ */

/**
 * AriaNg's `getKeyValuePair`.
 *
 * The delimiter is the first `=` that is *not* escaped by a preceding
 * backslash. Note that AriaNg used `String#replace` with a *string* pattern,
 * which only ever unescapes the FIRST `\=` of the key and of the value. We
 * keep that quirk so the generated tables match AriaNg exactly.
 *
 * @param {string} line
 * @returns {{key?: string, value: string}}
 */
function getKeyValuePair(line) {
  for (let i = 0; i < line.length; i++) {
    if (i > 0 && line.charAt(i - 1) !== '\\' && line.charAt(i) === '=') {
      return {
        key: line.substring(0, i).replace('\\=', '='),
        value: line.substring(i + 1, line.length).replace('\\=', '='),
      };
    }
  }

  return { value: line };
}

/**
 * AriaNg's `getCategory`: resolves (and creates) the object a `[section]`
 * header points at. `[global]` maps to the root; any other name is split on
 * `.` and walked/created level by level.
 *
 * @param {Record<string, any>} langObj
 * @param {string} category raw section header, with or without brackets
 * @returns {Record<string, any>}
 */
function getCategory(langObj, category) {
  let currentCategory = langObj;

  if (!category) {
    return currentCategory;
  }

  if (category[0] === '[' && category[category.length - 1] === ']') {
    category = category.substring(1, category.length - 1);
  }

  if (category === 'global') {
    return currentCategory;
  }

  const categoryNames = category.split('.');

  for (let i = 0; i < categoryNames.length; i++) {
    const categoryName = categoryNames[i];

    if (!currentCategory[categoryName]) {
      currentCategory[categoryName] = {};
    }

    currentCategory = currentCategory[categoryName];
  }

  return currentCategory;
}

/**
 * AriaNg's `getLanguageObject`.
 *
 * Quirks kept on purpose (they are what makes the shipped tables match):
 *  - `\r` is stripped *after* the emptiness check, so a bare `"\r"` line is
 *    still parsed (and dropped, because it has no `=`);
 *  - only the first `\r` of a line is removed;
 *  - entries with an empty key or an empty value are dropped entirely;
 *  - a line with no unescaped `=` (and a leading `=`) is ignored.
 *
 * @param {string} languageContent
 * @returns {Record<string, any>}
 */
function getLanguageObject(languageContent) {
  const langObj = {};

  if (!languageContent) {
    return langObj;
  }

  const lines = languageContent.split('\n');
  let currentCatagory = langObj;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (!line) {
      continue;
    }

    line = line.replace('\r', '');

    if (/^\[.+\]$/.test(line)) {
      currentCatagory = getCategory(langObj, line);
      continue;
    }

    const pair = getKeyValuePair(line);

    if (pair && pair.key && pair.value && pair.value !== '') {
      currentCatagory[pair.key] = pair.value;
    }
  }

  return langObj;
}

/* ------------------------------------------------------------------ */
/* Table helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Nested table -> `{ 'dotted.path': 'value' }`. Keys stored at the root (the
 * `[global]` section) stay unprefixed, exactly like the section layout.
 *
 * @param {Record<string, any>} table
 * @param {string} [prefix]
 * @param {Record<string, string>} [out]
 * @returns {Record<string, string>}
 */
function flattenTable(table, prefix = '', out = {}) {
  for (const key of Object.keys(table)) {
    const value = table[key];
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object') {
      flattenTable(value, path, out);
    } else {
      out[path] = value;
    }
  }

  return out;
}

/**
 * @param {Record<string, string>} base
 * @param {Record<string, string>} other
 * @returns {{missing: string[], extra: string[]}} `missing` = in base only,
 *   `extra` = in other only. Both are sorted for stable reporting.
 */
function diffKeys(base, other) {
  const missing = Object.keys(base).filter((key) => !(key in other));
  const extra = Object.keys(other).filter((key) => !(key in base));

  return { missing: missing.sort(), extra: extra.sort() };
}

/* ------------------------------------------------------------------ */
/* English master table                                                 */
/* ------------------------------------------------------------------ */

/**
 * Finds the balanced `{ ... }` that starts at `start`, skipping over string
 * literals so braces inside translations do not confuse the counter.
 *
 * @param {string} source
 * @param {number} start index of the opening `{`
 * @returns {string}
 */
function sliceBalancedObject(source, start) {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.substring(start, i + 1);
      }
    }
  }

  throw new Error('unbalanced object literal: no matching closing brace');
}

/**
 * AriaNg's English master table lives in a plain JS object literal that is
 * registered with `$translateProvider.translations(...)`. We slice the literal
 * out by brace matching and evaluate it in an empty `node:vm` context, which
 * gives us the exact data without pulling in angular.
 *
 * @param {string} source contents of `defaultLanguage.js`
 * @returns {Record<string, any>}
 */
function extractEnglishTable(source) {
  const anchor = 'var defaultLanguageResource';

  if (!source.includes(anchor)) {
    throw new Error(
      `could not find \`${anchor}\` in defaultLanguage.js — the upstream file layout changed`,
    );
  }

  const braceIndex = source.indexOf('{', source.indexOf(anchor));
  const literal = sliceBalancedObject(source, braceIndex);

  // An empty context: the literal is pure data, but `vm` still needs a
  // sandbox object and a script wrapper to evaluate an expression.
  const sandbox = Object.create(null);
  const context = vm.createContext(sandbox);
  const table = vm.runInContext(`(${literal})`, context, { timeout: 10_000 });

  if (!table || typeof table !== 'object') {
    throw new Error('evaluated English literal is not an object');
  }

  return table;
}

/* ------------------------------------------------------------------ */
/* Emitter                                                              */
/* ------------------------------------------------------------------ */

/**
 * Serialises a nested table as a formatted TS object literal.
 * `JSON.stringify` gives us correct quoting/escaping for keys that contain
 * apostrophes, quotes and newlines.
 *
 * @param {Record<string, any>} table
 * @param {string} indent
 * @returns {string}
 */
function serializeTable(table, indent = '  ') {
  const entries = Object.keys(table).map((key) => {
    const value = table[key];
    const renderedKey = JSON.stringify(key);
    const rendered =
      value !== null && typeof value === 'object'
        ? serializeTable(value, `${indent}  `)
        : JSON.stringify(value);

    return `${indent}${renderedKey}: ${rendered}`;
  });

  if (entries.length === 0) {
    return '{}';
  }

  return `{\n${entries.join(',\n')},\n${indent.slice(2)}}`;
}

const HEADER = (locale, origin) => `/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *
 *     node scripts/convert-langs.mjs
 *
 * Locale:   ${locale}
 * Origin:   ${origin}
 * License:  AriaNg — MIT, Copyright (c) 2015 MaysWind. See NOTICE.md.
 *
 * The translations are AriaNg's; individual contributors are credited in
 * AriaNg's README. Missing keys are expected and fall back to English at
 * runtime (see src/i18n/i18n.ts).
 */
`;

/** Why the literal needs a cast — see src/i18n/parser.ts. */
const CAST_NOTE = `// \`TranslationTable\` types a leaf as a \`TranslationBundle\` (an object of
// strings) while AriaNg's tables hold a plain string there. Both describe the
// same runtime object, so the literal is cast once at the boundary; the
// accurate recursive type is \`TranslationNode\` in ${'../parser'}.`;

/**
 * @param {string} locale
 * @param {string} identifier exported const name
 * @param {Record<string, any>} table
 * @param {string} origin
 * @param {string} typesSpecifier import specifier for `../types`
 * @returns {string}
 */
function renderModule(locale, identifier, table, origin, typesSpecifier) {
  return `${HEADER(locale, origin)}import type { TranslationTable } from '${typesSpecifier}';

${CAST_NOTE}
export const ${identifier}: TranslationTable = ${serializeTable(table)} as unknown as TranslationTable;

export default ${identifier};
`;
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

/** @returns {{written: number, stale: string[]}} */
function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) {
    return { written: 0, stale: [] };
  }

  if (CHECK_ONLY) {
    return { written: 0, stale: [file] };
  }

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');

  return { written: 1, stale: [] };
}

function main() {
  if (!existsSync(DEFAULT_LANGUAGE_FILE) || !existsSync(LANGS_DIR)) {
    console.error(
      `error: AriaNg sources not found under ${ARIANG_SRC}\n` +
        '       set ARIANG_SRC=/path/to/AriaNg and re-run.',
    );
    process.exit(2);
  }

  const english = extractEnglishTable(readFileSync(DEFAULT_LANGUAGE_FILE, 'utf8'));
  const englishFlat = flattenTable(english);

  console.log('AriaNg -> AriaNg-Next translation generator');
  console.log(`  source : ${ARIANG_SRC}`);
  console.log(`  output : ${join('src', 'i18n')}`);
  console.log('');

  let written = 0;
  const stale = [];

  const enResult = writeIfChanged(
    EN_OUT_FILE,
    renderModule(
      'en',
      'en',
      english,
      'AriaNg `src/scripts/config/defaultLanguage.js`',
      './types',
    ),
  );
  written += enResult.written;
  stale.push(...enResult.stale);

  if (englishFlat && Object.keys(englishFlat).length !== EXPECTED_EN_KEYS) {
    console.warn(
      `  ! english has ${Object.keys(englishFlat).length} keys, expected ${EXPECTED_EN_KEYS}`,
    );
  }

  console.log(
    `${'en'.padEnd(10)} total ${String(Object.keys(englishFlat).length).padStart(4)}` +
      `  missing ${String(0).padStart(4)}  extra ${String(0).padStart(4)}  (master)`,
  );

  const localeFiles = readdirSync(LANGS_DIR)
    .filter((name) => name.endsWith('.txt'))
    .sort();

  const rows = [];

  for (const fileName of localeFiles) {
    const locale = fileName.replace(/\.txt$/, '');
    const table = getLanguageObject(readFileSync(join(LANGS_DIR, fileName), 'utf8'));
    const flat = flattenTable(table);
    const { missing, extra } = diffKeys(englishFlat, flat);
    const known = new Set(KNOWN_UPSTREAM_EXTRAS[locale] ?? []);
    const unexpectedExtra = extra.filter((key) => !known.has(key));

    const result = writeIfChanged(
      join(OUT_DIR, `${locale}.ts`),
      renderModule(locale, locale, table, `AriaNg \`src/langs/${fileName}\``, '../types'),
    );
    written += result.written;
    stale.push(...result.stale);

    rows.push({ locale, total: Object.keys(flat).length, missing, extra, unexpectedExtra });
  }

  console.log('');
  for (const row of rows) {
    const flag = row.extra.length > 0 ? ' !' : '  ';
    console.log(
      `${row.locale.padEnd(10)} total ${String(row.total).padStart(4)}` +
        `  missing ${String(row.missing.length).padStart(4)}` +
        `  extra ${String(row.extra.length).padStart(4)}${flag}`,
    );
    if (row.extra.length > 0) {
      console.log(`             extra keys: ${row.extra.slice(0, 10).join(', ')}`);
    }
  }

  const unexpected = rows.filter((row) => row.unexpectedExtra.length > 0);
  if (unexpected.length > 0) {
    console.log('');
    console.log('UNEXPECTED extra keys (real conversion bugs):');
    for (const row of unexpected) {
      console.log(`  ${row.locale}: ${row.unexpectedExtra.join(', ')}`);
    }
  }

  const upstream = rows.filter((row) => row.extra.length - row.unexpectedExtra.length > 0);
  if (upstream.length > 0) {
    console.log('');
    console.log('Known upstream AriaNg defects (reported, not fatal):');
    for (const row of upstream) {
      const keys = row.extra.filter((key) => row.unexpectedExtra.indexOf(key) === -1);
      console.log(`  ${row.locale}: ${keys.join(', ')}`);
    }
    console.log('  -> see KNOWN_UPSTREAM_EXTRAS in scripts/convert-langs.mjs');
  }

  console.log('');

  if (CHECK_ONLY && stale.length > 0) {
    console.error(`error: ${stale.length} generated file(s) are stale:`);
    for (const file of stale) {
      console.error(`  ${file.replace(`${PROJECT_ROOT}/`, '')}`);
    }
    process.exit(1);
  }

  console.log(
    CHECK_ONLY
      ? 'check: all generated files are up to date.'
      : `done: ${written} file(s) written, ${rows.length + 1} locale(s) processed.`,
  );

  if (unexpected.length > 0) {
    process.exit(1);
  }
}

main();