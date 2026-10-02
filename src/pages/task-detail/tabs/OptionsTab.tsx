/**
 * Options tab — the per-task aria2 option editor.
 *
 * Port of `views/task-detail.html` lines 367-373 (`<ng-setting ng-repeat="option
 * in context.availableOptions">`) and of the controller's
 * `getAvailableOptions` / `loadTaskOption` / `setOption`
 * (`task-detail.js:48-54, 675-691`).
 *
 * AriaNg resolved the row list with
 * `aria2SettingService.getAvailableTaskOptionKeys(status, isBittorrent)`,
 * which applies `canShow` / `canUpdate` per status and hides `http` rows for
 * torrents and `bittorrent` rows for everything else. `getTaskOptionKeys` is the
 * same table, so the row list is derived from it — with `status` mapped onto
 * AriaNg's context vocabulary (`new` / `active` / `waiting` / `paused`).
 *
 * AriaNg loaded the values **lazily**, on the first switch to this tab
 * (`changeTab('settings') -> loadTaskOption`), which matters: `getOption` for one
 * gid is a full option bag and most sessions never open the tab.
 *
 * `changeOption` is only accepted when aria2 answers exactly `OK`, which
 * {@link changeTaskOption} already enforces.
 *
 * aria2-next addition: a magnet that reported
 * `bittorrent.fileSelectionState === 'awaiting'` must not be unpaused before a
 * `select-file` has been submitted, and `select-file` is written through
 * `changeOption`, not through `aria2.selectFile`. The warning row says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getOptionMeta, humanizeByteValue, optionValueLabel } from '@/config/aria2-options';
import type { OptionMeta } from '@/config/aria2-options';
import { FileSelectionState } from '@/config/rpc-constants';
import { getTaskOptionKeys } from '@/config/option-groups';
import type { TaskOptionContext } from '@/config/types';
import { changeTaskOption } from '@/store/commands';
import { getAria2ClientOrNull } from '@/rpc';
import { formatBytesInput } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import type { TranslateFn } from '@/i18n/types';
import { MduiIcon, MduiSelect, MduiSwitch, MduiTextField, MduiTooltip } from '@/ui/mdui';

/** Debounce before a per-task option change is submitted. */
export const OPTION_SAVE_DEBOUNCE_MS = 600;

/** Maps an aria2 task status onto AriaNg's per-task option context. */
export function taskOptionContext(status: string): TaskOptionContext {
  switch (status) {
    case 'active':
    case 'waiting':
    case 'paused':
      return status;
    default:
      // The tab is only reachable for the three states above; a terminal task
      // therefore never resolves to a context that would enable a write.
      return 'new';
  }
}

/** `aria2-options` key -> i18n key, with a readable fallback for media keys. */
export function optionLabel(t: TranslateFn, key: string): string {
  const translated = t(`options.${key}.name`);
  if (translated !== `options.${key}.name`) return translated;

  return key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function optionDescription(t: TranslateFn, key: string): string {
  const translated = t(`options.${key}.description`);
  return translated === `options.${key}.description` ? '' : translated;
}

/** Per-row save state, mirroring AriaNg's `optionStatus.setSuccess/setFailed`. */
type RowState = 'idle' | 'saving' | 'saved' | 'error';

export interface OptionsTabProps {
  gid: string;
  status: string;
  isBittorrent: boolean;
  /** aria2-next `bittorrent.fileSelectionState`. */
  fileSelectionState?: FileSelectionState;
  /** Forces a re-read of the option bag (the page sets it after a status change). */
  reloadToken?: number;
  /** Skip the lazy first load — used by the page once the tab is active. */
  active?: boolean;
}

export function OptionsTab({ gid, status, isBittorrent, fileSelectionState, reloadToken, active = true }: OptionsTabProps) {
  const t = useTranslate();

  const context = taskOptionContext(status);
  const rules = useMemo(() => getTaskOptionKeys(context, isBittorrent), [context, isBittorrent]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [globalValues, setGlobalValues] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const loadedFor = useRef<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /* ---------------------------------------------------------------- */
  /* lazy load                                                         */
  /* ---------------------------------------------------------------- */

  const load = useCallback(async () => {
    const client = getAria2ClientOrNull();
    if (!client) return;

    const [taskOptions, globals] = await Promise.all([
      client.getOption(gid),
      client.getGlobalOption(),
    ]);

    if (taskOptions.success) {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(taskOptions.data ?? {})) {
        next[key] = typeof value === 'string' ? value : String(value);
      }
      setValues(next);
      setDrafts(next);
    }

    if (globals.success) {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(globals.data ?? {})) {
        next[key] = typeof value === 'string' ? value : String(value);
      }
      setGlobalValues(next);
    }
  }, [gid]);

  useEffect(() => {
    if (!active) return;
    if (loadedFor.current === gid) return;

    loadedFor.current = gid;
    void load();
  }, [active, gid, load]);

  useEffect(() => {
    if (!active) return;
    // `load` is async: it awaits `getOption` / `getGlobalOption` before touching
    // any state, so this is an external-system read rather than a cascading
    // render. The rule cannot see the `await`, hence the explicit suppression.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // `reloadToken` is the explicit "re-read now" signal from the page.
  }, [active, reloadToken, load]);

  useEffect(
    () => () => {
      for (const timer of Object.values(timers.current)) clearTimeout(timer);
      timers.current = {};
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* validation                                                        */
  /* ---------------------------------------------------------------- */

  const validate = useCallback((meta: OptionMeta, raw: string): string => {
    const value = raw.trim();
    if (value === '') return '';

    if (meta.type === 'integer' || meta.type === 'float') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return t('Please input a valid number');
      if (meta.min !== undefined && parsed < meta.min) return `${t('Value')} >= ${meta.min}`;
      if (meta.max !== undefined && parsed > meta.max) return `${t('Value')} <= ${meta.max}`;
    }

    if (meta.pattern !== undefined && !new RegExp(meta.pattern).test(value)) {
      return t('The format is invalid');
    }

    if (meta.type === 'option' && meta.options && !meta.options.includes(value)) {
      return t('Please select a value from the list');
    }

    return '';
  }, [t]);

  /**
   * The exact string handed to `aria2.changeOption`.
   *
   * A `submitFormat: 'array'` row (`header`) is edited as one textarea but is
   * semantically a list: trimming the items and dropping blank lines here means
   * what gets submitted is exactly what `getOption` will hand back, instead of
   * whatever whitespace the user happened to type.
   */
  const normalizeSubmitValue = useCallback((meta: OptionMeta, raw: string): string => {
    if (meta.submitFormat !== 'array') {
      return raw.trim();
    }

    const separator = meta.separator ?? ',';
    return raw
      .split(separator)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .join(separator);
  }, []);

  /* ---------------------------------------------------------------- */
  /* saving                                                            */
  /* ---------------------------------------------------------------- */

  const submit = useCallback(
    async (key: string, value: string) => {
      setRowStates((current) => ({ ...current, [key]: 'saving' }));
      setRowErrors((current) => ({ ...current, [key]: '' }));

      const ok = await changeTaskOption(gid, key, value);

      if (ok) {
        // Only a confirmed `OK` updates the displayed value (AriaNg's rule).
        setValues((current) => ({ ...current, [key]: value }));
        setRowStates((current) => ({ ...current, [key]: 'saved' }));
        return;
      }

      setRowStates((current) => ({ ...current, [key]: 'error' }));
      setRowErrors((current) => ({ ...current, [key]: t('Failed to save the option') }));
      // Revert to what aria2 still holds.
      setDrafts((current) => ({ ...current, [key]: values[key] ?? '' }));
    },
    [gid, t, values],
  );

  /**
   * Debounced save. AriaNg submitted through `optionStatus` on every change;
   * the debounce keeps the 1 s poll from racing a half-typed value, and an
   * invalid value is **not** submitted at all.
   */
  const schedule = useCallback(
    (meta: OptionMeta, value: string) => {
      const key = meta.key;
      setDrafts((current) => ({ ...current, [key]: value }));

      const error = validate(meta, value);
      setRowErrors((current) => ({ ...current, [key]: error }));

      const pending = timers.current[key];
      if (pending !== undefined) clearTimeout(timers.current[key]);

      if (error !== '') {
        delete timers.current[key];
        return;
      }

      timers.current[key] = setTimeout(() => {
        delete timers.current[key];
        void submit(key, normalizeSubmitValue(meta, value));
      }, OPTION_SAVE_DEBOUNCE_MS);
    },
    [submit, validate, normalizeSubmitValue],
  );

  const submitNow = useCallback(
    (meta: OptionMeta, value: string) => {
      const key = meta.key;

      const error = validate(meta, value);
      setRowErrors((current) => ({ ...current, [key]: error }));
      if (error !== '') return;

      const pending = timers.current[key];
      if (pending !== undefined) {
        clearTimeout(timers.current[key]);
        delete timers.current[key];
      }
      void submit(key, normalizeSubmitValue(meta, value));
    },
    [submit, validate, normalizeSubmitValue],
  );

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */
  /* ---------------------------------------------------------------- */

  const awaitingFileSelection =
    isBittorrent && fileSelectionState === FileSelectionState.Awaiting;

  const renderControl = (meta: OptionMeta, readonly: boolean) => {
    const key = meta.key;
    const value = drafts[key] ?? '';
    const disabled = readonly;

    if (meta.type === 'boolean') {
      return (
        <MduiSwitch
          checked={value === 'true'}
          disabled={disabled}
          label={optionLabel(t, key)}
          onChange={(next) => submitNow(meta, next ? 'true' : 'false')}
        />
      );
    }

    if (meta.type === 'option' || meta.type === 'string-or-option') {
      const options = meta.options ?? [];
      const items = [
        ...options.map((option) => ({ value: option, label: t(optionValueLabel(key, option)) })),
        // A `string-or-option` row accepts an opaque runtime value (a media track
        // id), which must never be dropped from the list while it is selected.
        ...(value && !options.includes(value) ? [{ value, label: value }] : []),
      ];

      return (
        <MduiSelect
          value={value}
          items={items}
          label={optionLabel(t, key)}
          disabled={disabled}
          onChange={(next) => submitNow(meta, next)}
        />
      );
    }

    if (meta.type === 'text') {
      return (
        <MduiTextField
          value={value}
          label={optionLabel(t, key)}
          rows={4}
          disabled={disabled}
          error={rowErrors[key] || undefined}
          helperText={meta.showCount ? `${countItems(meta, value)}` : undefined}
          onInput={(next) => schedule(meta, next)}
        />
      );
    }

    return (
      <MduiTextField
        value={value}
        label={optionLabel(t, key)}
        type={meta.type === 'integer' || meta.type === 'float' ? 'number' : 'text'}
        disabled={disabled}
        error={rowErrors[key] || undefined}
        helperText={meta.suffix === 'Bytes' ? humanizeByteValue(formatBytesInput(value.trim())) : undefined}
        onInput={(next) => schedule(meta, next)}
        onEnter={(next) => submitNow(meta, next)}
      />
    );
  };

  return (
    <div className="ariang-task-detail">
      {awaitingFileSelection ? (
        <div className="ariang-warning-row" role="alert">
          <MduiIcon name="warning" size="1.25rem" />
          <span>
            {t(
              'This torrent is waiting for a file selection. Submit select-file before unpausing; it is changed through changeOption, not aria2.selectFile.',
            )}
          </span>
        </div>
      ) : null}

      <div className="ariang-settings-table" role="table" aria-label={t('Options')}>
        <div role="rowgroup">
          {rules.map((rule) => {
            const meta = getOptionMeta(rule.key);
            if (!meta) return null;

            const readonly = rule.readonly || meta.readonly === true || meta.type === 'readonly';
            const value = drafts[rule.key] ?? '';
            const rowState = rowStates[rule.key] ?? 'idle';
            const description = optionDescription(t, rule.key);
            const note =
              meta.suffix === 'Bytes' ? humanizeByteValue(formatBytesInput(value.trim())) : description;

            return (
              <div key={rule.key} className="ariang-option-row" role="row" data-option-key={rule.key}>
                <div className="ariang-option-key" role="columnheader">
                  <span>{optionLabel(t, rule.key)}</span>
                  {meta.overrideMode === 'append' && globalValues[rule.key] !== undefined ? (
                    <div className="ariang-option-global-value">
                      {`${t('Global')}: ${formatGlobalValue(meta, globalValues[rule.key] as string)}`}
                    </div>
                  ) : null}
                  {note ? <div className="ariang-option-global-value">{note}</div> : null}
                </div>

                <div className="ariang-option-control" role="cell">
                  {renderControl(meta, readonly)}

                  {readonly ? <span className="ariang-option-status">{t('Readonly')}</span> : null}

                  {rowState === 'saving' ? <span className="ariang-option-status">…</span> : null}
                  {rowState === 'saved' ? (
                    <MduiTooltip content={t('Saved')}>
                      <MduiIcon name="check" size="1rem" className="ariang-option-status" />
                    </MduiTooltip>
                  ) : null}
                  {rowState === 'error' ? (
                    <span className="ariang-option-status" data-tone="error">
                      {rowErrors[rule.key] || t('Failed')}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** `text` rows show their item count (AriaNg's `showCount` / `trimCount`). */
function countItems(meta: OptionMeta, value: string): string {
  const separator = meta.separator ?? ',';
  const items = value
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return `(${items.length})`;
}

/** The read-only global value shown above an `overrideMode: 'append'` row. */
function formatGlobalValue(meta: OptionMeta, value: string): string {
  if (meta.submitFormat === 'array') {
    const separator = meta.separator ?? ',';
    return value.split(separator).join(` ${separator} `).trim();
  }
  return value;
}

export default OptionsTab;