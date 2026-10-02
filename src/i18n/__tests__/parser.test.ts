import { describe, expect, it } from 'vitest';

import { diffKeys, flattenTable, parseLanguageIni, unflattenTable } from '../parser';
import type { TranslationTable } from '../types';

/** Read back through the shared type; leaves are strings at runtime. */
function leaf(table: TranslationTable, path: string): unknown {
  const value = flattenTable(table)[path];
  return value;
}

describe('parseLanguageIni', () => {
  it('returns an empty table for empty input', () => {
    expect(parseLanguageIni('')).toEqual({});
  });

  it('maps [global] keys to the root of the table, unprefixed', () => {
    const table = parseLanguageIni('[global]\nTask Name=Task Name\nStart=Start\n');

    expect(flattenTable(table)).toEqual({ 'Task Name': 'Task Name', Start: 'Start' });
    // Nothing was nested under a `global` property.
    expect(Object.keys(table)).toEqual(['Task Name', 'Start']);
  });

  it('splits a dotted section name into nested objects', () => {
    const table = parseLanguageIni('[rpc.error]\nunauthorized=Authorization Failed!\n');

    expect(table.rpc).toEqual({ error: { unauthorized: 'Authorization Failed!' } });
    expect(leaf(table, 'rpc.error.unauthorized')).toBe('Authorization Failed!');
  });

  it('nests keys that themselves contain dots inside a section', () => {
    const table = parseLanguageIni(
      '[options]\ndir.name=Directory\ndir.description=Directory to store downloaded file.\n',
    );

    expect(table.options).toEqual({
      'dir.name': 'Directory',
      'dir.description': 'Directory to store downloaded file.',
    });
    expect(leaf(table, 'options.dir.name')).toBe('Directory');
  });

  it('keeps keys and values that use the "\\=" escape', () => {
    const table = parseLanguageIni(
      '[global]\nTips: use the "scale\\=n" tag=Utiliser l\'étiquette "scale\\=n"\n',
    );

    // The first unescaped `=` is the delimiter; the escaped one stays inside.
    expect(flattenTable(table)).toEqual({
      'Tips: use the "scale=n" tag': 'Utiliser l\'étiquette "scale=n"',
    });
  });

  it('splits on the first unescaped "=", not on an escaped one', () => {
    const table = parseLanguageIni('[global]\na\\=b=c\\=d\n');

    // Key `a\=b` -> `a=b`, value `c\=d` -> `c=d` (one unescape per side).
    expect(flattenTable(table)).toEqual({ 'a=b': 'c=d' });
  });

  it('preserves AriaNg\'s first-occurrence-only unescape', () => {
    // AriaNg unescaped with `String#replace('<string>')`, which replaces only
    // the first occurrence. Kept for byte-compatibility with the shipped
    // tables; a replace-all would diverge from upstream here.
    const table = parseLanguageIni('[global]\nkey\\=a\\=b=value\n');

    expect(flattenTable(table)).toEqual({ 'key=a\\=b': 'value' });
  });

  it('drops entries whose value is empty', () => {
    const table = parseLanguageIni('[global]\nEmpty=\nPresent=value\n');

    expect(flattenTable(table)).toEqual({ Present: 'value' });
  });

  it('drops entries whose key is empty', () => {
    const table = parseLanguageIni('[global]\n=value\nPresent=value\n');

    expect(flattenTable(table)).toEqual({ Present: 'value' });
  });

  it('handles CRLF line endings', () => {
    const table = parseLanguageIni('[global]\r\nTask Name=Task Name\r\n\r\nStart=Start\r\n');

    expect(flattenTable(table)).toEqual({ 'Task Name': 'Task Name', Start: 'Start' });
  });

  it('ignores blank lines', () => {
    const table = parseLanguageIni('[global]\n\n\nA=1\n\n\nB=2\n');

    expect(flattenTable(table)).toEqual({ A: '1', B: '2' });
  });

  it('ignores a line without an unescaped "="', () => {
    const table = parseLanguageIni('[global]\nno delimiter here\nPresent=value\n');

    expect(flattenTable(table)).toEqual({ Present: 'value' });
  });

  it('treats a leading "=" as a value-less line, not a delimiter', () => {
    // The scan starts at i > 0, so `=x` has no key at all.
    const table = parseLanguageIni('[global]\n=orphaned\nPresent=value\n');

    expect(flattenTable(table)).toEqual({ Present: 'value' });
  });

  it('ignores a malformed section header', () => {
    // `/^\[.+\]$/` needs at least one character between the brackets.
    const table = parseLanguageIni('[]\nStray=value\n');

    // `Stray` landed in the root, exactly like AriaNg.
    expect(flattenTable(table)).toEqual({ Stray: 'value' });
  });

  it('re-opens a section and merges into the same nested object', () => {
    const table = parseLanguageIni(
      '[rpc.error]\nunauthorized=Authorization Failed!\n\n[global]\nA=1\n\n[rpc.error]\nother=Other\n',
    );

    expect(table.rpc).toEqual({ error: { unauthorized: 'Authorization Failed!', other: 'Other' } });
  });

  it('keeps the last value when a key repeats', () => {
    const table = parseLanguageIni('[global]\nA=first\nA=second\n');

    expect(flattenTable(table)).toEqual({ A: 'second' });
  });

  it('preserves insertion order so catalogues stay deterministic', () => {
    const table = parseLanguageIni('[global]\nZ=1\nA=2\nM=3\n');

    expect(Object.keys(flattenTable(table))).toEqual(['Z', 'A', 'M']);
  });
});

describe('flattenTable', () => {
  const table = parseLanguageIni(
    [
      '[global]',
      'Task Name=Task Name',
      '',
      '[error]',
      'network.problem=Network problem',
      '',
      '[rpc.error]',
      'unauthorized=Authorization Failed!',
      '',
      '[options]',
      'dir.name=Directory',
    ].join('\n'),
  );

  it('leaves root keys unprefixed and prefixes nested ones', () => {
    expect(flattenTable(table)).toEqual({
      'Task Name': 'Task Name',
      'error.network.problem': 'Network problem',
      'rpc.error.unauthorized': 'Authorization Failed!',
      'options.dir.name': 'Directory',
    });
  });

  it('leaves keys that merely contain a dot alone at the root', () => {
    // AriaNg has a number of full-sentence root keys with a trailing period.
    // They must not be mistaken for paths.
    const withProse = parseLanguageIni('[global]\nFailed to change some tasks state.=nope\n');

    expect(flattenTable(withProse)).toEqual({ 'Failed to change some tasks state.': 'nope' });
  });

  it('returns an empty object for an empty table', () => {
    expect(flattenTable({})).toEqual({});
  });
});

describe('unflattenTable', () => {
  it('rebuilds the nested structure', () => {
    expect(
      unflattenTable({
        'Task Name': 'Task Name',
        'rpc.error.unauthorized': 'Authorization Failed!',
      }),
    ).toEqual({
      'Task Name': 'Task Name',
      rpc: { error: { unauthorized: 'Authorization Failed!' } },
    });
  });

  it('splits on every dot, so a dotted leaf key nests one level deeper', () => {
    // AriaNg stores the option catalogue as literal keys like
    // `options['dir.name']`, which the flattening renders as
    // `options.dir.name`. There is no escape in the format for telling a
    // section separator from an in-key dot, so `unflattenTable` always reads
    // it as a separator. Runtime lookup is unaffected — `t()` works off the
    // flattened form — but this is why `unflattenTable` is a flattening helper
    // and not a parser replacement.
    expect(unflattenTable({ 'options.dir.name': 'Directory' })).toEqual({
      options: { dir: { name: 'Directory' } },
    });
  });

  it('drops entries with an empty value, mirroring the parser', () => {
    expect(unflattenTable({ A: '1', B: '' })).toEqual({ A: '1' });
  });

  it('round-trips a parsed table whose leaf keys are dot-free', () => {
    const source = [
      '[global]',
      'Task Name=Task Name',
      'Start=Start',
      '',
      '[error]',
      'problem=Network problem',
      '',
      '[rpc.error]',
      'unauthorized=Authorization Failed!',
      '',
      '[format]',
      'longdate=MM/DD/YYYY HH:mm:ss',
    ].join('\n');

    const parsed = parseLanguageIni(source);

    expect(unflattenTable(flattenTable(parsed))).toEqual(parsed);
  });

  it('round-trips a parsed table with in-key dots up to that depth', () => {
    // `options.dir.name` survives as long as the parse also treats `.` as a
    // separator, so parse -> flatten -> unflatten is idempotent from the
    // second application onwards. Asserted explicitly so the behaviour is a
    // documented contract rather than an accident.
    const parsed = parseLanguageIni('[options]\ndir.name=Directory\n');

    const once = unflattenTable(flattenTable(parsed));

    expect(once).toEqual({ options: { dir: { name: 'Directory' } } });
    expect(unflattenTable(flattenTable(once))).toEqual(once);
  });
});

describe('diffKeys', () => {
  const base = { A: '1', B: '2', C: '3' };

  it('reports nothing when both tables match', () => {
    expect(diffKeys(base, { A: '1', B: '2', C: '3' })).toEqual({ missing: [], extra: [] });
  });

  it('reports keys present only in the base as missing', () => {
    expect(diffKeys(base, { A: '1' })).toEqual({ missing: ['B', 'C'], extra: [] });
  });

  it('reports keys present only in the other table as extra', () => {
    expect(diffKeys(base, { A: '1', B: '2', C: '3', D: '4' })).toEqual({
      missing: [],
      extra: ['D'],
    });
  });

  it('sorts both lists for stable reporting', () => {
    expect(diffKeys({ Z: '1', A: '1' }, { M: '1', B: '1' })).toEqual({
      missing: ['A', 'Z'],
      extra: ['B', 'M'],
    });
  });

  it('ignores differing values, only key sets', () => {
    expect(diffKeys({ A: '1' }, { A: 'other' })).toEqual({ missing: [], extra: [] });
  });

  it('diffs a real English-vs-translation pair', () => {
    // The shape of the shipped generator report: a partial translation has
    // `missing` entries, and an empty translation has everything missing.
    const parsed = parseLanguageIni('[global]\nStart=Start\nEmpty=\n');

    expect(diffKeys({ Start: 'Start', Pause: 'Pause' }, flattenTable(parsed))).toEqual({
      missing: ['Pause'],
      extra: [],
    });
  });
});