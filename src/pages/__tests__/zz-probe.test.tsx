import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useMduiEvent } from '@/ui/mdui/use-mdui';
import { useRef } from 'react';

function Harness() {
  const ref = useRef<HTMLElement>(null);
  const seen: string[] = [];
  (globalThis as Record<string, unknown>).__seen = seen;
  useMduiEvent(ref, 'click', () => seen.push('mdui-click'));
  return (
    <div>
      <mdui-menu-item ref={ref}>hi</mdui-menu-item>
    </div>
  );
}

describe('probe', () => {
  it('native vs dispatched', () => {
    const { container } = render(<Harness />);
    const item = container.querySelector('mdui-menu-item') as HTMLElement;
    const seen = (globalThis as Record<string, unknown>).__seen as string[];

    item.click();
    const afterNative = [...seen];

    item.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const afterDispatch = [...seen];

    item.dispatchEvent(new CustomEvent('click', { bubbles: true }));
    const afterCustom = [...seen];

    expect({ afterNative, afterDispatch, afterCustom }).toEqual('SHOW');
  });
});