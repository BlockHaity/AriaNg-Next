/**
 * `@/components/option-row` — the shared aria2 option editor.
 *
 * ```tsx
 * import { OptionRow } from '@/components/option-row';
 *
 * <OptionRow
 *   optionKey="dir"
 *   value={draft.dir}
 *   globalValue={globalOptions?.dir}
 *   showHistory
 *   lazySaveTimeout={0}
 *   disableRequired
 *   onChange={(value, key) => setDraft((prev) => ({ ...prev, [key]: value }))}
 * />
 * ```
 *
 * `onChange` receives the **coerced string** and the key, and may return
 * `false` (or `false` from a promise) to reject the save — the row then shows
 * its warning glyph instead of the ✓.
 */

export { OptionRow } from './OptionRow';
export type { OptionRowProps } from './OptionRow';

export { OptionInput, TEXT_OPTION_ROWS } from './OptionInput';
export type { OptionInputProps } from './OptionInput';

export { OptionHistoryDropdown, filterHistory } from './OptionHistoryDropdown';
export type { OptionHistoryDropdownProps } from './OptionHistoryDropdown';

export { OptionStatusIcon, OPTION_STATUS_META } from './OptionStatusIcon';
export type { OptionStatus, OptionStatusIconProps, OptionStatusMeta } from './OptionStatusIcon';

export {
  OPTION_ERROR_ABOVE_MAX,
  OPTION_ERROR_BELOW_MIN,
  OPTION_ERROR_EMPTY,
  OPTION_ERROR_NUMBER_INVALID,
  OPTION_ERROR_VALUE_INVALID,
  countItems,
  humanizeBytes,
  validateOptionValue,
  validationMessageParams,
} from './validation';
export type { OptionValidationResult } from './validation';