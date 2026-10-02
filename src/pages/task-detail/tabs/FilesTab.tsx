/**
 * Files tab.
 *
 * Port of `views/task-detail.html` lines 180-287 (the file table, the
 * `(Choose Files)` link, the choose-files toolbar and the row context menu)
 * plus every controller helper it drives:
 *
 * - `changeFileListDisplayOrder` / `getFileListOrderType` — sorting is a no-op
 *   for a multi-directory task, AriaNg returned early;
 * - `collapseDir` / `collapseAllDirs` — recursive expand / collapse;
 * - `selectFiles` / `chooseSpecifiedFiles` / `setSelectedExtension`
 *   / `setSelectedFile` — the selection model;
 * - `saveChoosedFiles` / `cancelChooseFiles` — the toolbar's commit / discard;
 * - `setSelectFiles` — the `aria2.selectFile` round trip.
 *
 * ## Sorting is disabled for a multi-directory torrent
 *
 * AriaNg's rule (`changeFileListDisplayOrder`:
 * `if ($scope.task && $scope.task.multiDir) return;`) exists because the
 * flattened tree is an ordered walk, not a set: sorting it would scatter
 * directories away from their children. The context menu swaps the
 * *Display Order* submenu for *Expand All* / *Collapse All* in exactly that case.
 *
 * ## Where the selection lives
 *
 * `NormalizedTask` is immutable, so the working selection is a **copy** of the
 * row list held in component state. Bulk edits go through `domain/selection`
 * (`applySelectionMode`, `setExtensionSelection`, `selectedAria2Indexes`,
 * `isSelectionEmpty`, `selectionSummary`); a single checkbox goes through the
 * local {@link withIndexesSelection}, which rewrites the requested files and
 * re-rolls every directory the way AriaNg's `updateAllDirNodesSelectedStatus`
 * did — without ever writing into the task object.
 *
 * AriaNg's `setSelectedFile` pushes to aria2 immediately **unless** the
 * choose-files toolbar is open, in which case only Confirm commits. Reproduced
 * verbatim below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { naturalCompare } from '@/config/defaults';
import { FILE_TYPES, OTHER_FILE_TYPE, classifyExtension } from '@/config/file-types';
import type { FileTypeCategory } from '@/config/file-types';
import type { FileOrderBy, FileOrderType } from '@/config/types';
import { collectLeafFiles } from '@/domain/selection';
import type { SelectionMode } from '@/domain/selection';
import {
  applySelectionMode,
  isSelectionEmpty,
  selectedAria2Indexes,
  selectionSummary,
  setExtensionSelection,
} from '@/domain/selection';
import type { DirectoryNode, FileNode, FileTreeNode, FileTypeInfo, NormalizedTask } from '@/domain/types';
import { useTranslate } from '@/i18n/react';
import { selectTaskFiles } from '@/store/commands';
import { useSettingsStore } from '@/store/settings';
import { MduiIcon } from '@/ui/mdui';
import { ChooseFilesToolbar } from '../ChooseFilesToolbar';
import { CustomChooseFileDialog } from '../CustomChooseFileDialog';
import { FileTree } from '../FileTree';

/* ------------------------------------------------------------------ */
/* polling latch                                                      */
/* ------------------------------------------------------------------ */

/**
 * Whether the Files tab currently owns an unfinished multi-file selection.
 *
 * AriaNg's `pauseDownloadTaskRefresh` was a controller-local boolean the
 * interval checked before every tick. It has to be readable from *outside* the
 * component (the detail page owns the poll), so it is a tiny module-level store
 * here rather than React state: the page's tick reads it without re-subscribing.
 */
let fileSelectionActive = false;
const fileSelectionListeners = new Set<() => void>();

/** true while the choose-files toolbar is open (polling must stand down). */
export function isFileSelectionActive(): boolean {
  return fileSelectionActive;
}

export function subscribeFileSelection(listener: () => void): () => void {
  fileSelectionListeners.add(listener);
  return () => {
    fileSelectionListeners.delete(listener);
  };
}

export function setFileSelectionActive(active: boolean): void {
  if (fileSelectionActive === active) return;
  fileSelectionActive = active;
  for (const listener of [...fileSelectionListeners]) listener();
}

/** Test helper: clears the latch (and any subscriber). */
export function resetFileSelection(): void {
  fileSelectionActive = false;
  fileSelectionListeners.clear();
}

/* ------------------------------------------------------------------ */
/* ordering                                                           */
/* ------------------------------------------------------------------ */

/** The sort types the header links and the Display Order submenu offer. */
export const FILE_ORDER_TYPES: readonly FileOrderType[] = ['default', 'name', 'percent', 'size', 'selected'];

/** Label of each Display Order entry (AriaNg's context-menu wording). */
export const DISPLAY_ORDER_LABELS: Record<FileOrderType, string> = {
  default: 'Default',
  index: 'Default',
  name: 'By File Name',
  percent: 'By Progress',
  size: 'By File Size',
  selected: 'By Selected Status',
};

/** The concrete order each context-menu entry applies. */
export function contextMenuOrder(type: FileOrderType): FileOrderBy {
  switch (type) {
    case 'name':
      return 'name:asc';
    case 'percent':
      return 'percent:desc';
    case 'size':
      return 'size:asc';
    case 'selected':
      return 'selected:desc';
    case 'default':
    case 'index':
    default:
      return 'default:asc';
  }
}

/** AriaNg's `parseOrderType`. */
export interface ParsedOrder {
  type: FileOrderType;
  desc: boolean;
}

export function parseFileOrder(value: string | undefined): ParsedOrder {
  const raw = (value ?? '').trim();
  const separator = raw.lastIndexOf(':');
  const head = separator >= 0 ? raw.slice(0, separator) : raw;
  const tail = separator >= 0 ? raw.slice(separator + 1) : 'asc';
  const type = (FILE_ORDER_TYPES as readonly string[]).includes(head) ? (head as FileOrderType) : 'default';

  return { type, desc: tail === 'desc' };
}

/** AriaNg's `equals` with a direction: type **and** order must match. */
export function matchesExactOrder(current: string | undefined, value: FileOrderBy): boolean {
  const a = parseFileOrder(current);
  const b = parseFileOrder(value);
  return a.type === b.type && a.desc === b.desc;
}

/** AriaNg's `equals` without a direction (the context-menu tick). */
export function matchesOrderType(current: string | undefined, value: FileOrderBy): boolean {
  return parseFileOrder(current).type === parseFileOrder(value).type;
}

function compareNodes(a: FileTreeNode, b: FileTreeNode, type: FileOrderType): number {
  switch (type) {
    case 'name':
      return naturalCompare(a.isDir ? a.nodeName : a.fileName, b.isDir ? b.nodeName : b.fileName);
    case 'size':
      return a.length - b.length;
    case 'percent':
      return a.completePercent - b.completePercent;
    case 'selected':
      return (a.selected ? 1 : 0) - (b.selected ? 1 : 0);
    case 'index':
      return a.index - b.index;
    case 'default':
    default:
      return 0;
  }
}

/** Stable sort: ties keep the incoming order (the server order / tree walk). */
export function sortFileNodes(nodes: readonly FileTreeNode[], order: string | undefined): FileTreeNode[] {
  const { type, desc } = parseFileOrder(order);
  if (type === 'default') return [...nodes];

  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const result = compareNodes(a.node, b.node, type);
      if (result !== 0) return desc ? -result : result;
      return a.index - b.index;
    })
    .map((entry) => entry.node);
}

/* ------------------------------------------------------------------ */
/* node helpers                                                       */
/* ------------------------------------------------------------------ */

/** `FileTypeInfo[]` → row nodes, so `domain/selection` can be reused verbatim. */
export function toFileNodes(files: readonly FileTypeInfo[]): FileNode[] {
  return files.map((file) => ({ ...file, isDir: false as const }));
}

/** The row list a task renders: the flattened tree for a multi-dir torrent. */
export function rowsOfTask(task: Pick<NormalizedTask, 'multiDir' | 'files' | 'fileTree'> | undefined): FileTreeNode[] {
  if (!task) return [];
  return task.multiDir ? task.fileTree : toFileNodes(task.files);
}

/** Lower-cased, dot-less extension; `''` for extension-less files. */
export function extensionOf(file: FileTypeInfo): string {
  const declared = typeof file.extension === 'string' ? file.extension : '';
  if (declared.trim().length > 0) {
    return declared.trim().replace(/^\.+/, '').toLowerCase();
  }
  const name = file.fileName ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The distinct extensions present in `files` that belong to `category`.
 *
 * AriaNg compared each file's extension against
 * `ariaNgFileTypes[type].extensions`; going through `classifyExtension` instead
 * means the button and the table can never disagree, and the empty string
 * (extension-less files) resolves to the `other` bucket.
 */
export function extensionsForCategory(
  files: readonly FileTypeInfo[],
  category: FileTypeCategory,
): string[] {
  const found = new Set<string>();

  for (const file of files) {
    if (classifyExtension(extensionOf(file)) === category) {
      found.add(extensionOf(file));
    }
  }

  return [...found];
}

/** aria2 indexes of every file below `directory`, depth first. */
export function indexesUnderDirectory(directory: DirectoryNode): Set<number> {
  const indexes = new Set<number>();

  const walk = (node: DirectoryNode): void => {
    for (const file of node.children) indexes.add(file.aria2Index);
    for (const subDir of node.subDirs) walk(subDir);
  };

  walk(directory);
  return indexes;
}

/**
 * Sets the listed files and re-rolls every directory — AriaNg's
 * `setSelectedNode` / `setSelectedFile(true)` + `updateAllDirNodesSelectedStatus`
 * (task-detail.js:187-252, 600-608), done immutably.
 *
 * Subtrees that contain none of `indexes` are returned by reference, so React
 * can skip re-rendering them.
 */
export function withIndexesSelection(
  nodes: readonly FileTreeNode[],
  indexes: ReadonlySet<number>,
  selected: boolean,
): FileTreeNode[] {
  if (indexes.size === 0) return [...nodes];

  const rewriteDirectory = (directory: DirectoryNode): DirectoryNode => {
    let childrenChanged = false;
    const children = directory.children.map((file) => {
      if (!indexes.has(file.aria2Index) || file.selected === selected) return file;
      childrenChanged = true;
      return { ...file, selected };
    });

    let subDirsChanged = false;
    const subDirs = directory.subDirs.map((subDir) => {
      const next = rewriteDirectory(subDir);
      if (next !== subDir) subDirsChanged = true;
      return next;
    });

    if (!childrenChanged && !subDirsChanged) return directory;

    // AriaNg's `updateDirNodeSelectedStatus`, counting children + subdirectories.
    let selectedCount = 0;
    let partialCount = 0;
    for (const file of children) selectedCount += file.selected ? 1 : 0;
    for (const subDir of subDirs) {
      selectedCount += subDir.selected ? 1 : 0;
      partialCount += subDir.partialSelected ? 1 : 0;
    }

    const childCount = children.length + subDirs.length;
    const isSelected = childCount > 0 && selectedCount === childCount;

    return {
      ...directory,
      children,
      subDirs,
      selected: isSelected,
      allSelected: isSelected,
      partialSelected: (selectedCount > 0 && selectedCount < childCount) || partialCount > 0,
    };
  };

  return nodes.map((node) => {
    if (node.isDir) return rewriteDirectory(node);
    if (indexes.has(node.aria2Index) && node.selected !== selected) return { ...node, selected };
    return node;
  });
}

/** `'x'` per row so an incoming poll can be compared with the previous answer. */
function selectionSignature(nodes: readonly FileTreeNode[]): string {
  let signature = '';
  for (const node of nodes) {
    signature += node.selected ? '1' : '0';
    if (node.isDir) signature += node.partialSelected ? 'p' : '-';
  }
  return signature;
}

/** Recursive collapse/expand, mirroring AriaNg's `collapseDir(dir, value)`. */
function setDirCollapsedIn(
  target: Record<string, boolean>,
  directory: DirectoryNode,
  collapsed: boolean,
): void {
  // The torrent root ('') is not addressable, exactly like AriaNg's guard.
  if (directory.nodePath) target[directory.nodePath] = collapsed;
  for (const subDir of directory.subDirs) setDirCollapsedIn(target, subDir, collapsed);
}

/* ------------------------------------------------------------------ */
/* component                                                          */
/* ------------------------------------------------------------------ */

export interface FilesTabProps {
  task: NormalizedTask | undefined;
  /**
   * Optional explicit notification, in addition to {@link isFileSelectionActive},
   * so the owning page can wire the pause into whatever it prefers.
   */
  onPollingPauseChange?: (paused: boolean) => void;
  /** Called after Confirm / Cancel so the page can resume polling and re-read. */
  onRequestRefresh?: () => void;
}

export function FilesTab({ task, onPollingPauseChange, onRequestRefresh }: FilesTabProps) {
  const t = useTranslate();
  const order = useSettingsStore((state) => state.settings.fileListDisplayOrder);
  const setSetting = useSettingsStore((state) => state.set);

  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const taskRows = useMemo(() => rowsOfTask(task), [task]);
  const multiDir = task?.multiDir === true;

  /** The working selection: a copy, never the task object. */
  const [nodes, setNodes] = useState<FileTreeNode[]>(taskRows);
  const lastIncomingSignature = useRef<string | null>(null);

  const incomingSignature = useMemo(() => selectionSignature(taskRows), [taskRows]);

  // Adopt aria2's answer only when it differs from the last answer we *saw*.
  // Otherwise our own optimistic edit would be undone by the next poll, before
  // aria2 had a chance to answer it.
  useEffect(() => {
    if (toolbarOpen) return;
    if (lastIncomingSignature.current === incomingSignature) return;
    lastIncomingSignature.current = incomingSignature;
    setNodes(taskRows);
  }, [incomingSignature, taskRows, toolbarOpen]);

  const setToolbar = useCallback(
    (open: boolean) => {
      setToolbarOpen(open);
      setFileSelectionActive(open);
      onPollingPauseChange?.(open);
    },
    [onPollingPauseChange],
  );

  useEffect(
    () => () => {
      // Never leave the latch set when the tab unmounts.
      setFileSelectionActive(false);
    },
    [],
  );

  const leafFiles = useMemo(() => collectLeafFiles(nodes), [nodes]);
  const summary = useMemo(() => selectionSummary(nodes), [nodes]);
  const nothingSelected = useMemo(() => isSelectionEmpty(nodes), [nodes]);

  // AriaNg's disabled predicate, verbatim: `!task || !task.files ||
  // task.files.length <= 1 || (status !== 'waiting' && status !== 'paused')`.
  const checkboxesDisabled =
    !task || !task.files || task.files.length <= 1 || (task.status !== 'waiting' && task.status !== 'paused');

  const canChooseFiles =
    !!task && task.files.length > 1 && (task.status === 'waiting' || task.status === 'paused');

  /* ---------------------------------------------------------------- */
  /* selection actions                                                 */
  /* ---------------------------------------------------------------- */

  const pushSelection = useCallback(
    (next: FileTreeNode[]) => {
      if (!task) return;
      void selectTaskFiles(task.gid, selectedAria2Indexes(next));
    },
    [task],
  );

  /** Apply a change and, unless the toolbar owns it, push it straight away. */
  const commitSelection = useCallback(
    (next: FileTreeNode[]) => {
      setNodes(next);
      if (!toolbarOpen) pushSelection(next);
    },
    [toolbarOpen, pushSelection],
  );

  const onSelectMode = useCallback(
    (mode: SelectionMode) => commitSelection(applySelectionMode(nodes, mode)),
    [nodes, commitSelection],
  );

  const onChooseCategory = useCallback(
    (category: FileTypeCategory) => {
      // AriaNg's `chooseSpecifiedFiles`: select the category unless *every* one
      // of its files is already selected, in which case clear them. A third
      // press restores the selection.
      const extensions = extensionsForCategory(leafFiles, category);
      if (extensions.length === 0) return;

      const allSelected = extensions.every((extension) =>
        leafFiles.every((file) => extensionOf(file) !== extension || file.selected),
      );

      commitSelection(setExtensionSelection(nodes, extensions, !allSelected));
    },
    [nodes, leafFiles, commitSelection],
  );

  const onToggleExtension = useCallback(
    (extensions: readonly string[], selected: boolean) => {
      const next = setExtensionSelection(nodes, extensions, selected);
      setNodes(next);
      // The dialog applies immediately, like AriaNg's
      // `setSelectedExtension` -> `setSelectedFile(false)`.
      if (!toolbarOpen) pushSelection(next);
    },
    [nodes, toolbarOpen, pushSelection],
  );

  const onToggleFile = useCallback(
    (node: FileNode) => {
      commitSelection(withIndexesSelection(nodes, new Set([node.aria2Index]), !node.selected));
    },
    [nodes, commitSelection],
  );

  const onToggleDirectorySelection = useCallback(
    (node: DirectoryNode) => {
      commitSelection(withIndexesSelection(nodes, indexesUnderDirectory(node), !node.selected));
    },
    [nodes, commitSelection],
  );

  /* ---------------------------------------------------------------- */
  /* expand / collapse                                                 */
  /* ---------------------------------------------------------------- */

  const onToggleDir = useCallback(
    (node: DirectoryNode) => {
      setCollapsedDirs((current) => {
        const next = { ...current };
        setDirCollapsedIn(next, node, !current[node.nodePath]);
        return next;
      });
    },
    [],
  );

  const collapseAll = useCallback(
    (collapsed: boolean) => {
      setCollapsedDirs(() => {
        const next: Record<string, boolean> = {};
        for (const node of nodes) {
          if (node.isDir) setDirCollapsedIn(next, node, collapsed);
        }
        return next;
      });
    },
    [nodes],
  );

  /* ---------------------------------------------------------------- */
  /* ordering                                                          */
  /* ---------------------------------------------------------------- */

  const changeDisplayOrder = useCallback(
    (next: FileOrderBy, autoSetReverse: boolean) => {
      // AriaNg bails out for a multi-directory task: the flattened tree is an
      // ordered walk, and sorting it would detach children from their parents.
      if (multiDir) return;

      const previous = parseFileOrder(order);
      const target = parseFileOrder(next);
      // `autoSetReverse` is the header-link behaviour: clicking the column that
      // is already sorted flips the direction (AriaNg's `autoSetReverse`).
      const resolved =
        autoSetReverse && previous.type === target.type ? { ...target, desc: !previous.desc } : target;

      setSetting('fileListDisplayOrder', `${resolved.type}:${resolved.desc ? 'desc' : 'asc'}` as FileOrderBy);
    },
    [multiDir, order, setSetting],
  );

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */
  /* ---------------------------------------------------------------- */

  const visibleRows = useMemo(() => {
    if (multiDir) {
      // AriaNg's `ng-if="!context.collapsedDirs[file.relativePath]"`: a row whose
      // parent directory is collapsed disappears, which works because the
      // flattened tree lists directories before their contents.
      return nodes.filter((node) => !collapsedDirs[node.relativePath ?? '']);
    }
    return sortFileNodes(nodes, order);
  }, [nodes, multiDir, collapsedDirs, order]);

  const availableCategories = useMemo(() => {
    const categories = new Set<FileTypeCategory>();
    for (const file of leafFiles) categories.add(classifyExtension(extensionOf(file)));
    // `other` has no dedicated button — the Custom dialog covers it.
    categories.delete(OTHER_FILE_TYPE.category);
    return FILE_TYPES.filter((entry) => categories.has(entry.category)).map((entry) => entry.category);
  }, [leafFiles]);

  const sortButton = (entry: { labelKey: string; order: FileOrderBy }, extra: ReactNode) => (
    <button
      type="button"
      className="ariang-sort-button"
      disabled={multiDir}
      aria-label={t(entry.labelKey)}
      onClick={() => changeDisplayOrder(entry.order, true)}
    >
      <span>{t(entry.labelKey)}</span>
      {!multiDir && matchesOrderType(order, entry.order) ? (
        <MduiIcon
          name={parseFileOrder(order).desc ? 'expand-less' : 'expand-more'}
          size="1rem"
          className="ariang-sort-indicator"
        />
      ) : null}
      {extra}
    </button>
  );

  const sortState = multiDir ? 'none' : 'other';

  return (
    <div className="ariang-task-detail">
      <div className="ariang-task-table" role="table" aria-label={t('Files')} data-multi-dir={multiDir ? 'true' : 'false'}>
        <div className="ariang-task-table-head" role="row">
          <div className="ariang-cell-name" role="columnheader" aria-sort={sortState}>
            {sortButton({ labelKey: 'File Name', order: 'name:asc' }, canChooseFiles ? (
              <button
                type="button"
                className="ariang-inline-link"
                aria-label={t('(Choose Files)')}
                onClick={() => setToolbar(!toolbarOpen)}
              >
                {t('(Choose Files)')}
              </button>
            ) : null)}
          </div>
          <div className="ariang-cell-progress" role="columnheader" aria-sort={sortState}>
            {sortButton({ labelKey: 'Progress', order: 'percent:desc' }, null)}
          </div>
          <div className="ariang-cell-size" role="columnheader" aria-sort={sortState}>
            {sortButton({ labelKey: 'File Size', order: 'size:asc' }, null)}
          </div>
        </div>

        {toolbarOpen ? (
          <ChooseFilesToolbar
            allSelected={summary.total > 0 && summary.selected === summary.total}
            hasSelection={!nothingSelected}
            availableCategories={availableCategories}
            onSelectMode={onSelectMode}
            onChooseCategory={onChooseCategory}
            onOpenCustomDialog={() => setCustomDialogOpen(true)}
            onConfirm={() => {
              if (task) void selectTaskFiles(task.gid, selectedAria2Indexes(nodes));
              setToolbar(false);
              onRequestRefresh?.();
            }}
            onCancel={() => {
              // AriaNg's `cancelChooseFiles`: drop the local edits and re-read.
              lastIncomingSignature.current = incomingSignature;
              setNodes(taskRows);
              setToolbar(false);
              onRequestRefresh?.();
            }}
          />
        ) : null}

        <FileTree
          nodes={visibleRows}
          multiDir={multiDir}
          collapsedDirs={collapsedDirs}
          checkboxesDisabled={checkboxesDisabled}
          onToggleDir={onToggleDir}
          onToggleFile={onToggleFile}
          onToggleDirectorySelection={onToggleDirectorySelection}
          onRowContextMenu={(event) => {
            // AriaNg bound the row context menu through
            // `data-toggle="context"` on every row.
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
        />
      </div>

      <CustomChooseFileDialog
        open={customDialogOpen}
        files={leafFiles}
        onToggleExtension={onToggleExtension}
        onClose={() => setCustomDialogOpen(false)}
      />

      {contextMenu ? (
        <div
          className="ariang-context-menu"
          role="menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          {multiDir ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="ariang-context-menu-item"
                onClick={() => {
                  collapseAll(false);
                  setContextMenu(null);
                }}
              >
                <span>{t('Expand All')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="ariang-context-menu-item"
                onClick={() => {
                  collapseAll(true);
                  setContextMenu(null);
                }}
              >
                <span>{t('Collapse All')}</span>
              </button>
            </>
          ) : (
            FILE_ORDER_TYPES.map((type) => {
              const orderValue = contextMenuOrder(type);
              return (
                <button
                  key={type}
                  type="button"
                  role="menuitemradio"
                  aria-checked={matchesOrderType(order, orderValue)}
                  className="ariang-context-menu-item"
                  onClick={() => {
                    changeDisplayOrder(orderValue, false);
                    setContextMenu(null);
                  }}
                >
                  <span>{t(DISPLAY_ORDER_LABELS[type])}</span>
                  {matchesOrderType(order, orderValue) ? (
                    <MduiIcon name="check" size="1rem" className="ariang-context-menu-check" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default FilesTab;