/**
 * Tests for `/debug`.
 *
 * Three things need stubbing before anything works:
 *
 * - **mdui's dialog functions.** jsdom cannot run the Lit lifecycle, so
 *   `confirmDialog` / `alertDialog` are driven through a fake `<mdui-dialog>`
 *   that exposes the `[slot="action"]` buttons the real one builds. That is
 *   what makes "Clear Logs asks first" and "Access Denied navigates on OK"
 *   real tests rather than mock call assertions.
 * - **the RPC client.** A fake one is attached to the store, exactly as the
 *   shell does.
 * - **the log ring buffer.** It is module-global, so each test seeds and
 *   clears it through the public `debug()` / `error()` / `clearDebugLogs()`
 *   surface, with debug mode switched on (the buffer only records then, which
 *   is AriaNg's own rule).
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DebugPage from '../DebugPage';
import { LogDetailDialog } from '../debug/LogDetailDialog';
import { RpcStatus } from '@/config/rpc-constants';
import { mapRpcError } from '@/rpc/errors';
import { clearInPage } from '@/store/notifications';
import {
  clearDebugLogs,
  debug as logDebug,
  error as logError,
  info as logInfo,
  LogLevel,
  warn as logWarn,
} from '@/store/logs';
import type { LogEntry } from '@/store/logs';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import type { Aria2Client, RpcResult } from '@/rpc/contract';

/* -------------------------------------------------------------------------- */
/* mdui dialogs                                                               */
/* -------------------------------------------------------------------------- */

const dialogMock = vi.fn();

vi.mock('mdui/functions/dialog.js', () => ({
  dialog: (options: unknown) => dialogMock(options),
}));

vi.mock('mdui/functions/snackbar.js', () => ({
  snackbar: () => undefined,
}));

// `<mdui-text-field>` and `<mdui-select>` are deliberately left undefined. Their
// Lit implementations measure / validate nodes inside the shadow root after
// every value change, and jsdom neither lays out nor completes a Lit render, so
// they reject with a TypeError. `mdui-select` is mocked as well because it
// imports the text field by *relative* path, which a bare-specifier mock does
// not intercept. Nothing under test depends on that behaviour: both controls are
// driven through their JS `value` property, exactly as `useMduiModel` does.
vi.mock('mdui/components/text-field.js', () => ({}));
vi.mock('mdui/components/select.js', () => ({}));

// Same reasoning for `<mdui-dialog>`: opening it animates with the Web
// Animations API and traps focus, neither of which jsdom implements. The
// promise-based dialog helpers are unaffected — they go through
// `mdui/functions/dialog.js`, mocked above.
vi.mock('mdui/components/dialog.js', () => ({}));

/** What the next `dialog()` call does when nobody presses a button. */
let dialogDismissal: 'dismiss' | 'confirm' = 'dismiss';

/** Clicks the nth action button of the most recent dialog. */
async function pressDialogAction(index: number): Promise<void> {
  const instance = dialogMock.mock.results.at(-1)?.value as HTMLElement | undefined;
  const buttons = instance?.querySelectorAll('[slot="action"]') ?? [];
  const target = buttons[index] ?? buttons[buttons.length - 1];
  if (!target) throw new Error('the dialog exposed no action buttons');
  await act(async () => {
    target.dispatchEvent(new Event('click'));
  });
}

/* -------------------------------------------------------------------------- */
/* fake client                                                                */
/* -------------------------------------------------------------------------- */

interface FakeInvoke {
  success: boolean;
  data?: unknown;
  message?: string;
}

function createFakeClient(invokeResult: FakeInvoke = { success: true, data: { version: '1.37.0' } }) {
  const invoke = vi.fn(
    async (): Promise<RpcResult<unknown>> =>
      invokeResult.success
        ? { success: true, data: invokeResult.data, context: { method: 'test' } }
        : // The real client always runs a failure through `mapRpcError`, which
          // is what attaches the translation tip `describeError` reports.
          { success: false, error: mapRpcError(invokeResult.message ?? 'boom'), context: { method: 'test' } },
  );

  return {
    profile: {
      isDefault: true,
      rpcAlias: '',
      rpcHost: 'localhost',
      rpcPort: '6800',
      rpcInterface: 'jsonrpc',
      protocol: 'http',
      httpMethod: 'POST',
      rpcRequestHeaders: '',
      secret: '',
    },
    connection: { status: RpcStatus.Connected, attempt: 0 },
    supportsNotifications: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onEvent: vi.fn(() => () => {}),
    invoke,
    buildCall: vi.fn(() => ['aria2.getVersion', []] as [string, unknown[]]),
    getVersion: vi.fn(async () => ({ success: true, data: { version: '1', enabledFeatures: [] }, context: { method: 'g' } })),
    getSessionInfo: vi.fn(async () => ({ success: false, error: { message: 'x' }, context: { method: 'g' } })),
    saveSession: vi.fn(async () => ({ success: true, data: 'OK', context: { method: 'g' } })),
    shutdown: vi.fn(async () => ({ success: true, data: 'OK', context: { method: 'g' } })),
    listMethods: vi.fn(async () => ({
      success: true,
      data: ['aria2.tellStatus', 'aria2.tellActive', 'aria2.saveSession'],
      context: { method: 'system.listMethods' },
    })),
    listNotifications: vi.fn(async () => ({ success: true, data: [], context: { method: 'l' } })),
  };
}

function useFakeClient(invokeResult?: FakeInvoke) {
  const client = createFakeClient(invokeResult);
  useRpcStore.getState().attachClient(client as unknown as Aria2Client);
  useRpcStore.setState({ connection: { status: RpcStatus.Connected, attempt: 0 }, version: undefined });
  return client;
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/debug']}>
      <Routes>
        <Route path="/debug" element={<DebugPage />} />
        <Route path="/settings/ariang" element={<div>aria2 settings page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Selects a tab by writing the `value` property and firing `change`. */
function openTab(container: HTMLElement, value: string): void {
  const tabs = container.querySelector('mdui-tabs') as (HTMLElement & { value: string }) | null;
  if (!tabs) throw new Error('no <mdui-tabs>');
  act(() => {
    tabs.value = value;
    tabs.dispatchEvent(new CustomEvent('change', { bubbles: true }));
  });
}

/**
 * A touch drag on `element`.
 *
 * jsdom does not build `TouchEvent`s, and `bindSwipeGestures` only ever reads
 * `clientX` / `clientY`, so a plain `Event` with a `touches` / `changedTouches`
 * list is enough.
 */
function swipe(element: HTMLElement, fromX: number, toX: number, y = 0): void {
  const touchEvent = (type: string, x: number) => {
    const event = new Event(type) as Event & { touches?: unknown[]; changedTouches?: unknown[] };
    const point = [{ clientX: x, clientY: y }];
    Object.defineProperty(event, 'touches', { value: point });
    Object.defineProperty(event, 'changedTouches', { value: point });
    return event;
  };

  act(() => {
    element.dispatchEvent(touchEvent('touchstart', fromX));
    element.dispatchEvent(touchEvent('touchend', toX));
  });
}

function select(container: HTMLElement, className: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`mdui-select.${className}`);
  if (!found) throw new Error(`no select with class ${className}`);
  return found;
}

function change(element: HTMLElement, value: string): void {
  (element as unknown as Record<string, unknown>).value = value;
  element.dispatchEvent(new CustomEvent('change', { bubbles: true }));
}

function button(container: HTMLElement, label: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('mdui-button')).find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found;
}

function textField(container: HTMLElement, className: string): HTMLElement & { value: string } {
  const found = container.querySelector<HTMLElement & { value: string }>(`mdui-text-field.${className}`);
  if (!found) throw new Error(`no text field with class ${className}`);
  return found;
}

/** Types into an mdui text field the way a user would. */
function type(element: HTMLElement, value: string): void {
  (element as unknown as Record<string, unknown>).value = value;
  element.dispatchEvent(new CustomEvent('input', { bubbles: true }));
}

/** Clicks a plain element React listens to through its synthetic system. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** The rendered log messages, in order. */
function logMessages(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.ariang-log-content')).map(
    (node) => node.textContent ?? '',
  );
}

/* -------------------------------------------------------------------------- */
/* setup                                                                       */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  dialogMock.mockReset();
  dialogDismissal = 'dismiss';
  dialogMock.mockImplementation((options: { actions?: { text?: string; onClick?: () => void }[]; onClosed?: () => void }) => {
    const instance = document.createElement('div');
    for (const action of options.actions ?? []) {
      const node = document.createElement('mdui-button');
      node.setAttribute('slot', 'action');
      node.textContent = action.text ?? '';
      // mdui runs the action and *then* closes the dialog; both matter here,
      // because `alertDialog` only settles on `closed`.
      node.addEventListener('click', () => {
        action.onClick?.();
        queueMicrotask(() => options.onClosed?.());
      });
      instance.appendChild(node);
    }
    if (dialogDismissal === 'dismiss') {
      queueMicrotask(() => options.onClosed?.());
    }
    return instance;
  });

  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useSettingsStore.getState().setSessionDebugMode(true);
  clearDebugLogs();
  clearInPage();
});

afterEach(() => {
  clearDebugLogs();
  clearInPage();
  useSettingsStore.getState().setSessionDebugMode(false);
  useRpcStore.setState({ client: null, connection: { status: RpcStatus.Disconnected, attempt: 0 } });
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* the access gate                                                             */
/* -------------------------------------------------------------------------- */

describe('DebugPage — access gate', () => {
  it('shows the Access Denied dialog and hides the console when debug mode is off', async () => {
    useFakeClient();
    useSettingsStore.getState().setSessionDebugMode(false);
    // The dialog stays open until a button is pressed.
    dialogDismissal = 'confirm';

    const { container } = renderPage();

    await waitFor(() => expect(dialogMock).toHaveBeenCalledTimes(1));
    const options = dialogMock.mock.calls[0][0] as { headline?: string; description?: string };
    expect(options.description).toBe('Access Denied!');
    // AriaNg showed nothing at all behind the dialog (`ng-show`).
    expect(container.textContent).toBe('');
  });

  it('navigates to the AriaNg settings once OK is pressed', async () => {
    useFakeClient();
    useSettingsStore.getState().setSessionDebugMode(false);
    dialogDismissal = 'confirm';

    renderPage();

    await waitFor(() => expect(dialogMock).toHaveBeenCalled());
    await pressDialogAction(0);

    await waitFor(() => expect(screen.getByText('aria2 settings page')).toBeInTheDocument());
  });

  it('navigates when the dialog is merely dismissed', async () => {
    useFakeClient();
    useSettingsStore.getState().setSessionDebugMode(false);

    renderPage();

    // AriaNg's `showError` callback ran on *any* dialog close, dismissal
    // included, so ESC led to the settings page too.
    await waitFor(() => expect(screen.getByText('aria2 settings page')).toBeInTheDocument());
  });

  it('renders the console and never asks when debug mode is on', async () => {
    useFakeClient();
    renderPage();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(dialogMock).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* the tabs                                                                    */
/* -------------------------------------------------------------------------- */

describe('DebugPage — tabs', () => {
  it('offers "Latest 100 Logs" and "Aria2 RPC Debug"', () => {
    useFakeClient();
    const { container } = renderPage();

    expect(container.textContent).toContain('Latest 100 Logs');
    expect(container.textContent).toContain('Aria2 RPC Debug');
  });

  it('exposes the ARIA tab pattern', () => {
    useFakeClient();
    renderPage();

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('switches tabs on a swipe and stops at the ends', () => {
    useFakeClient();
    const { container } = renderPage();

    const page = container.querySelector('.ariang-debug-page') as HTMLElement;
    const activeTab = () => screen.getAllByRole('tab').findIndex((tab) => tab.getAttribute('aria-selected') === 'true');

    expect(activeTab()).toBe(0);

    // Swipe right on the first tab has nowhere to go (AriaNg refused it too).
    swipe(page, 100, 200);
    expect(activeTab()).toBe(0);

    swipe(page, 200, 100);
    expect(activeTab()).toBe(1);

    // …and neither does a second left swipe.
    swipe(page, 200, 100);
    expect(activeTab()).toBe(1);

    swipe(page, 100, 200);
    expect(activeTab()).toBe(0);
  });

  it('ignores a swipe when the gesture setting is off', () => {
    useFakeClient();
    useSettingsStore.getState().set('swipeGesture', false);

    const { container } = renderPage();
    const page = container.querySelector('.ariang-debug-page') as HTMLElement;

    swipe(page, 200, 100);
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('ignores a mostly vertical drag', () => {
    useFakeClient();
    const { container } = renderPage();
    const page = container.querySelector('.ariang-debug-page') as HTMLElement;

    swipe(page, 200, 100, 250);
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });
});

/* -------------------------------------------------------------------------- */
/* latest logs                                                                 */
/* -------------------------------------------------------------------------- */

describe('LatestLogsTab', () => {
  beforeEach(() => {
    useFakeClient();
  });

  it('renders a live region with every cached line', () => {
    logDebug('a debug line');
    logInfo('an info line');

    const { container } = renderPage();

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    // `time:desc` is the default, so the newest line leads.
    expect(logMessages(container)).toEqual(['[AriaNg INFO] an info line', '[AriaNg DEBUG] a debug line']);
  });

  it('sorts newest first by default and flips on the Logging Time header', async () => {
    logInfo('older');
    logInfo('newer');

    const { container } = renderPage();
    expect(logMessages(container)).toEqual(['[AriaNg INFO] newer', '[AriaNg INFO] older']);

    const header = container.querySelector('.ariang-logs-sort') as HTMLElement;
    expect(header.getAttribute('data-order')).toBe('time:desc');

    await click(header);

    const reversed = container.querySelector('.ariang-logs-sort') as HTMLElement;
    expect(reversed.getAttribute('data-order')).toBe('time:asc');
    expect(logMessages(container)).toEqual(['[AriaNg INFO] older', '[AriaNg INFO] newer']);
  });

  it('filters on the MINIMUM level, not an exact match', async () => {
    logDebug('d');
    logInfo('i');
    logWarn('w');
    logError('e');

    const { container } = renderPage();
    expect(logMessages(container)).toHaveLength(4);

    // WARN keeps WARN *and* ERROR — `filterLogsByLevel` uses `>=`.
    await act(async () => {
      change(select(container, 'ariang-log-level-select'), '3');
    });

    const visible = logMessages(container);
    expect(visible).toEqual(['[AriaNg ERROR] e', '[AriaNg WARN] w']);
  });

  it('shows nothing below the chosen level', async () => {
    logDebug('d');
    logError('e');

    const { container } = renderPage();
    await act(async () => {
      change(select(container, 'ariang-log-level-select'), '4');
    });

    expect(logMessages(container)).toEqual(['[AriaNg ERROR] e']);
  });

  it('colours the level pill from the MD3 role of the level', () => {
    logDebug('d');
    logInfo('i');
    logWarn('w');
    logError('e');

    const { container } = renderPage();
    expect(
      Array.from(container.querySelectorAll('.ariang-level-pill')).map((node) => node.getAttribute('data-level')),
    ).toEqual(['ERROR', 'WARN', 'INFO', 'DEBUG']);
  });

  it('restarts the auto-refresh interval when the rate changes', async () => {
    vi.useFakeTimers();
    logDebug('one');

    const { container } = renderPage();
    expect(logMessages(container)).toHaveLength(1);

    // Default 1000 ms.
    logDebug('two');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(logMessages(container)).toHaveLength(2);

    // "Disabled" cancels the timer entirely.
    await act(async () => {
      change(select(container, 'ariang-auto-refresh-select'), '0');
    });
    logDebug('three');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(logMessages(container)).toHaveLength(2);

    // 200 ms reloads immediately (AriaNg's `setAutoRefreshInterval`) and then
    // ticks at the new rate.
    await act(async () => {
      change(select(container, 'ariang-auto-refresh-select'), '200');
    });
    expect(logMessages(container)).toHaveLength(3);

    logDebug('four');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(logMessages(container)).toHaveLength(4);
  });

  it('Refresh Now reloads without waiting for the timer', async () => {
    const { container } = renderPage();
    expect(logMessages(container)).toHaveLength(0);

    logDebug('late arrival');
    expect(logMessages(container)).toHaveLength(0);

    await act(async () => {
      button(container, 'Refresh Now').dispatchEvent(new CustomEvent('click'));
    });
    expect(logMessages(container)).toHaveLength(1);
  });

  it('Clear Logs asks for a confirmation and does nothing when it is refused', async () => {
    logDebug('keep me');

    const { container } = renderPage();
    await act(async () => {
      button(container, 'Clear Logs').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(dialogMock).toHaveBeenCalledTimes(1));
    const options = dialogMock.mock.calls[0][0] as { headline?: string; description?: string };
    expect(options.headline).toBe('Confirm Clear');
    expect(options.description).toBe('Are you sure you want to clear debug logs?');

    await waitFor(() => expect(logMessages(container)).toHaveLength(1));
  });

  it('Clear Logs empties the buffer once the confirmation is accepted', async () => {
    logDebug('keep me');

    const { container } = renderPage();
    dialogDismissal = 'confirm';

    await act(async () => {
      button(container, 'Clear Logs').dispatchEvent(new CustomEvent('click'));
    });
    await waitFor(() => expect(dialogMock).toHaveBeenCalled());
    await pressDialogAction(1);

    await waitFor(() => expect(logMessages(container)).toHaveLength(0));
  });

  it('offers no detail link for an entry without an attachment', () => {
    logDebug('plain');
    const { container } = renderPage();
    expect(container.querySelectorAll('.ariang-log-detail-link')).toHaveLength(0);
  });
});

describe('LogDetailDialog', () => {
  const attachment = { gid: 'abc', files: ['a', 'b'] };

  it('renders the head row and the pretty-printed attachment', () => {
    const log: LogEntry = {
      id: 7,
      time: 1_700_000_000_000,
      level: LogLevel.Warn,
      content: 'something went wrong',
      attachment,
    };

    const { container } = render(<LogDetailDialog log={log} onClose={vi.fn()} />);

    expect(container.textContent).toContain('something went wrong');
    expect(container.querySelector('.ariang-level-pill')?.getAttribute('data-level')).toBe('WARN');
    expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(attachment, null, 2));
  });

  it('omits the attachment block entirely when there is none', () => {
    const { container } = render(
      <LogDetailDialog
        log={{ id: 1, time: 1_700_000_000_000, level: LogLevel.Debug, content: 'plain' }}
        onClose={vi.fn()}
      />,
    );

    expect(container.querySelector('pre')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* RPC debug tab                                                               */
/* -------------------------------------------------------------------------- */

describe('RpcDebugTab', () => {
  it('loads the method list only when the tab is opened', async () => {
    const client = useFakeClient();
    const { container } = renderPage();

    expect(client.listMethods).not.toHaveBeenCalled();

    openTab(container, 'rpc');

    await waitFor(() => expect(client.listMethods).toHaveBeenCalledTimes(1));
    expect(screen.getByText('aria2.tellStatus')).toBeInTheDocument();
    expect(screen.getByText('aria2.saveSession')).toBeInTheDocument();
  });

  it('defaults the parameters to `{}` and enables Execute', async () => {
    const client = useFakeClient();
    const { container } = renderPage();
    openTab(container, 'rpc');
    await waitFor(() => expect(client.listMethods).toHaveBeenCalled());

    expect(textField(container, 'ariang-rpc-params').value).toBe('{}');
    await waitFor(() => expect(button(container, 'Execute').hasAttribute('disabled')).toBe(false));
  });

  it('keeps Execute disabled while the parameters do not parse', async () => {
    const client = useFakeClient();
    const { container } = renderPage();
    openTab(container, 'rpc');
    await waitFor(() => expect(client.listMethods).toHaveBeenCalled());

    await act(async () => {
      type(textField(container, 'ariang-rpc-params'), '{ not json');
    });

    expect(button(container, 'Execute').hasAttribute('disabled')).toBe(true);
  });

  it('sends the stripped parameters and pretty-prints the answer', async () => {
    const client = useFakeClient({ success: true, data: { version: '1.37.0', enabledFeatures: ['BitTorrent'] } });
    const { container } = renderPage();
    openTab(container, 'rpc');
    await waitFor(() => expect(client.listMethods).toHaveBeenCalled());

    await act(async () => {
      change(select(container, 'ariang-rpc-method-select'), 'aria2.tellStatus');
      type(textField(container, 'ariang-rpc-params'), '{"silent":true,"callback":"noop","gid":"abc"}');
    });

    await act(async () => {
      button(container, 'Execute').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(client.invoke).toHaveBeenCalledTimes(1));
    // `silent` / `callback` are internal flags, never arguments.
    expect(client.invoke).toHaveBeenCalledWith({
      method: 'aria2.tellStatus',
      params: ['abc'],
      silent: true,
    });

    await waitFor(() =>
      expect(textField(container, 'ariang-rpc-response-field').value).toBe(
        JSON.stringify({ version: '1.37.0', enabledFeatures: ['BitTorrent'] }, null, 2),
      ),
    );

    // The raw request is shown too, minus the injected token.
    const raw = container.querySelector('.ariang-rpc-request')?.textContent ?? '';
    expect(JSON.parse(raw)).toMatchObject({ jsonrpc: '2.0', method: 'aria2.tellStatus', params: ['abc'] });
  });

  it('renders describeError for a known failure', async () => {
    const client = useFakeClient({ success: false, message: 'Unauthorized' });
    const { container } = renderPage();
    openTab(container, 'rpc');
    await waitFor(() => expect(client.listMethods).toHaveBeenCalled());

    await act(async () => {
      button(container, 'Execute').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() =>
      expect(textField(container, 'ariang-rpc-response-field').value).toContain('rpc.error.unauthorized'),
    );
    expect(client.invoke).toHaveBeenCalledTimes(1);
  });

  it('renders the raw message for an unknown failure', async () => {
    const client = useFakeClient({ success: false, message: 'GID not found' });
    const { container } = renderPage();
    openTab(container, 'rpc');
    await waitFor(() => expect(client.listMethods).toHaveBeenCalled());

    await act(async () => {
      button(container, 'Execute').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(textField(container, 'ariang-rpc-response-field').value).toContain('GID not found'));
  });

  it('executes on Ctrl+Enter from the parameters field', async () => {
    const client = useFakeClient();
    const { container } = renderPage();
    openTab(container, 'rpc');
    await waitFor(() => expect(client.listMethods).toHaveBeenCalled());

    const params = textField(container, 'ariang-rpc-params').parentElement as HTMLElement;

    await act(async () => {
      params.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true }),
      );
    });

    await waitFor(() => expect(client.invoke).toHaveBeenCalledTimes(1));
  });

  it('does not execute on a plain Enter', async () => {
    const client = useFakeClient();
    const { container } = renderPage();
    openTab(container, 'rpc');
    await waitFor(() => expect(client.listMethods).toHaveBeenCalled());

    const params = textField(container, 'ariang-rpc-params').parentElement as HTMLElement;

    await act(async () => {
      params.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    });

    expect(client.invoke).not.toHaveBeenCalled();
  });
});