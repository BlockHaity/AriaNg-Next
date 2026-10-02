import { describe, expect, it } from 'vitest';
import {
  ARIA2_ERRORS,
  HIDDEN_ERROR_CODES,
  KNOWN_ERROR_CODES,
  NO_ERROR_CODES,
  RESERVED_ERROR_CODES,
  getErrorDescriptionKey,
  isHiddenError,
} from '../errors';

/** The exact table AriaNg's `aria2Errors.js` declares. */
const ARIA_NG_TABLE: Record<string, string> = {
  '1': 'error.unknown',
  '2': 'error.operation.timeout',
  '3': 'error.resource.notfound',
  '4': 'error.resource.notfound.max-file-not-found',
  '5': 'error.download.aborted.lowest-speed-limit',
  '6': 'error.network.problem',
  '8': 'error.resume.notsupported',
  '9': 'error.space.notenough',
  '10': 'error.piece.length.different',
  '11': 'error.download.sametime',
  '12': 'error.download.torrent.sametime',
  '13': 'error.file.exists',
  '14': 'error.file.rename.failed',
  '15': 'error.file.open.failed',
  '16': 'error.file.create.failed',
  '17': 'error.io.error',
  '18': 'error.directory.create.failed',
  '19': 'error.name.resolution.failed',
  '20': 'error.metalink.file.parse.failed',
  '21': 'error.ftp.command.failed',
  '22': 'error.http.response.header.bad',
  '23': 'error.redirects.toomany',
  '24': 'error.http.authorization.failed',
  '25': 'error.bencoded.file.parse.failed',
  '26': 'error.torrent.file.corrupted',
  '27': 'error.magnet.uri.bad',
  '28': 'error.option.bad',
  '29': 'error.server.overload',
  '30': 'error.rpc.request.parse.failed',
  '32': 'error.checksum.failed',
};

describe('ARIA2_ERRORS', () => {
  it('ports all 30 aria2 error codes', () => {
    expect(Object.keys(ARIA2_ERRORS)).toHaveLength(30);
    expect(KNOWN_ERROR_CODES).toHaveLength(30);
  });

  it('maps every code to AriaNg\'s descriptionKey', () => {
    expect(Object.fromEntries(Object.entries(ARIA2_ERRORS).map(([code, meta]) => [code, meta.descriptionKey]))).toEqual(
      ARIA_NG_TABLE,
    );
  });

  it('carries the numeric code alongside the key', () => {
    for (const [code, meta] of Object.entries(ARIA2_ERRORS)) {
      expect(meta.code).toBe(Number(code));
      expect(meta.descriptionKey.startsWith('error.')).toBe(true);
      expect(meta.hide).toBeUndefined();
    }
  });

  it('omits the codes that do not describe a failure', () => {
    // 0 = all successful, 7 = unfinished downloads, 31 = reserved.
    for (const code of ['0', '7', '31']) {
      expect(ARIA2_ERRORS[code]).toBeUndefined();
      expect(KNOWN_ERROR_CODES).not.toContain(code);
    }
    expect(NO_ERROR_CODES).toEqual(['0', '7']);
    expect(RESERVED_ERROR_CODES).toEqual(['31']);
    expect(HIDDEN_ERROR_CODES).toEqual(['0', '7', '31']);
  });

  it('lists KNOWN_ERROR_CODES in ascending order', () => {
    expect(KNOWN_ERROR_CODES).toEqual([...KNOWN_ERROR_CODES].sort((a, b) => Number(a) - Number(b)));
    expect(KNOWN_ERROR_CODES[0]).toBe('1');
    expect(KNOWN_ERROR_CODES.at(-1)).toBe('32');
  });
});

describe('getErrorDescriptionKey', () => {
  it('resolves every known code', () => {
    for (const [code, key] of Object.entries(ARIA_NG_TABLE)) {
      expect(getErrorDescriptionKey(code)).toBe(key);
    }
  });

  it('accepts numeric codes', () => {
    expect(getErrorDescriptionKey(1)).toBe('error.unknown');
    expect(getErrorDescriptionKey(32)).toBe('error.checksum.failed');
  });

  it('returns an empty string for absent codes', () => {
    expect(getErrorDescriptionKey(undefined)).toBe('');
    expect(getErrorDescriptionKey('')).toBe('');
  });

  it('returns an empty string for the non-error codes', () => {
    expect(getErrorDescriptionKey('0')).toBe('');
    expect(getErrorDescriptionKey(0)).toBe('');
    expect(getErrorDescriptionKey('7')).toBe('');
    expect(getErrorDescriptionKey(7)).toBe('');
    expect(getErrorDescriptionKey('31')).toBe('');
  });

  it('returns an empty string for unknown codes', () => {
    expect(getErrorDescriptionKey('33')).toBe('');
    expect(getErrorDescriptionKey(33)).toBe('');
    expect(getErrorDescriptionKey('-32601')).toBe('');
    expect(getErrorDescriptionKey('ENOENT')).toBe('');
    expect(getErrorDescriptionKey('nonsense')).toBe('');
    expect(getErrorDescriptionKey(NaN)).toBe('');
  });

  it('does not treat a differently formatted code as known', () => {
    expect(getErrorDescriptionKey('01')).toBe('');
    expect(getErrorDescriptionKey(' 1')).toBe('');
    expect(getErrorDescriptionKey('1 ')).toBe('');
  });
});

describe('isHiddenError', () => {
  it('is true for the reserved / success codes', () => {
    expect(isHiddenError('0')).toBe(true);
    expect(isHiddenError('7')).toBe(true);
    expect(isHiddenError('31')).toBe(true);
  });

  it('is false for describable and unknown codes', () => {
    expect(isHiddenError('1')).toBe(false);
    expect(isHiddenError('32')).toBe(false);
    expect(isHiddenError('99')).toBe(false);
    expect(isHiddenError('')).toBe(false);
    expect(isHiddenError(undefined)).toBe(false);
  });

  it('agrees with getErrorDescriptionKey', () => {
    for (const code of [...KNOWN_ERROR_CODES, ...HIDDEN_ERROR_CODES]) {
      expect(isHiddenError(code)).toBe(HIDDEN_ERROR_CODES.includes(code));
      expect(getErrorDescriptionKey(code)).toBe(
        ARIA2_ERRORS[code]?.descriptionKey ?? '',
      );
    }
  });

  it('hides nothing it does not know about', () => {
    // An unknown code is not "hidden", it is simply undescribed.
    expect(isHiddenError('99')).toBe(false);
    expect(getErrorDescriptionKey('99')).toBe('');
  });
});