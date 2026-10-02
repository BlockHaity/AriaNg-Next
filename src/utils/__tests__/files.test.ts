import { describe, expect, it } from 'vitest';
import { matchesFileFilter, readFileAsBase64, readFileAsText } from '../files';

/** `FileReader.readAsDataURL` prefix for a plain text part. */
const DATA_URL_PREFIX = 'data:text/plain;base64,';

function textFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('matchesFileFilter', () => {
  it('accepts anything for *.*', () => {
    expect(matchesFileFilter('aria2.conf', '*.*')).toBe(true);
    expect(matchesFileFilter('no-extension', '*.*')).toBe(true);
    expect(matchesFileFilter('', '*.*')).toBe(true);
  });

  it('accepts anything when no filter is given', () => {
    expect(matchesFileFilter('aria2.conf')).toBe(true);
    expect(matchesFileFilter('aria2.conf', '')).toBe(true);
  });

  it('matches an explicit, comma separated list', () => {
    const filter = '.json,.torrent,.metalink';

    expect(matchesFileFilter('aria-ng-options.json', filter)).toBe(true);
    expect(matchesFileFilter('ubuntu.torrent', filter)).toBe(true);
    expect(matchesFileFilter('video.metalink', filter)).toBe(true);
    expect(matchesFileFilter('notes.txt', filter)).toBe(false);
    expect(matchesFileFilter('aria2.conf', filter)).toBe(false);
  });

  it('ignores whitespace and empty entries in the list', () => {
    expect(matchesFileFilter('a.json', ' .json , , .txt ')).toBe(true);
    expect(matchesFileFilter('a.txt', ' .json , , .txt ')).toBe(true);
    expect(matchesFileFilter('a.png', ' .json , , .txt ')).toBe(false);
  });

  it('anchors the pattern at the end of the name', () => {
    // `.json` only matches a *suffix*, not an infix.
    expect(matchesFileFilter('aria-ng-options.json', '.json')).toBe(true);
    expect(matchesFileFilter('json.txt', '.json')).toBe(false);
    expect(matchesFileFilter('backup.json.txt', '.json')).toBe(false);
  });

  it('treats the pattern as a regular expression, like AriaNg', () => {
    // AriaNg did not escape the filter, so `.` is "any character".
    expect(matchesFileFilter('aria2json', 'json')).toBe(true);
    expect(matchesFileFilter('prefix-json', '-json')).toBe(true);
    expect(matchesFileFilter('prefix_json', '-json')).toBe(false);
  });

  it('never throws on a malformed pattern', () => {
    expect(() => matchesFileFilter('a.json', '([unclosed')).not.toThrow();
    expect(matchesFileFilter('a.json', '([unclosed')).toBe(false);
  });
});

describe('readFileAsText', () => {
  it('resolves with the file content', async () => {
    const file = textFile('aria2.conf', 'max-connection-per-server=16\n');
    await expect(readFileAsText(file)).resolves.toBe('max-connection-per-server=16\n');
  });

  it('resolves with an empty string for an empty file', async () => {
    await expect(readFileAsText(textFile('empty', ''))).resolves.toBe('');
  });

  it('keeps non-latin1 content intact', async () => {
    const file = textFile('中文.txt', '下载完成');
    await expect(readFileAsText(file)).resolves.toBe('下载完成');
  });
});

describe('readFileAsBase64', () => {
  it('strips the data-url prefix', async () => {
    const file = textFile('plain.txt', 'hello');
    // 'hello' -> aGVsbG8=
    await expect(readFileAsBase64(file)).resolves.toBe('aGVsbG8=');
    await expect(readFileAsBase64(file)).resolves.not.toMatch(/^data:/);
  });

  it('encodes an empty file as an empty string', async () => {
    await expect(readFileAsBase64(textFile('empty', ''))).resolves.toBe('');
  });

  it('encodes non-latin1 content as utf-8 bytes', async () => {
    // '中' -> e4b8ad
    await expect(readFileAsBase64(textFile('中.txt', '中'))).resolves.toBe('5Lit');
  });

  it('picks the base64 payload out of the middle of the prefix', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'blob.bin', { type: 'application/octet-stream' });
    const encoded = await readFileAsBase64(file);
    expect(encoded.startsWith(DATA_URL_PREFIX) || /^[A-Za-z0-9+/=]+$/.test(encoded)).toBe(true);
    expect(encoded).toBe('AQID');
  });
});
