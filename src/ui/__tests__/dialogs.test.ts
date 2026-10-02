/**
 * Tests for the promise-based dialog helpers.
 *
 * mdui's `dialog()` / `snackbar()` are mocked: jsdom cannot run the Lit
 * lifecycle, and what is under test here is the *adapter* — the promise
 * settlement, the option mapping, and above all the guarantee that a failure can
 * never propagate to the caller.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogMock = vi.fn();
const snackbarMock = vi.fn();

vi.mock('mdui/functions/dialog.js', () => ({
  dialog: (options: unknown) => dialogMock(options),
}));

vi.mock('mdui/functions/snackbar.js', () => ({
  snackbar: (options: unknown) => snackbarMock(options),
}));

const { alertDialog, confirmDialog, promptDialog, registerDialogTypes, snackbarMessage } = await import(
  '../mdui/dialogs'
);

/** Fake `<mdui-dialog>`: enough surface for the helpers to poke at. */
function fakeDialog(): HTMLElement {
  const element = document.createElement('div');
  // `dialog()` returns the instance; the helpers only ever call `appendChild` and
  // `querySelectorAll` on it.
  return element;
}

/**
 * Simulate mdui's `dialog()` and capture the options, while building the
 * `[slot="action"]` buttons the real implementation would create.
 */
function stubDialog(behaviour: 'confirm' | 'cancel' | 'closed' | 'throw' = 'closed') {
  dialogMock.mockImplementation((options: { actions?: { text?: string; onClick?: () => unknown }[]; onClosed?: () => void }) => {
    if (behaviour === 'throw') throw new Error('mdui exploded');
    const instance = fakeDialog();
    for (const action of options.actions ?? []) {
      const button = document.createElement('mdui-button');
      button.setAttribute('slot', 'action');
      button.textContent = action.text ?? '';
      if (behaviour === 'confirm') button.addEventListener('click', () => action.onClick?.());
      if (behaviour === 'cancel') button.addEventListener('click', () => action.onClick?.());
      instance.appendChild(button);
    }
    if (behaviour === 'closed') queueMicrotask(() => options.onClosed?.());
    return instance;
  });
}

beforeEach(() => {
  dialogMock.mockReset();
  snackbarMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */
/* confirmDialog                                                              */
/* -------------------------------------------------------------------------- */

describe('confirmDialog', () => {
  it('resolves true when the confirm action runs', async () => {
    stubDialog('confirm');
    const promise = confirmDialog({ heading: 'Delete?', okText: 'Delete', cancelText: 'Cancel' });

    // Click the last action button — mdui appends them in order.
    const buttons = dialogMock.mock.results[0].value.querySelectorAll('[slot="action"]');
    const last = buttons[buttons.length - 1];
    expect(last.textContent).toBe('Delete');
    last.dispatchEvent(new Event('click'));

    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when the cancel action runs', async () => {
    stubDialog('confirm');
    const promise = confirmDialog({ heading: 'Delete?', okText: 'Delete', cancelText: 'Cancel' });

    const buttons = dialogMock.mock.results[0].value.querySelectorAll('[slot="action"]');
    expect(buttons[0].textContent).toBe('Cancel');
    buttons[0].dispatchEvent(new Event('click'));

    await expect(promise).resolves.toBe(false);
  });

  it('resolves false when the dialog is dismissed without an action', async () => {
    stubDialog('closed');
    await expect(confirmDialog({ heading: 'Delete?' })).resolves.toBe(false);
  });

  it('passes headline / description / close flags through to mdui', async () => {
    stubDialog('closed');
    await confirmDialog({
      heading: 'Remove task',
      text: 'This cannot be undone.',
      closeOnEsc: false,
      closeOnOverlayClick: false,
    });

    const options = dialogMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.headline).toBe('Remove task');
    expect(options.description).toBe('This cannot be undone.');
    expect(options.closeOnEsc).toBe(false);
    expect(options.closeOnOverlayClick).toBe(false);
  });

  it('omits the cancel button when no cancelText is given', async () => {
    stubDialog('closed');
    await confirmDialog({ heading: 'Notice' });
    const options = dialogMock.mock.calls[0][0] as { actions: unknown[] };
    expect(options.actions).toHaveLength(1);
  });

  it('resolves false (never throws) when mdui throws synchronously', async () => {
    dialogMock.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(confirmDialog({ heading: 'x' })).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* alertDialog                                                                */
/* -------------------------------------------------------------------------- */

describe('alertDialog', () => {
  it('resolves when the dialog closes', async () => {
    stubDialog('closed');
    await expect(alertDialog({ heading: 'Heads up', text: 'Something happened.' })).resolves.toBeUndefined();
  });

  it('resolves even when mdui throws', async () => {
    dialogMock.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(alertDialog({ heading: 'x' })).resolves.toBeUndefined();
  });

  it('uses a single action', async () => {
    stubDialog('closed');
    await alertDialog({ heading: 'x', okText: 'Got it' });
    const options = dialogMock.mock.calls[0][0] as { actions: { text?: string }[] };
    expect(options.actions).toHaveLength(1);
    expect(options.actions[0].text).toBe('Got it');
  });
});

/* -------------------------------------------------------------------------- */
/* promptDialog                                                               */
/* -------------------------------------------------------------------------- */

describe('promptDialog', () => {
  it('resolves the entered value when the confirm action runs', async () => {
    stubDialog('confirm');
    const promise = promptDialog({ heading: 'Rename', value: 'old.txt' });

    const instance = dialogMock.mock.results[0].value as HTMLElement;
    const input = instance.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('old.txt');
    input.value = 'new.txt';

    const buttons = instance.querySelectorAll('[slot="action"]');
    buttons[buttons.length - 1].dispatchEvent(new Event('click'));

    await expect(promise).resolves.toBe('new.txt');
  });

  it('resolves null on cancel', async () => {
    stubDialog('confirm');
    const promise = promptDialog({ heading: 'Rename', cancelText: 'Nope' });

    const instance = dialogMock.mock.results[0].value as HTMLElement;
    const buttons = instance.querySelectorAll('[slot="action"]');
    buttons[0].dispatchEvent(new Event('click'));

    await expect(promise).resolves.toBeNull();
  });

  it('resolves null when dismissed without an action', async () => {
    stubDialog('closed');
    await expect(promptDialog({ heading: 'Rename' })).resolves.toBeNull();
  });

  it('resolves null (never throws) when mdui throws', async () => {
    dialogMock.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(promptDialog({ heading: 'x' })).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('uses the requested input type', async () => {
    stubDialog('closed');
    await promptDialog({ heading: 'Token', type: 'password' });
    const instance = dialogMock.mock.results[0].value as HTMLElement;
    expect((instance.querySelector('input') as HTMLInputElement).type).toBe('password');
  });
});

/* -------------------------------------------------------------------------- */
/* snackbarMessage                                                            */
/* -------------------------------------------------------------------------- */

describe('snackbarMessage', () => {
  it('forwards the message and the action text', () => {
    snackbarMessage({ message: 'Task finished', actionText: 'Undo', timeout: 2000, position: 'top' });

    const options = snackbarMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.message).toBe('Task finished');
    expect(options.action).toBe('Undo');
    expect(options.autoCloseDelay).toBe(2000);
    expect(options.placement).toBe('top');
  });

  it('invokes onAction when the action is clicked', () => {
    const onAction = vi.fn();
    snackbarMessage({ message: 'Deleted', actionText: 'Undo', onAction });

    const options = snackbarMock.mock.calls[0][0] as {
      onActionClick: () => void;
    };
    options.onActionClick();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from mdui', () => {
    snackbarMock.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => snackbarMessage({ message: 'x' })).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* registerDialogTypes                                                        */
/* -------------------------------------------------------------------------- */

describe('registerDialogTypes', () => {
  it('is idempotent and never throws', () => {
    expect(() => {
      registerDialogTypes();
      registerDialogTypes();
    }).not.toThrow();
  });
});