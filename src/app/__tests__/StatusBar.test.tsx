/**
 * Tests for the footer status bar.
 *
 * Three AriaNg behaviours live here:
 *
 * - the **Toggle Navigation** button flips `ui.drawerOpen`;
 * - the live speeds are rendered through `readableVolume` with AriaNg's `/s`
 *   suffix, and only while something is actually polling;
 * - the **Shortcut → Global Rate Limit** dialog writes both aria2 quick-settings
 *   keys through `changeGlobalOption`.
 *
 * As in `AppShell.test.tsx`, the `mdui-*` elements are deliberately left inert
 * (`vi.hoisted` intercepts `customElements.define`) so jsdom's missing layout and
 * animation APIs cannot turn mdui's Lit lifecycle into unhandled rejections.
 *
 * `@/store/commands` is partially mocked: only `changeGlobalOption` is observed,
 * because it is the one call the dialog makes and the only way to assert *without*
 * a live aria2 connection.
 */
vi.hoisted(() => {
  const original = customElements.define.bind(customElements);
  customElements.define = ((
    name: string,
    constructor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void => {
    if (name.startsWith('mdui-')) {
      return;
    }
    original(name, constructor, options);
  }) as typeof customElements.define;
});

import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unstable_HistoryRouter as HistoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

import type * as CommandsModule from '@/store/commands';
import { I18nProvider } from '@/i18n';
import { DEFAULT_ROUTE } from '../route-paths';
import { createHashBangHistory } from '../hash-history';
import { StatusBar } from '../shell';
import { RpcStatus } from '@/config/rpc-constants';
import { changeGlobalOption } from '@/store/commands';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import { useUiStore } from '@/store/ui';

vi.mock('@/store/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof CommandsModule>();
  return { ...actual, changeGlobalOption: vi.fn().mockResolvedValue(true) };
});

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

type HistoryRouterHistory = ComponentProps<typeof HistoryRouter>['history'];

function renderStatusBar() {
  window.location.hash = `#!${DEFAULT_ROUTE}`;
  return render(
    <I18nProvider>
      <HistoryRouter history={createHashBangHistory() as unknown as HistoryRouterHistory}>
        <StatusBar />
      </HistoryRouter>
    </I18nProvider>,
  );
}

function menuItem(container: HTMLElement, label: string): HTMLElement | undefined {
  return [...container.querySelectorAll('mdui-menu-item')].find(
    (item) => item.textContent?.trim() === label,
  );
}

function button(container: HTMLElement, label: string): HTMLElement | null {
  return container.querySelector(`mdui-button[aria-label="${label}"]`) ??
    container.querySelector(`mdui-button-icon[aria-label="${label}"]`);
}

function textField(container: HTMLElement, label: string): (HTMLElement & { value: string }) | undefined {
  return [...container.querySelectorAll('mdui-text-field')].find((field) => field.getAttribute('label') === label) as
    | (HTMLElement & { value: string })
    | undefined;
}

/** Types into a `mdui-text-field` the way mdui's `input` event does. */
function type(field: HTMLElement & { value: string }, value: string): void {
  field.value = value;
  act(() => {
    field.dispatchEvent(new Event('input'));
  });
}

beforeEach(() => {
  vi.mocked(changeGlobalOption).mockClear();
  useUiStore.setState({ drawerOpen: false });
  useSettingsStore.getState().set('globalStatRefreshInterval', 1000);
  useRpcStore.setState({
    connection: { status: RpcStatus.Connected, attempt: 0 },
    globalStat: undefined,
  });
});

/* -------------------------------------------------------------------------- */
/* the speeds                                                                 */
/* -------------------------------------------------------------------------- */

describe('StatusBar speeds', () => {
  it('renders both speeds through readableVolume with a /s suffix', () => {
    useRpcStore.setState({
      globalStat: { downloadSpeed: 1048576, uploadSpeed: 524288 } as never,
    });

    const { container } = renderStatusBar();
    const text = container.textContent ?? '';

    // `readableVolume(1048576, 'auto')` -> '1.0 MB' (one decimal below 10),
    // `readableVolume(524288, 'auto')` -> '512 KB' (none above 10).
    expect(text).toContain('Download: 1.0 MB/s');
    expect(text).toContain('Upload: 512 KB/s');
  });

  it('shows zeroes before the first poll', () => {
    const { container } = renderStatusBar();
    const text = container.textContent ?? '';

    expect(text).toContain('Download: 0.00 B/s');
    expect(text).toContain('Upload: 0.00 B/s');
  });

  it('hides the readout when the global stat poll is disabled', () => {
    useSettingsStore.getState().set('globalStatRefreshInterval', 0);

    const { container } = renderStatusBar();

    expect(container.querySelector('mdui-tooltip')).toBeNull();
    expect(container.textContent).not.toContain('/s');
  });

  it('makes the whole readout a popover trigger', () => {
    const { container } = renderStatusBar();
    const trigger = container.querySelector('mdui-tooltip button');

    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    // AriaNg's `ng-pop-chart`: trigger `click hover`, placement `top`.
    const tooltip = container.querySelector('mdui-tooltip') as HTMLElement & { trigger?: string; placement?: string };
    expect(tooltip.trigger).toBe('manual');
    expect(tooltip.placement).toBe('top');
  });
});

/* -------------------------------------------------------------------------- */
/* the navigation toggle                                                      */
/* -------------------------------------------------------------------------- */

describe('StatusBar navigation toggle', () => {
  it('flips ui.drawerOpen', () => {
    const { container } = renderStatusBar();
    const toggle = button(container, 'Toggle Navigation');
    expect(toggle).not.toBeNull();
    expect(useUiStore.getState().drawerOpen).toBe(false);

    act(() => {
      fireEvent.click(toggle as HTMLElement);
    });
    expect(useUiStore.getState().drawerOpen).toBe(true);

    act(() => {
      fireEvent.click(toggle as HTMLElement);
    });
    expect(useUiStore.getState().drawerOpen).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* the global rate limit dialog                                               */
/* -------------------------------------------------------------------------- */

describe('StatusBar global rate limit', () => {
  function openDialog(container: HTMLElement): void {
    const item = menuItem(container, 'Global Rate Limit');
    expect(item).toBeDefined();
    act(() => {
      fireEvent.click(item as HTMLElement);
    });
  }

  it('offers the dialog from the Shortcut menu', () => {
    const { container } = renderStatusBar();

    expect(button(container, 'Shortcut')).not.toBeNull();
    openDialog(container);
  });

  it('edits exactly the two quick-settings keys', () => {
    const { container } = renderStatusBar();
    openDialog(container);

    expect(textField(container, 'max-overall-download-limit')).toBeDefined();
    expect(textField(container, 'max-overall-upload-limit')).toBeDefined();
  });

  it('calls changeGlobalOption with both keys', () => {
    const { container } = renderStatusBar();
    openDialog(container);

    type(textField(container, 'max-overall-download-limit') as HTMLElement & { value: string }, '500K');
    type(textField(container, 'max-overall-upload-limit') as HTMLElement & { value: string }, '200K');

    const ok = [...container.querySelectorAll('mdui-button')].find(
      (element) => element.textContent?.trim() === 'OK',
    );
    expect(ok).toBeDefined();

    act(() => {
      fireEvent.click(ok as HTMLElement);
    });

    expect(changeGlobalOption).toHaveBeenCalledWith('max-overall-download-limit', '500K');
    expect(changeGlobalOption).toHaveBeenCalledWith('max-overall-upload-limit', '200K');
    expect(changeGlobalOption).toHaveBeenCalledTimes(2);
  });
});
