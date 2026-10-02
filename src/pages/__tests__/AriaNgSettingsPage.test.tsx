/**
 * Tests for `/settings/ariang`.
 *
 * jsdom cannot run mdui's Lit lifecycle, so three things are stood in for:
 *
 * - `mdui/mdui.css` / every `mdui/components/*` module is stubbed out through
 *   `@/ui/mdui/registry`, which is what registers them. Without it jsdom would
 *   upgrade ~45 custom elements on every render, which is both slow and makes
 *   React write `value` as a **property** instead of an attribute. Unregistered,
 *   the children are plain DOM and every `value` / `checked` binding is a plain
 *   expando, so a `change` / `input` CustomEvent drives them exactly like the
 *   real components do;
 * - `@mdui/icons` is stubbed for the same reason (66 more Lit elements);
 * - mdui's programmatic `dialog()` / `snackbar()` are mocked, so the test
 *   decides whether a confirm dialog is answered with OK or Cancel.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RpcProfile } from '@/config/types';
import { createDefaultSettings } from '@/config/defaults';
import { i18n } from '@/i18n';
import { useProfilesStore } from '@/store/profiles';
import { useRpcStore } from '@/store/rpc-store';
import { flushSettingsPersist, useSettingsStore } from '@/store/settings';
import { resetUiStore, useUiStore } from '@/store/ui';
import AriaNgSettingsPage from '../AriaNgSettingsPage';
import { EXPORT_COMMAND_API_EVENT, parseRequestHeaderLines } from '../settings-ariang/RpcProfileTab';
import type { ExportCommandApiDetail } from '../settings-ariang/RpcProfileTab';

/* ------------------------------------------------------------------ */
/* mdui stand-ins                                                      */
/* ------------------------------------------------------------------ */

vi.mock('@/ui/mdui/registry', () => ({
  MDUI_COMPONENTS: [],
  hasMduiComponent: () => false,
  registerMduiComponents: async () => {},
}));

vi.mock('@/ui/mdui/icons', () => ({
  ICON_TAGS: new Set<string>(),
  hasIcon: () => false,
  icon: () => 'mdui-icon',
}));

const dialogMock = vi.fn();
const snackbarMock = vi.fn();

vi.mock('mdui/functions/dialog.js', () => ({
  dialog: (options: unknown) => dialogMock(options),
}));

vi.mock('mdui/functions/snackbar.js', () => ({
  snackbar: (options: unknown) => snackbarMock(options),
}));

/** What the next confirm dialog should answer. */
let confirmAnswer = true;

/** Builds the `<slot=action>` buttons mdui would create, and settles the dialog. */
function stubDialog(): HTMLElement {
  const instance = document.createElement('div');

  dialogMock.mockImplementation(
    (options: {
      actions?: { text?: string; onClick?: () => unknown }[];
      onClosed?: () => void;
    }) => {
      const actions = options.actions ?? [];
      for (const action of actions) {
        const button = document.createElement('mdui-button');
        button.setAttribute('slot', 'action');
        button.textContent = action.text ?? '';
        instance.appendChild(button);
      }

      const last = actions[actions.length - 1];
      queueMicrotask(() => {
        if (confirmAnswer && last?.onClick) {
          last.onClick();
        } else {
          options.onClosed?.();
        }
      });

      return instance;
    },
  );

  return instance;
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeProfile(overrides: Partial<RpcProfile> = {}): RpcProfile {
  return {
    rpcId: 'profile-1',
    isDefault: false,
    rpcAlias: '',
    rpcHost: '10.0.0.9',
    rpcPort: '6800',
    rpcInterface: 'jsonrpc',
    protocol: 'ws',
    httpMethod: 'POST',
    rpcRequestHeaders: '',
    secret: 'hunter2',
    ...overrides,
  };
}

function seedSettings(patch: Record<string, unknown> = {}): void {
  const settings = { ...createDefaultSettings(), ...patch } as ReturnType<
    typeof createDefaultSettings
  >;
  useSettingsStore.setState({ settings, session: { debugMode: false }, hydrated: true, firstVisit: false });
  useProfilesStore.getState().syncFromSettings();
}

function renderPage(path = '/settings/ariang'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/ariang" element={<AriaNgSettingsPage />} />
        <Route path="/settings/ariang/:extendType" element={<AriaNgSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Every `<mdui-tab>` in the strip. */
function tabs(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('mdui-tabs > mdui-tab')];
}

/** The tab's visible text, without the × button AriaNg put inside it. */
function tabLabel(tab: Element): string {
  return (tab.textContent ?? '').replace('×', '').trim();
}

/** Simulates a user picking `value` in an `<mdui-select>`. */
async function selectOption(element: Element | null, value: string): Promise<void> {
  await act(async () => {
    const target = element as (Element & { value: string }) | null;
    if (target) target.value = value;
    element?.dispatchEvent(new CustomEvent('change'));
  });
}

/** The `<mdui-button>` whose own text is `label`. */
function buttonByText(container: HTMLElement, label: string): Element | undefined {
  return [...container.querySelectorAll('mdui-button')].find((node) => node.textContent === label);
}

/**
 * Replaces `window.location`.
 *
 * jsdom's `location.reload()` is not implemented and its accessors are not
 * configurable, so the whole object is swapped — which is also what the https
 * test needs.
 */
function stubLocation(protocol: 'http:' | 'https:', reload = vi.fn()): ReturnType<typeof vi.fn> {
  vi.stubGlobal('location', {
    protocol,
    hostname: 'nas.local',
    host: 'nas.local',
    origin: `${protocol}//nas.local`,
    reload,
  });
  return reload;
}

beforeEach(async () => {
  stubDialog();
  confirmAnswer = true;
  snackbarMock.mockReset();
  localStorage.clear();
  seedSettings();
  resetUiStore();
  useSettingsStore.setState({ session: { debugMode: false } });
  // One test changes the locale; without this every later assertion would be
  // matching German text.
  await act(async () => {
    await i18n.setLocale('en');
  });
});

afterEach(() => {
  flushSettingsPersist();
  resetUiStore();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe('tab strip', () => {
  it('renders Global, one tab per profile and the + tab', () => {
    seedSettings({ extendRpcServers: [makeProfile()] });
    const { container } = renderPage();

    // default profile + one extended profile + the add tab, plus Global.
    expect(tabs(container)).toHaveLength(4);
    expect(container.querySelector('mdui-tab[value="global"]')).not.toBeNull();
    expect(container.querySelector('mdui-tab[value="rpc0"]')).not.toBeNull();
    expect(container.querySelector('mdui-tab[value="rpc1"]')).not.toBeNull();
    expect(container.querySelector('mdui-tab[value="add"]')).not.toBeNull();
  });

  it('labels an RPC tab `RPC (alias)` or `RPC (host:port)`', () => {
    seedSettings({ extendRpcServers: [makeProfile({ rpcAlias: 'nas' }), makeProfile({ rpcId: 'p2' })] });
    const { container } = renderPage();

    const labels = tabs(container).map(tabLabel);
    expect(labels).toContain('RPC (10.0.0.9:6800)');
    expect(labels).toContain('RPC (nas)');
  });

  it('gives only a non-default profile an × button', () => {
    seedSettings({ extendRpcServers: [makeProfile()] });
    const { container } = renderPage();

    expect(container.querySelectorAll('mdui-tab[value="rpc0"] .settings-tab__close')).toHaveLength(0);
    expect(container.querySelectorAll('mdui-tab[value="rpc1"] .settings-tab__close')).toHaveLength(1);
  });

  it('removes the profile after the confirm dialog was accepted', async () => {
    seedSettings({ extendRpcServers: [makeProfile()] });
    const { container } = renderPage();

    const close = container.querySelector('mdui-tab[value="rpc1"] .settings-tab__close');
    await act(async () => {
      fireEvent.click(close as Element);
    });

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.extendRpcServers).toHaveLength(0);
    });
    expect(container.querySelector('mdui-tab[value="rpc1"]')).toBeNull();
  });

  it('keeps the profile when the confirm dialog was cancelled', async () => {
    seedSettings({ extendRpcServers: [makeProfile()] });
    confirmAnswer = false;

    const { container } = renderPage();
    const close = container.querySelector('mdui-tab[value="rpc1"] .settings-tab__close');
    await act(async () => {
      fireEvent.click(close as Element);
    });

    expect(useSettingsStore.getState().settings.extendRpcServers).toHaveLength(1);
  });
});

describe('RPC profile fields', () => {
  it('disables http and ws on an https page, with an explanation', () => {
    stubLocation('https:');

    const { container } = renderPage();
    const rpcTab = container.querySelector('mdui-tab-panel[value="rpc0"]');
    const items = [...(rpcTab?.querySelectorAll('mdui-select mdui-menu-item') ?? [])];
    const byValue = new Map(items.map((item) => [item.getAttribute('value'), item]));

    expect(byValue.get('http')?.hasAttribute('disabled')).toBe(true);
    expect(byValue.get('ws')?.hasAttribute('disabled')).toBe(true);
    expect(byValue.get('https')?.hasAttribute('disabled')).toBe(false);
    expect(byValue.get('wss')?.hasAttribute('disabled')).toBe(false);

    // The label says so too, and the tooltip explains why.
    expect(byValue.get('http')?.textContent).toBe('Http (Disabled)');
    expect(
      rpcTab?.querySelector(
        'mdui-tooltip[content="Http and WebSocket would be disabled when accessing AriaNg via Https."]',
      ),
    ).not.toBeNull();
  });

  it('offers the HTTP method only for http/https', () => {
    seedSettings({ protocol: 'ws' });
    const { container } = renderPage();
    expect(container.querySelector('mdui-select[label="Aria2 RPC Http Request Method"]')).toBeNull();

    seedSettings({ protocol: 'http' });
    const http = renderPage();
    expect(
      http.container.querySelector('mdui-select[label="Aria2 RPC Http Request Method"]'),
    ).not.toBeNull();
    expect(
      http.container.querySelector(
        'mdui-tooltip[content="POST method only supports aria2 v1.15.2 and above."]',
      ),
    ).not.toBeNull();
  });

  it('keeps the secret in a password field and toggles it', async () => {
    seedSettings({ secret: 'top-secret' });
    const { container } = renderPage();

    const field = container.querySelector('mdui-text-field[label="Aria2 RPC Secret Token"]');
    expect(field?.getAttribute('type')).toBe('password');

    const toggle = container.querySelector('mdui-button-icon[aria-label="Show Secret"]');
    await act(async () => {
      fireEvent.click(toggle as Element);
    });

    expect(
      container.querySelector('mdui-text-field[label="Aria2 RPC Secret Token"]')?.getAttribute('type'),
    ).toBe('text');
  });

  it('rejects a request-header line whose value contains a colon', () => {
    seedSettings({ rpcRequestHeaders: 'X-Token: abc\nX-Broken: a:b:c', protocol: 'http' });
    const { container } = renderPage();

    expect(container.textContent).toContain('X-Broken: a:b:c');
    expect(container.textContent).toContain('each header line must contain exactly one');
    // The valid line is not reported as rejected.
    expect(container.textContent).not.toContain('X-Token: abc,');
  });

  it('parses header lines exactly like the http transport does', () => {
    expect(parseRequestHeaderLines('X-A: 1\nX-B: 2')).toEqual({
      accepted: ['X-A: 1', 'X-B: 2'],
      rejected: [],
    });
    // A value may not contain a colon, and a line may not have none.
    expect(parseRequestHeaderLines('X-A: a:b\nno-colon\n\n  ')).toEqual({
      accepted: [],
      rejected: ['X-A: a:b', 'no-colon'],
    });
  });

  it('uses host:port as the alias placeholder', () => {
    seedSettings({ rpcHost: '10.0.0.9', rpcPort: '6801' });
    const { container } = renderPage();

    expect(
      container.querySelector('mdui-text-field[label="Aria2 RPC Alias"]')?.getAttribute('placeholder'),
    ).toBe('10.0.0.9:6801');
  });

  it('writes an edited field straight into the profile store', async () => {
    seedSettings({ extendRpcServers: [makeProfile()] });
    const { container } = renderPage();

    const host = container.querySelector(
      'mdui-tab-panel[value="rpc1"] mdui-text-field[label="Host"]',
    ) as (Element & { value: string }) | null;

    await act(async () => {
      if (host) host.value = '192.168.0.5';
      host?.dispatchEvent(new CustomEvent('input'));
    });

    expect(useSettingsStore.getState().settings.extendRpcServers[0]?.rpcHost).toBe('192.168.0.5');
  });

  it('activates a profile by hot-applying it, without a reload', async () => {
    const reload = stubLocation('http:');
    const applyProfile = vi.fn();
    const original = useRpcStore.getState().applyProfile;
    useRpcStore.setState({ applyProfile });

    try {
      seedSettings({ rpcHost: '127.0.0.1', extendRpcServers: [makeProfile({ rpcId: 'p2', rpcAlias: 'nas' })] });
      const { container } = renderPage();

      const activate = [
        ...(container.querySelector('mdui-tab-panel[value="rpc1"]')?.querySelectorAll('mdui-button') ?? []),
      ].find((node) => node.textContent === 'Activate');
      await act(async () => {
        fireEvent.click(activate as Element);
      });

      // Promoted to the default slot…
      expect(useSettingsStore.getState().settings.rpcHost).toBe('10.0.0.9');
      // …with the previous default kept as an entry…
      expect(useSettingsStore.getState().settings.extendRpcServers[0]?.rpcAlias).toBe('');
      // …and the transport swapped in place, no reload.
      expect(applyProfile).toHaveBeenCalledTimes(1);
      expect(applyProfile.mock.calls[0]?.[0]).toMatchObject({ rpcHost: '10.0.0.9', rpcAlias: 'nas' });
      expect(reload).not.toHaveBeenCalled();
    } finally {
      useRpcStore.setState({ applyProfile: original });
    }
  });

  it('disables Activate on the default profile', () => {
    const { container } = renderPage();
    const activate = buttonByText(container, 'Activate');
    expect(activate?.hasAttribute('disabled')).toBe(true);
  });

  it('signals the Export Command API action as a window event', async () => {
    const detail = vi.fn();
    window.addEventListener(EXPORT_COMMAND_API_EVENT, detail as EventListener);

    try {
      const { container } = renderPage();
      const exportButton = buttonByText(container, 'Export');
      await act(async () => {
        fireEvent.click(exportButton as Element);
      });

      expect(detail).toHaveBeenCalledTimes(1);
      const event = detail.mock.calls[0]?.[0] as CustomEvent<ExportCommandApiDetail>;
      expect(event.detail.source).toBe('settings');
      expect(event.detail.profile.isDefault).toBe(true);
    } finally {
      window.removeEventListener(EXPORT_COMMAND_API_EVENT, detail as EventListener);
    }
  });
});

describe('swipe gestures', () => {
  /** Moves to a tab by simulating the swipe the shell would deliver. */
  async function swipe(side: 'left' | 'right'): Promise<boolean> {
    const handler = useUiStore.getState().swipeActions[side === 'left' ? 'extendLeftSwipe' : 'extendRightSwipe'];
    if (!handler) return false;

    let handled = false;
    await act(async () => {
      handled = handler();
    });
    return handled;
  }

  function activeTab(container: HTMLElement): string | null {
    return (container.querySelector('mdui-tabs') as (Element & { value?: string }) | null)?.value ?? null;
  }

  it('cycles forward from Global and back again, ending on Global', async () => {
    // default + two extended => three RPC tabs, `rpc0` … `rpc2`.
    seedSettings({ extendRpcServers: [makeProfile(), makeProfile({ rpcId: 'p2' })] });
    const { container } = renderPage();

    expect(await swipe('left')).toBe(true);
    await waitFor(() => expect(activeTab(container)).toBe('rpc0'));

    expect(await swipe('left')).toBe(true);
    await waitFor(() => expect(activeTab(container)).toBe('rpc1'));

    expect(await swipe('left')).toBe(true);
    await waitFor(() => expect(activeTab(container)).toBe('rpc2'));

    // Past the last tab there is nothing to extend.
    expect(await swipe('left')).toBe(false);

    // Right from the first RPC tab returns to Global, exactly like AriaNg.
    expect(await swipe('right')).toBe(true);
    await waitFor(() => expect(activeTab(container)).toBe('rpc1'));
    expect(await swipe('right')).toBe(true);
    await waitFor(() => expect(activeTab(container)).toBe('rpc0'));
    expect(await swipe('right')).toBe(true);
    await waitFor(() => expect(activeTab(container)).toBe('global'));
    expect(await swipe('right')).toBe(false);
  });

  it('unregisters its handlers on unmount', () => {
    seedSettings({ extendRpcServers: [makeProfile()] });
    const { unmount } = renderPage();
    expect(useUiStore.getState().swipeActions.extendLeftSwipe).toBeTypeOf('function');

    unmount();
    expect(useUiStore.getState().swipeActions.extendLeftSwipe).toBeUndefined();
    expect(useUiStore.getState().swipeActions.extendRightSwipe).toBeUndefined();
  });
});

describe('global settings', () => {
  it('updates the store from an interval row without a reload', async () => {
    const reload = stubLocation('http:');

    const { container } = renderPage();
    await selectOption(
      container.querySelector('mdui-select[label="Updating Page Title Interval"]'),
      '2000',
    );

    expect(useSettingsStore.getState().settings.titleRefreshInterval).toBe(2000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('toggles a boolean row through the switch', async () => {
    const { container } = renderPage();
    const control = container.querySelector('mdui-switch[aria-label="Swipe Gesture"]');

    await act(async () => {
      (control as (Element & { checked: boolean }) | null)!.checked = false;
      control?.dispatchEvent(new CustomEvent('change'));
    });

    expect(useSettingsStore.getState().settings.swipeGesture).toBe(false);
  });

  it('shows the reload notice after a language change', async () => {
    const { container } = renderPage();
    await selectOption(container.querySelector('mdui-select[label="Language"]'), 'de_DE');

    expect(useSettingsStore.getState().settings.language).toBe('de_DE');
    await waitFor(() => {
      const notice = container.querySelector('.settings-notice');
      expect(notice?.textContent).toContain('Language resource has been updated');
    });
    // The footer tip only mentions the reload for the reduced set.
    expect(container.querySelector('.settings-tips')?.textContent).toContain(
      'Changes to the settings take effect after refreshing page.',
    );

    // Put the store back: the i18n singleton keeps the new locale otherwise.
    useSettingsStore.getState().update({ language: 'en' });
    await act(async () => {
      await i18n.setLocale('en');
    });
  });

  it('hides the reload tip while nothing needs a reload', () => {
    const { container } = renderPage();
    expect(container.querySelector('.settings-tips')?.textContent).not.toContain(
      'Changes to the settings take effect after refreshing page.',
    );
    // …but both footer buttons are always there.
    expect(container.textContent).toContain('Reset Settings');
    expect(container.textContent).toContain('Clear Settings History');
  });

  it('asks for confirmation before resetting, and resets when confirmed', async () => {
    stubLocation('http:');

    seedSettings({ swipeGesture: true });
    const { container } = renderPage();
    const button = buttonByText(container, 'Reset Settings');

    await act(async () => {
      fireEvent.click(button as Element);
    });

    expect(dialogMock).toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.swipeGesture).toBe(true);
  });

  it('opens the import dialog and refuses empty input', async () => {
    const { container } = renderPage();

    await act(async () => {
      fireEvent.click(buttonByText(container, 'Import Settings') as Element);
    });

    expect(buttonByText(container, 'Import')?.hasAttribute('disabled')).toBe(true);
  });

  it('reports an invalid settings blob verbatim', async () => {
    const { container } = renderPage();
    await act(async () => {
      fireEvent.click(buttonByText(container, 'Import Settings') as Element);
    });

    const area = container.querySelector('mdui-dialog mdui-text-field') as (Element & { value: string }) | null;
    await act(async () => {
      if (area) area.value = '{not json';
      area?.dispatchEvent(new CustomEvent('input'));
    });

    await act(async () => {
      fireEvent.click(buttonByText(container, 'Import') as Element);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('Invalid settings data format!');
    });
  });
});

describe('debug mode', () => {
  it('stays hidden on the plain route', () => {
    const { container } = renderPage();
    expect(container.querySelector('[data-setting-key="debugMode"]')).toBeNull();
  });

  it('is revealed by /settings/ariang/debug', () => {
    const { container } = renderPage('/settings/ariang/debug');
    expect(container.querySelector('[data-setting-key="debugMode"]')).not.toBeNull();
  });

  it('writes to the session store, never to the persisted settings', async () => {
    const { container } = renderPage('/settings/ariang/debug');
    await selectOption(container.querySelector('mdui-select[label="Debug Mode"]'), 'true');

    expect(useSettingsStore.getState().session.debugMode).toBe(true);
    expect(useSettingsStore.getState().settings).not.toHaveProperty('debugMode');
  });
});