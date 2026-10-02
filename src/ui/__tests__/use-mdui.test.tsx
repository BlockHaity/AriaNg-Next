/**
 * Tests for the React ↔ Web Components bridge.
 *
 * The hooks are exercised against plain custom elements defined *here*, not
 * against mdui itself: jsdom does not run the Lit lifecycle, so a test that
 * depends on mdui booting would prove nothing about the adapter. These probes
 * mirror the parts of the mdui contract the hooks rely on — JS properties with
 * getters/setters, `CustomEvent`s, and array-valued properties.
 */

import { createRef, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowEqual, useMduiDefined, useMduiEvent, useMduiImperative, useMduiModel, useMduiProperty } from '../mdui/use-mdui';

/* -------------------------------------------------------------------------- */
/* test doubles                                                               */
/* -------------------------------------------------------------------------- */

/** Counts live listeners so re-subscription can be detected. */
interface Probe extends HTMLElement {
  addEventListener: HTMLElement['addEventListener'];
}
let addCalls = 0;
let removeCalls = 0;

class ProbeElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [];
  }

  private _value: string | string[] = '';
  private _checked = false;
  /** Mirrors what mdui does for JS-only properties: no attribute reflection. */
  labelFormatter?: (value: number) => string;

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    addCalls += 1;
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    removeCalls += 1;
    super.removeEventListener(type, listener, options);
  }

  get value(): string | string[] {
    return this._value;
  }

  set value(next: string | string[]) {
    this._value = next;
  }

  get checked(): boolean {
    return this._checked;
  }

  set checked(next: boolean) {
    this._checked = next;
  }

  /** Mimics a user interacting with the element. */
  emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  /** Mimics an element-driven state change followed by its event. */
  userSet(next: string | string[]): void {
    this.value = next;
    this.emit('change');
  }

  userCheck(next: boolean): void {
    this.checked = next;
    this.emit('change');
  }
}

if (!customElements.get('x-probe')) {
  customElements.define('x-probe', ProbeElement);
}

function createProbe(): Probe {
  return document.createElement('x-probe') as Probe;
}

/**
 * Mounts a probe element and returns it, so the event tests can dispatch real
 * `CustomEvent`s against a live custom element.
 */
function renderWithProbe(children: (ref: RefObject<HTMLElement | null>) => ReactNode) {
  const ref = createRef<HTMLElement>();

  function Host() {
    return <>{children(ref)}</>;
  }

  const view = render(<Host />);
  const element = ref.current as Probe;
  return { element, view };
}

afterEach(() => {
  addCalls = 0;
  removeCalls = 0;
});

/* -------------------------------------------------------------------------- */
/* shallowEqual                                                               */
/* -------------------------------------------------------------------------- */

describe('shallowEqual', () => {
  it('compares primitives and arrays element-wise', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(shallowEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(shallowEqual(['a'], ['a', 'b'])).toBe(false);
    expect(shallowEqual(['a'], 'a')).toBe(false);
  });

  it('treats NaN as equal to itself', () => {
    expect(shallowEqual(Number.NaN, Number.NaN)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* useMduiEvent                                                               */
/* -------------------------------------------------------------------------- */

describe('useMduiEvent', () => {
  it('attaches on mount and detaches on unmount', () => {
    const handler = vi.fn();
    const { element, view } = renderWithProbe((ref) => {
      useMduiEvent(ref, 'change', handler);
      return <x-probe ref={ref} />;
    });

    expect(addCalls).toBeGreaterThan(0);

    act(() => {
      element.emit('change', { value: 'a' });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ value: 'a' });
    expect(handler.mock.calls[0][1]).toBeInstanceOf(Event);

    view.unmount();
    expect(removeCalls).toBeGreaterThan(0);

    handler.mockClear();
    act(() => {
      element.emit('change');
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not re-subscribe for a new inline handler but still calls it', () => {
    const first = vi.fn();
    const second = vi.fn();

    function Probe({ handler }: { handler: (detail: unknown) => void }) {
      const ref = useRef<HTMLElement>(null);
      useMduiEvent(ref, 'change', handler);
      return <x-probe ref={ref} />;
    }

    const view = render(<Probe handler={first} />);
    const element = document.querySelector('x-probe') as Probe;
    const addsAfterMount = addCalls;

    act(() => {
      element.emit('change');
    });
    expect(first).toHaveBeenCalledTimes(1);

    // Same event name, brand new inline function identity.
    view.rerender(<Probe handler={() => second('latest')} />);

    // No extra addEventListener call: the listener is bound exactly once.
    expect(addCalls).toBe(addsAfterMount);
    expect(removeCalls).toBe(0);

    act(() => {
      element.emit('change');
    });
    expect(first).toHaveBeenCalledTimes(1);
    // The *latest* handler ran, not the stale one.
    expect(second).toHaveBeenCalledWith('latest');

    view.unmount();
  });

  it('tolerates a null ref on the first effect run', () => {
    const handler = vi.fn();

    function Orphan() {
      // Never attached to any element.
      useMduiEvent({ current: null }, 'change', handler);
      return <div />;
    }

    expect(() => render(<Orphan />)).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('respects the `once` option', () => {
    const handler = vi.fn();
    const ref = createRef<HTMLElement>();

    function Once() {
      useMduiEvent(ref, 'change', handler, { once: true });
      return <x-probe ref={ref} />;
    }

    render(<Once />);
    const element = document.querySelector('x-probe') as Probe;

    act(() => {
      element.emit('change');
      element.emit('change');
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* useMduiProperty                                                            */
/* -------------------------------------------------------------------------- */

describe('useMduiProperty', () => {
  it('assigns JS properties, not attributes', () => {
    const ref = createRef<HTMLElement>();
    render(<x-probe ref={ref} />);

    const element = ref.current as Probe;

    function Assign() {
      useMduiProperty(ref, { value: ['a', 'b'], labelFormatter: (v: number) => `${v}px` });
      return null;
    }

    render(<Assign />);

    expect(element.value).toEqual(['a', 'b']);
    expect(typeof element.labelFormatter).toBe('function');
    // The whole point: nothing leaked into the attribute layer.
    expect(element.hasAttribute('value')).toBe(false);
    expect(element.hasAttribute('labelformatter')).toBe(false);
  });

  it('writes booleans as properties too', () => {
    const ref = createRef<HTMLElement>();
    render(<x-probe ref={ref} />);
    const element = ref.current as Probe;

    function Assign() {
      useMduiProperty(ref, { checked: true });
      return null;
    }

    render(<Assign />);
    expect(element.checked).toBe(true);
    expect(element.hasAttribute('checked')).toBe(false);
  });

  it('skips values that are already equal, including equal arrays', () => {
    const ref = createRef<HTMLElement>();
    render(<x-probe ref={ref} />);
    const element = ref.current as Probe;
    element.value = ['a', 'b'];

    const setter = vi.fn();
    function Assign({ value }: { value: string[] }) {
      useMduiProperty(ref, { value });
      // Track writes by spying on the setter through the prototype.
      setter(value);
      return null;
    }

    const view = render(<Assign value={['a', 'b']} />);
    expect(setter).toHaveBeenCalledTimes(1);

    view.rerender(<Assign value={['a', 'b']} />);
    expect(setter).toHaveBeenCalledTimes(2);
    // Equal content => no write; a fresh array identity does not force one.
    expect(element.value).toEqual(['a', 'b']);
  });

  it('ignores undefined values', () => {
    const ref = createRef<HTMLElement>();
    render(<x-probe ref={ref} />);
    const element = ref.current as Probe;
    element.value = 'keep';

    function Assign() {
      useMduiProperty(ref, { value: undefined });
      return null;
    }

    render(<Assign />);
    expect(element.value).toBe('keep');
  });
});

/* -------------------------------------------------------------------------- */
/* useMduiModel                                                               */
/* -------------------------------------------------------------------------- */

describe('useMduiModel', () => {
  it('writes the value to the property after mount', () => {
    const ref = createRef<HTMLElement>();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, () => {}, 'change');
      return <x-probe ref={ref} />;
    }

    render(<Field value="hello" />);
    expect((ref.current as Probe).value).toBe('hello');
  });

  it('writes again when the prop changes', () => {
    const ref = createRef<HTMLElement>();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, () => {}, 'change');
      return <x-probe ref={ref} />;
    }

    const view = render(<Field value="a" />);
    const element = ref.current as Probe;
    view.rerender(<Field value="b" />);
    expect(element.value).toBe('b');
  });

  it('does not write when the value is unchanged (element-owned state survives)', () => {
    const ref = createRef<HTMLElement>();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, () => {}, 'change');
      return <x-probe ref={ref} />;
    }

    render(<Field value="a" />);
    const element = ref.current as Probe;

    // The element changes itself without React knowing (uncontrolled-ish usage).
    element.value = 'user-typed';
    // A re-render with the *same* prop must not clobber it back.
    render(<Field value="a" />);
    expect(element.value).toBe('user-typed');
  });

  it('reports user interaction through the setter', () => {
    const ref = createRef<HTMLElement>();
    const onChange = vi.fn();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, onChange, 'change');
      return <x-probe ref={ref} />;
    }

    render(<Field value="a" />);
    const element = ref.current as Probe;

    act(() => {
      element.userSet('b');
    });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('de-duplicates repeated reports of the same value', () => {
    const ref = createRef<HTMLElement>();
    const onChange = vi.fn();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, onChange, 'change');
      return <x-probe ref={ref} />;
    }

    render(<Field value="a" />);
    const element = ref.current as Probe;

    act(() => {
      element.userSet('b');
      element.emit('change');
      element.emit('change');
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('supports a non-`value` property (checkbox pattern)', () => {
    const ref = createRef<HTMLElement>();
    const onChange = vi.fn();

    function Box({ checked }: { checked: boolean }) {
      useMduiModel(ref, checked, onChange, 'change', 'checked');
      return <x-probe ref={ref} />;
    }

    render(<Box checked={false} />);
    const element = ref.current as Probe;

    act(() => {
      element.userCheck(true);
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('handles array values without reserialising on every render', () => {
    const ref = createRef<HTMLElement>();

    function Collapse({ value }: { value: string[] }) {
      useMduiModel(ref, value, () => {}, 'change');
      return <x-probe ref={ref} />;
    }

    const view = render(<Collapse value={['a']} />);
    const element = ref.current as Probe;
    expect(element.value).toEqual(['a']);

    // A new array with the same contents must not be written back.
    view.rerender(<Collapse value={['a']} />);
    expect(element.value).toEqual(['a']);

    view.rerender(<Collapse value={['a', 'b']} />);
    expect(element.value).toEqual(['a', 'b']);
  });
});

/* -------------------------------------------------------------------------- */
/* useMduiImperative                                                          */
/* -------------------------------------------------------------------------- */

describe('useMduiImperative', () => {
  it('returns the element after mount', () => {
    let captured: HTMLElement | null = null;

    function Imperative() {
      const ref = useRef<HTMLElement>(null);
      const element = useMduiImperative(ref);
      captured = element;
      return <x-probe ref={ref} />;
    }

    render(<Imperative />);
    expect(captured).not.toBeNull();
    expect((captured as unknown as HTMLElement).tagName.toLowerCase()).toBe('x-probe');
  });

  it('returns null on the very first render', () => {
    const seen: (HTMLElement | null)[] = [];

    function Imperative() {
      const ref = useRef<HTMLElement>(null);
      seen.push(useMduiImperative(ref));
      return <x-probe ref={ref} />;
    }

    render(<Imperative />);
    expect(seen[0]).toBeNull();
    expect(seen[seen.length - 1]).not.toBeNull();
  });

  it('keeps a stable identity across re-renders', () => {
    const seen: (HTMLElement | null)[] = [];

    function Imperative({ tick }: { tick: number }) {
      const ref = useRef<HTMLElement>(null);
      seen.push(useMduiImperative(ref));
      return (
        <div>
          <span data-tick={tick} />
          <x-probe ref={ref} />
        </div>
      );
    }

    const view = render(<Imperative tick={0} />);
    view.rerender(<Imperative tick={1} />);
    view.rerender(<Imperative tick={2} />);

    const resolved = seen.filter((element): element is HTMLElement => element !== null);
    expect(resolved.length).toBeGreaterThan(0);
    // Every non-null observation is the very same node.
    expect(new Set(resolved).size).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* useMduiDefined                                                             */
/* -------------------------------------------------------------------------- */

describe('useMduiDefined', () => {
  it('reports true for an already registered tag', () => {
    function Probe() {
      const defined = useMduiDefined('x-probe');
      return <div data-defined={String(defined)} />;
    }

    const { container } = render(<Probe />);
    expect(container.firstElementChild?.getAttribute('data-defined')).toBe('true');
  });

  it('resolves once an unknown tag is registered', async () => {
    let resolveRegistration: (() => void) | undefined;

    function Probe() {
      const defined = useMduiDefined('x-late-probe');
      return <div data-defined={String(defined)} />;
    }

    const { container } = render(<Probe />);
    expect(container.firstElementChild?.getAttribute('data-defined')).toBe('false');

    await act(async () => {
      customElements.define('x-late-probe', class extends HTMLElement {});
      resolveRegistration = () => {};
      resolveRegistration();
      await Promise.resolve();
    });

    expect(container.firstElementChild?.getAttribute('data-defined')).toBe('true');
  });

  it('does not throw for a tag that is never registered', () => {
    function Probe() {
      const defined = useMduiDefined('x-never-defined');
      return <div data-defined={String(defined)} />;
    }

    expect(() => render(<Probe />)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* sanity: the probe behaves like an mdui element                              */
/* -------------------------------------------------------------------------- */

describe('probe sanity', () => {
  it('dispatches events with a detail payload', () => {
    const element = createProbe();
    const received: unknown[] = [];
    element.addEventListener('change', (event) => received.push((event as CustomEvent).detail));
    element.emit('change', 42);
    expect(received).toEqual([42]);
  });
});