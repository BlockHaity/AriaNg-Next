/**
 * Port of AriaNg's `ariaNgLogService`.
 *
 * ## Two rules that must not be "improved"
 *
 * 1. **The console output is unconditional; the ring buffer is not.** AriaNg
 *    only cached an entry when debug mode was on, so a user who never enables
 *    it pays nothing and nothing accumulates. A crash in production still
 *    prints to the console.
 * 2. **`getDebugLogs()` returns `[]` while debug mode is off** — the debug page
 *    reads it, and AriaNg's guard is what keeps the buffer unreadable until
 *    the user opted in.
 *
 * The debug flag is read lazily through `useSettingsStore.getState()` on every
 * call rather than snapshotted at module load: the settings store is created by
 * another module and toggling debug mode must take effect immediately.
 */
import { APP_CONSTANTS } from '@/config/defaults';
import { useSettingsStore } from './settings';

/** `DEBUG:1 INFO:2 WARN:3 ERROR:4` — AriaNg's `logLevel` map. */
export const LogLevel = {
  Debug: 1,
  Info: 2,
  Warn: 3,
  Error: 4,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/** Display name used in the `[AriaNg DEBUG]` prefix. */
export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_NAMES: Record<LogLevel, LogLevelName> = {
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
};

export interface LogEntry {
  /** Monotonic per-session id; AriaNg used the insertion order only. */
  id: number;
  /** `Date.now()` at insertion. */
  time: number;
  level: LogLevel;
  content: string;
  /** AriaNg passed structured extras through untouched. */
  attachment?: unknown;
}

/** One emitted line, handed to a {@link LogSink}. */
export interface LogRecord {
  level: LogLevel;
  levelName: LogLevelName;
  /** The fully formatted `[AriaNg LEVEL] message` string. */
  message: string;
  /** The raw arguments the caller passed. */
  args: unknown[];
}

export type LogSink = (record: LogRecord) => void;

/** `APP_CONSTANTS.cachedDebugLogsLimit` (100). */
const LOG_LIMIT = APP_CONSTANTS.cachedDebugLogsLimit;

const ringBuffer: LogEntry[] = [];
const listeners = new Set<(logs: LogEntry[]) => void>();

let nextId = 1;
let sink: LogSink | null = null;

/**
 * Replaces the console destination. Pass `null` to go back to `console`.
 *
 * Intended for tests (assert on a captured array instead of spying on
 * `console`) and for the debug page, which can render the same lines it
 * already cached.
 */
export function setLogSink(fn: LogSink | null): void {
  sink = fn;
}

/** The currently installed sink, if any. */
export function getLogSink(): LogSink | null {
  return sink;
}

/** Lazily read so a mid-session `setSessionDebugMode` is picked up. */
function isDebugMode(): boolean {
  try {
    return useSettingsStore.getState().session.debugMode === true;
  } catch {
    return false;
  }
}

function emit(level: LogLevel, args: unknown[]): void {
  const levelName = LOG_LEVEL_NAMES[level];
  const message = `[AriaNg ${levelName}] ${args.map(stringifyArg).join(' ')}`;

  // Console output first and unconditionally.
  if (sink) {
    sink({ level, levelName, message, args });
  } else {
    /* eslint-disable no-console */
    const method =
      level === LogLevel.Error
        ? 'error'
        : level === LogLevel.Warn
          ? 'warn'
          : level === LogLevel.Info
            ? 'info'
            : 'log';
    const target = console as unknown as Record<string, ((...values: unknown[]) => void) | undefined>;
    (target[method] ?? console.log).call(console, message);
    /* eslint-enable no-console */
  }

  if (!isDebugMode()) return;

  ringBuffer.push({
    id: nextId,
    time: Date.now(),
    level,
    content: message,
  });
  nextId += 1;

  // Ring buffer: AriaNg kept the last `cachedDebugLogsLimit` entries.
  while (ringBuffer.length > LOG_LIMIT) {
    ringBuffer.shift();
  }

  for (const listener of [...listeners]) listener(ringBuffer);
}

/**
 * `String(arg)` for the console line, but objects/arrays get JSON so a nested
 * RPC response is readable in the console (AriaNg relied on the devtools
 * "expand on demand" behaviour of a raw object, which `TextEncoder`-based
 * string building cannot reproduce).
 */
function stringifyArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/* ------------------------------------------------------------------ */
/* emitters                                                            */
/* ------------------------------------------------------------------ */

export function debug(...args: unknown[]): void {
  emit(LogLevel.Debug, args);
}

export function info(...args: unknown[]): void {
  emit(LogLevel.Info, args);
}

export function warn(...args: unknown[]): void {
  emit(LogLevel.Warn, args);
}

export function error(...args: unknown[]): void {
  emit(LogLevel.Error, args);
}

/* ------------------------------------------------------------------ */
/* buffer                                                              */
/* ------------------------------------------------------------------ */

/**
 * The cached debug lines, newest last.
 *
 * `[]` unless debug mode is enabled — AriaNg's guard, which the debug page
 * relies on to show "debug mode is off" without asking the store itself.
 */
export function getDebugLogs(): LogEntry[] {
  if (!isDebugMode()) return [];
  return [...ringBuffer];
}

/** Empties the buffer and notifies the subscribers. */
export function clearDebugLogs(): void {
  ringBuffer.length = 0;
  for (const listener of [...listeners]) listener(ringBuffer);
}

/** `a - b`, so a plain numeric sort is AriaNg's level order. */
export function compareLogLevel(a: LogLevel, b: LogLevel): number {
  return a - b;
}

/** Keeps the entries at or above `minimum` (`>=`, not `>`). */
export function filterLogsByLevel(logs: LogEntry[], minimum: LogLevel): LogEntry[] {
  return logs.filter((entry) => compareLogLevel(entry.level, minimum) >= 0);
}

/**
 * Subscribes to buffer changes (append **and** clear).
 *
 * The listener receives the live buffer array — treat it as read-only, it is
 * replaced on every emit.
 */
export function subscribeLogs(listener: (logs: LogEntry[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ring buffer capacity, exported for the debug page ("100 / 100" counter). */
export const DEBUG_LOG_LIMIT = LOG_LIMIT;
