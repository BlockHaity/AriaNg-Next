import { describe, expect, it } from 'vitest';

import { buildEd2kLink, hasEd2kLink } from '../ed2k';
import type { TaskEd2kView } from '../types';

const HASH = '31D6CFE0D16AE931B73C59D7E0C089C0';

const COMPLETE: TaskEd2kView = {
  hash: HASH,
  name: 'movie.avi',
  length: 734003200,
};

/**
 * `tellStatus().ed2k` carries no `ed2kLink` — it only exists on
 * `getEd2kSearchResults` entries — so a downloading task's link has to be
 * rebuilt from the identity triple the struct does report.
 */
describe('buildEd2kLink', () => {
  it('builds the standard ed2k:// file link', () => {
    expect(buildEd2kLink(COMPLETE)).toBe(
      'ed2k://|file|movie.avi|734003200|31D6CFE0D16AE931B73C59D7E0C089C0|/',
    );
  });

  it('upper-cases the hash, as the ED2K link format expects', () => {
    const link = buildEd2kLink({ ...COMPLETE, hash: 'abcdef0123456789abcdef0123456789' });
    expect(link).toContain('|ABCDEF0123456789ABCDEF0123456789|/');
  });

  it('percent-escapes the field separators inside a name', () => {
    const link = buildEd2kLink({ ...COMPLETE, name: 'a|b%c.avi' });
    expect(link).toBe(`ed2k://|file|a%7Cb%25c.avi|734003200|${HASH}|/`);
  });

  it('returns undefined when the identity triple is incomplete', () => {
    expect(buildEd2kLink(undefined)).toBeUndefined();
    expect(buildEd2kLink({})).toBeUndefined();
    expect(buildEd2kLink({ name: 'a.avi', length: 1 })).toBeUndefined();
    expect(buildEd2kLink({ hash: HASH, length: 1 })).toBeUndefined();
    expect(buildEd2kLink({ hash: HASH, name: 'a.avi' })).toBeUndefined();
  });

  it('rejects a hash that is not 32 hex characters', () => {
    // A malformed hash would produce a link aria2 cannot resolve.
    expect(buildEd2kLink({ ...COMPLETE, hash: 'not-a-hash' })).toBeUndefined();
    expect(buildEd2kLink({ ...COMPLETE, hash: 'ZZ6CFE0D16AE931B73C59D7E0C089C0' })).toBeUndefined();
    expect(buildEd2kLink({ ...COMPLETE, hash: HASH.slice(0, 31) })).toBeUndefined();
  });

  it('rejects a non-positive length', () => {
    expect(buildEd2kLink({ ...COMPLETE, length: 0 })).toBeUndefined();
    expect(buildEd2kLink({ ...COMPLETE, length: -1 })).toBeUndefined();
  });

  it('exposes a boolean form for menu visibility checks', () => {
    expect(hasEd2kLink(COMPLETE)).toBe(true);
    expect(hasEd2kLink({ name: 'a.avi', length: 1 })).toBe(false);
    expect(hasEd2kLink(undefined)).toBe(false);
  });
});
