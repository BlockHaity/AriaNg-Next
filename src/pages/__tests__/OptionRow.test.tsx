import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OptionRow } from '@/components/option-row';
import type { OptionRowProps } from '@/components/option-row';
import { addSettingHistory, clearSettingHistories } from '@/store/history';
import { createI18n } from '@/i18n/i18n';
import { getLocaleLoaderFor } from '@/i18n/locales';
import { I18nProvider } from '@/i18n/react';

/** A store with the English table already loaded, so `t()` resolves. */
const i18n = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });

/**
 * React 19 writes props on a custom element as **properties** (that is what
 * mdui's Lit properties need), and mdui keeps the real `<input>`/`<textarea>`
 * inside its shadow root — so the host element is what a test drives.
 */
type MduiHost = HTMLElement & {
  value: string;
  label?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
};

const fieldsOf = (container: HTMLElement): MduiHost[] =>
  Array.from(container.querySelectorAll('mdui-text-field')) as unknown as MduiHost[];

const selectOf = (container: HTMLElement): MduiHost | null =>
  container.querySelector('mdui-select') as unknown as MduiHost | null;

/** The visible text of the rendered `<mdui-select>` items, in order. */
const selectItems = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('mdui-menu-item')).map((item) => (item.textContent ?? '').trim());

const rowOf = (container: HTMLElement): HTMLElement => {
  const row = container.querySelector('.option-row');
  if (!row) throw new Error('no option row rendered');
  return row as HTMLElement;
};

/** Simulates typing: `useMduiModel` reads the property when `input` fires. */
function type(field: MduiHost, value: string): void {
  act(() => {
    field.value = value;
    field.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { value } }));
  });
}

/** Simulates picking from a `<mdui-select>`, which reports `change`. */
function choose(field: MduiHost, value: string): void {
  act(() => {
    field.value = value;
    field.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value } }));
  });
}

/** Runs the pending debounce (and the promise chain behind it). */
async function flushSave(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

function renderRow(props: Partial<OptionRowProps> & { optionKey: string }) {
  const onChange = props.onChange ?? vi.fn(() => true);
  // `value` is required by the contract but genuinely optional here: `undefined`
  // is exactly what "the caller has no value yet" means.
  const resolved: OptionRowProps = { ...props, value: props.value, onChange };

  const view = render(
    <I18nProvider i18n={i18n}>
      <OptionRow {...resolved} />
    </I18nProvider>,
  );

  return { container: view.container, onChange };
}

beforeAll(async () => {
  await i18n.ready();
});

beforeEach(() => {
  clearSettingHistories();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OptionRow — control per option type', () => {
  it('renders a text field for string rows', () => {
    const { container } = renderRow({ optionKey: 'out' });

    expect(fieldsOf(container)).toHaveLength(1);
    expect(selectOf(container)).toBeNull();
    expect(rowOf(container)).toHaveTextContent('File Name');
    expect(rowOf(container)).toHaveTextContent('(out)');
  });

  it('renders a six-row text area for text rows', () => {
    const { container } = renderRow({ optionKey: 'header' });

    expect(fieldsOf(container)[0].rows).toBe(6);
  });

  it.each(['retry-wait', 'seed-ratio'])('renders a text field for the numeric row %s', (optionKey) => {
    const { container } = renderRow({ optionKey });

    expect(fieldsOf(container)).toHaveLength(1);
    expect(selectOf(container)).toBeNull();
  });

  it('renders a select with two items for boolean rows', () => {
    const { container } = renderRow({ optionKey: 'check-integrity' });

    expect(selectOf(container)).not.toBeNull();
    expect(fieldsOf(container)).toHaveLength(0);
    expect(selectItems(container)).toEqual(['True', 'False']);
  });

  it('renders a select with the catalogue options for option rows', () => {
    const { container } = renderRow({ optionKey: 'file-allocation' });

    // `option.none` has a translation ("None"); the rest are shown verbatim.
    expect(selectItems(container)).toEqual(['None', 'prealloc', 'trunc', 'falloc']);
  });

  it('renders a select plus a free-text field for string-or-option rows', () => {
    const { container } = renderRow({ optionKey: 'media-video' });

    expect(selectItems(container)).toEqual(['best', 'None']);
    // The free-text field is the one control beside the select.
    expect(fieldsOf(container)).toHaveLength(1);
    expect(fieldsOf(container)[0].label).toBe('Custom');
  });

  it('puts a track id typed into the free-text field through unchanged', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'media-video', onChange, lazySaveTimeout: 0 });

    type(fieldsOf(container)[0], 'trk-7');
    await flushSave();

    expect(onChange).toHaveBeenCalledWith('trk-7', 'media-video');
  });

  it('shows the key label, the aria2 key name and the since note', () => {
    const { container } = renderRow({ optionKey: 'dir' });
    const row = rowOf(container);

    expect(row.querySelector('.option-row__label')).toHaveTextContent('Download Path');
    expect(row.querySelector('.option-row__key-name')).toHaveTextContent('(dir)');
    // `dir` has an empty description in en.ts, so no `?` affordance.
    expect(row.querySelector('.option-row__help')).toBeNull();
    expect(row.querySelector('.option-row__since')).toHaveTextContent('Requires aria2');
  });

  it('shows the description in the help tooltip when i18n has one', () => {
    const { container } = renderRow({ optionKey: 'all-proxy' });
    const help = container.querySelector('.option-row__help') as HTMLButtonElement | null;

    expect(help).not.toBeNull();
    expect(help?.getAttribute('aria-label')).toContain('proxy');
  });

  it('uses the aria2-next translation overlay for a key AriaNg never had', () => {
    const { container } = renderRow({ optionKey: 'media-pause-after-probe' });

    // AriaNg has no media support, so this key can only come from
    // src/i18n/extensions.ts. Getting the real label proves the overlay is wired
    // into the English table rather than the row title-casing the key.
    expect(container.querySelector('.option-row__label')).toHaveTextContent('Pause After Probe');
    expect(container.querySelector('.option-row__label')).not.toHaveTextContent('media-pause-after-probe');

    // The help tooltip prefers the translated description over the raw
    // `aria2NextNote`, which is what the overlay buys us.
    const help = container.querySelector('.option-row__help')?.getAttribute('aria-label') ?? '';
    expect(help).toContain('pause before fetching payload segments');
  });

  it('falls back to a title-cased key and the aria2-next note when nothing else exists', () => {
    // `gid` is internal, has no i18n entry and no note, so the row must still
    // render something readable rather than an empty label.
    const { container } = renderRow({ optionKey: 'gid' });

    expect(container.querySelector('.option-row__label')?.textContent?.trim()).not.toBe('');
  });
});

describe('OptionRow — Bytes suffix hint', () => {
  it('renders the translated unit addon', () => {
    const { container } = renderRow({ optionKey: 'max-download-limit' });

    expect(container.querySelector('.option-row__suffix')).toHaveTextContent('Bytes');
  });

  it('humanizes the global value for a Bytes option and leaves others alone', () => {
    const bytes = renderRow({ optionKey: 'max-download-limit', globalValue: '1048576' });
    expect(fieldsOf(bytes.container)[0].placeholder).toBe('1M');

    const seconds = renderRow({ optionKey: 'retry-wait', globalValue: '30' });
    expect(fieldsOf(seconds.container)[0].placeholder).toBe('30');
  });
});

describe('OptionRow — read-only and removed options', () => {
  it('disables the input of a readonly option', () => {
    const { container } = renderRow({ optionKey: 'input-file' });

    expect(fieldsOf(container)[0].disabled).toBe(true);
  });

  it('disables the input when the caller marks the row read-only', () => {
    const { container } = renderRow({ optionKey: 'dir', readOnly: true });

    expect(fieldsOf(container)[0].disabled).toBe(true);
  });

  it('never saves a read-only row', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'input-file', onChange, lazySaveTimeout: 0 });

    type(fieldsOf(container)[0], 'in.txt');
    await flushSave();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the warning note and disables a removed option', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'split', onChange, lazySaveTimeout: 0 });
    const warning = container.querySelector('.option-row__warning');

    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain('removed');
    expect(warning?.textContent).toContain('aria2-next');
    expect(fieldsOf(container)[0].disabled).toBe(true);

    // A disabled input cannot be typed into, but the guard is defensive too.
    type(fieldsOf(container)[0], '4');
    await flushSave();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('OptionRow — debounced save', () => {
  it('does not save before lazySaveTimeout and does after it', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'out', lazySaveTimeout: 500, onChange });

    type(fieldsOf(container)[0], 'a.zip');
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('a.zip', 'out');
  });

  it('collapses a burst of edits into one save', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'out', lazySaveTimeout: 500, onChange });
    const field = fieldsOf(container)[0];

    type(field, 'a');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    type(field, 'ab');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    type(field, 'abc');
    await flushSave();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('abc', 'out');
  });

  it('saves a select choice immediately, without waiting for the debounce', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'check-integrity', lazySaveTimeout: 500, onChange });

    choose(selectOf(container) as MduiHost, 'true');

    expect(onChange).toHaveBeenCalledWith('true', 'check-integrity');
  });

  it('marks the row failed when onChange returns false', async () => {
    vi.useFakeTimers();
    const { container } = renderRow({
      optionKey: 'out',
      lazySaveTimeout: 0,
      onChange: vi.fn(() => false),
    });

    type(fieldsOf(container)[0], 'a.zip');
    await flushSave();

    expect(rowOf(container).dataset.status).toBe('failed');
  });

  it('marks the row successful for a promise-returning onChange', async () => {
    vi.useFakeTimers();
    const { container } = renderRow({
      optionKey: 'out',
      lazySaveTimeout: 0,
      onChange: vi.fn(async () => true),
    });

    type(fieldsOf(container)[0], 'a.zip');
    await flushSave();

    expect(rowOf(container).dataset.status).toBe('success');
  });

  it('commits an empty value when Backspace is pressed in an empty box', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'out', onChange, lazySaveTimeout: 0 });

    act(() => {
      fieldsOf(container)[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
    });
    await flushSave();

    expect(onChange).toHaveBeenCalledWith('', 'out');
  });

  it('leaves a non-empty box alone on Backspace (the input event covers it)', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'out', value: 'a.zip', onChange, lazySaveTimeout: 0 });

    act(() => {
      fieldsOf(container)[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
      );
    });
    await flushSave();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('OptionRow — validation feedback', () => {
  it('rejects an invalid number and shows the tooltip after the delay', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'max-concurrent-downloads', lazySaveTimeout: 0, onChange });

    type(fieldsOf(container)[0], 'abc');

    expect(onChange).not.toHaveBeenCalled();
    expect(rowOf(container).dataset.status).toBe('error');
    // The message is announced immediately…
    expect(screen.getByRole('status')).toHaveTextContent('Input number is invalid!');
    // …but the tooltip waits for AriaNg's 500 ms delay.
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Input number is invalid!');
  });

  it('reports the min and max bounds with their value', () => {
    vi.useFakeTimers();
    const { container } = renderRow({ optionKey: 'retry-wait', lazySaveTimeout: 0, onChange: vi.fn() });
    const field = fieldsOf(container)[0];

    type(field, '601');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('above max value 600');

    type(field, '-1');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('below min value 0');
  });

  it('closes the tooltip again as soon as the value is accepted', () => {
    vi.useFakeTimers();
    const { container } = renderRow({ optionKey: 'max-concurrent-downloads', lazySaveTimeout: 0, onChange: vi.fn() });
    const field = fieldsOf(container)[0];

    type(field, 'abc');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    type(field, '4');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(rowOf(container).dataset.status).not.toBe('error');
  });

  it('rejects an empty value for a required option', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({ optionKey: 'dir', value: '/downloads', lazySaveTimeout: 0, onChange });

    type(fieldsOf(container)[0], '');

    expect(onChange).not.toHaveBeenCalled();
    expect(rowOf(container).dataset.status).toBe('error');
    expect(screen.getByRole('status')).toHaveTextContent('Option value cannot be empty!');
  });

  it('skips the empty check when the caller disables `required`', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({
      optionKey: 'dir',
      value: '/downloads',
      lazySaveTimeout: 0,
      disableRequired: true,
      onChange,
    });

    type(fieldsOf(container)[0], '');
    await flushSave();

    expect(onChange).toHaveBeenCalledWith('', 'dir');
  });
});

describe('OptionRow — append mode', () => {
  it('shows the global value read-only above the input and submits only the new text', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = renderRow({
      optionKey: 'header',
      globalValue: 'X-Global: 1',
      onChange,
      lazySaveTimeout: 0,
    });
    const fixed = container.querySelector('.option-row__fixed-value') as HTMLElement;

    expect(fixed.tagName).toBe('PRE');
    expect(fixed).toHaveTextContent('X-Global: 1');

    // The input starts empty: the global value is a prefix, not a default.
    expect(fieldsOf(container)[0].value).toBe('');

    type(fieldsOf(container)[0], 'X-Task: 2');
    await flushSave();

    expect(onChange).toHaveBeenCalledWith('X-Task: 2', 'header');
    expect(fixed).toHaveTextContent('X-Global: 1');
  });

  it('adds up the item counts of the fixed value and the input', () => {
    const { container } = renderRow({ optionKey: 'header', globalValue: 'X-Global: 1\nX-Global: 2' });

    expect(container.querySelector('.option-row__count')).toHaveTextContent('(Total Count: 2)');
  });
});

describe('OptionRow — input history', () => {
  it('lists the stored values and filters them by prefix', () => {
    addSettingHistory('dir', '/downloads/anime');
    addSettingHistory('dir', '/downloads/movies');
    addSettingHistory('dir', '/media');

    const { container } = renderRow({ optionKey: 'dir', showHistory: true, onChange: vi.fn() });

    expect(screen.getByText('/downloads/anime')).toBeInTheDocument();
    expect(screen.getByText('/media')).toBeInTheDocument();

    type(fieldsOf(container)[0], '/downloads/a');

    expect(screen.getByText('/downloads/anime')).toBeInTheDocument();
    expect(screen.queryByText('/downloads/movies')).toBeNull();
    expect(screen.queryByText('/media')).toBeNull();
  });

  it('drops the dropdown entirely when nothing matches (AriaNg: only-show-non-empty)', () => {
    addSettingHistory('dir', '/downloads');

    const { container } = renderRow({ optionKey: 'dir', showHistory: true, onChange: vi.fn() });

    type(fieldsOf(container)[0], '/zzz');

    expect(container.querySelector('.option-history__list')).toBeNull();
    // Custom input is still allowed.
    expect(fieldsOf(container)[0].value).toBe('/zzz');
  });

  it('commits a value picked from the history immediately', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    addSettingHistory('dir', '/downloads/anime');
    const { container } = renderRow({ optionKey: 'dir', showHistory: true, onChange, lazySaveTimeout: 500 });

    act(() => {
      screen.getByRole('button', { name: '/downloads/anime' }).click();
    });

    expect(onChange).toHaveBeenCalledWith('/downloads/anime', 'dir');
    expect(fieldsOf(container)[0].value).toBe('/downloads/anime');
  });

  it('renders no history list at all without showHistory', () => {
    addSettingHistory('dir', '/downloads');

    const { container } = renderRow({ optionKey: 'dir', onChange: vi.fn() });

    expect(container.querySelector('.option-history__list')).toBeNull();
  });
});

describe('OptionRow — value binding', () => {
  it('shows the value it is given', () => {
    const { container } = renderRow({ optionKey: 'out', value: 'given.zip' });

    expect(fieldsOf(container)[0].value).toBe('given.zip');
  });

  it('keeps a rejected value on screen', () => {
    const { container } = renderRow({ optionKey: 'out', value: undefined, onChange: vi.fn(() => false) });

    type(fieldsOf(container)[0], 'typed.zip');

    expect(fieldsOf(container)[0].value).toBe('typed.zip');
  });
});