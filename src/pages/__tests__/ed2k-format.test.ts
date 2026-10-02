/**
 * Unit tests for the pure ED2K result helpers.
 *
 * These cover the branches that only fire against a real, slightly-broken
 * daemon: partial rows, decimal strings, and the accumulated (rather than
 * delta) result set that `getEd2kSearchResults` keeps re-sending.
 */

import { describe, expect, it } from 'vitest';

import { readableVolume } from '@/i18n/format';
import {
  UNKNOWN_FILENAME,
  UNKNOWN_SIZE,
  categoryIcon,
  dedupeResults,
  extensionOf,
  formatFileLength,
  mergeResults,
  normalizeResult,
  normalizeResults,
  parseKeywordFromHash,
  resultKey,
  toFileLength,
} from '../ed2k-search/format';
import type { NormalizedEd2kResult } from '../ed2k-search/format';

/** A complete hit, exactly as `getEd2kSearchResults` reports one. */
const COMPLETE = {
  ed2kLink: 'ed2k://|file|ubuntu-24.04.iso|3518384816|A1B2C3D4E5F60718293A4B5C6D7E8F90|/',
  filename: 'ubuntu-24.04.iso',
  fileLength: '3518384816',
  fileHash: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
  mediaCodec: 'H.264',
  sourceNetwork: 'eMule Security',
} as const;

describe('normalizeResult', () => {
  it('normalises a complete result', () => {
    const result = normalizeResult({ ...COMPLETE }, 0);

    expect(result).toEqual({
      key: COMPLETE.ed2kLink,
      ed2kLink: COMPLETE.ed2kLink,
      filename: 'ubuntu-24.04.iso',
      fileLength: 3518384816,
      fileHash: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
      mediaCodec: 'H.264',
      sourceNetwork: 'eMule Security',
      category: 'other',
      isDownloadable: true,
      sourceCount: 1,
    });
  });

  it('accepts a result that carries nothing but the link', () => {
    const result = normalizeResult({ ed2kLink: 'ed2k://|file|a.bin|10|ABCDEF|' }, 3);

    expect(result).not.toBeNull();
    expect(result?.filename).toBe(UNKNOWN_FILENAME);
    expect(result?.fileLength).toBe(0);
    expect(result?.fileHash).toBeUndefined();
    expect(result?.mediaCodec).toBeUndefined();
    expect(result?.sourceNetwork).toBeUndefined();
    expect(result?.category).toBe('other');
    expect(result?.isDownloadable).toBe(true);
    expect(result?.sourceCount).toBe(1);
  });

  it('coerces a decimal string length to a number', () => {
    expect(normalizeResult({ ...COMPLETE }, 0)?.fileLength).toBe(3518384816);
    expect(normalizeResult({ ed2kLink: 'x', filename: 'a.bin', fileLength: '42' }, 0)?.fileLength).toBe(42);
    // Some builds send a JSON number rather than the aria2-style string.
    expect(normalizeResult({ ed2kLink: 'x', filename: 'a.bin', fileLength: 42 }, 0)?.fileLength).toBe(42);
  });

  it('collapses an unusable length to 0 instead of rendering NaN', () => {
    expect(toFileLength('not a number')).toBe(0);
    expect(toFileLength('-5')).toBe(0);
    expect(toFileLength(Number.NaN)).toBe(0);
    expect(toFileLength(undefined)).toBe(0);
    expect(normalizeResult({ ed2kLink: 'x', filename: 'a.bin', fileLength: 'nope' }, 0)?.fileLength).toBe(0);
  });

  it('marks a result without an ed2kLink as not downloadable', () => {
    const result = normalizeResult({ filename: 'mystery.bin', fileHash: 'DEADBEEF', fileLength: '7' }, 1);

    expect(result?.isDownloadable).toBe(false);
    expect(result?.ed2kLink).toBeUndefined();
    // No link, so the key falls back to hash + length.
    expect(result?.key).toBe('hash:deadbeef:7');
  });

  it('never synthesises a link', () => {
    const result = normalizeResult({ filename: 'mystery.bin', fileLength: '7' }, 0);

    expect(result?.ed2kLink).toBeUndefined();
    expect('ed2kLink' in (result as NormalizedEd2kResult)).toBe(true);
    expect(result?.ed2kLink).toBeFalsy();
  });

  it('reads the manual\'s `hash` / `name` / `length` spelling too', () => {
    // The manual lists hash / name / length; Aria2Ed2kSearchResult models the
    // same data as fileHash / filename / fileLength. Both must work.
    const result = normalizeResult(
      {
        ed2kLink: 'ed2k://|file|film.mkv|100|ABCD|',
        hash: 'ABCD',
        name: 'film.mkv',
        length: '100',
        sourceCount: '6',
      },
      0,
    );

    expect(result?.fileHash).toBe('ABCD');
    expect(result?.filename).toBe('film.mkv');
    expect(result?.fileLength).toBe(100);
    expect(result?.sourceCount).toBe(6);
  });

  it('seeds sourceCount from the server, never below one', () => {
    expect(normalizeResult({ ...COMPLETE, sourceCount: '12' }, 0)?.sourceCount).toBe(12);
    expect(normalizeResult({ ...COMPLETE, sourceCount: '0' }, 0)?.sourceCount).toBe(1);
    expect(normalizeResult({ ...COMPLETE, sourceCount: 'lots' }, 0)?.sourceCount).toBe(1);
  });

  it('rejects non-objects and identity-less objects', () => {
    expect(normalizeResult(undefined, 0)).toBeNull();
    expect(normalizeResult(null as never, 0)).toBeNull();
    expect(normalizeResult('nope' as never, 0)).toBeNull();
    expect(normalizeResult(42 as never, 0)).toBeNull();
    // Nothing to show, nothing to dedupe on, nothing to download.
    expect(normalizeResult({} as never, 0)).toBeNull();
    expect(normalizeResult({ mediaCodec: 'H.264' } as never, 0)).toBeNull();
    // …but a name alone is enough to render.
    expect(normalizeResult({ filename: 'only-a-name.bin' }, 0)).not.toBeNull();
  });

  it('derives the category through classifyExtension', () => {
    const category = (filename: string) =>
      normalizeResult({ ed2kLink: 'x', filename, fileLength: '1' }, 0)?.category;

    expect(category('Some.Movie.2024.mkv')).toBe('video');
    expect(category('Track.mp3')).toBe('audio');
    expect(category('bundle.zip')).toBe('archive');
    expect(category('photo.jpeg')).toBe('picture');
    expect(category('manual.pdf')).toBe('document');
    expect(category('setup.exe')).toBe('application');
    expect(category('mystery.qqq')).toBe('other');
    expect(category('noextension')).toBe('other');
    // A dotfile has no extension, and a directory-looking name is stripped first.
    expect(category('.bashrc')).toBe('other');
    expect(category('dir.name/movie.MP4')).toBe('video');
  });

  it('gives every category an icon', () => {
    expect(categoryIcon('video')).toBe('movie');
    expect(categoryIcon('audio')).toBe('music-note');
    expect(categoryIcon('archive')).toBe('archive');
    expect(categoryIcon('other')).toBe('insert-drive-file');
  });

  it('reads the extension off a path, ignoring dotfiles and trailing dots', () => {
    expect(extensionOf('a/b/c.mkv')).toBe('.mkv');
    expect(extensionOf('a\\b\\c.mkv')).toBe('.mkv');
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
    expect(extensionOf('plain')).toBe('');
    expect(extensionOf('')).toBe('');
  });
});

describe('normalizeResults', () => {
  it('skips null, undefined and non-object entries', () => {
    const results = normalizeResults([
      null,
      undefined,
      'string',
      42,
      [],
      { ...COMPLETE },
      { mediaCodec: 'orphan' },
      { filename: 'second.bin', fileLength: '10' },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].filename).toBe('ubuntu-24.04.iso');
    expect(results[1].filename).toBe('second.bin');
  });

  it('tolerates a missing or non-array payload', () => {
    expect(normalizeResults(undefined)).toEqual([]);
    expect(normalizeResults(null as never)).toEqual([]);
    expect(normalizeResults({ results: [] } as never)).toEqual([]);
  });

  it('keeps keys stable across repeated normalisation of the same data', () => {
    const payload = [COMPLETE, { filename: 'second.bin', fileLength: '10' }];

    const first = normalizeResults(payload);
    const second = normalizeResults(payload);

    expect(second.map((r) => r.key)).toEqual(first.map((r) => r.key));
    // The keys are also unique, so React has a stable, non-colliding identity.
    expect(new Set(first.map((r) => r.key)).size).toBe(first.length);
  });

  it('keys a link-less row by hash + length and an identity-less row by index', () => {
    expect(resultKey('ed2k://|file|a|1|AA|', 'AA', 1, 0)).toBe('ed2k://|file|a|1|AA|/');
    expect(resultKey(undefined, 'AA', 12, 7)).toBe('hash:aa:12');
    expect(resultKey(undefined, undefined, 12, 7)).toBe('anon:7');
  });
});

describe('dedupeResults', () => {
  const one = normalizeResult(
    { ...COMPLETE, sourceNetwork: 'server A', sourceCount: '1' },
    0,
  ) as NormalizedEd2kResult;

  it('merges on fileHash and counts the sources', () => {
    const two = normalizeResult(
      {
        // Same file, different link and different network: exactly what ED2K
        // returns when several servers index the same hash.
        ed2kLink: 'ed2k://|file|ubuntu-24.04.iso|3518384816|A1B2C3D4E5F60718293A4B5C6D7E8F90|/mirror',
        filename: 'ubuntu-24.04.iso',
        fileLength: '3518384816',
        fileHash: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
        sourceNetwork: 'server B',
      },
      1,
    ) as NormalizedEd2kResult;

    const merged = dedupeResults([one, two]);

    expect(merged).toHaveLength(1);
    // First occurrence wins for the fields it carries…
    expect(merged[0].sourceNetwork).toBe('server A');
    expect(merged[0].key).toBe(one.key);
    // …but the tally is remembered.
    expect(merged[0].sourceCount).toBe(2);
  });

  it('merges on the link when there is no hash', () => {
    const a = normalizeResult({ ed2kLink: 'ed2k://|file|a|1|AA|', filename: 'a', fileLength: '1' }, 0) as NormalizedEd2kResult;
    const b = normalizeResult({ ed2kLink: 'ed2k://|file|a|1|AA|', filename: 'a', fileLength: '1' }, 1) as NormalizedEd2kResult;

    const merged = dedupeResults([a, b]);

    expect(merged).toHaveLength(1);
    expect(merged[0].sourceCount).toBe(2);
  });

  it('sums the server-reported source counts of the entries it merges', () => {
    const a = normalizeResult({ ...COMPLETE, sourceCount: '4' }, 0) as NormalizedEd2kResult;
    const b = normalizeResult({ ...COMPLETE, sourceCount: '2' }, 1) as NormalizedEd2kResult;

    expect(dedupeResults([a, b])[0].sourceCount).toBe(6);
  });

  it('never merges rows it cannot identify', () => {
    const a = normalizeResult({ filename: 'a.bin', fileLength: '1' }, 0) as NormalizedEd2kResult;
    const b = normalizeResult({ filename: 'b.bin', fileLength: '2' }, 1) as NormalizedEd2kResult;

    expect(dedupeResults([a, b])).toHaveLength(2);
  });

  it('tolerates an empty or missing input', () => {
    expect(dedupeResults([])).toEqual([]);
    expect(dedupeResults(undefined as never)).toEqual([]);
  });

  it('fills a blank field from the duplicate without losing the key', () => {
    const withLink = normalizeResult({ ed2kLink: 'ed2k://|file|a|1|AA|' }, 0) as NormalizedEd2kResult;
    const withCodec = normalizeResult(
      { filename: 'a.bin', fileLength: '1', fileHash: 'AA', mediaCodec: 'FLAC' },
      1,
    ) as NormalizedEd2kResult;

    // Identity differs (link vs hash), so they stay separate — but the codec
    // only exists on the second entry, so nothing may be invented on the first.
    expect(withLink.mediaCodec).toBeUndefined();
    expect(withCodec.mediaCodec).toBe('FLAC');
  });
});

describe('mergeResults', () => {
  const one = normalizeResult({ ...COMPLETE, sourceCount: '1' }, 0) as NormalizedEd2kResult;
  const two = normalizeResult({ filename: 'second.bin', fileLength: '10' }, 1) as NormalizedEd2kResult;

  it('appends new rows', () => {
    const merged = mergeResults([one], [two]);

    expect(merged.map((r) => r.key)).toEqual([one.key, two.key]);
  });

  it('is idempotent, because the server re-sends the accumulated set', () => {
    // This is the difference from dedupeResults: summing would inflate a
    // 1-source file to N sources after N polls.
    const once = mergeResults([], [one]);
    const twice = mergeResults(once, [one]);
    const thrice = mergeResults(twice, [one]);

    expect(thrice).toHaveLength(1);
    expect(thrice[0].sourceCount).toBe(1);
  });

  it('lets a later poll complete a partial row without changing its key', () => {
    const partial = normalizeResult({ fileHash: 'AA', filename: 'a.bin' }, 0) as NormalizedEd2kResult;
    const completed = normalizeResult(
      { fileHash: 'AA', filename: 'a.bin', fileLength: '99', mediaCodec: 'Opus' },
      0,
    ) as NormalizedEd2kResult;

    const merged = mergeResults([partial], [completed]);

    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe(partial.key);
    expect(merged[0].fileLength).toBe(99);
    expect(merged[0].mediaCodec).toBe('Opus');
  });
});

describe('formatFileLength', () => {
  it('delegates to the shared readableVolume filter', () => {
    expect(formatFileLength(1024)).toBe(readableVolume(1024));
    expect(formatFileLength('1048576')).toBe(readableVolume(1048576));
    expect(formatFileLength(0)).toBe(readableVolume(0));
  });

  it('shows a dash when there is no size at all', () => {
    expect(formatFileLength(undefined)).toBe(UNKNOWN_SIZE);
    expect(formatFileLength('')).toBe(UNKNOWN_SIZE);
    expect(formatFileLength('   ')).toBe(UNKNOWN_SIZE);
  });
});

describe('parseKeywordFromHash', () => {
  it('reads ?keyword= out of the hash-router url', () => {
    expect(parseKeywordFromHash('#!/ed2k/search?keyword=ubuntu%20iso')).toBe('ubuntu iso');
    expect(parseKeywordFromHash('#/ed2k/search?keyword=ubuntu&other=1')).toBe('ubuntu');
    expect(parseKeywordFromHash('?keyword=ubuntu')).toBe('ubuntu');
  });

  it('returns undefined when there is nothing to run', () => {
    expect(parseKeywordFromHash(undefined)).toBeUndefined();
    expect(parseKeywordFromHash('')).toBeUndefined();
    expect(parseKeywordFromHash('#!/ed2k/search')).toBeUndefined();
    expect(parseKeywordFromHash('#!/ed2k/search?keyword=')).toBeUndefined();
    expect(parseKeywordFromHash('#!/ed2k/search?keyword=%20%20')).toBeUndefined();
  });
});
