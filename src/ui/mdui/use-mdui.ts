/**
 * React ↔ Web Components bridge.
 *
 * React's synthetic event system only knows about a fixed list of DOM events, so
 * `<mdui-button onOpen={…}>` silently does nothing — mdui's `open` / `change` /
 * `closed` … events are plain `CustomEvent`s and must be bound imperatively
 * through a ref. On top of that, many mdui properties are *not* valid HTML
 * attributes (arrays, numbers, functions, or names that differ from the
 * attribute spelling), so they must be assigned as JS properties after the
 * element has been created.
 *
 * The helpers below are the single place where those two React limitations are
 * worked around. Every wrapper in `components.tsx` / `overlays.tsx` goes through
 * them, so pages never touch `ref.current.addEventListener` directly.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

/**
 * `detail` of the mdui `CustomEvent`s. mdui's own `*EventMap` interfaces declare
 * almost every event as `CustomEvent<void>`; components that do carry data
 * (`<mdui-tooltip>` in 2.x is one of the few) are still typed loosely here
 * because the handler has to be generic over the event name.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MduiEventDetail = any;

/** Handler shape used by every event helper in this module. */
export type MduiEventHandler = (detail: MduiEventDetail, rawEvent: Event) => void;

/** `useLayoutEffect` warns during SSR; fall back to `useEffect` when there is no DOM. */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' && typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Shallow equality that also understands arrays.
 *
 * mdui uses `string | string[]` for several values (`<mdui-collapse>`,
 * `<mdui-segmented-button-group selects="multiple">`, `<mdui-select multiple>`).
 * Without an array-aware comparison every React render would push a brand new
 * array back into the element and reset its internal selection state.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  }
  return false;
}

/**
 * Attach a listener to a custom element's `CustomEvent` and clean it up.
 *
 * Workaround: React has no synthetic event for custom events, so the binding has
 * to go through the DOM. The handler is kept in a ref, which means re-rendering
 * with a brand new inline arrow function does **not** detach/re-attach the
 * listener (no missed events, no churn).
 */
export function useMduiEvent<K extends string>(
  ref: RefObject<HTMLElement | null>,
  event: K,
  handler: MduiEventHandler,
  options?: AddEventListenerOptions,
): void {
  const latest = useRef(handler);
  useIsomorphicLayoutEffect(() => {
    latest.current = handler;
  });

  // Destructured instead of depending on `options` itself: callers usually pass
  // an inline object literal, which would otherwise re-subscribe every render.
  const { once = false, capture = false, signal } = options ?? {};

  useEffect(() => {
    // React 19 populates refs before effects run, but be defensive: the element
    // may be conditionally rendered or the ref may not be attached yet.
    const element = ref.current;
    if (!element) return;

    const listener = (rawEvent: Event) => {
      const { detail } = rawEvent as CustomEvent<MduiEventDetail>;
      latest.current(detail, rawEvent);
    };

    const listenerOptions: AddEventListenerOptions = { once, capture };
    if (signal) listenerOptions.signal = signal;

    element.addEventListener(event, listener, listenerOptions);
    return () => {
      element.removeEventListener(event, listener, listenerOptions);
    };
  }, [ref, event, once, capture, signal]);
}

/**
 * Subscribe to several custom events at once with one stable listener set.
 *
 * Workaround: same as {@link useMduiEvent}, plus the handler map may be a fresh
 * object literal on every render — only the *set of event names* is treated as a
 * dependency, so the listeners survive re-renders.
 */
export function useMduiEvents(
  ref: RefObject<HTMLElement | null>,
  handlers: Record<string, MduiEventHandler>,
): void {
  const latest = useRef(handlers);
  useIsomorphicLayoutEffect(() => {
    latest.current = handlers;
  });

  // A primitive dependency, so a new-but-equivalent handler object does not
  // retrigger the effect.
  const eventKey = useMemo(() => Object.keys(handlers).sort().join(' '), [handlers]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !eventKey) return;

    const names = eventKey.split(' ');
    const bound = names.map((name) => {
      const listener: EventListener = (rawEvent) => {
        const handler = latest.current[name];
        if (!handler) return;
        const { detail } = rawEvent as CustomEvent<MduiEventDetail>;
        handler(detail, rawEvent);
      };
      element.addEventListener(name, listener);
      return { name, listener };
    });

    return () => {
      for (const { name, listener } of bound) {
        element.removeEventListener(name, listener);
      }
    };
  }, [ref, eventKey]);
}

/**
 * Assign JS *properties* on a custom element after every render.
 *
 * Workaround: React only knows how to serialise props into HTML attributes.
 * `value={['a','b']}`, `value={0.5}`, `value={false}` or `labelFormatter={fn}`
 * cannot survive an attribute round-trip, and attribute names are kebab-cased
 * while mdui property names are camelCase. Writing the properties in an effect
 * guarantees the element receives real values. Skipped when the element already
 * holds an equal value, so element-driven updates are not fought over.
 */
export function useMduiProperty<T extends object>(
  ref: RefObject<T | null>,
  props: Partial<Record<keyof T, unknown>>,
): void {
  // Intentionally dependency-free: mdui writes are cheap and the equality guard
  // keeps this to a no-op in the common case, while any prop change is picked up.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const target = element as unknown as Record<string, unknown>;
    for (const key of Object.keys(props) as (keyof T & string)[]) {
      const next = props[key];
      if (next === undefined) continue;
      if (shallowEqual(target[key], next)) continue;
      try {
        target[key] = next;
      } catch (error) {
        console.warn(`[mdui] cannot assign property "${key}"`, error);
      }
    }
  });
}

/**
 * One-shot imperative access to the underlying element.
 *
 * Workaround: mdui exposes imperative APIs (`dialog.open = true`,
 * `textField.focus()`, `dialog.close()`) that have no declarative equivalent.
 * A React ref is populated *after* render but *before* effects, so the element
 * cannot be observed during the render that created it — this returns `null` on
 * that first render and the live element from the next one onwards. Imperative
 * calls therefore belong in an effect, never during render.
 */
export function useMduiImperative<T extends HTMLElement>(ref: RefObject<T | null>): T | null {
  // `useSyncExternalStore` is the supported way to read a non-reactive external
  // value (a ref) during render: React calls the snapshot getter itself and
  // re-renders when it changes, instead of caching a stale copy in state.
  return useSyncExternalStore(
    // A ref never notifies, so the subscription is intentionally inert.
    () => () => {},
    () => ref.current,
    () => null,
  );
}

/**
 * `true` once the custom element definition for `tag` is available.
 *
 * Useful for FOUC-free progressive enhancement: render a skeleton until the
 * element is upgraded.
 */
export function useMduiDefined(tag: string): boolean {
  const [defined, setDefined] = useState(false);

  useEffect(() => {
    if (typeof customElements === 'undefined') return;
    // Already upgraded — `isElementDefined()` below reports that without
    // needing a state update.
    if (customElements.get(tag)) return;

    let cancelled = false;
    // Async callback, so this is a subscription rather than a cascading render.
    void customElements.whenDefined(tag).then(() => {
      if (!cancelled) setDefined(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tag]);

  return defined || isElementDefined(tag);
}

function isElementDefined(tag: string): boolean {
  return typeof customElements !== 'undefined' && customElements.get(tag) !== undefined;
}

/**
 * Two-way binding for mdui's value-ish properties.
 *
 * Workaround: mdui form components keep their value as a JS property and only
 * announce changes through custom events, so neither half of a controlled
 * React component is expressible in JSX alone. This hook:
 *
 * 1. writes `ref.current[prop] = value` in an effect whenever React's `value`
 *    differs from the element's current value (skipped when `value` is
 *    `undefined`, which marks the component as uncontrolled), and
 * 2. calls `setValue` with `ref.current[prop]` whenever `event` fires.
 *
 * Duplicate reports for the same value are swallowed, so listening to several
 * events (e.g. `<mdui-slider>` `input` + `change`) is safe.
 *
 * @param prop property that holds the value. Defaults to `'value'`; use
 *             `'checked'` for `<mdui-checkbox>` / `<mdui-switch>`.
 */
export function useMduiModel<T>(
  ref: RefObject<HTMLElement | null>,
  value: T,
  setValue: (next: T) => void,
  event: string,
  prop = 'value',
): T {
  const latestSetter = useRef(setValue);
  /** Last value handed to `setValue`, used to swallow duplicate reports. */
  const reported = useRef(value);

  useIsomorphicLayoutEffect(() => {
    latestSetter.current = setValue;
  });

  useMduiEvent(ref, event, () => {
    const element = ref.current;
    if (!element) return;
    const next = (element as unknown as Record<string, unknown>)[prop];
    if (shallowEqual(next, reported.current)) return;
    reported.current = next as T;
    latestSetter.current(next as T);
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // `undefined` means "uncontrolled": the element owns the value and we only
    // observe it (see MduiCheckbox / MduiSwitch).
    if (value === undefined) return;
    const target = element as unknown as Record<string, unknown>;
    if (shallowEqual(target[prop], value)) return;
    target[prop] = value;
    reported.current = value;
  }, [ref, prop, value]);

  return value;
}