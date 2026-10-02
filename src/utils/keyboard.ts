/**
 * Port of AriaNg's `ariaNgKeyboardService` plus the global shortcut binder that
 * used to live in `scripts/directives/keyboardShortcut.js`.
 *
 * ## Platform modifier
 *
 * AriaNg used `⌘` on mac and `Ctrl` everywhere else. The detection is
 * `navigator.userAgentData.platform` (Chromium, exact — `'macOS'` vs
 * `'Windows'`) with `navigator.platform` (legacy) as the fallback, because
 * Safari does not implement `userAgentData` at all.
 *
 * ## `code` **and** `keyCode`
 *
 * Matching is done on `event.code` (`'KeyA'`, `'Enter'`, …) so a non-QWERTY
 * layout still triggers the *physical* A key, and on the legacy `keyCode`
 * (65 / 70 / 13 / 46 / 8) so synthetic events — and browsers/automation that
 * only set `keyCode` — keep working. Both are accepted; either one is enough.
 */

/** `keyCode` values AriaNg relied on. */
const KEY_CODE_A = 65;
const KEY_CODE_F = 70;
const KEY_CODE_ENTER = 13;
const KEY_CODE_DELETE = 46;
const KEY_CODE_BACKSPACE = 8;

/** macOS / iPadOS / iPhoneOS all report a platform string containing `mac`. */
export function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || '';

  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** `⌘` on mac, `Ctrl` elsewhere. */
function hasModifierKey(e: KeyboardEvent): boolean {
  return isMacLike() ? e.metaKey === true : e.ctrlKey === true;
}

/** `code` / `keyCode` test — a synthetic event may only carry one of them. */
function matchesKey(e: KeyboardEvent, code: string, keyCode: number): boolean {
  if (e.code === code) return true;
  if (e.keyCode === keyCode) return true;
  // `code` is empty on very old browsers; fall back to `key`.
  if (!e.code && typeof e.key === 'string' && e.key.toLowerCase() === code.toLowerCase()) {
    return true;
  }
  return false;
}

/** `⌘/Ctrl + A` — select all tasks. */
export function isCtrlAPressed(e: KeyboardEvent): boolean {
  return hasModifierKey(e) && matchesKey(e, 'KeyA', KEY_CODE_A);
}

/** `⌘/Ctrl + F` — focus the search box. */
export function isCtrlFPressed(e: KeyboardEvent): boolean {
  return hasModifierKey(e) && matchesKey(e, 'KeyF', KEY_CODE_F);
}

/**
 * `⌘/Ctrl + Enter` — "Download Now" on the new-task page.
 *
 * AriaNg only compared the `keyCode`, so `⌘ Return` and `Enter` numpad both
 * worked; the explicit `e.key` check keeps that behaviour for events that carry
 * no `keyCode` at all.
 */
export function isCtrlEnterPressed(e: KeyboardEvent): boolean {
  return (
    hasModifierKey(e) && (matchesKey(e, 'Enter', KEY_CODE_ENTER) || e.key === 'Enter')
  );
}

/** `Delete` (not `Backspace`) — remove the selected tasks. */
export function isDeletePressed(e: KeyboardEvent): boolean {
  return matchesKey(e, 'Delete', KEY_CODE_DELETE) || e.key === 'Delete';
}

/** `Backspace` — used by the new-task editor to remove a link line. */
export function isBackspacePressed(e: KeyboardEvent): boolean {
  return matchesKey(e, 'Backspace', KEY_CODE_BACKSPACE) || e.key === 'Backspace';
}

/**
 * AriaNg's `isTextInput`: only a `<textarea>` or an `<input type="text">`
 * counts as editable.
 *
 * Deliberately narrow — `input[type=checkbox]`, `select`, mdui buttons and the
 * body itself are **not** editable, so `Delete` / `⌘+A` keep working there.
 * The check is on `tagName` / `type` rather than `instanceof` so it also holds
 * for elements coming from another window (an `<iframe>`, a popover) and in
 * tests.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;

  const element = target as { tagName?: unknown; type?: unknown };

  if (typeof element.tagName !== 'string') return false;

  const tagName = element.tagName.toUpperCase();
  if (tagName === 'TEXTAREA') return true;
  if (tagName === 'INPUT') {
    return typeof element.type === 'string' && element.type.toLowerCase() === 'text';
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* keydown binding                                                     */
/* ------------------------------------------------------------------ */

export interface GlobalShortcutHandlers {
  /** `⌘/Ctrl + A` — select every visible task. */
  onSelectAll?: () => void;
  /** `⌘/Ctrl + F` — move focus into the search box. */
  onFocusSearch?: () => void;
  /** `Delete` — remove the selected tasks. */
  onDelete?: () => void;
}

export interface BindGlobalShortcutsOptions {
  /** Gate consulted on every keydown; the settings toggle is wired here. */
  enabled?: () => boolean;
  /** Listen target; defaults to `window`. */
  target?: EventTarget;
}

/**
 * Rows rendered by the "Keyboard Shortcuts" help popover in the settings.
 *
 * `⌘/Ctrl + Enter` ("Download Now") is **not** handled here: it belongs to the
 * new-task editor, which binds it while it is mounted. AriaNg listed it in the
 * same help table.
 */
export const GLOBAL_SHORTCUT_DESCRIPTIONS: readonly { keys: string; action: string }[] = [
  { keys: 'Delete', action: 'Remove Selected Task' },
  { keys: 'Ctrl/⌘+A', action: 'Select All Tasks' },
  { keys: 'Ctrl/⌘+F', action: 'Set Focus On Search Box' },
  { keys: 'Ctrl/⌘+Enter', action: 'Download Now' },
];

/**
 * Installs AriaNg's global keydown handler and returns the unbind function.
 *
 * Registered in the **capture** phase (`addEventListener('keydown', …, true)`,
 * exactly like AriaNg) so a shortcut still fires when a widget further down the
 * tree calls `stopPropagation()` — mdui dialogs and text fields do.
 *
 * `⌘/Ctrl + F` is `preventDefault()`ed to suppress the browser's own find bar.
 * `⌘/Ctrl + A` and `Delete` are **skipped while a text field has focus**
 * (AriaNg's explicit rule) so typing "delete" in the search box does not wipe
 * the selected downloads.
 */
export function bindGlobalShortcuts(
  handlers: GlobalShortcutHandlers,
  options: BindGlobalShortcutsOptions = {},
): () => void {
  const { enabled, target } = options;
  const node: EventTarget | null =
    target ?? (typeof window === 'undefined' ? null : window);

  if (!node || typeof node.addEventListener !== 'function') {
    return () => {};
  }

  const onKeyDown = (event: Event) => {
    if (typeof enabled === 'function' && !enabled()) return;

    const e = event as KeyboardEvent;

    if (isCtrlFPressed(e)) {
      e.preventDefault();
      handlers.onFocusSearch?.();
      return;
    }

    // AriaNg: Ctrl+A and Delete are ignored inside a text input.
    if (isEditableTarget(e.target)) return;

    if (isCtrlAPressed(e)) {
      e.preventDefault();
      handlers.onSelectAll?.();
      return;
    }

    if (isDeletePressed(e)) {
      e.preventDefault();
      handlers.onDelete?.();
    }
  };

  node.addEventListener('keydown', onKeyDown, true);

  return () => {
    node.removeEventListener('keydown', onKeyDown, true);
  };
}
