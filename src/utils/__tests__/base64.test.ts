import { describe, expect, it } from 'vitest';
import {
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  generateUniqueId,
} from '../base64';

/** Everything `btoa` would have thrown on. */
const NON_LATIN1 = ['中文字符串', '👋🌏 日本語もね', 'Ω≈ç√∫˜µ≤≥÷', 'Ünïcödé'];

describe('encodeBase64 / decodeBase64', () => {
  it('matches the RFC 4648 test vectors', () => {
    expect(encodeBase64('')).toBe('');
    expect(encodeBase64('f')).toBe('Zg==');
    expect(encodeBase64('fo')).toBe('Zm8=');
    expect(encodeBase64('foo')).toBe('Zm9v');
    expect(encodeBase64('foob')).toBe('Zm9vYg==');
    expect(encodeBase64('fooba')).toBe('Zm9vYmE=');
    expect(encodeBase64('foobar')).toBe('Zm9vYmFy');
  });

  it('decodes the RFC 4648 test vectors', () => {
    expect(decodeBase64('')).toBe('');
    expect(decodeBase64('Zg==')).toBe('f');
    expect(decodeBase64('Zm8=')).toBe('fo');
    expect(decodeBase64('Zm9v')).toBe('foo');
    expect(decodeBase64('Zm9vYmFy')).toBe('foobar');
  });

  it('round-trips ASCII', () => {
    for (const sample of ['', 'a', 'hello world', 'AriaNg', '0123456789', 'x'.repeat(1000)]) {
      expect(decodeBase64(encodeBase64(sample))).toBe(sample);
    }
  });

  it('round-trips Chinese, emoji and other non-latin1 text', () => {
    // `btoa` throws InvalidCharacterError on every one of these.
    for (const sample of NON_LATIN1) {
      expect(decodeBase64(encodeBase64(sample))).toBe(sample);
    }
  });

  it('round-trips text whose UTF-8 length is not a multiple of 3', () => {
    // 1, 2 and 4 byte sequences, which exercise every padding case.
    expect(decodeBase64(encodeBase64('é'))).toBe('é');
    expect(decodeBase64(encodeBase64('中'))).toBe('中');
    expect(decodeBase64(encodeBase64('🌏'))).toBe('🌏');
  });

  it('pads only when it has to', () => {
    expect(encodeBase64('foobar')).toBe('Zm9vYmFy');
    expect(encodeBase64('fooba')).toBe('Zm9vYmE=');
    expect(encodeBase64('foob')).toBe('Zm9vYg==');
    expect(encodeBase64('fo')).toBe('Zm8=');
  });

  it('produces the standard alphabet, never the url-safe one', () => {
    // U+FFFF encodes to the byte triple EF BF BF, whose 6-bit groups are
    // 62, 62, 63, 63 -> `+` and `/`.
    expect(encodeBase64('￿')).toBe('77+/');
    expect(encodeBase64Url('￿')).toBe('77-_');
  });
});

describe('base64url', () => {
  it('never emits +, / or =', () => {
    const samples = [...NON_LATIN1, '￿', 'a'.repeat(64)];
    for (const sample of samples) {
      const encoded = encodeBase64Url(sample);
      expect(encoded).not.toMatch(/[+/=]/);
      expect(decodeBase64Url(encoded)).toBe(sample);
    }
  });

  it('matches the RFC 4648 §5 test vectors', () => {
    expect(encodeBase64Url('foob')).toBe('Zm9vYg');
    expect(encodeBase64Url('foob')).not.toContain('=');
  });

  it('decodes padded standard base64 too (interop)', () => {
    // A value that came out of encodeBase64 must still decode.
    expect(decodeBase64Url('77+/')).toBe('￿');
    expect(decodeBase64Url('Zm8=')).toBe('fo');
  });
});

describe('invalid input', () => {
  // Documented policy: decoding returns '' and never throws.
  it.each([
    ['a', 'a single leftover base64 character'],
    ['Zm9v!', 'a character outside the alphabet'],
    ['====', 'nothing but padding'],
    ['中', 'non-ascii input'],
  ])('returns the empty string for %j (%s)', (input) => {
    expect(() => decodeBase64(input)).not.toThrow();
    expect(decodeBase64(input)).toBe('');
    expect(() => decodeBase64Url(input)).not.toThrow();
    expect(decodeBase64Url(input)).toBe('');
  });

  it('returns the empty string for empty input', () => {
    expect(decodeBase64('')).toBe('');
    expect(decodeBase64Url('')).toBe('');
  });

  it('ignores whitespace inside the payload', () => {
    expect(decodeBase64('Zm9v\nYmFy')).toBe('foobar');
    expect(decodeBase64('  Zm9vYmFy  ')).toBe('foobar');
  });

  it('tolerates a non-string argument at runtime', () => {
    // The API is typed, but the codecs are also fed values read from storage.
    expect(decodeBase64(undefined as unknown as string)).toBe('');
    expect(encodeBase64(undefined as unknown as string)).toBe('');
  });
});

describe('generateUniqueId', () => {
  it('is valid standard base64', () => {
    const id = generateUniqueId();
    expect(id).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('decodes to <prefix>_<epochSeconds>_<random>', () => {
    const before = Math.round(Date.now() / 1000);
    const id = generateUniqueId();
    const after = Math.round(Date.now() / 1000);

    const decoded = decodeBase64(id);
    const match = /^AriaNg_(\d+)_([0-9.]+)$/.exec(decoded);

    expect(match).not.toBeNull();
    const seconds = Number(match?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(before);
    expect(seconds).toBeLessThanOrEqual(after);
    expect(Number(match?.[2])).toBeGreaterThanOrEqual(0);
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateUniqueId()));
    expect(ids.size).toBe(50);
  });
});
