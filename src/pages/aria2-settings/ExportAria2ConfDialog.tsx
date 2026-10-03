/**
 * `Export aria2.conf` — a dialog on the aria2 settings page.
 *
 * ## Why
 *
 * `aria2.changeGlobalOption` is runtime-only. It never writes to disk, so every
 * setting changed through this UI evaporates on restart, and there was no way to get
 * the current state back out into the file aria2 reads at startup. This is the
 * missing half of the loop; `src/domain/aria2-conf.ts` does the serialising and
 * documents the format rules, each of which was verified against a real daemon.
 *
 * ## Interaction
 *
 * Deliberately the same shape as `ExportSettingsDialog`: open to a preview, save or
 * copy, close.
 *
 * The body is a separate component mounted only while the dialog is open, so
 * reopening re-reads the daemon from scratch and "Copied" is gone again — by
 * remounting, rather than by a pile of state resets in an effect that has to run in
 * the right order to avoid a flash of the previous snapshot.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslate } from '@/i18n/react';
import { useRpcStore } from '@/store/rpc-store';
import { copyText } from '@/utils/clipboard';
import { isBlobSupported, saveFileContent } from '@/utils/files';
import { MduiButton, MduiDialog, MduiIconButton } from '@/ui/mdui';

import { buildAria2Conf, EXCLUDED_CONF_KEYS, findUnrepresentableKeys } from '@/domain/aria2-conf';

import './styles.css';

/** The name aria2 itself documents for this file. */
export const ARIA2_CONF_FILE_NAME = 'aria2.conf';

/** `text/plain` — the file is configuration, not JSON, and must not be pretty-printed. */
const CONF_CONTENT_TYPE = 'text/plain';

export interface ExportAria2ConfDialogProps {
  open: boolean;
  onClose: () => void;
}

/* -------------------------------------------------------------------------- */
/* the body: mounted only while the dialog is open                            */
/* -------------------------------------------------------------------------- */

function ConfExportBody() {
  const t = useTranslate();
  const client = useRpcStore((state) => state.client);
  const version = useRpcStore((state) => state.version);

  const [snapshot, setSnapshot] = useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);

  /**
   * One request per opening: `getGlobalOption` returns every global option in a
   * single payload. The request is abandoned on unmount, so closing the dialog
   * mid-flight cannot land an answer in a dialog that is already gone.
   */
  useEffect(() => {
    if (!client) return;

    let cancelled = false;

    void (async () => {
      const result = await client.getGlobalOption();
      if (cancelled) return;

      if (result.success) {
        setSnapshot(result.data as Record<string, string>);
      } else {
        setLoadError(result.error.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const { conf, skipped } = useMemo(() => {
    if (!snapshot) return { conf: '', skipped: [] as string[] };

    return {
      conf: buildAria2Conf(snapshot, { product: version?.product, version: version?.version }),
      skipped: findUnrepresentableKeys(snapshot).filter((key) => !EXCLUDED_CONF_KEYS.has(key)),
    };
  }, [snapshot, version]);

  const copy = useCallback(async () => {
    if (await copyText(conf)) setCopied(true);
  }, [conf]);

  const save = useCallback(() => {
    if (!saveFileContent(conf, ARIA2_CONF_FILE_NAME, CONF_CONTENT_TYPE)) {
      console.warn('[aria2] this browser cannot write the export file');
    }
  }, [conf]);

  const ready = conf !== '';

  return (
    <>
      <div className="settings-dialog__toolbar">
        {isBlobSupported() && ready ? <MduiIconButton icon="save" label={t('Save')} onClick={save} /> : null}
        {ready ? (
          <MduiIconButton
            icon="content-copy"
            label={t('Copy')}
            onClick={() => {
              void copy();
            }}
          />
        ) : null}
        {copied ? (
          <span className="settings-dialog__copied" role="status">
            {t('Copied')}
          </span>
        ) : null}
      </div>

      {!client ? (
        <p className="aria2-settings__error-text" role="alert">
          {t('Cannot connect to aria2!')}
        </p>
      ) : null}

      {loadError ? (
        <p className="aria2-settings__error-text" role="alert">
          {loadError}
        </p>
      ) : null}

      {/*
        A plain read-only `<textarea>` for the same reason `ExportSettingsDialog` uses
        one: the mdui wrapper deliberately exposes no `readOnly` prop, and an export
        must never be edited in place.
      */}
      <textarea
        className="settings-dialog__textarea"
        aria-label={t('aria2.conf data')}
        readOnly
        rows={20}
        value={conf}
        onChange={() => {
          /* read-only: React still wants an onChange for a controlled value */
        }}
      />

      <p className="settings-dialog__hint">
        {t(
          'This is a snapshot of the running daemon. aria2.changeGlobalOption never writes to disk, so options changed here are lost on restart unless this file is applied.',
        )}
      </p>

      {skipped.length > 0 ? (
        <p className="settings-dialog__hint" role="status">
          {t('Omitted: {{keys}} — the value cannot be written on one line.', { keys: skipped.join(', ') })}
        </p>
      ) : null}

    </>
  );
}

/* -------------------------------------------------------------------------- */
/* the dialog shell                                                           */
/* -------------------------------------------------------------------------- */

export function ExportAria2ConfDialog({ open, onClose }: ExportAria2ConfDialogProps) {
  const t = useTranslate();

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <MduiDialog
      open={open}
      icon="save"
      headline={t('Export aria2.conf')}
      onClosed={close}
      className="settings-dialog"
      actions={
        <MduiButton variant="text" onClick={close}>
          {t('Cancel')}
        </MduiButton>
      }
    >
      {/* Mounted only while open: see the note at the top of the file. */}
      {open ? <ConfExportBody /> : null}
    </MduiDialog>
  );
}

export default ExportAria2ConfDialog;