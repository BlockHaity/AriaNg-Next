/**
 * Tests for the theme module.
 *
 * mdui's own theme functions are mocked so the assertions describe *this* layer:
 * the `system` resolution, the listener lifecycle, and the meta-tag sync.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setThemeMock = vi.fn();
const getThemeMock = vi.fn(() => 'light');
const setColorSchemeMock = vi.fn();
const removeColorSchemeMock = vi.fn();

vi.mock('mdui/functions/setTheme.js', () => ({ setTheme: (t: string) => setThemeMock(t) }));
vi.mock('mdui/functions/getTheme.js', () => ({ getTheme: () => getThemeMock() }));
vi.mock('mdui/functions/setColorScheme.js', () => ({ setColorScheme: (h: string, o: unknown) => setColorSchemeMock(h, o) }));
vi.mock('mdui/functions/removeColorScheme.js', () => ({ removeColorScheme: (t: unknown) => removeColorSchemeMock(t) }));
vi.mock('mdui/functions/getColorFromImage.js', () => ({ getColorFromImage: async () => '#123456' }));

const {
  M3_SEED_COLORS,
  THEME_CHANGE_EVENT,
  currentColorScheme,
  getTheme,
  nextThemeSetting,
  notifyThemeChange,
  onThemeChange,
  prefersDark,
  removeColorScheme,
  resolveTheme,
  setColorScheme,
  setTheme,
} = await import('../mdui/theme');

/* -------------------------------------------------------------------------- */
/* matchMedia stub                                                            */
/* -------------------------------------------------------------------------- */

type ChangeHandler = (event: MediaQueryListEvent) => void;

interface StubMedia {
  matches: boolean;
  set(value: boolean): void;
  listeners: Set<ChangeHandler>;
}

let media: StubMedia;
let originalMatchMedia: typeof window.matchMedia;

function installMatchMedia(initialMatches: boolean): StubMedia {
  media = {
    matches: initialMatches,
    listeners: new Set(),
    set(value: boolean) {
      media.matches = value;
      const event = { matches: value } as MediaQueryListEvent;
      for (const listener of media.listeners) listener(event);
    },
  };

  window.matchMedia = ((query: string) => {
    if (query !== '(prefers-color-scheme: dark)') {
      return { matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {} };
    }
    return {
      get matches() {
        return media.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: ChangeHandler) => media.listeners.add(listener),
      removeEventListener: (_type: string, listener: ChangeHandler) => media.listeners.delete(listener),
      addListener: (listener: ChangeHandler) => media.listeners.add(listener),
      removeListener: (listener: ChangeHandler) => media.listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return media;
}

const cleanups: (() => void)[] = [];

/** Wrap `onThemeChange` so every subscription is torn down after the test. */
function subscribe(listener: (resolved: 'light' | 'dark') => void): () => void {
  const unsubscribe = onThemeChange(listener);
  cleanups.push(unsubscribe);
  return unsubscribe;
}

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  installMatchMedia(false);
  setThemeMock.mockClear();
  getThemeMock.mockReset();
  getThemeMock.mockReturnValue('light');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // A leaked subscription would keep the module-level matchMedia listener
  // attached and silently disable the next test.
  while (cleanups.length) cleanups.pop()?.();
  window.matchMedia = originalMatchMedia;
});

/* -------------------------------------------------------------------------- */
/* prefersDark / resolveTheme                                                 */
/* -------------------------------------------------------------------------- */

describe('prefersDark', () => {
  it('reads the media query', () => {
    installMatchMedia(false);
    expect(prefersDark()).toBe(false);
    installMatchMedia(true);
    expect(prefersDark()).toBe(true);
  });

  it('falls back to false when matchMedia is unavailable', () => {
    // @ts-expect-error deliberately removing the API
    window.matchMedia = undefined;
    expect(prefersDark()).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('passes explicit settings straight through', () => {
    installMatchMedia(true);
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('honours a stubbed matchMedia for "system"', () => {
    installMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');

    installMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });
});

/* -------------------------------------------------------------------------- */
/* setTheme / getTheme                                                        */
/* -------------------------------------------------------------------------- */

describe('setTheme', () => {
  it('maps "system" onto mdui\'s "auto"', () => {
    setTheme('system');
    expect(setThemeMock).toHaveBeenCalledWith('auto');
  });

  it('passes explicit values through unchanged', () => {
    setTheme('light');
    setTheme('dark');
    expect(setThemeMock).toHaveBeenNthCalledWith(1, 'light');
    expect(setThemeMock).toHaveBeenNthCalledWith(2, 'dark');
  });

  it('does not throw when mdui fails', () => {
    setThemeMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => setTheme('dark')).not.toThrow();
  });

  it('keeps the meta theme-color tag in sync', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    setTheme('dark');
    // The content itself comes from the resolved `--mdui-color-surface` token,
    // which jsdom does not compute; the scheme must still be recorded.
    expect(meta.getAttribute('data-scheme')).toBe('dark');

    installMatchMedia(true);
    setTheme('system');
    expect(meta.getAttribute('data-scheme')).toBe('dark');

    installMatchMedia(false);
    setTheme('system');
    expect(meta.getAttribute('data-scheme')).toBe('light');

    meta.remove();
  });
});

describe('getTheme', () => {
  it('resolves the setting mdui reports', () => {
    getThemeMock.mockReturnValue('auto');
    installMatchMedia(true);
    expect(getTheme()).toBe('dark');

    getThemeMock.mockReturnValue('light');
    expect(getTheme()).toBe('light');
  });

  it('falls back to the OS preference when mdui throws', () => {
    getThemeMock.mockImplementation(() => {
      throw new Error('boom');
    });
    installMatchMedia(true);
    expect(getTheme()).toBe('dark');
  });
});

/* -------------------------------------------------------------------------- */
/* nextThemeSetting                                                           */
/* -------------------------------------------------------------------------- */

describe('nextThemeSetting', () => {
  it('cycles light → dark → system → light', () => {
    expect(nextThemeSetting('light')).toBe('dark');
    expect(nextThemeSetting('dark')).toBe('system');
    expect(nextThemeSetting('system')).toBe('light');
  });

  it('returns "light" for an unknown value', () => {
    // @ts-expect-error deliberately invalid input
    expect(nextThemeSetting('sepia')).toBe('light');
  });
});

/* -------------------------------------------------------------------------- */
/* onThemeChange                                                               */
/* -------------------------------------------------------------------------- */

describe('onThemeChange', () => {
  it('fires when the OS flips while the setting is "system"', () => {
    getThemeMock.mockReturnValue('auto');
    const stub = installMatchMedia(false);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    stub.set(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('dark');

    stub.set(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith('light');

    unsubscribe();
  });

  it('stops firing after unsubscribe', () => {
    getThemeMock.mockReturnValue('auto');
    const stub = installMatchMedia(false);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    stub.set(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    stub.set(false);
    expect(listener).toHaveBeenCalledTimes(1);
    // The media listener is torn down once the last subscriber leaves.
    expect(media.listeners.size).toBe(0);
  });

  it('keeps other subscribers alive when one unsubscribes', () => {
    getThemeMock.mockReturnValue('auto');
    const stub = installMatchMedia(false);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribe(first);
    const unsubscribeSecond = subscribe(second);

    unsubscribeFirst();
    stub.set(true);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('dark');

    unsubscribeSecond();
  });

  it('does not fire for an explicit light/dark setting', () => {
    getThemeMock.mockReturnValue('dark');
    const stub = installMatchMedia(false);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    stub.set(false);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('dispatches a themechange CustomEvent on window', () => {
    getThemeMock.mockReturnValue('auto');
    const stub = installMatchMedia(false);
    const events: CustomEvent[] = [];
    const handler = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener(THEME_CHANGE_EVENT, handler);

    const unsubscribe = subscribe(vi.fn());
    stub.set(true);

    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ resolved: 'dark', setting: 'system' });

    unsubscribe();
    window.removeEventListener(THEME_CHANGE_EVENT, handler);
  });

  it('notifyThemeChange pushes the current theme to every subscriber', () => {
    getThemeMock.mockReturnValue('dark');
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    notifyThemeChange();
    expect(listener).toHaveBeenCalledWith('dark');

    unsubscribe();
  });

  it('a throwing listener does not break the others', () => {
    getThemeMock.mockReturnValue('auto');
    const stub = installMatchMedia(false);
    const good = vi.fn();
    const unsubscribeBad = subscribe(() => {
      throw new Error('bad listener');
    });
    const unsubscribeGood = subscribe(good);

    expect(() => stub.set(true)).not.toThrow();
    expect(good).toHaveBeenCalledWith('dark');

    unsubscribeBad();
    unsubscribeGood();
  });
});

/* -------------------------------------------------------------------------- */
/* colour scheme                                                              */
/* -------------------------------------------------------------------------- */

describe('colour scheme', () => {
  it('records and clears the current scheme', () => {
    expect(currentColorScheme()).toBeUndefined();

    setColorScheme('#6750a4');
    expect(setColorSchemeMock).toHaveBeenCalledWith('#6750a4', { target: undefined });
    expect(currentColorScheme()).toBe('#6750a4');

    removeColorScheme();
    expect(removeColorSchemeMock).toHaveBeenCalled();
    expect(currentColorScheme()).toBeUndefined();
  });

  it('passes an explicit target through without changing the global scheme', () => {
    const target = document.createElement('div');
    setColorScheme('#415f91', { target });
    expect(setColorSchemeMock).toHaveBeenCalledWith('#415f91', { target });
    expect(currentColorScheme()).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* seed colours                                                               */
/* -------------------------------------------------------------------------- */

describe('M3_SEED_COLORS', () => {
  it('contains the documented MD3 baseline seeds', () => {
    const hexes = M3_SEED_COLORS.map((entry) => entry.hex.toLowerCase());
    for (const expected of [
      '#6750a4',
      '#415f91',
      '#006a6a',
      '#386a20',
      '#7d5260',
      '#8f4c38',
      '#616200',
      '#984061',
      '#3f6837',
      '#006874',
      '#3f4b7f',
      '#5c5f77',
    ]) {
      expect(hexes).toContain(expected);
    }
  });

  it('gives every entry a translation key', () => {
    for (const entry of M3_SEED_COLORS) {
      expect(entry.nameKey).toMatch(/^theme\.color\./);
      expect(entry.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});