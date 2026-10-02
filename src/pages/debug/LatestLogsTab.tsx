/**
 * "Latest Logs" — the first tab of `/debug`.
 *
 * A 1:1 port of the `logs` tab-pane in `views/debug.html` plus
 * `AriaNgDebugController`:
 *
 * - the title row carries a sortable **Logging Time** header (toggling between
 *   `time:asc` and `time:desc`, default `time:desc`) and the toolbar;
 * - the toolbar has the minimum-level **Log Level** dropdown, the **Auto
 *   Refresh** dropdown (`Disabled` + AriaNg's five intervals + a divider +
 *   **Refresh Now**) and **Clear Logs** behind a confirmation;
 * - every row is `#id`, the long date, the level pill, the message and a
 *   **Show Detail** link when the entry carries an attachment;
 * - the level filter is a **minimum**: `filterLogsByLevel` keeps `level >=
 *   minimum`, which is AriaNg's `compareLogLevel(...) >= 0`.
 *
 * The logs themselves live in a module-level ring buffer, not in a store, so
 * the page polls it on an interval exactly as AriaNg's `$interval` did —
 * changing the interval restarts the timer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatLongDate, formatTimeOption, useI18n, useTranslate } from '@/i18n';
import { clearDebugLogs, filterLogsByLevel, getDebugLogs } from '@/store/logs';
import type { LogEntry, LogLevel } from '@/store/logs';
import { confirmDialog } from '@/ui/mdui';
import { MduiButton, MduiSelect } from '@/ui/mdui';
import type { MduiSelectItem } from '@/ui/mdui';

import {
  AUTO_REFRESH_OPTIONS,
  DEFAULT_AUTO_REFRESH_INTERVAL,
  DEFAULT_LOG_LEVEL_FILTER,
  LOG_LEVEL_OPTIONS,
} from './rpc-form';
import { LevelPill, LogDetailDialog } from './LogDetailDialog';
import './debug.css';

/** AriaNg's `logListDisplayOrder`; session-only, never persisted. */
export type LogOrder = 'time:asc' | 'time:desc';

const DEFAULT_LOG_ORDER: LogOrder = 'time:desc';

/** AriaNg read the buffer with `.slice()` — never mutate it in place. */
function reload(): LogEntry[] {
  return getDebugLogs();
}

/**
 * Sort by the entry timestamp.
 *
 * `Array#sort` is stable, so entries sharing a timestamp keep their insertion
 * order; reversing the ascending result for `time:desc` therefore also flips
 * those ties, which is what a reader expects from "newest first" (and what
 * AriaNg's `time:desc` list showed for the burst of lines a failed task emits).
 */
function sortLogs(entries: readonly LogEntry[], order: LogOrder): LogEntry[] {
  const ascending = [...entries].sort((a, b) => a.time - b.time);
  return order === 'time:asc' ? ascending : ascending.reverse();
}

export function LatestLogsTab({ title }: { title: string }) {
  const t = useTranslate();
  const { longDatePattern } = useI18n();

  const [logs, setLogs] = useState<LogEntry[]>(() => reload());
  const [order, setOrder] = useState<LogOrder>(DEFAULT_LOG_ORDER);
  const [level, setLevel] = useState<LogLevel>(DEFAULT_LOG_LEVEL_FILTER);
  const [refreshInterval, setRefreshInterval] = useState<number>(DEFAULT_AUTO_REFRESH_INTERVAL);
  const [detail, setDetail] = useState<LogEntry | null>(null);

  // --- auto refresh ------------------------------------------------------

  // AriaNg's `setAutoRefreshInterval`: reload once, then start (or cancel) the
  // interval. The timer itself is a pure side effect of the rate, so changing
  // the rate restarts it (the effect re-runs) and the eager reload lives in the
  // change handler, not in here.
  useEffect(() => {
    if (refreshInterval <= 0) return undefined;
    const handle = window.setInterval(() => setLogs(reload()), refreshInterval);
    return () => window.clearInterval(handle);
  }, [refreshInterval]);

  const onRefreshIntervalChange = useCallback((next: number) => {
    setRefreshInterval(next);
    if (next > 0) {
      setLogs(reload());
    }
  }, []);

  /* --- clear ------------------------------------------------------------- */

  const onClearLogs = useCallback(async () => {
    const confirmed = await confirmDialog({
      heading: t('Confirm Clear'),
      text: t('Are you sure you want to clear debug logs?'),
      okText: t('OK'),
      cancelText: t('Cancel'),
      icon: 'warning',
      danger: true,
    });
    if (!confirmed) return;
    clearDebugLogs();
    setLogs(reload());
  }, [t]);

  /* --- derived rows ------------------------------------------------------ */

  const rows = useMemo(() => sortLogs(filterLogsByLevel(logs, level), order), [level, logs, order]);

  /* --- toolbar model ----------------------------------------------------- */

  const levelItems = useMemo<MduiSelectItem[]>(
    () =>
      LOG_LEVEL_OPTIONS.map((option) => ({
        value: String(option.value),
        label: t(option.labelKey),
        // AriaNg's `fa-check` on the active entry, expressed as mdui's own
        // leading-icon slot so the selection is visible, not just implied.
        icon: option.value === level ? 'check' : undefined,
      })),
    [level, t],
  );

  const refreshItems = useMemo<MduiSelectItem[]>(
    () =>
      AUTO_REFRESH_OPTIONS.map((option) => ({
        value: String(option.value),
        // `formatTimeOption` is AriaNg's `timeDisplayName` filter, `Disabled`
        // included (it is the `defaultName` of a zero interval).
        label: formatTimeOption(option.value, t('Disabled'), t),
        icon: option.value === refreshInterval ? 'check' : undefined,
      })),
    [refreshInterval, t],
  );

  return (
    <>
      <div className="ariang-logs-title">
        <button
          type="button"
          className="ariang-logs-sort"
          data-order={order}
          aria-label={`${t('Logging Time')} (${order})`}
          onClick={() => setOrder((current) => (current === 'time:asc' ? 'time:desc' : 'time:asc'))}
        >
          {t('Logging Time')}
          <span className="ariang-logs-sort-order" aria-hidden="true" />
        </button>

        <div className="ariang-logs-toolbar">
          <MduiSelect
            className="ariang-log-level-select"
            value={String(level)}
            items={levelItems}
            label={t('Log Level')}
            variant="outlined"
            onChange={(next) => setLevel(Number(next) as LogLevel)}
          />

          <MduiSelect
            className="ariang-auto-refresh-select"
            value={String(refreshInterval)}
            items={refreshItems}
            label={t('Auto Refresh')}
            variant="outlined"
            onChange={(next) => onRefreshIntervalChange(Number(next))}
          />

          {/* AriaNg's `dropdown-divider`, before "Refresh Now". */}
          <span className="ariang-logs-divider" aria-hidden="true" />

          <MduiButton variant="text" icon="refresh" onClick={() => setLogs(reload())}>
            {t('Refresh Now')}
          </MduiButton>

          <MduiButton variant="text" icon="delete" onClick={() => void onClearLogs()}>
            {t('Clear Logs')}
          </MduiButton>
        </div>
      </div>

      {/*
        A live region: the list is replaced wholesale on every poll, and a screen
        reader should be told about new lines without stealing focus.
      */}
      <div
        className="ariang-logs-list ariang-scroll-area"
        role="log"
        aria-live="polite"
        aria-label={title}
      >
        {rows.length === 0 ? null : (
          rows.map((entry) => (
            <div className="ariang-log-row" key={entry.id}>
              <span className="ariang-log-id">{`#${entry.id}`}</span>
              <span className="ariang-log-time">{formatLongDate(entry.time / 1000, longDatePattern)}</span>
              <LevelPill level={entry.level} />
              <span className="ariang-log-content">{entry.content}</span>
              {entry.attachment === undefined ? null : (
                <button
                  type="button"
                  className="ariang-log-detail-link"
                  onClick={() => setDetail(entry)}
                >
                  {t('Show Detail')}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <LogDetailDialog log={detail} onClose={() => setDetail(null)} />
    </>
  );
}