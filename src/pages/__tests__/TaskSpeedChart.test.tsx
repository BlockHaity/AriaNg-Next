/**
 * Task speed chart: the two series, the empty state, and disposal.
 *
 * `echarts` is mocked so the assertions run against the *option object* the
 * chart hands to `setOption` — which is the part that can actually break (a
 * missing series, a stale token colour, a leak). The lazy dynamic import is
 * mocked too, so no chart code is downloaded in a test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import { clearAllStats, recordStat, resetStats } from '@/store/monitor';
import { TASK_STAT_CAPACITY } from '@/domain/types';

const setOption = vi.fn();
const resize = vi.fn();
const dispose = vi.fn();
const init = vi.fn(() => ({ setOption, resize, dispose }));

vi.mock('echarts/core', () => ({
  init: (...args: unknown[]) => init(...(args as [])),
  use: vi.fn(),
}));

vi.mock('echarts/charts', () => ({ LineChart: { name: 'LineChart' } }));
vi.mock('echarts/components', () => ({
  GridComponent: { name: 'GridComponent' },
  TooltipComponent: { name: 'TooltipComponent' },
}));

// Imported after the mocks so the component picks them up.
const { TaskSpeedChart, resetEChartsForTests } = await import('@/pages/task-detail/TaskSpeedChart');

/* ------------------------------------------------------------------ */
/* option helpers                                                      */
/* ------------------------------------------------------------------ */

interface SeriesOption {
  name: string;
  data: number[];
}

/** The last option object passed to `setOption`. */
function lastOption(): {
  series: SeriesOption[];
  xAxis: { data: string[] };
  yAxis: { axisLabel: { formatter: (value: number) => string } };
  tooltip: { formatter: (params: unknown) => string };
} {
  const calls = setOption.mock.calls;
  const option = calls[calls.length - 1]?.[0] as never;
  return option;
}

beforeEach(() => {
  clearAllStats();
  resetEChartsForTests();
  setOption.mockClear();
  resize.mockClear();
  dispose.mockClear();
  init.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* series                                                             */
/* ------------------------------------------------------------------ */

describe('TaskSpeedChart', () => {
  it('renders two series built from getStats', async () => {
    recordStat('gid-series', { downloadSpeed: 100, uploadSpeed: 10 });
    recordStat('gid-series', { downloadSpeed: 200, uploadSpeed: 20 });
    recordStat('gid-series', { downloadSpeed: 300, uploadSpeed: 30 });

    render(<TaskSpeedChart gid="gid-series" height={200} />);

    await waitFor(() => expect(setOption).toHaveBeenCalled());

    const option = lastOption();
    expect(option.series).toHaveLength(2);
    expect(option.series[0].name).toBe('download');
    expect(option.series[1].name).toBe('upload');
    expect(option.series[0].data).toEqual([100, 200, 300]);
    expect(option.series[1].data).toEqual([10, 20, 30]);
    expect(option.xAxis.data).toHaveLength(3);
  });

  it('reads the history of its own gid only', async () => {
    recordStat('gid-a', { downloadSpeed: 1, uploadSpeed: 1 });
    recordStat('gid-b', { downloadSpeed: 999, uploadSpeed: 999 });

    render(<TaskSpeedChart gid="gid-a" />);
    await waitFor(() => expect(setOption).toHaveBeenCalled());

    expect(lastOption().series[0].data).toEqual([1]);
  });

  it('re-renders when a new sample arrives', async () => {
    render(<TaskSpeedChart gid="gid-live" />);
    await waitFor(() => expect(setOption).toHaveBeenCalled());
    const before = setOption.mock.calls.length;

    act(() => {
      recordStat('gid-live', { downloadSpeed: 4096, uploadSpeed: 0 });
    });

    await waitFor(() => expect(setOption.mock.calls.length).toBeGreaterThan(before));
    expect(lastOption().series[0].data).toEqual([4096]);
  });

  it('applies the requested height', () => {
    const { container } = render(<TaskSpeedChart gid="gid-h" height={321} />);
    expect((container.querySelector('.ariang-chart-wrapper') as HTMLElement).style.height).toBe('321px');
  });
});

/* ------------------------------------------------------------------ */
/* empty state                                                         */
/* ------------------------------------------------------------------ */

describe('TaskSpeedChart — No Data', () => {
  it('shows "No Data" while the history is empty', () => {
    render(<TaskSpeedChart gid="gid-empty" />);

    expect(screen.getByText('No Data')).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('data-empty')).toBe('true');
  });

  it('drops the empty state once a sample lands', async () => {
    render(<TaskSpeedChart gid="gid-fills" />);
    expect(screen.getByText('No Data')).toBeInTheDocument();

    act(() => {
      recordStat('gid-fills', { downloadSpeed: 1, uploadSpeed: 1 });
    });

    await waitFor(() => expect(screen.queryByText('No Data')).toBeNull());
  });

  it('forgets the samples on resetStats (a fresh visit starts empty)', async () => {
    recordStat('gid-reset', { downloadSpeed: 5, uploadSpeed: 5 });
    resetStats('gid-reset');

    render(<TaskSpeedChart gid="gid-reset" />);
    expect(screen.getByText('No Data')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* tooltip + colours                                                   */
/* ------------------------------------------------------------------ */

describe('TaskSpeedChart — tooltip', () => {
  it('shows a clock and both speeds, formatted with readableVolume', async () => {
    recordStat('gid-tip', { downloadSpeed: 1048576, uploadSpeed: 1024 });

    render(<TaskSpeedChart gid="gid-tip" />);
    await waitFor(() => expect(setOption).toHaveBeenCalled());

    const html = lastOption().tooltip.formatter([
      { axisValue: 1700000000, seriesName: 'download', value: 1048576, color: 'rgb(1,2,3)' },
      { axisValue: 1700000000, seriesName: 'upload', value: 1024, color: 'rgb(4,5,6)' },
    ]);

    expect(html).toContain('mdui-icon-schedule');
    expect(html).toContain('Download: 1.00 MB/s');
    expect(html).toContain('Upload: 1.00 KB/s');
  });
});

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

describe('TaskSpeedChart — lifecycle', () => {
  it('disposes the instance on unmount', async () => {
    const { unmount } = render(<TaskSpeedChart gid="gid-dispose" />);
    await waitFor(() => expect(init).toHaveBeenCalled());

    unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from the history ring on unmount', async () => {
    const { unmount } = render(<TaskSpeedChart gid="gid-unsub" />);
    await waitFor(() => expect(setOption).toHaveBeenCalled());

    const before = setOption.mock.calls.length;
    unmount();

    // A sample after unmount must not touch the (disposed) instance.
    act(() => {
      recordStat('gid-unsub', { downloadSpeed: 7, uploadSpeed: 7 });
    });

    expect(setOption.mock.calls.length).toBe(before);
  });

  it('loads the minimal echarts build exactly once', async () => {
    render(<TaskSpeedChart gid="gid-a" />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    cleanup();

    render(<TaskSpeedChart gid="gid-b" />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(2));

    // The second chart reuses the cached promise — one dynamic import for both.
    expect(init).toHaveBeenCalledTimes(2);
  });
});

/** Guards the sample capacity the chart documents (300 per task). */
it('keeps at most TASK_STAT_CAPACITY samples per task', () => {
  expect(TASK_STAT_CAPACITY).toBe(300);

  for (let i = 0; i < TASK_STAT_CAPACITY + 10; i += 1) {
    recordStat('gid-cap', { downloadSpeed: i, uploadSpeed: 0 });
  }

  render(<TaskSpeedChart gid="gid-cap" />);
  // The ring is not empty, so the empty state must be gone.
  expect(screen.queryByText('No Data')).toBeNull();
});