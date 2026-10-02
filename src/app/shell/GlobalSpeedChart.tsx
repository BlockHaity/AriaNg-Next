/**
 * The global speed popover — AriaNg's `ng-pop-chart`, 1:1.
 *
 * ```
 * trigger: click + hover          placement: top
 * content: a 312 × 200 line/area chart, two series (upload, download)
 *          a tooltip with a clock icon and both speeds
 *          "Click to pin" while the popover is only hovered
 *          "No Data" while the ring buffer is empty
 * ```
 *
 * ## Three decisions worth knowing
 *
 * 1. **The trigger is `trigger="manual"`.** mdui's own `click`/`hover` triggers
 *    cannot express AriaNg's pin semantics (hover = temporary, click = pinned),
 *    and the chart also has to know when it becomes visible so it can size
 *    itself. `GlobalSpeedChart` therefore drives the `open` property itself.
 * 2. **ECharts is imported dynamically.** `echarts` is ~300 kB gzipped; it must
 *    not be in the initial chunk, so the first `await import('echarts/core')`
 *    happens when the popover is opened for the first time.
 * 3. **The chart is themed from the mdui CSS variables**, read off
 *    `document.documentElement`, and re-themed on the `themechange` event the
 *    theme module dispatches. That keeps light / dark / dynamic-colour correct
 *    with not one colour literal in this file.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { Tooltip } from 'mdui/components/tooltip.js';
import type * as EChartsCore from 'echarts/core';

import { readableVolume } from '@/i18n';
import { THEME_CHANGE_EVENT } from '@/ui/mdui';
import { useMduiEvent, useMduiProperty } from '@/ui/mdui';
import { GLOBAL_STATS_KEY, getStats, subscribe, toChartSeries } from '@/store/monitor';

/** AriaNg's `ng-pop-chart` size. */
export const CHART_WIDTH = 312;
export const CHART_HEIGHT = 200;

/* -------------------------------------------------------------------------- */
/* the ECharts bridge (lazy)                                                  */
/* -------------------------------------------------------------------------- */

/** The slice of the ECharts API this file uses. */
interface ChartInstance {
  setOption(option: unknown, notMerge?: boolean): void;
  resize(): void;
  dispose(): void;
}

let echartsPromise: Promise<typeof EChartsCore> | null = null;

/**
 * Loads and registers exactly the ECharts pieces the chart needs.
 *
 * Tree-shaken on purpose: `LineChart` + `GridComponent` + `TooltipComponent` +
 * the canvas renderer, and nothing else. The import is cached, so reopening the
 * popover costs nothing after the first time.
 */
async function loadECharts(): Promise<typeof EChartsCore> {
  echartsPromise ??= (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]);
    core.use([
      charts.LineChart,
      components.GridComponent,
      components.TooltipComponent,
      renderers.CanvasRenderer,
    ]);
    return core;
  })();
  return echartsPromise;
}

/* -------------------------------------------------------------------------- */
/* theme                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reads an `--mdui-color-*` token as a CSS colour.
 *
 * mdui stores colours as bare RGB components (`103,80,164`) for use inside
 * `rgb(var(--mdui-color-primary))`, so the value has to be wrapped here. A token
 * that is not available (jsdom, an early paint) falls back to `transparent`
 * rather than an invented colour.
 */
function cssColor(token: string, fallback = 'transparent'): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return fallback;
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (!raw) {
      return fallback;
    }
    if (raw.startsWith('rgb') || raw.startsWith('#') || raw.startsWith('hsl')) {
      return raw;
    }
    return `rgb(${raw.replace(/\s+/g, ',')})`;
  } catch {
    return fallback;
  }
}

interface ChartTheme {
  download: string;
  upload: string;
  text: string;
  axis: string;
  surface: string;
}

function readTheme(): ChartTheme {
  return {
    download: cssColor('--mdui-color-primary'),
    upload: cssColor('--mdui-color-tertiary'),
    text: cssColor('--mdui-color-on-surface'),
    axis: cssColor('--mdui-color-outline-variant'),
    surface: cssColor('--mdui-color-surface-container'),
  };
}

/* -------------------------------------------------------------------------- */
/* the option builder                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Builds the ECharts option from the `global` ring buffer.
 *
 * The **upload** series is drawn first so the download area sits on top of it,
 * which is how AriaNg's chart read: download is the dominant line.
 */
export function buildChartOption(theme: ChartTheme, translate: (key: string) => string): unknown {
  const series = toChartSeries(GLOBAL_STATS_KEY);
  const hasData = series.times.length > 0;

  const line = (name: string, values: number[], colour: string) => ({
    name,
    type: 'line',
    data: values,
    showSymbol: false,
    smooth: false,
    lineStyle: { width: 1, color: colour },
    itemStyle: { color: colour },
    areaStyle: { color: colour, opacity: 0.28 },
  });

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 44, right: 6, top: 8, bottom: 18 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: series.times.map((time) => (time > 0 ? String(time) : '')),
      axisLine: { lineStyle: { color: theme.axis } },
      axisLabel: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitNumber: 2,
      axisLabel: { color: theme.text, formatter: (value: number) => readableVolume(value, 'auto') },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.axis } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.surface,
      borderColor: theme.axis,
      textStyle: { color: theme.text },
      formatter: (params: unknown) => {
        const rows = Array.isArray(params) ? (params as { seriesName?: string; value?: unknown }[]) : [];
        const lines = rows.map((row) => {
          const value = Array.isArray(row.value) ? Number(row.value[1]) : Number(row.value);
          const icon = row.seriesName === translate('Upload') ? '▲' : '▼';
          return `${icon} ${row.seriesName ?? ''}: ${readableVolume(value, 'auto')}/s`;
        });
        // AriaNg's clock icon in front of the readout.
        return ['🕒', ...lines].join('<br/>');
      },
    },
    graphic: hasData
      ? []
      : [
          {
            type: 'text',
            left: 'center',
            top: 'middle',
            style: { text: translate('No Data'), fill: theme.text, fontSize: 13 },
          },
        ],
    series: [
      line(translate('Upload'), series.upload, theme.upload),
      line(translate('Download'), series.download, theme.download),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* the component                                                              */
/* -------------------------------------------------------------------------- */

export interface GlobalSpeedChartProps {
  /** The live readout that acts as the popover trigger. */
  children: ReactNode;
  /** Accessible name of the trigger. */
  label: string;
  translate: (key: string) => string;
}

/**
 * Wraps the speed readout in a popover that carries the chart.
 *
 * Mounting this component does **not** load ECharts: the module is fetched when
 * the popover is opened for the first time (`open` becoming true), and the
 * instance is disposed when it closes.
 */
export function GlobalSpeedChart({ children, label, translate }: GlobalSpeedChartProps) {
  const tooltipRef = useRef<Tooltip>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartInstance | null>(null);
  const theme = useRef<ChartTheme>(readTheme());

  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [visible, setVisible] = useState(false);
  const [inside, setInside] = useState(false);
  const open = pinned || (hovering && !pinned) || inside;

  /* --- mdui plumbing --------------------------------------------------- */

  useMduiProperty(tooltipRef, { trigger: 'manual', variant: 'rich', placement: 'top', open });
  useMduiEvent(tooltipRef, 'opened', () => setVisible(true));
  useMduiEvent(tooltipRef, 'closed', () => setVisible(false));

  /* --- the chart itself ------------------------------------------------ */

  const render = useCallback(() => {
    if (!chart.current) {
      return;
    }
    chart.current.setOption(buildChartOption(theme.current, translate), true);
  }, [translate]);

  useEffect(() => {
    if (!visible) {
      chart.current?.dispose();
      chart.current = null;
      return;
    }

    let cancelled = false;
    void loadECharts().then((echarts) => {
      if (cancelled || !chartRef.current) {
        return;
      }
      chart.current ??= echarts.init(chartRef.current, undefined, {
        width: CHART_WIDTH,
        height: CHART_HEIGHT,
      }) as unknown as ChartInstance;
      render();
    });

    return () => {
      cancelled = true;
    };
  }, [render, visible]);

  // Re-theme on a scheme change (light/dark) and on a dynamic colour change.
  useEffect(() => {
    const retheme = (): void => {
      theme.current = readTheme();
      render();
    };
    window.addEventListener(THEME_CHANGE_EVENT, retheme);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, retheme);
    };
  }, [render]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    return subscribe(GLOBAL_STATS_KEY, render);
  }, [render, visible]);

  // The popover only becomes measurable once mdui has laid it out.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const id = window.setTimeout(() => chart.current?.resize(), 0);
    return () => window.clearTimeout(id);
  }, [visible]);

  useEffect(() => () => chart.current?.dispose(), []);

  /* --- interaction ----------------------------------------------------- */

  const close = useCallback(() => {
    setPinned(false);
    setHovering(false);
    setInside(false);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && tooltipRef.current?.contains(target)) {
        return;
      }
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [close, open]);

  const hasData = getStats(GLOBAL_STATS_KEY).length > 0;

  return (
    <mdui-tooltip ref={tooltipRef} className="ariang-speed-popover" open={open}>
      <span
        slot="content"
        // Hovering the popover itself keeps it open while it is unpinned —
        // without this the pointer would have to travel back to the readout
        // within the (very short) close delay.
        onMouseEnter={() => {
          setInside(true);
        }}
        onMouseLeave={() => {
          setInside(false);
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          alignItems: 'center',
        }}
      >
        <div
          ref={chartRef}
          style={{ width: `${CHART_WIDTH}px`, height: `${CHART_HEIGHT}px` }}
          role="img"
          aria-label={`${translate('Download')} / ${translate('Upload')}`}
        />
        {!pinned ? (
          <span style={{ font: 'var(--mdui-typescale-body-small-font)' }}>{translate('Click to pin')}</span>
        ) : null}
      </span>

      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setPinned((value) => !value);
        }}
        onMouseEnter={() => {
          setHovering(true);
        }}
        onMouseLeave={() => {
          setHovering(false);
        }}
        onFocus={() => {
          setHovering(true);
        }}
        onBlur={() => {
          setHovering(false);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          minHeight: '2.75rem',
          padding: '0 0.5rem',
          border: 0,
          borderRadius: 'var(--mdui-shape-corner-full)',
          background: 'transparent',
          color: 'rgb(var(--mdui-color-on-surface-variant))',
          font: 'var(--mdui-typescale-label-large-font)',
          cursor: 'pointer',
        }}
      >
        {hasData ? null : <span className="ariang-visually-hidden">{translate('No Data')}</span>}
        {children}
      </button>
    </mdui-tooltip>
  );
}