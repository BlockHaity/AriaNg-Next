/**
 * The footer status bar — AriaNg's `md-toolbar` at the bottom of the layout.
 *
 * ```
 * [☰ Toggle Navigation] [Shortcut ▾]                    [ speed popover trigger ]
 * ```
 *
 * The **Shortcut** dropdown opens the *Global Rate Limit* dialog, which is
 * AriaNg's `globalRateLimit` modal component: the two keys from
 * `ARIA2_QUICK_SETTINGS.globalSpeedLimit` (`max-overall-download-limit` and
 * `max-overall-upload-limit`) edited through `changeGlobalOption`. AriaNg had
 * that as a template + controller pair; there is no route for it, so it lives
 * here, next to the button that opens it.
 *
 * The live speeds are AriaNg's `ng-pop-chart` trigger — the whole readout is the
 * popover, so {@link GlobalSpeedChart} owns the interactive element and this file
 * only supplies the text.
 */
import { useCallback, useEffect, useState } from 'react';

import { GlobalSpeedChart } from './GlobalSpeedChart';
import { useTranslate } from '@/i18n';
import { readableVolume } from '@/i18n';
import { ARIA2_QUICK_SETTINGS } from '@/config/option-groups';
import { getAria2ClientOrNull } from '@/rpc';
import { changeGlobalOption } from '@/store/commands';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import { useUiStore } from '@/store/ui';
import { MduiButton, MduiDialog, MduiDropdown, MduiIconButton, MduiMenu, MduiMenuItem, MduiTextField } from '@/ui/mdui';

/* -------------------------------------------------------------------------- */
/* the global rate limit dialog                                               */
/* -------------------------------------------------------------------------- */

/**
 * `max-overall-download-limit` / `max-overall-upload-limit`.
 *
 * The current values are read once when the dialog opens (`aria2.getGlobalOption`
 * answers with the whole bag), and both keys are written back on save — AriaNg
 * submitted them one by one through `changeGlobalOption`.
 *
 * ## Why this lives here and not in the page module
 *
 * The footer button opens it and there is no route for it, so the shell owns the
 * component; keeping it here also keeps `OptionRow` and the aria2 option table out
 * of the route-independent part of the graph.
 *
 * NOTE: `@/pages/aria2-settings` also ships a `GlobalSpeedLimitDialog` for its own
 * settings pages. The two are intentionally independent — if the project decides to
 * have a single dialog, this is the one line to delete, and the footer should open
 * the page-owned component instead.
 */
function GlobalRateLimitDialog({ open, onClosed }: { open: boolean; onClosed: () => void }) {
  const t = useTranslate();
  const keys = ARIA2_QUICK_SETTINGS.globalSpeedLimit;
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const client = getAria2ClientOrNull();
    if (!client) {
      // Nothing to read: the fields stay empty and save simply reports failure.
      return;
    }
    void client.getGlobalOption().then((result) => {
      if (cancelled || !result.success) {
        return;
      }
      const next: Record<string, string> = {};
      for (const key of keys) {
        next[key] = String(result.data?.[key] ?? '');
      }
      setValues(next);
    });
    return () => {
      cancelled = true;
    };
    // `keys` is a module constant; only the open state may re-trigger the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSave = useCallback(() => {
    for (const key of keys) {
      void changeGlobalOption(key, values[key] ?? '');
    }
    onClosed();
  }, [keys, onClosed, values]);

  return (
    <MduiDialog
      open={open}
      headline={t('Global Rate Limit')}
      icon="speed"
      closeOnEsc
      closeOnOverlayClick
      onClosed={onClosed}
      actions={
        <>
          <MduiButton variant="text" onClick={onClosed}>
            {t('Cancel')}
          </MduiButton>
          <MduiButton variant="filled" onClick={onSave}>
            {t('OK')}
          </MduiButton>
        </>
      }
    >
      {keys.map((key) => (
        <MduiTextField
          key={key}
          value={values[key] ?? ''}
          label={key}
          variant="outlined"
          onInput={(value: string) => {
            setValues((current) => ({ ...current, [key]: value }));
          }}
        />
      ))}
    </MduiDialog>
  );
}

/* -------------------------------------------------------------------------- */
/* the status bar                                                             */
/* -------------------------------------------------------------------------- */

export function StatusBar() {
  const t = useTranslate();
  const globalStat = useRpcStore((state) => state.globalStat);
  const drawerOpen = useUiStore((state) => state.drawerOpen);
  // The live readout only makes sense while something is polling.
  const live = useSettingsStore((state) => state.settings.globalStatRefreshInterval > 0);

  const [rateLimitOpen, setRateLimitOpen] = useState(false);

  const shortcutItems = [
    <MduiMenu key="shortcuts">
      <MduiMenuItem
        icon="speed"
        onClick={() => {
          setRateLimitOpen(true);
        }}
      >
        {t('Global Rate Limit')}
      </MduiMenuItem>
    </MduiMenu>,
  ];

  return (
    <>
      <mdui-bottom-app-bar>
        <MduiIconButton
          icon="menu"
          label={t('Toggle Navigation')}
          selected={drawerOpen}
          onClick={() => {
            useUiStore.getState().toggleDrawer();
          }}
        />

        <MduiDropdown
          trigger={
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <MduiIconButton icon="tune" label={t('Shortcut')} />
              <MduiIconButton icon="expand-more" label={t('Shortcut')} />
            </div>
          }
          items={shortcutItems}
          placement="top"
        />

        {live ? (
          <GlobalSpeedChart
            translate={t}
            label={`${t('Download')} / ${t('Upload')}`}
          >
            <span>
              {`${t('Download')}: ${readableVolume(globalStat?.downloadSpeed ?? 0, 'auto')}/s`}
            </span>
            <span>
              {`${t('Upload')}: ${readableVolume(globalStat?.uploadSpeed ?? 0, 'auto')}/s`}
            </span>
          </GlobalSpeedChart>
        ) : null}
      </mdui-bottom-app-bar>

      <GlobalRateLimitDialog open={rateLimitOpen} onClosed={() => setRateLimitOpen(false)} />
    </>
  );
}