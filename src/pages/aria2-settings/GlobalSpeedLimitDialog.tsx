/**
 * Global Rate Limit — AriaNg's `ng-setting-dialog` (`directives/settingDialog.js`
 * + `views/setting-dialog.html`), the quick-settings modal the footer opens.
 *
 * It is the same editor as an option group with a different key list:
 * `getQuickSettingKeys('globalSpeedLimit')` resolves to
 * `max-overall-download-limit` + `max-overall-upload-limit` (AriaNg's
 * `aria2QuickSettingsAvailableOptions`), both saved through
 * `changeGlobalOption`.
 *
 * The dialog is owned by the **shell** (the footer button opens it); only the
 * component lives here, which is why it takes `open` / `onClose` as props
 * instead of a "setting" object to watch. The body is a separate component
 * mounted only while `open` is true — AriaNg cleared the loaded options on
 * `hidden.bs.modal`, and a remount does that without a reset effect.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getOptionMeta } from '@/config/aria2-options';
import { getQuickSettingKeys } from '@/config/option-groups';
import { useTranslate } from '@/i18n/react';
import type { Aria2OptionMap } from '@/rpc/types';
import { useRpcStore } from '@/store/rpc-store';
import { OptionRow } from '@/components/option-row';
import { MduiButton, MduiDialog } from '@/ui/mdui';

import './styles.css';

export interface GlobalSpeedLimitDialogProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSpeedLimitDialog({ open, onClose }: GlobalSpeedLimitDialogProps) {
  const t = useTranslate();

  return (
    <MduiDialog
      open={open}
      icon="speed"
      headline={t('Global Rate Limit')}
      onClosed={onClose}
      className="aria2-settings__dialog"
      actions={
        <MduiButton variant="text" onClick={onClose}>
          {t('Cancel')}
        </MduiButton>
      }
    >
      {open ? <GlobalSpeedLimitBody /> : null}
    </MduiDialog>
  );
}

/** The two rows plus their load / save plumbing. */
function GlobalSpeedLimitBody() {
  const t = useTranslate();
  const client = useRpcStore((state) => state.client);
  const keys = getQuickSettingKeys('globalSpeedLimit');

  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `setting-dialog.html` showed a spinner over the body until the payload had
  // arrived, then rendered the rows.
  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!client) {
        if (!cancelled) setLoading(false);
        return;
      }

      const result = await client.getGlobalOption();
      if (cancelled || !mounted.current) return;

      setLoading(false);
      if (!result.success) {
        setErrors({ global: result.error.message });
        return;
      }

      const next: Record<string, string> = {};
      for (const key of keys) {
        const value = result.data[key];
        next[key] =
          value === undefined || value === null ? (getOptionMeta(key)?.defaultValue ?? '') : String(value);
      }
      setValues(next);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [client, keys]);

  const save = useCallback(
    async (key: string, value: string) => {
      if (!client) return;

      setValues((prev) => ({ ...prev, [key]: value }));
      const result = await client.changeGlobalOption({ [key]: value } as Aria2OptionMap);
      if (!mounted.current) return;

      if (result.success && result.data === 'OK') {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }

      setErrors((prev) => ({
        ...prev,
        [key]: result.success ? t('Operation Result') : result.error.message,
      }));
    },
    [client, t],
  );

  return (
    <div className="aria2-settings__dialog-body">
      {loading ? (
        <p className="aria2-settings__note" role="status">
          {t('Loading')}
        </p>
      ) : null}

      {keys.map((key) => (
        <div key={key} className="aria2-settings__card">
          <OptionRow
            optionKey={key}
            value={values[key]}
            globalValue={getOptionMeta(key)?.defaultValue}
            lazySaveTimeout={0}
            onChange={(value) => {
              void save(key, value);
            }}
          />
          {errors[key] ? (
            <p className="aria2-settings__error-text" role="tooltip">
              {errors[key]}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default GlobalSpeedLimitDialog;