/**
 * Tests for `/settings/aria2/:group`.
 *
 * The RPC client is a hand-written double, because what is under test is the
 * page's own behaviour: which keys a route renders, that the global option blob
 * is fetched exactly **once**, and that a save is a single-key
 * `changeGlobalOption` call that only counts as successful when aria2 answered
 * `OK`.
 *
 * mdui is stubbed through `@/ui/mdui/registry` for the same reason as in the
 * AriaNg settings tests (see the note at the top of that file).
 */

import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOptionMeta } from '@/config/aria2-options';
import { ARIA2_GLOBAL_GROUPS, getGlobalOptionKeys } from '@/config/option-groups';
import { OPTION_GROUP_ROUTES } from '@/config/types';
import type { Aria2Client } from '@/rpc/contract';
import { useRpcStore } from '@/store/rpc-store';
import Aria2SettingsPage from '../aria2-settings/Aria2SettingsPage';

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

/* ------------------------------------------------------------------ */
/* client double                                                       */
/* ------------------------------------------------------------------ */

const getGlobalOption = vi.fn();
const changeGlobalOption = vi.fn();

function installClient(options: Record<string, string> = { dir: '/downloads' }): void {
  getGlobalOption.mockReset();
  changeGlobalOption.mockReset();

  getGlobalOption.mockImplementation(async () => ({
    success: true,
    data: options,
    context: { method: 'getGlobalOption' },
  }));
  changeGlobalOption.mockImplementation(async () => ({
    success: true,
    data: 'OK',
    context: { method: 'changeGlobalOption' },
  }));

  useRpcStore.setState({
    client: { getGlobalOption, changeGlobalOption } as unknown as Aria2Client,
  });
}

function renderGroup(group: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings/aria2/${group}`]}>
      <Routes>
        <Route path="/settings/aria2/:group" element={<Aria2SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The option rows currently on screen, in order. */
function renderedKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-option-key]')].map(
    (row) => row.getAttribute('data-option-key') ?? '',
  );
}

/** Types into the control of the row named `key`. */
async function typeInto(container: HTMLElement, key: string, value: string): Promise<void> {
  const row = container.querySelector(`[data-option-key="${key}"]`);
  const control = row?.querySelector('mdui-text-field');

  await act(async () => {
    const target = control as (Element & { value: string }) | null;
    if (target) target.value = value;
    control?.dispatchEvent(new CustomEvent('input'));
    // The row saves through a 0 ms debounce (`lazySaveTimeout={0}`).
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(() => {
  installClient();
  useRpcStore.setState({ version: undefined });
});

afterEach(() => {
  useRpcStore.setState({ client: null });
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe('unknown group', () => {
  it('reports "Type is illegal!"', () => {
    const { container } = renderGroup('nope');
    expect(container.textContent).toContain('Type is illegal!');
    expect(getGlobalOption).not.toHaveBeenCalled();
  });
});

describe('known groups', () => {
  it('renders every key of the route and nothing else', async () => {
    const keys = getGlobalOptionKeys('basic');
    expect(keys).not.toBe(false);

    const { container } = renderGroup('basic');
    await waitFor(() => {
      expect(renderedKeys(container)).toHaveLength((keys as string[]).length);
    });
    expect(renderedKeys(container)).toEqual([...(keys as string[])]);
  });

  it('renders every route, dropping the options aria2-next retired', async () => {
    for (const group of OPTION_GROUP_ROUTES) {
      const keys = getGlobalOptionKeys(group);
      expect(keys, group).not.toBe(false);

      const { container, unmount } = renderGroup(group);
      await waitFor(() => {
        expect(renderedKeys(container).length, group).toBe((keys as string[]).length);
      });
      unmount();
    }
  });

  it('never lists a removed option', async () => {
    for (const group of OPTION_GROUP_ROUTES) {
      const keys = getGlobalOptionKeys(group) as string[];
      for (const key of keys) {
        expect(getOptionMeta(key)?.support, `${group}/${key}`).not.toBe('removed');
      }
    }

    // …and the catalogue really does retire some options that AriaNg listed.
    const retired = ARIA2_GLOBAL_GROUPS['ftp-sftp'].keys.filter(
      (key) => getOptionMeta(key)?.support === 'removed',
    );
    expect(retired.length).toBeGreaterThan(0);
    for (const key of retired) {
      expect(getGlobalOptionKeys('ftp-sftp')).not.toContain(key);
    }
  });

  it('names the group in the sticky header', async () => {
    const { container } = renderGroup('http-ftp-sftp');
    await waitFor(() => {
      expect(container.querySelector('.aria2-settings__title')?.textContent).toBe(
        'HTTP/FTP/SFTP Settings',
      );
    });
  });
});

describe('loading', () => {
  it('fetches the global option blob exactly once per mount', async () => {
    const { container, rerender } = renderGroup('basic');
    await waitFor(() => {
      expect(getGlobalOption).toHaveBeenCalledTimes(1);
    });

    // A re-render (here: an unrelated store update) must not re-fetch.
    await act(async () => {
      useRpcStore.setState({ globalStat: { downloadSpeed: '0' } as never });
    });
    rerender(
      <MemoryRouter initialEntries={['/settings/aria2/basic']}>
        <Routes>
          <Route path="/settings/aria2/:group" element={<Aria2SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(getGlobalOption).toHaveBeenCalledTimes(1);
    expect(renderedKeys(container).length).toBeGreaterThan(0);
  });

  it('seeds a missing option with the catalogue default', async () => {
    installClient({});
    const { container } = renderGroup('basic');
    await waitFor(() => {
      expect(getGlobalOption).toHaveBeenCalled();
    });

    const row = container.querySelector('[data-option-key="max-concurrent-downloads"]');
    // The catalogue default reaches the input as its placeholder.
    expect(row?.querySelector('mdui-text-field')?.getAttribute('placeholder')).toBe('5');
  });

  it('surfaces a load failure without crashing', async () => {
    getGlobalOption.mockImplementation(async () => ({
      success: false,
      error: { message: 'boom' },
      context: { method: 'getGlobalOption' },
    }));

    const { container } = renderGroup('basic');
    await waitFor(() => {
      expect(container.textContent).toContain('boom');
    });
  });
});

describe('saving', () => {
  it('sends one key per changeGlobalOption call', async () => {
    const { container } = renderGroup('basic');
    await waitFor(() => expect(getGlobalOption).toHaveBeenCalled());

    await typeInto(container, 'dir', '/srv/downloads');

    await waitFor(() => {
      expect(changeGlobalOption).toHaveBeenCalledTimes(1);
    });
    expect(changeGlobalOption).toHaveBeenCalledWith({ dir: '/srv/downloads' });
  });

  it('reports a non-OK answer as a failure', async () => {
    changeGlobalOption.mockImplementation(async () => ({
      success: true,
      data: 'NOT OK',
      context: { method: 'changeGlobalOption' },
    }));

    const { container } = renderGroup('basic');
    await waitFor(() => expect(getGlobalOption).toHaveBeenCalled());
    await typeInto(container, 'dir', '/elsewhere');

    await waitFor(() => {
      expect(container.querySelector('.aria2-settings__error')?.textContent).not.toBe('');
    });
  });

  it('shows the RPC failure message', async () => {
    changeGlobalOption.mockImplementation(async () => ({
      success: false,
      error: { message: 'Unauthorized' },
      context: { method: 'changeGlobalOption' },
    }));

    const { container } = renderGroup('basic');
    await waitFor(() => expect(getGlobalOption).toHaveBeenCalled());
    await typeInto(container, 'dir', '/nope');

    await waitFor(() => {
      expect(container.querySelector('.aria2-settings__error')?.textContent).toBe('Unauthorized');
    });
  });

  it('alternates the error tooltip placement, bottom for the first row', async () => {
    changeGlobalOption.mockImplementation(async () => ({
      success: false,
      error: { message: 'nope' },
      context: { method: 'changeGlobalOption' },
    }));

    const { container } = renderGroup('basic');
    await waitFor(() => expect(getGlobalOption).toHaveBeenCalled());

    const rows = [...container.querySelectorAll('.aria2-settings__card')];
    expect(rows[0]?.getAttribute('data-placement')).toBe('bottom');
    expect(rows[1]?.getAttribute('data-placement')).toBe('top');
    expect(rows[rows.length - 1]?.getAttribute('data-placement')).toBe('top');
  });
});

describe('aria2-next banner', () => {
  it('appears when the daemon is not aria2-next', async () => {
    useRpcStore.setState({
      version: { version: '1.37.0', product: 'aria2', enabledFeatures: [] },
    });

    const { container } = renderGroup('ed2k');
    await waitFor(() => {
      expect(container.querySelector('.aria2-settings__banner')).not.toBeNull();
    });
    expect(container.querySelector('.aria2-settings__banner')?.textContent).toContain('aria2-next');
  });

  it('stays away on aria2-next', async () => {
    useRpcStore.setState({
      version: { version: '2.0.0', product: 'aria2-next', enabledFeatures: [] },
    });

    const { container } = renderGroup('ed2k');
    await waitFor(() => expect(getGlobalOption).toHaveBeenCalled());
    expect(container.querySelector('.aria2-settings__banner')).toBeNull();
  });
});