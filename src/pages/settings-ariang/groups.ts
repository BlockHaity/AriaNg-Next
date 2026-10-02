/**
 * Field metadata for the **Global** tab of `/settings/ariang`.
 *
 * This module is deliberately **pure and side-effect free**: it holds the row
 * order, the visibility rules and the option lists, and nothing else. Every
 * value it needs to decide "is this row visible?" arrives through the
 * `visibleWhen(settings, env)` signature, so the whole table can be unit tested
 * without a DOM, a store or an i18n bundle.
 *
 * The rows are the 25 rows of AriaNg's `settings-ariang.html`, in the exact
 * order they appear there. Three of them have no settings key at all:
 *
 * - `ariaNgVersion` — read-only build information,
 * - `importExport`  — a pair of buttons,
 * - `tips`          — the "changes take effect…" footer row.
 *
 * They are modelled as pseudo-keys of {@link SettingsFieldKey} so the table
 * stays a single ordered list (and so a test can assert "exactly 25 fields in
 * AriaNg's order" without special cases).
 */

import { LANGUAGES } from '@/config/languages';
import type { AriaNgSettings } from '@/config/types';

/**
 * Which control a row renders.
 *
 * `info` / `action` / `tips` have no control of their own — they are the
 * read-only version row, the import/export button pair and the footer row
 * respectively. AriaNg expressed all three as ordinary table rows too.
 */
export type SettingsFieldKind = 'text' | 'select' | 'switch' | 'interval' | 'info' | 'action' | 'tips';

/**
 * A settings key, or one of the four pseudo-keys listed above.
 *
 * `debugMode` is a real field but not a real setting: it lives in the
 * session-only store and is never persisted (AriaNg's `sessionSettings`).
 */
export type SettingsFieldKey = keyof AriaNgSettings | 'debugMode' | 'ariaNgVersion' | 'importExport' | 'tips';

/** Card a row is rendered in. Cards appear in the order given below. */
export type SettingsSectionId = 'general' | 'notification' | 'interval' | 'interaction' | 'task' | 'data';

export interface SettingsSection {
  id: SettingsSectionId;
  /** i18n key; unknown keys fall back to themselves, i.e. English. */
  labelKey: string;
}

/**
 * Everything the visibility rules are allowed to look at.
 *
 * All four members are computed once per render by the page and passed in, so
 * `GLOBAL_SETTINGS_FIELDS` never has to reach for `window`, a store or a hook.
 *
 * `debugMode` carries `session.debugMode || extendType === 'debug'` — the
 * session flag is not persisted, so it is passed in rather than read from
 * `AriaNgSettings`.
 */
export interface SettingsFieldEnv {
  /** The active profile speaks JSON-RPC over a WebSocket. */
  isWebSocket: boolean;
  /** `window.Notification` exists. */
  browserNotificationsSupported: boolean;
  /** `matchMedia('(prefers-color-scheme: dark)')` is available. */
  prefersDarkSupported: boolean;
  /** Session debug mode is on, or the URL ended in `/debug`. */
  debugMode: boolean;
}

export interface SettingsField {
  key: SettingsFieldKey;
  kind: SettingsFieldKind;
  labelKey: string;
  /** Secondary line / popover headline, e.g. the keyboard-shortcut table. */
  helpKey?: string;
  /** Select options; for booleans use `['true', 'false']`. */
  options?: readonly string[];
  /**
   * Environment-dependent option list. Only `theme` uses it: `system` is
   * meaningless in a browser without `prefers-color-scheme`, so it is dropped
   * there instead of being offered and then ignored.
   */
  optionsForEnv?: (env: SettingsFieldEnv) => readonly string[];
  /** Visibility predicate — e.g. browser notifications only with WS + Notification API. */
  visibleWhen?: (settings: AriaNgSettings, env: SettingsFieldEnv) => boolean;
  /** Interval presets in ms, for the refresh-interval selects. */
  intervalOptions?: readonly number[];
  suffix?: string;
  /** Card the row belongs to. */
  section: SettingsSectionId;
}

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * Interval presets shared by the four interval rows.
 *
 * AriaNg built these with
 * `ariaNgCommonService.getTimeOptions([1000, 2000, 3000, 5000, 10000, 30000, 60000], true)`,
 * i.e. **Disabled** plus seven periods — eight entries. A ninth (500 ms) is
 * added here so the four rows offer one consistent list that also covers the
 * sub-second poll an aria2 on a LAN can comfortably sustain; the relative order
 * of AriaNg's own eight entries is unchanged. `0` is AriaNg's "Disabled".
 */
export const INTERVAL_PRESETS: readonly number[] = [0, 500, 1000, 2000, 3000, 5000, 10000, 30000, 60000];

/** Language keys, in AriaNg's `naturalCompare`-sorted picker order. */
export const LANGUAGE_KEYS: readonly string[] = LANGUAGES.map((language) => language.key);

/** `Enabled` / `Disabled` — AriaNg's `trueFalseOptions`. */
export const BOOLEAN_OPTIONS: readonly string[] = ['true', 'false'];

/**
 * Upper bounds rendered by the "Show Pieces Info In Task Detail Page" rows.
 *
 * AriaNg translated the four `le…` values through
 * `translate-values="{value: '102,400'}"`, so the numbers are part of the
 * sentence and are grouped here rather than baked into an i18n key.
 */
export const PIECES_INFO_LIMITS: Readonly<Record<string, string>> = {
  le102400: '102,400',
  le10240: '10,240',
  le1024: '1,024',
};

/** Every option of the pieces-info select, in AriaNg's order. */
export const PIECES_INFO_OPTIONS: readonly string[] = ['always', 'le102400', 'le10240', 'le1024', 'never'];

/** Sections, in render order. The rows inside them stay in AriaNg's order. */
export const GLOBAL_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'general', labelKey: 'General' },
  { id: 'notification', labelKey: 'Notifications' },
  { id: 'interval', labelKey: 'Refresh Interval' },
  { id: 'interaction', labelKey: 'Interaction' },
  { id: 'task', labelKey: 'Tasks' },
  { id: 'data', labelKey: 'Data' },
];

/**
 * Changes that genuinely cannot be applied in place.
 *
 * AriaNg marked the four interval rows, the RPC list order and every RPC
 * profile row with an asterisk meaning "needs a page reload". That was an
 * artefact of its architecture: the intervals were seven independent Angular
 * `$interval`s created once at bootstrap, and switching an RPC profile called
 * `$window.location.reload()`.
 *
 * Here the scheduler re-reads every interval on each tick
 * (`scheduler.updateInterval`) and the RPC store hot-swaps the transport
 * (`useRpcStore.getState().applyProfile`), so those six rows apply the moment
 * they are changed. What is left:
 *
 * - **Language** — the translation bundle is loaded once at bootstrap.
 * - **Import Settings** — replaces the whole options blob, including the
 *   decoded secrets, so the shell rebuilds from storage on the next boot.
 * - **Reset Settings** — same, plus it re-derives every default.
 */
export const RELOAD_REQUIRED_KEYS: readonly SettingsFieldKey[] = ['language', 'importExport', 'tips'];

/** i18n key of the tip shown next to the reload-requiring rows. */
export const RELOAD_TIP_KEY = 'Changes to the settings take effect after refreshing page.';

/** The language notice AriaNg raised through its notification service. */
export const LANGUAGE_RELOAD_NOTICE_KEY = 'Language resource has been updated, please reload the page for the changes to take effect.';

/* ------------------------------------------------------------------ */
/* the table                                                           */
/* ------------------------------------------------------------------ */

/** Browser notifications need both the push channel and the API. */
function notificationsAvailable(_settings: AriaNgSettings, env: SettingsFieldEnv): boolean {
  return env.browserNotificationsSupported && env.isWebSocket;
}

/** `theme` options, minus `system` where `prefers-color-scheme` is missing. */
function themeOptions(env: SettingsFieldEnv): readonly string[] {
  return env.prefersDarkSupported ? ['light', 'dark', 'system'] : ['light', 'dark'];
}

/**
 * The 25 Global-tab rows, in AriaNg's order.
 *
 * @see {@link GLOBAL_SETTINGS_SECTIONS} for the cards they are grouped into.
 */
export const GLOBAL_SETTINGS_FIELDS: readonly SettingsField[] = [
  /*  1 */ {
    key: 'ariaNgVersion',
    kind: 'info',
    labelKey: 'AriaNg Version',
    section: 'general',
  },
  /*  2 */ {
    key: 'language',
    kind: 'select',
    labelKey: 'Language',
    options: LANGUAGE_KEYS,
    section: 'general',
  },
  /*  3 */ {
    key: 'theme',
    kind: 'select',
    labelKey: 'Theme',
    options: ['light', 'dark', 'system'],
    optionsForEnv: themeOptions,
    section: 'general',
  },
  /*  4 */ {
    key: 'debugMode',
    kind: 'select',
    labelKey: 'Debug Mode',
    options: BOOLEAN_OPTIONS,
    // AriaNg kept this row hidden unless the session flag was already on, or
    // the user came in through `…/settings/ariang/debug`.
    visibleWhen: (_settings, env) => env.debugMode,
    section: 'general',
  },
  /*  5 */ {
    key: 'title',
    kind: 'text',
    labelKey: 'Page Title',
    helpKey: 'Supported Placeholder',
    section: 'general',
  },
  /*  6 */ {
    key: 'browserNotification',
    kind: 'switch',
    labelKey: 'Enable Browser Notification',
    visibleWhen: notificationsAvailable,
    section: 'notification',
  },
  /*  7 */ {
    key: 'browserNotificationSound',
    kind: 'switch',
    labelKey: 'Browser Notification Sound',
    visibleWhen: (settings, env) => notificationsAvailable(settings, env) && settings.browserNotification,
    section: 'notification',
  },
  /*  8 */ {
    key: 'browserNotificationFrequency',
    kind: 'select',
    labelKey: 'Browser Notification Frequency',
    options: ['unlimited', 'high', 'middle', 'low'],
    visibleWhen: (settings, env) => notificationsAvailable(settings, env) && settings.browserNotification,
    section: 'notification',
  },
  /*  9 */ {
    key: 'webSocketReconnectInterval',
    kind: 'interval',
    labelKey: 'WebSocket Auto Reconnect Interval',
    intervalOptions: INTERVAL_PRESETS,
    section: 'interval',
  },
  /* 10 */ {
    key: 'titleRefreshInterval',
    kind: 'interval',
    labelKey: 'Updating Page Title Interval',
    intervalOptions: INTERVAL_PRESETS,
    section: 'interval',
  },
  /* 11 */ {
    key: 'globalStatRefreshInterval',
    kind: 'interval',
    labelKey: 'Updating Global Stat Interval',
    intervalOptions: INTERVAL_PRESETS,
    section: 'interval',
  },
  /* 12 */ {
    key: 'downloadTaskRefreshInterval',
    kind: 'interval',
    labelKey: 'Updating Task Information Interval',
    intervalOptions: INTERVAL_PRESETS,
    section: 'interval',
  },
  /* 13 */ {
    key: 'keyboardShortcuts',
    kind: 'switch',
    labelKey: 'Keyboard Shortcuts',
    helpKey: 'Supported Keyboard Shortcuts',
    section: 'interaction',
  },
  /* 14 */ {
    key: 'swipeGesture',
    kind: 'switch',
    labelKey: 'Swipe Gesture',
    section: 'interaction',
  },
  /* 15 */ {
    key: 'dragAndDropTasks',
    kind: 'switch',
    labelKey: 'Change Tasks Order by Drag-and-drop',
    section: 'interaction',
  },
  /* 16 */ {
    key: 'rpcListDisplayOrder',
    kind: 'select',
    labelKey: 'RPC List Display Order',
    options: ['recentlyUsed', 'rpcAlias'],
    section: 'interaction',
  },
  /* 17 */ {
    key: 'taskListIndependentDisplayOrder',
    kind: 'switch',
    labelKey: 'Each Task List Page Uses Independent Display Order',
    section: 'task',
  },
  /* 18 */ {
    key: 'afterCreatingNewTask',
    kind: 'select',
    labelKey: 'Action After Creating New Tasks',
    options: ['task-list', 'task-detail'],
    section: 'task',
  },
  /* 19 */ {
    key: 'afterRetryingTask',
    kind: 'select',
    labelKey: 'Action After Retrying Task',
    // `stay-on-current` was the value in AriaNg's markup; the settings type
    // spells it `current-page`, and the settings store is what validates an
    // imported blob, so the type wins.
    options: ['task-list-downloading', 'task-detail', 'current-page'],
    section: 'task',
  },
  /* 20 */ {
    key: 'removeOldTaskAfterRetrying',
    kind: 'switch',
    labelKey: 'Remove Old Tasks After Retrying',
    section: 'task',
  },
  /* 21 */ {
    key: 'confirmTaskRemoval',
    kind: 'switch',
    labelKey: 'Confirm Task Removal',
    section: 'task',
  },
  /* 22 */ {
    key: 'includePrefixWhenCopyingFromTaskDetails',
    kind: 'switch',
    labelKey: 'Include Prefix When Copying From Task Details',
    section: 'task',
  },
  /* 23 */ {
    key: 'showPiecesInfoInTaskDetailPage',
    kind: 'select',
    labelKey: 'Show Pieces Info In Task Detail Page',
    options: PIECES_INFO_OPTIONS,
    section: 'task',
  },
  /* 24 */ {
    key: 'importExport',
    kind: 'action',
    labelKey: 'Import / Export AriaNg Settings',
    section: 'data',
  },
  /* 25 */ {
    key: 'tips',
    kind: 'tips',
    labelKey: RELOAD_TIP_KEY,
    section: 'data',
  },
];

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Whether a row is rendered at all. */
export function isFieldVisible(field: SettingsField, settings: AriaNgSettings, env: SettingsFieldEnv): boolean {
  return field.visibleWhen ? field.visibleWhen(settings, env) === true : true;
}

/**
 * The option list of a select, resolved against the environment.
 *
 * `optionsForEnv` wins over the static list (only `theme` has one), so a
 * static consumer still sees the complete set.
 */
export function optionsForField(field: SettingsField, env: SettingsFieldEnv): readonly string[] {
  if (field.optionsForEnv) {
    return field.optionsForEnv(env);
  }
  return field.options ?? [];
}

/** The rows to render, in order, with the invisible ones dropped. */
export function visibleGlobalSettingsFields(
  settings: AriaNgSettings,
  env: SettingsFieldEnv,
): readonly SettingsField[] {
  return GLOBAL_SETTINGS_FIELDS.filter((field) => isFieldVisible(field, settings, env));
}

/** Rows of one section, in order. */
export function fieldsOfSection(
  fields: readonly SettingsField[],
  section: SettingsSectionId,
): readonly SettingsField[] {
  return fields.filter((field) => field.section === section);
}

/** The row of one key, or `undefined` when the key is not rendered. */
export function findField(key: SettingsFieldKey): SettingsField | undefined {
  return GLOBAL_SETTINGS_FIELDS.find((field) => field.key === key);
}
