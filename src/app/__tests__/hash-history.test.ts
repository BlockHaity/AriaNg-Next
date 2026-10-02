/**
 * Tests for the `#!` history adapter.
 *
 * The adapter is the only place where AriaNg's documented urls meet React
 * Router's, so the properties that matter are:
 *
 * - reading a hash yields the in-app path, query string included;
 * - building a url restores the `!` banner;
 * - an **empty** hash means `/downloading` (AriaNg's `otherwise`);
 * - a hash **without** the banner is tolerated, not 404 — old bookmarks exist;
 * - the round-trip `hash -> path -> hash` is lossless for every documented url.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHashUrl, createHashBangHistory, getHashPath } from '../hash-history';
import { DEFAULT_ROUTE } from '../route-paths';

/* -------------------------------------------------------------------------- */
/* getHashPath                                                               */
/* -------------------------------------------------------------------------- */

describe('getHashPath', () => {
  it('strips the hashbang banner and keeps the query string', () => {
    expect(getHashPath('#!/new?url=x')).toBe('/new?url=x');
    expect(getHashPath('#!/settings/rpc/set?host=box&port=6800')).toBe(
      '/settings/rpc/set?host=box&port=6800',
    );
  });

  it('parses every documented task route', () => {
    expect(getHashPath('#!/downloading')).toBe('/downloading');
    expect(getHashPath('#!/waiting')).toBe('/waiting');
    expect(getHashPath('#!/stopped')).toBe('/stopped');
    expect(getHashPath('#!/task/detail/2089b05ecca3d829')).toBe('/task/detail/2089b05ecca3d829');
    expect(getHashPath('#!/settings/aria2/http')).toBe('/settings/aria2/http');
    expect(getHashPath('#!/ed2k/search')).toBe('/ed2k/search');
  });

  it('defaults an empty hash to the default route (AriaNg: otherwise)', () => {
    expect(getHashPath('')).toBe(DEFAULT_ROUTE);
    expect(getHashPath('#')).toBe(DEFAULT_ROUTE);
    expect(getHashPath('#!')).toBe(DEFAULT_ROUTE);
    expect(getHashPath('!')).toBe(DEFAULT_ROUTE);
  });

  it('tolerates a hash without the `!` banner', () => {
    expect(getHashPath('#/downloading')).toBe('/downloading');
    expect(getHashPath('#/new?url=x')).toBe('/new?url=x');
    expect(getHashPath('#/task/detail/abc')).toBe('/task/detail/abc');
  });

  it('tolerates AngularJS\' banner-less path form (`#!new/task`)', () => {
    expect(getHashPath('#!new/task?url=x')).toBe('/new/task?url=x');
  });

  it('never throws on a non-string input', () => {
    expect(getHashPath(undefined as unknown as string)).toBe(DEFAULT_ROUTE);
    expect(getHashPath(null as unknown as string)).toBe(DEFAULT_ROUTE);
  });
});

/* -------------------------------------------------------------------------- */
/* buildHashUrl                                                              */
/* -------------------------------------------------------------------------- */

describe('buildHashUrl', () => {
  it('re-adds the hashbang banner', () => {
    expect(buildHashUrl('/downloading')).toBe('#!/downloading');
    expect(buildHashUrl('/new?url=x')).toBe('#!/new?url=x');
    expect(buildHashUrl('/settings/rpc/set?protocol=http')).toBe('#!/settings/rpc/set?protocol=http');
  });

  it('is the exact inverse of getHashPath', () => {
    for (const path of [
      '/downloading',
      '/waiting',
      '/stopped',
      '/new',
      '/new/task?url=aHR0cHM6Ly9leGFtcGxlLmNvbS9hLnRp',
      '/task/detail/2089b05ecca3d829',
      '/settings/ariang',
      '/settings/ariang/language',
      '/settings/aria2/http-ftp-sftp',
      '/debug',
      '/status',
      '/ed2k/search',
    ]) {
      expect(getHashPath(buildHashUrl(path))).toBe(path);
    }
  });

  it('matches the url helper in route-paths (one public contract)', async () => {
    const { appUrl } = await import('../route-paths');
    expect(buildHashUrl('/new')).toBe(appUrl('/new'));
    expect(buildHashUrl('/settings/rpc/set', )).toBe(appUrl('/settings/rpc/set'));
    expect(buildHashUrl('/new?url=aGk')).toBe(appUrl('/new', { url: 'aGk' }));
  });

  it('tolerates a path with or without the leading slash', () => {
    expect(buildHashUrl('downloading')).toBe('#!/downloading');
    expect(buildHashUrl('')).toBe('#!');
  });
});

/* -------------------------------------------------------------------------- */
/* createHashBangHistory                                                      */
/* -------------------------------------------------------------------------- */

describe('createHashBangHistory', () => {
  let hash: string;

  beforeEach(() => {
    hash = window.location.hash;
    window.location.hash = '#!/downloading';
  });

  afterEach(() => {
    window.location.hash = hash;
  });

  it('reads the current location through the `!` banner', () => {
    const history = createHashBangHistory();
    expect(history.location.pathname).toBe('/downloading');
  });

  it('lands on the default route when the document has no hash', () => {
    window.location.hash = '';
    const history = createHashBangHistory();
    expect(history.location.pathname).toBe(DEFAULT_ROUTE);
  });

  it('tolerates a url without the banner', () => {
    window.location.hash = '#/waiting';
    const history = createHashBangHistory();
    expect(history.location.pathname).toBe('/waiting');
  });

  it('parses the query string', () => {
    window.location.hash = '#!/new/task?url=aGk&pause=true';
    const history = createHashBangHistory();
    expect(history.location.pathname).toBe('/new/task');
    expect(history.location.search).toBe('?url=aGk&pause=true');
  });

  it('builds hrefs with the banner, whatever the router asked for', () => {
    const history = createHashBangHistory();
    expect(history.createHref('/downloading')).toBe('#!/downloading');
    expect(history.createHref('/new?url=x')).toBe('#!/new?url=x');
  });

  it('writes the banner back into the address bar on push', () => {
    const history = createHashBangHistory();
    history.push('/waiting');
    expect(window.location.hash).toBe('#!/waiting');
    expect(history.location.pathname).toBe('/waiting');
  });

  it('writes the banner back into the address bar on replace', () => {
    const history = createHashBangHistory();
    history.replace('/stopped');
    expect(window.location.hash).toBe('#!/stopped');
  });

  it('reports updates to a listener with a normalised location', () => {
    const history = createHashBangHistory();
    const seen: string[] = [];
    const unlisten = history.listen((update) => {
      seen.push(`${update.action} ${update.location.pathname}`);
    });

    history.push('/status');
    unlisten();
    history.push('/debug');

    expect(seen).toEqual(['PUSH /status']);
  });

  it('exposes the encoded location of a target as a url', () => {
    const history = createHashBangHistory();
    const url = history.createURL('/ed2k/search');
    expect(url.hash).toBe('#!/ed2k/search');
    expect(history.encodeLocation('/ed2k/search')).toEqual({
      pathname: '/',
      search: '',
      hash: '#!/ed2k/search',
    });
  });

  it('degrades to a memory history outside a DOM', () => {
    vi.stubGlobal('window', undefined);
    try {
      const history = createHashBangHistory();
      expect(history.location.pathname).toBe(DEFAULT_ROUTE);
      history.push('/waiting');
      expect(history.location.pathname).toBe('/waiting');
      expect(history.createHref('/waiting')).toBe('#!/waiting');
      expect(history.createURL('/waiting').hash).toBe('#!/waiting');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});