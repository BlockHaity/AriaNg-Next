/**
 * The "Custom Choose File" dialog.
 *
 * Port of `showCustomChooseFileModal()` / `setSelectedExtension()`
 * (`task-detail.js:463-594`) and `#custom-choose-file-modal`
 * (`views/task-detail.html:488-515`).
 *
 * AriaNg walked the task's files once, counted selected/unselected per distinct
 * extension, copied each extension into its category's list and dumped the
 * leftovers into an "UnClassified" bucket. `buildExtensionBuckets` performs
 * exactly that grouping, so this component is only the rendering: one row per
 * non-empty category, one tri-state checkbox per extension.
 *
 * Two behavioural details are load-bearing:
 *
 * - AriaNg's checkbox is `ng-model="info.selected"` with
 *   `ng-indeterminate="info.selectedCount > 0 && info.unSelectedCount > 0"`, i.e.
 *   *partially selected* → indeterminate, not "off".
 * - The modal footer has **only a Close button**: toggling an extension applies
 *   immediately through `setSelectedFile` (and, while the choose-files toolbar is
 *   open, only to the local selection that Confirm pushes). There is no OK.
 */

import { FILE_TYPES, OTHER_FILE_TYPE, buildExtensionBuckets } from '@/config/file-types';
import type { FileTypeCategory } from '@/config/file-types';
import type { FileTypeInfo } from '@/domain/types';
import { useTranslate } from '@/i18n/react';
import { MduiButton, MduiCheckbox, MduiDialog } from '@/ui/mdui';

export interface CustomChooseFileDialogProps {
  open: boolean;
  /** Every real file of the task (directory rows must be excluded). */
  files: readonly FileTypeInfo[];
  /** Called with (extensions, selected) for one checkbox. */
  onToggleExtension: (extensions: readonly string[], selected: boolean) => void;
  onClose: () => void;
}

/** Category label, 1:1 with AriaNg's `extensionTypeInfo.name`. */
function categoryLabelKey(category: FileTypeCategory): string {
  if (category === OTHER_FILE_TYPE.category) return OTHER_FILE_TYPE.nameKey;
  return FILE_TYPES.find((entry) => entry.category === category)?.nameKey ?? OTHER_FILE_TYPE.nameKey;
}

export function CustomChooseFileDialog({ open, files, onToggleExtension, onClose }: CustomChooseFileDialogProps) {
  const t = useTranslate();

  // AriaNg's `buildExtensionBuckets` only emits categories that hold at least
  // one file, and `other` always sorts last.
  const buckets = buildExtensionBuckets(files);

  return (
    <MduiDialog
      open={open}
      headline={t('Custom Choose File')}
      onClosed={onClose}
      actions={<MduiButton variant="text" onClick={onClose}>{t('Close')}</MduiButton>}
    >
      <div className="ariang-settings-table" role="table" aria-label={t('Custom Choose File')}>
        <div role="rowgroup">
          {[...buckets.entries()].map(([category, bucket]) => (
            <div key={category} className="ariang-settings-row" role="row" data-category={category}>
                <div className="ariang-setting-key" role="columnheader">
                  {t(categoryLabelKey(category))}
                </div>
                <div className="ariang-setting-value" role="cell">
                  {bucket.extensions.map((extension) => {
                    // `buildExtensionBuckets` only carries the per-category totals,
                    // so the per-extension tri-state AriaNg showed is derived from
                    // the files themselves: on when every match is selected,
                    // indeterminate when only some are.
                    const matches = files.filter((file) => effectiveExtension(file) === extension);
                    const selectedCount = matches.filter((file) => file.selected).length;
                    const checked = matches.length > 0 && selectedCount === matches.length;
                    const indeterminate = selectedCount > 0 && selectedCount < matches.length;

                    return (
                      <MduiCheckbox
                        key={extension || '(none)'}
                        checked={checked}
                        indeterminate={indeterminate}
                        onChange={(selected) => onToggleExtension([extension], selected)}
                        label={<span className="ariang-mono">{extension}</span>}
                      />
                    );
                  })}
                </div>
              </div>
          ))}
        </div>
      </div>
    </MduiDialog>
  );
}

/** Lower-cased, dot-less extension — same normalisation as `domain/selection`. */
function effectiveExtension(file: FileTypeInfo): string {
  const declared = typeof file.extension === 'string' ? file.extension : '';
  if (declared.trim().length > 0) {
    return declared.trim().replace(/^\.+/, '').toLowerCase();
  }

  const name = file.fileName ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export default CustomChooseFileDialog;