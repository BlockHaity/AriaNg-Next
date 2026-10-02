/**
 * Tests for `/status`.
 *
 * The page reads three things and writes two:
 *   - `useRpcStore` (connection + client), `useProfilesStore` (the address),
 *   - `saveSession()` / `shutdownAria2()` from the command store,
 *   - the in-page toast queue,
 *   - the clipboard (for the diagnostics blob).
 *
 * A fake `Aria2Client` is attached to the RPC store, which is exactly how the
 * shell injects one, so `saveSession` / `shutdownAria2` (which read the
 * process-wide singleton) resolve against it too.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StatusPage, { rpcStatusTone, verdict } from '../StatusPage';
import { RpcStatus } from '@/config/rpc-constants';
import type { RpcStatusTone } from '../StatusPage';
import { clearInPage, getInPageNotices } from '@/store/notifications';
import { useProfilesStore } from '@/store/profiles';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import type { Aria2Client, RpcResult } from '@/rpc/contract';
import type { Aria2SessionInfo, Aria2VersionInfo } from '@/rpc/types';

/* -------------------------------------------------------------------------- */
/* mdui dialogs are mocked: jsdom cannot run the Lit lifecycle                */
/* -------------------------------------------------------------------------- */

const dialogMock = vi.fn();

vi.mock('mdui/functions/dialog.js', () => ({
  dialog: (options: unknown) => dialogMock(options),
}));

vi.mock('mdui/functions/snackbar.js', () => ({
  snackbar: () => undefined,
}));

/* -------------------------------------------------------------------------- */
/* doubles                                                                     */
/* -------------------------------------------------------------------------- */

interface FakeClientOptions {
  version?: Partial<Aria2VersionInfo> | null;
  sessionId?: string;
  supportsNotifications?: boolean;
  protocol?: 'http' | 'https' | 'ws' | 'wss';
  secret?: string;
}

function ok<T>(data: T): RpcResult<T> {
  return { success: true, data, context: { method: 'test' } };
}

function fail(message: string, code?: number): RpcResult<never> {
  return {
    success: false,
    error: { message, ...(code === undefined ? {} : { code }) },
    context: { method: 'test' },
  };
}

function createFakeClient(options: FakeClientOptions = {}) {
  const version: Aria2VersionInfo = {
    version: '1.37.0',
    enabledFeatures: ['BitTorrent', 'ED2K', 'HTTPS'],
    ...(options.version ?? {}),
  };

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
    connection: { status: RpcStatus.Disconnected, attempt: 0 },
    supportsNotifications: options.supportsNotifications ?? false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onEvent: vi.fn(() => () => {}),
    invoke: vi.fn(async () => ok(null)),
    buildCall: vi.fn(() => ['aria2.getVersion', []] as [string, unknown[]]),
    getVersion: vi.fn(async (): Promise<RpcResult<Aria2VersionInfo>> =>
      options.version === null ? fail('Cannot connect to aria2!') : ok(version),
    ),
    getSessionInfo: vi.fn(async (): Promise<RpcResult<Aria2SessionInfo>> =>
      options.sessionId === undefined ? fail('no session') : ok({ sessionId: options.sessionId }),
    ),
    saveSession: vi.fn(async () => ok('OK')),
    shutdown: vi.fn(async () => ok('OK')),
    listMethods: vi.fn(async () => ok([])),
    listNotifications: vi.fn(async () => ok([])),
  };
}

/** Attaches a fake client and sets the connection state the page should see. */
function useFakeClient(options: FakeClientOptions & { status?: RpcStatus } = {}) {
  const client = createFakeClient(options);
  useRpcStore.getState().attachClient(client as unknown as Aria2Client);
  useRpcStore.setState({
    connection: { status: options.status ?? RpcStatus.Connected, attempt: 0 },
    version: undefined,
  });

  if (options.protocol !== undefined) {
    useSettingsStore.getState().update({ protocol: options.protocol });
    useProfilesStore.getState().syncFromSettings();
  }
  if (options.secret !== undefined) {
    useSettingsStore.getState().update({ secret: options.secret });
    useProfilesStore.getState().syncFromSettings();
  }

  return client;
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** The `setting-key` / `setting-value` row whose label matches exactly. */
function row(container: HTMLElement, label: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('.ariang-setting-key')).find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`no row labelled "${label}"`);
  const value = found.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`row "${label}" has no value cell`);
  return value;
}

/** `<mdui-button>` that carries the given label. */
function button(container: HTMLElement, label: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('mdui-button')).find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found;
}

function statusPill(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('[data-tone]');
  if (!found) throw new Error('no status pill');
  return found;
}

function capability(container: HTMLElement, key: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-capability="${key}"]`);
  if (!found) throw new Error(`no capability row "${key}"`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* setup                                                                       */
/* -------------------------------------------------------------------------- */

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dialogMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });

  useSettingsStore.getState().setSessionDebugMode(false);
  useSettingsStore.getState().update({
    rpcAlias: '',
    rpcHost: 'localhost',
    rpcPort: '6800',
    rpcInterface: 'jsonrpc',
    protocol: 'http',
    httpMethod: 'POST',
    rpcRequestHeaders: '',
    secret: '',
  });
  useProfilesStore.getState().syncFromSettings();
  clearInPage();
});

afterEach(() => {
  clearInPage();
  useRpcStore.setState({
    client: null,
    connection: { status: RpcStatus.Disconnected, attempt: 0 },
    version: undefined,
  });
});

/* -------------------------------------------------------------------------- */
/* pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe('rpcStatusTone', () => {
  it('maps every status the way status.html did', () => {
    const expected: Record<string, RpcStatusTone> = {
      [RpcStatus.Connecting]: 'primary',
      [RpcStatus.Reconnecting]: 'primary',
      [RpcStatus.WaitingToReconnect]: 'neutral',
      [RpcStatus.Connected]: 'success',
      [RpcStatus.Disconnected]: 'danger',
    };
    for (const [status, tone] of Object.entries(expected)) {
      expect(rpcStatusTone(status)).toBe(tone);
    }
  });
});

describe('verdict', () => {
  it('treats a missing list as unknown, not as disabled', () => {
    expect(verdict(undefined, ['ED2K'])).toBe('unknown');
    expect(verdict([], ['ED2K'])).toBe('disabled');
    expect(verdict(['HTTPS'], ['ED2K'])).toBe('disabled');
    expect(verdict(['ED2K', 'HTTPS'], ['ED2K'])).toBe('enabled');
  });

  it('accepts any of several feature names', () => {
    expect(verdict(['stable-track-ids'], ['request-contexts', 'stable-track-ids'])).toBe('enabled');
  });
});

/* -------------------------------------------------------------------------- */
/* the address row                                                             */
/* -------------------------------------------------------------------------- */

describe('StatusPage — Aria2 RPC Address', () => {
  it('renders protocol://host:port/interface from the active profile', () => {
    useFakeClient();
    const { container } = render(<StatusPage />);

    expect(row(container, 'Aria2 RPC Address').textContent).toBe('http://localhost:6800/jsonrpc');
  });

  it('follows the active profile when it is switched', () => {
    useFakeClient();
    const store = useSettingsStore.getState();
    store.update({ protocol: 'ws', rpcHost: 'nas.local', rpcPort: '6801', rpcInterface: 'jsonrpc' });
    useProfilesStore.getState().syncFromSettings();

    const { container } = render(<StatusPage />);
    expect(row(container, 'Aria2 RPC Address').textContent).toBe('ws://nas.local:6801/jsonrpc');
  });
});

/* -------------------------------------------------------------------------- */
/* the status label                                                            */
/* -------------------------------------------------------------------------- */

describe('StatusPage — Aria2 Status', () => {
  it.each([
    [RpcStatus.Connecting, 'primary'],
    [RpcStatus.Reconnecting, 'primary'],
    [RpcStatus.WaitingToReconnect, 'neutral'],
    [RpcStatus.Connected, 'success'],
    [RpcStatus.Disconnected, 'danger'],
  ])('renders %s in the %s tone', async (status, tone) => {
    useFakeClient({ status });
    const { container } = render(<StatusPage />);

    expect(statusPill(container).getAttribute('data-tone')).toBe(tone);
    expect(statusPill(container).textContent).toBe(status);
  });
});

/* -------------------------------------------------------------------------- */
/* version + features                                                          */
/* -------------------------------------------------------------------------- */

describe('StatusPage — Aria2 Version', () => {
  it('shows a spinner while connecting and no version yet', () => {
    useFakeClient({ status: RpcStatus.Connecting });
    const { container } = render(<StatusPage />);

    expect(screen.getByRole('progressbar', { name: 'Aria2 Version' })).toBeInTheDocument();
    expect(row(container, 'Aria2 Version').textContent).toBe('');
  });

  it('shows `-` while disconnected', () => {
    useFakeClient({ status: RpcStatus.Disconnected });
    const { container } = render(<StatusPage />);

    expect(screen.queryByRole('progressbar', { name: 'Aria2 Version' })).toBeNull();
    expect(row(container, 'Aria2 Version').textContent).toBe('-');
  });

  it('re-queries getVersion whenever the connection state changes', async () => {
    const client = useFakeClient({ status: RpcStatus.Connected });
    render(<StatusPage />);
    await waitFor(() => expect(client.getVersion).toHaveBeenCalledTimes(1));

    act(() => {
      useRpcStore.setState({ connection: { status: RpcStatus.Reconnecting, attempt: 1 } });
    });
    await waitFor(() => expect(client.getVersion).toHaveBeenCalledTimes(2));

    act(() => {
      useRpcStore.setState({ connection: { status: RpcStatus.Connected, attempt: 0 } });
    });
    await waitFor(() => expect(client.getVersion).toHaveBeenCalledTimes(3));
  });

  it('shows the version once the daemon answers', async () => {
    useFakeClient({ status: RpcStatus.Connected, version: { version: '1.37.0' } });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(row(container, 'Aria2 Version').textContent).toBe('1.37.0'));
  });
});

describe('StatusPage — Enabled Features', () => {
  it('spinners while connecting and `-` when disconnected', () => {
    useFakeClient({ status: RpcStatus.Connecting });
    const { container, unmount } = render(<StatusPage />);
    expect(screen.getByRole('progressbar', { name: 'Enabled Features' })).toBeInTheDocument();
    expect(row(container, 'Enabled Features').textContent).toBe('');
    unmount();

    useFakeClient({ status: RpcStatus.Disconnected });
    const second = render(<StatusPage />);
    expect(screen.queryByRole('progressbar', { name: 'Enabled Features' })).toBeNull();
    expect(row(second.container, 'Enabled Features').textContent).toBe('-');
  });

  it('lists every reported feature as a checked, disabled entry', async () => {
    useFakeClient({ status: RpcStatus.Connected });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(row(container, 'Enabled Features').textContent).toContain('BitTorrent'));

    const checkboxes = row(container, 'Enabled Features').querySelectorAll('mdui-checkbox');
    expect(Array.from(checkboxes).map((node) => node.textContent)).toEqual([
      'BitTorrent',
      'ED2K',
      'HTTPS',
    ]);
    for (const checkbox of checkboxes) {
      expect(checkbox.hasAttribute('disabled')).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* operations                                                                  */
/* -------------------------------------------------------------------------- */

describe('StatusPage — Operations', () => {
  it('offers Reconnect only for a websocket profile', () => {
    useFakeClient({ status: RpcStatus.Disconnected, protocol: 'ws' });
    const { container, unmount } = render(<StatusPage />);
    expect(button(container, 'Reconnect')).toBeTruthy();
    unmount();

    useFakeClient({ status: RpcStatus.Disconnected, protocol: 'http' });
    const second = render(<StatusPage />);
    expect(second.container.textContent).not.toContain('Reconnect');
  });

  it('enables Reconnect only while Disconnected or Waiting to reconnect', async () => {
    useFakeClient({ status: RpcStatus.Disconnected, protocol: 'wss' });
    const view = render(<StatusPage />);

    const isDisabled = () => button(view.container, 'Reconnect').hasAttribute('disabled');

    expect(isDisabled()).toBe(false);

    await act(async () => useRpcStore.setState({ connection: { status: RpcStatus.WaitingToReconnect, attempt: 0 } }));
    expect(isDisabled()).toBe(false);

    for (const status of [RpcStatus.Connecting, RpcStatus.Reconnecting, RpcStatus.Connected]) {
      await act(async () => useRpcStore.setState({ connection: { status, attempt: 0 } }));
      expect(isDisabled()).toBe(true);
    }
  });

  it('reconnects the client when Reconnect is pressed', async () => {
    useFakeClient({ status: RpcStatus.WaitingToReconnect, protocol: 'ws' });
    const client = useRpcStore.getState().client;
    const { container } = render(<StatusPage />);

    act(() => {
      button(container, 'Reconnect').dispatchEvent(new CustomEvent('click'));
    });

    expect(client?.reconnect).toHaveBeenCalledTimes(1);
  });

  it('hides Save Session / Shutdown Aria2 until the daemon has answered', async () => {
    useFakeClient({ status: RpcStatus.Disconnected });
    const { container } = render(<StatusPage />);

    expect(container.textContent).not.toContain('Save Session');
    expect(container.textContent).not.toContain('Shutdown Aria2');
  });

  it('Save Session calls aria2 and toasts on success', async () => {
    const client = useFakeClient({ status: RpcStatus.Connected });
    const { container } = render(<StatusPage />);
    await waitFor(() => expect(container.textContent).toContain('Save Session'));

    act(() => {
      button(container, 'Save Session').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(client.saveSession).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const notices = getInPageNotices();
      expect(notices.at(-1)?.content).toBe('Session has been saved successfully.');
      expect(notices.at(-1)?.type).toBe('success');
    });
  });

  it('Save Session reports nothing when aria2 does not answer "OK"', async () => {
    const client = useFakeClient({ status: RpcStatus.Connected });
    (client.saveSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok('nope'));
    const { container } = render(<StatusPage />);
    await waitFor(() => expect(container.textContent).toContain('Save Session'));

    act(() => {
      button(container, 'Save Session').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(client.saveSession).toHaveBeenCalled());
    expect(getInPageNotices().some((notice) => notice.content?.includes('saved successfully'))).toBe(false);
  });

  it('Shutdown Aria2 asks for a confirmation first', async () => {
    const client = useFakeClient({ status: RpcStatus.Connected });
    const { container } = render(<StatusPage />);
    await waitFor(() => expect(container.textContent).toContain('Shutdown Aria2'));

    // The dialog resolves `false` (dismissed without an action).
    dialogMock.mockImplementation((options: { onClosed?: () => void }) => {
      queueMicrotask(() => options.onClosed?.());
      return document.createElement('div');
    });

    act(() => {
      button(container, 'Shutdown Aria2').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(dialogMock).toHaveBeenCalledTimes(1));
    const options = dialogMock.mock.calls[0][0] as { description?: string; actions?: { text?: string }[] };
    expect(options.description).toBe('Are you sure you want to shutdown aria2?');
    expect(options.actions?.map((action) => action.text)).toEqual(['Cancel', 'OK']);

    await waitFor(() => expect(client.shutdown).not.toHaveBeenCalled());
  });

  it('Shutdown Aria2 runs only after the confirmation is accepted', async () => {
    const client = useFakeClient({ status: RpcStatus.Connected });
    const { container } = render(<StatusPage />);
    await waitFor(() => expect(container.textContent).toContain('Shutdown Aria2'));

    dialogMock.mockImplementation((options: { actions?: { text?: string; onClick?: () => void }[] }) => {
      const instance = document.createElement('div');
      for (const action of options.actions ?? []) {
        const node = document.createElement('mdui-button');
        node.setAttribute('slot', 'action');
        node.textContent = action.text ?? '';
        node.addEventListener('click', () => action.onClick?.());
        instance.appendChild(node);
      }
      return instance;
    });

    act(() => {
      button(container, 'Shutdown Aria2').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(dialogMock).toHaveBeenCalled());
    const instance = dialogMock.mock.results[0].value as HTMLElement;
    const okButton = instance.querySelectorAll('[slot="action"]');
    const confirm = okButton[okButton.length - 1];

    await act(async () => {
      confirm.dispatchEvent(new Event('click'));
    });

    await waitFor(() => expect(client.shutdown).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(getInPageNotices().at(-1)?.content).toBe('Aria2 has been shutdown successfully.');
    });
  });
});

/* -------------------------------------------------------------------------- */
/* aria2-next additions                                                        */
/* -------------------------------------------------------------------------- */

const ARIA2_NEXT: Partial<Aria2VersionInfo> = {
  product: 'aria2-next',
  rpcVersion: '1.0',
  downloadFeatures: ['filename-hints', 'filename-resolution'],
  mediaFeatures: ['request-contexts', 'structured-errors'],
};

describe('StatusPage — aria2-next identification', () => {
  it('shows the product, the rpcVersion and the session id', async () => {
    useFakeClient({ status: RpcStatus.Connected, version: ARIA2_NEXT, sessionId: 'session-1234' });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(row(container, 'Product').textContent).toBe('aria2-next'));
    expect(row(container, 'RPC Version').textContent).toBe('1.0');
    await waitFor(() => expect(row(container, 'Session Info').textContent).toBe('session-1234'));
  });

  it('shows download and media features as their own chip groups', async () => {
    useFakeClient({ status: RpcStatus.Connected, version: ARIA2_NEXT });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(row(container, 'Download Features').textContent).toContain('filename-hints'));
    expect(row(container, 'Download Features').textContent).toContain('filename-resolution');
    expect(row(container, 'Media Features').textContent).toContain('request-contexts');
    expect(row(container, 'Media Features').textContent).toContain('structured-errors');
    // …and they are chips, not plain text.
    expect(row(container, 'Download Features').querySelectorAll('mdui-chip')).toHaveLength(2);
  });

  it('omits both rows for upstream aria2, which reports neither', async () => {
    useFakeClient({ status: RpcStatus.Connected });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(row(container, 'Enabled Features').textContent).toContain('BitTorrent'));
    expect(container.textContent).not.toContain('Download Features');
    expect(container.textContent).not.toContain('Media Features');
  });
});

describe('StatusPage — Engine capabilities', () => {
  it('is rendered only for aria2-next', async () => {
    useFakeClient({ status: RpcStatus.Connected, version: { product: 'aria2', version: '1.37.0' } });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(row(container, 'Aria2 Version').textContent).toBe('1.37.0'));
    expect(container.textContent).not.toContain('Engine capabilities');
  });

  it('summarises the UI features from the reported lists', async () => {
    useFakeClient({
      status: RpcStatus.Connected,
      version: ARIA2_NEXT,
      supportsNotifications: true,
    });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(capability(container, 'ed2k').textContent).toContain('Enabled'));
    expect(capability(container, 'ed2k').textContent).toContain('ED2K');
    expect(capability(container, 'media').textContent).toContain('Enabled');
    expect(capability(container, 'filename').textContent).toContain('Enabled');
    expect(capability(container, 'bittorrent').textContent).toContain('Enabled');
    expect(capability(container, 'websocket').textContent).toContain('Enabled');
  });

  it('reports a feature as disabled when the daemon lists the array but not the flag', async () => {
    useFakeClient({
      status: RpcStatus.Connected,
      version: { ...ARIA2_NEXT, enabledFeatures: ['HTTPS'], mediaFeatures: [], downloadFeatures: [] },
      supportsNotifications: false,
    });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(capability(container, 'ed2k').textContent).toContain('Disabled'));
    expect(capability(container, 'media').textContent).toContain('Disabled');
    expect(capability(container, 'filename').textContent).toContain('Disabled');
    expect(capability(container, 'bittorrent').textContent).toContain('Disabled');
    expect(capability(container, 'websocket').textContent).toContain('Disabled');
  });

  it('reports WebSocket RPC as disabled over plain http', async () => {
    useFakeClient({ status: RpcStatus.Connected, version: ARIA2_NEXT, supportsNotifications: false });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(capability(container, 'websocket').textContent).toContain('Disabled'));
  });

  it('gives every capability row an explanatory tooltip', async () => {
    useFakeClient({ status: RpcStatus.Connected, version: ARIA2_NEXT });
    const { container } = render(<StatusPage />);

    await waitFor(() => expect(container.querySelectorAll('mdui-tooltip').length).toBe(5));
    const hints = Array.from(container.querySelectorAll('mdui-tooltip')).map((node) =>
      node.getAttribute('content'),
    );
    for (const hint of hints) {
      expect(hint).toBeTruthy();
      expect((hint ?? '').length).toBeGreaterThan(20);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

describe('StatusPage — Copy Diagnostics', () => {
  it('copies a blob with the RPC secret redacted', async () => {
    useFakeClient({
      status: RpcStatus.Connected,
      version: ARIA2_NEXT,
      sessionId: 'session-1234',
      secret: 'super-secret-token',
    });

    const { container } = render(<StatusPage />);
    await waitFor(() => expect(container.textContent).toContain('Copy Diagnostics'));

    await act(async () => {
      button(container, 'Copy Diagnostics').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;

    // The whole point: the secret never leaves the app.
    expect(copied).not.toContain('super-secret-token');
    expect(copied).toContain('***redacted***');

    const blob = JSON.parse(copied);
    expect(blob).toMatchObject({
      version: '1.37.0',
      product: 'aria2-next',
      rpcVersion: '1.0',
      sessionId: 'session-1234',
      connection: { status: RpcStatus.Connected },
    });
    expect(blob.enabledFeatures).toContain('BitTorrent');
    expect(blob.downloadFeatures).toContain('filename-hints');
    expect(blob.profile.url).toBe('http://localhost:6800/jsonrpc');
    expect(blob.profile.secret).toBe('***redacted***');
  });

  it('reports null instead of a redaction marker when there is no secret', async () => {
    useFakeClient({ status: RpcStatus.Connected, version: ARIA2_NEXT });
    const { container } = render(<StatusPage />);
    await waitFor(() => expect(container.textContent).toContain('Copy Diagnostics'));

    await act(async () => {
      button(container, 'Copy Diagnostics').dispatchEvent(new CustomEvent('click'));
    });

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0][0] as string)).toContain('"secret": null');
  });
});

/* -------------------------------------------------------------------------- */
/* resilience                                                                  */
/* -------------------------------------------------------------------------- */

describe('StatusPage — without a client', () => {
  it('renders the address and a dash version instead of crashing', () => {
    useRpcStore.setState({ client: null, connection: { status: RpcStatus.Disconnected, attempt: 0 } });
    const { container } = render(<StatusPage />);

    expect(row(container, 'Aria2 RPC Address').textContent).toBe('http://localhost:6800/jsonrpc');
    expect(row(container, 'Aria2 Version').textContent).toBe('-');
    expect(row(container, 'Session Info').textContent).toBe('-');
    expect(row(container, 'Enabled Features').textContent).toBe('-');
  });
});