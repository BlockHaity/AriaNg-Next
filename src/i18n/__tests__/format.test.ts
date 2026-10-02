import { describe, expect, it } from 'vitest';

import {
  formatBytesInput,
  formatDuration,
  formatLongDate,
  formatNumber,
  formatPercent,
  formatRemainTime,
  formatTimeOption,
  MORE_THAN_ONE_DAY_KEY,
  readableVolume,
  toIntlLocale,
} from '../format';
import type { TranslateFn } from '../types';

/** AriaNg formatted numbers in the active locale; 'en' keeps assertions stable. */
const EN = 'en';

describe('readableVolume', () => {
  it('defaults to two fixed decimals and the B unit', () => {
    expect(readableVolume(0, undefined, EN)).toBe('0.00 B');
    expect(readableVolume(512, undefined, EN)).toBe('512.00 B');
  });

  it('formats 1023 B with a grouping separator', () => {
    expect(readableVolume(1023, undefined, EN)).toBe('1,023.00 B');
  });

  it('steps at 1024 with 1024-based maths and AriaNg\'s unit labels', () => {
    expect(readableVolume(1024, undefined, EN)).toBe('1.00 KB');
    expect(readableVolume(1024 * 1024, undefined, EN)).toBe('1.00 MB');
    expect(readableVolume(1024 ** 3, undefined, EN)).toBe('1.00 GB');
  });

  it('formats a MiB and a GiB', () => {
    expect(readableVolume(1024 ** 2, undefined, EN)).toBe('1.00 MB');
    expect(readableVolume(1.5 * 1024 ** 3, undefined, EN)).toBe('1.50 GB');
  });

  it('keeps the first four unit labels and extends with TB / PB', () => {
    expect(readableVolume(1024 ** 4, undefined, EN)).toBe('1.00 TB');
    expect(readableVolume(1024 ** 5, undefined, EN)).toBe('1.00 PB');
    // Beyond PB it stops at the largest unit rather than looping forever.
    expect(readableVolume(1024 ** 6, undefined, EN)).toBe('1,024.00 PB');
  });

  it('honours an explicit fraction size', () => {
    expect(readableVolume(1536, 0, EN)).toBe('2 KB');
    expect(readableVolume(1536, 3, EN)).toBe('1.500 KB');
  });

  it("picks 'auto' decimals from the scaled value", () => {
    // Below 1 -> 2 decimals, below 10 -> 1 decimal, otherwise none.
    expect(readableVolume(0.5, 'auto', EN)).toBe('0.50 B');
    expect(readableVolume(5, 'auto', EN)).toBe('5.0 B');
    expect(readableVolume(50, 'auto', EN)).toBe('50 B');
  });

  it("applies 'auto' after the 1024 scaling, not before", () => {
    // 1536 scales to 1.5 KB, which is below 10 -> 1 decimal.
    expect(readableVolume(1536, 'auto', EN)).toBe('1.5 KB');
    expect(readableVolume(5 * 1024, 'auto', EN)).toBe('5.0 KB');
    expect(readableVolume(50 * 1024, 'auto', EN)).toBe('50 KB');
  });

  it('crosses the auto boundaries exactly at 1 and 10', () => {
    // 1023 stays in B and is >= 10, so no decimals.
    expect(readableVolume(1023, 'auto', EN)).toBe('1,023 B');
    // One byte more scales to exactly 1.0 KB -> 1 decimal.
    expect(readableVolume(1024, 'auto', EN)).toBe('1.0 KB');
    expect(readableVolume(10 * 1024, 'auto', EN)).toBe('10 KB');
  });

  it('parseInts non-numeric input, as AriaNg did', () => {
    expect(readableVolume('2048', undefined, EN)).toBe('2.00 KB');
    expect(readableVolume('1024KB', undefined, EN)).toBe('1.00 KB');
  });

  it('treats falsy input as 0', () => {
    expect(readableVolume(0, undefined, EN)).toBe('0.00 B');
    expect(readableVolume('', undefined, EN)).toBe('0.00 B');
  });

  it('renders NaN for unparseable input, matching AriaNg', () => {
    expect(readableVolume('abc', undefined, EN)).toBe('NaN B');
  });

  it('follows the requested locale', () => {
    // de-DE uses a comma for the decimal separator.
    expect(readableVolume(1234567, undefined, 'de-DE')).toBe('1,18 MB');
  });
});

describe('formatPercent', () => {
  it('defaults to no decimals', () => {
    expect(formatPercent(0.5, undefined, EN)).toBe('0');
    expect(formatPercent(1, undefined, EN)).toBe('1');
  });

  it('truncates rather than rounds, like AriaNg', () => {
    expect(formatPercent(0.129, 2, EN)).toBe('0.12');
    expect(formatPercent(0.999, 2, EN)).toBe('0.99');
    expect(formatPercent(0.129, 1, EN)).toBe('0.1');
  });

  it('handles the 0 and 100 boundaries', () => {
    expect(formatPercent(0, 1, EN)).toBe('0.0');
    expect(formatPercent(1, 1, EN)).toBe('1.0');
  });

  it('handles negatives', () => {
    expect(formatPercent(-0.129, 2, EN)).toBe('-0.12');
  });
});

describe('formatDuration', () => {
  it('defaults to HH:mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(1000)).toBe('00:00:01');
    expect(formatDuration(61_000)).toBe('00:01:01');
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('wraps at 24 hours, like moment.utc().format("HH:mm:ss")', () => {
    expect(formatDuration(86_400_000)).toBe('00:00:00');
    expect(formatDuration(25 * 3_600_000)).toBe('01:00:00');
  });

  it('clamps negatives and non-finite input to zero', () => {
    expect(formatDuration(-5000)).toBe('00:00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00:00');
  });

  it('supports unpadded and 12-hour tokens', () => {
    expect(formatDuration(3_661_000, 'H:mm:ss')).toBe('1:01:01');
    expect(formatDuration(3_661_000, 'hh:mm')).toBe('01:01');
    expect(formatDuration(13 * 3_600_000, 'h:mm')).toBe('1:00');
  });

  it('supports milliseconds', () => {
    expect(formatDuration(1500, 'ss.SSS')).toBe('01.500');
  });

  it('passes literal text through', () => {
    expect(formatDuration(61_000, "mm'ss")).toBe("01'01");
  });
});

describe('formatRemainTime', () => {
  it('returns an empty string for null', () => {
    expect(formatRemainTime(null)).toBe('');
  });

  it('renders 0 as a zeroed clock', () => {
    expect(formatRemainTime(0)).toBe('00:00:00');
  });

  it('renders anything inside a day as HH:mm:ss', () => {
    expect(formatRemainTime(1)).toBe('00:00:01');
    expect(formatRemainTime(3661)).toBe('01:01:01');
    expect(formatRemainTime(86399)).toBe('23:59:59');
  });

  it('returns the translation key at exactly one day', () => {
    expect(formatRemainTime(86400)).toBe(MORE_THAN_ONE_DAY_KEY);
    expect(MORE_THAN_ONE_DAY_KEY).toBe('More Than One Day');
    expect(formatRemainTime(86400 * 7)).toBe(MORE_THAN_ONE_DAY_KEY);
  });

  it('returns the translation key for negative and non-numeric input', () => {
    // Matches AriaNg's `0 <= task.remainTime && task.remainTime < 86400` guard.
    expect(formatRemainTime(-1)).toBe(MORE_THAN_ONE_DAY_KEY);
    expect(formatRemainTime(Number.NaN)).toBe(MORE_THAN_ONE_DAY_KEY);
  });
});

describe('formatLongDate', () => {
  const STAMP = 1_790_967_965;

  /**
   * AriaNg used `moment(time).format(...)`, i.e. the browser's **local** zone,
   * so the expectations are built from the local-time fields of the stamp
   * instead of being hard-coded. That keeps the assertions valid whatever time
   * zone the suite happens to run under.
   */
  const local = new Date(STAMP * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const Y = local.getFullYear();
  const MO = pad(local.getMonth() + 1);
  const D = pad(local.getDate());
  const H = pad(local.getHours());
  const MI = pad(local.getMinutes());
  const S = pad(local.getSeconds());
  const H12 = local.getHours() % 12 === 0 ? 12 : local.getHours() % 12;
  const MERIDIEM = local.getHours() < 12 ? 'AM' : 'PM';

  it('defaults to the English pattern', () => {
    expect(formatLongDate(STAMP, undefined, EN)).toBe(`${MO}/${D}/${Y} ${H}:${MI}:${S}`);
  });

  it("renders AriaNg's zh_Hans pattern", () => {
    expect(formatLongDate(STAMP, 'YYYY年MM月DD日 HH:mm:ss', 'zh-Hans')).toBe(
      `${Y}年${MO}月${D}日 ${H}:${MI}:${S}`,
    );
  });

  it("renders AriaNg's zh_Hant pattern", () => {
    expect(formatLongDate(STAMP, 'YYYY年MM月DD日 HH:mm:ss', 'zh-Hant')).toBe(
      `${Y}年${MO}月${D}日 ${H}:${MI}:${S}`,
    );
  });

  it('renders a day-first pattern', () => {
    expect(formatLongDate(STAMP, 'DD/MM/YYYY HH:mm:ss', 'fr-FR')).toBe(
      `${D}/${MO}/${Y} ${H}:${MI}:${S}`,
    );
  });

  it('renders a year-first pattern', () => {
    expect(formatLongDate(STAMP, 'YYYY/MM/DD HH:mm:ss', 'ja-JP')).toBe(
      `${Y}/${MO}/${D} ${H}:${MI}:${S}`,
    );
  });

  it('keeps the token order the translation declares', () => {
    // Unlike a whole-field Intl format, the pattern's order wins regardless of
    // the locale's own preferred layout.
    expect(formatLongDate(STAMP, 'DD.MM.YYYY', 'zh-Hans')).toBe(`${D}.${MO}.${Y}`);
  });

  it('does not double up a locale\'s own date decorations', () => {
    // A whole-field `Intl.DateTimeFormat` renders zh-Hans as `2026年10月03日`.
    // The pattern carries its own literals, so they must not appear twice.
    const rendered = formatLongDate(STAMP, 'YYYY年MM月DD日', 'zh-Hans');

    expect(rendered).toBe(`${Y}年${MO}月${D}日`);
    expect(rendered.match(/年/g)).toHaveLength(1);
    expect(rendered.match(/月/g)).toHaveLength(1);
  });

  it('supports month names', () => {
    expect(formatLongDate(STAMP, 'MMMM D, YYYY', EN)).toBe(
      `${new Intl.DateTimeFormat(EN, { month: 'long' }).format(local)} ${local.getDate()}, ${Y}`,
    );
    expect(formatLongDate(STAMP, 'MMM', 'de-DE')).toBe(
      new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(local),
    );
  });

  it('supports 12-hour clocks', () => {
    expect(formatLongDate(STAMP, 'h:mm A', EN)).toBe(`${H12}:${MI} ${MERIDIEM}`);
  });

  it('falls back to the default pattern for an empty one', () => {
    expect(formatLongDate(STAMP, '', EN)).toBe(`${MO}/${D}/${Y} ${H}:${MI}:${S}`);
  });

  it('handles the epoch', () => {
    expect(formatLongDate(0, 'YYYY-MM-DD HH:mm:ss', 'en')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});

describe('formatTimeOption', () => {
  const t: TranslateFn = (key, params) =>
    params && 'value' in params ? `${key} [${String(params.value)}]` : key;

  it('returns the default name for a falsy time', () => {
    expect(formatTimeOption(0, 'Disabled', t)).toBe('Disabled');
  });

  it('picks the millisecond keys below 1000', () => {
    expect(formatTimeOption(1, 'Disabled', t)).toBe('format.time.millisecond [1]');
    expect(formatTimeOption(500, 'Disabled', t)).toBe('format.time.milliseconds [500]');
  });

  it('picks the second keys below a minute', () => {
    expect(formatTimeOption(1000, 'Disabled', t)).toBe('format.time.second [1]');
    expect(formatTimeOption(30_000, 'Disabled', t)).toBe('format.time.seconds [30]');
  });

  it('picks the minute keys below an hour', () => {
    expect(formatTimeOption(60_000, 'Disabled', t)).toBe('format.time.minute [1]');
    expect(formatTimeOption(600_000, 'Disabled', t)).toBe('format.time.minutes [10]');
  });

  it('picks the hour keys above an hour', () => {
    expect(formatTimeOption(3_600_000, 'Disabled', t)).toBe('format.time.hour [1]');
    expect(formatTimeOption(7_200_000, 'Disabled', t)).toBe('format.time.hours [2]');
  });

  it('resolves through the real English table by default', async () => {
    const { createI18n } = await import('../i18n');
    const { getLocaleLoaderFor } = await import('../locales');

    const store = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });
    await store.ready();

    expect(formatTimeOption(30_000, 'Disabled', store.t)).toBe('30 Seconds');
    expect(formatTimeOption(0, 'Disabled', store.t)).toBe('Disabled');
  });
});

describe('formatBytesInput', () => {
  it('leaves non-integers alone', () => {
    expect(formatBytesInput('1.5')).toBe('1.5');
    expect(formatBytesInput('1M')).toBe('1M');
    expect(formatBytesInput('abc')).toBe('abc');
    expect(formatBytesInput('')).toBe('');
  });

  it('leaves an integer that does not divide by 1024 alone', () => {
    expect(formatBytesInput('1500')).toBe('1500');
    expect(formatBytesInput('1023')).toBe('1023');
  });

  it('rewrites exact multiples of 1024', () => {
    expect(formatBytesInput('1024')).toBe('1K');
    expect(formatBytesInput('1048576')).toBe('1M');
    expect(formatBytesInput('1073741824')).toBe('1G');
    expect(formatBytesInput('2048')).toBe('2K');
  });

  it('clamps at the largest unit instead of AriaNg\'s undefined suffix', () => {
    // AriaNg looped `sizeUnits.length` times over a four-entry array, so
    // anything at or above 1 TiB indexed past the end and rendered as
    // "1undefined". The value is unchanged here; only the unit is clamped.
    expect(formatBytesInput(String(1024 ** 4))).toBe('1G');
    expect(formatBytesInput(String(1024 ** 6))).toBe('1048576G');
  });

  it('reproduces AriaNg\'s literal parseInt round-trip guard', () => {
    // `parseInt('01024').toString() !== '01024'`, so the leading zero survives.
    expect(formatBytesInput('01024')).toBe('01024');
  });
});

describe('toIntlLocale', () => {
  it('turns an AriaNg locale key into a BCP-47 tag', () => {
    expect(toIntlLocale('zh_Hans')).toBe('zh-Hans');
    expect(toIntlLocale('de_DE')).toBe('de-DE');
  });

  it('returns undefined for an empty locale', () => {
    expect(toIntlLocale(undefined)).toBeUndefined();
    expect(toIntlLocale('')).toBeUndefined();
  });

  it('returns undefined for a structurally invalid tag', () => {
    expect(toIntlLocale('not a locale!!')).toBeUndefined();
  });
});

describe('formatNumber', () => {
  it('applies fixed decimals with grouping', () => {
    expect(formatNumber(1234.5678, 2, EN)).toBe('1,234.57');
    expect(formatNumber(1234.5678, 0, EN)).toBe('1,235');
  });

  it('handles NaN', () => {
    expect(formatNumber(Number.NaN, 2, EN)).toBe('NaN');
  });
});