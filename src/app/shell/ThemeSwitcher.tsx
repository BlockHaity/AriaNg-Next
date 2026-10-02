/**
 * Theme switch for the top app bar.
 *
 * mdui themes are a class on `<html>` (`mdui-theme-light` / `-dark` / `-auto`),
 * and `setTheme()` in `theme.ts` is the single writer. This button is the visible
 * entry point to that: without it the only way to reach a dark UI is the Theme
 * select buried in Settings → AriaNg → Global, which reads as "this app has no
 * dark mode" even though the machinery is all present.
 *
 * The button cycles the **setting**, not the resolved scheme — light → dark →
 * system — so the third press genuinely hands control back to the OS. The icon
 * shows the setting, and the label names it, so the current state is legible
 * without opening anything. The three states are also reachable directly from a
 * dropdown, which is what the cycling hides.
 */

import { useCallback } from 'react';
import { useTranslate } from '@/i18n';
import { useSettingsStore } from '@/store/settings';
import { MduiDropdown, MduiIconButton, MduiMenu, MduiMenuItem } from '@/ui/mdui';
import { getTheme, nextThemeSetting, setTheme } from '@/ui/mdui/theme';

import type { ThemeSetting } from '@/ui/mdui/theme';

/** Icon per setting: the *target* is shown on the button, the *current* in the menu. */
const SETTING_ICON: Record<ThemeSetting, string> = {
  light: 'light-mode',
  dark: 'dark-mode',
  system: 'contrast',
};

const ORDER: readonly ThemeSetting[] = ['light', 'dark', 'system'];

function settingLabel(setting: ThemeSetting, t: (key: string) => string): string {
  if (setting === 'light') return t('Light');
  if (setting === 'dark') return t('Dark');
  return t('Follow system settings');
}

export function ThemeSwitcher() {
  const t = useTranslate();
  const theme = useSettingsStore((state) => state.settings.theme);
  const update = useSettingsStore((state) => state.update);

  /**
   * Apply and persist a setting.
   *
   * `setTheme` puts the mdui class on `<html>` *and* emits `themechange`, which is
   * what the speed chart and the piece map listen for. The store write is what
   * survives a reload — `BootstrapGate` re-applies it once mdui's components are
   * registered.
   */
  const apply = useCallback(
    (setting: ThemeSetting) => {
      update({ theme: setting });
      setTheme(setting);
    },
    [update],
  );

  const cycle = useCallback(() => {
    apply(nextThemeSetting(theme));
  }, [apply, theme]);

  const items = [
    <MduiMenu key="theme" selects="single" value={theme}>
      {ORDER.map((setting) => (
        <MduiMenuItem
          key={setting}
          value={setting}
          // The tick marks the *current* setting, matching the display-order menu.
          icon={setting === theme ? 'check' : undefined}
          selected={setting === theme}
          onClick={() => apply(setting)}
        >
          {settingLabel(setting, t)}
        </MduiMenuItem>
      ))}
    </MduiMenu>,
  ];

  return (
    <MduiDropdown
      trigger={
        <MduiIconButton
          icon={SETTING_ICON[theme]}
          label={`${t('Theme')}: ${settingLabel(theme, t)} (${getTheme()})`}
          onClick={cycle}
        />
      }
      items={items}
      placement="bottom"
    />
  );
}