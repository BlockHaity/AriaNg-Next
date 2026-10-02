/**
 * Text field with the per-option input history dropdown — AriaNg's
 * `<input-dropdown>` (`only-show-non-empty-dropdown`, `allow-custom-input`).
 *
 * Only `dir` enables it (`showHistory` on the task option rule), because it is
 * the one option whose values are worth remembering. The filter is AriaNg's
 * `filterHistory`: a **prefix** match (`history[i].indexOf(userInput) === 0`),
 * capped at {@link HISTORY_MAX_STORE_COUNT} (the store already truncates).
 *
 * The popup is a plain list of buttons rather than `<mdui-dropdown>`: a dropdown
 * anchored to a text field has to reposition on every keystroke, which needs
 * layout measurement the shadow-DOM boundary does not give us cheaply, and it
 * would also fight the field's own overlay behaviour.
 */

import { MduiTextField } from '@/ui/mdui';
import { HISTORY_MAX_STORE_COUNT } from '@/config/types';

export interface OptionHistoryDropdownProps {
  /** The field label; also the accessible name of the list. */
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Translated validation message (mdui renders it in its error slot). */
  error?: string;
  /** Newest first, as returned by `getSettingHistory`. */
  history: readonly string[];
  /** Typed input — debounced by the owning row. */
  onChange: (value: string) => void;
  /** Picked from the list — committed immediately, like AriaNg. */
  onImmediateChange: (value: string) => void;
}

/**
 * AriaNg's `filterHistory`: `indexOf(userInput) === 0`, newest first, at most
 * {@link HISTORY_MAX_STORE_COUNT} entries. An empty input lists everything.
 */
export function filterHistory(history: readonly string[], userInput: string): string[] {
  const needle = userInput ?? '';

  return history
    .filter((entry) => (needle ? entry.indexOf(needle) === 0 : true))
    .slice(0, HISTORY_MAX_STORE_COUNT);
}

/**
 * The field plus its history list.
 *
 * The list is only rendered when at least one stored value matches, which is
 * AriaNg's `only-show-non-empty-dropdown`: an empty dropdown would cover the
 * option list with an empty popup. Typing something that matches nothing is
 * still fine — the value is simply custom input.
 */
export function OptionHistoryDropdown(props: OptionHistoryDropdownProps) {
  const { label, value, placeholder, disabled, error, history, onChange, onImmediateChange } = props;
  const matches = disabled ? [] : filterHistory(history, value);

  return (
    <div className="option-history">
      <MduiTextField
        value={value}
        label={label}
        placeholder={placeholder}
        disabled={disabled}
        error={error}
        clearable
        onInput={onChange}
      />

      {matches.length > 0 ? (
        <ul className="option-history__list" aria-label={label}>
          {matches.map((entry) => (
            <li key={entry}>
              <button
                type="button"
                className="option-history__item"
                aria-current={entry === value || undefined}
                onClick={() => onImmediateChange(entry)}
              >
                {entry}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}