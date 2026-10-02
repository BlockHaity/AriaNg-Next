/**
 * AriaNg's translation-resource format, ported verbatim.
 *
 * AriaNg did not ship "real" INI files: `src/langs/*.txt` use a bespoke,
 * barely-documented dialect that the language loader hand-parsed. To stay
 * byte-compatible with the upstream tables (and with anything a user drops
 * into `public/langs/`), the quirks below are preserved on purpose rather
 * than cleaned up.
 *
 * Sources:
 *  - `src/scripts/services/ariaNgLanguageLoader.js` — `getLanguageObject`,
 *    `getCategory`, `getKeyValuePair`
 *  - `src/scripts/config/configuration.js` — `$translateProvider` setup
 *    (`useLoaderCache`, `registerAvailableLanguageKeys`, `fallbackLanguage`)
 */

import type { TranslationTable } from './types';

/**
 * The shape the AriaNg tables actually have at runtime.
 *
 * `types.ts` declares `TranslationTable` as
 * `{ [section: string]: TranslationBundle | TranslationTable }`, which stops
 * one level short of the data: it types a leaf as a `TranslationBundle` (an
 * object of strings) whereas AriaNg stores a plain `string` there — e.g.
 * `table['Task Name'] === 'Task Name'` and
 * `table.options['dir.name'] === 'Directory'`. A `TranslationNode` and a
 * `TranslationTable` describe the same runtime object, so the two cross with a
 * cast, and every function below keeps its public signature in terms of the
 * shared `TranslationTable` while working on `TranslationNode` internally.
 */
export type TranslationNode = { [key: string]: string | TranslationNode };

/** Section header whose keys live at the root of the table, unprefixed. */
const GLOBAL_SECTION = 'global';

/** `/^\[.+\]$/` — a header needs at least one character between the brackets. */
const SECTION_PATTERN = /^\[.+\]$/;

/** A node is a sub-table when it is a plain object; leaves are strings. */
function isTable(value: string | TranslationNode): value is TranslationNode {
  return typeof value === 'object' && value !== null;
}

/**
 * AriaNg's `getKeyValuePair`.
 *
 * The delimiter is the first `=` that is **not** escaped by a preceding
 * backslash; `key\=name=value` yields the key `key=name` and the value
 * `value`. A leading `=` is never a delimiter (the scan starts at `i > 0`),
 * and a line with no delimiter at all is reported as a value-only pair, which
 * the caller then drops because `key` is missing.
 *
 * Note the deliberate quirk: AriaNg unescaped with `String#replace` given a
 * *string* pattern, which only ever replaces the first `\=` on each side. We
 * match that, because the shipped `cz_CZ` / `es` / `fr_FR` / ... tables were
 * generated with it and a "smarter" replace-all would silently diverge from
 * upstream for any key or value containing two or more escapes.
 */
function getKeyValuePair(line: string): { key?: string; value: string } {
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
 * AriaNg's `getCategory`: resolve (creating as needed) the object a section
 * header points at.
 *
 * - `[global]` is the root of the table, so its keys stay unprefixed.
 * - Any other name is split on `.` and walked level by level, so `[rpc.error]`
 *   nests as `table.rpc.error`.
 * - Missing intermediate objects are created, which is why section order in
 *   the file does not matter.
 */
function getCategory(langObj: TranslationNode, category: string): TranslationNode {
  let currentCategory = langObj;

  if (!category) {
    return currentCategory;
  }

  if (category[0] === '[' && category[category.length - 1] === ']') {
    category = category.substring(1, category.length - 1);
  }

  if (category === GLOBAL_SECTION) {
    return currentCategory;
  }

  const categoryNames = category.split('.');

  for (const categoryName of categoryNames) {
    if (!isTable(currentCategory[categoryName])) {
      currentCategory[categoryName] = {};
    }

    currentCategory = currentCategory[categoryName];
  }

  return currentCategory;
}

/**
 * AriaNg's `getLanguageObject`.
 *
 * Behaviour, quirks included:
 *  - `''` input yields `{}`.
 *  - Lines are split on `\n` only; a single leading `\r` is stripped *after*
 *    the "is this line empty?" check, so a bare `"\r"` line (a CRLF blank
 *    line) is still parsed and then dropped for having no `=`.
 *  - Blank lines and comment-free `#`/`;` prefixes are not a thing here: any
 *    line that is not a section header and has no unescaped `=` is ignored.
 *  - Entries with an empty key **or** an empty value are dropped entirely —
 *    this is what makes an untranslated string fall back to English.
 */
export function parseLanguageIni(content: string): TranslationTable {
  const langObj: TranslationNode = {};

  if (!content) {
    return langObj as unknown as TranslationTable;
  }

  const lines = content.split('\n');
  let currentCatagory = langObj;

  for (const rawLine of lines) {
    if (!rawLine) {
      continue;
    }

    const line = rawLine.replace('\r', '');

    if (SECTION_PATTERN.test(line)) {
      currentCatagory = getCategory(langObj, line);
      continue;
    }

    const pair = getKeyValuePair(line);

    if (pair && pair.key && pair.value && pair.value !== '') {
      currentCatagory[pair.key] = pair.value;
    }
  }

  return langObj as unknown as TranslationTable;
}

/**
 * Nested table -> `{ 'dotted.path': 'value' }`.
 *
 * Keys stored at the root of the table (everything from `[global]`) come back
 * unprefixed, so `t('Task Name')` and `t('options.dir.name')` address the
 * same namespace they did in AriaNg. Insertion order is preserved, which
 * keeps the language-picker and the option catalogue deterministic.
 *
 * Note that a handful of AriaNg root keys contain `.` as part of ordinary
 * prose (`'Failed to change some tasks state.'`). They survive flattening
 * unchanged and `t()` resolves them fine, but they cannot survive
 * {@link unflattenTable} — the format has no escape for an embedded dot.
 */
export function flattenTable(table: TranslationTable): Record<string, string> {
  const flat: Record<string, string> = {};

  const walk = (node: TranslationNode, prefix: string): void => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      const path = prefix ? `${prefix}.${key}` : key;

      if (isTable(value)) {
        walk(value, path);
      } else {
        flat[path] = value;
      }
    }
  };

  walk(table as unknown as TranslationNode, '');

  return flat;
}

/**
 * `{ 'dotted.path': 'value' }` -> nested table. Inverse of
 * {@link flattenTable}, so `unflattenTable(flattenTable(t))` deep-equals `t`
 * for every table whose leaf keys are dot-free (see the note above).
 *
 * A key whose value is an empty string is dropped, mirroring the parser: it
 * could never have come out of {@link parseLanguageIni} in the first place.
 */
export function unflattenTable(flat: Record<string, string>): TranslationTable {
  const table: TranslationNode = {};

  for (const path of Object.keys(flat)) {
    const value = flat[path];

    if (value === '') {
      continue;
    }

    const parts = path.split('.');
    let node = table;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];

      if (!isTable(node[part])) {
        node[part] = {};
      }

      node = node[part] as TranslationNode;
    }

    node[parts[parts.length - 1]] = value;
  }

  return table as unknown as TranslationTable;
}

/**
 * Compares two flattened tables.
 *
 * - `missing` — keys present in `base` but absent from `other` (i.e. strings
 *   the translation never provided; English fills them in at runtime).
 * - `extra` — keys present in `other` but absent from `base` (i.e. strings
 *   the English master does not define at all; those resolve to the key).
 *
 * Both lists are sorted so reports are stable.
 */
export function diffKeys(
  base: Record<string, string>,
  other: Record<string, string>,
): { missing: string[]; extra: string[] } {
  const missing = Object.keys(base).filter((key) => !(key in other));
  const extra = Object.keys(other).filter((key) => !(key in base));

  return { missing: missing.sort(), extra: extra.sort() };
}