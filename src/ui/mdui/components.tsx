/**
 * Thin, declarative React wrappers around the mdui components.
 *
 * These are *not* a second design system: they only solve the plumbing problems
 * (custom events, JS properties, two-way value binding) and normalise prop names
 * so pages read like ordinary React components. Styling always comes from mdui's
 * own tokens — no colour literal appears in this file.
 *
 * Two conventions worth knowing:
 *
 * 1. Refs are typed with mdui's own element classes (`Button`, `Dialog`, …) so
 *    `useMduiProperty` / `useMduiModel` get real property names instead of
 *    `keyof HTMLElement`.
 * 2. JSX attributes use the **kebab-case** HTML names mdui reflects
 *    (`end-icon`, `full-width`, `close-on-esc`), because that is what
 *    `mdui/jsx.en.d.ts` declares. The JS-only properties (arrays, numbers,
 *    functions) go through `useMduiProperty` / `useMduiModel` instead.
 */

import { cloneElement, createElement, useCallback, useEffect, useRef } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useMduiEvent, useMduiModel, useMduiProperty } from './use-mdui';
import { hasIcon, icon } from './icons';

import type { Button } from 'mdui/components/button.js';
import type { ButtonIcon } from 'mdui/components/button-icon.js';
import type { Checkbox } from 'mdui/components/checkbox.js';
import type { Chip } from 'mdui/components/chip.js';
import type { CircularProgress } from 'mdui/components/circular-progress.js';
import type { Collapse } from 'mdui/components/collapse.js';
import type { Dropdown } from 'mdui/components/dropdown.js';
import type { Fab } from 'mdui/components/fab.js';
import type { LinearProgress } from 'mdui/components/linear-progress.js';
import type { Menu } from 'mdui/components/menu.js';
import type { NavigationBar } from 'mdui/components/navigation-bar.js';
import type { NavigationDrawer } from 'mdui/components/navigation-drawer.js';
import type { NavigationRail } from 'mdui/components/navigation-rail.js';
import type { SegmentedButtonGroup } from 'mdui/components/segmented-button-group.js';
import type { Select } from 'mdui/components/select.js';
import type { Slider } from 'mdui/components/slider.js';
import type { Switch } from 'mdui/components/switch.js';
import type { Tabs } from 'mdui/components/tabs.js';
import type { TextField } from 'mdui/components/text-field.js';

/* -------------------------------------------------------------------------- */
/* shared types                                                               */
/* -------------------------------------------------------------------------- */

/** MD3 colour roles. */
export type MduiTone = 'primary' | 'secondary' | 'tertiary' | 'error';

/** Anchor mixin targets accepted by every component that supports `href`. */
export type MduiTarget = '_blank' | '_parent' | '_self' | '_top';

/** Accepted by every wrapper so pages can attach class / style. */
export interface Styleable {
  className?: string;
  style?: CSSProperties;
}

/** MD3 token reference — keeps every colour in this file theme-aware. */
function toneColor(tone: MduiTone, role: 'base' | 'on' = 'base'): string {
  return `rgb(var(--mdui-color-${role === 'on' ? 'on-' : ''}${tone}))`;
}

/* -------------------------------------------------------------------------- */
/* MduiIcon — standalone SVG icon (no webfont needed)                        */
/* -------------------------------------------------------------------------- */

export interface MduiIconProps {
  /** e.g. `'play-arrow'`, or `'outline:play-arrow'` for the outlined variant. */
  name: string;
  size?: string;
  slot?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders one of the `@mdui/icons` SVG elements.
 *
 * `<mdui-icon name="…">` from mdui renders the name as a *font glyph* and needs
 * the Material Icons webfont; the elements registered by `icons.ts` are inline
 * SVG and need no font at all, so they are preferred everywhere. Unknown names
 * fall back to `<mdui-icon name>` so a typo degrades instead of crashing.
 *
 * Sizes through `font-size` because that is what the icon elements size from.
 */
export function MduiIcon({ name, size = '1.5rem', slot, className, style }: MduiIconProps) {
  const props: Record<string, unknown> = {
    class: className,
    style: { fontSize: size, ...style },
    ...(slot ? { slot } : {}),
  };
  return hasIcon(name)
    ? createElement(icon(name), props)
    : createElement('mdui-icon', { ...props, name });
}

/* -------------------------------------------------------------------------- */
/* MduiButton                                                                 */
/* -------------------------------------------------------------------------- */

export interface MduiButtonProps extends Styleable {
  variant?: 'elevated' | 'filled' | 'tonal' | 'outlined' | 'text';
  icon?: string;
  endIcon?: string;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  href?: string;
  target?: MduiTarget;
  type?: 'submit' | 'reset' | 'button';
  onClick?: (e: Event) => void;
  children?: ReactNode;
}

/**
 * `<mdui-button>`.
 *
 * `onClick` is bound through a ref instead of React's synthetic system, so the
 * callback receives the raw DOM `Event` exactly like every other wrapper here.
 */
export function MduiButton(props: MduiButtonProps) {
  const { variant, icon, endIcon, disabled, loading, fullWidth, href, target, type, onClick, children, className, style } =
    props;
  const ref = useRef<Button>(null);
  useMduiEvent(ref, 'click', (_detail, event) => onClick?.(event));

  return (
    <mdui-button
      ref={ref}
      className={className}
      style={style}
      variant={variant}
      icon={icon}
      end-icon={endIcon}
      disabled={disabled}
      loading={loading}
      full-width={fullWidth}
      href={href}
      target={target}
      type={type}
    >
      {children}
    </mdui-button>
  );
}

/* -------------------------------------------------------------------------- */
/* MduiIconButton                                                              */
/* -------------------------------------------------------------------------- */

export interface MduiIconButtonProps extends Styleable {
  icon: string;
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined';
  /** Shown instead of `icon` while selected (requires `toggle`). */
  selectedIcon?: string;
  toggle?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Required for a11y: an icon-only control has no accessible name otherwise. */
  label: string;
  onClick?: (e: Event) => void;
  onChange?: (selected: boolean) => void;
}

/**
 * `<mdui-button-icon>`.
 *
 * a11y: `label` is mandatory and forwarded as both `aria-label` and `title`;
 * when `toggle` is set, `aria-pressed` mirrors the selection state.
 */
export function MduiIconButton(props: MduiIconButtonProps) {
  const {
    icon,
    variant,
    selectedIcon,
    toggle,
    selected = false,
    disabled,
    label,
    onClick,
    onChange,
    className,
    style,
  } = props;
  const ref = useRef<ButtonIcon>(null);

  useMduiEvent(ref, 'click', (_detail, event) => onClick?.(event));
  useMduiEvent(ref, 'change', () => onChange?.(Boolean(ref.current?.selected)));
  // `selectable` only means something for a toggle button, so `selected` is only
  // pushed onto the element in that mode.
  useMduiProperty(ref, { selectable: toggle, selected: toggle ? selected : undefined });

  return (
    <mdui-button-icon
      ref={ref}
      className={className}
      style={style}
      variant={variant}
      icon={icon}
      selected-icon={selectedIcon}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={toggle ? selected : undefined}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* MduiFab                                                                    */
/* -------------------------------------------------------------------------- */

export interface MduiFabProps extends Styleable {
  icon: string;
  /** Providing a label switches the FAB to its extended form. */
  label?: string;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'surface';
  size?: 'normal' | 'small' | 'large';
  href?: string;
  target?: MduiTarget;
  disabled?: boolean;
  onClick?: (e: Event) => void;
}

/** `<mdui-fab>`; `label` switches it to the extended (labelled) FAB. */
export function MduiFab(props: MduiFabProps) {
  const { icon, label, variant, size, href, target, disabled, onClick, className, style } = props;
  const ref = useRef<Fab>(null);
  useMduiEvent(ref, 'click', (_detail, event) => onClick?.(event));

  return (
    <mdui-fab
      ref={ref}
      className={className}
      style={style}
      icon={icon}
      variant={variant}
      size={size}
      href={href}
      target={target}
      disabled={disabled}
      extended={label !== undefined}
      aria-label={label ?? icon}
    >
      {label}
    </mdui-fab>
  );
}

/* -------------------------------------------------------------------------- */
/* lists                                                                      */
/* -------------------------------------------------------------------------- */

export interface MduiListProps extends Styleable {
  children?: ReactNode;
}

/** `<mdui-list>`; takes `<MduiListItem>` / `<MduiListSubheader>` children. */
export function MduiList({ children, className, style }: MduiListProps) {
  return (
    <mdui-list className={className} style={style}>
      {children}
    </mdui-list>
  );
}

/** `<mdui-list-subheader>`. */
export function MduiListSubheader({ children, className, style }: MduiListProps) {
  return (
    <mdui-list-subheader className={className} style={style}>
      {children}
    </mdui-list-subheader>
  );
}

export interface MduiListItemProps extends Styleable {
  href?: string;
  target?: MduiTarget;
  disabled?: boolean;
  nonclickable?: boolean;
  active?: boolean;
  rounded?: boolean;
  /** No HTML attribute in 2.x — written as a JS property, see `TODO` below. */
  value?: string;
  headline?: string;
  description?: string;
  headlineLine?: 1 | 2 | 3;
  descriptionLine?: 1 | 2 | 3;
  endIcon?: string;
  startIcon?: string;
  onClick?: (e: Event) => void;
  children?: ReactNode;
}

/**
 * `<mdui-list-item>`; `href` turns it into an anchor through mdui's own mixin.
 *
 * TODO(mdui): `<mdui-list-item>` in 2.1.5 has **no** `value` property (v1 had one,
 * used by `<mdui-list-group>`). It is written as a JS property only, so a page can
 * still stash an identifier on the element and read it back, but nothing inside
 * mdui consumes it. Use `data-*` on your own wrapper row instead if the value
 * needs to survive serialisation.
 */
export function MduiListItem(props: MduiListItemProps) {
  const {
    href,
    target,
    disabled,
    nonclickable,
    active,
    rounded,
    value,
    headline,
    description,
    headlineLine,
    descriptionLine,
    endIcon,
    startIcon,
    onClick,
    children,
    className,
    style,
  } = props;
  const ref = useRef<HTMLElement>(null);
  useMduiEvent(ref, 'click', (_detail, event) => onClick?.(event));
  useMduiProperty(ref, { value } as Record<string, unknown>);

  return (
    <mdui-list-item
      ref={ref}
      className={className}
      style={style}
      href={href}
      target={target}
      disabled={disabled}
      nonclickable={nonclickable}
      active={active}
      rounded={rounded}
      headline={headline}
      description={description}
      headline-line={headlineLine}
      description-line={descriptionLine}
      icon={startIcon}
      end-icon={endIcon}
    >
      {children}
    </mdui-list-item>
  );
}

/* -------------------------------------------------------------------------- */
/* selection controls                                                         */
/* -------------------------------------------------------------------------- */

export interface MduiCheckboxProps extends Styleable {
  value?: string;
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
}

/**
 * `<mdui-checkbox>`.
 *
 * Two-way on the `checked` *property* — `<mdui-checkbox>` has no `value` state
 * (`value` is only the form payload), hence the 5th argument of `useMduiModel`.
 * Passing `checked` makes it controlled; omitting it leaves the element in charge
 * while `onChange` still reports every user interaction.
 */
export function MduiCheckbox(props: MduiCheckboxProps) {
  const { value, checked, indeterminate, disabled, onChange, label, className, style } = props;
  const ref = useRef<Checkbox>(null);

  const handleChange = useCallback(
    (next: boolean | undefined) => {
      onChange?.(next === true);
    },
    [onChange],
  );
  useMduiModel(ref, checked, handleChange, 'change', 'checked');
  useMduiProperty(ref, { indeterminate });

  return (
    <mdui-checkbox ref={ref} className={className} style={style} disabled={disabled} value={value}>
      {label}
    </mdui-checkbox>
  );
}

export interface MduiSwitchProps extends Styleable {
  checked?: boolean;
  disabled?: boolean;
  /** Accessible name; `<mdui-switch>` has no default slot. */
  label?: string;
  onChange?: (checked: boolean) => void;
}

/** `<mdui-switch>`; controlled when `checked` is provided. */
export function MduiSwitch(props: MduiSwitchProps) {
  const { checked, disabled, label, onChange, className, style } = props;
  const ref = useRef<Switch>(null);

  const handleChange = useCallback(
    (next: boolean | undefined) => {
      onChange?.(next === true);
    },
    [onChange],
  );
  useMduiModel(ref, checked, handleChange, 'change', 'checked');

  return <mdui-switch ref={ref} className={className} style={style} disabled={disabled} aria-label={label} />;
}

export interface MduiRadioGroupProps extends Styleable {
  value?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  children?: ReactNode;
  onChange?: (value: string) => void;
}

/** `<mdui-radio-group>`; selection lives on the group, not on each radio. */
export function MduiRadioGroup(props: MduiRadioGroupProps) {
  const { value, name, disabled, required, children, onChange, className, style } = props;
  const ref = useRef<HTMLElement>(null);
  useMduiModel(ref, value, (next: string | undefined) => onChange?.(next ?? ''), 'change');

  return (
    <mdui-radio-group
      ref={ref}
      className={className}
      style={style}
      name={name}
      disabled={disabled}
      required={required}
    >
      {children}
    </mdui-radio-group>
  );
}

export interface MduiRadioProps extends Styleable {
  value: string;
  disabled?: boolean;
  children?: ReactNode;
}

/** `<mdui-radio>`; must be a child of `<MduiRadioGroup>`. */
export function MduiRadio({ value, disabled, children, className, style }: MduiRadioProps) {
  return (
    <mdui-radio className={className} style={style} value={value} disabled={disabled}>
      {children}
    </mdui-radio>
  );
}

/* -------------------------------------------------------------------------- */
/* text input                                                                 */
/* -------------------------------------------------------------------------- */

export interface MduiTextFieldProps extends Styleable {
  value: string;
  label?: string;
  type?:
    | 'text'
    | 'number'
    | 'password'
    | 'url'
    | 'email'
    | 'search'
    | 'tel'
    | 'date'
    | 'time'
    | 'week'
    | 'month'
    | 'datetime-local';
  variant?: 'filled' | 'outlined';
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  required?: boolean;
  /** Shown through the standard constraint API so mdui renders it. */
  error?: string;
  helperText?: string;
  icon?: string;
  endIcon?: string;
  /** `> 1` turns the field into a `<textarea>`. */
  rows?: number;
  maxRows?: number;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
}

/**
 * `<mdui-text-field>` with a controlled value.
 *
 * - `value` round-trips through `useMduiModel` on the `input` event.
 * - `onEnter` listens for `keydown` on the host: keyboard events are composed and
 *   cross the shadow boundary, while the inner `<input>` lives in shadow DOM and
 *   cannot be reached from light DOM directly.
 * - `error` is applied with `setCustomValidity()` so mdui renders the message in
 *   its own error slot instead of us hand-rolling the styling.
 *
 * TODO(mdui): `<mdui-text-field>`'s own declaration types `autocorrect` as
 * `string`, which collides with the native `HTMLElement.autocorrect: boolean` and
 * therefore makes `TextField` unassignable to `HTMLElement`. Since
 * `mdui/jsx.en.d.ts` declares the JSX `ref` as `Ref<HTMLElement>`, the ref is
 * kept as `HTMLElement` and only the typed reads go through `field()`.
 */
export function MduiTextField(props: MduiTextFieldProps) {
  const {
    value,
    label,
    type,
    variant,
    placeholder,
    disabled,
    clearable,
    required,
    error,
    helperText,
    icon,
    endIcon,
    rows,
    maxRows,
    onInput,
    onChange,
    onEnter,
    className,
    style,
  } = props;
  const ref = useRef<HTMLElement>(null);
  /** Typed view of the host element — see the TODO above. */
  const field = (): TextField | null => ref.current as unknown as TextField | null;

  useMduiModel(ref, value, (next: string | undefined) => onInput?.(next ?? ''), 'input');
  useMduiEvent(ref, 'change', () => onChange?.(field()?.value ?? ''));
  useMduiEvent(ref, 'keydown', (_detail, event) => {
    if ((event as KeyboardEvent).key === 'Enter') onEnter?.(field()?.value ?? '');
  });

  // Re-applied when the value changes too: mdui re-validates on input, so a
  // value that became invalid needs the custom message back in place.
  //
  // `setCustomValidity()` reaches straight into the inner `<input>`, which only
  // exists once Lit has rendered the shadow root. React's passive effect can win
  // that race (Lit renders in a microtask), so the write is deferred to
  // `updateComplete` — without this, an early mount throws.
  useEffect(() => {
    const element = field();
    if (!element) return;
    const message = error ?? '';
    const pending = (element as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
    if (pending && typeof pending.then === 'function') {
      void pending
        .then(() => element.setCustomValidity(message))
        .catch(() => {
          /* the field was unmounted before it finished rendering */
        });
      return;
    }
    try {
      element.setCustomValidity(message);
    } catch {
      /* shadow DOM not rendered yet */
    }
  }, [error, value, ref]);

  return (
    <mdui-text-field
      ref={ref}
      className={className}
      style={style}
      label={label}
      type={type}
      variant={variant}
      placeholder={placeholder}
      disabled={disabled}
      clearable={clearable}
      required={required}
      helper={helperText}
      icon={icon}
      end-icon={endIcon}
      rows={rows}
      max-rows={maxRows}
    />
  );
}

export type MduiTextareaProps = MduiTextFieldProps;

/**
 * `<mdui-text-field rows={n}>`.
 *
 * mdui 2.x has **no** `<mdui-textarea>` element — setting `rows > 1` is what makes
 * `<mdui-text-field>` render a real `<textarea>` in its shadow root (see
 * `TextField#isTextarea` in `components/text-field/index.js`).
 */
export function MduiTextarea(props: MduiTextareaProps) {
  return <MduiTextField {...props} rows={props.rows ?? 4} type={undefined} />;
}

/* -------------------------------------------------------------------------- */
/* select                                                                     */
/* -------------------------------------------------------------------------- */

export interface MduiSelectItem {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  icon?: string;
}

export interface MduiSelectProps extends Styleable {
  value: string;
  items: readonly MduiSelectItem[];
  label?: string;
  placeholder?: string;
  variant?: 'filled' | 'outlined';
  disabled?: boolean;
  clearable?: boolean;
  helperText?: string;
  onChange?: (value: string) => void;
}

/**
 * `<mdui-select>`.
 *
 * `<mdui-select>` has no `<option>` children in 2.x — it collects
 * `<mdui-menu-item>` elements, so this wrapper maps a plain `items` array onto
 * menu items. Its own value round-trips through the `change` event.
 */
export function MduiSelect(props: MduiSelectProps) {
  const { value, items, label, placeholder, variant, disabled, clearable, helperText, onChange, className, style } =
    props;
  const ref = useRef<Select>(null);
  useMduiModel(ref, value, (next: string | undefined) => onChange?.(next ?? ''), 'change');

  return (
    <mdui-select
      ref={ref}
      className={className}
      style={style}
      label={label}
      placeholder={placeholder}
      variant={variant}
      disabled={disabled}
      clearable={clearable}
      helper={helperText}
    >
      {items.map((item) => (
        <mdui-menu-item key={item.value} value={item.value} disabled={item.disabled} icon={item.icon}>
          {item.label}
        </mdui-menu-item>
      ))}
    </mdui-select>
  );
}

/* -------------------------------------------------------------------------- */
/* slider                                                                     */
/* -------------------------------------------------------------------------- */

export interface MduiSliderProps extends Styleable {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  tickmarks?: boolean;
  /** Accessible name; `<mdui-slider>` renders its own value bubble instead. */
  label?: string;
  /** e.g. ``(v) => `${(v / 1024).toFixed(1)} GiB` `` — becomes `labelFormatter`. */
  valueLabelFormat?: (v: number) => string;
  onChange?: (v: number) => void;
}

/**
 * `<mdui-slider>`.
 *
 * `labelFormatter` is a JS-only property with no attribute form, so it is
 * written through `useMduiProperty`. `useMduiModel` binds on `input` so the value
 * updates live while dragging (mdui also fires `change` on release).
 */
export function MduiSlider(props: MduiSliderProps) {
  const { value, min, max, step, disabled, tickmarks, label, valueLabelFormat, onChange, className, style } = props;
  const ref = useRef<Slider>(null);

  useMduiModel(ref, value, (next: number | undefined) => onChange?.(next ?? 0), 'input');
  useMduiProperty(ref, { labelFormatter: valueLabelFormat });

  return (
    <mdui-slider
      ref={ref}
      className={className}
      style={style}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      tickmarks={tickmarks}
      aria-label={label}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* chips                                                                      */
/* -------------------------------------------------------------------------- */

export interface MduiChipProps extends Styleable {
  variant?: 'assist' | 'filter' | 'input' | 'suggestion';
  icon?: string;
  selectable?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** mdui's own spelling is `deletable`. */
  removable?: boolean;
  deleteIcon?: string;
  elevated?: boolean;
  onClick?: (e: Event) => void;
  onDelete?: () => void;
  onChange?: (selected: boolean) => void;
  children?: ReactNode;
}

/** `<mdui-chip>`; `delete` and `change` are distinct mdui events. */
export function MduiChip(props: MduiChipProps) {
  const {
    variant,
    icon,
    selectable,
    selected,
    disabled,
    removable,
    deleteIcon,
    elevated,
    onClick,
    onDelete,
    onChange,
    children,
    className,
    style,
  } = props;
  const ref = useRef<Chip>(null);

  useMduiEvent(ref, 'click', (_detail, event) => onClick?.(event));
  useMduiEvent(ref, 'delete', () => onDelete?.());
  useMduiEvent(ref, 'change', () => onChange?.(Boolean(ref.current?.selected)));
  useMduiProperty(ref, { selected });

  return (
    <mdui-chip
      ref={ref}
      className={className}
      style={style}
      variant={variant}
      icon={icon}
      selectable={selectable}
      disabled={disabled}
      deletable={removable}
      delete-icon={deleteIcon}
      elevated={elevated}
      aria-selected={selectable ? Boolean(selected) : undefined}
    >
      {children}
    </mdui-chip>
  );
}

/* -------------------------------------------------------------------------- */
/* feedback                                                                   */
/* -------------------------------------------------------------------------- */

export interface MduiBadgeProps extends Styleable {
  value: string | number;
  color?: MduiTone;
  /** `small` renders a dot without text. */
  variant?: 'small' | 'large';
  children?: ReactNode;
}

/**
 * `<mdui-badge>`.
 *
 * mdui's badge has no colour attribute — it is hard-wired to the error role — so
 * the tone is applied through the MD3 role tokens, which keeps light/dark correct
 * without a single colour literal.
 */
export function MduiBadge(props: MduiBadgeProps) {
  const { value, color, variant, children, className, style } = props;
  return (
    <mdui-badge
      className={className}
      style={{
        backgroundColor: color ? toneColor(color) : undefined,
        color: color ? toneColor(color, 'on') : undefined,
        ...style,
      }}
      variant={variant}
    >
      {children ?? value}
    </mdui-badge>
  );
}

export interface MduiProgressBarProps extends Styleable {
  /** `0…100`. */
  value: number;
  variant?: 'linear' | 'circular';
  color?: MduiTone;
  /** Track height in px (linear) or box size in px (circular). */
  height?: number;
  label?: string;
}

const PROGRESS_TOKEN = {
  primary: '--mdui-color-primary',
  secondary: '--mdui-color-secondary',
  tertiary: '--mdui-color-tertiary',
  error: '--mdui-color-error',
} as const;

/**
 * `<mdui-linear-progress>` / `<mdui-circular-progress>`.
 *
 * Neither exposes a colour attribute; both resolve `--mdui-color-primary` from
 * the host scope, so for a non-primary tone that token is re-pointed at the
 * matching MD3 role, scoped to this element only.
 */
export function MduiProgressBar(props: MduiProgressBarProps) {
  const { value, variant = 'linear', color, height, label, className, style } = props;
  const linearRef = useRef<LinearProgress>(null);
  const circularRef = useRef<CircularProgress>(null);
  const toneToken = color && color !== 'primary' ? PROGRESS_TOKEN[color] : undefined;
  const tokenStyle = toneToken ? ({ [toneToken]: `var(${toneToken})` } as CSSProperties) : undefined;
  useMduiProperty(linearRef, { value });
  useMduiProperty(circularRef, { value });

  if (variant === 'circular') {
    const size = `${height ?? 40}px`;
    return (
      <mdui-circular-progress
        ref={circularRef}
        className={className}
        style={{ width: size, height: size, ...tokenStyle, ...style }}
        max={100}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      />
    );
  }

  return (
    <mdui-linear-progress
      ref={linearRef}
      className={className}
      style={{ height: height !== undefined ? `${height}px` : undefined, ...tokenStyle, ...style }}
      max={100}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    />
  );
}

export interface MduiDividerProps extends Styleable {
  inset?: boolean;
  middle?: boolean;
  vertical?: boolean;
}

/** `<mdui-divider>`. */
export function MduiDivider({ inset, middle, vertical, className, style }: MduiDividerProps) {
  return <mdui-divider className={className} style={style} inset={inset} middle={middle} vertical={vertical} />;
}

/* -------------------------------------------------------------------------- */
/* tooltip                                                                    */
/* -------------------------------------------------------------------------- */

export interface MduiTooltipProps extends Styleable {
  content: ReactNode;
  placement?:
    | 'auto'
    | 'top'
    | 'top-start'
    | 'top-end'
    | 'bottom'
    | 'bottom-start'
    | 'bottom-end'
    | 'left'
    | 'left-start'
    | 'left-end'
    | 'right'
    | 'right-start'
    | 'right-end';
  trigger?: 'click' | 'hover' | 'focus' | 'manual';
  /** Open delay in ms (only meaningful for the `hover` trigger). */
  delay?: number;
  /** `rich` enables the `headline` / `action` slots. */
  variant?: 'plain' | 'rich';
  headline?: string;
  disabled?: boolean;
  /** Exactly one element: mdui uses the first default-slot child as the trigger. */
  children: ReactNode;
}

/**
 * `<mdui-tooltip>`.
 *
 * Plain string content uses the `content` attribute; anything richer goes into
 * the `content` slot, which mdui renders as HTML.
 */
export function MduiTooltip(props: MduiTooltipProps) {
  const { content, placement, trigger, delay, variant, headline, disabled, children, className, style } = props;
  const isPlain = typeof content === 'string' || typeof content === 'number';

  return (
    <mdui-tooltip
      className={className}
      style={style}
      variant={variant}
      placement={placement}
      trigger={trigger}
      open-delay={delay}
      headline={headline}
      disabled={disabled}
      content={isPlain ? String(content) : undefined}
    >
      {children}
      {isPlain ? null : <span slot="content">{content}</span>}
    </mdui-tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* card                                                                       */
/* -------------------------------------------------------------------------- */

export interface MduiCardProps extends Styleable {
  variant?: 'elevated' | 'filled' | 'outlined';
  clickable?: boolean;
  disabled?: boolean;
  onClick?: (e: Event) => void;
  children?: ReactNode;
}

/** `<mdui-card>`; mdui 2.x has no `card-header` / `card-content` sub-components. */
export function MduiCard(props: MduiCardProps) {
  const { variant, clickable, disabled, onClick, children, className, style } = props;
  const ref = useRef<HTMLElement>(null);
  useMduiEvent(ref, 'click', (_detail, event) => onClick?.(event));

  return (
    <mdui-card ref={ref} className={className} style={style} variant={variant} clickable={clickable} disabled={disabled}>
      {children}
    </mdui-card>
  );
}

/* -------------------------------------------------------------------------- */
/* segmented button group                                                      */
/* -------------------------------------------------------------------------- */

export interface MduiSegmentedItem {
  value: string;
  label: ReactNode;
  icon?: string;
  disabled?: boolean;
}

export interface MduiSegmentedButtonProps extends Styleable {
  value?: string;
  items: readonly MduiSegmentedItem[];
  /** Defaults to single selection. */
  multiple?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  onChange?: (value: string) => void;
}

/**
 * `<mdui-segmented-button-group>` + `<mdui-segmented-button>`.
 *
 * Selection lives on the *group* (`value` property + `change` event); the child
 * buttons only carry their own `value`. In `selects="multiple"` mode `value` is a
 * `string[]` with no attribute form, so that shape goes through
 * `useMduiProperty`.
 */
export function MduiSegmentedButton(props: MduiSegmentedButtonProps) {
  const { value, items, multiple, disabled, fullWidth, onChange, className, style } = props;
  const ref = useRef<SegmentedButtonGroup>(null);

  useMduiModel(ref, value, (next: string | undefined) => onChange?.(next ?? ''), 'change');
  useMduiProperty(ref, { value: multiple ? (value ? [value] : []) : undefined });

  return (
    <mdui-segmented-button-group
      ref={ref}
      className={className}
      style={style}
      selects={multiple ? 'multiple' : 'single'}
      disabled={disabled}
      full-width={fullWidth}
    >
      {items.map((item) => (
        <mdui-segmented-button key={item.value} value={item.value} icon={item.icon} disabled={item.disabled}>
          {item.label}
        </mdui-segmented-button>
      ))}
    </mdui-segmented-button-group>
  );
}

/* -------------------------------------------------------------------------- */
/* tabs                                                                       */
/* -------------------------------------------------------------------------- */

export interface MduiTabsProps extends Styleable {
  activeTab?: string;
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
  placement?: 'top-start' | 'top' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end' | 'left' | 'right';
  onTabChange?: (value: string) => void;
  children?: ReactNode;
}

/**
 * `<mdui-tabs>`.
 *
 * The active tab is the `value` property; `<mdui-tabs>` fires `change` when the
 * user picks another tab, so this is a straight `useMduiModel` binding. Panels
 * are plain children carrying `slot="panel"` (see `<MduiTabPanel>`).
 */
export function MduiTabs(props: MduiTabsProps) {
  const { activeTab, variant, fullWidth, placement, onTabChange, children, className, style } = props;
  const ref = useRef<Tabs>(null);
  useMduiModel(ref, activeTab, (next: string | undefined) => onTabChange?.(next ?? ''), 'change');

  return (
    <mdui-tabs
      ref={ref}
      className={className}
      style={style}
      variant={variant}
      full-width={fullWidth}
      placement={placement}
    >
      {children}
    </mdui-tabs>
  );
}

export interface MduiTabProps {
  value: string;
  label?: ReactNode;
  icon?: string;
  badge?: string | number;
  /**
   * `<mdui-tab>` has no `disabled` property in 2.1.5 — it is expressed through
   * `aria-disabled` plus removal from the tab order.
   */
  disabled?: boolean;
  children?: ReactNode;
}

/** `<mdui-tab>`; the owning `<mdui-tabs>` drives the active state. */
export function MduiTab({ value, label, icon, badge, disabled, children }: MduiTabProps) {
  return (
    <mdui-tab value={value} icon={icon} aria-disabled={disabled || undefined} {...(disabled ? { tabIndex: -1 } : {})}>
      {label}
      {badge === undefined ? null : <mdui-badge slot="badge">{badge}</mdui-badge>}
      {children}
    </mdui-tab>
  );
}

export interface MduiTabPanelProps extends Styleable {
  value: string;
  children?: ReactNode;
}

/** `<mdui-tab-panel slot="panel">`; must be a child of `<MduiTabs>`. */
export function MduiTabPanel({ value, children, className, style }: MduiTabPanelProps) {
  return (
    <mdui-tab-panel slot="panel" value={value} className={className} style={style}>
      {children}
    </mdui-tab-panel>
  );
}

/* -------------------------------------------------------------------------- */
/* collapse                                                                   */
/* -------------------------------------------------------------------------- */

export interface MduiCollapseProps extends Styleable {
  variant?: 'full' | 'accordion';
  /** `string` in accordion mode, `string[]` otherwise. */
  value?: string | string[];
  disabled?: boolean;
  onExpandChange?: (values: string[]) => void;
  children?: ReactNode;
}

/**
 * `<mdui-collapse>`.
 *
 * `value` is `string | string[]` depending on `accordion`, and in the
 * non-accordion case only the JS property can hold an array — hence
 * `useMduiProperty`. `<mdui-collapse>` fires `change` whenever the set of
 * expanded items changes; the callback normalises both shapes to `string[]`.
 */
export function MduiCollapse(props: MduiCollapseProps) {
  const { variant, value, disabled, onExpandChange, children, className, style } = props;
  const ref = useRef<Collapse>(null);
  const accordion = variant === 'accordion';

  useMduiEvent(ref, 'change', () => {
    const next = ref.current?.value;
    onExpandChange?.(next === undefined ? [] : Array.isArray(next) ? next : [next]);
  });
  useMduiProperty(ref, {
    value:
      value === undefined
        ? undefined
        : accordion
          ? Array.isArray(value)
            ? (value[0] ?? '')
            : value
          : Array.isArray(value)
            ? value
            : [value],
  });

  return (
    <mdui-collapse ref={ref} className={className} style={style} accordion={accordion} disabled={disabled}>
      {children}
    </mdui-collapse>
  );
}

export interface MduiCollapseItemProps extends Styleable {
  value: string;
  header: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}

/** `<mdui-collapse-item>`; must be a child of `<MduiCollapse>`. */
export function MduiCollapseItem({ value, header, disabled, children, className, style }: MduiCollapseItemProps) {
  const plainHeader = typeof header === 'string';
  return (
    <mdui-collapse-item
      className={className}
      style={style}
      value={value}
      header={plainHeader ? header : undefined}
      disabled={disabled}
    >
      {plainHeader ? null : <span slot="header">{header}</span>}
      {children}
    </mdui-collapse-item>
  );
}

/* -------------------------------------------------------------------------- */
/* top app bar                                                                */
/* -------------------------------------------------------------------------- */

export interface MduiTopAppBarProps extends Styleable {
  variant?: 'small' | 'center-aligned' | 'medium' | 'large';
  /** `standard` / `pinned` are aliases for mdui 2.x's `undefined` / `elevate`. */
  scrollBehavior?: 'hide' | 'shrink' | 'elevate' | 'standard' | 'pinned';
  scrollThreshold?: number;
  title?: ReactNode;
  navigationIcon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

const SCROLL_BEHAVIOR_ALIAS: Record<
  NonNullable<MduiTopAppBarProps['scrollBehavior']>,
  'hide' | 'shrink' | 'elevate' | undefined
> = {
  standard: undefined,
  pinned: 'elevate',
  hide: 'hide',
  shrink: 'shrink',
  elevate: 'elevate',
};

/**
 * `<mdui-top-app-bar>`.
 *
 * The app bar has a single default slot, so `navigationIcon` / `title` / `actions`
 * are positional: a flex spacer is inserted before `actions` to push them to the
 * trailing edge, exactly as the mdui documentation does.
 */
export function MduiTopAppBar(props: MduiTopAppBarProps) {
  const { variant, scrollBehavior, scrollThreshold, title, navigationIcon, actions, children, className, style } = props;
  const scrollBehaviorAttr = scrollBehavior === undefined ? undefined : SCROLL_BEHAVIOR_ALIAS[scrollBehavior];

  return (
    <mdui-top-app-bar
      className={className}
      style={style}
      variant={variant}
      scroll-behavior={scrollBehaviorAttr}
      scroll-threshold={scrollThreshold}
    >
      {navigationIcon}
      {title === undefined ? null : <mdui-top-app-bar-title>{title}</mdui-top-app-bar-title>}
      {actions === undefined ? null : <div style={{ flexGrow: 1 }} />}
      {actions}
      {children}
    </mdui-top-app-bar>
  );
}

/* -------------------------------------------------------------------------- */
/* menus & dropdowns                                                          */
/* -------------------------------------------------------------------------- */

export interface MduiMenuProps extends Styleable {
  /** Omit for a plain, non-selectable menu. */
  selects?: 'single' | 'multiple';
  value?: string | string[];
  dense?: boolean;
  onChange?: (value: string | string[]) => void;
  children?: ReactNode;
}

/** `<mdui-menu>`; selection lives on the menu, not on the items. */
export function MduiMenu(props: MduiMenuProps) {
  const { selects, value, dense, onChange, children, className, style } = props;
  const ref = useRef<Menu>(null);

  useMduiModel(ref, value, (next: string | string[] | undefined) => {
    if (next !== undefined) onChange?.(next);
  }, 'change');

  return (
    <mdui-menu ref={ref} className={className} style={style} selects={selects} dense={dense}>
      {children}
    </mdui-menu>
  );
}

export interface MduiMenuItemProps extends Styleable {
  value?: string;
  disabled?: boolean;
  selected?: boolean;
  icon?: string;
  endIcon?: string;
  endText?: string;
  href?: string;
  target?: MduiTarget;
  onClick?: (e: Event) => void;
  children?: ReactNode;
}

/** `<mdui-menu-item>`; `selected` is exposed as ARIA state for non-selectable menus. */
export function MduiMenuItem(props: MduiMenuItemProps) {
  const { value, disabled, selected, icon, endIcon, endText, href, target, onClick, children, className, style } = props;
  const ref = useRef<HTMLElement>(null);
  useMduiEvent(ref, 'click', (_detail, event) => onClick?.(event));

  return (
    <mdui-menu-item
      ref={ref}
      className={className}
      style={style}
      value={value}
      disabled={disabled}
      icon={icon}
      end-icon={endIcon}
      end-text={endText}
      href={href}
      target={target}
      aria-selected={selected}
    >
      {children}
    </mdui-menu-item>
  );
}

export interface MduiDropdownProps extends Styleable {
  /** The control that opens the dropdown. */
  trigger: ReactNode;
  /** Menu content, normally `<MduiMenu>` with `<MduiMenuItem>` children. */
  items: ReactNode[];
  placement?:
    | 'auto'
    | 'top'
    | 'top-start'
    | 'top-end'
    | 'bottom'
    | 'bottom-start'
    | 'bottom-end'
    | 'left'
    | 'left-start'
    | 'left-end'
    | 'right'
    | 'right-start'
    | 'right-end';
  openDelay?: number;
  closeDelay?: number;
  /** Uncontrolled by default; set to drive it from React state. */
  open?: boolean;
}

/**
 * `<mdui-dropdown>`; `open` is a JS property, so it is driven imperatively.
 *
 * The trigger **must** carry `slot="trigger"`. mdui resolves it with
 * `this.querySelector('[slot="trigger"]')` and then calls
 * `getOverflowAncestors(...)` on the result, so a plain child leaves it
 * `undefined` and the component throws from its first update.
 *
 * `cloneElement` is used rather than requiring callers to set the slot
 * themselves, because `MduiButton` has no `slot` prop and React cannot add the
 * attribute to an arbitrary `ReactNode` in place.
 */
export function MduiDropdown(props: MduiDropdownProps) {
  const { trigger, items, placement, openDelay, closeDelay, open, className, style } = props;
  const ref = useRef<Dropdown>(null);
  useMduiProperty(ref, { open });

  return (
    <mdui-dropdown
      ref={ref}
      className={className}
      style={style}
      placement={placement}
      open-delay={openDelay}
      close-delay={closeDelay}
      trigger="click"
    >
      {cloneElement(trigger as ReactElement<{ slot?: string }>, { slot: 'trigger' })}
      {items}
    </mdui-dropdown>
  );
}

/* -------------------------------------------------------------------------- */
/* layout                                                                     */
/* -------------------------------------------------------------------------- */

export interface MduiLayoutProps extends Styleable {
  fullHeight?: boolean;
  children?: ReactNode;
}

/** `<mdui-layout>` — the M3 responsive shell (layout items + main). */
export function MduiLayout({ fullHeight, children, className, style }: MduiLayoutProps) {
  return (
    <mdui-layout className={className} style={style} full-height={fullHeight}>
      {children}
    </mdui-layout>
  );
}

export interface MduiLayoutItemProps extends Styleable {
  placement?: 'top' | 'bottom' | 'left' | 'right';
  order?: number;
  children?: ReactNode;
}

/** `<mdui-layout-item>` — reserves the gutter a navigation drawer occupies. */
export function MduiLayoutItem({ placement, order, children, className, style }: MduiLayoutItemProps) {
  return (
    <mdui-layout-item className={className} style={style} placement={placement} order={order}>
      {children}
    </mdui-layout-item>
  );
}

/** `<mdui-layout-main>` — the scrolling content area. */
export function MduiLayoutMain({ children, className, style }: MduiLayoutProps) {
  return (
    <mdui-layout-main className={className} style={style}>
      {children}
    </mdui-layout-main>
  );
}

/* -------------------------------------------------------------------------- */
/* navigation                                                                 */
/* -------------------------------------------------------------------------- */

export interface MduiNavigationDrawerProps extends Styleable {
  /** JS property, not an attribute. */
  open?: boolean;
  modal?: boolean;
  closeOnEsc?: boolean;
  closeOnOverlayClick?: boolean;
  placement?: 'left' | 'right';
  onOpened?: () => void;
  onClosed?: () => void;
  children?: ReactNode;
}

/** `<mdui-navigation-drawer>`; `open` is written as a property. */
export function MduiNavigationDrawer(props: MduiNavigationDrawerProps) {
  const { open, modal, closeOnEsc, closeOnOverlayClick, placement, onOpened, onClosed, children, className, style } =
    props;
  const ref = useRef<NavigationDrawer>(null);
  useMduiEvent(ref, 'opened', () => onOpened?.());
  useMduiEvent(ref, 'closed', () => onClosed?.());
  useMduiProperty(ref, { open });

  return (
    <mdui-navigation-drawer
      ref={ref}
      className={className}
      style={style}
      modal={modal}
      close-on-esc={closeOnEsc}
      close-on-overlay-click={closeOnOverlayClick}
      placement={placement}
    >
      {children}
    </mdui-navigation-drawer>
  );
}

export interface MduiNavigationRailProps extends Styleable {
  value?: string;
  placement?: 'left' | 'right';
  alignment?: 'start' | 'center' | 'end';
  contained?: boolean;
  divider?: boolean;
  onChange?: (value: string) => void;
  children?: ReactNode;
}

/** `<mdui-navigation-rail>` for the compact / medium-width layout. */
export function MduiNavigationRail(props: MduiNavigationRailProps) {
  const { value, placement, alignment, contained, divider, onChange, children, className, style } = props;
  const ref = useRef<NavigationRail>(null);
  useMduiModel(ref, value, (next: string | undefined) => onChange?.(next ?? ''), 'change');

  return (
    <mdui-navigation-rail
      ref={ref}
      className={className}
      style={style}
      placement={placement}
      alignment={alignment}
      contained={contained}
      divider={divider}
    >
      {children}
    </mdui-navigation-rail>
  );
}

export interface MduiNavigationRailItemProps extends Styleable {
  value: string;
  icon: string;
  activeIcon?: string;
  /** Required for a11y: rail items are icon-only by default. */
  label: string;
  href?: string;
  badge?: string | number;
}

/** `<mdui-navigation-rail-item>`. */
export function MduiNavigationRailItem(props: MduiNavigationRailItemProps) {
  const { value, icon, activeIcon, label, href, badge, className, style } = props;
  return (
    <mdui-navigation-rail-item
      className={className}
      style={style}
      value={value}
      icon={icon}
      active-icon={activeIcon}
      href={href}
      aria-label={label}
      title={label}
    >
      {label}
      {badge === undefined ? null : <mdui-badge slot="badge">{badge}</mdui-badge>}
    </mdui-navigation-rail-item>
  );
}

export interface MduiNavigationBarProps extends Styleable {
  value?: string;
  labelVisibility?: 'auto' | 'selected' | 'labeled' | 'unlabeled';
  onChange?: (value: string) => void;
  children?: ReactNode;
}

/** `<mdui-navigation-bar>` for the compact / mobile layout. */
export function MduiNavigationBar(props: MduiNavigationBarProps) {
  const { value, labelVisibility, onChange, children, className, style } = props;
  const ref = useRef<NavigationBar>(null);
  useMduiModel(ref, value, (next: string | undefined) => onChange?.(next ?? ''), 'change');

  return (
    <mdui-navigation-bar ref={ref} className={className} style={style} label-visibility={labelVisibility}>
      {children}
    </mdui-navigation-bar>
  );
}

export interface MduiNavigationBarItemProps extends Styleable {
  value: string;
  icon: string;
  activeIcon?: string;
  label: string;
  href?: string;
  badge?: string | number;
}

/** `<mdui-navigation-bar-item>`; `label` doubles as the accessible name. */
export function MduiNavigationBarItem(props: MduiNavigationBarItemProps) {
  const { value, icon, activeIcon, label, href, badge, className, style } = props;
  return (
    <mdui-navigation-bar-item
      className={className}
      style={style}
      value={value}
      icon={icon}
      active-icon={activeIcon}
      href={href}
      aria-label={label}
    >
      {label}
      {badge === undefined ? null : <mdui-badge slot="badge">{badge}</mdui-badge>}
    </mdui-navigation-bar-item>
  );
}

/* -------------------------------------------------------------------------- */
/* misc                                                                       */
/* -------------------------------------------------------------------------- */

export interface MduiAvatarProps extends Styleable {
  src?: string;
  icon?: string;
  label?: string;
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
}

/** `<mdui-avatar>` with either an image `src` or a fallback `icon` + `label`. */
export function MduiAvatar(props: MduiAvatarProps) {
  const { src, icon, label, fit, className, style } = props;
  return <mdui-avatar className={className} style={style} src={src} icon={icon} label={label} fit={fit} />;
}