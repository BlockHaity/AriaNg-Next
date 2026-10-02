/**
 * Overlay wrappers: dialog, snackbar, banner, dropdown.
 *
 * All of them share the same two React/mdui friction points solved in
 * `use-mdui.ts`: custom events need a ref, and `open` is a **property**, not an
 * attribute — mdui's Lit-based components only guarantee a synchronous,
 * reactive update when the JS property is assigned.
 */

import { Children, createElement, isValidElement, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useMduiEvent, useMduiProperty } from './use-mdui';
import type { Styleable } from './components';
import { MduiDropdown, MduiMenuItem } from './components';
import { hasIcon, icon } from './icons';

import type { Dialog as MduiDialogElement } from 'mdui/components/dialog.js';
import type { Snackbar as MduiSnackbarElement } from 'mdui/components/snackbar.js';

export type { MduiDropdownProps } from './components';
export type { MduiMenuItemProps } from './components';

/**
 * Render an icon into the requested slot.
 *
 * Uses the standalone SVG element from `@mdui/icons` whenever the name is in our
 * icon set (no webfont needed), and falls back to `<mdui-icon name>` otherwise.
 */
function slotIcon(name: string, slot: string): ReactNode {
  const props: Record<string, unknown> = { slot };
  if (hasIcon(name)) {
    return createElement(icon(name), props);
  }
  return createElement('mdui-icon', { ...props, name });
}

/* -------------------------------------------------------------------------- */
/* MduiDialog                                                                 */
/* -------------------------------------------------------------------------- */

export interface MduiDialogProps extends Styleable {
  open: boolean;
  /** Title. `headline` is an accepted alias so either spelling reads naturally. */
  heading?: ReactNode;
  headline?: ReactNode;
  description?: ReactNode;
  icon?: string;
  /** mdui spells it `fullscreen` (no hyphen); `fullScreen` reads better in TSX. */
  fullScreen?: boolean;
  /**
   * Accepted for call-site symmetry with `<mdui-navigation-drawer>`.
   *
   * TODO(mdui): `<mdui-dialog>` has **no** `modal` property in 2.1.5 — a dialog is
   * always modal and always traps focus (see the `Modal` helper in
   * `components/dialog/index.js`). Pass `modal={false}` and it is simply ignored.
   */
  modal?: boolean;
  closeOnEsc?: boolean;
  closeOnOverlayClick?: boolean;
  stackedActions?: boolean;
  /** Trailing action buttons. Children are given `slot="action"` automatically. */
  actions?: ReactNode;
  /** Dialog body. */
  children?: ReactNode;
  onClosed?: () => void;
  onCancel?: () => void;
}

/**
 * `<mdui-dialog>` driven from React state.
 *
 * Event names verified against `components/dialog/index.d.ts`:
 * `open`, `opened`, `close`, `closed`, `overlay-click`.
 *
 * - `onClosed` binds `closed` (the close animation finished).
 * - `onCancel` binds `close` (the dialog started closing). mdui 2.x has **no**
 *   `cancel` event — that was v1. A `close` the app did not request by setting
 *   `open={false}` is what this reports.
 *
 * Slot contract (2.x dropped `<mdui-dialog-title>` / `-actions` / `-content`
 * elements in favour of named slots): `icon`, `headline`, `description`,
 * default (body), `action`.
 */
export function MduiDialog(props: MduiDialogProps) {
  const {
    open,
    heading,
    headline,
    description,
    icon: iconName,
    fullScreen,
    closeOnEsc,
    closeOnOverlayClick,
    stackedActions,
    actions,
    children,
    onClosed,
    onCancel,
    className,
    style,
  } = props;
  const ref = useRef<MduiDialogElement>(null);

  useMduiEvent(ref, 'closed', () => onClosed?.());
  useMduiEvent(ref, 'close', () => onCancel?.());
  useMduiProperty(ref, { open });

  const title = headline ?? heading;
  const plainTitle = typeof title === 'string' || typeof title === 'number';
  const plainDescription = typeof description === 'string' || typeof description === 'number';

  // `hasSlotController.test('action')` looks for any `[slot=action]` child, so
  // the buttons can be passed as plain children and slotted here. A wrapper div
  // is used because the action slot is a single flex container.
  const actionChildren =
    actions === undefined
      ? null
      : Children.toArray(actions).map((child) =>
          isValidElement(child)
            ? createElement(
                'div',
                { slot: 'action', style: { display: 'contents' }, key: (child as ReactElement).key ?? undefined },
                child,
              )
            : child,
        );

  return (
    <mdui-dialog
      ref={ref}
      className={className}
      style={style}
      fullscreen={fullScreen}
      close-on-esc={closeOnEsc}
      close-on-overlay-click={closeOnOverlayClick}
      stacked-actions={stackedActions}
      headline={plainTitle ? String(title) : undefined}
      description={plainDescription ? String(description) : undefined}
    >
      {iconName ? slotIcon(iconName, 'icon') : null}
      {plainTitle || title === undefined ? null : <span slot="headline">{title}</span>}
      {plainDescription || description === undefined ? null : <span slot="description">{description}</span>}
      {children}
      {actionChildren}
    </mdui-dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* MduiSnackbar                                                               */
/* -------------------------------------------------------------------------- */

export interface MduiSnackbarProps extends Styleable {
  message: ReactNode;
  open: boolean;
  /** Trailing action button text. */
  action?: string;
  position?: 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end';
  /** Auto-close delay in ms; `0` disables auto-close. mdui's default is 5000. */
  timeout?: number;
  closeable?: boolean;
  messageLine?: 1 | 2;
  onActionClick?: () => void;
  onClosed?: () => void;
}

/**
 * `<mdui-snackbar>` driven from React state.
 *
 * Event names verified against `components/snackbar/index.d.ts`:
 * `open`, `opened`, `close`, `closed`, `action-click`.
 */
export function MduiSnackbar(props: MduiSnackbarProps) {
  const { message, open, action, position, timeout, closeable, messageLine, onActionClick, onClosed, className, style } =
    props;
  const ref = useRef<MduiSnackbarElement>(null);

  useMduiEvent(ref, 'closed', () => onClosed?.());
  useMduiEvent(ref, 'action-click', () => onActionClick?.());
  useMduiProperty(ref, { open });

  return (
    <mdui-snackbar
      ref={ref}
      className={className}
      style={style}
      placement={position}
      action={action}
      closeable={closeable}
      message-line={messageLine}
      auto-close-delay={timeout}
    >
      {message}
    </mdui-snackbar>
  );
}

/* -------------------------------------------------------------------------- */
/* MduiBanner                                                                 */
/* -------------------------------------------------------------------------- */

export interface MduiBannerProps extends Styleable {
  message: ReactNode;
  open: boolean;
  actions?: ReactNode;
  icon?: string;
}

/**
 * Persistent, inline error / warning strip.
 *
 * TODO(mdui): mdui 2.1.5 **removed** `<mdui-banner>` — it only existed in v1.
 * This is a plain `<div>` built from the MD3 error-container tokens, which
 * matches the Material "error banner" pattern closely enough for a destructive
 * action notice. Swap it for a real component if mdui reintroduces one.
 */
export function MduiBanner(props: MduiBannerProps) {
  const { message, open, actions, icon: iconName, className, style } = props;
  if (!open) return null;

  return (
    <div
      className={className}
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.5rem 1rem',
        backgroundColor: 'rgb(var(--mdui-color-error-container))',
        color: 'rgb(var(--mdui-color-on-error-container))',
        ...style,
      }}
    >
      {iconName
        ? createElement(hasIcon(iconName) ? icon(iconName) : 'mdui-icon', hasIcon(iconName) ? {} : { name: iconName })
        : null}
      <span style={{ flexGrow: 1 }}>{message}</span>
      {actions}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* menu + dropdown (re-exported for overlay call sites)                       */
/* -------------------------------------------------------------------------- */

/**
 * `<mdui-menu-item>`. Also exported from `components.tsx`; re-exported here so
 * overlay code only needs one import.
 */
export { MduiMenuItem };

/**
 * `<mdui-dropdown>`. Also exported from `components.tsx`; re-exported here so
 * overlay code only needs one import.
 */
export { MduiDropdown };