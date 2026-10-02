/**
 * Selection maths for the "Choose Files" toolbar.
 *
 * Port of `src/scripts/controllers/task-detail.js`: `setSelectedNode` /
 * `updateDirNodeSelectedStatus` (lines 187-252), `selectFiles` (372-402),
 * `chooseSpecifiedFiles` (404-446) and `setSelectFiles` (160-185).
 *
 * Everything here is immutable: the incoming tree is treated as a frozen
 * snapshot and a brand new one is returned. Untouched subtrees are shared by
 * reference, so React can skip re-rendering whole directories.
 */

import { flattenFileTree } from '@/domain/filetree';
import type { DirectoryNode, FileNode, FileTreeNode, FileTypeInfo } from '@/domain/types';

export type SelectionMode = 'all' | 'none' | 'invert';

export interface SelectionSummary {
  selected: number;
  total: number;
  bytes: number;
  selectedBytes: number;
}

const ROOT_KEY = '';

interface FileDraft {
  /** Directory path this draft stands for; `''` is the torrent root. */
  key: string;
  /** The original row, or null for the implicit root / missing ancestors. */
  original: DirectoryNode | null;
  subDirs: FileDraft[];
  children: FileNode[];
}

interface FinalisedDraft {
  /** The rebuilt row, or null when this draft has no row of its own. */
  node: DirectoryNode | null;
  /** Descendant rows that lost their own parent while rebuilding. */
  looseDirs: DirectoryNode[];
  /** Files that belong to this draft. */
  files: FileNode[];
  changed: boolean;
}

function percentOf(length: number, completedLength: number): number {
  return length > 0 ? (completedLength / length) * 100 : 0;
}

/**
 * Every real file in the tree, in display order. Accepts the flattened node
 * list (the normal input) as well as a bare directory row, and de-duplicates
 * by identity so a file is never counted twice.
 */
export function collectLeafFiles(nodes: readonly FileTreeNode[]): FileTypeInfo[] {
  const files: FileTypeInfo[] = [];
  const seen = new Set<FileTreeNode>();

  const collectFrom = (directory: DirectoryNode): void => {
    for (const subDir of directory.subDirs) {
      if (seen.has(subDir)) {
        continue;
      }

      seen.add(subDir);
      collectFrom(subDir);
    }

    for (const file of directory.children) {
      if (seen.has(file)) {
        continue;
      }

      seen.add(file);
      files.push(file);
    }
  };

  for (const node of nodes) {
    if (seen.has(node)) {
      continue;
    }

    seen.add(node);

    if (node.isDir) {
      collectFrom(node);
    } else {
      files.push(node);
    }
  }

  return files;
}

function parentKeyOf(nodePath: string): string {
  const lastSeparatorIndex = nodePath.lastIndexOf('/');
  return lastSeparatorIndex > 0 ? nodePath.slice(0, lastSeparatorIndex) : ROOT_KEY;
}

function normalizeNodePath(value: string): string {
  return value
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0)
    .join('/');
}

/** Regroups a flattened row list back into a mutable tree. */
function buildDrafts(nodes: readonly FileTreeNode[]): FileDraft {
  const root: FileDraft = { key: ROOT_KEY, original: null, subDirs: [], children: [] };
  const drafts = new Map<string, FileDraft>([[ROOT_KEY, root]]);

  const ensure = (key: string): FileDraft => {
    let draft = drafts.get(key);

    if (!draft) {
      draft = { key, original: null, subDirs: [], children: [] };
      drafts.set(key, draft);
    }

    if (key !== ROOT_KEY) {
      const parent = ensure(parentKeyOf(key));

      if (!parent.subDirs.includes(draft)) {
        parent.subDirs.push(draft);
      }
    }

    return draft;
  };

  for (const node of nodes) {
    if (node.isDir) {
      const draft = ensure(normalizeNodePath(node.nodePath));

      if (!draft.original) {
        draft.original = node;
      }
    } else {
      // `relativePath` of a file row is the directory it lives in.
      ensure(normalizeNodePath(node.relativePath ?? '')).children.push(node);
    }
  }

  return root;
}

function finaliseDraft(draft: FileDraft, transform: (file: FileNode) => FileNode): FinalisedDraft {
  const childResults = draft.subDirs.map((subDir) => finaliseDraft(subDir, transform));

  const subDirNodes: DirectoryNode[] = [];
  const looseFiles: FileNode[] = [];

  for (const child of childResults) {
    if (child.node) {
      // A real row owns its files; they stay inside `child.node.children`.
      subDirNodes.push(child.node);
    } else {
      subDirNodes.push(...child.looseDirs);
      looseFiles.push(...child.files);
    }
  }

  const ownFiles = draft.children.map(transform);
  const files = [...ownFiles, ...looseFiles];

  let length = 0;
  let completedLength = 0;
  let selectedCount = 0;
  let partialCount = 0;

  for (const subDir of subDirNodes) {
    length += subDir.length;
    completedLength += subDir.completedLength;
    selectedCount += subDir.selected ? 1 : 0;
    partialCount += subDir.partialSelected ? 1 : 0;
  }

  for (const file of files) {
    length += file.length;
    completedLength += file.completedLength;
    selectedCount += file.selected ? 1 : 0;
  }

  const childCount = subDirNodes.length + files.length;
  const selected = childCount > 0 && selectedCount > 0 && selectedCount === childCount;
  const partialSelected = (selectedCount > 0 && selectedCount < childCount) || partialCount > 0;

  const original = draft.original;
  // Loose rows only appear when the input tree is missing an ancestor row.
  const filesChanged = looseFiles.length > 0 || ownFiles.some((file, i) => file !== draft.children[i]);
  const subDirsChanged = childResults.some(
    (child, i) => child.changed || child.node !== draft.subDirs[i].original,
  );
  const statsChanged =
    original === null ||
    original.length !== length ||
    original.completedLength !== completedLength ||
    original.selected !== selected ||
    original.allSelected !== selected ||
    original.partialSelected !== partialSelected;

  if (original === null) {
    return {
      node: null,
      looseDirs: subDirNodes,
      files,
      changed: filesChanged || subDirsChanged || statsChanged,
    };
  }

  if (!filesChanged && !subDirsChanged && !statsChanged) {
    return { node: original, looseDirs: [], files, changed: false };
  }

  const node: DirectoryNode = {
    ...original,
    length,
    completedLength,
    completePercent: percentOf(length, completedLength),
    selected,
    allSelected: selected,
    partialSelected,
    children: filesChanged ? files : original.children,
    subDirs: subDirsChanged ? subDirNodes : original.subDirs,
  };

  return { node, looseDirs: [], files, changed: true };
}

function transformSelection(
  nodes: readonly FileTreeNode[],
  transform: (file: FileNode) => FileNode,
): FileTreeNode[] {
  const result = finaliseDraft(buildDrafts(nodes), transform);
  const rows: FileTreeNode[] = [];

  // Same row order as `buildFileTree`: directories (depth-first) before the
  // files that sit in the torrent root.
  for (const directory of result.looseDirs) {
    rows.push(directory);
    rows.push(...flattenFileTree(directory));
  }

  rows.push(...result.files);

  return rows;
}

/**
 * Selects every file (`all`), clears every file (`none`) or flips each file
 * (`invert`). Directory rows are recomputed bottom-up afterwards.
 */
export function applySelectionMode(nodes: readonly FileTreeNode[], mode: SelectionMode): FileTreeNode[] {
  if (mode === 'invert') {
    return transformSelection(nodes, (file) => ({ ...file, selected: !file.selected }));
  }

  const selected = mode === 'all';

  return transformSelection(nodes, (file) => (file.selected === selected ? file : { ...file, selected }));
}

function normalizeExtension(value: string): string {
  return value.trim().replace(/^\.+/, '').toLowerCase();
}

function extensionOf(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex > 0 ? fileName.slice(lastDotIndex + 1) : '';
}

/**
 * The extension used for the category filters: lowercased, no dot. Files
 * without an extension report `''`, which is what the synthetic `Other`
 * bucket is made of together with every unknown extension.
 */
function effectiveExtension(file: FileTypeInfo): string {
  const declared = typeof file.extension === 'string' ? file.extension : '';

  return declared.trim().length > 0
    ? normalizeExtension(declared)
    : normalizeExtension(extensionOf(file.fileName ?? ''));
}

/**
 * Toggles every file whose extension is listed, leaving all others untouched.
 *
 * Entries are matched case-insensitively and an optional leading dot is
 * ignored, so `mp4` and `.MP4` both hit `video.mp4`. An empty list matches
 * nothing — the caller passes the concrete "Other" extensions (unknown ones
 * plus `''` for extension-less files), which keeps this function free of any
 * category table.
 */
export function setExtensionSelection(
  nodes: readonly FileTreeNode[],
  extensions: readonly string[],
  selected: boolean,
): FileTreeNode[] {
  const wanted = new Set((extensions ?? []).map(normalizeExtension));

  return transformSelection(nodes, (file) =>
    wanted.has(effectiveExtension(file)) && file.selected !== selected ? { ...file, selected } : file,
  );
}

/**
 * The 1-based aria2 indexes to send to `aria2.select-file`: sorted ascending
 * and de-duplicated. Empty when nothing is selected, which is what disables
 * the Confirm button.
 */
export function selectedAria2Indexes(nodes: readonly FileTreeNode[]): number[] {
  const indexes = new Set<number>();

  for (const file of collectLeafFiles(nodes)) {
    if (!file.selected) {
      continue;
    }

    const aria2Index = file.aria2Index > 0 ? file.aria2Index : file.index >= 0 ? file.index + 1 : 0;

    if (aria2Index > 0) {
      indexes.add(aria2Index);
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

/** true when not a single real file is selected. */
export function isSelectionEmpty(nodes: readonly FileTreeNode[]): boolean {
  return !collectLeafFiles(nodes).some((file) => file.selected);
}

/** File counts and byte totals, ignoring directory rows. */
export function selectionSummary(nodes: readonly FileTreeNode[]): SelectionSummary {
  let selected = 0;
  let total = 0;
  let bytes = 0;
  let selectedBytes = 0;

  for (const file of collectLeafFiles(nodes)) {
    const length = Number.isFinite(file.length) ? file.length : 0;

    total += 1;
    bytes += length;

    if (file.selected) {
      selected += 1;
      selectedBytes += length;
    }
  }

  return { selected, total, bytes, selectedBytes };
}