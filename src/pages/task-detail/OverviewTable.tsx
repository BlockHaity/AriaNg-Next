/**
 * The Overview tab's settings table — AriaNg's 15 rows of
 * `#overview-items .row`, in the original order, with the original contents.
 *
 * Reference: `src/views/task-detail.html` lines 26-158 and
 * `copySelectedRowText()` in `controllers/task-detail.js:693-715`.
 *
 * ## Right-click → Copy
 *
 * AriaNg bound a context menu to every row (`#task-overview-contextmenu`,
 * `onOverviewMouseDown()`), remembered the row that was clicked in
 * `currentRowTriggeredMenu`, and copied `"<Key>: <value>"` — or just the value
 * when `includePrefixWhenCopyingFromTaskDetails` is off. The menu here is the
 * same: a real `<button role="menuitem">` positioned at the pointer, which is
 * keyboard reachable (Escape and a click outside both close it) unlike the
 * Bootstrap plugin AriaNg used.
 *
 * Each row therefore carries both a plain-text `value` (what the copy action
 * puts on the clipboard, newline-joined exactly as AriaNg joined the multiple
 * `<span>`s inside `.setting-value`) and the rendered `content`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Aria2TaskStatus } from '@/config/rpc-constants';
import type { NormalizedTask } from '@/domain/types';
import {
  formatLongDate,
  formatNumber,
  formatPercent,
  formatRemainTime,
  MORE_THAN_ONE_DAY_KEY,
  readableVolume,
} from '@/i18n/format';
import { useI18n, useTranslate } from '@/i18n/react';
import { MduiIcon, MduiTooltip, snackbarMessage } from '@/ui/mdui';
import { copyText } from '@/utils';
import type { TranslateFn } from '@/i18n/types';
import { HealthMeter } from './HealthMeter';

/** One rendered row: a key, a value, and the parts the copy action needs. */
export interface OverviewRow {
  key: string;
  /** i18n key (or an already-composed label) for the row label. */
  labelKey: string;
  /** Plain-text value copied when the prefix is disabled; also the tooltip. */
  value: string;
  /** Rendered value; defaults to `value` as plain text. */
  content?: ReactNode;
  /** Inline hint next to the key (AriaNg's `.description-inline`). */
  description?: string;
  /** Rendered after the value (the tracker expand/collapse toggle). */
  trailing?: ReactNode;
}

/** The subset of a task `formatTaskStatus` needs. */
export type TaskStatusInput = Pick<
  NormalizedTask,
  'status' | 'verifyIntegrityPending' | 'verifiedPercent' | 'seeder' | 'errorCode'
>;

/**
 * AriaNg's `taskStatus` filter, 1:1 (`src/scripts/filters/taskStatus.js`).
 *
 * `simplify` collapses `complete` / `error` / `removed` into `''`, which is what
 * the task list wants; the detail page always renders the full text.
 */
export function formatTaskStatus(task: TaskStatusInput | undefined, t: TranslateFn, simplify = false): string {
  if (!task) return '';

  switch (task.status) {
    case Aria2TaskStatus.Active:
      if (task.verifyIntegrityPending) {
        return t('Pending Verification');
      }
      // aria2 omits `verifiedLength` unless a verification is running, so an
      // absent percentage means "verification running, nothing read yet".
      if (task.verifiedPercent !== undefined) {
        return task.verifiedPercent
          ? t('format.task.verifying-percent', { verifiedPercent: task.verifiedPercent })
          : t('Verifying');
      }
      return task.seeder ? t('Seeding') : t('Downloading');

    case Aria2TaskStatus.Waiting:
      return t('Waiting');

    case Aria2TaskStatus.Paused:
      return t('Paused');

    case Aria2TaskStatus.Complete:
      return simplify ? '' : t('Completed');

    case Aria2TaskStatus.Error:
      if (simplify) return '';
      return task.errorCode ? t('format.task.error-occurred', { errorcode: task.errorCode }) : t('Error Occurred');

    case Aria2TaskStatus.Removed:
      return simplify ? '' : t('Removed');

    default:
      return '';
  }
}

export interface OverviewTableProps {
  task: NormalizedTask;
  /** Health percentage (0..100) — only meaningful for an active torrent. */
  healthPercent: number;
  /** Switch to the Files tab (the `(N Files)` link). */
  onGoToFiles: () => void;
  /** AriaNg's `includePrefixWhenCopyingFromTaskDetails`. */
  includePrefixWhenCopying: boolean;
}

export function OverviewTable({ task, healthPercent, onGoToFiles, includePrefixWhenCopying }: OverviewTableProps) {
  const t = useTranslate();
  const { longDatePattern } = useI18n();
  const [menu, setMenu] = useState<{ row: OverviewRow; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;

    const onPointerDown = (event: Event): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: Event): void => {
      if ((event as KeyboardEvent).key === 'Escape') closeMenu();
    };
    const onResize = (): void => closeMenu();

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [menu, closeMenu]);

  const onCopy = useCallback(() => {
    if (!menu) return;

    const label = t(menu.row.labelKey);
    const text = includePrefixWhenCopying ? `${label}: ${menu.row.value}` : menu.row.value;

    void copyText(text).then((copied: boolean) => {
      // No clipboard access (insecure origin + no document.execCommand): show
      // the text instead of silently doing nothing.
      if (!copied) snackbarMessage({ message: text });
    });
    closeMenu();
  }, [menu, includePrefixWhenCopying, t, closeMenu]);

  const isBittorrent = task.bittorrent !== undefined;
  const isActive = task.status === Aria2TaskStatus.Active;
  const trackers = task.trackers;
  const [trackersCollapsed, setTrackersCollapsed] = useState(true);

  const rows: OverviewRow[] = [];

  /* 1 — Task Name (tooltip: the torrent comment, else the name). */
  rows.push({
    key: 'taskName',
    labelKey: 'Task Name',
    value: task.taskName,
    content: <span className="ariang-word-break">{task.taskName}</span>,
  });

  /* 2 — Task Size + the `(N Files)` link. */
  const fileCountText = t('format.settings.file-count', { count: task.selectedFileCount });
  rows.push({
    key: 'totalLength',
    labelKey: 'Task Size',
    value: `${readableVolume(task.totalLength)} ${fileCountText}`,
    content: (
      <>
        <span>{readableVolume(task.totalLength)}</span>
        <button type="button" className="ariang-inline-link" onClick={onGoToFiles}>
          {fileCountText}
        </button>
      </>
    ),
  });

  /* 3 — Task Status (+ the errorMessage tooltip icon). */
  const statusText = formatTaskStatus(task, t);
  const showErrorHint = !!task.errorCode && task.errorCode !== '0' && !!task.errorMessage;
  rows.push({
    key: 'status',
    labelKey: 'Task Status',
    value: statusText,
    content: (
      <>
        <span>{statusText}</span>
        {showErrorHint ? (
          <MduiTooltip content={task.errorMessage ?? ''} placement="top">
            <span style={{ color: 'rgb(var(--mdui-color-primary))', display: 'inline-flex' }}>
              <MduiIcon name="info" size="1.25rem" />
            </span>
          </MduiTooltip>
        ) : null}
      </>
    ),
  });

  /* 4 — Error Description (errors only). */
  if (task.status === Aria2TaskStatus.Error && task.errorDescription) {
    rows.push({
      key: 'errorDescription',
      labelKey: 'Error Description',
      value: t(task.errorDescription),
    });
  }

  /* 5 — Progress; the label grows "(Health Percentage)" for an active torrent. */
  const showHealth = isActive && isBittorrent;
  rows.push({
    key: 'progress',
    labelKey: 'Progress',
    value: `${formatPercent(task.completePercent, 2)}%${showHealth ? ` (${formatPercent(healthPercent, 2)}%)` : ''}`,
    description: showHealth ? `(${t('Health Percentage')})` : undefined,
    content: (
      <>
        <span>{formatPercent(task.completePercent, 2)}%</span>
        {showHealth ? (
          <HealthMeter
            percent={healthPercent}
            label={t('Health Percentage')}
            valueText={`${formatPercent(healthPercent, 2)}%`}
            className="ariang-ellipsis"
            style={{ maxWidth: 220 }}
          />
        ) : null}
      </>
    ),
  });

  /* 6 — Download. */
  rows.push({
    key: 'completedLength',
    labelKey: 'Download',
    value: `${readableVolume(task.completedLength)}${isActive ? ` @ ${readableVolume(task.downloadSpeed)}/s` : ''}`,
  });

  /* 7 — Upload (torrents only). */
  if (isBittorrent) {
    rows.push({
      key: 'uploadLength',
      labelKey: 'Upload',
      value: `${readableVolume(task.uploadLength)}${isActive ? ` @ ${readableVolume(task.uploadSpeed)}/s` : ''}`,
    });
  }

  /* 8 — Share Ratio (torrents only, two decimals). */
  if (isBittorrent) {
    rows.push({ key: 'shareRatio', labelKey: 'Share Ratio', value: formatNumber(task.shareRatio, 2) });
  }

  /* 9 — Remaining, only while there is something left to fetch. */
  if (isActive && task.completedLength < task.totalLength) {
    const remain = formatRemainTime(task.remainTime);
    rows.push({
      key: 'remaining',
      labelKey: 'Remaining',
      value: remain === '' ? '—' : remain === MORE_THAN_ONE_DAY_KEY ? t(MORE_THAN_ONE_DAY_KEY) : remain,
    });
  }

  /* 10 — Seeders / Connections (active only). */
  if (isActive) {
    rows.push({
      key: 'connections',
      labelKey: isBittorrent ? `${t('Seeders')} / ${t('Connections')}` : t('Connections'),
      value: `${task.numSeeders ? `${task.numSeeders} / ` : ''}${task.connections}`,
    });
  }

  /* 11 — Seed Creation Time. */
  if (isBittorrent && task.bittorrent?.creationDate) {
    rows.push({
      key: 'creationDate',
      labelKey: 'Seed Creation Time',
      value: formatLongDate(task.bittorrent.creationDate, longDatePattern),
    });
  }

  /* 12 — Info Hash (plus the aria2-next v1 / v2 pair when advertised). */
  if (task.infoHash) {
    const hashLines = [
      task.infoHash,
      task.bittorrent?.infoHashV1 ? `v1: ${task.bittorrent.infoHashV1}` : '',
      task.bittorrent?.infoHashV2 ? `v2: ${task.bittorrent.infoHashV2}` : '',
    ].filter((line) => line !== '');

    rows.push({
      key: 'infoHash',
      labelKey: 'Info Hash',
      // AriaNg joined multiple spans inside `.setting-value` with a newline.
      value: hashLines.join('\n'),
      content: (
        <span className="ariang-word-break ariang-mono">
          {hashLines.map((line) => (
            <span key={line} style={{ display: 'block' }}>
              {line}
            </span>
          ))}
        </span>
      ),
    });
  }

  /* 13 — Download Url. */
  if (task.singleUrl) {
    rows.push({
      key: 'singleUrl',
      labelKey: 'Download Url',
      value: task.singleUrl,
      content: <span className="ariang-word-break">{task.singleUrl}</span>,
    });
  }

  /* 14 — Download Dir. */
  rows.push({
    key: 'dir',
    labelKey: 'Download Dir',
    value: task.dir,
    content: <span className="ariang-word-break">{task.dir}</span>,
  });

  /* 15 — BT Tracker Servers: total count, expand/collapse, full list tooltip. */
  if (trackers.length > 0) {
    const joined = trackers.map((tracker) => tracker.url).join(',');
    const visible = trackersCollapsed ? trackers.slice(0, 1) : trackers;

    rows.push({
      key: 'trackers',
      labelKey: 'BT Tracker Servers',
      value: joined,
      description: t('format.settings.total-count', { count: trackers.length }),
      content: (
        <span className="ariang-ellipsis" title={joined}>
          {visible.map((tracker) => tracker.url).join(',')}
        </span>
      ),
      trailing:
        trackers.length > 1 ? (
          <button
            type="button"
            className="ariang-inline-link"
            aria-expanded={!trackersCollapsed}
            aria-label={trackersCollapsed ? t('Expand') : t('Collapse')}
            title={trackersCollapsed ? t('Expand') : t('Collapse')}
            onClick={() => setTrackersCollapsed((current) => !current)}
          >
            <MduiIcon name={trackersCollapsed ? 'expand-more' : 'expand-less'} size="1.25rem" />
          </button>
        ) : null,
    });
  }

  return (
    <>
      <div className="ariang-settings-table" role="table" aria-label={t('Overview')}>
        <div role="rowgroup">
          {rows.map((row) => {
            const label = t(row.labelKey);
            const value = row.content ?? <span className="ariang-word-break">{row.value}</span>;
            // AriaNg put a tooltip on the task name and on the tracker list.
            const tooltip = row.key === 'taskName' ? (task.bittorrent?.comment ?? task.taskName) : undefined;
            const shown = tooltip ? <MduiTooltip content={tooltip}>{value}</MduiTooltip> : value;

            return (
              <div
                key={row.key}
                className="ariang-settings-row"
                role="row"
                data-row-key={row.key}
                onContextMenu={(event) => {
                  // AriaNg's `before` handler: remember the row, show the menu.
                  event.preventDefault();
                  setMenu({ row, x: event.clientX, y: event.clientY });
                }}
              >
                <div className="ariang-setting-key" role="columnheader">
                  <span>{label}</span>
                  {row.description ? <em className="ariang-setting-key-description">{row.description}</em> : null}
                </div>
                <div className="ariang-setting-value" role="cell">
                  {shown}
                  {row.trailing}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {menu ? (
        <div ref={menuRef} className="ariang-context-menu" role="menu" style={{ left: `${menu.x}px`, top: `${menu.y}px` }}>
          <button type="button" role="menuitem" className="ariang-context-menu-item" onClick={onCopy}>
            <MduiIcon name="content-copy" size="1.125rem" />
            <span>{t('Copy')}</span>
          </button>
        </div>
      ) : null}
    </>
  );
}

export default OverviewTable;