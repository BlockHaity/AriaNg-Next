import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKey } from '@/config/types';
import type * as NotificationsModule from '../notifications';
import type * as SettingsModule from '../settings';

/** Minimal in-memory `Storage`. */
class FakeStorage {
  readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

/** Records every constructed notification. */
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
  static instances: FakeNotification[] = [];

  constructor(
    readonly title: string,
    readonly options: NotificationOptions = {},
  ) {
    FakeNotification.instances.push(this);
  }

  close(): void {}
}

const NOW = Date.parse('2026-01-01T00:00:00Z');
const SECOND = 1000;

let local: FakeStorage;
let notifications: typeof NotificationsModule;
let settings: typeof SettingsModule;

/** Writes the `AriaNg.Notifications` array straight into the stubbed storage. */
function writeHistory(epochSeconds: number[]): void {
  local.setItem(
    StorageKey.Notifications,
    JSON.stringify(epochSeconds.map((seconds) => ({ time: String(seconds) }))),
  );
}

function readHistoryRaw(): unknown {
  const raw = local.getItem(StorageKey.Notifications);
  return raw === null ? null : JSON.parse(raw);
}

/** Arms the browser-notification path: API present, granted, setting on, ws on. */
function armBrowserNotifications(): void {
  notifications.setNotificationsTransport('websocket');
  settings.useSettingsStore.getState().set('browserNotification', true);
}

beforeEach(async () => {
  local = new FakeStorage();
  FakeNotification.instances = [];
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');

  vi.stubGlobal('localStorage', local as unknown as Storage);
  vi.stubGlobal('Notification', FakeNotification);
  vi.resetModules();

  notifications = await import('../notifications');
  settings = await import('../settings');
  // Fresh defaults for every test: `browserNotification` is false, frequency
  // is `unlimited`.
  settings.useSettingsStore.getState().reset();
  settings.flushSettingsPersist();
});

afterEach(() => {
  notifications.setNotificationsTransport('http');
  notifications.clearInPage();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe('in-page queue', () => {
  it('emits on every notify and dismisses by id', () => {
    const listener = vi.fn();
    const unsubscribe = notifications.subscribeInPage(listener);

    notifications.notifyInPage({ title: 'a' });
    notifications.notifyInPage({ title: 'b', type: 'error' });

    expect(listener).toHaveBeenCalledTimes(2);

    const [first, second] = notifications.getInPageNotices();
    expect(first).toMatchObject({ id: 1, title: 'a', type: 'info', delay: 2000 });
    expect(second).toMatchObject({ id: 2, title: 'b', type: 'error' });

    notifications.dismissInPage(first.id);
    expect(notifications.getInPageNotices().map((notice) => notice.title)).toEqual(['b']);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[2][0]).toHaveLength(1);

    unsubscribe();
    notifications.notifyInPage({ title: 'c' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('carries the options AriaNg passed to $mdToast', () => {
    const onClose = vi.fn();
    notifications.notifyInPage({
      title: 'Reload',
      content: 'The language resource has been updated.',
      type: 'warning',
      delay: 0,
      positionY: 'top',
      contentPrefix: 'langs/',
      reloadAction: true,
      onClose,
    });

    const [notice] = notifications.getInPageNotices();
    expect(notice).toMatchObject({
      title: 'Reload',
      content: 'The language resource has been updated.',
      type: 'warning',
      delay: 0,
      positionY: 'top',
      contentPrefix: 'langs/',
      reloadAction: true,
    });

    notifications.dismissInPage(notice.id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after the delay', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onClose = vi.fn();

    notifications.notifyInPage({ title: 'toast', delay: 2000, onClose });
    expect(notifications.getInPageNotices()).toHaveLength(1);

    vi.advanceTimersByTime(1999);
    expect(notifications.getInPageNotices()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(notifications.getInPageNotices()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a sticky notice (delay 0) until it is dismissed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    notifications.notifyInPage({ title: 'sticky', delay: 0 });
    vi.advanceTimersByTime(60_000);
    expect(notifications.getInPageNotices()).toHaveLength(1);
  });

  it('ignores an unknown id and clears the whole stack', () => {
    const onClose = vi.fn();
    notifications.notifyInPage({ title: 'a', onClose });

    expect(() => notifications.dismissInPage(999)).not.toThrow();
    expect(notifications.getInPageNotices()).toHaveLength(1);

    notifications.clearInPage();
    expect(notifications.getInPageNotices()).toEqual([]);
    // clearInPage does not fire onClose: the user did not dismiss it.
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */

describe('isReachBrowserNotificationFrequencyLimit', () => {
  const now = Math.round(NOW / SECOND);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('unlimited is never limited', () => {
    writeHistory(Array.from({ length: 10 }, (_, i) => now - i));
    expect(notifications.isReachBrowserNotificationFrequencyLimit('unlimited')).toBe(false);
  });

  it('high allows at most 10 per minute', () => {
    writeHistory(Array.from({ length: 9 }, (_, i) => now - i));
    expect(notifications.isReachBrowserNotificationFrequencyLimit('high')).toBe(false);

    writeHistory(Array.from({ length: 10 }, (_, i) => now - i));
    expect(notifications.isReachBrowserNotificationFrequencyLimit('high')).toBe(true);

    // The tenth entry is a minute old -> outside the window.
    writeHistory(Array.from({ length: 10 }, (_, i) => now - i * 10));
    expect(notifications.isReachBrowserNotificationFrequencyLimit('high')).toBe(false);
  });

  it('middle allows one per minute', () => {
    writeHistory([]);
    expect(notifications.isReachBrowserNotificationFrequencyLimit('middle')).toBe(false);

    writeHistory([now]);
    expect(notifications.isReachBrowserNotificationFrequencyLimit('middle')).toBe(true);

    writeHistory([now - 60]);
    expect(notifications.isReachBrowserNotificationFrequencyLimit('middle')).toBe(false);
  });

  it('low allows one per five minutes', () => {
    writeHistory([]);
    expect(notifications.isReachBrowserNotificationFrequencyLimit('low')).toBe(false);

    writeHistory([now]);
    expect(notifications.isReachBrowserNotificationFrequencyLimit('low')).toBe(true);

    writeHistory([now - 60]);
    expect(notifications.isReachBrowserNotificationFrequencyLimit('low')).toBe(true);

    writeHistory([now - 301]);
    expect(notifications.isReachBrowserNotificationFrequencyLimit('low')).toBe(false);
  });

  it('treats an empty, missing or malformed history as "no notifications yet"', () => {
    expect(notifications.isReachBrowserNotificationFrequencyLimit('high')).toBe(false);

    writeHistory([now]);
    local.setItem(StorageKey.Notifications, JSON.stringify('not an array'));
    expect(notifications.isReachBrowserNotificationFrequencyLimit('middle')).toBe(false);

    writeHistory([now]);
    local.setItem(
      StorageKey.Notifications,
      JSON.stringify([{ time: 'nope' }, null, { time: 12345 }]),
    );
    expect(notifications.isReachBrowserNotificationFrequencyLimit('middle')).toBe(false);
  });
});

describe('notification history', () => {
  const now = Math.round(NOW / SECOND);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('appends the current unix second as a string, newest first', () => {
    notifications.recordBrowserNotificationHistory();
    expect(readHistoryRaw()).toEqual([{ time: String(now) }]);
  });

  it('keeps at most the ten most recent entries', () => {
    writeHistory(Array.from({ length: 10 }, (_, i) => now - 100 - i));
    notifications.recordBrowserNotificationHistory();

    const history = notifications.getBrowserNotificationHistory();
    expect(history).toHaveLength(10);
    expect(history[0].time).toBe(String(now));
    expect(history[9].time).toBe(String(now - 108));
  });

  it('reads at most ten entries back, whatever is in storage', () => {
    writeHistory(Array.from({ length: 25 }, (_, i) => now - i));
    expect(notifications.getBrowserNotificationHistory()).toHaveLength(10);
  });
});

/* ------------------------------------------------------------------ */

describe('browser notifications', () => {
  it('reports support from the presence of the Notification API', () => {
    expect(notifications.isBrowserNotificationSupported()).toBe(true);

    vi.stubGlobal('Notification', undefined);
    expect(notifications.isBrowserNotificationSupported()).toBe(false);
  });

  it('defaults to the http transport, which cannot push', () => {
    // The setting is on and the permission granted, but the RPC store has not
    // reported a websocket transport yet.
    expect(notifications.getNotificationsTransport()).toBe('http');
    settings.useSettingsStore.getState().set('browserNotification', true);

    notifications.notifyTaskComplete('2089b05ecca3d829', 'ubuntu.iso');
    expect(FakeNotification.instances).toHaveLength(0);

    // Even an explicit http transport keeps it silent.
    notifications.setNotificationsTransport('http');
    notifications.notifyTaskComplete('2089b05ecca3d829', 'ubuntu.iso');
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('fires over the websocket transport', () => {
    armBrowserNotifications();

    notifications.notifyTaskComplete('2089b05ecca3d829', 'ubuntu.iso');
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe('Download Completed');
    expect(FakeNotification.instances[0].options.body).toBe('ubuntu.iso');
    expect(FakeNotification.instances[0].options.tag).toBe('2089b05ecca3d829');
  });

  it('stays quiet when the setting is off or permission was not granted', () => {
    notifications.setNotificationsTransport('websocket');

    // Setting off.
    notifications.notifyTaskComplete('gid', 'a');
    expect(FakeNotification.instances).toHaveLength(0);

    // Permission not granted.
    armBrowserNotifications();
    FakeNotification.permission = 'denied';
    notifications.notifyTaskComplete('gid', 'a');
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('uses the translated title for the bt and error notices', () => {
    armBrowserNotifications();

    notifications.notifyBtTaskComplete('gid-bt', 'debian.iso.torrent');
    notifications.notifyTaskError('gid-err', 'broken.iso', 'No URI available');

    expect(FakeNotification.instances.map((instance) => instance.title)).toEqual([
      'BT Download Completed',
      'Download Error',
    ]);
    expect(FakeNotification.instances[1].options.body).toBe('broken.iso: No URI available');
  });

  it('respects browserNotificationSound', () => {
    armBrowserNotifications();

    notifications.notifyTaskComplete('gid-1', 'a');
    expect(FakeNotification.instances[0].options.silent).toBe(false);

    settings.useSettingsStore.getState().set('browserNotificationSound', false);
    notifications.notifyTaskComplete('gid-2', 'b');
    expect(FakeNotification.instances[1].options.silent).toBe(true);
  });

  it('honours the frequency limit of the current setting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    armBrowserNotifications();
    settings.useSettingsStore.getState().set('browserNotificationFrequency', 'middle');

    notifications.notifyTaskComplete('gid-1', 'a');
    expect(FakeNotification.instances).toHaveLength(1);

    // The first one already filled the one-per-minute budget.
    notifications.notifyTaskComplete('gid-2', 'b');
    expect(FakeNotification.instances).toHaveLength(1);
    expect(notifications.getBrowserNotificationHistory()).toHaveLength(1);

    vi.setSystemTime(NOW + 60_000);
    notifications.notifyTaskComplete('gid-3', 'c');
    expect(FakeNotification.instances).toHaveLength(2);
  });

  it('records the history even when notifyViaBrowser is given a custom body', () => {
    armBrowserNotifications();
    notifications.notifyViaBrowser({ title: 'custom', content: 'body', silent: true });

    expect(FakeNotification.instances[0]).toMatchObject({
      title: 'custom',
      options: { body: 'body', silent: true },
    });
    expect(notifications.getBrowserNotificationHistory()).toHaveLength(1);
  });
});

describe('requestBrowserPermission', () => {
  it('resolves with the granted permission and keeps the setting on', async () => {
    settings.useSettingsStore.getState().set('browserNotification', true);

    await expect(notifications.requestBrowserPermission()).resolves.toBe('granted');
    expect(settings.useSettingsStore.getState().get('browserNotification')).toBe(true);
  });

  it('turns the browserNotification setting off when denied (AriaNg behaviour)', async () => {
    FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'denied');
    settings.useSettingsStore.getState().set('browserNotification', true);
    expect(settings.useSettingsStore.getState().get('browserNotification')).toBe(true);

    await expect(notifications.requestBrowserPermission()).resolves.toBe('denied');
    expect(settings.useSettingsStore.getState().get('browserNotification')).toBe(false);
  });

  it('leaves the setting alone for "default"', async () => {
    FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'default');
    settings.useSettingsStore.getState().set('browserNotification', true);

    await expect(notifications.requestBrowserPermission()).resolves.toBe('default');
    expect(settings.useSettingsStore.getState().get('browserNotification')).toBe(true);
  });

  it('resolves "denied" when the API is missing at all', async () => {
    vi.stubGlobal('Notification', undefined);

    await expect(notifications.requestBrowserPermission()).resolves.toBe('denied');
  });

  it('treats a throwing requestPermission as denied', async () => {
    FakeNotification.requestPermission = vi.fn(() => {
      throw new Error('nope');
    }) as unknown as typeof FakeNotification.requestPermission;

    await expect(notifications.requestBrowserPermission()).resolves.toBe('denied');
  });
});

/* ------------------------------------------------------------------ */

describe('setNotificationsTransport', () => {
  it('maps anything that is not websocket to http', () => {
    notifications.setNotificationsTransport('websocket');
    expect(notifications.getNotificationsTransport()).toBe('websocket');

    notifications.setNotificationsTransport('http');
    expect(notifications.getNotificationsTransport()).toBe('http');

    notifications.setNotificationsTransport('ftp' as unknown as 'http');
    expect(notifications.getNotificationsTransport()).toBe('http');
  });
});

describe('extras', () => {
  it('never throws when Notification cannot be constructed', () => {
    armBrowserNotifications();
    FakeNotification.permission = 'granted';
    const broken = function BrokenNotification() {
      throw new TypeError('Illegal constructor');
    } as unknown as typeof Notification;
    vi.stubGlobal('Notification', broken);

    expect(() => notifications.notifyTaskComplete('gid', 'a')).not.toThrow();
  });

  it('exports the history limit AriaNg used', () => {
    expect(notifications.NOTIFICATION_HISTORY_LIMIT).toBe(10);
  });
});
