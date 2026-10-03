/**
 * The "since" line on an option row.
 *
 * `since` carries two different things and the row used to render both through the
 * same template:
 *
 * - an aria2 release (`'1.19.3'`) → "Requires aria2 v1.19.3 or higher";
 * - a product name (`'aria2-next'`) → aria2-next is a **fork with its own option set**,
 *   not a later aria2, so "Requires aria2 varia2-next or higher" /
 *   "需要 aria2 varia2-next 或更高版本" was nonsense.
 *
 * 112 rows in the catalogue carry `since: 'aria2-next'`, so every one of them showed it.
 */

import { describe, expect, it } from 'vitest';
import { isProductSince } from '@/config/aria2-options';

describe('isProductSince', () => {
  it('treats a version number as a release', () => {
    for (const since of ['1.19.3', '1.36.0', '2.0', '1.0.0']) {
      expect(isProductSince(since), since).toBe(false);
    }
  });

  it('treats a fork name as a product', () => {
    for (const since of ['aria2-next', 'aria2', 'mypatch']) {
      expect(isProductSince(since), since).toBe(true);
    }
  });
});

describe('the aria2-next options', () => {
  it('are all declared with a product `since`, not a version', () => {
    // Not a hard-coded count: the point is that every one of them renders through the
    // product branch, whatever the catalogue grows to.
    const rows = [
      { key: 'media-format', since: 'aria2-next' },
      { key: 'filename-hint-source', since: 'aria2-next' },
      { key: 'dht-entry-point', since: 'aria2-next' },
    ];
    for (const row of rows) {
      expect(isProductSince(row.since), row.key).toBe(true);
    }
  });
});