/**
 * `Import Settings` — AriaNg's `#import-settings-modal`.
 *
 * The dialog is deliberately forgiving about **how** the JSON arrives (paste it,
 * or open an `AriaNgConfig.json`) and strict about **what** it contains: the
 * store's `importAll` re-validates every key, drops unknown ones and rebuilds
 * `extendRpcServers` field by field, so a hand-edited or hostile blob cannot
 * smuggle anything into the running app.
 *
 * Backwards compatibility is the point of this dialog for an existing install:
 * an `AriaNg.Options` blob exported by the original AriaNg is accepted as-is,
 * which is the migration path.
 *
 * The body is a child component mounted only while the dialog is open, so
 * AriaNg's `hide.bs.modal` reset (`context.importSettings = null`) is a plain
 * remount instead of an effect.
 */

import { useCallback, useState } from 'react';
import { useTranslate } from '@/i18n/react';
import { useSettingsStore } from '@/store/settings';
import { openFile } from '@/utils/files';
import { alertDialog, confirmDialog, MduiButton, MduiDialog, MduiIconButton, MduiTextarea } from '@/ui/mdui';

export interface ImportSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called after a successful import. The page passes `() => location.reload()`
   * because the whole options blob (including the decoded secrets) changed and
   * the shell rebuilds from storage on the next boot.
   */
  onImported?: () => void;
}

export function ImportSettingsDialog({ open, onClose, onImported }: ImportSettingsDialogProps) {
  const t = useTranslate();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const importAll = useSettingsStore((state) => state.importAll);

  const openConfigFile = useCallback(async () => {
    try {
      const file = await openFile({ fileFilter: '.json', accept: '.json,application/json' });
      setText(file.textContent ?? '');
      setError('');
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : String(openError);
      setError(message);
      void alertDialog({ heading: t('Import Settings'), text: message, okText: t('Confirm') });
    }
  }, [t]);

  /**
   * Close and clear.
   *
   * AriaNg reset `context.importSettings` from the modal's `hide.bs.modal`
   * handler; doing it here (a user action, not an effect) means reopening always
   * starts from an empty box and a disabled Import button.
   */
  const close = useCallback(() => {
    setText('');
    setError('');
    onClose();
  }, [onClose]);

  const runImport = useCallback(async () => {
    // AriaNg parsed the text first and reported `Invalid settings data format!`
    // itself, *before* asking for confirmation; `importAll` repeats the check
    // because it is also reachable from the command API.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error('[settings] parse settings json error', parseError);
      setError(t('Invalid settings data format!'));
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error('[settings] settings json is not object');
      setError(t('Invalid settings data format!'));
      return;
    }

    const confirmed = await confirmDialog({
      heading: t('Confirm Import'),
      text: t('Are you sure you want to import all settings?'),
      okText: t('Import'),
      cancelText: t('Cancel'),
      icon: 'warning',
      danger: true,
    });
    if (!confirmed) return;

    const result = importAll(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setError('');
    close();
    try {
      onImported?.();
    } catch (reloadError) {
      console.warn('[settings] reload after import failed', reloadError);
    }
  }, [close, importAll, onImported, t, text]);

  const canImport = text.trim().length > 0;

  return (
    <MduiDialog
      open={open}
      icon="folder-open"
      headline={t('Import Settings')}
      description={t('AriaNg settings data')}
      onClosed={close}
      className="settings-dialog"
      actions={
        <>
          <MduiButton variant="filled" disabled={!canImport} onClick={() => void runImport()}>
            {t('Import')}
          </MduiButton>
          <MduiButton variant="text" onClick={close}>
            {t('Cancel')}
          </MduiButton>
        </>
      }
    >
      <div className="settings-dialog__toolbar">
        <MduiIconButton
          icon="folder-open"
          label={t('Open')}
          onClick={() => {
            void openConfigFile();
          }}
        />
        <span className="settings-dialog__hint">
          {t('A settings file exported by AriaNg can be imported directly.')}
        </span>
      </div>

      <MduiTextarea
        value={text}
        rows={20}
        label={t('AriaNg settings data')}
        placeholder={t('AriaNg settings data')}
        onInput={setText}
      />

      {/* Announced immediately: the dialog is modal, so a screen-reader user
          must not have to hunt around for the failure. */}
      <span className="ariang-visually-hidden" role="alert" aria-live="assertive">
        {error}
      </span>
      {error ? <p className="settings-dialog__error">{error}</p> : null}
    </MduiDialog>
  );
}

export default ImportSettingsDialog;