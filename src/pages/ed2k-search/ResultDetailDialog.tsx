/**
 * The per-result detail dialog.
 *
 * Shows **every** field the daemon reported, not a curated subset: an ED2K link
 * is opaque (`ed2k://|file|<name>|<length>|<md4>|/`), the MD4 hash is what
 * identifies the file on the network, and `sourceNetwork` / `mediaCodec` are the
 * two pieces of metadata a user cannot get back from the table once the search
 * is gone. Each value carries its own copy button, which matters most for the
 * link — that is the string users paste into a third-party client.
 *
 * The dialog also spells the contract out: `ed2kLink` is *the* value handed to
 * `aria2.addUri`, which is the manual's only stated guarantee about a result.
 */

import { useCallback, useState } from 'react';

import { FILE_TYPES, OTHER_FILE_TYPE } from '@/config/file-types';
import type { FileTypeCategory } from '@/config/file-types';
import { copyText } from '@/utils/clipboard';
import { MduiButton, MduiDialog, MduiIcon, MduiSnackbar } from '@/ui/mdui';
import { categoryIcon, formatFileLength } from './format';
import type { NormalizedEd2kResult } from './format';
import { useLocalTranslate } from './index';

export interface ResultDetailDialogProps {
  result: NormalizedEd2kResult | null;
  onClose: () => void;
}

/** AriaNg's own category labels (`Videos`, `Audios`, …), as the task picker uses them. */
function categoryName(category: FileTypeCategory, t: (key: string) => string): string {
  const definition =
    FILE_TYPES.find((entry) => entry.category === category) ??
    (category === OTHER_FILE_TYPE.category ? OTHER_FILE_TYPE : undefined);

  return definition ? t(definition.nameKey) : t(OTHER_FILE_TYPE.nameKey);
}

export function ResultDetailDialog({ result, onClose }: ResultDetailDialogProps) {
  const t = useLocalTranslate();
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null);

  /**
   * `copyText` resolves `false` instead of throwing (it has to, because the
   * Clipboard API is unavailable on the plain-HTTP origins this app is usually
   * served from), so both outcomes are reported the same way.
   */
  const copy = useCallback(
    (value: string | undefined) => {
      if (!value) {
        return;
      }
      void copyText(value).then((ok) =>
        setNotice({ message: ok ? t('ed2k.copied') : t('ed2k.copyFailed'), ok }),
      );
    },
    [t],
  );

  const category = result ? categoryName(result.category, t) : '';

  return (
    <>
      <MduiDialog
        open={result !== null}
        className="ed2k-detail"
        headline={t('ed2k.detail.title')}
        onClosed={onClose}
        onCancel={onClose}
        actions={
          <>
            <MduiButton
              variant="tonal"
              icon="content-copy"
              disabled={!result?.ed2kLink}
              onClick={() => copy(result?.ed2kLink)}
            >
              {t('ed2k.copyLink')}
            </MduiButton>
            <MduiButton variant="text" icon="close" onClick={onClose}>
              {t('Close')}
            </MduiButton>
          </>
        }
      >
        {result === null ? null : (
          <div className="ed2k-detail__body">
            <p className="ed2k-detail__note">{t('ed2k.detail.addUriNote')}</p>

            <div className="ed2k-detail__summary">
              <span className="ed2k-detail__summary-icon">
                <MduiIcon name={categoryIcon(result.category)} size="2rem" />
              </span>
              <span className="ed2k-detail__summary-name ariang-truncate" title={result.filename}>
                {result.filename}
              </span>
            </div>

            <dl className="ed2k-detail__grid">
              <div className="ed2k-detail__pair">
                <dt>{t('ed2k.detail.category')}</dt>
                <dd>{category}</dd>
              </div>
              <div className="ed2k-detail__pair">
                <dt>{t('ed2k.detail.sources')}</dt>
                <dd>{result.sourceCount}</dd>
              </div>
            </dl>

            <DetailField
              label={t('ed2k.detail.filename')}
              value={result.filename}
              fieldKey="filename"
              onCopy={copy}
            />
            <DetailField
              label={t('ed2k.detail.fileLength')}
              value={formatFileLength(result.fileLength)}
              fieldKey="fileLength"
              onCopy={copy}
            />
            <DetailField
              label={t('ed2k.detail.fileHash')}
              value={result.fileHash}
              fieldKey="fileHash"
              monospace
              onCopy={copy}
            />
            <DetailField
              label={t('ed2k.detail.sourceNetwork')}
              value={result.sourceNetwork}
              fieldKey="sourceNetwork"
              onCopy={copy}
            />
            <DetailField
              label={t('ed2k.detail.mediaCodec')}
              value={result.mediaCodec}
              fieldKey="mediaCodec"
              onCopy={copy}
            />
            <DetailField
              label={t('ed2k.detail.ed2kLink')}
              value={result.ed2kLink}
              fieldKey="ed2kLink"
              monospace
              onCopy={copy}
            />

            {result.isDownloadable ? null : (
              <p className="ed2k-detail__warning" role="status">
                {t('ed2k.notDownloadable')}
              </p>
            )}
          </div>
        )}
      </MduiDialog>

      <MduiSnackbar
        open={notice !== null}
        message={notice?.message ?? ''}
        // A failed copy is not an error in the app's own sense — but it *is* the
        // one case where the user asked for something and did not get it, so
        // the notice is kept open until dismissed.
        timeout={notice?.ok ? 3000 : 0}
        closeable
        onClosed={() => setNotice(null)}
      />
    </>
  );
}

interface DetailFieldProps {
  label: string;
  /** `undefined` renders the em-dash placeholder and hides the copy button. */
  value: string | undefined;
  /** Test id suffix, matching the field's own name in the RPC contract. */
  fieldKey: string;
  monospace?: boolean;
  onCopy: (value: string | undefined) => void;
}

function DetailField({ label, value, fieldKey, monospace = false, onCopy }: DetailFieldProps) {
  const t = useLocalTranslate();
  const present = value !== undefined && value !== '';

  return (
    <div className="ed2k-detail__field">
      <div className="ed2k-detail__field-head">
        <span className="ed2k-detail__label">{label}</span>
        {present ? (
          <MduiButton
            variant="text"
            icon="content-copy"
            className="ed2k-detail__copy"
            aria-label={t('ed2k.detail.copyField', { field: label })}
            onClick={() => onCopy(value)}
          >
            {t('Copy')}
          </MduiButton>
        ) : null}
      </div>

      <div
        className={monospace ? 'ed2k-detail__value ed2k-detail__value--mono' : 'ed2k-detail__value'}
        data-testid={`ed2k-detail-${fieldKey}`}
      >
        {present ? value : t('ed2k.detail.unknown')}
      </div>
    </div>
  );
}

export default ResultDetailDialog;
