/**
 * The file/directory row list of the Files tab.
 *
 * Port of `views/task-detail.html` lines 250-289 (`ng-repeat="file in task.files
 * | fileOrderBy: …"`), including AriaNg's two different indentation rules:
 *
 * - a **directory** row is indented by `level * 16px`;
 * - a **file** row is indented by `11 + 6 + level * 16px`.
 *
 * The extra `11px` is the width of the expand/collapse caret the directory rows
 * carry (16px cell + 1px gap - …), so files line up under their directory's
 * text instead of under its caret. Both paddings apply **only** in multi-directory
 * mode — AriaNg emitted an empty `style` attribute otherwise, because a flat file
 * list has no depth to show.
 *
 * Directory rows are tri-state: the checkbox is on when every descendant is
 * selected (`selected`), indeterminate when only some are
 * (`partialSelected`), and the caret reflects `collapsedDirs[nodePath]`.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';

import { formatPercent, readableVolume } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import { MduiCheckbox, MduiIcon, MduiProgressBar } from '@/ui/mdui';
import type { DirectoryNode, FileNode, FileTreeNode } from '@/domain/types';

/** `11 + 6` — AriaNg's file-row indent constant. */
export const FILE_INDENT_BASE = 17;
/** One directory level. */
export const LEVEL_INDENT = 16;

export interface FileTreeProps {
  /** Rows to render, already filtered (collapsed parents) and sorted. */
  nodes: readonly FileTreeNode[];
  /** True when `nodes` is the flattened directory tree. */
  multiDir: boolean;
  /** `nodePath -> collapsed`. */
  collapsedDirs: Readonly<Record<string, boolean>>;
  /** aria2 only accepts `select-file` on a waiting / paused multi-file task. */
  checkboxesDisabled: boolean;
  onToggleDir: (node: DirectoryNode) => void;
  onToggleFile: (node: FileNode) => void;
  onToggleDirectorySelection: (node: DirectoryNode) => void;
  /** AriaNg bound `#task-filelist-contextmenu` to every row. */
  onRowContextMenu?: (event: ReactMouseEvent) => void;
}

export function FileTree({
  nodes,
  multiDir,
  collapsedDirs,
  checkboxesDisabled,
  onToggleDir,
  onToggleFile,
  onToggleDirectorySelection,
  onRowContextMenu,
}: FileTreeProps) {
  const t = useTranslate();

  return (
    <div role="rowgroup" data-multi-dir={multiDir ? 'true' : 'false'}>
      {nodes.map((node) => {
        const level = node.level ?? 0;

        if (node.isDir) {
          const collapsed = collapsedDirs[node.nodePath] === true;

          return (
            <div
              key={`dir:${node.nodePath}`}
              className="ariang-task-table-row"
              role="row"
              data-node-kind="dir"
              data-node-path={node.nodePath}
              onContextMenu={onRowContextMenu}
            >
              <div
                className="ariang-cell-name"
                role="cell"
                style={multiDir ? { paddingInlineStart: `${level * LEVEL_INDENT}px` } : undefined}
              >
                <button
                  type="button"
                  className="ariang-dir-toggle"
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? t('Expand') : t('Collapse')}
                  title={collapsed ? t('Expand') : t('Collapse')}
                  onClick={() => onToggleDir(node)}
                >
                  <MduiIcon name={collapsed ? 'expand-more' : 'expand-less'} size="1.25rem" />
                </button>

                <MduiCheckbox
                  checked={node.selected}
                  indeterminate={node.partialSelected}
                  disabled={checkboxesDisabled}
                  onChange={() => onToggleDirectorySelection(node)}
                  label={<span className="ariang-file-name" title={node.nodeName}>{node.nodeName}</span>}
                />
              </div>

              <div className="ariang-cell-size" role="cell">
                {readableVolume(node.length)}
              </div>
            </div>
          );
        }

        return (
          <div
            key={`file:${node.index}`}
            className="ariang-task-table-row"
            role="row"
            data-node-kind="file"
            data-file-index={node.index}
            data-aria2-index={node.aria2Index}
            onContextMenu={onRowContextMenu}
          >
            <div
              className="ariang-cell-name"
              role="cell"
              style={multiDir ? { paddingInlineStart: `${FILE_INDENT_BASE + level * LEVEL_INDENT}px` } : undefined}
            >
              <MduiCheckbox
                checked={node.selected}
                disabled={checkboxesDisabled}
                onChange={() => onToggleFile(node)}
                label={<span className="ariang-file-name" title={node.fileName}>{node.fileName}</span>}
              />
            </div>

            <div className="ariang-cell-progress" role="cell">
              <MduiProgressBar
                value={node.completePercent}
                height={6}
                label={`${node.fileName} ${formatPercent(node.completePercent, 0)}%`}
              />
              <span className="ariang-mono">{formatPercent(node.completePercent, 2)}%</span>
            </div>

            <div className="ariang-cell-size" role="cell">
              {readableVolume(node.length)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default FileTree;