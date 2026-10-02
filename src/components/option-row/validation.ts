/**
 * Client-side validation for one option row.
 *
 * Ported 1:1 from AriaNg's `ngSetting` link function
 * (`scripts/directives/setting.js`), where the four guards live inside
 * `scope.changeValue`. The messages are the **raw i18n keys** (not translated
 * text) so this module stays pure and testable; the component passes them
 * through `t()`.
 *
 * The order of the guards matters — it is what decides which message a user
 * sees for a value that breaks several rules at once — so it is reproduced
 * exactly: empty → integer/float syntax → min/max → pattern.
 */

import type { Aria2OptionMeta } from '@/config/types';
import type { TranslateParams } from '@/i18n/types';
import { formatBytesInput } from '@/i18n/format';

/** AriaNg's `''` guard for a `required` option. */
export const OPTION_ERROR_EMPTY = 'Option value cannot be empty!';

/** Both the integer and the float syntax guard. */
export const OPTION_ERROR_NUMBER_INVALID = 'Input number is invalid!';

export const OPTION_ERROR_BELOW_MIN = 'Input number is below min value!';

export const OPTION_ERROR_ABOVE_MAX = 'Input number is above max value!';

/** `meta.pattern` (aria2 size literals, checksums, ...). */
export const OPTION_ERROR_VALUE_INVALID = 'Input value is invalid!';

/** AriaNg's integer guard: `/^-?\d+$/`. */
const INTEGER_PATTERN = /^-?\d+$/;

/** AriaNg's float guard: `/^-?(\d*\.)?\d+$/`. */
const FLOAT_PATTERN = /^-?(\d*\.)?\d+$/;

export type OptionValidationResult = { ok: true } | { ok: false; messageKey: string };

/**
 * Validates one raw editor value.
 *
 * An empty value is **always** accepted except for a `required` option — the
 * new-task page renders with `required` disabled (AriaNg's `disableRequired`),
 * where an empty row simply means "do not send this option".
 *
 * `undefined` meta (an unknown option key) validates as OK: there is nothing to
 * check against, and blocking the input would make the row unusable.
 */
export function validateOptionValue(
  meta: Aria2OptionMeta | undefined,
  raw: string,
): OptionValidationResult {
  const value = raw ?? '';

  if (!meta || meta.readonly) {
    return { ok: true };
  }

  if (meta.required && value === '') {
    return { ok: false, messageKey: OPTION_ERROR_EMPTY };
  }

  if (value === '') {
    return { ok: true };
  }

  if (meta.type === 'integer' && !INTEGER_PATTERN.test(value)) {
    return { ok: false, messageKey: OPTION_ERROR_NUMBER_INVALID };
  }

  if (meta.type === 'float' && !FLOAT_PATTERN.test(value)) {
    return { ok: false, messageKey: OPTION_ERROR_NUMBER_INVALID };
  }

  if (meta.type === 'integer' || meta.type === 'float') {
    if (meta.min !== undefined || meta.max !== undefined) {
      const number = meta.type === 'integer' ? Number.parseInt(value, 10) : Number.parseFloat(value);

      if (meta.min !== undefined && number < meta.min) {
        return { ok: false, messageKey: OPTION_ERROR_BELOW_MIN };
      }

      if (meta.max !== undefined && number > meta.max) {
        return { ok: false, messageKey: OPTION_ERROR_ABOVE_MAX };
      }
    }
  }

  if (meta.pattern !== undefined && !matchesPattern(meta.pattern, value)) {
    return { ok: false, messageKey: OPTION_ERROR_VALUE_INVALID };
  }

  return { ok: true };
}

/** A malformed `pattern` must not lock the row; the guard then passes. */
function matchesPattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

/**
 * The `{{value}}` binding of a min/max message, `undefined` otherwise.
 *
 * AriaNg interpolated the offending bound straight into the tooltip
 * (`{ value: scope.option.min }`); keeping the lookup here means
 * {@link OptionValidationResult} stays the exact `{ ok, messageKey }` shape.
 */
export function validationMessageParams(
  meta: Aria2OptionMeta | undefined,
  messageKey: string,
): TranslateParams | undefined {
  if (messageKey === OPTION_ERROR_BELOW_MIN && meta?.min !== undefined) {
    return { value: meta.min };
  }

  if (messageKey === OPTION_ERROR_ABOVE_MAX && meta?.max !== undefined) {
    return { value: meta.max };
  }

  return undefined;
}

/**
 * `getTotalCount` from `ngSetting`: the number of items a `separator`-split
 * `text` value holds.
 *
 * Zero when there is nothing to split (no value, or no separator) — which is
 * why only `header` ever renders a count.
 */
export function countItems(value: string, separator: string | undefined, trimCount: boolean): number {
  if (!value || !separator) {
    return 0;
  }

  const items = value.split(separator);
  let total = items.length;

  if (trimCount) {
    for (const item of items) {
      if (!item || item.trim() === '') {
        total -= 1;
      }
    }
  }

  return total;
}

/**
 * AriaNg's `getHumanReadableSize`, used as the input hint of every `Bytes`
 * option: `1024` reads as `1K`, `1500` and `1M` are echoed unchanged.
 *
 * AriaNg looped `sizeUnits.length` times over a four-entry array, so anything at
 * or above 1 TiB indexed past the end and rendered `1undefined`; the index is
 * clamped instead, so 1 TiB reads `1G`. Delegates to the shared formatter in
 * `@/i18n/format` so the settings page and this page can never disagree.
 */
export function humanizeBytes(value: string): string {
  return formatBytesInput(value);
}