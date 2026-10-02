/**
 * Tab-visibility rules for `/task/detail/:gid`.
 *
 * Every rule in `tabs/visibility.ts` is a pure function of the task state, so it
 * can be pinned down without React, a store or a client. The boundaries matter
 * most: `le1024` / `le10240` / `le102400` are **inclusive** limits, and the piece
 * tab follows the same `showPiecesInfoInTaskDetailPage` setting the piece map
 * itself obeys.
 */

import { describe, expect, it } from 'vitest';

import { PIECES_INFO_LIMITS } from '@/domain/pieces';
import type { PiecesInfoSetting } from '@/config/types';
import {
  adjacentTab,
  DEFAULT_DETAIL_TAB,
  getVisibleTabValues,
  getVisibleTabs,
  resolveTab,
  tabIndexOf,
  TAB_QUERY_PARAM,
} from '@/pages/task-detail/tabs/visibility';
import type { VisibleTabsInput } from '@/pages/task-detail/tabs/visibility';

/** A fully-populated, "boring" input; every test overrides one field. */
function input(overrides: Partial<VisibleTabsInput> = {}): VisibleTabsInput {
  return {
    status: 'active',
    isBittorrent: false,
    numPieces: 0,
    piecesSetting: 'le10240',
    hasMedia: false,
    ...overrides,
  };
}

function values(overrides: Partial<VisibleTabsInput> = {}): string[] {
  return getVisibleTabValues(input(overrides));
}

describe('getVisibleTabs', () => {
  it('always offers Overview and Files, in that order', () => {
    // The most restrictive input the rules allow: a finished, non-torrent,
    // piece-less, media-less HTTP download.
    const tabs = values({ status: 'complete', isBittorrent: false, numPieces: 0, piecesSetting: 'never' });

    expect(tabs).toEqual(['overview', 'files']);
  });

  it('never returns an empty list', () => {
    expect(getVisibleTabs(input({ status: '', numPieces: 0, piecesSetting: 'never' })).length).toBeGreaterThan(0);
  });

  it('labels every tab with an i18n key', () => {
    for (const tab of getVisibleTabs(input({ isBittorrent: true, numPieces: 10, hasMedia: true }))) {
      expect(typeof tab.labelKey).toBe('string');
      expect(tab.labelKey.length).toBeGreaterThan(0);
    }
  });

  it('marks only the options tab with a gear icon (AriaNg rendered it icon-only)', () => {
    const icons = getVisibleTabs(input({ isBittorrent: true, numPieces: 10, hasMedia: true }))
      .filter((tab) => tab.icon !== undefined)
      .map((tab) => tab.value);

    expect(icons).toEqual(['options']);
  });
});

/* ------------------------------------------------------------------ */
/* Pieces — the numPieces boundaries                                   */
/* ------------------------------------------------------------------ */

describe('Pieces tab visibility', () => {
  const settings: readonly PiecesInfoSetting[] = ['always', 'le102400', 'le10240', 'le1024'];

  it.each(settings)('shows Pieces for a small map under %s', (setting) => {
    expect(values({ numPieces: 1, piecesSetting: setting })).toContain('pieces');
  });

  it.each(settings.filter((setting) => setting !== 'always'))(
    'hides Pieces for a huge map under %s',
    (setting) => {
      expect(values({ numPieces: 1024000, piecesSetting: setting })).not.toContain('pieces');
    },
  );

  it('treats every limit as inclusive, exactly like isPiecesInfoVisible', () => {
    // 1024 / 10240 / 102400 are the documented limits.
    expect(PIECES_INFO_LIMITS.le1024).toBe(1024);
    expect(PIECES_INFO_LIMITS.le10240).toBe(10240);
    expect(PIECES_INFO_LIMITS.le102400).toBe(102400);

    expect(values({ numPieces: 1024, piecesSetting: 'le1024' })).toContain('pieces');
    expect(values({ numPieces: 1025, piecesSetting: 'le1024' })).not.toContain('pieces');

    expect(values({ numPieces: 10240, piecesSetting: 'le10240' })).toContain('pieces');
    expect(values({ numPieces: 10241, piecesSetting: 'le10240' })).not.toContain('pieces');

    expect(values({ numPieces: 102400, piecesSetting: 'le102400' })).toContain('pieces');
    expect(values({ numPieces: 102401, piecesSetting: 'le102400' })).not.toContain('pieces');
  });

  it("honours 'never' and 'always' absolutely", () => {
    expect(values({ numPieces: 1, piecesSetting: 'never' })).not.toContain('pieces');
    expect(values({ numPieces: 999999, piecesSetting: 'always' })).toContain('pieces');
  });

  it('does not depend on the task status', () => {
    for (const status of ['active', 'waiting', 'paused', 'complete', 'error', 'removed']) {
      expect(values({ status, numPieces: 10, piecesSetting: 'le10240' })).toContain('pieces');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Peers                                                               */
/* ------------------------------------------------------------------ */

describe('Peers tab visibility', () => {
  it('needs an active torrent', () => {
    expect(values({ status: 'active', isBittorrent: true })).toContain('peers');
    expect(values({ status: 'waiting', isBittorrent: true })).not.toContain('peers');
    expect(values({ status: 'paused', isBittorrent: true })).not.toContain('peers');
    expect(values({ status: 'complete', isBittorrent: true })).not.toContain('peers');
    expect(values({ status: 'error', isBittorrent: true })).not.toContain('peers');
    expect(values({ status: 'removed', isBittorrent: true })).not.toContain('peers');
  });

  it('needs BitTorrent', () => {
    expect(values({ status: 'active', isBittorrent: false })).not.toContain('peers');
  });
});

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

describe('Options tab visibility', () => {
  it.each(['active', 'waiting', 'paused'])('is offered for %s', (status) => {
    expect(values({ status })).toContain('options');
  });

  it.each(['complete', 'error', 'removed', '', 'unknown'])('is hidden for %s', (status) => {
    expect(values({ status })).not.toContain('options');
  });
});

/* ------------------------------------------------------------------ */
/* Media (aria2-next)                                                  */
/* ------------------------------------------------------------------ */

describe('Media tab visibility', () => {
  it('is offered when the task carries a media view', () => {
    expect(values({ hasMedia: true })).toContain('media');
  });

  it('is hidden otherwise, regardless of status or torrent-ness', () => {
    expect(values({ hasMedia: false })).not.toContain('media');
    expect(values({ status: 'complete', isBittorrent: true, hasMedia: false })).not.toContain('media');
  });

  it('is independent of the other rules', () => {
    const tabs = values({ isBittorrent: true, numPieces: 10, hasMedia: true, status: 'waiting' });
    expect(tabs).toEqual(['overview', 'pieces', 'files', 'options', 'media']);
  });
});

/* ------------------------------------------------------------------ */
/* ordering                                                            */
/* ------------------------------------------------------------------ */

describe('tab order', () => {
  it('is Overview, Pieces, Files, Peers, Options, Media', () => {
    expect(values({ isBittorrent: true, numPieces: 10, hasMedia: true })).toEqual([
      'overview',
      'pieces',
      'files',
      'peers',
      'options',
      'media',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* resolveTab / adjacency (deep links + swipe)                         */
/* ------------------------------------------------------------------ */

describe('resolveTab', () => {
  const context = input({ isBittorrent: true, numPieces: 10, hasMedia: true });

  it('keeps a request that is visible', () => {
    expect(resolveTab('files', context)).toBe('files');
    expect(resolveTab('media', context)).toBe('media');
  });

  it('falls back to the first visible tab for an unknown request', () => {
    expect(resolveTab('nope', context)).toBe('overview');
    expect(resolveTab('', context)).toBe('overview');
    expect(resolveTab(null, context)).toBe('overview');
    expect(resolveTab(undefined, context)).toBe('overview');
  });

  it('falls back when the requested tab has disappeared (e.g. the task finished)', () => {
    const finished = input({ status: 'complete', isBittorrent: false, numPieces: 0, piecesSetting: 'never' });
    expect(resolveTab('peers', finished)).toBe('overview');
    expect(resolveTab('options', finished)).toBe('overview');
    expect(resolveTab('pieces', finished)).toBe('overview');
    // Files is always available, so it is honoured.
    expect(resolveTab('files', finished)).toBe('files');
  });

  it('exposes Overview as the documented default', () => {
    expect(DEFAULT_DETAIL_TAB).toBe('overview');
  });

  it('documents the deep-link query parameter', () => {
    expect(TAB_QUERY_PARAM).toBe('tab');
  });
});

describe('adjacentTab (swipe)', () => {
  const context = input({ isBittorrent: true, numPieces: 10, hasMedia: true });

  it('walks forward and back through the visible order', () => {
    expect(adjacentTab('overview', 1, context)).toBe('pieces');
    expect(adjacentTab('pieces', -1, context)).toBe('overview');
    expect(adjacentTab('files', 1, context)).toBe('peers');
    expect(adjacentTab('peers', -1, context)).toBe('files');
  });

  it('returns null at the edges so the shell keeps the gesture', () => {
    expect(adjacentTab('overview', -1, context)).toBeNull();
    expect(adjacentTab('media', 1, context)).toBeNull();
  });

  it('skips tabs the task does not have', () => {
    const waiting = input({ status: 'waiting', isBittorrent: true, numPieces: 10 });
    // `peers` needs an active task, so Files is followed by Options.
    expect(adjacentTab('files', 1, waiting)).toBe('options');
  });

  it('returns null for a tab that is not visible', () => {
    expect(adjacentTab('peers', 1, input({ status: 'waiting', isBittorrent: true }))).toBeNull();
  });
});

describe('tabIndexOf', () => {
  it('reports the position in the visible order', () => {
    const context = input({ isBittorrent: true, numPieces: 10, hasMedia: true });
    expect(tabIndexOf('overview', context)).toBe(0);
    expect(tabIndexOf('files', context)).toBe(2);
    expect(tabIndexOf('media', context)).toBe(5);
  });

  it('reports -1 for a hidden tab', () => {
    expect(tabIndexOf('peers', input({ status: 'paused', isBittorrent: true }))).toBe(-1);
  });
});