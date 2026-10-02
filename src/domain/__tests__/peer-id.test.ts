import { describe, expect, it } from 'vitest';

import { decodePercentEncoded, parsePeerClient } from '../peer-id';

describe('parsePeerClient — Azureus style', () => {
  it('decodes qBittorrent', () => {
    expect(parsePeerClient('-qB4550-1234567890')).toMatchObject({
      name: 'qBittorrent',
      version: '4.5.5',
      info: 'Qt/C++',
    });
  });

  it('decodes Transmission', () => {
    expect(parsePeerClient('-TR3000-4d5e6f7a8b')).toMatchObject({
      name: 'Transmission',
      version: '3.0.0',
      info: 'C++',
    });
  });

  it('decodes µTorrent', () => {
    expect(parsePeerClient('-UT3500-0123456789')).toMatchObject({
      name: 'µTorrent',
      version: '3.5.0',
    });
  });

  it('decodes libtorrent 1.x (-lt0)', () => {
    expect(parsePeerClient('-lt0120-abcdefghij')).toMatchObject({
      name: 'libtorrent',
      version: '1.2.0',
      info: 'C++, 1.x',
    });
  });

  it('decodes libtorrent 2.x (-ltt)', () => {
    expect(parsePeerClient('-ltt2000-abcdefghij')).toMatchObject({
      name: 'libtorrent',
      version: '2.0.0',
    });
  });

  it('decodes libtorrent uppercase codes', () => {
    expect(parsePeerClient('-LT0120-abcdefghij')).toMatchObject({
      name: 'libtorrent',
      version: '1.2.0',
    });
  });

  it('decodes Deluge', () => {
    expect(parsePeerClient('-DE2400-0123456789')).toMatchObject({
      name: 'Deluge',
      version: '2.4.0',
      info: 'Python',
    });
  });

  it('decodes Vuze', () => {
    expect(parsePeerClient('-VY4020-0123456789')).toMatchObject({
      name: 'Vuze',
      version: '4.0.2',
      info: 'Java',
    });
  });

  it('matches the client code case-insensitively', () => {
    expect(parsePeerClient('-QB5050-0123456789')).toMatchObject({
      name: 'qBittorrent',
      version: '5.0.5',
    });
  });

  it('falls back gracefully for an unknown client code', () => {
    expect(parsePeerClient('-XY1234-0123456789')).toEqual({
      name: 'XY',
      info: 'Azureus-style peer id',
      version: '1.2.3',
    });
  });

  it('omits the version when the 3 version chars are not digits', () => {
    expect(parsePeerClient('-qBaaaa-0123456789')).toEqual({
      name: 'qBittorrent',
      info: 'Qt/C++',
    });
  });

  it('decodes a bare client code without any version chars', () => {
    expect(parsePeerClient('-lt0')).toEqual({
      name: 'libtorrent',
      info: 'C++, 1.x',
    });
  });

  it('accepts the percent-encoded form aria2 reports', () => {
    expect(parsePeerClient('%2DqB4550%2D1234567890')).toMatchObject({
      name: 'qBittorrent',
      version: '4.5.5',
    });
  });
});

describe('parsePeerClient — MPEG-4 style', () => {
  it('reports the style byte when the 4th char is a digit', () => {
    expect(parsePeerClient('abc3defghij')).toEqual({ name: 'MPEG-4/3' });
    expect(parsePeerClient('abc0')).toEqual({ name: 'MPEG-4/0' });
  });
});

describe('parsePeerClient — unsupported encodings', () => {
  it('returns undefined for an empty / too short id', () => {
    expect(parsePeerClient('')).toBeUndefined();
    expect(parsePeerClient('abc')).toBeUndefined();
  });

  it('returns undefined for BitTorrent v2 style and other unknown ids', () => {
    expect(parsePeerClient('aVeryLongPeerIdThatIsNotRecognised0')).toBeUndefined();
    expect(parsePeerClient('\u0000\u0000\u0000\u0000\u0000\u0000\u0000MPEG-4/2.0')).toBeUndefined();
  });
});

describe('decodePercentEncoded', () => {
  it('decodes a valid percent-encoded id', () => {
    expect(decodePercentEncoded('%2DqB4550')).toBe('-qB4550');
    expect(decodePercentEncoded('%E4%B8%AD')).toBe('中');
  });

  it('returns plain ids untouched', () => {
    expect(decodePercentEncoded('-qB4550-1234567890')).toBe('-qB4550-1234567890');
    expect(decodePercentEncoded('')).toBe('');
  });

  it('returns the input when the sequence is malformed', () => {
    expect(decodePercentEncoded('100%')).toBe('100%');
    expect(decodePercentEncoded('%ZZ')).toBe('%ZZ');
    expect(decodePercentEncoded('%E4%B8')).toBe('%E4%B8');
    expect(decodePercentEncoded('%')).toBe('%');
  });
});