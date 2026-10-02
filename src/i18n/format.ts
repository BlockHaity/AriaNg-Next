/**
 * Intl-based replacements for AriaNg's moment / angular filter pipeline.
 *
 * AriaNg leaned on `$filter('number')`, `moment` and a handful of custom
 * filters (`src/scripts/filters/{volume,percent,dateDuration,longDate,
 * timeDisplayName}.js`). Those are reproduced here against `Intl`, keeping the
 * observable output identical — including the quirks — so the shipped
 * translations and any screenshot comparison still line up.
 *
 * Every function is pure and takes an optional `locale`, defaulting to the
 * active locale of the {@link i18n} singleton. Pass a locale explicitly in
 * tests or in code that must stay stable across a locale switch.
 */

import { i18n } from './i18n';
import type { TranslateFn } from './types';

/** Fallback date pattern, matching the English `format.longdate`. */
export const DEFAULT_LONG_DATE_PATTERN = 'MM/DD/YYYY HH:mm:ss';

/** AriaNg's `defaultFractionSize` in `filters/volume.js`. */
const DEFAULT_FRACTION_SIZE = 2;

/** Angular's `number` filter caps fraction digits at 20. */
const MAX_FRACTION_DIGITS = 20;

/**
 * Unit labels.
 *
 * `B`/`KB`/`MB`/`GB` are AriaNg's, verbatim — note they step by 1024, so they
 * really mean KiB/MiB/GiB. The labels stay untouched because translation
 * strings and user muscle memory are keyed to them. `TB`/`PB` are an
 * aria2-next addition for large state dirs and multi-terabyte torrents.
 */
export const VOLUME_UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Translation key AriaNg used for an ETA beyond a day. */
export const MORE_THAN_ONE_DAY_KEY = 'More Than One Day';

/** AriaNg's `remainTime` cut-off, in seconds. */
const ONE_DAY_SECONDS = 86400;

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

/* ------------------------------------------------------------------ */
/* Locale helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Our locale keys are AriaNg file keys (`zh_Hans`), which are not valid
 * BCP-47. Normalise to a tag `Intl` accepts, and fall back to the runtime
 * default rather than throwing on a malformed input.
 */
export function toIntlLocale(locale?: string): string | undefined {
  if (!locale) {
    return undefined;
  }

  const tag = locale.replace(/_/g, '-');

  try {
    // Throws RangeError for a structurally invalid tag.
    Intl.NumberFormat.supportedLocalesOf(tag);
    return tag;
  } catch {
    return undefined;
  }
}

/** The locale to format with: explicit argument, else the singleton's. */
function activeLocale(locale?: string): string | undefined {
  return toIntlLocale(locale ?? i18n.locale);
}

/** The active locale as a valid BCP-47 tag, or `undefined` for the default. */
export function currentIntlLocale(): string | undefined {
  return activeLocale(i18n.locale);
}

/**
 * Angular's `number` filter: `fractionSize` is applied as **both** the minimum
 * and the maximum, i.e. fixed-width decimals, with locale grouping separators.
 */
function formatFixed(value: number, fractionSize: number, locale?: string): string {
  const digits = Math.min(Math.max(Math.trunc(fractionSize), 0), MAX_FRACTION_DIGITS);

  return new Intl.NumberFormat(activeLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Locale-aware fixed-decimal number, for the few columns AriaNg passed raw. */
export function formatNumber(value: number, fractionSize = 0, locale?: string): string {
  return formatFixed(value, fractionSize, locale);
}

/* ------------------------------------------------------------------ */
/* Volume                                                                */
/* ------------------------------------------------------------------ */

/** AriaNg's `getAutoFractionSize` from `filters/volume.js`. */
function getAutoFractionSize(value: number): number {
  if (value < 1) {
    return 2;
  }

  if (value < 10) {
    return 1;
  }

  return 0;
}

/**
 * AriaNg's `readableVolume` filter.
 *
 * ```
 * readableVolume(0)             // '0.00 B'
 * readableVolume(1024)          // '1.00 KB'
 * readableVolume(1048576)       // '1.00 MB'
 * readableVolume(1536, 'auto')  // '1.5 KB'
 * ```
 *
 * `fractionSize` may be a number (fixed decimals) or `'auto'` (2 decimals
 * below 1, 1 decimal below 10, none above). Falsy input is `0`; non-numeric
 * input is `parseInt`-ed, so garbage yields `'NaN B'` — exactly what AriaNg
 * rendered.
 */
export function readableVolume(
  value: number | string,
  fractionSize: number | 'auto' = DEFAULT_FRACTION_SIZE,
  locale?: string,
): string {
  let unit = VOLUME_UNITS[0];
  let actualFractionSize = DEFAULT_FRACTION_SIZE;
  let autoFractionSize = false;

  if (typeof fractionSize === 'number') {
    actualFractionSize = fractionSize;
  } else if (fractionSize === 'auto') {
    autoFractionSize = true;
  }

  let amount = value;

  if (!amount) {
    amount = 0;
  }

  if (typeof amount !== 'number') {
    amount = parseInt(amount, 10);
  }

  for (let i = 1; i < VOLUME_UNITS.length; i++) {
    if (amount >= 1024) {
      amount = amount / 1024;
      unit = VOLUME_UNITS[i];
    } else {
      break;
    }
  }

  if (autoFractionSize) {
    actualFractionSize = getAutoFractionSize(amount);
  }

  return `${formatFixed(amount, actualFractionSize, locale)} ${unit}`;
}

/**
 * AriaNg's `percent` filter: **truncate** to `precision` decimals (it used
 * `parseInt(value * ratio) / ratio`, not `Math.round`), then format with
 * exactly that many decimals.
 */
export function formatPercent(value: number, precision = 0, locale?: string): string {
  const digits = Math.min(Math.max(Math.trunc(precision), 0), MAX_FRACTION_DIGITS);
  const ratio = Math.pow(10, digits);

  return formatFixed(parseInt(String(value * ratio)) / ratio, digits, locale);
}

/* ------------------------------------------------------------------ */
/* Durations                                                            */
/* ------------------------------------------------------------------ */

/**
 * Formats a duration with a clock-style pattern.
 *
 * AriaNg's `dateDuration` ran `moment.utc(ms).format(pattern)`, so the result
 * is a **pure offset from the epoch**: hours wrap at 24 and nothing is
 * timezone-dependent. Plain arithmetic reproduces that exactly, which also
 * makes it deterministic in tests.
 *
 * Supported tokens: `SSS`, `HH`, `H`, `hh`, `h`, `mm`, `m`, `ss`, `s`. Anything
 * else is copied through verbatim, so `年`-style literals work.
 */
export function formatDuration(ms: number, pattern = 'HH:mm:ss'): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.trunc(ms)) : 0;

  const hours = Math.floor(total / MILLISECONDS_PER_HOUR) % 24;
  const minutes = Math.floor(total / MILLISECONDS_PER_MINUTE) % 60;
  const seconds = Math.floor(total / MILLISECONDS_PER_SECOND) % 60;
  const millis = total % MILLISECONDS_PER_SECOND;

  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;

  // Longest tokens first so `HH` is not consumed as two `H`s.
  const tokens: ReadonlyArray<readonly [string, () => string]> = [
    ['SSS', () => pad(millis, 3)],
    ['HH', () => pad(hours, 2)],
    ['H', () => String(hours)],
    ['hh', () => pad(hour12, 2)],
    ['h', () => String(hour12)],
    ['mm', () => pad(minutes, 2)],
    ['m', () => String(minutes)],
    ['ss', () => pad(seconds, 2)],
    ['s', () => String(seconds)],
  ];

  let result = '';
  let index = 0;

  while (index < pattern.length) {
    const rest = pattern.slice(index);
    const token = tokens.find(([name]) => rest.startsWith(name));

    if (token) {
      result += token[1]();
      index += token[0].length;
    } else {
      result += pattern[index];
      index += 1;
    }
  }

  return result;
}

/**
 * The ETA cell, ported from `views/list.html`:
 *
 * ```
 * 0 <= task.remainTime && task.remainTime < 86400
 *     ? (task.remainTime | dateDuration: 'second': 'HH:mm:ss')
 *     : ('More Than One Day' | translate)
 * ```
 *
 * `null` (aria2 could not estimate) renders nothing, so the caller can show a
 * placeholder. Anything at or past a day — and anything non-numeric, such as
 * `NaN` — returns {@link MORE_THAN_ONE_DAY_KEY}, which the UI translates.
 */
export function formatRemainTime(remainTimeSeconds: number | null): string {
  if (remainTimeSeconds === null) {
    return '';
  }

  if (remainTimeSeconds >= 0 && remainTimeSeconds < ONE_DAY_SECONDS) {
    return formatDuration(remainTimeSeconds * MILLISECONDS_PER_SECOND, 'HH:mm:ss');
  }

  return MORE_THAN_ONE_DAY_KEY;
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

/**
 * Tokens understood in a `format.longdate` pattern, with the single-field
 * `Intl.DateTimeFormat` options that reproduce what moment rendered.
 *
 * `A` / `a` are accepted but carry no weight: the 24-hour `hourCycle: 'h23'`
 * already decides the day period, and `Intl` would otherwise inject an
 * unwanted AM/PM marker.
 */
const DATE_TOKENS: ReadonlyArray<readonly [string, Intl.DateTimeFormatOptions | null]> = [
  ['YYYY', { year: 'numeric' }],
  ['YY', { year: '2-digit' }],
  ['MMMM', { month: 'long' }],
  ['MMM', { month: 'short' }],
  ['MM', { month: '2-digit' }],
  ['M', { month: 'numeric' }],
  ['DD', { day: '2-digit' }],
  ['D', { day: 'numeric' }],
  ['HH', { hour: '2-digit', hourCycle: 'h23' }],
  ['H', { hour: 'numeric', hourCycle: 'h23' }],
  ['hh', { hour: '2-digit', hour12: true }],
  ['h', { hour: 'numeric', hour12: true }],
  ['mm', { minute: '2-digit' }],
  ['m', { minute: 'numeric' }],
  ['ss', { second: '2-digit' }],
  ['s', { second: 'numeric' }],
  ['A', null],
  ['a', null],
];

/**
 * Tokens whose value must render **bare**.
 *
 * Some locales decorate numeric date fields with their own words — `Intl`
 * renders `2026年10月02日` for `zh-Hans` — which would fight with the literals
 * the translation already supplies (`YYYY年MM月DD日`), producing
 * `2026年年10月月02日日`. So purely numeric fields are formatted with a neutral
 * locale and the pattern's own literals are spliced back in by the caller,
 * exactly as moment did (moment has no per-locale field decorations unless the
 * app opts in with `preparsePostformat`).
 *
 * Name tokens (`MMMM`/`MMM`) stay localised, so `10月` / `October` / `октябрь`
 * still come out in the user's language.
 */
const BARE_DATE_TOKENS = new Set([
  'YYYY',
  'YY',
  'MM',
  'M',
  'DD',
  'D',
  'HH',
  'H',
  'hh',
  'h',
  'mm',
  'm',
  'ss',
  's',
]);

/** Longest-first, so `MMMM` is not consumed as `MM` + `MM`. */
const DATE_TOKEN_PATTERN = /YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|A|a/g;

/** Per-token formatters are hot enough to be worth caching. */
const tokenFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getTokenFormatter(token: string, intlLocale: string | undefined): Intl.DateTimeFormat | null {
  const entry = DATE_TOKENS.find(([name]) => name === token);

  if (!entry) {
    return null;
  }

  const options = entry[1];

  if (!options) {
    return null;
  }

  const tag = BARE_DATE_TOKENS.has(token) ? 'en' : intlLocale;
  const cacheKey = `${tag ?? ''}|${token}`;
  const cached = tokenFormatterCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(tag, options);
  tokenFormatterCache.set(cacheKey, formatter);

  return formatter;
}

/**
 * Width implied by a numeric token: `MM` is 2 digits wide, `M` is 1.
 *
 * `Intl` does not reliably zero-pad on `'2-digit'` — `{ minute: '2-digit' }`
 * formats `6` as `"6"` in `en` — so the padding moment gave us is applied here
 * instead of trusting the locale data.
 */
function numericTokenWidth(token: string): number {
  return token.length;
}

/**
 * Renders one token.
 *
 * Numeric fields are padded to the token's width; name fields (`MMMM` / `MMM`)
 * and the AM/PM marker come straight from the locale.
 */
function renderDateToken(token: string, date: Date, intlLocale: string | undefined): string {
  if (token === 'A' || token === 'a') {
    const hour = date.getHours();
    const meridiem = new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', hour12: true })
      .formatToParts(date)
      .find((part) => part.type === 'dayPeriod');

    // Prefer the locale's own day-period word, falling back to a sensible
    // English default if the locale supplies none.
    return meridiem?.value ?? (hour < 12 ? 'AM' : 'PM');
  }

  const formatter = getTokenFormatter(token, intlLocale);

  if (!formatter) {
    return token;
  }

  if (!BARE_DATE_TOKENS.has(token)) {
    return formatter.format(date);
  }

  const numeric = formatter
    .formatToParts(date)
    .find((part) => part.type !== 'literal')
    ?.value;

  if (numeric === undefined) {
    return formatter.format(date);
  }

  return numeric.padStart(numericTokenWidth(token), '0');
}

/**
 * AriaNg's `longDate` filter: `moment(time).format(getLongDateFormat())`.
 *
 * The pattern comes from the locale's `LanguageMeta.longDatePattern`, which
 * mirrors `format.longdate` in each `langs/*.txt`.
 *
 * The pattern is rendered **token by token**, with every non-token run treated
 * as literal text. That is what makes `YYYY年MM月DD日 HH:mm:ss` come out as
 * `2026年10月02日 19:06:00` instead of being reordered by the locale's own date
 * layout, and it keeps the field order exactly as the translation declares it —
 * which is precisely moment's behaviour.
 *
 * Numeric fields are formatted with a neutral locale so that locales which
 * decorate their own dates (`zh-Hans` renders `2026年10月02日`) do not collide
 * with the literals the pattern already carries.
 */
export function formatLongDate(
  unixSeconds: number,
  longDatePattern: string = DEFAULT_LONG_DATE_PATTERN,
  locale?: string,
): string {
  const pattern = longDatePattern || DEFAULT_LONG_DATE_PATTERN;
  const intlLocale = activeLocale(locale);
  const date = new Date(unixSeconds * MILLISECONDS_PER_SECOND);

  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  DATE_TOKEN_PATTERN.lastIndex = 0;

  while ((match = DATE_TOKEN_PATTERN.exec(pattern)) !== null) {
    if (match.index > lastIndex) {
      result += pattern.slice(lastIndex, match.index);
    }

    const token = match[0];

    result += renderDateToken(token, date, intlLocale);
    lastIndex = match.index + token.length;
  }

  if (lastIndex < pattern.length) {
    result += pattern.slice(lastIndex);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Option values                                                        */
/* ------------------------------------------------------------------ */

/**
 * AriaNg's `timeDisplayName` filter, over
 * `ariaNgCommonService.getTimeOption`.
 *
 * `time` is in **milliseconds**. A falsy time (`0` = "Disabled") yields
 * `defaultName`; otherwise the singular/plural `format.time.*` key is chosen
 * from the magnitude and `{{value}}` is interpolated with the converted amount.
 *
 * Pass `translate` to resolve against a different store; it defaults to the
 * {@link i18n} singleton.
 */
export function formatTimeOption(time: number, defaultName: string, translate?: TranslateFn): string {
  const t = translate ?? i18n.t;

  if (!time) {
    return t(defaultName);
  }

  let name: string;
  let value: number;

  if (time < MILLISECONDS_PER_SECOND) {
    value = time;
    name = value === 1 ? 'format.time.millisecond' : 'format.time.milliseconds';
  } else if (time < MILLISECONDS_PER_MINUTE) {
    value = time / MILLISECONDS_PER_SECOND;
    name = value === 1 ? 'format.time.second' : 'format.time.seconds';
  } else if (time < MILLISECONDS_PER_HOUR) {
    value = time / MILLISECONDS_PER_SECOND / 60;
    name = value === 1 ? 'format.time.minute' : 'format.time.minutes';
  } else {
    value = time / MILLISECONDS_PER_SECOND / 60 / 60;
    name = value === 1 ? 'format.time.hour' : 'format.time.hours';
  }

  return t(name, { value });
}

/**
 * AriaNg's `getHumanReadableSize` from `directives/setting.js`, used for
 * options whose unit suffix is `Bytes`.
 *
 * Only an exact integer is rewritten, and only by a factor of 1024 that
 * divides evenly — `1024` becomes `1K`, but `1500` and `'1M'` come back
 * untouched. AriaNg's guards are reproduced literally (`parseInt(size)
 * .toString() !== size`), which also means `'01024'` is left alone.
 *
 * One deliberate fix: AriaNg looped `sizeUnits.length` times over a four-entry
 * array, so anything at or above 1 TiB indexed past the end and rendered as
 * `'1undefined'`. The index is clamped to the largest unit here, so 1 TiB reads
 * `'1G'`. See the test that pins this behaviour.
 */
export function formatBytesInput(value: string): string {
  const sizeUnits = ['', 'K', 'M', 'G'];
  let unitIndex = 0;

  if (!value || parseInt(value, 10).toString() !== value) {
    return value;
  }

  let size = parseInt(value, 10);

  for (let i = 0; i < sizeUnits.length; i++) {
    if (size < 1024 || size % 1024 !== 0) {
      break;
    }

    size = size / 1024;
    unitIndex = Math.min(unitIndex + 1, sizeUnits.length - 1);
  }

  return `${size}${sizeUnits[unitIndex]}`;
}