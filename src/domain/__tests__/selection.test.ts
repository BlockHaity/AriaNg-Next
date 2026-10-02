import { describe, expect, it } from 'vitest';

import { buildFileTree } from '@/domain/filetree';
import {
  applySelectionMode,
  collectLeafFiles,
  isSelectionEmpty,
  selectedAria2Indexes,
  selectionSummary,
  setExtensionSelection,
} from '@/domain/selection';
import type { FileNode, FileTreeNode, FileTypeInfo } from '@/domain/types';

interface Spec {
  fileName: string;
  relativePath?: string;
  length?: number;
  selected?: boolean;
}

function makeFiles(specs: Spec[]): FileTypeInfo[] {
  return specs.map((spec, position) => {
    const extensionIndex = spec.fileName.lastIndexOf('.');

    return {
      index: position,
      aria2Index: position + 1,
      fileName: spec.fileName,
      path: `/downloads/torrent/${spec.relativePath ? `${spec.relativePath}/` : ''}${spec.fileName}`,
      length: spec.length ?? 100,
      completedLength: 0,
      completePercent: 0,
      selected: spec.selected ?? true,
      extension: extensionIndex > 0 ? spec.fileName.slice(extensionIndex + 1).toLowerCase() : '',
      relativePath: spec.relativePath ?? '',
    };
  });
}

/** Any write to a frozen object throws in strict mode, which fails the test. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }

  return value;
}

function freezeTree(specs: Spec[]): FileTreeNode[] {
  const files = deepFreeze(makeFiles(specs));
  const { nodes } = buildFileTree(files, { taskDir: '/downloads', torrentRootName: 'MyTorrent' });

  return deepFreeze(nodes);
}

/** Extras/, readme.txt, cover.jpg, Video/, Subs/, Part1.srt, Part1.mkv, README.md */
const MIXED_TREE: Spec[] = [
  { fileName: 'readme.txt', relativePath: 'Extras', length: 10, selected: true },
  { fileName: 'cover.jpg', relativePath: 'Extras', length: 20, selected: false },
  { fileName: 'Part1.mkv', relativePath: 'Video', length: 100, selected: true },
  { fileName: 'Part1.srt', relativePath: 'Video/Subs', length: 5, selected: false },
  { fileName: 'README.md', relativePath: '', length: 1, selected: true },
];

const NOTHING_SELECTED: Spec[] = MIXED_TREE.map((spec) => ({ ...spec, selected: false }));

function fileNode(overrides: Partial<FileTypeInfo> & { aria2Index: number }): FileNode {
  return {
    isDir: false,
    index: overrides.aria2Index - 1,
    fileName: `file-${overrides.aria2Index}`,
    path: `/downloads/file-${overrides.aria2Index}`,
    length: 1,
    completedLength: 0,
    completePercent: 0,
    selected: true,
    extension: '',
    ...overrides,
  };
}

describe('collectLeafFiles', () => {
  it('returns only real files, in display order', () => {
    const files = collectLeafFiles(freezeTree(MIXED_TREE));

    expect(files).toHaveLength(5);
    expect(files.map((file) => file.fileName)).toEqual([
      'readme.txt',
      'cover.jpg',
      'Part1.srt',
      'Part1.mkv',
      'README.md',
    ]);
    expect(files.every((file) => !('isDir' in file) || file.isDir === false)).toBe(true);
  });

  it('descends into a directory row and never counts a file twice', () => {
    const tree = freezeTree(MIXED_TREE);
    const files = collectLeafFiles([tree[0]]);

    expect(files.map((file) => file.fileName)).toEqual(['readme.txt', 'cover.jpg']);
    expect(collectLeafFiles(tree)).toHaveLength(5);
  });

  it('handles a flat list of files with no directories', () => {
    const files = deepFreeze(makeFiles([{ fileName: 'a.txt' }, { fileName: 'b.txt' }]));
    const { nodes } = buildFileTree(files, { taskDir: '/downloads' });

    expect(nodes.every((node) => !node.isDir)).toBe(true);
    expect(collectLeafFiles(nodes)).toHaveLength(2);
  });
});

describe('applySelectionMode', () => {
  it('selects everything', () => {
    const tree = freezeTree(NOTHING_SELECTED);
    const result = applySelectionMode(tree, 'all');

    expect(selectedAria2Indexes(result)).toEqual([1, 2, 3, 4, 5]);
    expect(result.every((node) => node.isDir || node.selected)).toBe(true);
  });

  it('clears everything, including the folder checkboxes', () => {
    const tree = freezeTree(MIXED_TREE);
    const result = applySelectionMode(tree, 'none');

    expect(selectedAria2Indexes(result)).toEqual([]);
    expect(isSelectionEmpty(result)).toBe(true);
    expect(result.every((node) => !node.isDir || (!node.selected && !node.allSelected && !node.partialSelected))).toBe(
      true,
    );
  });

  it('inverts the current selection', () => {
    const tree = freezeTree(MIXED_TREE);

    expect(selectedAria2Indexes(tree)).toEqual([1, 3, 5]);
    expect(selectedAria2Indexes(applySelectionMode(tree, 'invert'))).toEqual([2, 4]);
    expect(selectedAria2Indexes(applySelectionMode(applySelectionMode(tree, 'invert'), 'invert'))).toEqual([1, 3, 5]);
  });

  it('never mutates the input tree', () => {
    const tree = freezeTree(MIXED_TREE);
    const snapshot = JSON.stringify(tree);

    const all = applySelectionMode(tree, 'all');
    const none = applySelectionMode(tree, 'none');
    const invert = applySelectionMode(tree, 'invert');
    setExtensionSelection(tree, ['mkv'], false);

    expect(JSON.stringify(tree)).toBe(snapshot);
    expect(all).not.toBe(tree);
    expect(none).not.toBe(tree);
    expect(invert).not.toBe(tree);
    expect(selectedAria2Indexes(tree)).toEqual([1, 3, 5]);
  });

  it('recomputes the tri-state of every folder bottom-up', () => {
    const tree = freezeTree(NOTHING_SELECTED);
    const selected = applySelectionMode(tree, 'all');

    const allDirectories = selected.filter((node) => node.isDir);
    expect(allDirectories).toHaveLength(3);
    expect(allDirectories.every((node) => node.isDir && node.selected && node.allSelected)).toBe(true);
    expect(allDirectories.every((node) => node.isDir && !node.partialSelected)).toBe(true);

    // Video/ holds one file plus the (now fully selected) Subs/ folder.
    const video = allDirectories.find((node) => node.isDir && node.nodePath === 'Video');
    expect(video?.isDir && video.subDirs).toHaveLength(1);

    const partial = applySelectionMode(selected, 'none');
    expect(partial.every((node) => !node.isDir || !node.selected)).toBe(true);
  });

  it('marks a folder partially selected when only some files are', () => {
    const tree = freezeTree(MIXED_TREE);
    const flipped = applySelectionMode(tree, 'invert');

    // Inverting MIXED_TREE leaves cover.jpg alone in Extras/.
    const extras = flipped.find((node) => node.isDir && node.nodePath === 'Extras');
    expect(extras?.isDir && extras.partialSelected).toBe(true);
    expect(extras?.isDir && extras.allSelected).toBe(false);
    expect(selectedAria2Indexes(flipped)).toEqual([2, 4]);
  });

  it('works on a flat list of files', () => {
    const files = deepFreeze(
      makeFiles([{ fileName: 'a.txt', selected: true }, { fileName: 'b.bin', selected: false }]),
    );
    const { nodes } = buildFileTree(files, { taskDir: '/downloads' });

    expect(selectedAria2Indexes(applySelectionMode(nodes, 'all'))).toEqual([1, 2]);
    expect(selectedAria2Indexes(applySelectionMode(nodes, 'none'))).toEqual([]);
    expect(selectedAria2Indexes(applySelectionMode(nodes, 'invert'))).toEqual([2]);
  });
});

describe('setExtensionSelection', () => {
  it('selects only the listed extensions, ignoring case and a leading dot', () => {
    const tree = freezeTree(NOTHING_SELECTED);
    const result = setExtensionSelection(tree, ['.MKV', 'srt'], true);

    expect(selectedAria2Indexes(result)).toEqual([3, 4]);

    // Video/Subs/ only holds the now selected .srt file.
    const subs = result.find((node) => node.isDir && node.nodePath === 'Video/Subs');
    expect(subs?.isDir && subs.allSelected).toBe(true);
    expect(subs?.isDir && subs.partialSelected).toBe(false);

    // ... and so does Video/, whose own .mkv is selected as well.
    const video = result.find((node) => node.isDir && node.nodePath === 'Video');
    expect(video?.isDir && video.allSelected).toBe(true);

    // Extras/ keeps both of its files deselected.
    const extras = result.find((node) => node.isDir && node.nodePath === 'Extras');
    expect(extras?.isDir && extras.allSelected).toBe(false);
    expect(extras?.isDir && extras.partialSelected).toBe(false);
  });

  it('deselects the listed extensions', () => {
    const tree = freezeTree(MIXED_TREE);
    const result = setExtensionSelection(tree, ['mkv'], false);

    expect(selectedAria2Indexes(result)).toEqual([1, 5]);
  });

  it('does nothing for an empty list — the "Other" bucket with nothing unknown', () => {
    const tree = freezeTree(MIXED_TREE);
    const snapshot = JSON.stringify(tree);
    const result = setExtensionSelection(tree, [], true);

    expect(result).toEqual(tree);
    expect(selectedAria2Indexes(result)).toEqual([1, 3, 5]);
    expect(JSON.stringify(tree)).toBe(snapshot);
    // Unchanged rows are shared, not rebuilt.
    result.forEach((node, position) => expect(node).toBe(tree[position]));
  });

  it('covers the synthetic "Other" bucket: unknown extensions and extension-less files', () => {
    const tree = freezeTree([
      { fileName: 'movie.mkv', relativePath: 'Extras', selected: false },
      { fileName: 'data.xyz', relativePath: 'Extras', selected: false },
      { fileName: 'LICENSE', relativePath: 'Extras', selected: false },
    ]);
    const result = setExtensionSelection(tree, ['xyz', ''], true);

    expect(selectedAria2Indexes(result)).toEqual([2, 3]);
  });

  it('never mutates the input tree', () => {
    const tree = freezeTree(MIXED_TREE);
    const snapshot = JSON.stringify(tree);

    const result = setExtensionSelection(tree, ['txt', 'srt'], true);

    expect(JSON.stringify(tree)).toBe(snapshot);
    expect(result).not.toBe(tree);
    expect(result.some((node) => node === undefined)).toBe(false);
    expect(result).toHaveLength(tree.length);
  });
});

describe('selectedAria2Indexes', () => {
  it('is sorted, de-duplicated and 1-based', () => {
    const nodes = [
      fileNode({ aria2Index: 5 }),
      fileNode({ aria2Index: 2 }),
      fileNode({ aria2Index: 5 }),
      fileNode({ aria2Index: 3, selected: false }),
      fileNode({ aria2Index: 1 }),
    ];

    expect(selectedAria2Indexes(nodes)).toEqual([1, 2, 5]);
  });

  it('is empty when nothing is selected, which disables Confirm', () => {
    expect(selectedAria2Indexes(freezeTree(NOTHING_SELECTED))).toEqual([]);
    expect(selectedAria2Indexes([])).toEqual([]);
  });

  it('falls back to the 0-based index when aria2Index is missing', () => {
    const nodes: FileNode[] = [
      { ...fileNode({ aria2Index: 1 }), aria2Index: 0, index: 2 },
      { ...fileNode({ aria2Index: 1 }), aria2Index: 0, index: 0, selected: false },
    ];

    expect(selectedAria2Indexes(nodes)).toEqual([3]);
  });
});

describe('selectionSummary', () => {
  it('counts files and bytes', () => {
    expect(selectionSummary(freezeTree(MIXED_TREE))).toEqual({
      selected: 3,
      total: 5,
      bytes: 136,
      selectedBytes: 111,
    });
  });

  it('reports zero bytes when nothing is selected', () => {
    expect(selectionSummary(freezeTree(NOTHING_SELECTED))).toEqual({
      selected: 0,
      total: 5,
      bytes: 136,
      selectedBytes: 0,
    });
  });

  it('counts every file after selecting all', () => {
    const tree = freezeTree(NOTHING_SELECTED);
    const all = applySelectionMode(tree, 'all');

    expect(selectionSummary(all)).toEqual({ selected: 5, total: 5, bytes: 136, selectedBytes: 136 });
  });

  it('is empty for an empty tree', () => {
    expect(selectionSummary([])).toEqual({ selected: 0, total: 0, bytes: 0, selectedBytes: 0 });
  });
});

describe('isSelectionEmpty', () => {
  it('is true for a fresh tree with nothing selected', () => {
    expect(isSelectionEmpty(freezeTree(NOTHING_SELECTED))).toBe(true);
    expect(isSelectionEmpty([])).toBe(true);
  });

  it('is false as soon as one file is selected', () => {
    const tree = freezeTree(NOTHING_SELECTED);
    const some = setExtensionSelection(tree, ['txt'], true);

    expect(isSelectionEmpty(some)).toBe(false);
    expect(isSelectionEmpty(applySelectionMode(tree, 'all'))).toBe(false);
    expect(isSelectionEmpty(applySelectionMode(freezeTree(MIXED_TREE), 'none'))).toBe(true);
  });
});