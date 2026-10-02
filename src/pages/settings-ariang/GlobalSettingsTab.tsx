/**
 * The **Global** tab of `/settings/ariang` — AriaNg's first `tab-pane`, with its
 * 25 rows grouped into MD3 cards.
 *
 * Two architectural differences from AriaNg are worth stating up front, because
 * they are why the "needs a reload" asterisk is nearly gone:
 *
 * 1. **No reload, no re-mount.** Every change goes straight to
 *    `useSettingsStore.update`, which re-renders the rows in place. AriaNg let
 *    Angular's two-way binding write the option object and then had to reload
 *    for anything the bootstrap had captured once.
 * 2. **The shell hot-applies the rest.** `app/BootstrapGate.tsx` subscribes to
 *    this store and calls `scheduler.updateInterval(...)` for the three polling
 *    jobs; the RPC store swaps the transport through `applyProfile(...)` when a
 *    profile is activated. Only the translation bundle (loaded once at
 *    bootstrap), Import Settings and Reset Settings still need a reload — see
 *    {@link RELOAD_REQUIRED_KEYS}.
 *
 * Writes are **not** debounced here: the settings store already coalesces them
 * (300 ms, `PERSIST_DEBOUNCE_MS` in `store/settings.ts`). Adding a second
 * timer would only widen the window in which a crash loses the edit.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AriaNgSettings, RpcProfile, SessionSettings, ThemeSetting } from '@/config/types';
import { getLanguageByKey } from '@/config/languages';
import { APP_CONSTANTS } from '@/config/defaults';
import { i18n } from '@/i18n';
import { formatTimeOption } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import type { TranslateFn } from '@/i18n/types';
import { clearSettingHistories } from '@/store/history';
import { useSettingsStore } from '@/store/settings';
import {
  confirmDialog,
  MduiButton,
  MduiCard,
  MduiIconButton,
  MduiSelect,
  MduiSwitch,
  MduiTooltip,
} from '@/ui/mdui';
import { setTheme } from '@/ui/mdui/theme';
import {
  fieldsOfSection,
  GLOBAL_SETTINGS_FIELDS,
  GLOBAL_SETTINGS_SECTIONS,
  optionsForField,
  PIECES_INFO_LIMITS,
} from './groups';
import type { SettingsField, SettingsFieldEnv } from './groups';
import { ExportSettingsDialog } from './ExportSettingsDialog';
import { ImportSettingsDialog } from './ImportSettingsDialog';
import { PageTitleEditor } from './PageTitleEditor';
import { GLOBAL_SHORTCUT_DESCRIPTIONS } from '@/utils/keyboard';

import './styles.css';

/** AriaNg's `$window.location.reload()`; jsdom throws, so it is guarded. */
function reloadPage(): void {
  try {
    window.location.reload();
  } catch (error) {
    console.warn('[settings] reload failed', error);
  }
}

/**
 * Build information, the way AriaNg's `ariaNgVersionService` reported it.
 *
 * AriaNg baked `buildVersion` / `buildCommit` into its bundle at build time and
 * rendered `version (commit)`. The shell injects the same pair through
 * `window.__ARIANG_NEXT_BUILD__`; until it does, the app name stands in.
 */
export function appVersionInfo(): string {
  if (typeof window !== 'undefined' && window.__ARIANG_NEXT_BUILD__) {
    return window.__ARIANG_NEXT_BUILD__;
  }
  return APP_CONSTANTS.title;
}

/** `Translated Name (DisplayName)` — AriaNg's language `<option>` text. */
export function languageLabel(t: TranslateFn, key: string): string {
  const language = getLanguageByKey(key);
  if (!language) return key;

  const nameKey = `languages.${language.name}`;
  const translated = t(nameKey);
  // AriaNg fell back to the untranslated name when the bundle had no entry.
  const name = translated && translated !== nameKey ? translated : language.name;
  return `${name} (${language.displayName})`;
}

/** AriaNg's `<option>` text for the pieces-info rows. */
export function piecesInfoLabel(t: TranslateFn, value: string): string {
  if (value === 'always') return t('Always');
  if (value === 'never') return t('Never');
  return t('Pieces Amount is Less than or Equal to {value}', { value: PIECES_INFO_LIMITS[value] ?? value });
}

/** `Disabled` / `1 Second` / `5 Seconds` — AriaNg's `timeDisplayName` filter. */
export function intervalLabel(t: TranslateFn, ms: number): string {
  return formatTimeOption(ms, 'Disabled', t);
}

/** i18n label of one select option. */
export function selectOptionLabel(field: SettingsField, option: string, t: TranslateFn): string {
  if (field.key === 'language') return languageLabel(t, option);

  if (field.key === 'theme') {
    if (option === 'system') return t('Follow system settings');
    return t(option === 'dark' ? 'Dark' : 'Light');
  }

  if (field.kind === 'switch' || field.key === 'debugMode') {
    return t(option === 'true' ? 'Enabled' : 'Disabled');
  }

  switch (field.key) {
    case 'browserNotificationFrequency':
      if (option === 'unlimited') return t('Unlimited');
      if (option === 'high') return t('High (Up to 10 Notifications / 1 Minute)');
      if (option === 'middle') return t('Middle (Up to 1 Notification / 1 Minute)');
      return t('Low (Up to 1 Notification / 5 Minutes)');
    case 'rpcListDisplayOrder':
      return t(option === 'recentlyUsed' ? 'Recently Used' : 'RPC Alias');
    case 'afterCreatingNewTask':
      return t(option === 'task-list' ? 'Navigate to Task List Page' : 'Navigate to Task Detail Page');
    case 'afterRetryingTask':
      if (option === 'task-list-downloading') return t('Navigate to Downloading Tasks Page');
      if (option === 'task-detail') return t('Navigate to Task Detail Page');
      return t('Stay on Current Page');
    case 'showPiecesInfoInTaskDetailPage':
      return piecesInfoLabel(t, option);
    default:
      return option;
  }
}

/** What the page-level notice is about; see {@link GlobalSettingsTabProps}. */
export type ReloadReason = 'language' | 'importSettings' | 'resetSettings';

export interface GlobalSettingsTabProps {
  settings: AriaNgSettings;
  session: SessionSettings;
  env: SettingsFieldEnv;
  /** `${rpcprofile}` source for the Page Title preview (the default profile). */
  previewProfile: RpcProfile | null;
  /** true once a reload-requiring change happened in this session. */
  reloadPending: boolean;
  /** Raised when a change that cannot be applied in place happens. */
  onNeedsReload: (reason: ReloadReason) => void;
}

export function GlobalSettingsTab(props: GlobalSettingsTabProps) {
  const { settings, session, env, previewProfile, reloadPending, onNeedsReload } = props;
  const t = useTranslate();
  const update = useSettingsStore((state) => state.update);
  const reset = useSettingsStore((state) => state.reset);
  const setSessionDebugMode = useSettingsStore((state) => state.setSessionDebugMode);

  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  /**
   * Language.
   *
   * `i18n.setLocale` loads and applies the new table immediately — AriaNg's
   * `applyLanguage` did the same — but the *components* were already built
   * against the previous table, hence the reload notice.
   */
  const changeLanguage = useCallback(
    (value: string) => {
      if (!value || value === settings.language) return;
      update({ language: value });
      void i18n.setLocale(value);
      onNeedsReload('language');
    },
    [onNeedsReload, settings.language, update],
  );

  const changeTheme = useCallback(
    (value: string) => {
      if (value !== 'light' && value !== 'dark' && value !== 'system') return;
      const setting: ThemeSetting = value;
      update({ theme: setting });
      setTheme(setting);
    },
    [update],
  );

  /** One write path for every row. */
  const write = useCallback(
    (field: SettingsField, raw: string) => {
      switch (field.key) {
        case 'debugMode':
          setSessionDebugMode(raw === 'true');
          return;
        case 'language':
          changeLanguage(raw);
          return;
        case 'theme':
          changeTheme(raw);
          return;
        case 'title':
          update({ title: raw });
          return;
        default:
          break;
      }

      // Every remaining row is a real `AriaNgSettings` key; the pseudo-keys are
      // all handled above. One cast, one place: the metadata table cannot carry
      // a per-key value type, and the row kind already decided it here.
      const key = field.key as keyof AriaNgSettings;
      if (field.kind === 'switch') {
        update({ [key]: raw === 'true' } as Partial<AriaNgSettings>);
        return;
      }
      if (field.kind === 'interval') {
        update({ [key]: Number(raw) } as Partial<AriaNgSettings>);
        return;
      }
      update({ [key]: raw } as Partial<AriaNgSettings>);
    },
    [changeLanguage, changeTheme, setSessionDebugMode, update],
  );

  const resetSettings = useCallback(async () => {
    const confirmed = await confirmDialog({
      heading: t('Confirm Reset'),
      text: t('Are you sure you want to reset all settings?'),
      okText: t('Confirm'),
      cancelText: t('Cancel'),
      icon: 'warning',
      danger: true,
    });
    if (!confirmed) return;

    reset();
    onNeedsReload('resetSettings');
    reloadPage();
  }, [onNeedsReload, reset, t]);

  const clearHistory = useCallback(async () => {
    const confirmed = await confirmDialog({
      heading: t('Confirm Clear'),
      text: t('Are you sure you want to clear all settings history?'),
      okText: t('Confirm'),
      cancelText: t('Cancel'),
      icon: 'warning',
      danger: true,
    });
    if (!confirmed) return;

    clearSettingHistories();
    reloadPage();
  }, [t]);

  const sections = useMemo(
    () =>
      GLOBAL_SETTINGS_SECTIONS.map((section) => ({
        ...section,
        fields: fieldsOfSection(GLOBAL_SETTINGS_FIELDS, section.id).filter(
          (field) => (field.visibleWhen ? field.visibleWhen(settings, env) : true) === true,
        ),
      })).filter((section) => section.fields.length > 0),
    [env, settings],
  );

  return (
    <div className="settings-ariang__global">
      {sections.map((section) => (
        <MduiCard key={section.id} variant="outlined" className="settings-section">
          <h2 className="settings-section__headline">{t(section.labelKey)}</h2>
          <div className="settings-section__rows">
            {section.fields.map((field) => (
              <GlobalSettingRow
                key={field.key}
                field={field}
                settings={settings}
                session={session}
                env={env}
                previewProfile={previewProfile}
                reloadPending={reloadPending}
                onWrite={write}
                onImport={() => setImportOpen(true)}
                onExport={() => setExportOpen(true)}
                onReset={() => void resetSettings()}
                onClearHistory={() => void clearHistory()}
              />
            ))}
          </div>
        </MduiCard>
      ))}

      <ImportSettingsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          onNeedsReload('importSettings');
          reloadPage();
        }}
      />
      <ExportSettingsDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* one row                                                            */
/* ------------------------------------------------------------------ */

interface GlobalSettingRowProps {
  field: SettingsField;
  settings: AriaNgSettings;
  session: SessionSettings;
  env: SettingsFieldEnv;
  previewProfile: RpcProfile | null;
  /** true once a reload-requiring change happened in this session. */
  reloadPending: boolean;
  onWrite: (field: SettingsField, value: string) => void;
  onImport: () => void;
  onExport: () => void;
  onReset: () => void;
  onClearHistory: () => void;
}

function GlobalSettingRow(props: GlobalSettingRowProps) {
  const { field, settings, session, env, previewProfile, reloadPending } = props;
  const t = useTranslate();

  const current = readValue(settings, session, field);
  let control: ReactNode = null;
  let stacked = false;

  switch (field.kind) {
    case 'info':
      control = <span className="settings-row__hint">{appVersionInfo()}</span>;
      break;

    case 'action':
      control = (
        <div className="settings-row__buttons">
          <MduiButton variant="outlined" icon="content-copy" onClick={props.onImport}>
            {t('Import Settings')}
          </MduiButton>
          <MduiButton variant="outlined" icon="save" onClick={props.onExport}>
            {t('Export Settings')}
          </MduiButton>
        </div>
      );
      break;

    case 'tips':
      control = <TipsRow showReloadTip={reloadPending} onReset={props.onReset} onClearHistory={props.onClearHistory} />;
      break;

    case 'switch':
      control = (
        <MduiSwitch
          checked={current === true || current === 'true'}
          label={t(field.labelKey)}
          onChange={(checked) => props.onWrite(field, checked ? 'true' : 'false')}
        />
      );
      break;

    case 'interval':
      control = (
        <MduiSelect
          value={String(current ?? '')}
          items={(field.intervalOptions ?? []).map((ms) => ({ value: String(ms), label: intervalLabel(t, ms) }))}
          label={t(field.labelKey)}
          onChange={(next) => props.onWrite(field, next)}
        />
      );
      break;

    case 'select':
      control = (
        <MduiSelect
          value={String(current ?? '')}
          items={optionsForField(field, env).map((option) => ({
            value: option,
            label: selectOptionLabel(field, option, t),
          }))}
          label={t(field.labelKey)}
          onChange={(next) => props.onWrite(field, next)}
        />
      );
      break;

    case 'text':
    default:
      stacked = true;
      control = (
        <PageTitleEditor
          value={settings.title}
          onChange={(next) => props.onWrite(field, next)}
          profile={previewProfile}
        />
      );
      break;
  }

  return (
    <div className="settings-row" data-setting-key={field.key}>
      <div className="settings-row__key">
        <span className="settings-row__label">{t(field.labelKey)}</span>
        {field.helpKey === 'Supported Keyboard Shortcuts' ? <ShortcutHelpAffordance /> : null}
      </div>
      <div className={stacked ? 'settings-row__value settings-row__value--stack' : 'settings-row__value'}>
        {control}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* row pieces                                                         */
/* ------------------------------------------------------------------ */

/**
 * AriaNg's keyboard-shortcut popover.
 *
 * The table is {@link GLOBAL_SHORTCUT_DESCRIPTIONS}; `Ctrl/⌘` is spelled once
 * because `utils/keyboard` picks the platform modifier at match time.
 */
function ShortcutHelp() {
  const t = useTranslate();

  return (
    <>
      {GLOBAL_SHORTCUT_DESCRIPTIONS.map((shortcut) => (
        <div key={shortcut.keys} className="placeholder-row">
          <span>{t(shortcut.action)}</span>
          <code>{shortcut.keys}</code>
        </div>
      ))}
    </>
  );
}

/** AriaNg's `?` popover trigger for the shortcut table. */
function ShortcutHelpAffordance() {
  const t = useTranslate();

  return (
    <MduiTooltip
      variant="rich"
      placement="right"
      headline={t('Supported Keyboard Shortcuts')}
      content={<ShortcutHelp />}
    >
      <MduiIconButton icon="info" variant="standard" label={t('Supported Keyboard Shortcuts')} />
    </MduiTooltip>
  );
}

/** The footer row: AriaNg's `*` tip plus Reset / Clear Settings History. */
function TipsRow(props: { showReloadTip: boolean; onReset: () => void; onClearHistory: () => void }) {
  const { showReloadTip, onReset, onClearHistory } = props;
  const t = useTranslate();

  return (
    <div className="settings-tips">
      {showReloadTip ? (
        <span role="status">
          <span className="settings-row__asterisk">*</span>{' '}
          {t('Changes to the settings take effect after refreshing page.')}
        </span>
      ) : null}
      <div className="settings-tips__buttons">
        <MduiButton variant="text" icon="restart-alt" onClick={onReset}>
          {t('Reset Settings')}
        </MduiButton>
        <MduiButton variant="text" icon="delete" onClick={onClearHistory}>
          {t('Clear Settings History')}
        </MduiButton>
      </div>
    </div>
  );
}

/** Read a row's current value, whatever its kind. */
function readValue(
  settings: AriaNgSettings,
  session: SessionSettings,
  field: SettingsField,
): string | number | boolean {
  if (field.key === 'debugMode') {
    return session.debugMode;
  }
  return settings[field.key as keyof AriaNgSettings] as string | number | boolean;
}

export default GlobalSettingsTab;