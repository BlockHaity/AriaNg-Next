/**
 * The control half of an option row: one editor per `Aria2OptionMeta.type`.
 *
 * Ported from `views/setting.html`, where each `ng-if` picked a different
 * element:
 *
 * | meta type          | control                                             |
 * | ------------------ | --------------------------------------------------- |
 * | `string`           | `<mdui-text-field>` (+ history dropdown)            |
 * | `text`             | `<mdui-text-field rows>` (a real `<textarea>`)      |
 * | `integer`/`float`  | `<mdui-text-field>` with regex + min/max validation |
 * | `boolean`/`option` | `<mdui-select>`                                     |
 * | `string-or-option` | `<mdui-select>` **plus** a free-text field           |
 * | `readonly`         | a disabled field                                    |
 *
 * `string-or-option` is the aria2-next addition: `--media-video` and friends
 * accept `best` / `none` **and** a language code or an opaque track id that
 * only exists at runtime, so a plain select could not express them.
 */

import type { KeyboardEvent, ReactNode } from 'react';

import { useTranslate } from '@/i18n/react';
import { optionValueLabel } from '@/config/aria2-options';
import type { Aria2OptionMeta } from '@/config/types';
import { MduiSelect, MduiTextField, MduiTextarea } from '@/ui/mdui';
import type { MduiSelectItem } from '@/ui/mdui';
import { OptionHistoryDropdown } from './OptionHistoryDropdown';

/** `text` options render six rows, like AriaNg's `<textarea rows="6">`. */
export const TEXT_OPTION_ROWS = 6;

export interface OptionInputProps {
  meta: Aria2OptionMeta;
  /** Translated `options.<key>.name`; every control needs a label. */
  label: string;
  /** Label of the extra free-text field of a `string-or-option` row. */
  customLabel: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Translated validation message; rendered in mdui's error slot. */
  error?: string;
  /** Present when the row opted into the input history (`dir`). */
  history?: readonly string[];
  /** Typed / pasted — debounced by the owning row. */
  onChange: (value: string) => void;
  /** Dropdown selection — committed immediately, like AriaNg. */
  onImmediateChange: (value: string) => void;
  /** Backspace/Delete in an already-empty box (AriaNg's `deleteKeyAlwaysChangeValue`). */
  onCommitEmpty: () => void;
}

/** Is this keystroke the "the box is already empty, commit `''`" gesture? */
function isDeleteKey(event: KeyboardEvent): boolean {
  return event.key === 'Backspace' || event.key === 'Delete';
}

export function OptionInput(props: OptionInputProps) {
  const {
    meta,
    label,
    customLabel,
    value,
    placeholder,
    disabled,
    error,
    history,
    onChange,
    onImmediateChange,
    onCommitEmpty,
  } = props;
  const t = useTranslate();

  /**
   * `option` / `string-or-option` items, labelled through the `option.` namespace.
   *
   * AriaNg passed `option.<value>` straight to `translate`, so an untranslated
   * value rendered as the bare key (`option.best`). The raw value is used
   * instead — it is what aria2 expects anyway, and `best` / `none` /
   * `mp4` read better than a namespace that only exists for the few documented
   * enumerations.
   */
  const items: MduiSelectItem[] = (meta.options ?? []).map((entry) => {
    const key = optionValueLabel(meta.key, entry);
    const translated = t(key);
    return { value: entry, label: translated === key ? entry : translated };
  });

  // AriaNg injected `['true', 'false']` for every boolean row.
  const booleanItems: MduiSelectItem[] = [
    { value: 'true', label: t('option.true') },
    { value: 'false', label: t('option.false') },
  ];

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isDeleteKey(event) || value !== '') {
      return;
    }

    // A delete on a non-empty box is already covered by the `input` event; only
    // the second one (box empty again) needs an explicit commit.
    event.preventDefault();
    onCommitEmpty();
  };

  let control: ReactNode;

  switch (meta.type) {
    case 'text':
      control = (
        <MduiTextarea
          value={value}
          label={label}
          rows={TEXT_OPTION_ROWS}
          placeholder={placeholder}
          disabled={disabled}
          error={error}
          onInput={onChange}
        />
      );
      break;

    case 'integer':
    case 'float':
      control = (
        <MduiTextField
          value={value}
          label={label}
          placeholder={placeholder}
          disabled={disabled}
          error={error}
          onInput={onChange}
        />
      );
      break;

    case 'boolean':
      control = (
        <MduiSelect
          value={value}
          items={booleanItems}
          label={label}
          placeholder={placeholder}
          disabled={disabled}
          onChange={onImmediateChange}
        />
      );
      break;

    case 'option':
      control = (
        <MduiSelect
          value={value}
          items={items}
          label={label}
          placeholder={placeholder}
          disabled={disabled}
          onChange={onImmediateChange}
        />
      );
      break;

    case 'string-or-option':
      control = (
        <div className="option-input__pair">
          <MduiSelect
            // A value that is not one of the known options (a language code, a
            // track id) leaves the select empty; the free-text field shows it.
            value={items.some((item) => item.value === value) ? value : ''}
            items={items}
            label={label}
            placeholder={placeholder}
            disabled={disabled}
            onChange={onImmediateChange}
          />
          <MduiTextField
            value={value}
            label={customLabel}
            placeholder={t('Custom')}
            disabled={disabled}
            error={error}
            onInput={onChange}
          />
        </div>
      );
      break;

    case 'readonly':
      // The disabled state says it all; AriaNg added no helper text either.
      control = <MduiTextField value={value} label={label} placeholder={placeholder} disabled />;
      break;

    case 'string':
    default:
      control = history ? (
        <OptionHistoryDropdown
          label={label}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          error={error}
          history={history}
          onChange={onChange}
          onImmediateChange={onImmediateChange}
        />
      ) : (
        <MduiTextField
          value={value}
          label={label}
          placeholder={placeholder}
          disabled={disabled}
          error={error}
          onInput={onChange}
        />
      );
      break;
  }

  // The keydown listener lives on a wrapper because mdui owns the inner input
  // inside its shadow root; `keydown` is composed, so it still bubbles here.
  return (
    <div className="option-input" onKeyDown={handleKeyDown}>
      {control}
    </div>
  );
}