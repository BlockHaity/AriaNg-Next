/**
 * Overview tab — the settings table plus the speed chart.
 *
 * Port of `views/task-detail.html` lines 23-168: `#overview-items` followed by
 * the `.task-status-chart-wrapper`. The chart is only rendered when
 * `downloadTaskRefreshInterval > 0` **and** the task is active, exactly like
 * AriaNg's `context.isEnableSpeedChart && task && task.status === 'active'`.
 */

import type { NormalizedTask } from '@/domain/types';
import { formatPercent } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import { OverviewTable } from '../OverviewTable';
import { TaskSpeedChart } from '../TaskSpeedChart';

export interface OverviewTabProps {
  task: NormalizedTask;
  /** Health percentage (0..100) computed from the peer list. */
  healthPercent: number;
  /** `downloadTaskRefreshInterval` — `0` disables the chart entirely. */
  refreshInterval: number;
  /** `includePrefixWhenCopyingFromTaskDetails`. */
  includePrefixWhenCopying: boolean;
  /** The `(N Files)` link target. */
  onGoToFiles: () => void;
}

export function OverviewTab({
  task,
  healthPercent,
  refreshInterval,
  includePrefixWhenCopying,
  onGoToFiles,
}: OverviewTabProps) {
  const t = useTranslate();
  const showChart = refreshInterval > 0 && task.status === 'active';

  return (
    <div className="ariang-task-detail">
      <OverviewTable
        task={task}
        healthPercent={healthPercent}
        onGoToFiles={onGoToFiles}
        includePrefixWhenCopying={includePrefixWhenCopying}
      />

      {showChart ? (
        <section aria-label={t('Download Speed')}>
          <TaskSpeedChart gid={task.gid} height={200} />
        </section>
      ) : null}

      {/*
        The progress figure changes on every poll. The live region announces a
        single rounded number so a screen reader hears the trend instead of
        every tick of the raw percentage.
      */}
      <p className="ariang-visually-hidden" aria-live="polite" aria-atomic="true">
        {`${t('Progress')}: ${formatPercent(task.completePercent, 0)}%`}
      </p>
    </div>
  );
}

export default OverviewTab;