/**
 * Promise-based dialog helpers — the SweetAlert replacement.
 *
 * mdui ships `dialog()` / `alert()` / `confirm()` / `prompt()` / `snackbar()`
 * which build a throwaway `<mdui-dialog>` (or `<mdui-snackbar>`), append it to
 * `<body>`, and remove it on `closed`. Those functions reject the promise when
 * the dialog is dismissed any way other than the primary action, which is a poor
 * fit for React (unhandled rejections) and for i18n (English defaults baked in).
 *
 * Every wrapper here therefore:
 *   - never rejects (a failed dialog resolves to a safe default), so a broken
 *     overlay can never take a page down with it, and
 *   - supplies no default button text, leaving it to the call site (which reads
 *     it from i18n).
 */

import type { ReactNode } from 'react';
import { dialog as mduiDialog } from 'mdui/functions/dialog.js';
import { snackbar as mduiSnackbar } from 'mdui/functions/snackbar.js';
import { hasIcon, icon } from './icons';

/* -------------------------------------------------------------------------- */
/* type declarations                                                          */
/* -------------------------------------------------------------------------- */

import type { Dialog as MduiDialogInstance } from 'mdui/components/dialog.js';
import type { Snackbar as MduiSnackbarInstance } from 'mdui/components/snackbar.js';

export type { MduiDialogInstance, MduiSnackbarInstance };

/**
 * Loads mdui's dialog-related modules and re-exports their types.
 *
 * mdui is a plain JS package with hand-written `.d.ts` files that are only
 * reachable through the runtime paths; importing the types from here guarantees
 * `tsc` resolves them and that the dialog classes are actually in the bundle.
 * Safe (and cheap) to call more than once — ES module evaluation is cached.
 */
export function registerDialogTypes(): void {
  // The side-effect imports above already registered `<mdui-dialog>` and
  // `<mdui-snackbar>` with the custom element registry by the time this runs.
  // Nothing else to do; the function exists so call sites (and tests) have an
  // explicit, self-documenting hook.
}

/* -------------------------------------------------------------------------- */
/* shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function warn(message: string, error: unknown): void {
  console.warn(`[mdui] ${message}`, error);
}

/**
 * Coerce arbitrary `ReactNode` content into something mdui's `body` option
 * accepts (`string | HTMLElement`).
 *
 * Strings pass straight through. For rich content the node is rendered into a
 * detached container via `renderToStaticMarkup`-free stringification: we cannot
 * mount a React root off-document without pulling in `react-dom/client` at call
 * time, so instead we require callers to pass a string or a pre-rendered
 * element. React elements are therefore stringified defensively and will show
 * as `[object Object]` unless the caller supplies a string.
 *
 * Prefer passing plain text (translated) for dialog copy — that is the intended
 * usage and avoids this whole problem.
 */
function toBody(text: ReactNode): string | HTMLElement | undefined {
  if (text === undefined || text === null || text === false) return undefined;
  if (typeof text === 'string') return text;
  if (typeof text === 'number') return String(text);
  if (typeof HTMLElement !== 'undefined' && text instanceof HTMLElement) return text;
  return undefined;
}

/**
 * Build the icon slot content.
 *
 * mdui's programmatic functions take an `icon` **name** string, which it renders
 * through `<mdui-icon>` as a font glyph. Since the app ships the same glyphs as
 * SVG custom elements, the icon is appended to the dialog's `icon` slot directly
 * and the `icon` option is left unset.
 */
function appendIcon(dialog: HTMLElement, name: string): void {
  if (typeof document === 'undefined') return;
  // `React.createElement` cannot be used here: these functions live outside the
  // React tree, so the node is built imperatively.
  const tag = hasIcon(name) ? icon(name) : 'mdui-icon';
  const node = document.createElement(tag);
  if (!hasIcon(name)) node.setAttribute('name', name);
  node.setAttribute('slot', 'icon');
  dialog.appendChild(node);
}

/** Resolve a press result to a settlement, tolerating a throwing action. */
function settle<T>(settle: (resolve: (value: T) => void) => void, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    try {
      settle(resolve);
    } catch (error) {
      warn('dialog action failed, resolving with the safe default', error);
      resolve(fallback);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* confirmDialog                                                              */
/* -------------------------------------------------------------------------- */

export interface ConfirmOptions {
  heading?: string;
  text?: ReactNode;
  okText?: string;
  cancelText?: string;
  /** `danger` styles the confirm button as destructive (implies `okColor`). */
  okColor?: 'primary' | 'danger';
  icon?: string;
  /** Shorthand for `okColor: 'danger'`. */
  danger?: boolean;
  closeOnEsc?: boolean;
  closeOnOverlayClick?: boolean;
}

/**
 * Yes/no dialog.
 *
 * @returns `true` when confirmed, `false` when cancelled **or** when the dialog
 *          failed to open — callers can treat the result as "proceed or not"
 *          without any error handling.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const instance = mduiDialog({
        headline: options.heading,
        description: typeof options.text === 'string' ? options.text : undefined,
        body: typeof options.text === 'string' ? undefined : toBody(options.text),
        closeOnEsc: options.closeOnEsc ?? true,
        closeOnOverlayClick: options.closeOnOverlayClick ?? true,
        stackedActions: true,
        actions: [
          ...(options.cancelText === undefined
            ? []
            : [{ text: options.cancelText, onClick: () => finish(false) }]),
          {
            text: options.okText ?? '',
            onClick: () => finish(true),
          },
        ],
        // Safety net: ESC / overlay dismissal never runs an action, so without
        // this the promise would hang forever.
        onClosed: () => finish(false),
      });

      if (options.icon) appendIcon(instance, options.icon);

      // A destructive confirm reads better in the error role. mdui's
      // programmatic dialog does not expose a button colour option, so the
      // confirm button is restyled through its own MD3 tokens afterwards.
      const danger = options.danger ?? options.okColor === 'danger';
      if (danger) markDangerous(instance);
    } catch (error) {
      warn('confirmDialog failed, resolving false', error);
      resolve(false);
    }
  });
}

/**
 * Point the trailing action button at the MD3 error role.
 *
 * Done with CSS custom properties rather than a colour literal so light/dark
 * stay correct.
 */
function markDangerous(dialog: HTMLElement): void {
  if (typeof document === 'undefined') return;
  const buttons = dialog.querySelectorAll<HTMLElement>('[slot="action"]');
  const last = buttons[buttons.length - 1];
  if (!last) return;
  last.style.setProperty('color', 'rgb(var(--mdui-color-error))');
  last.style.setProperty('background-color', 'rgb(var(--mdui-color-error))');
  last.style.setProperty('--mdui-color-on-surface', 'rgb(var(--mdui-color-on-error))');
  last.style.setProperty('border-radius', 'var(--mdui-shape-corner-full)');
  last.style.setProperty('padding', '0.5rem 1rem');
}

/* -------------------------------------------------------------------------- */
/* alertDialog                                                                */
/* -------------------------------------------------------------------------- */

export type AlertOptions = Omit<ConfirmOptions, 'cancelText' | 'danger' | 'okColor'>;

/**
 * Message dialog with a single acknowledge button.
 *
 * @returns always `void`; it never rejects, so `await alertDialog(...)` is safe
 *          at every call site.
 */
export function alertDialog(options: AlertOptions): Promise<void> {
  return settle<void>((resolve) => {
    const instance = mduiDialog({
      headline: options.heading,
      description: typeof options.text === 'string' ? options.text : undefined,
      body: typeof options.text === 'string' ? undefined : toBody(options.text),
      closeOnEsc: options.closeOnEsc ?? true,
      closeOnOverlayClick: options.closeOnOverlayClick ?? true,
      actions: [{ text: options.okText ?? '' }],
      onClosed: () => resolve(),
    });
    if (options.icon) appendIcon(instance, options.icon);
  }, undefined);
}

/* -------------------------------------------------------------------------- */
/* promptDialog                                                               */
/* -------------------------------------------------------------------------- */

export interface PromptOptions {
  heading?: string;
  text?: ReactNode;
  value?: string;
  placeholder?: string;
  okText?: string;
  cancelText?: string;
  /** Input type of the internal `<mdui-text-field>`. */
  type?: 'text' | 'password' | 'number' | 'url' | 'email' | 'search';
  label?: string;
}

/**
 * Single-line text prompt.
 *
 * Implemented on top of `dialog()` rather than mdui's `prompt()` because
 * `prompt()` rejects on dismissal and bakes in `OK` / `Cancel` text.
 *
 * @returns the entered string, or `null` when cancelled / on failure.
 */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      let settled = false;
      let input: HTMLInputElement | HTMLTextAreaElement | null = null;

      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const instance = mduiDialog({
        headline: options.heading,
        description: typeof options.text === 'string' ? options.text : undefined,
        body: typeof options.text === 'string' ? undefined : toBody(options.text),
        closeOnEsc: true,
        closeOnOverlayClick: true,
        actions: [
          { text: options.cancelText ?? '', onClick: () => finish(null) },
          {
            text: options.okText ?? '',
            onClick: () => finish(input?.value ?? options.value ?? ''),
          },
        ],
        onClosed: () => finish(null),
      });

      // The field is created before the dialog opens and inserted into the body so
      // it participates in mdui's focus trap.
      if (typeof document !== 'undefined') {
        input = document.createElement(options.type === 'password' ? 'input' : 'input');
        input.type = options.type ?? 'text';
        input.value = options.value ?? '';
        if (options.placeholder) input.placeholder = options.placeholder;
        if (options.label) input.setAttribute('aria-label', options.label);
        input.style.width = '100%';
        instance.appendChild(input);
        // Enter submits, matching the native `window.prompt` behaviour.
        input.addEventListener('keydown', (event) => {
          if ((event as KeyboardEvent).key === 'Enter') {
            event.preventDefault();
            finish(input?.value ?? '');
          }
        });
      }
    } catch (error) {
      warn('promptDialog failed, resolving null', error);
      resolve(null);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* snackbarMessage                                                            */
/* -------------------------------------------------------------------------- */

export interface SnackbarMessageOptions {
  message: ReactNode;
  actionText?: string;
  onAction?: () => void;
  position?: 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end';
  /** Auto-close delay in ms; `0` disables auto-close. mdui's default is 5000. */
  timeout?: number;
  closeable?: boolean;
  /** Serialise snackbars so they queue instead of stacking. */
  queue?: string;
}

/**
 * Fire-and-forget toast.
 *
 * Unlike the dialog helpers this returns nothing (matching `mdui`'s
 * `snackbar()`), but it still swallows every error — a toast must never be able
 * to interrupt the action that triggered it.
 */
export function snackbarMessage(options: SnackbarMessageOptions): void {
  try {
    mduiSnackbar({
      message: typeof options.message === 'string' ? options.message : '',
      placement: options.position,
      action: options.actionText,
      autoCloseDelay: options.timeout,
      closeable: options.closeable,
      queue: options.queue,
      ...(options.onAction
        ? {
            // mdui closes the snackbar unless the callback returns `false`;
            // returning `undefined` keeps the default close behaviour.
            onActionClick: () => {
              options.onAction?.();
            },
          }
        : {}),
    });
  } catch (error) {
    warn('snackbarMessage failed', error);
  }
}