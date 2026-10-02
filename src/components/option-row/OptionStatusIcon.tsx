/**
 * The small status indicator AriaNg's `ngSetting` hung off the right edge of
 * every option row (`scope.optionStatus.getStatusIcon()`).
 *
 * AriaNg drove it from a four-value string inside the directive; here the
 * machine is a React state string owned by {@link OptionRow}, and this file only
 * maps a state onto an icon name plus an MD3 colour role.
 */

import type { CSSProperties } from 'react';
import { MduiIcon } from '@/ui/mdui';
import type { IconName } from '@/ui/mdui';

/**
 * `ready` is "untouched since the last accepted change" and renders nothing —
 * AriaNg's `getStatusIcon()` returned `''` for it, and `isShowStatusIcon()`
 * hid the feedback icon entirely.
 */
export type OptionStatus = 'ready' | 'pending' | 'saving' | 'success' | 'failed' | 'error';

export interface OptionStatusMeta {
  icon: IconName | '';
  /** MD3 colour role the glyph is painted with, via a class in `styles.css`. */
  role: 'default' | 'primary' | 'error' | 'tertiary';
  /** Announced to assistive tech (translated by the caller). */
  tone: 'none' | 'progress' | 'success' | 'warning' | 'error';
}

/** `fa-hourglass-start` / `fa-spin fa-pulse fa-spinner` / `fa-check` / … */
export const OPTION_STATUS_META: Readonly<Record<OptionStatus, OptionStatusMeta>> = {
  ready: { icon: '', role: 'default', tone: 'none' },
  pending: { icon: 'schedule', role: 'default', tone: 'progress' },
  saving: { icon: 'refresh', role: 'primary', tone: 'progress' },
  success: { icon: 'check', role: 'primary', tone: 'success' },
  failed: { icon: 'warning', role: 'tertiary', tone: 'warning' },
  error: { icon: 'error', role: 'error', tone: 'error' },
};

export interface OptionStatusIconProps {
  status: OptionStatus;
  /** Screen-reader text; the glyph itself is decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders the status glyph, or nothing at all in the `ready` state.
 *
 * `aria-hidden` on the icon plus a visually hidden label keeps the status
 * announced once, instead of an unlabelled graphic being skipped entirely.
 */
export function OptionStatusIcon({ status, label, className, style }: OptionStatusIconProps) {
  const meta = OPTION_STATUS_META[status];

  if (!meta.icon) {
    return null;
  }

  return (
    <span
      className={['option-row__status', `option-row__status--${meta.role}`, className]
        .filter(Boolean)
        .join(' ')}
      data-status={status}
      style={style}
    >
      <MduiIcon name={meta.icon} size="1.25rem" />
      {label ? <span className="ariang-visually-hidden">{label}</span> : null}
    </span>
  );
}