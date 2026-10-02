/**
 * `Export Settings` — AriaNg's `#export-settings-modal`.
 *
 * The payload is `settings.exportAll()`: the complete options blob, pretty
 * printed, with `secret` **still base64 encoded**. That is AriaNg's behaviour
 * and it is kept deliberately — an export has to be re-importable byte for byte
 * by both this app and the original — which is why the dialog warns that the
 * file contains credentials.
 *
 * The JSON is derived while rendering (from `open`) rather than fetched in an
 * effect, so opening the dialog can never show a stale snapshot and closing it
 * clears the "Copied" confirmation without a reset effect.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslate } from '@/i18n/react';
import { useSettingsStore } from '@/store/settings';
import { copyText } from '@/utils/clipboard';
import { isBlobSupported, saveFileContent } from '@/utils/files';
import { MduiButton, MduiDialog, MduiIconButton } from '@/ui/mdui';

/** AriaNg's `ng-file-name="AriaNgConfig.json"`. */
export const EXPORT_FILE_NAME = 'AriaNgConfig.json';

/** AriaNg's `ng-content-type="application/json"`. */
const EXPORT_CONTENT_TYPE = 'application/json';

export interface ExportSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportSettingsDialog({ open, onClose }: ExportSettingsDialogProps) {
  const t = useTranslate();
  const exportAll = useSettingsStore((state) => state.exportAll);
  const [copied, setCopied] = useState(false);

  /** AriaNg generated the JSON when the modal opened and dropped it on hide. */
  const json = useMemo(() => {
    if (!open) return '';
    try {
      return exportAll();
    } catch (error) {
      console.error('[settings] export failed', error);
      return '';
    }
  }, [open, exportAll]);

  const close = useCallback(() => {
    setCopied(false);
    onClose();
  }, [onClose]);

  const copy = useCallback(async () => {
    if (await copyText(json)) {
      setCopied(true);
    }
  }, [json]);

  const save = useCallback(() => {
    if (!saveFileContent(json, EXPORT_FILE_NAME, EXPORT_CONTENT_TYPE)) {
      console.warn('[settings] this browser cannot write the export file');
    }
  }, [json]);

  return (
    <MduiDialog
      open={open}
      icon="save"
      headline={t('Export Settings')}
      onClosed={close}
      className="settings-dialog"
      actions={
        <MduiButton variant="text" onClick={close}>
          {t('Cancel')}
        </MduiButton>
      }
    >
      <div className="settings-dialog__toolbar">
        {isBlobSupported() ? <MduiIconButton icon="save" label={t('Save')} onClick={save} /> : null}
        <MduiIconButton
          icon="content-copy"
          label={t('Copy')}
          onClick={() => {
            void copy();
          }}
        />
        {copied ? (
          <span className="settings-dialog__copied" role="status">
            {t('Copied')}
          </span>
        ) : null}
      </div>

      {/*
        A plain read-only `<textarea>` rather than `<mdui-text-field>`: the
        wrapper deliberately exposes no `readOnly` prop, and a settings export
        must never be edited in place (AriaNg used `readonly="readonly"`).
      */}
      <textarea
        className="settings-dialog__textarea"
        aria-label={t('AriaNg settings data')}
        readOnly
        rows={20}
        value={json}
        onChange={() => {
          /* read-only: React still wants an onChange for a controlled value */
        }}
      />

      <p className="settings-dialog__hint">
        {t('The exported file contains your RPC credentials (base64 encoded, not encrypted).')}
      </p>
    </MduiDialog>
  );
}

export default ExportSettingsDialog;