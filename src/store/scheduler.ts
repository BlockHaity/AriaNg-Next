/**
 * The single place where *every* periodic refresh of AriaNg-Next happens.
 *
 * The original AriaNg registered seven independent Angular `$interval`s
 * (`globalStatRefreshInterval`, `downloadTaskRefreshInterval`, the task-detail
 * ones, the title one, ...).  Each of them:
 *
 *   - fired on its own schedule, regardless of whether the previous tick had
 *     finished — a slow `tellStatus` over a flaky link therefore *stacked up*
 *     concurrent requests until the UI ground to a halt;
 *   - kept polling in a background tab, burning battery and hammering aria2 for
 *     data nobody is looking at;
 *   - had no way to be stopped while a modal dialog was open.
 *
 * This scheduler replaces all seven with one primitive that fixes each of those
 * problems: ticks never overlap, a task can be paused without being
 * unregistered, and the whole thing auto-suspends when the document is hidden
 * (opt-out via `allowHidden`).
 */

/** A periodic job. `intervalMs: 0` disables it — AriaNg's "Disabled" setting. */
export type SchedulerTask = {
  /** Stable id; also the key used by `pause` / `resume` / `updateInterval`. */
  id: string;
  /** Poll period in milliseconds. `0` (or anything `<= 0`) means disabled. */
  intervalMs: number;
  run: () => void | Promise<void>;
};

export interface Scheduler {
  /** Starts polling. Re-registering an existing id replaces it. Returns an unregister function. */
  register(task: SchedulerTask): () => void;
  /** Pause/resume a single task without unregistering it (e.g. while a modal is open). */
  pause(id: string): void;
  resume(id: string): void;
  /** Master switch; also auto-pauses when `document.hidden` unless `allowHidden`. */
  setSuspended(suspended: boolean): void;
  /**
   * Number of tasks currently registered *and* running (enabled, not paused,
   * not suspended) — drives the global busy indicator.
   */
  activeCount(): number;
  /** Tasks whose `run()` promise has not settled yet. */
  inFlightCount(): number;
  /** Hot-applies a new interval, e.g. after the user changed the setting. `0` disables. */
  updateInterval(id: string, intervalMs: number): void;
  isSuspended(): boolean;
  dispose(): void;
}

export interface SchedulerOptions {
  /**
   * Keep polling while the document is hidden.
   *
   * Intentional improvement over AriaNg: the original kept all seven intervals
   * running in background tabs. Set this to `true` for users who keep AriaNg
   * open in a second window and want live numbers there.
   */
  allowHidden?: boolean;
  /** Anything thrown (or rejected) by `run()` lands here. */
  onError?: (id: string, error: unknown) => void;
}

interface Entry {
  readonly task: SchedulerTask;
  /** Last interval requested through `register` / `updateInterval`. */
  intervalMs: number;
  /** Non-null exactly while the entry is being polled. */
  timer: ReturnType<typeof setInterval> | null;
  paused: boolean;
  /** True between "tick started" and "tick settled" — this is the no-overlap latch. */
  running: boolean;
}

function defaultOnError(id: string, error: unknown): void {
  // A rejected refresh must never take the app down; log it and keep polling.
  console.error(`[scheduler] task "${id}" failed`, error);
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const allowHidden = options.allowHidden === true;
  const onError = options.onError ?? defaultOnError;

  const entries = new Map<string, Entry>();
  let suspended = false;
  let disposed = false;
  let inFlight = 0;

  /**
   * `document` is touched lazily (never at module scope) because the store
   * modules are imported by node-side tests too.
   */
  const isHidden = (): boolean =>
    typeof document !== 'undefined' && typeof document.addEventListener === 'function'
      ? document.hidden === true
      : false;

  const isEffectivelySuspended = (): boolean => suspended || (!allowHidden && isHidden());

  const clearTimer = (entry: Entry): void => {
    if (entry.timer !== null) {
      clearInterval(entry.timer);
      entry.timer = null;
    }
  };

  const release = (entry: Entry): void => {
    if (!entry.running) {
      return;
    }
    entry.running = false;
    inFlight -= 1;
  };

  const tick = (entry: Entry): void => {
    if (disposed || entry.running || entry.paused || isEffectivelySuspended()) {
      return;
    }

    if (entry.intervalMs <= 0) {
      return;
    }

    // ------------------------------------------------------------------------
    // The whole point: AriaNg's `$interval` started a new call even when the
    // previous one was still pending.  A slow aria2 then accumulated an
    // unbounded number of in-flight `tellStatus` calls per tick.
    // ------------------------------------------------------------------------
    entry.running = true;
    inFlight += 1;

    let result: void | Promise<void>;
    try {
      result = entry.task.run();
    } catch (error) {
      release(entry);
      onError(entry.task.id, error);
      return;
    }

    if (isThenable(result)) {
      result.then(
        () => release(entry),
        (error: unknown) => {
          release(entry);
          onError(entry.task.id, error);
        },
      );
      return;
    }

    release(entry);
  };

  const sync = (entry: Entry): void => {
    const shouldRun =
      !disposed && !isEffectivelySuspended() && !entry.paused && entry.intervalMs > 0;

    if (!shouldRun) {
      clearTimer(entry);
      return;
    }

    if (entry.timer === null) {
      entry.timer = setInterval(tick, entry.intervalMs);
    }
  };

  const syncAll = (): void => {
    for (const entry of entries.values()) {
      sync(entry);
    }
  };

  /**
   * Background tabs do not need to poll aria2 at all. AriaNg kept doing it;
   * see `SchedulerOptions.allowHidden` for the opt-out.
   */
  const onVisibilityChange = (): void => {
    syncAll();
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    register(task: SchedulerTask): () => void {
      if (disposed) {
        return () => {};
      }

      const previous = entries.get(task.id);
      if (previous) {
        // Re-registering an id replaces the job; the stale unregister closure
        // must not be able to kill the new one.
        clearTimer(previous);
        entries.delete(task.id);
      }

      const entry: Entry = {
        task,
        intervalMs: Number.isFinite(task.intervalMs) ? Math.max(0, task.intervalMs) : 0,
        timer: null,
        paused: false,
        running: false,
      };

      entries.set(task.id, entry);
      sync(entry);

      return () => {
        if (entries.get(task.id) !== entry) {
          return;
        }
        clearTimer(entry);
        entries.delete(task.id);
      };
    },

    pause(id: string): void {
      const entry = entries.get(id);
      if (!entry || entry.paused) {
        return;
      }
      entry.paused = true;
      clearTimer(entry);
    },

    resume(id: string): void {
      const entry = entries.get(id);
      if (!entry || !entry.paused) {
        return;
      }
      entry.paused = false;
      sync(entry);
    },

    setSuspended(next: boolean): void {
      if (disposed || suspended === next) {
        return;
      }
      suspended = next;
      syncAll();
    },

    activeCount(): number {
      if (disposed || isEffectivelySuspended()) {
        return 0;
      }
      let count = 0;
      for (const entry of entries.values()) {
        if (entry.timer !== null && !entry.paused && entry.intervalMs > 0) {
          count += 1;
        }
      }
      return count;
    },

    inFlightCount(): number {
      return inFlight;
    },

    updateInterval(id: string, intervalMs: number): void {
      const entry = entries.get(id);
      if (!entry) {
        return;
      }
      const next = Number.isFinite(intervalMs) ? Math.max(0, intervalMs) : 0;
      if (entry.intervalMs === next) {
        return;
      }
      entry.intervalMs = next;
      // Restart so the new period takes effect immediately (hot-apply).
      clearTimer(entry);
      sync(entry);
    },

    isSuspended(): boolean {
      return isEffectivelySuspended();
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const entry of entries.values()) {
        clearTimer(entry);
        entry.paused = true;
      }
      entries.clear();
      inFlight = 0;

      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
  };
}

/**
 * The app-wide scheduler. Import this, never call `createScheduler()` yourself,
 * unless a test needs an isolated instance.
 */
export const scheduler: Scheduler = createScheduler();
