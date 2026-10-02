/**
 * Speed history ring buffers — a port of AriaNg's `ariaNgMonitorService.js`.
 *
 * The original kept the history in `taskContext`, in memory only (its
 * `storagesInMemory` list held `globalStat`), because a speed graph is worthless
 * across a page reload: the x-axis is *time*, not a date. Nothing here is ever
 * persisted, by design.
 *
 * Two kinds of series exist:
 *
 *   - `'global'` — the aria2-wide download/upload speeds, polled by
 *     `globalStatRefreshInterval`. 120 samples (~2 minutes at the default 1s).
 *   - `'<gid>'`  — a single task's speeds on its detail page. 300 samples.
 *
 * Media (HLS / DASH) tasks report `mediaDownloadedLength` — retained payload —
 * instead of a meaningful network speed, so it is kept in its own series and
 * the chart can draw it distinctly.
 */

import type { SpeedSample } from '@/domain/types';
import { GLOBAL_STAT_CAPACITY, TASK_STAT_CAPACITY } from '@/domain/types';

/** Key used for the aria2-wide series. */
export const GLOBAL_STATS_KEY = 'global';

/** Alias kept for readability at the call sites that mirror AriaNg's naming. */
export type SeriesSample = SpeedSample;

/** A single chart-ready series triple (plus the optional media series). */
export interface ChartSeries {
  times: number[];
  download: number[];
  upload: number[];
  /** Only present when at least one sample carried `mediaDownloadedLength`. */
  media?: number[];
}

/** unix **seconds** — AriaNg used a `moment().format('X')` *string* here. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const buffers = new Map<string, SpeedSample[]>();
const listeners = new Map<string, Set<() => void>>();

/** 120 samples for the global chart, 300 for a task chart. */
export function statsCapacity(key: 'global' | string): number {
  return key === GLOBAL_STATS_KEY ? GLOBAL_STAT_CAPACITY : TASK_STAT_CAPACITY;
}

function bufferFor(key: string): SpeedSample[] {
  let buffer = buffers.get(key);
  if (!buffer) {
    buffer = [];
    buffers.set(key, buffer);
  }
  return buffer;
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) {
    return;
  }
  // Copy first: a listener may unsubscribe (or subscribe) during the loop.
  for (const listener of [...set]) {
    listener();
  }
}

/**
 * Pushes one sample onto the ring and evicts the oldest one when over capacity.
 *
 * `time` is stamped here — callers never pass it, so the ring can never end up
 * with a hole or an out-of-order x value.
 */
export function recordStat(key: 'global' | string, sample: Omit<SpeedSample, 'time'>): void {
  const buffer = bufferFor(key);
  const capacity = statsCapacity(key);

  buffer.push({ time: nowSeconds(), ...sample });

  // Ring semantics: push, then shift. Cheap enough at 300 entries and it keeps
  // the array contiguous, which matters for echarts.
  while (buffer.length > capacity) {
    buffer.shift();
  }

  notify(key);
}

/** Records the aria2-wide speeds. */
export function recordGlobalStat(sample: Omit<SpeedSample, 'time'>): void {
  recordStat(GLOBAL_STATS_KEY, sample);
}

/** Records a single task's speeds (task detail page). */
export function recordTaskStat(gid: string, sample: Omit<SpeedSample, 'time'>): void {
  recordStat(gid, sample);
}

/** The newest global sample, or `undefined` while nothing has been recorded. */
export function currentGlobalStat(): SpeedSample | undefined {
  const buffer = buffers.get(GLOBAL_STATS_KEY);
  return buffer && buffer.length > 0 ? buffer[buffer.length - 1] : undefined;
}

/** A copy of the ring, oldest first. */
export function getStats(key: 'global' | string): SpeedSample[] {
  return [...bufferFor(key)];
}

/** Drops every sample but keeps the key registered. */
export function resetStats(key: 'global' | string): void {
  buffers.set(key, []);
}

/**
 * Wipes the ring and refills it with a flat, zeroed baseline of
 * `statsCapacity(key)` samples — exactly what AriaNg's `initEmptyStats` did so
 * a freshly opened task chart renders as a straight line instead of a
 * single-pixel dot.
 */
export function getEmptyStats(key: 'global' | string): SpeedSample[] {
  const capacity = statsCapacity(key);
  const baseline: SpeedSample[] = [];
  for (let i = 0; i < capacity; i++) {
    baseline.push({ time: 0, downloadSpeed: 0, uploadSpeed: 0 });
  }
  buffers.set(key, baseline);
  notify(key);
  return [...baseline];
}

/** Called on every push so a chart can re-render without polling the store. */
export function subscribe(key: 'global' | string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);

  return () => {
    const current = listeners.get(key);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(key);
    }
  };
}

/**
 * Splits the ring into the parallel arrays echarts wants.
 *
 * `media` is only produced when at least one sample carries
 * `mediaDownloadedLength`; every array is always the same length as `times`.
 */
export function toChartSeries(key: 'global' | string): ChartSeries {
  const samples = bufferFor(key);

  const times: number[] = [];
  const download: number[] = [];
  const upload: number[] = [];
  const media: number[] = [];
  let hasMedia = false;

  for (const sample of samples) {
    times.push(sample.time);
    download.push(sample.downloadSpeed);
    upload.push(sample.uploadSpeed);
    if (sample.mediaDownloadedLength === undefined) {
      media.push(0);
    } else {
      hasMedia = true;
      media.push(sample.mediaDownloadedLength);
    }
  }

  return hasMedia ? { times, download, upload, media } : { times, download, upload };
}

/** Test helper: forgets every series *and* every listener. */
export function clearAllStats(): void {
  buffers.clear();
  listeners.clear();
}
