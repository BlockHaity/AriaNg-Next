/**
 * The "Choose Files" toolbar of the Files tab.
 *
 * Port of `views/task-detail.html` lines 202-249 plus the controller helpers it
 * drives (`showChooseFilesToolbar`, `selectFiles`, `chooseSpecifiedFiles`,
 * `saveChoosedFiles`, `cancelChooseFiles` — `task-detail.js:331-461`).
 *
 * Layout, 1:1:
 *
 * ```
 * [Select All ▾] [Videos] [Audios] [Pictures] [Documents] [Applications]
 * [Archives] [Custom] [Confirm] [Cancel]
 * ```
 *
 * The split control is Bootstrap's `btn-group` + `dropdown-toggle`: the main
 * button toggles All/None (`selectFiles('auto')` — AriaNg picked the direction
 * from the current state) and the caret opens the explicit
 * All / None / **Invert** entries. AriaNg also put `Invert` where this
 * re-implementation names it `Select Invert`, which is the key the shipped
 * translations use.
 *
 * The category buttons reproduce `chooseSpecifiedFiles(type)` exactly: the
 * files of that category are selected when *not all* of them are selected, and
 * cleared when they are — a third press restores them. The category is resolved
 * through `classifyExtension`, not through a hand-kept table.
 *
 * While the toolbar is open the Files tab holds the detail poll (AriaNg's
 * `pauseDownloadTaskRefresh`) and the selection is only pushed to aria2 on
 * **Confirm**.
 */

import { MduiButton, MduiDropdown, MduiMenu, MduiMenuItem } from '@/ui/mdui';
import { useTranslate } from '@/i18n/react';
import type { FileTypeCategory } from '@/config/file-types';
import type { SelectionMode } from '@/domain/selection';

/** The category buttons, in `FILE_TYPES` declaration order. */
export const CATEGORY_BUTTONS: readonly { category: FileTypeCategory; labelKey: string; icon: string }[] = [
  { category: 'video', labelKey: 'Videos', icon: 'movie' },
  { category: 'audio', labelKey: 'Audios', icon: 'music-note' },
  { category: 'picture', labelKey: 'Pictures', icon: 'image' },
  { category: 'document', labelKey: 'Documents', icon: 'insert-drive-file' },
  { category: 'application', labelKey: 'Applications', icon: 'archive' },
  { category: 'archive', labelKey: 'Archives', icon: 'folder' },
];

export interface ChooseFilesToolbarProps {
  /** true when *every* file is selected — flips the main button to "Select None". */
  allSelected: boolean;
  /** Confirm is disabled while nothing is selected. */
  hasSelection: boolean;
  /** Categories the task actually contains files for; empty ones are not shown. */
  availableCategories: readonly FileTypeCategory[];
  onSelectMode: (mode: SelectionMode) => void;
  onChooseCategory: (category: FileTypeCategory) => void;
  onOpenCustomDialog: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ChooseFilesToolbar({
  allSelected,
  hasSelection,
  availableCategories,
  onSelectMode,
  onChooseCategory,
  onOpenCustomDialog,
  onConfirm,
  onCancel,
}: ChooseFilesToolbarProps) {
  const t = useTranslate();
  const toggleLabel = allSelected ? t('Select None') : t('Select All');

  return (
    <div className="ariang-choose-files-bar" role="toolbar" aria-label={t('(Choose Files)')}>
      <div className="ariang-split-button">
        <MduiButton variant="filled" onClick={() => onSelectMode(allSelected ? 'none' : 'all')}>
          {toggleLabel}
        </MduiButton>

        <MduiDropdown
          aria-label={toggleLabel}
          trigger={
            <MduiButton variant="filled" icon="expand-more" aria-label={t('Select Invert')} />
          }
          items={[
            <MduiMenu key="menu">
              <MduiMenuItem onClick={() => onSelectMode('all')}>{t('Select All')}</MduiMenuItem>
              <MduiMenuItem onClick={() => onSelectMode('none')}>{t('Select None')}</MduiMenuItem>
              <MduiMenuItem onClick={() => onSelectMode('invert')}>{t('Select Invert')}</MduiMenuItem>
            </MduiMenu>,
          ]}
        />
      </div>

      {CATEGORY_BUTTONS.filter((entry) => availableCategories.includes(entry.category)).map((entry) => (
        <MduiButton key={entry.category} variant="tonal" icon={entry.icon} onClick={() => onChooseCategory(entry.category)}>
          {t(entry.labelKey)}
        </MduiButton>
      ))}

      <MduiButton variant="tonal" icon="filter-list" onClick={onOpenCustomDialog}>
        {t('Custom')}
      </MduiButton>

      <MduiButton variant="filled" disabled={!hasSelection} onClick={onConfirm}>
        {t('Confirm')}
      </MduiButton>

      <MduiButton variant="text" onClick={onCancel}>
        {t('Cancel')}
      </MduiButton>
    </div>
  );
}

export default ChooseFilesToolbar;