import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PATH_SEPARATOR,
  UNKNOWN_TASK_NAME,
  getBittorrentName,
  getFileExtension,
  getFileNameFromFile,
  getRelativePath,
  getTaskName,
  normalizeUrlInput,
} from '../paths';

describe('getFileNameFromFile', () => {
  it('uses the path when present', () => {
    expect(getFileNameFromFile({ path: '/home/user/downloads/movie.mp4' })).toBe('movie.mp4');
  });

  it('keeps a bare file name (no separator)', () => {
    expect(getFileNameFromFile({ path: 'movie.mp4' })).toBe('movie.mp4');
  });

  it('normalises windows separators in the path', () => {
    expect(getFileNameFromFile({ path: 'C:\\downloads\\movie.mkv' })).toBe(
      'C:\\downloads\\movie.mkv',
    );
  });

  it('falls back to the first uri when there is no path, and url-decodes it', () => {
    expect(
      getFileNameFromFile({
        path: '',
        uris: [
          { uri: 'http://example.com/dl/My%20File.txt' },
          { uri: 'http://mirror/dl/My%20File.txt' },
        ],
      }),
    ).toBe('My File.txt');
  });

  it('does NOT url-decode a path (only a uri source needs decoding)', () => {
    expect(getFileNameFromFile({ path: '/downloads/My%20File.txt' })).toBe('My%20File.txt');
  });

  it('survives malformed percent-encoding', () => {
    expect(
      getFileNameFromFile({ path: '', uris: [{ uri: 'http://h/broken%zz.txt' }] }),
    ).toBe('broken%zz.txt');
  });

  it('strips a ?query suffix', () => {
    expect(getFileNameFromFile({ path: 'https://h/a/b.zip?token=1&x=2' })).toBe('b.zip');
    expect(
      getFileNameFromFile({
        path: '',
        uris: [{ uri: 'http://h/Caf%C3%A9%20Menu.pdf?x=1' }],
      }),
    ).toBe('Café Menu.pdf');
  });

  it('falls back to the whole path when no name follows the last separator', () => {
    // AriaNg's `index <= 0` bail-out: the only `/` is the leading one.
    expect(getFileNameFromFile({ path: '/file.mp4' })).toBe('/file.mp4');
    // `index === -1`: there is no separator at all.
    expect(getFileNameFromFile({ path: 'bare.mp4' })).toBe('bare.mp4');
    // A trailing separator leaves nothing after it, so the result is empty.
    expect(getFileNameFromFile({ path: 'http://example.com/dir/' })).toBe('');
  });

  it('returns an empty string when there is no file or nothing to work with', () => {
    expect(getFileNameFromFile(undefined)).toBe('');
    expect(getFileNameFromFile(null)).toBe('');
    expect(getFileNameFromFile({})).toBe('');
    expect(getFileNameFromFile({ path: '' })).toBe('');
    expect(getFileNameFromFile({ path: '', uris: [] })).toBe('');
  });
});

describe('getRelativePath', () => {
  it('resolves a single-file HTTP task to the empty string (file sits in dir)', () => {
    expect(
      getRelativePath(
        { dir: '/home/user/downloads' },
        { path: '/home/user/downloads/movie.mp4', fileName: 'movie.mp4' },
      ),
    ).toBe('');
  });

  it('resolves a multi-file BT task with a single directory', () => {
    const task = {
      dir: '/home/user/downloads',
      bittorrent: { mode: 'multi' as const, info: { name: 'MyTorrent' } },
    };

    expect(getRelativePath(task, { path: '/home/user/downloads/MyTorrent/a.mkv', fileName: 'a.mkv' })).toBe(
      '',
    );
    expect(
      getRelativePath(task, {
        path: '/home/user/downloads/MyTorrent/sub/b.mkv',
        fileName: 'b.mkv',
      }),
    ).toBe('sub');
  });

  it('resolves a multi-directory BT task', () => {
    const task = {
      dir: '/home/user/downloads',
      bittorrent: { mode: 'multi' as const, info: { 'name.utf-8': 'Ünïcode Torrent' } },
    };

    expect(
      getRelativePath(task, {
        path: '/home/user/downloads/Ünïcode Torrent/Season 1/ep1.mkv',
        fileName: 'ep1.mkv',
      }),
    ).toBe('Season 1');

    expect(
      getRelativePath(task, {
        path: '/home/user/downloads/Ünïcode Torrent/Season 1/Extras/ep1.mkv',
        fileName: 'ep1.mkv',
      }),
    ).toBe('Season 1/Extras');
  });

  it('does not strip the torrent root for a single-file BT task', () => {
    expect(
      getRelativePath(
        {
          dir: '/downloads',
          bittorrent: { mode: 'single', info: { name: 'MyTorrent' } },
        },
        { path: '/downloads/MyTorrent/movie.mkv', fileName: 'movie.mkv' },
      ),
    ).toBe('MyTorrent');
  });

  it('normalises windows separators on both sides', () => {
    expect(
      getRelativePath(
        { dir: 'C:\\downloads', bittorrent: { mode: 'multi', info: { name: 'MyTorrent' } } },
        { path: 'C:\\downloads\\MyTorrent\\Season 1\\ep1.mkv', fileName: 'ep1.mkv' },
      ),
    ).toBe('Season 1');
  });

  it('only trims separators when the path is not under dir', () => {
    // The `dir` prefix does not match, so it is kept in full; the leading
    // separator is still trimmed, then the file name is stripped.
    expect(
      getRelativePath({ dir: '/downloads' }, { path: '/somewhere/else/a.mkv', fileName: 'a.mkv' }),
    ).toBe('somewhere/else');
  });

  it('returns an empty string for an empty path', () => {
    expect(getRelativePath({ dir: '/downloads' }, { path: '', fileName: 'a.mkv' })).toBe('');
    expect(getRelativePath({}, {})).toBe('');
  });
});

describe('getBittorrentName', () => {
  it('prefers the utf-8 name, then the plain name, then a flattened infoName', () => {
    expect(getBittorrentName({ info: { name: 'Plain', 'name.utf-8': 'Utf8' } })).toBe('Utf8');
    expect(getBittorrentName({ info: { name: 'Plain' } })).toBe('Plain');
    expect(getBittorrentName({ infoName: 'Flattened' })).toBe('Flattened');
    expect(getBittorrentName({})).toBe('');
    expect(getBittorrentName(undefined)).toBe('');
  });
});

describe('getTaskName', () => {
  it('prefers the torrent name', () => {
    expect(
      getTaskName({
        bittorrent: { info: { name: 'Torrent', 'name.utf-8': 'TörRent' } },
        files: [{ path: '/d/a.mkv' }],
      }),
    ).toEqual({ name: 'TörRent', success: true });
  });

  it('falls back to the first file name', () => {
    expect(getTaskName({ files: [{ path: '/d/movie.mp4' }] })).toEqual({
      name: 'movie.mp4',
      success: true,
    });
  });

  it('falls back to Unknown and reports success: false', () => {
    expect(getTaskName({})).toEqual({ name: UNKNOWN_TASK_NAME, success: false });
    expect(getTaskName({ files: [] })).toEqual({ name: UNKNOWN_TASK_NAME, success: false });
    expect(getTaskName({ bittorrent: { info: {} }, files: [{ path: '' }] })).toEqual({
      name: UNKNOWN_TASK_NAME,
      success: false,
    });
  });
});

describe('getFileExtension', () => {
  it('returns the lowercased extension without the dot', () => {
    expect(getFileExtension('movie.MKV')).toBe('mkv');
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
    expect(getFileExtension('noext')).toBe('');
    expect(getFileExtension('.gitignore')).toBe('');
    expect(getFileExtension('trailing.')).toBe('');
    expect(getFileExtension('')).toBe('');
  });

  it('ignores directories when looking for the dot', () => {
    expect(getFileExtension('/home/user/a.b/movie')).toBe('');
    expect(getFileExtension('C:\\dir.with.dots\\movie.mp4')).toBe('mp4');
  });
});

describe('normalizeUrlInput', () => {
  it('keeps every supported scheme', () => {
    expect(
      normalizeUrlInput(
        [
          'http://example.com/a.zip',
          'https://example.com/b.zip',
          'ftp://example.com/c.zip',
          'sftp://example.com/d.zip',
          'magnet:?xt=urn:btih:0123456789abcdef',
        ].join('\n'),
      ),
    ).toEqual([
      'http://example.com/a.zip',
      'https://example.com/b.zip',
      'ftp://example.com/c.zip',
      'sftp://example.com/d.zip',
      'magnet:?xt=urn:btih:0123456789abcdef',
    ]);
  });

  it('accepts aria2-next ed2k links', () => {
    expect(normalizeUrlInput('ed2k://|file|movie.avi|734003200|HASH|/')).toEqual([
      'ed2k://|file|movie.avi|734003200|HASH|/',
    ]);
  });

  it('is case-insensitive on the scheme', () => {
    expect(normalizeUrlInput('HTTP://example.com/a.zip\nMAGNET:?xt=urn:btih:abc')).toEqual([
      'HTTP://example.com/a.zip',
      'MAGNET:?xt=urn:btih:abc',
    ]);
  });

  it('trims whitespace and drops blank lines', () => {
    expect(normalizeUrlInput('  http://example.com/a.zip  \n\n\t\n http://example.com/b.zip \n')).toEqual(
      ['http://example.com/a.zip', 'http://example.com/b.zip'],
    );
  });

  it('handles CRLF input', () => {
    expect(normalizeUrlInput('http://example.com/a.zip\r\nhttp://example.com/b.zip\r\n')).toEqual([
      'http://example.com/a.zip',
      'http://example.com/b.zip',
    ]);
  });

  it('drops invalid entries', () => {
    expect(
      normalizeUrlInput(
        [
          'not a url',
          'example.com/a.zip',
          'magnet:',
          'http://',
          'file:///etc/passwd',
          'thunder://abc',
          'http://example.com/keep.zip',
        ].join('\n'),
      ),
    ).toEqual(['http://example.com/keep.zip']);
  });

  it('returns an empty array for empty input', () => {
    expect(normalizeUrlInput('')).toEqual([]);
    expect(normalizeUrlInput('   \n  \n')).toEqual([]);
  });
});

describe('DEFAULT_PATH_SEPARATOR', () => {
  it("is aria2's default", () => {
    expect(DEFAULT_PATH_SEPARATOR).toBe('/');
  });
});
