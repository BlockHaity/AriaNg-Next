/**
 * One task row — a 1:1 port of the `div.row` in AriaNg's `views/list.html`.
 *
 * The three Bootstrap column groups survive as three `.task-cell` elements; the
 * grid that lays them out lives in `styles.css` (no `.col-*` classes here).
 *
 * Interaction contract, unchanged from AriaNg:
 * - clicking anywhere on the row toggles selection (the checkbox itself is
 *   `.disable-clickable`, i.e. `pointer-events: none`, so there is exactly one
 *   toggle per click — see `main.js`'s row `ng-click`);
 * - the checkbox is *visible* only on hover or while selected (`.checkbox-hide`);
 * - the name ellipsises with the full name in the `title`;
 * - double-clicking the name (or using the trailing chevron) opens the detail
 *   page.
 *
 * The three extras aria2-next adds — the media chip, the "select files" warning
 * and the ED2K indicator — are additive and never replace AriaNg's markup.
 */

import { memo, useCallback, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';

import type { Checkbox } from 'mdui/components/checkbox.js';

import type { NormalizedTask } from '@/domain/types';
import { isTaskRetryable } from '@/domain/normalize';
import { Aria2TaskStatus, FileSelectionState, MediaPhase } from '@/config/rpc-constants';
import { MORE_THAN_ONE_DAY_KEY, formatRemainTime, readableVolume } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import { MduiIcon } from '@/ui/mdui';
import { useMduiEvent, useMduiProperty } from '@/ui/mdui/use-mdui';
import { useSelectionStore } from '@/store/selection';
import { Routes, appUrl } from '@/app/route-paths';
import { TaskProgress } from './TaskProgress';

/* ------------------------------------------------------------------ */
/* navigation                                                          */
/* ------------------------------------------------------------------ */

/** `#!/task/detail/<gid>`, optionally pointing at a detail tab. */
export function taskDetailHref(gid: string, tab?: string): string {
  return appUrl(Routes.TaskDetail.replace(':gid', encodeURIComponent(gid)), tab ? { tab } : undefined);
}

/**
 * Navigates to the detail page without a router dependency.
 *
 * A plain `location.hash` assignment is enough: `appUrl()` produces the `#!…`
 * form the hash history listens for, so this works with either
 * `HashRouter`/`createHashRouter` or a bare `<a href>`, and it keeps `TaskRow`
 * renderable in a unit test with no provider above it.
 */
export function navigateToTaskDetail(gid: string, tab?: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.location.hash = taskDetailHref(gid, tab);
}

/* ------------------------------------------------------------------ */
/* pure cell helpers                                                   */
/* ------------------------------------------------------------------ */

/** The placeholder AriaNg showed for a queued task's ETA. */
export const ETA_PLACEHOLDER = '--:--:--';

/**
 * AriaNg's `task-last-time` binding:
 * `'--:--:--'` while waiting, empty while paused, `HH:mm:ss` while active and
 * under a day, `More Than One Day` for anything else.
 *
 * `formatRemainTime` already implements the last two branches (including the
 * `null` → `''` case aria2 reports when it cannot estimate), so this only adds
 * the two status gates and translates the over-a-day marker.
 */
export function formatEta(task: NormalizedTask, translate: (key: string) => string): string {
  switch (task.status) {
    case Aria2TaskStatus.Waiting:
      return ETA_PLACEHOLDER;
    case Aria2TaskStatus.Active: {
      const eta = formatRemainTime(task.remainTime);
      return eta === '' ? '' : eta === MORE_THAN_ONE_DAY_KEY ? translate(MORE_THAN_ONE_DAY_KEY) : eta;
    }
    default:
      // Paused, complete, error and removed all render an empty cell.
      return '';
  }
}

/**
 * AriaNg's `taskStatus` filter, `simplify = true`.
 *
 * `simplify` only blanks the *terminal* statuses — those rows live on the stopped
 * page where a status word next to an empty speed column is noise. The
 * verification branch is the reason this function exists: an active task that is
 * verifying reports **no** download speed, so the column shows the phase.
 */
export function statusTextKey(task: NormalizedTask): string {
  if (task.status === Aria2TaskStatus.Active) {
    if (task.verifyIntegrityPending) {
      return 'Pending Verification';
    }
    // AriaNg tested the raw `verifiedLength`; `verifiedPercent` is what
    // normalisation kept from it.
    if (task.verifiedPercent !== undefined) {
      return task.verifiedPercent ? 'format.task.verifying-percent' : 'Verifying';
    }
    if (task.seeder) {
      return 'Seeding';
    }
    return 'Downloading';
  }

  switch (task.status) {
    case Aria2TaskStatus.Waiting:
      return 'Waiting';
    case Aria2TaskStatus.Paused:
      return 'Paused';
    case Aria2TaskStatus.Complete:
      return 'Completed';
    case Aria2TaskStatus.Error:
      return task.errorCode ? 'format.task.error-occurred' : 'Error Occurred';
    case Aria2TaskStatus.Removed:
      return 'Removed';
    default:
      return '';
  }
}

/**
 * The download-speed cell's text, ported from `list.html`.
 *
 * A live, non-verifying task shows `readableVolume(downloadSpeed) + '/s'`. A
 * seeding task sitting at 0 B/s shows `-` — a zero would read as "stalled" when
 * the transfer is simply finished.
 */
export function speedText(
  task: NormalizedTask,
  translate: (key: string, params?: Record<string, string | number | boolean>) => string,
): string {
  const isLive = task.status === Aria2TaskStatus.Active && !task.verifyIntegrityPending && task.verifiedPercent === undefined;

  if (isLive) {
    if (task.seeder && task.downloadSpeed === 0) {
      return '-';
    }
    return `${readableVolume(task.downloadSpeed)}/s`;
  }

  return translate(statusTextKey(task), {
    errorcode: task.errorCode ?? '',
    verifiedPercent: task.verifiedPercent ?? 0,
  });
}

/** `numSeeders + '/' + connections`, or just the connection count for HTTP tasks. */
export function seedersText(task: NormalizedTask): string {
  if (task.status !== Aria2TaskStatus.Active) {
    return '';
  }
  return task.numSeeders ? `${task.numSeeders}/${task.connections}` : `${task.connections}`;
}

/** The download-speed column's tooltip: the real speeds, even when the cell hides them. */
export function speedTooltip(task: NormalizedTask, translate: (key: string) => string): string {
  if (task.status !== Aria2TaskStatus.Active) {
    return '';
  }
  const download = `${translate('Download Speed')}: ${readableVolume(task.downloadSpeed)}/s`;
  return task.bittorrent
    ? `${download}, ${translate('Upload Speed')}: ${readableVolume(task.uploadSpeed)}/s`
    : download;
}

/* ------------------------------------------------------------------ */
/* aria2-next extras                                                   */
/* ------------------------------------------------------------------ */

/**
 * `true` while aria2-next is waiting for the user to pick the torrent's files.
 *
 * `aria2.unpause` on such a task is rejected by the server, so Start has to be
 * disabled for it — offering a button that always fails is worse than not
 * offering one.
 */
export function isFileSelectionPending(task: NormalizedTask): boolean {
  return task.bittorrent?.fileSelectionState === FileSelectionState.Awaiting;
}

/** aria2-next has no locale keys yet; the key doubles as its English text. */
const MEDIA_PHASE_LABELS: Readonly<Record<string, string>> = {
  [MediaPhase.Waiting]: 'Waiting',
  [MediaPhase.Probing]: 'Probing',
  [MediaPhase.AwaitingSelection]: 'Select files to continue',
  [MediaPhase.Downloading]: 'Downloading',
  [MediaPhase.Recording]: 'Recording',
  [MediaPhase.Finalizing]: 'Finalizing',
  [MediaPhase.Paused]: 'Paused',
  [MediaPhase.Complete]: 'Completed',
  [MediaPhase.Error]: 'Error',
  [MediaPhase.Removed]: 'Removed',
};

/**
 * The media chip's label.
 *
 * A live stream and a VOD task with an **unknown duration** both render a word
 * instead of a number. Rendering `0%` for `lengthKnown === false` would be a lie
 * — `media.progress` is `null` precisely because the total duration is unknown,
 * and AriaNg's `!length` bail-out existed for exactly that reason.
 */
export function mediaChipText(task: NormalizedTask): string | null {
  const media = task.media;
  if (!media) {
    return null;
  }
  if (media.live) {
    return 'Live';
  }
  if (media.progress !== null) {
    return `${Math.trunc(media.progress * 1000) / 10}%`;
  }
  return media.state ? (MEDIA_PHASE_LABELS[media.state] ?? 'Media') : 'Media';
}

/* ------------------------------------------------------------------ */
/* the row                                                             */
/* ------------------------------------------------------------------ */

export interface TaskRowProps {
  task: NormalizedTask;
  /** Turns the row into a @dnd-kit draggable. `false` everywhere but `/waiting`. */
  draggable?: boolean;
  /** Supplied by the page: retry one task (with the confirm dialog). */
  onRetryTask?: (task: NormalizedTask) => void;
}

/**
 * The memoised row.
 *
 * `memo` is what keeps the 1 s poll from re-rendering every row when only the
 * selection changed — each row additionally subscribes to **its own** slice of
 * the selection store (`selected[gid]`), so toggling one row re-renders exactly
 * one row.
 */
export const TaskRow = memo(function TaskRow({ task, draggable = false, onRetryTask }: TaskRowProps) {
  const t = useTranslate();
  const selected = useSelectionStore((state) => state.selected[task.gid] === true);
  const toggle = useSelectionStore((state) => state.toggle);
  const checkboxRef = useRef<Checkbox>(null);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id: task.gid,
    disabled: !draggable,
  });

  // `checked` is a JS property on `<mdui-checkbox>`; pushing it through the
  // bridge keeps the box in sync when the selection store changes under us.
  useMduiProperty(checkboxRef, { checked: selected });
  useMduiEvent(checkboxRef, 'change', () => {
    // Mouse clicks never reach the box (`.disable-clickable`), so this only fires
    // for a keyboard activation — which must toggle exactly once.
    if ((checkboxRef.current?.checked === true) !== selected) {
      toggle(task.gid);
    }
  });

  const onRowClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A link inside the row (retry, files count, chevron) must not also toggle.
      const target = event.target as Element | null;
      if (target && typeof target.closest === 'function' && target.closest('a, button') !== null) {
        return;
      }
      toggle(task.gid);
    },
    [task.gid, toggle],
  );

  const onRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        toggle(task.gid);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        navigateToTaskDetail(task.gid);
      }
    },
    [task.gid, toggle],
  );

  const onNameDoubleClick = useCallback(() => {
    navigateToTaskDetail(task.gid);
  }, [task.gid]);

  const hasError = task.status === Aria2TaskStatus.Error && !!task.errorDescription;
  const isSeeding = task.status === Aria2TaskStatus.Active && task.seeder;
  const retryable = isTaskRetryable(task);
  const mediaLabel = mediaChipText(task);
  const fileSelectionPending = isFileSelectionPending(task);
  const speed = speedText(task, t);
  const tooltip = speedTooltip(task, t);
  const detailHref = taskDetailHref(task.gid);

  const style: CSSProperties | undefined = isDragging ? { zIndex: 2 } : undefined;

  return (
    <div
      ref={setNodeRef}
      role="row"
      className={
        isDragging
          ? 'task-row task-row--dragging'
          : selected
            ? 'task-row task-row--selected'
            : 'task-row'
      }
      style={style}
      data-gid={task.gid}
      data-selected={selected ? 'true' : 'false'}
      data-testid="task-row"
      aria-selected={selected}
      tabIndex={0}
      onClick={onRowClick}
      onKeyDown={onRowKeyDown}
    >
      {/* ---- group A: file name + file size ---- */}
      <div role="gridcell" className="task-cell task-cell--main">
        <div className="task-heading">
          {draggable ? (
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="task-drag-handle"
              aria-label={`${t('Move')}: ${task.taskName}`}
              title={t('Move')}
              {...attributes}
              {...listeners}
            >
              <MduiIcon name="menu" size="1.25rem" />
            </button>
          ) : null}

          <mdui-checkbox
            ref={checkboxRef}
            className={selected ? 'task-checkbox' : 'task-checkbox disable-clickable task-checkbox--hidden'}
            aria-label={task.taskName}
            title={task.taskName}
          />

          <span className="task-name" title={task.taskName} onDoubleClick={onNameDoubleClick}>
            {task.taskName}
          </span>
        </div>

        <div className="task-files">
          <span className="task-size">{readableVolume(task.totalLength)}</span>

          {task.files.length > 1 ? (
            <a
              className="task-files-link"
              href={taskDetailHref(task.gid, 'files')}
              title={t('Click to view task detail')}
            >
              {t('format.settings.file-count', { count: task.selectedFileCount })}
            </a>
          ) : null}

          {hasError ? (
            <span className="task-marker task-marker--error" title={t(task.errorDescription)} role="img" aria-label={t(task.errorDescription)}>
              <MduiIcon name="error" size="1rem" />
            </span>
          ) : null}

          {isSeeding ? (
            <span className="task-marker task-marker--seeder" title={t('Seeding')} role="img" aria-label={t('Seeding')}>
              <MduiIcon name="upload" size="1rem" />
            </span>
          ) : null}

          {retryable ? (
            <button
              type="button"
              className="task-retry-link"
              title={t('Retry')}
              onClick={() => onRetryTask?.(task)}
            >
              {t('Retry')}
            </button>
          ) : null}

          {mediaLabel !== null ? (
            <span className="task-media-chip" data-testid="task-media-chip" title={task.media?.state ?? mediaLabel}>
              <MduiIcon name={task.media?.live ? 'schedule' : 'movie'} size="0.9rem" />
              {mediaLabel}
            </span>
          ) : null}

          {fileSelectionPending ? (
            <span
              className="task-media-chip task-media-chip--warning"
              data-testid="task-file-selection-warning"
              role="status"
            >
              <MduiIcon name="warning" size="0.9rem" />
              {t('Select files to continue')}
            </span>
          ) : null}

          {task.ed2k ? (
            <span className="task-ed2k-chip" data-testid="task-ed2k-chip" title="ED2K">
              <MduiIcon name="hub" size="0.9rem" />
              ED2K
            </span>
          ) : null}
        </div>
      </div>

      {/* ---- group B: progress + remaining ---- */}
      <div role="gridcell" className="task-cell task-cell--progress">
        <TaskProgress
          percent={task.completePercent}
          error={task.status === Aria2TaskStatus.Error}
          label={t('Progress')}
        />

        <div className="task-meta">
          <span className="task-last-time" data-testid="task-eta">
            {formatEta(task, t)}
          </span>

          {/* Compact-only inline speed: the whole group C is hidden there. */}
          <span className="task-download-speed task-download-speed--compact">{speed}</span>

          <span className="task-seeders">{seedersText(task)}</span>
        </div>
      </div>

      {/* ---- group C: download speed ---- */}
      <div role="gridcell" className="task-cell task-cell--speed">
        <span className="task-download-speed" title={tooltip}>
          {speed}
        </span>
      </div>

      <div role="gridcell" className="task-cell task-cell--chevron">
        <a className="task-right-arrow" href={detailHref} title={t('Click to view task detail')} aria-label={t('Click to view task detail')}>
          <MduiIcon name="chevron-right" size="2rem" />
        </a>
      </div>
    </div>
  );
});

export default TaskRow;