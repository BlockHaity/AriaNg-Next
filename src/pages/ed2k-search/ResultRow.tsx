/**
 * One row of the ED2K result table.
 *
 * mdui has no data-table component, so the table is a CSS grid built from MD3
 * tokens (see `styles.css`); this file owns a single grid row and nothing else.
 * It is `memo`ised because the result list is replaced wholesale on every poll —
 * without it, a streaming search would re-render every row each second and the
 * checkbox state would flicker.
 */

import { memo, useCallback, useRef } from 'react';

import type { Checkbox } from 'mdui/components/checkbox.js';

import { FILE_TYPES, OTHER_FILE_TYPE } from '@/config/file-types';
import type { FileTypeCategory } from '@/config/file-types';
import { MduiButton, MduiIcon, MduiIconButton, MduiTooltip } from '@/ui/mdui';
import { useMduiEvent, useMduiProperty } from '@/ui/mdui/use-mdui';
import { categoryIcon, formatFileLength } from './format';
import type { NormalizedEd2kResult } from './format';
import { useLocalTranslate } from './index';

export interface ResultRowProps {
  result: NormalizedEd2kResult;
  selected: boolean;
  onToggle: (result: NormalizedEd2kResult) => void;
  onDownload: (result: NormalizedEd2kResult) => void;
  onCopyLink: (result: NormalizedEd2kResult) => void;
  onDetails: (result: NormalizedEd2kResult) => void;
}

/**
 * The label of a file-type bucket.
 *
 * `FILE_TYPES` already carries AriaNg's own `nameKey` (`Videos`, `Audios`, …),
 * which is what the task-detail file picker renders, so the category reads the
 * same everywhere in the app.
 */
function categoryLabel(category: FileTypeCategory, t: (key: string) => string): string {
  const definition =
    FILE_TYPES.find((entry) => entry.category === category) ??
    (category === OTHER_FILE_TYPE.category ? OTHER_FILE_TYPE : undefined);

  return definition ? t(definition.nameKey) : t(OTHER_FILE_TYPE.nameKey);
}

export const ResultRow = memo(function ResultRow(props: ResultRowProps) {
  const { result, selected, onToggle, onDownload, onCopyLink, onDetails } = props;

  const t = useLocalTranslate();
  const checkboxRef = useRef<Checkbox>(null);

  // `checked` is a JS property on `<mdui-checkbox>`; the bridge keeps it in sync
  // when the parent replaces the row's selection.
  useMduiProperty(checkboxRef, { checked: selected });
  useMduiEvent(checkboxRef, 'change', () => {
    if ((checkboxRef.current?.checked === true) !== selected) {
      onToggle(result);
    }
  });

  const handleDownload = useCallback(() => onDownload(result), [onDownload, result]);
  const handleCopy = useCallback(() => onCopyLink(result), [onCopyLink, result]);
  const handleDetails = useCallback(() => onDetails(result), [onDetails, result]);

  const size = formatFileLength(result.fileLength);
  const category = categoryLabel(result.category, t);
  const multipleSources = result.sourceCount > 1;

  return (
    <div role="row" className="ed2k-row" data-key={result.key} data-testid="ed2k-result-row">
      <div role="gridcell" className="ed2k-row__cell ed2k-row__cell--select">
        <mdui-checkbox
          ref={checkboxRef}
          aria-label={result.filename}
          title={result.filename}
          data-testid="ed2k-result-checkbox"
        />
      </div>

      <div role="gridcell" className="ed2k-row__cell ed2k-row__cell--name">
        <span className="ed2k-row__icon" role="img" aria-label={category}>
          <MduiIcon name={categoryIcon(result.category)} size="1.25rem" />
        </span>

        <span className="ed2k-row__name ariang-truncate" title={result.filename}>
          {result.filename}
        </span>

        {multipleSources ? (
          <span
            className="ed2k-row__sources"
            data-testid="ed2k-source-count"
            title={t('ed2k.sources', { count: result.sourceCount })}
          >
            {result.sourceCount}
          </span>
        ) : null}
      </div>

      <div role="gridcell" className="ed2k-row__cell ed2k-row__cell--size">
        {size}
      </div>

      <div role="gridcell" className="ed2k-row__cell ed2k-row__cell--network">
        <span className="ariang-truncate" title={result.sourceNetwork ?? ''}>
          {result.sourceNetwork || '—'}
        </span>
      </div>

      <div role="gridcell" className="ed2k-row__cell ed2k-row__cell--codec">
        <span className="ariang-truncate" title={result.mediaCodec ?? ''}>
          {result.mediaCodec || '—'}
        </span>
      </div>

      <div role="gridcell" className="ed2k-row__cell ed2k-row__cell--actions">
        {/* A disabled control is announced as such but never *explained*, so the
            reason is carried by a tooltip (pointer) and by a visually hidden
            line (screen readers). */}
        <MduiTooltip content={t('ed2k.notDownloadable')} disabled={result.isDownloadable}>
          <MduiButton
            variant="filled"
            icon="download"
            disabled={!result.isDownloadable}
            onClick={handleDownload}
          >
            {t('ed2k.download')}
          </MduiButton>
        </MduiTooltip>

        {result.isDownloadable ? null : (
          <span className="ariang-visually-hidden">{t('ed2k.notDownloadable')}</span>
        )}

        <MduiIconButton
          icon="content-copy"
          label={t('ed2k.copyLink')}
          disabled={!result.isDownloadable}
          onClick={handleCopy}
        />

        <MduiIconButton icon="info" label={t('ed2k.details')} onClick={handleDetails} />
      </div>
    </div>
  );
});

export default ResultRow;
