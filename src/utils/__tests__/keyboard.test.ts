import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_SHORTCUT_DESCRIPTIONS,
  bindGlobalShortcuts,
  isBackspacePressed,
  isCtrlAPressed,
  isCtrlEnterPressed,
  isCtrlFPressed,
  isDeletePressed,
  isEditableTarget,
  isMacLike,
} from '../keyboard';

/**
 * A `KeyboardEvent` built by hand: jsdom refuses to construct a keyboard event
 * with a `keyCode`, and AriaNg's handlers only ever read `code` / `keyCode` /
 * `key` / `metaKey` / `ctrlKey`, so a plain object cast is both simpler and a
 * better probe of exactly those fields.
 */
function keyEvent(init: {
  code?: string;
  key?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}) {
  return {
    code: init.code ?? '',
    key: init.key ?? '',
    keyCode: init.keyCode ?? 0,
    ctrlKey: init.ctrlKey === true,
    metaKey: init.metaKey === true,
    target: init.target ?? null,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

/** `navigator.platform` / `navigator.userAgentData.platform` override. */
function setPlatform(value: string, useUserAgentData = false) {
  if (useUserAgentData) {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { platform: value },
    });
    return;
  }
  Object.defineProperty(navigator, 'platform', { configurable: true, value });
}

const originalUserAgentData = (navigator as Navigator & { userAgentData?: unknown }).userAgentData;

beforeEach(() => {
  setPlatform('Win32');
});

afterEach(() => {
  if (originalUserAgentData === undefined) {
    Reflect.deleteProperty(navigator, 'userAgentData');
  } else {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: originalUserAgentData,
    });
  }
});

describe('isMacLike', () => {
  it('reads userAgentData.platform when present', () => {
    setPlatform('macOS', true);
    expect(isMacLike()).toBe(true);

    setPlatform('Windows', true);
    expect(isMacLike()).toBe(false);
  });

  it('falls back to navigator.platform', () => {
    setPlatform('MacIntel');
    expect(isMacLike()).toBe(true);
    setPlatform('Linux x86_64');
    expect(isMacLike()).toBe(false);
  });

  it('recognises iOS as mac-like', () => {
    setPlatform('iPhone');
    expect(isMacLike()).toBe(true);
  });
});

describe('modifier key', () => {
  it('uses Ctrl on non-mac platforms', () => {
    setPlatform('Win32');
    expect(isCtrlAPressed(keyEvent({ code: 'KeyA', ctrlKey: true }))).toBe(true);
    // The mac key must not trigger anything on windows/linux.
    expect(isCtrlAPressed(keyEvent({ code: 'KeyA', metaKey: true }))).toBe(false);
  });

  it('uses ⌘ on mac-like platforms', () => {
    setPlatform('MacIntel');
    expect(isCtrlAPressed(keyEvent({ code: 'KeyA', metaKey: true }))).toBe(true);
    expect(isCtrlAPressed(keyEvent({ code: 'KeyA', ctrlKey: true }))).toBe(false);
  });
});

describe('key matching', () => {
  beforeEach(() => setPlatform('Win32'));

  it('accepts event.code', () => {
    expect(isCtrlAPressed(keyEvent({ code: 'KeyA', ctrlKey: true }))).toBe(true);
    expect(isCtrlFPressed(keyEvent({ code: 'KeyF', ctrlKey: true }))).toBe(true);
    expect(isCtrlEnterPressed(keyEvent({ code: 'Enter', ctrlKey: true }))).toBe(true);
    expect(isDeletePressed(keyEvent({ code: 'Delete' }))).toBe(true);
    expect(isBackspacePressed(keyEvent({ code: 'Backspace' }))).toBe(true);
  });

  it('accepts the legacy keyCode (65 / 70 / 13 / 46 / 8)', () => {
    expect(isCtrlAPressed(keyEvent({ keyCode: 65, ctrlKey: true }))).toBe(true);
    expect(isCtrlFPressed(keyEvent({ keyCode: 70, ctrlKey: true }))).toBe(true);
    expect(isCtrlEnterPressed(keyEvent({ keyCode: 13, ctrlKey: true }))).toBe(true);
    expect(isDeletePressed(keyEvent({ keyCode: 46 }))).toBe(true);
    expect(isBackspacePressed(keyEvent({ keyCode: 8 }))).toBe(true);
  });

  it('rejects the wrong key entirely', () => {
    expect(isCtrlAPressed(keyEvent({ code: 'KeyB', ctrlKey: true }))).toBe(false);
    expect(isCtrlFPressed(keyEvent({ code: 'KeyF' }))).toBe(false);
    expect(isDeletePressed(keyEvent({ code: 'Backspace' }))).toBe(false);
    expect(isBackspacePressed(keyEvent({ code: 'Delete' }))).toBe(false);
  });
});

describe('isCtrlEnterPressed', () => {
  it('accepts ⌘ Return on mac', () => {
    setPlatform('MacIntel');
    expect(isCtrlEnterPressed(keyEvent({ key: 'Enter', metaKey: true }))).toBe(true);
  });

  it('accepts Ctrl + Enter on the numpad (no code, only key)', () => {
    setPlatform('Win32');
    expect(isCtrlEnterPressed(keyEvent({ key: 'Enter', ctrlKey: true }))).toBe(true);
  });
});

describe('isEditableTarget', () => {
  it('is true for input[type=text]', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isEditableTarget(input)).toBe(true);
  });

  it('is true for a textarea', () => {
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
  });

  it('is false for input[type=checkbox]', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    expect(isEditableTarget(input)).toBe(false);
  });

  it('is false for the body and for other form controls', () => {
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(document.createElement('select'))).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });

  it('is false for null / non-elements', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined as unknown as EventTarget | null)).toBe(false);
    expect(isEditableTarget({} as unknown as EventTarget)).toBe(false);
  });

  it('is true for a text input without an explicit type attribute', () => {
    // <input> defaults to type="text" in the DOM.
    const input = document.createElement('input');
    expect(input.type).toBe('text');
    expect(isEditableTarget(input)).toBe(true);
  });
});

describe('GLOBAL_SHORTCUT_DESCRIPTIONS', () => {
  it('lists the four AriaNg rows in order', () => {
    expect(GLOBAL_SHORTCUT_DESCRIPTIONS).toEqual([
      { keys: 'Delete', action: 'Remove Selected Task' },
      { keys: 'Ctrl/⌘+A', action: 'Select All Tasks' },
      { keys: 'Ctrl/⌘+F', action: 'Set Focus On Search Box' },
      { keys: 'Ctrl/⌘+Enter', action: 'Download Now' },
    ]);
  });
});

describe('bindGlobalShortcuts', () => {
  let unbind: (() => void) | null = null;

  afterEach(() => {
    unbind?.();
    unbind = null;
  });

  function bind(handlers: Parameters<typeof bindGlobalShortcuts>[0], options?: Parameters<typeof bindGlobalShortcuts>[1]) {
    unbind = bindGlobalShortcuts(handlers, options);
    return unbind;
  }

  it('returns an unbind function that removes the listener', () => {
    const onSelectAll = vi.fn();
    bind({ onSelectAll });

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);

    unbind?.();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('is registered in the capture phase', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    try {
      bind({});
      expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    } finally {
      spy.mockRestore();
    }
  });

  it('fires onSelectAll / onDelete / onFocusSearch', () => {
    const onSelectAll = vi.fn();
    const onDelete = vi.fn();
    const onFocusSearch = vi.fn();
    bind({ onSelectAll, onDelete, onFocusSearch });

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', ctrlKey: true }));

    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });

  it('preventDefaults Ctrl+F so the browser find bar stays away', () => {
    bind({});
    const event = new KeyboardEvent('keydown', {
      code: 'KeyF',
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('respects the enabled gate', () => {
    const onSelectAll = vi.fn();
    let enabled = false;
    bind({ onSelectAll }, { enabled: () => enabled });

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true }));
    expect(onSelectAll).not.toHaveBeenCalled();

    enabled = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('skips Ctrl+A and Delete while a text input has focus (AriaNg rule)', () => {
    const onSelectAll = vi.fn();
    const onDelete = vi.fn();
    const onFocusSearch = vi.fn();
    bind({ onSelectAll, onDelete, onFocusSearch });

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true, bubbles: true }),
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete', bubbles: true }));

    expect(onSelectAll).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    // Ctrl+F still works inside the search box — that is its purpose.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyF', ctrlKey: true, bubbles: true }),
    );
    expect(onFocusSearch).toHaveBeenCalledTimes(1);

    input.remove();
  });

  it('keeps Delete working for a checkbox target', () => {
    const onDelete = vi.fn();
    bind({ onDelete });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);

    checkbox.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete', bubbles: true }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    checkbox.remove();
  });

  it('can bind to an explicit target', () => {
    const onDelete = vi.fn();
    const target = document.createElement('div');
    bind({ onDelete }, { target });

    target.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    // Not on window any more.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('tolerates a target that cannot take listeners', () => {
    const detach = bindGlobalShortcuts({}, { target: {} as unknown as EventTarget });
    expect(() => detach()).not.toThrow();
  });
});
