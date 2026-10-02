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
import {
  shallowEqual,
  useMduiDefined,
  useMduiEvent,
  useMduiImperative,
  useMduiModel,
  useMduiProperty,
} from '../mdui/use-mdui';

import type * as ReactTypes from 'react';

// `<x-probe />` in TSX. Merged into the same `React.JSX.IntrinsicElements` that
// `mdui/jsx.en.d.ts` augments — interfaces merge, so both sets coexist.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace React {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
      interface IntrinsicElements {
        'x-probe': ReactTypes.DetailedHTMLProps<ReactTypes.HTMLAttributes<HTMLElement>, HTMLElement>;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* test double                                                                */
/* -------------------------------------------------------------------------- */

/** The surface the tests rely on, mirroring what mdui's elements expose. */
interface Probe extends HTMLElement {
  value: string | string[];
  checked: boolean;
  /** JS-only property: mdui has no attribute form for functions. */
  labelFormatter?: (value: number) => string;
  /** Mimics an mdui `CustomEvent`. */
  emit(name: string, detail?: unknown): void;
  /** Mimics the element changing its own value and announcing it. */
  userSet(next: string | string[]): void;
  /** Mimics a checkbox being toggled. */
  userCheck(next: boolean): void;
}

/** Counts live subscriptions so re-subscription can be detected. */
let addCalls = 0;
let removeCalls = 0;

class ProbeElement extends HTMLElement {
  private _value: string | string[] = '';
  private _checked = false;
  labelFormatter?: (value: number) => string;

  // Signature copied verbatim from `lib.dom.d.ts` so the override type-checks.
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    addCalls += 1;
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
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

  emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

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

/**
 * Mounts a probe element and returns it, so the event tests can dispatch real
 * `CustomEvent`s against a live custom element.
 */
function renderWithProbe(children: (ref: RefObject<Probe | null>) => ReactNode) {
  const ref = createRef<Probe>();

  function Host() {
    return <>{children(ref)}</>;
  }

  const view = render(<Host />);
  return { element: ref.current as Probe, view };
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

    function Host({ handler }: { handler: (detail: unknown) => void }) {
      const ref = useRef<Probe>(null);
      useMduiEvent(ref, 'change', handler);
      return <x-probe ref={ref} />;
    }

    const view = render(<Host handler={first} />);
    const element = document.querySelector('x-probe') as Probe;
    const addsAfterMount = addCalls;

    act(() => {
      element.emit('change');
    });
    expect(first).toHaveBeenCalledTimes(1);

    // Same event name, brand new inline function identity.
    view.rerender(
      <Host
        handler={() => {
          second('latest');
        }}
      />,
    );

    // No extra addEventListener call: the listener stays bound exactly once.
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
    const ref = createRef<Probe>();

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
    const ref = createRef<Probe>();
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
    const ref = createRef<Probe>();
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

  it('does not rewrite a value the element already holds', () => {
    const ref = createRef<Probe>();
    render(<x-probe ref={ref} />);
    const element = ref.current as Probe;
    element.value = ['a', 'b'];

    const written: string[][] = [];
    function Assign({ value }: { value: string[] }) {
      useMduiProperty(ref, { value });
      written.push(value);
      return null;
    }

    const view = render(<Assign value={['a', 'b']} />);
    expect(written).toHaveLength(1);

    // A *new* array with identical contents must not be pushed back into the
    // element, otherwise every render would reset internal selection state.
    view.rerender(<Assign value={['a', 'b']} />);
    view.rerender(<Assign value={['a', 'b']} />);
    expect(element.value).toEqual(['a', 'b']);

    view.rerender(<Assign value={['a', 'c']} />);
    expect(element.value).toEqual(['a', 'c']);
  });

  it('ignores undefined values', () => {
    const ref = createRef<Probe>();
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
    const ref = createRef<Probe>();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, () => {}, 'change');
      return <x-probe ref={ref} />;
    }

    render(<Field value="hello" />);
    expect((ref.current as Probe).value).toBe('hello');
  });

  it('writes again when the prop changes', () => {
    const ref = createRef<Probe>();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, () => {}, 'change');
      return <x-probe ref={ref} />;
    }

    const view = render(<Field value="a" />);
    const element = ref.current as Probe;
    view.rerender(<Field value="b" />);
    expect(element.value).toBe('b');
  });

  it('does not clobber element-owned state when the prop is unchanged', () => {
    const ref = createRef<Probe>();

    function Field({ value }: { value: string }) {
      useMduiModel(ref, value, () => {}, 'change');
      return <x-probe ref={ref} />;
    }

    render(<Field value="a" />);
    const element = ref.current as Probe;

    // The element changes itself without React knowing.
    element.value = 'user-typed';
    // A re-render with the *same* prop must not reset it back.
    const view = render(<Field value="a" />);
    expect(element.value).toBe('user-typed');
    view.unmount();
  });

  it('reports user interaction through the setter', () => {
    const ref = createRef<Probe>();
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
    const ref = createRef<Probe>();
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

  it('uses the latest setter across re-renders', () => {
    const ref = createRef<Probe>();
    const stale = vi.fn();
    const fresh = vi.fn();

    function Field({ value, onChange }: { value: string; onChange: (next: string) => void }) {
      useMduiModel(ref, value, onChange, 'change');
      return <x-probe ref={ref} />;
    }

    const view = render(<Field value="a" onChange={stale} />);
    view.rerender(<Field value="a" onChange={fresh} />);

    (ref.current as Probe).userSet('z');
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledWith('z');
  });

  it('supports a non-`value` property (the checkbox pattern)', () => {
    const ref = createRef<Probe>();
    const onChange = vi.fn();

    function Box({ checked }: { checked: boolean }) {
      useMduiModel(ref, checked, onChange, 'change', 'checked');
      return <x-probe ref={ref} />;
    }

    render(<Box checked={false} />);
    const element = ref.current as Probe;
    expect(element.checked).toBe(false);

    act(() => {
      element.userCheck(true);
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('leaves the element in charge when the value is undefined', () => {
    const ref = createRef<Probe>();
    const onChange = vi.fn();

    function Field() {
      useMduiModel<string | undefined>(ref, undefined, onChange, 'change');
      return <x-probe ref={ref} />;
    }

    render(<Field />);
    const element = ref.current as Probe;
    element.value = 'element-owned';

    act(() => {
      element.emit('change');
    });
    expect(element.value).toBe('element-owned');
    expect(onChange).toHaveBeenCalledWith('element-owned');
  });

  it('handles array values without reserialising on every render', () => {
    const ref = createRef<Probe>();

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
    const seen: (HTMLElement | null)[] = [];

    function Imperative() {
      const ref = useRef<Probe>(null);
      seen.push(useMduiImperative(ref));
      return <x-probe ref={ref} />;
    }

    render(<Imperative />);
    expect(seen[seen.length - 1]).not.toBeNull();
    expect((seen[seen.length - 1] as HTMLElement).tagName.toLowerCase()).toBe('x-probe');
  });

  it('returns null on the very first render', () => {
    const seen: (HTMLElement | null)[] = [];

    function Imperative() {
      const ref = useRef<Probe>(null);
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
      const ref = useRef<Probe>(null);
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
    function Host() {
      const defined = useMduiDefined('x-probe');
      return <div data-defined={String(defined)} />;
    }

    const { container } = render(<Host />);
    expect(container.firstElementChild?.getAttribute('data-defined')).toBe('true');
  });

  it('resolves once an unknown tag is registered', async () => {
    function Host() {
      const defined = useMduiDefined('x-late-probe');
      return <div data-defined={String(defined)} />;
    }

    const { container } = render(<Host />);
    expect(container.firstElementChild?.getAttribute('data-defined')).toBe('false');

    await act(async () => {
      customElements.define('x-late-probe', class extends HTMLElement {});
      await Promise.resolve();
    });

    expect(container.firstElementChild?.getAttribute('data-defined')).toBe('true');
  });

  it('does not throw for a tag that is never registered', () => {
    function Host() {
      const defined = useMduiDefined('x-never-defined');
      return <div data-defined={String(defined)} />;
    }

    expect(() => render(<Host />)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* sanity: the probe behaves like an mdui element                              */
/* -------------------------------------------------------------------------- */

describe('probe sanity', () => {
  it('dispatches events with a detail payload', () => {
    const element = document.createElement('x-probe') as Probe;
    const received: unknown[] = [];
    element.addEventListener('change', (event) => received.push((event as CustomEvent).detail));
    element.emit('change', 42);
    expect(received).toEqual([42]);
  });

  it('stores properties, never attributes', () => {
    const element = document.createElement('x-probe') as Probe;
    element.value = 'x';
    expect(element.getAttribute('value')).toBeNull();
  });
});