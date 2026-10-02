import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONSTANTS } from '@/config/defaults';
import {
  DEBUG_LOG_LIMIT,
  LogLevel,
  clearDebugLogs,
  compareLogLevel,
  debug,
  error,
  filterLogsByLevel,
  getDebugLogs,
  info,
  setLogSink,
  subscribeLogs,
  warn,
} from '../logs';
import type { LogEntry, LogRecord } from '../logs';
import { useSettingsStore } from '../settings';

const captured: LogRecord[] = [];

/** Debug mode is the gate on the ring buffer, exactly like AriaNg. */
function setDebugMode(enabled: boolean): void {
  useSettingsStore.getState().setSessionDebugMode(enabled);
}

function entry(level: LogLevel, content = ''): LogEntry {
  return { id: 0, time: 0, level, content };
}

beforeEach(() => {
  captured.length = 0;
  setLogSink((record) => captured.push(record));
  setDebugMode(false);
  clearDebugLogs();
});

afterEach(() => {
  setLogSink(null);
  setDebugMode(false);
  clearDebugLogs();
});

describe('LogLevel', () => {
  it('is AriaNg’s DEBUG:1 INFO:2 WARN:3 ERROR:4', () => {
    expect(LogLevel).toEqual({ Debug: 1, Info: 2, Warn: 3, Error: 4 });
  });

  it('compares numerically', () => {
    expect(compareLogLevel(LogLevel.Debug, LogLevel.Error)).toBeLessThan(0);
    expect(compareLogLevel(LogLevel.Error, LogLevel.Debug)).toBeGreaterThan(0);
    expect(compareLogLevel(LogLevel.Warn, LogLevel.Warn)).toBe(0);
  });
});

describe('console output', () => {
  it('is emitted even when debug mode is off', () => {
    setDebugMode(false);

    debug('d');
    info('i');
    warn('w');
    error('e');

    expect(captured.map((record) => record.levelName)).toEqual([
      'DEBUG',
      'INFO',
      'WARN',
      'ERROR',
    ]);
    expect(getDebugLogs()).toEqual([]);
  });

  it('prefixes every line with [AriaNg <LEVEL>]', () => {
    debug('hello');
    info('there');
    warn('careful');
    error('boom');

    expect(captured.map((record) => record.message)).toEqual([
      '[AriaNg DEBUG] hello',
      '[AriaNg INFO] there',
      '[AriaNg WARN] careful',
      '[AriaNg ERROR] boom',
    ]);
  });

  it('joins several arguments with a space and stringifies objects', () => {
    debug('gid', 42, { a: 1 });
    expect(captured[0].message).toBe('[AriaNg DEBUG] gid 42 {"a":1}');
    expect(captured[0].args).toEqual(['gid', 42, { a: 1 }]);
  });

  it('renders an Error with its stack', () => {
    error(new Error('kaputt'));
    expect(captured[0].message).toContain('kaputt');
  });
});

describe('ring buffer', () => {
  it('stays empty while debug mode is off', () => {
    info('a');
    info('b');
    expect(getDebugLogs()).toEqual([]);
  });

  it('collects entries as soon as debug mode is on', () => {
    setDebugMode(true);

    info('first');
    warn('second');

    const logs = getDebugLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ level: LogLevel.Info, content: '[AriaNg INFO] first' });
    expect(logs[1]).toMatchObject({ level: LogLevel.Warn, content: '[AriaNg WARN] second' });
    expect(logs[0].id).toBeLessThan(logs[1].id);
    expect(logs[0].time).toBeGreaterThan(0);
  });

  it('reads the flag on every call, so a toggle takes effect immediately', () => {
    info('before');
    setDebugMode(true);
    info('after');
    expect(getDebugLogs().map((log) => log.content)).toEqual(['[AriaNg INFO] after']);

    setDebugMode(false);
    expect(getDebugLogs()).toEqual([]);
  });

  it(`evicts the oldest entry beyond ${APP_CONSTANTS.cachedDebugLogsLimit}`, () => {
    setDebugMode(true);
    expect(DEBUG_LOG_LIMIT).toBe(100);

    for (let i = 0; i < 105; i += 1) info(`line ${i}`);

    const logs = getDebugLogs();
    expect(logs).toHaveLength(100);
    expect(logs[0].content).toBe('[AriaNg INFO] line 5');
    expect(logs[99].content).toBe('[AriaNg INFO] line 104');
  });

  it('hands out a copy, so a caller cannot corrupt the buffer', () => {
    setDebugMode(true);
    info('a');
    getDebugLogs().push(entry(LogLevel.Error, 'nope'));
    expect(getDebugLogs()).toHaveLength(1);
  });

  it('is emptied by clearDebugLogs', () => {
    setDebugMode(true);
    info('a');
    expect(getDebugLogs()).toHaveLength(1);

    clearDebugLogs();
    expect(getDebugLogs()).toEqual([]);
  });
});

describe('filterLogsByLevel', () => {
  const logs = [
    entry(LogLevel.Debug, 'd'),
    entry(LogLevel.Info, 'i'),
    entry(LogLevel.Warn, 'w'),
    entry(LogLevel.Error, 'e'),
  ];

  it('keeps level >= minimum (not >)', () => {
    expect(filterLogsByLevel(logs, LogLevel.Debug)).toHaveLength(4);
    expect(filterLogsByLevel(logs, LogLevel.Info).map((log) => log.content)).toEqual(['i', 'w', 'e']);
    expect(filterLogsByLevel(logs, LogLevel.Warn).map((log) => log.content)).toEqual(['w', 'e']);
    expect(filterLogsByLevel(logs, LogLevel.Error).map((log) => log.content)).toEqual(['e']);
  });

  it('returns an empty array for an empty input', () => {
    expect(filterLogsByLevel([], LogLevel.Debug)).toEqual([]);
  });

  it('filters the real buffer', () => {
    setDebugMode(true);
    debug('d');
    info('i');
    warn('w');
    error('e');

    expect(filterLogsByLevel(getDebugLogs(), LogLevel.Warn).map((log) => log.level)).toEqual([
      LogLevel.Warn,
      LogLevel.Error,
    ]);
  });
});

describe('subscribeLogs', () => {
  it('is notified on every append and on clear', () => {
    setDebugMode(true);
    const listener = vi.fn();
    const unsubscribe = subscribeLogs(listener);

    info('a');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveLength(1);

    warn('b');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0]).toHaveLength(2);

    clearDebugLogs();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[2][0]).toEqual([]);

    unsubscribe();
  });

  it('stops after unsubscribe', () => {
    setDebugMode(true);
    const listener = vi.fn();
    const unsubscribe = subscribeLogs(listener);

    info('a');
    unsubscribe();
    info('b');
    clearDebugLogs();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is not notified for entries that were never cached', () => {
    setDebugMode(false);
    const listener = vi.fn();
    const unsubscribe = subscribeLogs(listener);

    info('a');
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('supports several subscribers', () => {
    setDebugMode(true);
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeLogs(first);
    const offSecond = subscribeLogs(second);

    error('boom');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    offSecond();
  });
});
