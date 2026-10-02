/**
 * Port of AriaNg's `ariaNgNotificationService`.
 *
 * AriaNg had **two** services with the same name and they are genuinely
 * different APIs, so both are kept:
 *
 * 1. {@link notifyInPage} — the in-page toast. AriaNg implemented it with
 *    `$mdToast`; here it is a tiny subscribe-able queue ({@link InPageNotice})
 *    that the UI layer renders as an mdui snackbar stack. This module
 *    deliberately imports **no UI component**: the snackbar host lives in
 *    `src/ui/`.
 * 2. {@link notifyViaBrowser} and friends — the browser `Notification` API.
 *
 * ## Why browser notifications are transport-gated
 *
 * The task-complete / task-error notices are driven by aria2's
 * `onDownloadComplete` / `onDownloadError` **push** messages, which only exist
 * over a WebSocket. Over plain HTTP there is no push channel at all, so AriaNg
 * could not fire them and neither can this app. {@link setNotificationsTransport}
 * is how `store/rpc-store.ts` tells this module which transport is live; the
 * default is `'http'`, i.e. suppressed, so a notification can never be fired
 * before the transport is known.
 *
 * ## Frequency limiter
 *
 * Reads/writes the `AriaNg.Notifications` key: a JSON array of
 * `{ time: "<unix seconds as a string>" }`, newest last, capped at
 * {@link NOTIFICATION_HISTORY_LIMIT} (10) entries — AriaNg's `unshift` +
 * `splice` pair, which means only the ten most recent notifications can ever
 * influence the limit.
 */
import { APP_CONSTANTS } from '@/config/defaults';
import { StorageKey } from '@/config/types';
import type { NotificationFrequency } from '@/config/types';
import { i18n } from '@/i18n';
import { storageGet, storageSet } from './storage';
import { useSettingsStore } from './settings';

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export type InPageType = 'primary' | 'success' | 'error' | 'info' | 'warning' | 'progress';

export interface NotifyInPageOptions {
  title: string;
  content?: string;
  type?: InPageType;
  /** Auto-dismiss delay in ms; `0` keeps the toast until it is closed. */
  delay?: number;
  positionY?: 'top' | 'bottom';
  onClose?: () => void;
  /** Rendered as a code-ish line above `content` (used for error payloads). */
  contentPrefix?: string;
  /** Renders a "Reload" action; used for the "language resource updated" notice. */
  reloadAction?: boolean;
}

/**
 * One queued toast.
 *
 * `id` is what {@link dismissInPage} takes; it is monotonic per session, so a
 * re-render can never dismiss a newer toast by accident.
 */
export interface InPageNotice {
  id: number;
  title: string;
  content?: string;
  type: InPageType;
  delay: number;
  positionY?: 'top' | 'bottom';
  contentPrefix?: string;
  reloadAction?: boolean;
  onClose?: () => void;
}

export interface BrowserNotificationOptions {
  title: string;
  content: string;
  /** `true` = mute; wired to `!settings.browserNotificationSound`. */
  silent?: boolean;
}

/** One entry of the `AriaNg.Notifications` array. */
export interface BrowserNotificationRecord {
  /** Unix **seconds**, kept as a string exactly like AriaNg stored it. */
  time: string;
}

export type NotificationsTransport = 'websocket' | 'http';

/* ------------------------------------------------------------------ */
/* transport gate                                                      */
/* ------------------------------------------------------------------ */

let transport: NotificationsTransport = 'http';

/**
 * Tells the notification service which RPC transport is live.
 *
 * Defaults to `'http'` (suppressed) — the RPC store calls this on every
 * connect / profile switch.
 */
export function setNotificationsTransport(kind: NotificationsTransport): void {
  transport = kind === 'websocket' ? 'websocket' : 'http';
}

/** The transport the limiter currently believes is in use. */
export function getNotificationsTransport(): NotificationsTransport {
  return transport;
}

/* ------------------------------------------------------------------ */
/* in-page toast queue                                                 */
/* ------------------------------------------------------------------ */

const inPageNotices: InPageNotice[] = [];
const inPageListeners = new Set<(entries: InPageNotice[]) => void>();
const inPageTimers = new Map<number, ReturnType<typeof setTimeout>>();

let nextNoticeId = 1;

function emitInPage(): void {
  // A fresh array so a `useSyncExternalStore` snapshot never compares equal
  // to the previous one.
  const snapshot = [...inPageNotices];
  for (const listener of [...inPageListeners]) listener(snapshot);
}

/** Subscribes to the toast stack; returns the unsubscribe function. */
export function subscribeInPage(listener: (entries: InPageNotice[]) => void): () => void {
  inPageListeners.add(listener);
  return () => {
    inPageListeners.delete(listener);
  };
}

/** The current stack, oldest first. */
export function getInPageNotices(): InPageNotice[] {
  return [...inPageNotices];
}

/** Removes one toast by id and fires its `onClose`. Idempotent. */
export function dismissInPage(id: number): void {
  const index = inPageNotices.findIndex((notice) => notice.id === id);
  if (index < 0) return;

  const [removed] = inPageNotices.splice(index, 1);
  const timer = inPageTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    inPageTimers.delete(id);
  }
  emitInPage();
  removed?.onClose?.();
}

/** Empties the whole stack (used by the "clear all" action and on teardown). */
export function clearInPage(): void {
  for (const timer of inPageTimers.values()) clearTimeout(timer);
  inPageTimers.clear();
  inPageNotices.length = 0;
  emitInPage();
}

/**
 * Queues an in-page toast.
 *
 * `delay` defaults to `APP_CONSTANTS.notificationInPageTimeout` (2000 ms) and
 * `0` means "sticky" — that is how the needs-reload notice stays up until the
 * user acts on its Reload button.
 */
export function notifyInPage(options: NotifyInPageOptions): void {
  const {
    title,
    content,
    type = 'info',
    delay = APP_CONSTANTS.notificationInPageTimeout,
    positionY = 'bottom',
    onClose,
    contentPrefix,
    reloadAction = false,
  } = options;

  const notice: InPageNotice = {
    id: nextNoticeId,
    title,
    type,
    delay,
    positionY,
  };
  nextNoticeId += 1;

  if (content !== undefined) notice.content = content;
  if (contentPrefix !== undefined) notice.contentPrefix = contentPrefix;
  if (reloadAction) notice.reloadAction = true;
  if (onClose) notice.onClose = onClose;

  inPageNotices.push(notice);
  emitInPage();

  if (delay > 0) {
    inPageTimers.set(
      notice.id,
      setTimeout(() => {
        inPageTimers.delete(notice.id);
        dismissInPage(notice.id);
      }, delay),
    );
  }
}

/* ------------------------------------------------------------------ */
/* browser Notification API                                            */
/* ------------------------------------------------------------------ */

function getNotificationCtor(): typeof Notification | null {
  return typeof Notification === 'undefined' ? null : Notification;
}

/** Whether this browser exposes the Notification API at all. */
export function isBrowserNotificationSupported(): boolean {
  return getNotificationCtor() !== null;
}

/**
 * Asks for permission.
 *
 * On `denied` AriaNg switched the `browserNotification` setting **off** so the
 * checkbox in the settings page cannot keep claiming that notifications are
 * enabled. That is reproduced here (`set('browserNotification', false)`) and
 * the comment is intentional: the write is a settings change, not a UI detail,
 * and it must happen even though the user never touched the checkbox again.
 */
export async function requestBrowserPermission(): Promise<NotificationPermission> {
  const ctor = getNotificationCtor();
  if (!ctor) return 'denied';

  let permission: NotificationPermission;
  try {
    // The promise form is the only one in current browsers; the legacy callback
    // signature is kept as a fallback for old WebKit builds.
    if (typeof ctor.requestPermission === 'function') {
      permission = await ctor.requestPermission();
    } else {
      permission = 'default';
    }
  } catch {
    permission = 'denied';
  }

  if (permission === 'denied') {
    useSettingsStore.getState().set('browserNotification', false);
  }

  return permission;
}

/* ------------------------------------------------------------------ */
/* frequency limiter                                                   */
/* ------------------------------------------------------------------ */

/**
 * How many notifications are remembered.
 *
 * AriaNg `unshift`ed the new entry and then `splice(10, …)`d the tail, so only
 * the ten most recent can ever be looked at.
 */
export const NOTIFICATION_HISTORY_LIMIT = 10;

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Window + cap per `browserNotificationFrequency`. */
const FREQUENCY_RULES: Record<NotificationFrequency, { windowMs: number; max: number }> = {
  /** No limit at all. */
  unlimited: { windowMs: 0, max: Number.POSITIVE_INFINITY },
  /** At most 10 per minute. */
  high: { windowMs: MINUTE, max: 10 },
  /** At most 1 per minute. */
  middle: { windowMs: MINUTE, max: 1 },
  /** At most 1 per 5 minutes. */
  low: { windowMs: 5 * MINUTE, max: 1 },
};

/** The ten most recent notification timestamps, oldest first. */
export function getBrowserNotificationHistory(): BrowserNotificationRecord[] {
  const stored = storageGet<unknown>(StorageKey.Notifications, []);
  if (!Array.isArray(stored)) return [];

  return stored
    .filter(
      (entry): entry is BrowserNotificationRecord =>
        !!entry && typeof entry === 'object' && typeof (entry as { time?: unknown }).time === 'string',
    )
    .slice(0, NOTIFICATION_HISTORY_LIMIT);
}

/** Appends "now" and drops everything past the tenth entry. */
export function recordBrowserNotificationHistory(): void {
  const history = getBrowserNotificationHistory();
  const now = Math.round(Date.now() / SECOND).toString();

  history.unshift({ time: now });
  history.splice(NOTIFICATION_HISTORY_LIMIT, history.length);

  storageSet(StorageKey.Notifications, history);
}

/**
 * Whether the limit for `frequency` is already reached.
 *
 * The history is read from storage on every call (AriaNg did the same — it is
 * shared between the websocket-driven events and the settings page) and only
 * the entries inside the rule's window are counted.
 */
export function isReachBrowserNotificationFrequencyLimit(frequency: NotificationFrequency): boolean {
  const rule = FREQUENCY_RULES[frequency] ?? FREQUENCY_RULES.unlimited;
  if (rule.max === Number.POSITIVE_INFINITY) return false;

  const now = Date.now();
  let count = 0;

  for (const entry of getBrowserNotificationHistory()) {
    const seconds = Number.parseInt(entry.time, 10);
    if (!Number.isFinite(seconds)) continue;

    const age = now - seconds * SECOND;
    if (age < 0 || age >= rule.windowMs) continue;

    count += 1;
    if (count >= rule.max) return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* firing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything a browser notification has to satisfy, in order:
 * the API exists, the user granted permission, the setting is on, the transport
 * can actually push, the frequency limit is not reached.
 *
 * Returns `true` when the notification was constructed.
 */
function canNotify(): boolean {
  const ctor = getNotificationCtor();
  if (!ctor) return false;

  // AriaNg's constraint: the completion events only arrive over a websocket.
  if (transport !== 'websocket') return false;

  try {
    if (ctor.permission !== 'granted') return false;
  } catch {
    return false;
  }

  const settings = useSettingsStore.getState().settings;
  if (settings.browserNotification !== true) return false;
  if (isReachBrowserNotificationFrequencyLimit(settings.browserNotificationFrequency)) return false;

  return true;
}

/**
 * Constructs and shows one notification, after the frequency history has been
 * recorded — a throwing constructor (Firefox without a service worker throws)
 * must not be usable to spam past the limit.
 */
function fire(title: string, body: string, tag: string | undefined, silent: boolean): void {
  const ctor = getNotificationCtor();
  if (!ctor) return;

  recordBrowserNotificationHistory();

  try {
    // `browserNotificationSound` off => mute.
    const options: NotificationOptions = {
      body,
      silent: silent || useSettingsStore.getState().settings.browserNotificationSound !== true,
    };
    if (tag) options.tag = tag;

    new ctor(title, options);
  } catch {
    // Nothing to do: the in-page toast still covers the event.
  }
}

/** Low-level entry point used by callers that build their own title/body. */
export function notifyViaBrowser(options: BrowserNotificationOptions): void {
  const { title, content, silent = false } = options;

  if (!canNotify()) return;
  fire(title, content ?? '', undefined, silent);
}

/** `aria2.onDownloadComplete` -> "Download Completed". */
export function notifyTaskComplete(gid: string, taskName: string): void {
  if (!canNotify()) return;
  // `tag` = gid: re-notifying the same task replaces the old toast instead of
  // stacking a second one.
  fire(i18n.t('Download Completed'), taskName ?? '', gid, false);
}

/** `aria2.onBtDownloadComplete` -> "BT Download Completed". */
export function notifyBtTaskComplete(gid: string, taskName: string): void {
  if (!canNotify()) return;
  fire(i18n.t('BT Download Completed'), taskName ?? '', gid, false);
}

/**
 * `aria2.onDownloadError` -> "Download Error".
 *
 * The body is `<taskName>: <errorMessage>` when both are known, so the desktop
 * toast is actionable without opening the task page.
 */
export function notifyTaskError(gid: string, taskName: string, errorMessage: string): void {
  if (!canNotify()) return;

  const name = taskName ?? '';
  const message = errorMessage ?? '';
  const body = name && message ? `${name}: ${message}` : name || message;

  fire(i18n.t('Download Error'), body, gid, false);
}
