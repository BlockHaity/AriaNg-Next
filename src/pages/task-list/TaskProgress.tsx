/**
 * The per-row progress bar — a port of the `.progress` / `.progress-bar` pair
 * in AriaNg's `views/list.html`.
 *
 * MD3 compliance notes:
 * - mdui ships `<mdui-linear-progress>`, but it renders its own label *outside*
 *   the track and cannot show a percentage that travels with the fill. AriaNg
 *   puts the percentage **inside** the bar (absolutely positioned over the
 *   track) and switches its colour at 50 %, so the bar is built from tokens here
 *   instead of reusing the component.
 * - Colours come from `--mdui-color-*` roles only; the "warning" tone is MD3's
 *   error container pair, because an errored row is exactly an error state.
 */

import { formatPercent } from '@/i18n/format';

/** AriaNg's `progress-lower` threshold: below this the label needs dark ink. */
const LOWER_THRESHOLD = 50;

export interface TaskProgressProps {
  /** `0…100`. */
  percent: number;
  /** `true` renders the MD3 error pair instead of the primary pair. */
  error?: boolean;
  /** Accessible name; defaults to the aria-label the caller supplies. */
  label?: string;
}

/**
 * Determinate progress track.
 *
 * AriaNg wrote `aria-valuemin="1"`, which is a typo that made screen readers
 * announce "1" as the floor of every bar; MD3 wants `0`. Everything else — the
 * truncation to two decimals, the 50 % ink switch — is reproduced exactly.
 */
export function TaskProgress({ percent, error = false, label }: TaskProgressProps) {
  const clamped = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
  const isLower = clamped < LOWER_THRESHOLD;

  return (
    <div
      className="task-progress"
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100) / 100}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={error ? 'task-progress-bar task-progress-bar--error' : 'task-progress-bar'}
        style={{ width: `${clamped}%` }}
      >
        <span className={isLower ? 'task-progress-value task-progress-value--lower' : 'task-progress-value'}>
          {`${formatPercent(clamped, 2)}%`}
        </span>
      </div>
    </div>
  );
}

export default TaskProgress;