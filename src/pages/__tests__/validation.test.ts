import { describe, expect, it } from 'vitest';

import { getOptionMeta } from '@/config/aria2-options';
import {
  buildAddUriEntries,
  coerceOptionsForRpc,
  detectKindFromUrls,
  isAcceptedUri,
  isDraftValid,
  parsePrefillUrl,
  validateUrls,
} from '@/pages/new-task/validation';
import type { NewTaskDraft, NewTaskKind } from '@/pages/new-task/validation';
import { encodeBase64Url } from '@/utils/base64';

const draft = (overrides: Partial<NewTaskDraft> = {}): NewTaskDraft => ({
  kind: 'urls',
  urls: [],
  options: {},
  ...overrides,
});

describe('validateUrls', () => {
  it('accepts every scheme aria2 can consume', () => {
    const { urls, invalid, isValid } = validateUrls(
      [
        'http://example.com/a.zip',
        'https://example.com/b.zip',
        'ftp://example.com/c.zip',
        'sftp://example.com/d.zip',
        'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
        'ed2k://|file|a.zip|1|0123456789ABCDEF0123456789ABCDEF|/',
      ].join('\n'),
    );

    expect(urls).toHaveLength(6);
    expect(invalid).toEqual([]);
    expect(isValid).toBe(true);
  });

  it('matches the scheme case-insensitively', () => {
    expect(validateUrls('HTTP://EXAMPLE.COM/A.zip').urls).toEqual(['HTTP://EXAMPLE.COM/A.zip']);
    expect(validateUrls('Ed2k://|file|a.zip|1|hash|/').urls).toHaveLength(1);
  });

  it('rejects garbage and reports the offending lines', () => {
    const { urls, invalid, isValid } = validateUrls(
      ['http://example.com/ok.zip', 'not a url', 'example.com/no-scheme', 'javascript:alert(1)'].join('\n'),
    );

    expect(urls).toEqual(['http://example.com/ok.zip']);
    expect(invalid).toEqual(['not a url', 'example.com/no-scheme', 'javascript:alert(1)']);
    expect(isValid).toBe(true);
  });

  it('skips blank lines and trims the rest', () => {
    const { urls, invalid } = validateUrls(
      ['', '   ', '\t', '  http://example.com/a.zip  ', '     ', '  bad line  ', ''].join('\n'),
    );

    expect(urls).toEqual(['http://example.com/a.zip']);
    expect(invalid).toEqual(['bad line']);
  });

  it('is invalid when nothing acceptable was typed', () => {
    expect(validateUrls('')).toEqual({ urls: [], invalid: [], isValid: false });
    expect(validateUrls('   \n\n  ').isValid).toBe(false);
    expect(validateUrls('nonsense').isValid).toBe(false);
  });

  it('preserves input order', () => {
    const { urls } = validateUrls(
      ['https://example.com/3.zip', 'https://example.com/1.zip', 'https://example.com/2.zip'].join('\n'),
    );

    expect(urls).toEqual([
      'https://example.com/3.zip',
      'https://example.com/1.zip',
      'https://example.com/2.zip',
    ]);
  });

  it('requires a body after the scheme', () => {
    expect(isAcceptedUri('http://')).toBe(false);
    expect(isAcceptedUri('magnet:')).toBe(false);
    expect(isAcceptedUri('magnet:?')).toBe(false);
    expect(isAcceptedUri('ed2k://')).toBe(false);
    expect(isAcceptedUri('')).toBe(false);
    expect(isAcceptedUri('magnet:?xt=urn:btih:abc')).toBe(true);
  });
});

describe('detectKindFromUrls', () => {
  it('reports plain links', () => {
    expect(detectKindFromUrls(['http://example.com/a.zip'])).toBe('urls');
    expect(detectKindFromUrls(['https://example.com/a.zip', 'magnet:?xt=urn:btih:abc'])).toBe('urls');
  });

  it('reports a torrent when every link is a .torrent file', () => {
    expect(detectKindFromUrls(['https://example.com/a.torrent'])).toBe('torrent');
    expect(detectKindFromUrls(['https://example.com/a.torrent', 'http://mirror/b.TORRENT'])).toBe('torrent');
    expect(detectKindFromUrls(['https://example.com/a.torrent?token=1'])).toBe('torrent');
  });

  it('reports media for HLS / DASH manifests', () => {
    expect(detectKindFromUrls(['https://example.com/master.m3u8'])).toBe('media');
    expect(detectKindFromUrls(['https://example.com/manifest.mpd'])).toBe('media');
    expect(detectKindFromUrls(['https://cdn.example.com/live/index.m3u8?x=1'])).toBe('media');
  });

  it('reports ed2k for ed2k:// links', () => {
    expect(detectKindFromUrls(['ed2k://|file|a.zip|1|0123456789ABCDEF0123456789ABCDEF|/'])).toBe('ed2k');
  });

  it('falls back to urls for an empty or mixed list', () => {
    expect(detectKindFromUrls([])).toBe('urls');
    expect(detectKindFromUrls(['  '])).toBe('urls');
    expect(detectKindFromUrls(['https://example.com/a.torrent', 'https://example.com/b.zip'])).toBe('urls');
    expect(detectKindFromUrls(['ed2k://|file|a|1|h|/', 'http://example.com/a.zip'])).toBe('urls');
    // A magnet is a torrent, but it is an ordinary uri as far as the editor is
    // concerned, so it must not flip the tab label.
    expect(detectKindFromUrls(['magnet:?xt=urn:btih:abc'])).toBe('urls');
  });
});

describe('isDraftValid', () => {
  const kinds: readonly NewTaskKind[] = ['urls', 'media', 'ed2k'];

  it.each(kinds)('needs at least one valid link for %s', (kind) => {
    expect(isDraftValid(draft({ kind }))).toBe(false);
    expect(isDraftValid(draft({ kind, urls: ['   '] }))).toBe(false);
    expect(isDraftValid(draft({ kind, urls: ['garbage'] }))).toBe(false);
    expect(isDraftValid(draft({ kind, urls: ['http://example.com/a.zip'] }))).toBe(true);
  });

  it.each(['torrent', 'metalink'] as const)('needs a loaded file for %s', (kind) => {
    expect(isDraftValid(draft({ kind }))).toBe(false);
    expect(isDraftValid(draft({ kind, file: { name: 'a', base64: '' } }))).toBe(false);
    expect(isDraftValid(draft({ kind, file: { name: 'a.torrent', base64: 'ZA==' } }))).toBe(true);
    // A file is enough even with no links at all.
    expect(isDraftValid(draft({ kind, urls: ['http://example.com/a.zip'], file: { name: 'a', base64: 'ZA==' } }))).toBe(
      true,
    );
  });
});

describe('buildAddUriEntries', () => {
  it('creates one entry per line and skips blanks', () => {
    const entries = buildAddUriEntries(
      draft({ urls: ['http://example.com/1.zip', '  ', 'https://example.com/2.zip', ''] }),
      false,
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.urls)).toEqual([
      ['http://example.com/1.zip'],
      ['https://example.com/2.zip'],
    ]);
  });

  it('merges pause into every entry', () => {
    const entries = buildAddUriEntries(
      draft({ urls: ['http://example.com/1.zip', 'https://example.com/2.zip'], options: { dir: '/downloads' } }),
      true,
    );

    expect(entries.map((entry) => entry.options)).toEqual([
      { dir: '/downloads', pause: 'true' },
      { dir: '/downloads', pause: 'true' },
    ]);
  });

  it('leaves options alone when not pausing, and never shares the object', () => {
    const source = draft({ urls: ['http://example.com/1.zip'], options: { out: 'a.zip' } });
    const [entry] = buildAddUriEntries(source, false);

    expect(entry.options).toEqual({ out: 'a.zip' });
    expect(entry.options).not.toBe(source.options);
    expect(source.options).toEqual({ out: 'a.zip' });
  });

  it('trims each line', () => {
    const entries = buildAddUriEntries(draft({ urls: ['   http://example.com/1.zip   '] }), false);
    expect(entries[0].urls).toEqual(['http://example.com/1.zip']);
  });

  it('returns nothing for an empty list', () => {
    expect(buildAddUriEntries(draft(), false)).toEqual([]);
    expect(buildAddUriEntries(draft({ urls: ['', '   '] }), true)).toEqual([]);
  });
});

describe('coerceOptionsForRpc', () => {
  it('splits header on newlines into trimmed, non-empty items', () => {
    const options = coerceOptionsForRpc(
      { header: 'X-A: 1\n\n  X-B: 2  \nX-C: 3', dir: '/downloads' },
      getOptionMeta,
    );

    expect(options.header).toEqual(['X-A: 1', 'X-B: 2', 'X-C: 3']);
    expect(options.dir).toBe('/downloads');
  });

  it('keeps every other option a string', () => {
    const options = coerceOptionsForRpc({ out: 'a.zip', split: '8', 'max-download-limit': '1M' }, getOptionMeta);

    expect(options).toEqual({ out: 'a.zip', split: '8', 'max-download-limit': '1M' });
    for (const value of Object.values(options)) {
      expect(typeof value).toBe('string');
    }
  });

  it('drops cleared rows unless the option is required', () => {
    const options = coerceOptionsForRpc({ out: '', dir: '', 'not-an-option': '' }, getOptionMeta);

    // `dir` is `required`, so an empty value is still sent (aria2 rejects it,
    // which is exactly what the row's own guard prevents); `out` is not.
    expect(options).toEqual({ dir: '' });
  });

  it('keeps an empty array-submitted option as an empty array', () => {
    expect(coerceOptionsForRpc({ header: '' }, getOptionMeta)).toEqual({ header: [] });
  });
});

describe('parsePrefillUrl', () => {
  it('decodes the base64url url parameter of a command hash', () => {
    const url = 'https://example.com/file.zip?a=1&b=2';
    expect(parsePrefillUrl(`#!/new/task?url=${encodeBase64Url(url)}`)).toBe(url);
  });

  it('accepts a bare query string', () => {
    expect(parsePrefillUrl(`?url=${encodeBase64Url('magnet:?xt=urn:btih:abc')}`)).toBe('magnet:?xt=urn:btih:abc');
  });

  it('returns undefined when absent, empty or undecodable', () => {
    expect(parsePrefillUrl('')).toBeUndefined();
    expect(parsePrefillUrl('#!/new/task')).toBeUndefined();
    expect(parsePrefillUrl('?other=1')).toBeUndefined();
    expect(parsePrefillUrl('?url=')).toBeUndefined();
    expect(parsePrefillUrl(`?url=${encodeBase64Url('   ')}`)).toBeUndefined();
  });
});