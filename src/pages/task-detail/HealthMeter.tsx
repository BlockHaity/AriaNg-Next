/**
 * A tiny M3 meter for the BitTorrent health percentage.
 *
 * The overview's Progress row shows `x% (y%)` — completion and *health*. aria2
 * exposes no HTML element for the second number, and mdui 2.1.5 has no meter
 * primitive, so this is the MD3 "linear progress indicator" reduced to a bar
 * with an accessible name.
 *
 * ARIA: `role="meter"` (ARIA 1.2) with `aria-valuenow` / `aria-valuemin` /
 * `aria-valuemax` and `aria-label`, so a screen reader announces both the value
 * and what it means instead of a bare percentage.
 */

import { useId } from 'react';
import type { CSSProperties } from 'react';

import { formatPercent } from '@/i18n/format';

export interface HealthMeterProps {
  /** 0..100. Values outside the range are clamped. */
  percent: number;
  /** Accessible name; defaults to the translated "Health Percentage". */
  label?: string;
  /** Rendered next to the bar. Pass `''` to render the bar only. */
  valueText?: string;
  className?: string;
  style?: CSSProperties;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 100 ? 100 : value;
}

export function HealthMeter({ percent, label, valueText, className, style }: HealthMeterProps) {
  const generatedId = useId();
  const clamped = clampPercent(percent);
  const text = valueText ?? `${formatPercent(clamped, 2)}%`;

  return (
    <div className={className ? `ariang-health-meter ${className}` : 'ariang-health-meter'} style={style}>
      <div
        className="ariang-health-meter-track"
        role="meter"
        id={generatedId}
        aria-label={label ?? 'Health Percentage'}
        aria-valuenow={Math.round(clamped * 100) / 100}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={text}
      >
        <div className="ariang-health-meter-fill" style={{ width: `${clamped}%` }} />
      </div>
      {text ? <span className="ariang-health-meter-label">{text}</span> : null}
    </div>
  );
}

export default HealthMeter;