import { describe, expect, it } from 'vitest';

import { getOptionMeta } from '@/config/aria2-options';
import type { Aria2OptionMeta } from '@/config/types';
import {
  OPTION_ERROR_ABOVE_MAX,
  OPTION_ERROR_BELOW_MIN,
  OPTION_ERROR_EMPTY,
  OPTION_ERROR_NUMBER_INVALID,
  OPTION_ERROR_VALUE_INVALID,
  countItems,
  humanizeBytes,
  validateOptionValue,
  validationMessageParams,
} from '@/components/option-row/validation';

const meta = (key: string): Aria2OptionMeta => {
  const found = getOptionMeta(key);
  if (!found) {
    throw new Error(`unknown option ${key}`);
  }
  return found;
};

const fails = (key: string, raw: string) => {
  const result = validateOptionValue(meta(key), raw);
  return result.ok ? null : result.messageKey;
};

describe('validateOptionValue', () => {
  it('accepts any non-empty value without a meta', () => {
    expect(validateOptionValue(undefined, 'anything')).toEqual({ ok: true });
    expect(validateOptionValue(undefined, '')).toEqual({ ok: true });
  });

  it('requires a value for a required option (string type)', () => {
    expect(fails('dir', '')).toBe(OPTION_ERROR_EMPTY);
    expect(validateOptionValue(meta('dir'), '/downloads')).toEqual({ ok: true });
  });

  it('accepts an empty value for a non-required option', () => {
    expect(validateOptionValue(meta('out'), '')).toEqual({ ok: true });
  });

  it('validates integers with /^-?\\d+$/', () => {
    const key = 'retry-wait';
    expect(validateOptionValue(meta(key), '0')).toEqual({ ok: true });
    expect(validateOptionValue(meta(key), '5')).toEqual({ ok: true });
    expect(fails(key, '1.5')).toBe(OPTION_ERROR_NUMBER_INVALID);
    expect(fails(key, 'abc')).toBe(OPTION_ERROR_NUMBER_INVALID);
    expect(fails(key, '1e3')).toBe(OPTION_ERROR_NUMBER_INVALID);
    expect(fails(key, ' 1')).toBe(OPTION_ERROR_NUMBER_INVALID);
    // The sign is part of the syntax: a negative value is well-formed, and is
    // then rejected by the range guard.
    expect(fails(key, '-5')).toBe(OPTION_ERROR_BELOW_MIN);
  });

  it('validates floats with /^-?(\\d*\\.)?\\d+$/', () => {
    const key = 'seed-ratio';
    expect(validateOptionValue(meta(key), '1.0')).toEqual({ ok: true });
    expect(validateOptionValue(meta(key), '.5')).toEqual({ ok: true });
    expect(validateOptionValue(meta(key), '2')).toEqual({ ok: true });
    expect(fails(key, '1.')).toBe(OPTION_ERROR_NUMBER_INVALID);
    expect(fails(key, '0x10')).toBe(OPTION_ERROR_NUMBER_INVALID);
    expect(fails(key, '-0.25')).toBe(OPTION_ERROR_BELOW_MIN);
  });

  it('enforces min at the boundary (retry-wait: 0…600)', () => {
    const key = 'retry-wait';
    expect(validateOptionValue(meta(key), '0')).toEqual({ ok: true });
    expect(validateOptionValue(meta(key), '600')).toEqual({ ok: true });
    expect(fails(key, '-1')).toBe(OPTION_ERROR_BELOW_MIN);
    expect(fails(key, '601')).toBe(OPTION_ERROR_ABOVE_MAX);
  });

  it('enforces a min-only range (seed-ratio: min 0)', () => {
    expect(fails('seed-ratio', '-0.1')).toBe(OPTION_ERROR_BELOW_MIN);
    expect(fails('seed-ratio', '99999')).toBeNull();
  });

  it('skips the range check for a non-numeric value', () => {
    // The syntax guard fires first, so a min/max message can never mask it.
    expect(fails('retry-wait', 'nope')).toBe(OPTION_ERROR_NUMBER_INVALID);
  });

  it('enforces meta.pattern on strings', () => {
    const key = 'max-download-limit';
    expect(validateOptionValue(meta(key), '0')).toEqual({ ok: true });
    expect(validateOptionValue(meta(key), '1K')).toEqual({ ok: true });
    expect(validateOptionValue(meta(key), '20M')).toEqual({ ok: true });
    expect(fails(key, '1G')).toBe(OPTION_ERROR_VALUE_INVALID);
    expect(fails(key, 'fast')).toBe(OPTION_ERROR_VALUE_INVALID);
    // Required, so an empty value is caught before the pattern ever runs.
    expect(fails(key, '')).toBe(OPTION_ERROR_EMPTY);
  });

  it('enforces the checksum pattern', () => {
    expect(validateOptionValue(meta('checksum'), 'sha-1=0123456789abcdef')).toEqual({ ok: true });
    expect(fails('checksum', 'md5=nothex!')).toBe(OPTION_ERROR_VALUE_INVALID);
    expect(fails('checksum', 'crc32=0123abcd')).toBe(OPTION_ERROR_VALUE_INVALID);
  });

  it('does not validate boolean / option / string-or-option / text rows', () => {
    for (const key of ['check-integrity', 'file-allocation', 'media-video', 'header']) {
      expect(validateOptionValue(meta(key), 'whatever'), key).toEqual({ ok: true });
    }

    // Not required, so an empty value is simply "leave this row alone".
    for (const key of ['out', 'media-video', 'header']) {
      expect(validateOptionValue(meta(key), ''), key).toEqual({ ok: true });
    }

    // `required` still wins over the type, even for a select.
    expect(fails('check-integrity', '')).toBe(OPTION_ERROR_EMPTY);
  });

  it('does not validate a read-only option', () => {
    const readonlyMeta: Aria2OptionMeta = { ...meta('dir'), readonly: true };
    expect(validateOptionValue(readonlyMeta, '')).toEqual({ ok: true });
    expect(validateOptionValue({ ...meta('retry-wait'), readonly: true }, 'nope')).toEqual({ ok: true });
  });

  it('lets a malformed pattern through instead of locking the row', () => {
    const broken: Aria2OptionMeta = { key: 'x', type: 'string', category: 'advanced', pattern: '([' };
    expect(validateOptionValue(broken, 'anything')).toEqual({ ok: true });
  });
});

describe('validationMessageParams', () => {
  it('binds the offending bound to the min / max message', () => {
    expect(validationMessageParams(meta('retry-wait'), OPTION_ERROR_BELOW_MIN)).toEqual({ value: 0 });
    expect(validationMessageParams(meta('retry-wait'), OPTION_ERROR_ABOVE_MAX)).toEqual({ value: 600 });
  });

  it('has nothing to bind for the other messages', () => {
    expect(validationMessageParams(meta('retry-wait'), OPTION_ERROR_NUMBER_INVALID)).toBeUndefined();
    expect(validationMessageParams(meta('retry-wait'), OPTION_ERROR_EMPTY)).toBeUndefined();
    expect(validationMessageParams(undefined, OPTION_ERROR_BELOW_MIN)).toBeUndefined();
  });
});

describe('countItems', () => {
  it('counts nothing without a value or a separator', () => {
    expect(countItems('', '\n', true)).toBe(0);
    expect(countItems('a\nb', undefined, true)).toBe(0);
  });

  it('counts every entry when trimCount is off', () => {
    expect(countItems('a\nb\nc', '\n', false)).toBe(3);
    expect(countItems('a\n\nb', '\n', false)).toBe(3);
    expect(countItems('a\n   \nb', '\n', false)).toBe(3);
  });

  it('drops blank entries when trimCount is on', () => {
    expect(countItems('a\nb\nc', '\n', true)).toBe(3);
    expect(countItems('a\n\nb', '\n', true)).toBe(2);
    expect(countItems('a\n   \n\t\nb', '\n', true)).toBe(2);
    expect(countItems('\n\n', '\n', true)).toBe(0);
  });

  it('splits on a multi-character separator', () => {
    expect(countItems('a, b, c', ', ', true)).toBe(3);
  });

  it('handles the header row (separator \\n, trimCount)', () => {
    const header = meta('header');
    expect(countItems('X-A: 1\nX-B: 2', header.separator, Boolean(header.trimCount))).toBe(2);
  });
});

describe('humanizeBytes', () => {
  it('leaves values that are not plain byte counts alone', () => {
    expect(humanizeBytes('0')).toBe('0');
    expect(humanizeBytes('1023')).toBe('1023');
    expect(humanizeBytes('1500')).toBe('1500');
    expect(humanizeBytes('1M')).toBe('1M');
    expect(humanizeBytes('20M')).toBe('20M');
    expect(humanizeBytes('')).toBe('');
  });

  it('rewrites exact multiples of 1024', () => {
    expect(humanizeBytes('1024')).toBe('1K');
    expect(humanizeBytes('1048576')).toBe('1M');
    expect(humanizeBytes('1073741824')).toBe('1G');
  });

  it('clamps at the largest unit instead of rendering 1undefined', () => {
    // AriaNg looped over a four-entry array four times, so anything at or above
    // 1 TiB indexed past the end and printed '1undefined'. The value is
    // unchanged here; only the unit is clamped (see `formatBytesInput`).
    expect(humanizeBytes(String(1024 ** 4))).toBe('1G');
    expect(humanizeBytes(String(1024 ** 6))).toBe('1048576G');
  });
});