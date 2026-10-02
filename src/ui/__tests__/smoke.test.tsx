import { describe, expect, it } from 'vitest';
import { render, act } from '@testing-library/react';
import { MDUI_COMPONENTS, hasMduiComponent, registerMduiComponents } from '../mdui/registry';
import { MduiButton, MduiTextField, MduiCheckbox, MduiDialog, MduiSnackbar, MduiTooltip, MduiIcon } from '../mdui';
import { icon, ICON_TAGS, hasIcon } from '../mdui/icons';

describe('smoke', () => {
  it('registers every component', async () => {
    await registerMduiComponents();
    const missing = MDUI_COMPONENTS.filter((t) => !hasMduiComponent(t));
    expect(missing).toEqual([]);
  });

  it('registers icons', () => {
    expect(hasIcon('download')).toBe(true);
    expect(hasIcon('outline:download')).toBe(true);
    expect(hasIcon('not-a-real-icon')).toBe(false);
    expect(ICON_TAGS.has('mdui-icon-play-arrow')).toBe(true);
    expect(ICON_TAGS.has('mdui-icon-play-arrow--outlined')).toBe(true);
    expect(icon('play-arrow')).toBe('mdui-icon-play-arrow');
    expect(icon('outline:play_arrow')).toBe('mdui-icon-play-arrow--outlined');
  });

  it('renders wrappers without throwing', async () => {
    let el: HTMLElement | null = null;
    const { container } = render(
      <div>
        <MduiButton icon="download" onClick={() => {}}>Hello</MduiButton>
        <MduiTextField value="abc" label="Url" onInput={() => {}} />
        <MduiCheckbox checked onChange={() => {}} label="Select" />
        <MduiTooltip content="tip"><MduiButton>Hover</MduiButton></MduiTooltip>
        <MduiDialog open heading="Title" description="Body" onClosed={() => {}}>content</MduiDialog>
        <MduiSnackbar open message="Saved" action="Undo" />
        <MduiIcon name="play-arrow" />
      </div>,
    );
    await act(async () => { await Promise.resolve(); });

    const button = container.querySelector('mdui-button') as HTMLElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toContain('Hello');

    const field = container.querySelector('mdui-text-field') as HTMLElement & { value: string };
    expect(field).toBeTruthy();
    expect(field.value).toBe('abc');

    const checkbox = container.querySelector('mdui-checkbox') as HTMLElement & { checked: boolean; indeterminate?: boolean };
    expect(checkbox.checked).toBe(true);

    const dialog = container.querySelector('mdui-dialog') as HTMLElement & { open: boolean };
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[slot="headline"]')).toBeNull(); // string headline -> attribute
    expect(dialog.getAttribute('headline')).toBe('Title');

    const snackbar = container.querySelector('mdui-snackbar') as HTMLElement & { open: boolean };
    expect(snackbar.open).toBe(true);

    const iconEl = container.querySelector('mdui-icon-play-arrow');
    expect(iconEl).toBeTruthy();

    el = button;
    expect(el).toBeTruthy();
  });
});
