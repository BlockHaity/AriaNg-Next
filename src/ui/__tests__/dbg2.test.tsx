import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { registerMduiComponents } from '../mdui/registry';
import type { TextField } from 'mdui/components/text-field.js';

describe('dbg2', () => {
  it('what is field?', async () => {
    await registerMduiComponents();
    const seen: unknown[] = [];
    function Host() {
      const ref = useRef<HTMLElement>(null);
      const field = ref.current as unknown as TextField | null;
      seen.push({ current: field, ctor: (field as unknown as { constructor?: { name?: string } })?.constructor?.name });
      return <mdui-text-field ref={ref} label="x" />;
    }
    render(<Host />);
    expect(seen).toEqual([]);
  });
});
