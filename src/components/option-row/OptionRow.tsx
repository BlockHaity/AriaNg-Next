/**
 * One aria2 option row — AriaNg's `<ng-setting>` / `views/setting.html`.
 *
 * This is the shared editor used by **three** pages:
 *
 *   - the new-task page (`getTaskOptionKeys('new', …)`, unsaved draft options),
 *   - the aria2 settings page (`changeGlobalOption`),
 *   - the task-detail options tab (`changeOption`).
 *
 * so the contract is deliberately narrow: the caller supplies the key, the
 * current value and an `onChange`, and the row owns everything else — the
 * control per `meta.type`, client-side validation, the debounce, the
 * `pending → saving → success | failed | error` status machine and the
 * delayed error tooltip.
 *
 * The state machine and the timers are AriaNg's `scope.optionStatus` verbatim
 * (`setPending` / `setSaving` / `setSuccess` / `setFailed` / `setError`), and
 * `ERROR_TOOLTIP_DELAY` is AriaNg's `ariaNgConstants.errorTooltipDelay`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { APP_CONSTANTS } from '@/config/defaults';
import { getOptionMeta } from '@/config/aria2-options';
import type { Aria2OptionMeta } from '@/config/types';
import { useTranslate } from '@/i18n/react';
import { getSettingHistory } from '@/store/history';
import { MduiTooltip } from '@/ui/mdui';
import { OptionInput } from './OptionInput';
import { OptionStatusIcon } from './OptionStatusIcon';
import type { OptionStatus } from './OptionStatusIcon';
import { countItems, humanizeBytes, validateOptionValue, validationMessageParams } from './validation';
import './styles.css';

/** AriaNg's `errorTooltipDelay`: how long a failed save waits before it nags. */
const ERROR_TOOLTIP_DELAY = APP_CONSTANTS.errorTooltipDelay;

/** How long the ✓ stays up before the row falls back to its neutral state. */
const SUCCESS_FEEDBACK_MS = 1200;

export interface OptionRowProps {
  optionKey: string;
  /**
   * aria2's current value. `undefined` means "not set yet": the row renders empty
   * and starts reporting its own edits. Once the user has edited a row, the row
   * owns the displayed value (so a rejected save keeps what was typed) — give it
   * a `key` if you need to reset it.
   */
  value: string | undefined;
  /**
   * The value the row falls back to visually:
   *
   * - the **placeholder** of the input (AriaNg's `default-value`), and
   * - a read-only `<pre>` **above** the input for `overrideMode: 'append'` options
   *   (`fixed-value`), where only the newly typed text is submitted.
   *
   * The new-task page passes `getGlobalOption()`'s value, the settings page
   * passes `meta.defaultValue`. `Bytes` options get AriaNg's `1024 -> K -> M ->
   * G` hint treatment.
   */
  globalValue?: string;
  /** Enables the input-history dropdown (only `dir` uses it). */
  showHistory?: boolean;
  /** Disables the control and never calls `onChange`. */
  readOnly?: boolean;
  /** Debounced save delay in ms; the task-detail options tab uses 0. */
  lazySaveTimeout?: number;
  /** Called with the coerced value; return false to reject the save. */
  onChange: (value: string, key: string) => void | boolean | Promise<void | boolean>;
  label?: string;
  className?: string;
  /**
   * AriaNg's `disableRequired` (`getSpecifiedOptions(keys, { disableRequired:
   * true })`): the new-task page renders every row with the `required` guard
   * off, because an empty row there simply means "do not send this option".
   */
  disableRequired?: boolean;
  /** Fallback label when the caller does not pass one and i18n has no name. */
  fallbackLabel?: string;
}

/**
 * The `meta` a row actually validates with.
 *
 * AriaNg's directive also *skipped* every callback for a read-only option, so
 * the effective meta carries `readonly` whenever either the caller or the
 * catalogue says the key cannot be written.
 */
function resolveMeta(
  meta: Aria2OptionMeta | undefined,
  optionKey: string,
  readOnly: boolean,
  disableRequired: boolean,
): Aria2OptionMeta {
  const base: Aria2OptionMeta = meta ?? {
    key: optionKey,
    type: 'string',
    category: 'advanced',
    support: 'current',
  };

  return {
    ...base,
    key: base.key || optionKey,
    readonly: readOnly || Boolean(base.readonly),
    required: base.required && !disableRequired,
  };
}

/** The `?` affordance is only rendered when i18n actually has a description. */
function hasDescription(t: (key: string) => string, key: string): boolean {
  const translated = t(key);
  return translated !== '' && translated !== key;
}

/**
 * `media-pause-after-probe` -> `Media Pause After Probe`.
 *
 * Only used for aria2-next keys, which have no `options.<key>.name` entry yet —
 * showing `options.media-video.name` verbatim would be worse than a title-cased
 * key, and the row would have no accessible name at all.
 */
function prettifyOptionKey(optionKey: string): string {
  return optionKey
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Clears a pending timer and empties the slot, so it can be re-armed. */
function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

/** Bytes options render their size literal the way AriaNg's input hint did. */
function humanize(meta: Aria2OptionMeta, value: string): string {
  return meta.suffix === 'Bytes' ? humanizeBytes(value) : value;
}

export function OptionRow(props: OptionRowProps) {
  const {
    optionKey,
    value,
    globalValue,
    showHistory,
    readOnly,
    lazySaveTimeout = APP_CONSTANTS.lazySaveTimeout,
    onChange,
    label,
    className,
    disableRequired,
    fallbackLabel,
  } = props;
  const t = useTranslate();

  // Memoised so the row's identity is stable: `changeValue` depends on it, and
  // a fresh object every render would invalidate every downstream memo.
  const meta = useMemo(
    () => resolveMeta(getOptionMeta(optionKey), optionKey, Boolean(readOnly), Boolean(disableRequired)),
    [optionKey, readOnly, disableRequired],
  );

  /* ---- value ---------------------------------------------------------- */
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  /** What the user last typed; wins over the prop so a rejected save sticks. */
  const currentValue = dirty ? draft : (value ?? '');

  /* ---- status --------------------------------------------------------- */
  const [status, setStatus] = useState<OptionStatus>('ready');
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const statusRef = useRef<OptionStatus>('ready');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveTo = useCallback((next: OptionStatus, cause?: string) => {
    statusRef.current = next;
    setStatus(next);

    if (next === 'error') {
      setErrorMessageKey(cause ?? null);
      // `showTooltip` re-checked the status 500 ms later and gave up when the
      // row had recovered by then; clearing the timer is the same guarantee.
      clearTimer(tooltipTimerRef);
      tooltipTimerRef.current = setTimeout(() => {
        tooltipTimerRef.current = null;
        if (statusRef.current === 'error') {
          setTooltipOpen(true);
        }
      }, ERROR_TOOLTIP_DELAY);
      return;
    }

    setErrorMessageKey(null);
    clearTimer(tooltipTimerRef);
    setTooltipOpen(false);
  }, []);

  useEffect(
    () => () => {
      clearTimer(saveTimerRef);
      clearTimer(tooltipTimerRef);
      clearTimer(successTimerRef);
    },
    [],
  );

  const invokeSave = useCallback(
    async (next: string) => {
      moveTo('saving');

      let outcome: void | boolean;
      try {
        outcome = await onChange(next, optionKey);
      } catch (error) {
        console.error(`[option-row] ${optionKey} save failed`, error);
        outcome = false;
      }

      if (outcome === false) {
        // aria2 refused it: a warning glyph, no tooltip (AriaNg's `setFailed`
        // had no message of its own either).
        moveTo('failed');
        return;
      }

      moveTo('success');
      clearTimer(successTimerRef);
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        if (statusRef.current === 'success') {
          moveTo('ready');
        }
      }, SUCCESS_FEEDBACK_MS);
    },
    [moveTo, onChange, optionKey],
  );

  /**
   * The row cannot be written at all: either aria2 rejects the key in this
   * context (`readonly`), or aria2-next no longer honours it.
   */
  const locked = Boolean(meta.readonly) || Boolean(meta.support && meta.support !== 'current');

  /** `scope.changeValue`: validate, then save immediately or lazily. */
  const changeValue = useCallback(
    (next: string, lazy: boolean) => {
      clearTimer(saveTimerRef);
      setDirty(true);
      setDraft(next);
      moveTo('ready');

      if (locked) {
        return;
      }

      const validation = validateOptionValue(meta, next);
      if (!validation.ok) {
        moveTo('error', validation.messageKey);
        return;
      }

      if (!lazy) {
        void invokeSave(next);
        return;
      }

      moveTo('pending');
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void invokeSave(next);
      }, Math.max(0, lazySaveTimeout));
    },
    [invokeSave, lazySaveTimeout, locked, meta, moveTo],
  );

  /* ---- derived -------------------------------------------------------- */
  const nameKey = `options.${optionKey}.name`;
  const translatedName = t(nameKey);
  const keyLabel =
    (label ?? (hasDescription(t, nameKey) ? translatedName : '')) || fallbackLabel || prettifyOptionKey(optionKey);

  // The `?` tooltip: AriaNg's description, or — for the aria2-next keys that
  // have no translation yet — the catalogue's own note.
  const descriptionKey = `options.${optionKey}.description`;
  const description = hasDescription(t, descriptionKey) ? t(descriptionKey) : (meta.aria2NextNote ?? '');

  const placeholder = useMemo(() => {
    const source = globalValue ?? '';
    return source ? humanize(meta, source) : '';
  }, [globalValue, meta]);

  const history = useMemo(
    () => (showHistory && !locked ? getSettingHistory(optionKey) : undefined),
    [showHistory, locked, optionKey],
  );

  const totalCount = useMemo(() => {
    if (!meta.showCount || !meta.separator) {
      return 0;
    }

    const trim = Boolean(meta.trimCount);
    const own = currentValue ? countItems(currentValue, meta.separator, trim) : 0;

    if (!own) {
      // AriaNg's `placeholderItemCount`: an empty input still shows what the
      // global value holds, so the count never jumps to zero on page load.
      return countItems(placeholder, meta.separator, trim);
    }

    return own;
  }, [meta, currentValue, placeholder]);

  const errorMessage = errorMessageKey
    ? t(errorMessageKey, validationMessageParams(meta, errorMessageKey))
    : '';

  const unsupported = meta.support && meta.support !== 'current';
  // Every retired key carries an `aria2NextNote`; the tag alone is the fallback so
  // the row never invents English prose of its own.
  const warningText = unsupported ? (meta.aria2NextNote ?? '') : '';

  const rowClassName = ['option-row', className].filter(Boolean).join(' ');
  const inputDisabled = locked;

  return (
    <div className={rowClassName} data-option-key={optionKey} data-status={status}>
      <div className="option-row__key">
        <span className="option-row__label">{keyLabel}</span>
        <em className="option-row__key-name">({optionKey})</em>

        {description ? (
          <MduiTooltip content={description} placement="top" trigger="hover">
            <button type="button" className="option-row__help" aria-label={description} title={description}>
              ?
            </button>
          </MduiTooltip>
        ) : null}

        {totalCount > 0 ? (
          <span className="option-row__count">{t('format.settings.total-count', { count: totalCount })}</span>
        ) : null}

        {meta.since ? (
          <span className="option-row__since">{t('format.requires.aria2-version', { version: meta.since })}</span>
        ) : null}
      </div>

      <div className="option-row__value">
        {unsupported ? (
          <div className="option-row__warning" role="note">
            <span className="option-row__warning-tag">{meta.support}</span>
            {warningText}
          </div>
        ) : null}

        {meta.overrideMode === 'append' && globalValue ? (
          <pre className="option-row__fixed-value" aria-label={t('Default')}>
            {globalValue}
          </pre>
        ) : null}

        <div className={meta.suffix ? 'option-row__control option-row__control--grouped' : 'option-row__control'}>
          <OptionInput
            meta={meta}
            label={keyLabel}
            customLabel={t('Custom')}
            value={currentValue}
            placeholder={placeholder}
            disabled={inputDisabled}
            error={errorMessage || undefined}
            history={history}
            onChange={(next) => changeValue(next, true)}
            onImmediateChange={(next) => changeValue(next, false)}
            onCommitEmpty={() => changeValue('', true)}
          />

          {meta.suffix ? <span className="option-row__suffix">{t(meta.suffix)}</span> : null}

          <OptionStatusIcon status={status} label={errorMessage || undefined} />
        </div>

        {/* Announced immediately, while the tooltip above still waits its 500 ms. */}
        <span className="ariang-visually-hidden" role="status" aria-live="polite">
          {errorMessage}
        </span>

        {tooltipOpen && errorMessage ? (
          <div className="option-row__tooltip" role="tooltip">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}