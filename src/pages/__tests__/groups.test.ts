/**
 * Tests for the Global-tab field table.
 *
 * The table is pure data, so it is tested without a DOM, a store or an i18n
 * bundle: every assertion here is about **order**, **visibility** and **option
 * lists**, which is exactly the contract `GlobalSettingsTab` renders against.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, createDefaultSettings } from '@/config/defaults';
import type { AriaNgSettings } from '@/config/types';
import {
  fieldsOfSection,
  findField,
  GLOBAL_SETTINGS_FIELDS,
  GLOBAL_SETTINGS_SECTIONS,
  INTERVAL_PRESETS,
  isFieldVisible,
  LANGUAGE_KEYS,
  optionsForField,
  PIECES_INFO_OPTIONS,
  RELOAD_REQUIRED_KEYS,
  visibleGlobalSettingsFields,
} from '../settings-ariang/groups';
import type { SettingsFieldEnv } from '../settings-ariang/groups';

/** A settings blob with every conditional flipped the "visible" way. */
function settingsWith(patch: Partial<AriaNgSettings>): AriaNgSettings {
  return { ...createDefaultSettings(), ...patch };
}

/** The full env matrix: four independent booleans. */
function env(patch: Partial<SettingsFieldEnv> = {}): SettingsFieldEnv {
  return {
    isWebSocket: false,
    browserNotificationsSupported: false,
    prefersDarkSupported: false,
    debugMode: false,
    ...patch,
  };
}

const ALL_ON: SettingsFieldEnv = env({
  isWebSocket: true,
  browserNotificationsSupported: true,
  prefersDarkSupported: true,
  debugMode: true,
});

/** AriaNg's row order, 1-based, with the label each row carried. */
const ARIA_NG_ORDER: readonly string[] = [
  'AriaNg Version',
  'Language',
  'Theme',
  'Debug Mode',
  'Page Title',
  'Enable Browser Notification',
  'Browser Notification Sound',
  'Browser Notification Frequency',
  'WebSocket Auto Reconnect Interval',
  'Updating Page Title Interval',
  'Updating Global Stat Interval',
  'Updating Task Information Interval',
  'Keyboard Shortcuts',
  'Swipe Gesture',
  'Change Tasks Order by Drag-and-drop',
  'RPC List Display Order',
  'Each Task List Page Uses Independent Display Order',
  'Action After Creating New Tasks',
  'Action After Retrying Task',
  'Remove Old Tasks After Retrying',
  'Confirm Task Removal',
  'Include Prefix When Copying From Task Details',
  'Show Pieces Info In Task Detail Page',
  'Import / Export AriaNg Settings',
  'Changes to the settings take effect after refreshing page.',
];

describe('GLOBAL_SETTINGS_FIELDS', () => {
  it('holds exactly 25 rows', () => {
    expect(GLOBAL_SETTINGS_FIELDS).toHaveLength(25);
  });

  it('keeps AriaNg’s row order', () => {
    expect(GLOBAL_SETTINGS_FIELDS.map((field) => field.labelKey)).toEqual([...ARIA_NG_ORDER]);
  });

  it('gives every row a non-empty label key', () => {
    for (const field of GLOBAL_SETTINGS_FIELDS) {
      expect(field.labelKey, field.key).not.toBe('');
      expect(field.labelKey.trim(), field.key).not.toBe('');
    }
  });

  it('binds every row to a card', () => {
    const ids = new Set(GLOBAL_SETTINGS_SECTIONS.map((section) => section.id));
    for (const field of GLOBAL_SETTINGS_FIELDS) {
      expect(ids.has(field.section), field.key).toBe(true);
    }
  });

  it('keeps the cards contiguous, so the rendered order matches the table', () => {
    let previous = -1;
    for (const field of GLOBAL_SETTINGS_FIELDS) {
      const index = GLOBAL_SETTINGS_SECTIONS.findIndex((section) => section.id === field.section);
      expect(index, field.key).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });

  it('uses unique keys', () => {
    const keys = GLOBAL_SETTINGS_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('visibility', () => {
  const debug = findField('debugMode');
  const notification = findField('browserNotification');
  const sound = findField('browserNotificationSound');
  const frequency = findField('browserNotificationFrequency');

  it('hides the Debug Mode row unless the session flag or `?extendType=debug` is on', () => {
    expect(isFieldVisible(debug!, DEFAULT_SETTINGS, env({ debugMode: false }))).toBe(false);
    expect(isFieldVisible(debug!, DEFAULT_SETTINGS, env({ debugMode: true }))).toBe(true);
  });

  it('shows every row that has no predicate', () => {
    const unconditional = GLOBAL_SETTINGS_FIELDS.filter((field) => !field.visibleWhen);
    expect(unconditional.map((field) => field.key)).toContain('swipeGesture');
    expect(unconditional.map((field) => field.key)).toContain('rpcListDisplayOrder');

    for (const field of unconditional) {
      expect(isFieldVisible(field, DEFAULT_SETTINGS, env())).toBe(true);
    }
  });

  it('needs both the Notification API and a WebSocket for browser notifications', () => {
    expect(isFieldVisible(notification!, DEFAULT_SETTINGS, env())).toBe(false);
    expect(isFieldVisible(notification!, DEFAULT_SETTINGS, env({ isWebSocket: true }))).toBe(false);
    expect(
      isFieldVisible(notification!, DEFAULT_SETTINGS, env({ browserNotificationsSupported: true })),
    ).toBe(false);
    expect(isFieldVisible(notification!, DEFAULT_SETTINGS, ALL_ON)).toBe(true);
  });

  it('shows the sound and the frequency rows only while notifications are enabled', () => {
    const off = settingsWith({ browserNotification: false });
    const on = settingsWith({ browserNotification: true });

    expect(isFieldVisible(sound!, off, ALL_ON)).toBe(false);
    expect(isFieldVisible(frequency!, off, ALL_ON)).toBe(false);
    expect(isFieldVisible(sound!, on, ALL_ON)).toBe(true);
    expect(isFieldVisible(frequency!, on, ALL_ON)).toBe(true);

    // …and never without the transport / API.
    expect(isFieldVisible(sound!, on, env())).toBe(false);
  });

  it('renders 21 rows on the most restrictive env and all 25 on the most permissive one', () => {
    // Four rows are conditional: the three notification rows and Debug Mode.
    expect(visibleGlobalSettingsFields(DEFAULT_SETTINGS, env())).toHaveLength(21);
    expect(visibleGlobalSettingsFields(settingsWith({ browserNotification: true }), ALL_ON)).toHaveLength(25);
  });
});

describe('option lists', () => {
  const theme = findField('theme');

  it('gains and loses the `system` option with `prefers-color-scheme` support', () => {
    expect(optionsForField(theme!, env({ prefersDarkSupported: true }))).toEqual([
      'light',
      'dark',
      'system',
    ]);
    expect(optionsForField(theme!, env({ prefersDarkSupported: false }))).toEqual(['light', 'dark']);
  });

  it('always publishes the complete theme list on the field itself', () => {
    expect(theme?.options).toEqual(['light', 'dark', 'system']);
  });

  it('offers every supported language', () => {
    expect(LANGUAGE_KEYS).toHaveLength(11);
    expect(LANGUAGE_KEYS).toContain('en');
    expect(LANGUAGE_KEYS).toContain('zh_Hans');

    const language = findField('language');
    expect(language?.options).toEqual(LANGUAGE_KEYS);
  });

  it('gives the pieces-info row its five options, in AriaNg’s order', () => {
    expect(PIECES_INFO_OPTIONS).toEqual(['always', 'le102400', 'le10240', 'le1024', 'never']);
    expect(findField('showPiecesInfoInTaskDetailPage')?.options).toHaveLength(5);
  });

  it('gives every interval row the same nine presets', () => {
    expect(INTERVAL_PRESETS).toHaveLength(9);
    // AriaNg: Disabled + 1s, 2s, 3s, 5s, 10s, 30s, 60s — plus 500 ms.
    expect(INTERVAL_PRESETS).toEqual([0, 500, 1000, 2000, 3000, 5000, 10000, 30000, 60000]);

    const intervals = GLOBAL_SETTINGS_FIELDS.filter((field) => field.kind === 'interval');
    expect(intervals.map((field) => field.key)).toEqual([
      'webSocketReconnectInterval',
      'titleRefreshInterval',
      'globalStatRefreshInterval',
      'downloadTaskRefreshInterval',
    ]);

    for (const field of intervals) {
      expect(field.intervalOptions, field.key).toEqual(INTERVAL_PRESETS);
    }
  });

  it('describes the notification frequency with AriaNg’s four buckets', () => {
    expect(findField('browserNotificationFrequency')?.options).toEqual([
      'unlimited',
      'high',
      'middle',
      'low',
    ]);
  });

  it('renders booleans as Enabled / Disabled', () => {
    for (const field of GLOBAL_SETTINGS_FIELDS) {
      if (field.kind === 'switch') {
        expect(field.key).not.toBe('debugMode');
      }
    }
    expect(findField('debugMode')?.options).toEqual(['true', 'false']);
  });
});

describe('reload requirements', () => {
  it('keeps the reduced set: language, import, reset', () => {
    expect(RELOAD_REQUIRED_KEYS).toEqual(['language', 'importExport', 'tips']);
  });

  it('no longer marks the four intervals or the RPC list order', () => {
    for (const key of [
      'webSocketReconnectInterval',
      'titleRefreshInterval',
      'globalStatRefreshInterval',
      'downloadTaskRefreshInterval',
      'rpcListDisplayOrder',
    ] as const) {
      expect(RELOAD_REQUIRED_KEYS).not.toContain(key);
    }
  });
});

describe('section helpers', () => {
  it('returns the rows of one card in table order', () => {
    expect(fieldsOfSection(GLOBAL_SETTINGS_FIELDS, 'notification').map((field) => field.key)).toEqual([
      'browserNotification',
      'browserNotificationSound',
      'browserNotificationFrequency',
    ]);
  });

  it('knows every key it is asked about', () => {
    expect(findField('title')?.kind).toBe('text');
    expect(findField('nope' as never)).toBeUndefined();
  });
});