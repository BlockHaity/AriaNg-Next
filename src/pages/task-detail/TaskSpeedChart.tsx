/**
 * The per-task speed chart of the Overview tab.
 *
 * Port of AriaNg's `<ng-chart>` + `directives/chart.js` + the
 * `ariaNgMonitorService.getEmptyStatsData(gid)` history: a dual-series
 * upload/download area chart fed by {@link getStats} (300 samples for a task,
 * `TASK_STAT_CAPACITY`).
 *
 * Three things the original did not have to worry about, and how they are
 * handled here:
 *
 * 1. **ECharts is loaded lazily.** `echarts/core` + one chart type + three
 *    components is ~400 kB of JS that no user without an active task detail page
 *    needs. The import is a dynamic `import()`, so it lands in its own chunk and
 *    the chart renders a placeholder until it resolves.
 * 2. **Colours come from MD3 tokens.** AriaNg baked two hex values into the
 *    chart; canvas/SVG cannot resolve `var()`, so the tokens are read from the
 *    host element's computed style and the whole option object is rebuilt when
 *    the `themechange` event fires — which is what makes the chart follow dark
 *    mode and the dynamic scheme.
 * 3. **Disposal is mandatory.** `echarts.init` attaches a resize listener and a
 *    renderer to the element; leaking either keeps the whole library (and the
 *    DOM node) alive. `dispose()` runs on unmount and before every re-init.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { getStats, subscribe } from '@/store/monitor';
import type { SpeedSample } from '@/domain/types';
import { readableVolume } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import { resolveTokenColor } from './PieceMap';

/* ------------------------------------------------------------------ */
/* lazy echarts                                                       */
/* ------------------------------------------------------------------ */

/** Minimal surface of the echarts pieces this chart needs. */
export interface EChartsRuntime {
  init: (element: HTMLElement) => EChartsInstance;
  use: (definition: unknown) => void;
  LineChart: unknown;
  GridComponent: unknown;
  TooltipComponent: unknown;
}

interface EChartsInstance {
  setOption(option: unknown, notMerge?: boolean): void;
  resize(): void;
  dispose(): void;
}

let runtimePromise: Promise<EChartsRuntime> | null = null;

/**
 * Loads (once) the minimal echarts build.
 *
 * The promise is cached at module scope: switching tabs must not re-download or
 * re-evaluate the library, and two charts on the same page must share one copy.
 */
export function loadECharts(): Promise<EChartsRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
    ])
      .then(([core, charts, components]) => {
        const LineChart = (charts as { LineChart?: unknown }).LineChart;
        const GridComponent = (components as { GridComponent?: unknown }).GridComponent;
        const TooltipComponent = (components as { TooltipComponent?: unknown }).TooltipComponent;

        const runtime: EChartsRuntime = {
          init: core.init as unknown as EChartsRuntime['init'],
          use: core.use as unknown as EChartsRuntime['use'],
          LineChart,
          GridComponent,
          TooltipComponent,
        };

        runtime.use(runtime.LineChart);
        runtime.use(runtime.GridComponent);
        runtime.use(runtime.TooltipComponent);

        return runtime;
      })
      .catch((error: unknown) => {
        // A failed chunk must not poison every later attempt.
        runtimePromise = null;
        throw error;
      });
  }

  return runtimePromise;
}

/** Test seam: forget the cached promise. */
export function resetEChartsForTests(): void {
  runtimePromise = null;
}

/* ------------------------------------------------------------------ */
/* props                                                              */
/* ------------------------------------------------------------------ */

export interface TaskSpeedChartProps {
  /** gid; also the key of the speed-history ring buffer. */
  gid: string;
  /** Chart height in CSS pixels. AriaNg used 200. */
  height?: number;
  className?: string;
  style?: CSSProperties;
}

/** Token-derived palette, resolved from the host element. */
interface ChartPalette {
  download: string;
  upload: string;
  axis: string;
  label: string;
  splitLine: string;
}

const FALLBACK_PALETTE: ChartPalette = {
  download: 'rgb(var(--mdui-color-primary))',
  upload: 'rgb(var(--mdui-color-tertiary))',
  axis: 'rgb(var(--mdui-color-on-surface-variant))',
  label: 'rgb(var(--mdui-color-on-surface))',
  splitLine: 'rgb(var(--mdui-color-outline-variant))',
};

function readPalette(element: Element | null): ChartPalette {
  if (!element) return FALLBACK_PALETTE;

  return {
    download: resolveTokenColor(element, '--mdui-color-primary', FALLBACK_PALETTE.download),
    upload: resolveTokenColor(element, '--mdui-color-tertiary', FALLBACK_PALETTE.upload),
    axis: resolveTokenColor(element, '--mdui-color-on-surface-variant', FALLBACK_PALETTE.axis),
    label: resolveTokenColor(element, '--mdui-color-on-surface', FALLBACK_PALETTE.label),
    splitLine: resolveTokenColor(element, '--mdui-color-outline-variant', FALLBACK_PALETTE.splitLine),
  };
}

/** Timestamp of a unix-seconds sample, formatted for the axis. */
function clockLabel(seconds: number): string {
  const date = new Date(seconds * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The chart.
 *
 * Renders nothing but a placeholder box until echarts has loaded; renders the
 * `No Data` state when the ring buffer is still empty (which is exactly what a
 * freshly opened task page shows before the first poll lands).
 */
export function TaskSpeedChart({ gid, height = 200, className, style }: TaskSpeedChartProps) {
  const t = useTranslate();
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const [samples, setSamples] = useState<SpeedSample[]>(() => getStats(gid));
  const [ready, setReady] = useState(false);
  // Bumped by the theme listener; the option object is then rebuilt and re-set.
  const [themeVersion, setThemeVersion] = useState(0);

  /* ---- history subscription ---- */
  useEffect(() => {
    setSamples(getStats(gid));
    return subscribe(gid, () => setSamples(getStats(gid)));
  }, [gid]);

  /* ---- theme ---- */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onThemeChange = (): void => setThemeVersion((current) => current + 1);
    window.addEventListener('themechange', onThemeChange);
    return () => window.removeEventListener('themechange', onThemeChange);
  }, []);

  /* ---- lazy load + init + dispose ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    void loadECharts()
      .then((runtime) => {
        if (cancelled) return;
        chartRef.current = runtime.init(host);
        setReady(true);
      })
      .catch(() => {
        // Without echarts the chart area simply stays empty; the rest of the
        // page does not depend on it.
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
      // Detach the renderer, its resize listener and the canvas it created.
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  /* ---- option ---- */
  const option = useMemo(() => {
    const palette = readPalette(hostRef.current);

    const axisLabel = { color: palette.axis };
    const tooltipLabel = { color: palette.label };

    return {
      animation: false,
      grid: { top: 16, right: 12, bottom: 24, left: 56 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgb(var(--mdui-color-surface-container-high))',
        borderColor: 'rgb(var(--mdui-color-outline-variant))',
        textStyle: { color: palette.label },
        axisPointer: { type: 'line' },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? (params as { axisValue?: number; seriesName?: string; value?: number; color?: string }[]) : [];
          if (list.length === 0) return '';

          const stamp = list[0]?.axisValue;
          const clock = typeof stamp === 'number' ? clockLabel(stamp) : '';

          const rows = list
            .map((entry) => {
              const value = typeof entry.value === 'number' ? entry.value : 0;
              const marker =
                `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-inline-end:6px;background:${entry.color ?? palette.download}"></span>`;
              const name = entry.seriesName === 'upload' ? t('Upload') : t('Download');
              return `<div>${marker}${name}: ${readableVolume(value)}/s</div>`;
            })
            .join('');

          // The clock icon is the custom element the app already registers for
          // the rest of the UI, so the tooltip matches the surrounding design.
          return `<div style="display:flex;align-items:center;gap:6px"><mdui-icon-schedule style="font-size:1rem"></mdui-icon-schedule><span>${clock}</span></div>${rows}`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: samples.map((sample) => clockLabel(sample.time)),
        axisLabel: axisLabel,
        axisLine: { lineStyle: { color: palette.splitLine } },
      },
      yAxis: {
        type: 'value',
        splitNumber: 4,
        axisLabel: {
          ...axisLabel,
          formatter: (value: number) => readableVolume(value, 'auto'),
        },
        splitLine: { lineStyle: { color: palette.splitLine } },
      },
      series: [
        {
          name: 'download',
          type: 'line',
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.24 },
          lineStyle: { width: 2 },
          data: samples.map((sample) => sample.downloadSpeed),
          itemStyle: { color: palette.download },
          areaStyleColor: palette.download,
        },
        {
          name: 'upload',
          type: 'line',
          smooth: true,
          showSymbol: false,
          areaStyle: { opacity: 0.24 },
          lineStyle: { width: 2 },
          data: samples.map((sample) => sample.uploadSpeed),
          itemStyle: { color: palette.upload },
          areaStyleColor: palette.upload,
        },
      ],
      // Referenced so an empty chart still carries the readable label colours.
      textStyle: tooltipLabel,
    };
    // `themeVersion` is a deliberate dependency: it forces the whole option to be
    // rebuilt from freshly resolved tokens.
  }, [samples, themeVersion, t]);

  const apply = useCallback(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    if (!ready) return;
    apply();
  }, [ready, apply]);

  // Keep the drawing buffer in sync with the container (drawer / rail / resize).
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;

    const onResize = (): void => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ready]);

  const empty = samples.length === 0;

  return (
    <div
      ref={hostRef}
      className={className ? `ariang-chart-wrapper ${className}` : 'ariang-chart-wrapper'}
      style={{ height: `${height}px`, ...style }}
      role="img"
      aria-label={`${t('Download Speed')} / ${t('Upload Speed')}`}
      data-empty={empty ? 'true' : 'false'}
      data-chart-ready={ready ? 'true' : 'false'}
    >
      {/* The empty state is real DOM, not an echarts `graphic` label: it has to
          be readable before echarts finished loading and by assistive tech. */}
      {empty ? <div className="ariang-chart-no-data">{t('No Data')}</div> : null}
    </div>
  );
}

export default TaskSpeedChart;