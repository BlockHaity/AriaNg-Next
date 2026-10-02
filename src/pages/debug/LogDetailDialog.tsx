/**
 * The "Log Detail" dialog — AriaNg's `log-detail-modal`.
 *
 * The head row repeats what the log list already shows (time, level, content)
 * and the body is the pretty-printed `attachment` the caller passed to the log
 * service. AriaNg piped the attachment through the `json` filter, which is
 * exactly `JSON.stringify(value, null, 2)`.
 */

import { formatLongDate, useI18n, useTranslate } from '@/i18n';
import type { LogEntry } from '@/store/logs';
import { MduiDialog } from '@/ui/mdui';

import './debug.css';

/**
 * The raw level name a log line carries.
 *
 * The store only knows the numeric `LogLevel` (`DEBUG:1 … ERROR:4`); AriaNg
 * printed the *name*, and that name is also the `data-level` hook the
 * stylesheet colours the pill by, so the two can never drift apart.
 */
export function logLevelName(level: LogEntry['level']): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
  switch (level) {
    case 2:
      return 'INFO';
    case 3:
      return 'WARN';
    case 4:
      return 'ERROR';
    default:
      return 'DEBUG';
  }
}

/** The raw level name (`DEBUG`, `WARN`, …) shown on the pill. */
export function LevelPill({ level }: { level: LogEntry['level'] }) {
  const name = logLevelName(level);
  return (
    <span className="ariang-level-pill" data-level={name}>
      {name}
    </span>
  );
}

export interface LogDetailDialogProps {
  /** `null` closes the dialog; AriaNg reset `currentLog` on `hide.bs.modal`. */
  log: LogEntry | null;
  onClose: () => void;
}

export function LogDetailDialog({ log, onClose }: LogDetailDialogProps) {
  const t = useTranslate();
  const { longDatePattern } = useI18n();

  return (
    <MduiDialog
      open={log !== null}
      heading={t('Log Detail')}
      icon="insert-drive-file"
      closeOnEsc
      closeOnOverlayClick
      onClosed={onClose}
      className="ariang-log-detail-dialog"
    >
      {log ? (
        <div className="ariang-log-detail">
          <div className="ariang-log-detail-head">
            <span className="ariang-log-time">{formatLongDate(log.time / 1000, longDatePattern)}</span>
            <LevelPill level={log.level} />
            <span className="ariang-log-content">{log.content}</span>
          </div>
          {/* `attachment` is `unknown`, and it may not even be serialisable. */}
          {log.attachment === undefined ? null : <pre>{stringify(log.attachment)}</pre>}
        </div>
      ) : null}
    </MduiDialog>
  );
}

/** `JSON.stringify` that can never throw (a cyclic attachment still renders). */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}