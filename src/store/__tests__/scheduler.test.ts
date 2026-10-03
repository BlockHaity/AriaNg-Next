/**
 * Scheduler tests.
 *
 * The scheduler drives *every* periodic refresh in the app, and it had no tests at
 * all — which is how `setInterval(tick, entry.intervalMs)` survived. `setInterval`
 * invokes its callback with no arguments, so `tick` received `undefined` and the
 * first tick of every poll threw inside the interval callback:
 *
 *     TypeError: Cannot read properties of undefined (reading 'running')
 *
 * These tests therefore let real timers fire rather than only inspecting the
 * scheduler's shape, because the bug lived entirely in how the timer was wired.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../scheduler';

import type { Scheduler } from '../scheduler';

const INTERVAL = 20;

let scheduler: Scheduler | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  scheduler = null;
});

afterEach(() => {
  scheduler?.dispose();
  scheduler = null;
  vi.useRealTimers();
});

function make(overrides: Partial<Parameters<typeof createScheduler>[0]> = {}): Scheduler {
  scheduler = createScheduler({ onError: () => {}, ...overrides });
  return scheduler;
}

describe('createScheduler — the timer actually fires the task', () => {
  it('runs a task when its interval elapses', () => {
    const run = vi.fn();
    make().register({ id: 'stat', intervalMs: INTERVAL, run });

    vi.advanceTimersByTime(INTERVAL * 3);

    // The regression: with `setInterval(tick, ms)` this threw on the first tick
    // instead of running the task, and nothing in the test suite noticed.
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('runs a task registered after the scheduler already exists', () => {
    const s = make();
    const run = vi.fn();

    s.register({ id: 'later', intervalMs: INTERVAL, run });
    vi.advanceTimersByTime(INTERVAL);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps each task pointed at its own entry', () => {
    // Two tasks, different periods: passing `tick` unbound would have made the
    // interval's own id irrelevant and both would read the same (undefined) entry.
    const slow = vi.fn();
    const fast = vi.fn();
    const s = make();

    s.register({ id: 'slow', intervalMs: 100, run: slow });
    s.register({ id: 'fast', intervalMs: 20, run: fast });

    vi.advanceTimersByTime(100);

    expect(fast).toHaveBeenCalledTimes(5);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('stops firing after unregister', () => {
    const run = vi.fn();
    const stop = make().register({ id: 'stat', intervalMs: INTERVAL, run });

    vi.advanceTimersByTime(INTERVAL * 2);
    stop();
    vi.advanceTimersByTime(INTERVAL * 5);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not throw when the document is visible', () => {
    const onError = vi.fn();
    make({ onError }).register({ id: 'stat', intervalMs: INTERVAL, run: () => {} });

    expect(() => vi.advanceTimersByTime(INTERVAL * 3)).not.toThrow();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('createScheduler — overlapping runs are prevented', () => {
  it('skips a tick while the previous run is still pending', async () => {
    const box: { resolve?: () => void } = {};
    const run = vi.fn(() => new Promise<void>((r) => { box.resolve = r; }));
    const s = make();
    s.register({ id: 'slow', intervalMs: INTERVAL, run });

    vi.advanceTimersByTime(INTERVAL * 5);
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.inFlightCount()).toBe(1);

    box.resolve?.();
    // The release runs in a `.then`, so the microtask has to drain before the next
    // interval is allowed to start a run.
    await vi.runAllTicks();
    vi.advanceTimersByTime(INTERVAL);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a synchronous throw through onError and keeps polling', () => {
    const onError = vi.fn();
    const run = vi.fn(() => {
      throw new Error('boom');
    });
    make({ onError }).register({ id: 'bad', intervalMs: INTERVAL, run });

    vi.advanceTimersByTime(INTERVAL * 2);

    expect(onError).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a rejection through onError', async () => {
    const onError = vi.fn();
    make({ onError }).register({
      id: 'bad',
      intervalMs: INTERVAL,
      run: () => Promise.reject(new Error('nope')),
    });

    vi.advanceTimersByTime(INTERVAL);
    await vi.runAllTicks();

    expect(onError).toHaveBeenCalled();
  });
});

describe('createScheduler — interval changes', () => {
  it('does not run a task with interval 0', () => {
    const run = vi.fn();
    make().register({ id: 'off', intervalMs: 0, run });

    vi.advanceTimersByTime(INTERVAL * 10);

    expect(run).not.toHaveBeenCalled();
  });

  it('applies a new interval immediately', () => {
    const run = vi.fn();
    const s = make();
    s.register({ id: 'stat', intervalMs: 1000, run });

    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);

    s.updateInterval('stat', INTERVAL);
    vi.advanceTimersByTime(INTERVAL * 2);

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('stops a task when its interval drops to 0', () => {
    const run = vi.fn();
    const s = make();
    s.register({ id: 'stat', intervalMs: INTERVAL, run });

    s.updateInterval('stat', 0);
    vi.advanceTimersByTime(INTERVAL * 5);

    expect(run).not.toHaveBeenCalled();
  });
});

describe('createScheduler — pause, resume and replacement', () => {
  it('pauses and resumes without unregistering', () => {
    const run = vi.fn();
    const s = make();
    s.register({ id: 'stat', intervalMs: INTERVAL, run });

    s.pause('stat');
    vi.advanceTimersByTime(INTERVAL * 3);
    expect(run).not.toHaveBeenCalled();

    s.resume('stat');
    vi.advanceTimersByTime(INTERVAL);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('replaces a task registered twice under one id', () => {
    const first = vi.fn();
    const second = vi.fn();
    const s = make();

    s.register({ id: 'stat', intervalMs: INTERVAL, run: first });
    s.register({ id: 'stat', intervalMs: INTERVAL, run: second });

    vi.advanceTimersByTime(INTERVAL * 2);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale unregister closure kill the replacement', () => {
    const s = make();
    const stopFirst = s.register({ id: 'stat', intervalMs: INTERVAL, run: vi.fn() });
    const second = vi.fn();
    s.register({ id: 'stat', intervalMs: INTERVAL, run: second });

    stopFirst();
    vi.advanceTimersByTime(INTERVAL);

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('createScheduler — counting and lifetime', () => {
  it('counts only enabled, unpaused, unsuspended tasks', () => {
    const s = make();
    s.register({ id: 'a', intervalMs: INTERVAL, run: vi.fn() });
    s.register({ id: 'b', intervalMs: INTERVAL, run: vi.fn() });
    s.register({ id: 'c', intervalMs: 0, run: vi.fn() });

    expect(s.activeCount()).toBe(2);

    s.pause('a');
    expect(s.activeCount()).toBe(1);

    s.resume('a');
    s.setSuspended(true);
    expect(s.activeCount()).toBe(0);
  });

  it('counts tasks with a run still in flight', () => {
    const box: { resolve?: () => void } = {};
    const s = make();
    s.register({ id: 'slow', intervalMs: INTERVAL, run: () => new Promise<void>((r) => { box.resolve = r; }) });

    expect(s.inFlightCount()).toBe(0);
    vi.advanceTimersByTime(INTERVAL);
    expect(s.inFlightCount()).toBe(1);

    box.resolve?.();
    void Promise.resolve().then(() => {
      expect(s.inFlightCount()).toBe(0);
    });
  });

  it('stops everything on dispose', () => {
    const run = vi.fn();
    const s = make();
    s.register({ id: 'stat', intervalMs: INTERVAL, run });

    s.dispose();
    vi.advanceTimersByTime(INTERVAL * 5);

    // `dispose()` clears the registry and stops every timer, so nothing counts as
    // active and nothing fires. It is a separate state from `setSuspended(true)`:
    // the master switch can be turned back off again, a disposed scheduler cannot be
    // revived.
    expect(run).not.toHaveBeenCalled();
    expect(s.activeCount()).toBe(0);
    expect(s.inFlightCount()).toBe(0);
  });

  it('returns an inert unregister function after dispose', () => {
    const s = make();
    s.dispose();
    expect(() => s.register({ id: 'x', intervalMs: INTERVAL, run: vi.fn() })()).not.toThrow();
  });
});