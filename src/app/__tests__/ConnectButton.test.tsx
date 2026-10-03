/**
 * Connect control tests.
 *
 * The control exists because auto-connect cannot fix a wrong endpoint, and the two
 * ways that happens are both invisible without it:
 *
 * 1. a cross-origin `http://` RPC url, which the browser rejects at the CORS preflight
 *    (aria2 sends no `Access-Control-Allow-Origin` header and has no option to);
 * 2. aria2 not running yet, where the HTTP client settles on `Disconnected` and never
 *    tries again on its own.
 *
 * These assert the *decision* the button makes — connect vs. reconnect vs. disconnect,
 * and whether the reason is surfaced — rather than mdui's rendering.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { RpcStatus } from '@/config/rpc-constants';
import { DEFAULT_RPC_PROFILE } from '@/config/defaults';
import { useRpcStore } from '@/store/rpc-store';
import { ConnectButton } from '../shell/ConnectButton';

const SECRET = 's3cret';

/**
 * `disabled` is one of the properties React writes on a custom element *as a
 * property* rather than an attribute, so it is read as an expando here. `MduiTooltip`
 * carries its text in a `content` attribute, so that one is read normally.
 */
function isDisabled(button: Element): boolean {
  const withProp = button as Element & { disabled?: boolean };
  return withProp.disabled ?? button.hasAttribute('disabled');
}

/**
 * Everything the control wants a user to be able to read about the failure.
 *
 * Read as a property: mdui's components are genuinely defined in these tests, so
 * React 19 writes `content` onto the instance rather than into the attribute map, and
 * Lit does not reflect it back.
 */
function detail(container: HTMLElement): string {
  const tooltip = container.querySelector('mdui-tooltip') as (Element & { content?: string }) | null;
  return tooltip?.content ?? tooltip?.getAttribute('content') ?? '';
}

/** A client stand-in; only the two methods the control calls matter. */
function fakeClient() {
  return { reconnect: vi.fn(), disconnect: vi.fn() } as unknown as NonNullable<
    ReturnType<typeof useRpcStore.getState>['client']
  >;
}

function setup(options: {
  status: string;
  attempt?: number;
  lastError?: string;
  client?: ReturnType<typeof fakeClient> | null;
}) {
  const client = options.client === undefined ? fakeClient() : options.client;

  useRpcStore.setState({
    connection: {
      status: options.status as (typeof RpcStatus)[keyof typeof RpcStatus],
      attempt: options.attempt ?? 0,
      ...(options.lastError === undefined ? {} : { lastError: options.lastError }),
    },
    client,
    profiles: [{ ...DEFAULT_RPC_PROFILE, secret: SECRET }],
    activeIndex: 0,
  } as never);

  const result = render(
    <I18nProvider>
      <ConnectButton />
    </I18nProvider>,
  );

  return { ...result, client, container: result.container };
}

beforeEach(() => {
  useRpcStore.setState({ connection: { status: RpcStatus.Disconnected, attempt: 0 } } as never);
});

describe('ConnectButton — disconnected', () => {
  it('offers to connect, not to reconnect', () => {
    const { container } = setup({ status: RpcStatus.Disconnected });
    const button = container.querySelector('mdui-button')!;
    expect(button.textContent?.trim().startsWith('Connect')).toBe(true);
    expect(button.textContent).not.toContain('Reconnect');
  });

  it('dialling it asks the client to reconnect', () => {
    const { container, client } = setup({ status: RpcStatus.Disconnected });
    container.querySelector('mdui-button')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(client!.reconnect).toHaveBeenCalledTimes(1);
  });

  it('is enabled even without a client, and does not throw', () => {
    // `client?.reconnect()` — a null client must not turn the button into a trap.
    const { container } = setup({ status: RpcStatus.Disconnected, client: null });
    const button = container.querySelector('mdui-button')!;
    expect(isDisabled(button)).toBe(false);
    expect(() => button.dispatchEvent(new Event('click', { bubbles: true }))).not.toThrow();
  });
});

describe('ConnectButton — connected', () => {
  it('shows an icon button that disconnects', () => {
    const { container } = setup({ status: RpcStatus.Connected });
    expect(container.querySelector('mdui-button')).toBeNull();
    expect(container.querySelector('mdui-button-icon')).not.toBeNull();
  });

  it('disconnects rather than reconnecting', () => {
    const { container, client } = setup({ status: RpcStatus.Connected });
    container.querySelector('mdui-button-icon')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(client!.disconnect).toHaveBeenCalledTimes(1);
    expect(client!.reconnect).not.toHaveBeenCalled();
  });
});

describe('ConnectButton — the reason is on screen', () => {
  it('names the transport error next to the status', () => {
    const { container } = setup({
      status: RpcStatus.Disconnected,
      lastError: 'Cannot reach aria2 over HTTP from this page!',
    });
    const text = detail(container);
    expect(text).toContain('Disconnected');
    expect(text).toContain('Cannot reach aria2 over HTTP from this page!');
  });

  it('stays quiet when there is no error', () => {
    const { container } = setup({ status: RpcStatus.Disconnected });
    // Nothing to explain, so no tooltip is rendered at all.
    expect(container.querySelector('mdui-tooltip')).toBeNull();
  });

  it('does not repeat an error the transport is already retrying', () => {
    // A websocket reconnecting on its own is working; the error belongs in devtools,
    // not in a tooltip the user is trying to read.
    const { container } = setup({
      status: RpcStatus.WaitingToReconnect,
      lastError: 'Cannot connect to aria2!',
    });
    expect(detail(container)).not.toContain('Cannot connect to aria2!');
    // No tooltip at all while retrying, so the label is just the action.
    expect(container.querySelector('mdui-tooltip')).toBeNull();
    expect(container.textContent).toContain('Reconnect');
  });

  it('shows the endpoint it dialled, so the wrong one is identifiable', () => {
    const { container } = setup({
      status: RpcStatus.Disconnected,
      lastError: 'Cannot reach aria2 over HTTP from this page!',
    });
    // The CORS case is only actionable if the user can see which url failed.
    expect(detail(container)).toContain('://');
    expect(detail(container)).toContain(':6800');
  });
});

describe('ConnectButton — in-flight states', () => {
  it('offers Reconnect with the attempt count while retrying', () => {
    const { container } = setup({ status: RpcStatus.Reconnecting, attempt: 3 });
    expect(container.textContent).toContain('Reconnect');
    expect(container.textContent).toContain('(3)');
  });

  it('does not show an attempt count when nothing has been retried', () => {
    const { container } = setup({ status: RpcStatus.WaitingToReconnect, attempt: 0 });
    expect(container.textContent).not.toContain('(0)');
  });

  it('is disabled while a handshake is already in flight', () => {
    // Otherwise a user can queue several by clicking repeatedly.
    const { container } = setup({ status: RpcStatus.Connecting });
    expect(isDisabled(container.querySelector('mdui-button')!)).toBe(true);
  });
});