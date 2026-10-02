/**
 * Directory-tree builder — a faithful port of AriaNg's virtual file nodes.
 *
 * Reference: `src/scripts/services/aria2TaskService.js` lines 75-217
 * (`getRelativePath`, `getDirectoryNode`, `pushFileToDirectoryNode`,
 * `fillAllNodes`) plus the `allDirectories.length > 1` check at line 350.
 *
 * Two intentional differences from the original, both documented in place:
 *
 * 1. `level` is the 0-based depth (top level directories are level 0), so the
 *    torrent root is not part of the numbering. AriaNg numbers the invisible
 *    root as level 0, which shifts every visible row by one.
 * 2. `multiDir` requires **more than one** real directory node. AriaNg
 *    counts the invisible root, so it flips to tree mode as soon as a single
 *    subdirectory exists. The task list swaps `files` for this flattened list
 *    when `multiDir` is true, which disables file-list sorting in the UI, so
 *    the flag has to stay conservative.
 */

import type { DirectoryNode, FileNode, FileTreeNode, FileTypeInfo } from '@/domain/types';

/** The torrent root itself; files that sit directly in it use this path. */
const ROOT_NODE_PATH = '';

/** Depth of the invisible torrent root — its directories start at level 0. */
const ROOT_LEVEL = -1;

/** Directory rows are not addressable by aria2's file indexes. */
const DIRECTORY_INDEX = -1;
const DIRECTORY_ARIA2_INDEX = 0;

/** AriaNg's `allDirectories.length > 1`, minus the invisible root. */
const MULTI_DIR_THRESHOLD = 1;

const SEPARATOR = '/';

export interface BuildFileTreeOptions {
  taskDir: string;
  /** Torrent root name, stripped for multi-file BT tasks. */
  torrentRootName?: string;
}

export interface FileTreeResult {
  /** Depth-first flattened list: subdirectories then files (AriaNg's order). */
  nodes: FileTreeNode[];
  /** Total number of real directory nodes (excluding the root). */
  directoryCount: number;
  /** true when the task should render as a multi-directory tree. */
  multiDir: boolean;
}

/**
 * A directory row while the tree is still being assembled: the depth and the
 * parent are always known, so they are not optional here.
 */
interface MutableDirectoryNode
  extends Omit<DirectoryNode, 'level' | 'relativePath' | 'subDirs'> {
  level: number;
  relativePath: string;
  subDirs: MutableDirectoryNode[];
}

/** `\` -> `/`; leading, trailing and repeated separators produce no segments. */
function segmentsOf(value: string | undefined): string[] {
  return value ? value.split(/[\\/]/).filter((segment) => segment.length > 0) : [];
}

/** Drops `prefix` from `segments`, but only on whole-segment boundaries. */
function stripPrefix(segments: string[], prefix: string[]): string[] {
  if (prefix.length === 0 || segments.length < prefix.length) {
    return segments;
  }

  for (let i = 0; i < prefix.length; i += 1) {
    if (segments[i] !== prefix[i]) {
      return segments;
    }
  }

  return segments.slice(prefix.length);
}

/**
 * The directory portion of a file, relative to the torrent root.
 *
 * Port of `getRelativePath` (aria2TaskService.js:75-122): strip the download
 * directory, strip the torrent name, strip the file name and trim separators.
 * `file.relativePath` is preferred when the normaliser already computed it.
 */
function directoryPathOf(file: FileTypeInfo, options: BuildFileTreeOptions): string {
  const taskDirSegments = segmentsOf(options.taskDir);
  const torrentRootName = (options.torrentRootName ?? '').trim();
  const torrentRootSegments = torrentRootName ? segmentsOf(torrentRootName) : [];

  // An empty `relativePath` is meaningful: it means "directly in the torrent
  // root", so only `undefined` falls back to the absolute path.
  const source = typeof file.relativePath === 'string' ? file.relativePath : file.path;

  let segments = stripPrefix(segmentsOf(source), taskDirSegments);
  segments = stripPrefix(segments, torrentRootSegments);

  // AriaNg trims the file name by suffix match; a segment-exact match keeps
  // `a/b.txt` intact for a file actually called `b.txt`.
  const last = segments[segments.length - 1];
  if (file.fileName && last === file.fileName) {
    segments = segments.slice(0, -1);
  }

  return segments.join(SEPARATOR);
}

/**
 * AriaNg's `getDirectoryNode` (aria2TaskService.js:124-167), memoised through
 * `allDirectoryMap` so sibling paths share one node object.
 */
function getDirectoryNode(
  nodePath: string,
  allDirectories: MutableDirectoryNode[],
  allDirectoryMap: Map<string, MutableDirectoryNode>,
): MutableDirectoryNode {
  const existing = allDirectoryMap.get(nodePath);

  if (existing) {
    return existing;
  }

  let parentNode: MutableDirectoryNode | null = null;
  let nodeName = nodePath;

  if (nodePath.length > 0) {
    const lastSeparatorIndex = nodePath.lastIndexOf(SEPARATOR);

    if (lastSeparatorIndex > 0) {
      nodeName = nodePath.slice(lastSeparatorIndex + 1);
    }

    const parentPath = lastSeparatorIndex > 0 ? nodePath.slice(0, lastSeparatorIndex) : ROOT_NODE_PATH;
    parentNode = getDirectoryNode(parentPath, allDirectories, allDirectoryMap);
  }

  const node: MutableDirectoryNode = {
    isDir: true,
    nodePath,
    nodeName,
    relativePath: parentNode ? parentNode.nodePath : ROOT_NODE_PATH,
    level: parentNode ? parentNode.level + 1 : ROOT_LEVEL,
    index: DIRECTORY_INDEX,
    aria2Index: DIRECTORY_ARIA2_INDEX,
    fileName: nodeName,
    path: nodePath,
    length: 0,
    completedLength: 0,
    completePercent: 0,
    // AriaNg's initial state; `rollUpDirectory` recomputes it below.
    selected: true,
    allSelected: true,
    partialSelected: false,
    extension: '',
    children: [],
    subDirs: [],
  };

  allDirectories.push(node);
  allDirectoryMap.set(nodePath, node);

  if (parentNode) {
    parentNode.subDirs.push(node);
  }

  return node;
}

function createFileNode(file: FileTypeInfo, directoryNode: MutableDirectoryNode): FileNode {
  // aria2 indexes are 1-based, so 0 never identifies a real row.
  const aria2Index =
    file.aria2Index > 0 ? file.aria2Index : file.index >= 0 ? file.index + 1 : DIRECTORY_ARIA2_INDEX;

  return {
    ...file,
    isDir: false,
    aria2Index,
    relativePath: directoryNode.nodePath,
    level: Math.max(directoryNode.level, ROOT_LEVEL + 1),
  };
}

function percentOf(length: number, completedLength: number): number {
  return length > 0 ? (completedLength / length) * 100 : 0;
}

/**
 * AriaNg's `fillAllNodes` roll-up (aria2TaskService.js:182-217) without the
 * flattening, so it can be reused for the non-tree case.
 */
function rollUpDirectory(node: MutableDirectoryNode): void {
  let length = 0;
  let completedLength = 0;
  let selectedCount = 0;
  let partialCount = 0;

  for (const subDir of node.subDirs) {
    rollUpDirectory(subDir);

    length += subDir.length;
    completedLength += subDir.completedLength;
    selectedCount += subDir.selected ? 1 : 0;
    partialCount += subDir.partialSelected ? 1 : 0;
  }

  for (const file of node.children) {
    length += file.length;
    completedLength += file.completedLength;
    selectedCount += file.selected ? 1 : 0;
  }

  const childCount = node.subDirs.length + node.children.length;

  node.length = length;
  node.completedLength = completedLength;
  node.completePercent = percentOf(length, completedLength);
  // `selected` mirrors `allSelected`: the row's own checkbox is only on when
  // every descendant is selected, `partialSelected` drives the tri-state.
  node.selected = childCount > 0 && selectedCount > 0 && selectedCount === childCount;
  node.allSelected = node.selected;
  node.partialSelected = (selectedCount > 0 && selectedCount < childCount) || partialCount > 0;
}

/** Depth-first: subdirectories (recursively) first, then this level's files. */
function collectRows(node: DirectoryNode, out: FileTreeNode[]): void {
  for (const subDir of node.subDirs) {
    out.push(subDir);
    collectRows(subDir, out);
  }

  for (const file of node.children) {
    out.push(file);
  }
}

/**
 * Flattens a built tree into AriaNg's row order. Pure: the root node is never
 * emitted, only its descendants.
 */
export function flattenFileTree(root: DirectoryNode | null): FileTreeNode[] {
  const rows: FileTreeNode[] = [];

  if (root) {
    collectRows(root, rows);
  }

  return rows;
}

/**
 * Groups `files` into AriaNg's virtual directory tree.
 *
 * - `nodes` is the flattened tree (directories and files) when `multiDir` is
 *   true, otherwise the plain file list so the UI can still sort it.
 * - `directoryCount` never counts the invisible torrent root.
 */
export function buildFileTree(
  files: readonly FileTypeInfo[],
  options: BuildFileTreeOptions,
): FileTreeResult {
  const allDirectories: MutableDirectoryNode[] = [];
  const allDirectoryMap = new Map<string, MutableDirectoryNode>();
  const fileNodes: FileNode[] = [];

  for (const file of files) {
    if (!file) {
      continue;
    }

    const directoryNode = getDirectoryNode(directoryPathOf(file, options), allDirectories, allDirectoryMap);
    const fileNode = createFileNode(file, directoryNode);

    directoryNode.children.push(fileNode);
    fileNodes.push(fileNode);
  }

  const root = allDirectoryMap.get(ROOT_NODE_PATH) ?? null;
  const directoryCount = Math.max(allDirectories.length - (root ? 1 : 0), 0);
  const multiDir = directoryCount > MULTI_DIR_THRESHOLD;

  if (!multiDir) {
    return { nodes: fileNodes, directoryCount, multiDir };
  }

  if (root) {
    rollUpDirectory(root);
  }

  return { nodes: flattenFileTree(root), directoryCount, multiDir };
}