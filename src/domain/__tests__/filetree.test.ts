import { describe, expect, it } from 'vitest';

import { buildFileTree, flattenFileTree } from '@/domain/filetree';
import type { DirectoryNode, FileTreeNode, FileTypeInfo } from '@/domain/types';

interface FileSpec {
  fileName: string;
  /** Directory portion, relative to the torrent root. */
  relativePath?: string;
  /** Absolute path aria2 reported; defaults to a POSIX path inside `/downloads`. */
  path?: string;
  length?: number;
  selected?: boolean;
}

function makeFiles(specs: FileSpec[]): FileTypeInfo[] {
  return specs.map((spec, position) => {
    const relativePath = spec.relativePath ?? '';
    const extensionIndex = spec.fileName.lastIndexOf('.');
    const extension = extensionIndex > 0 ? spec.fileName.slice(extensionIndex + 1).toLowerCase() : '';
    const directory = relativePath ? `${relativePath}/` : '';

    return {
      index: position,
      aria2Index: position + 1,
      fileName: spec.fileName,
      path: spec.path ?? `/downloads/torrent/${directory}${spec.fileName}`,
      length: spec.length ?? 100,
      completedLength: 0,
      completePercent: 0,
      selected: spec.selected ?? true,
      extension,
      ...(spec.relativePath === undefined ? {} : { relativePath }),
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

function directory(nodes: FileTreeNode[], index: number): DirectoryNode {
  const node = nodes[index];

  if (!node?.isDir) {
    throw new Error(`expected a directory at row ${index}`);
  }

  return node;
}

function rowNames(nodes: FileTreeNode[]): string[] {
  return nodes.map((node) => (node.isDir ? `${node.nodeName}/` : node.fileName));
}

const TASK_DIR = '/downloads';

describe('buildFileTree', () => {
  it('leaves a single-file task without directories', () => {
    const files = deepFreeze(makeFiles([{ fileName: 'movie.mkv', path: '/downloads/movie.mkv' }]));
    const result = buildFileTree(files, { taskDir: TASK_DIR });

    expect(result.directoryCount).toBe(0);
    expect(result.multiDir).toBe(false);
    expect(result.nodes).toHaveLength(1);

    const file = result.nodes[0];
    expect(file.isDir).toBe(false);
    expect(file.relativePath).toBe('');
    expect(file.level).toBe(0);
    expect(file.aria2Index).toBe(1);
  });

  it('keeps one directory flat: directoryCount 1, not multiDir, files at level 0', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: 'readme.txt', relativePath: 'Extras' },
        { fileName: 'cover.jpg', relativePath: 'Extras', length: 250 },
      ]),
    );

    const result = buildFileTree(files, { taskDir: TASK_DIR, torrentRootName: 'MyTorrent' });

    expect(result.directoryCount).toBe(1);
    expect(result.multiDir).toBe(false);
    expect(rowNames(result.nodes)).toEqual(['readme.txt', 'cover.jpg']);
    expect(result.nodes.every((node) => node.isDir)).toBe(false);
    expect(result.nodes.map((node) => node.level)).toEqual([0, 0]);
    expect(result.nodes.every((node) => node.relativePath === 'Extras')).toBe(true);
  });

  it('flattens a two-directory torrent depth-first with subdirectories first', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: 'root.bin', relativePath: '' },
        { fileName: '1.txt', relativePath: 'x' },
        { fileName: '2.txt', relativePath: 'y' },
      ]),
    );

    const result = buildFileTree(files, { taskDir: TASK_DIR });

    expect(result.directoryCount).toBe(2);
    expect(result.multiDir).toBe(true);
    expect(rowNames(result.nodes)).toEqual(['x/', '1.txt', 'y/', '2.txt', 'root.bin']);
    expect(result.nodes.map((node) => node.level)).toEqual([0, 0, 0, 0, 0]);

    const x = directory(result.nodes, 0);
    expect(x.nodePath).toBe('x');
    expect(x.nodeName).toBe('x');
    expect(x.children).toHaveLength(1);
    expect(x.subDirs).toHaveLength(0);
    // Directory rows are not addressable through aria2's file indexes.
    expect(x.index).toBe(-1);
    expect(x.aria2Index).toBe(0);
    expect(x.selected).toBe(true);
    expect(x.partialSelected).toBe(false);
    expect(x.allSelected).toBe(true);
  });

  it('numbers a deeply nested path a/b/c/file.txt from 0 to 2', () => {
    const files = deepFreeze(makeFiles([{ fileName: 'file.txt', relativePath: 'a/b/c' }]));
    const result = buildFileTree(files, { taskDir: TASK_DIR });

    expect(result.directoryCount).toBe(3);
    expect(result.multiDir).toBe(true);
    expect(rowNames(result.nodes)).toEqual(['a/', 'b/', 'c/', 'file.txt']);
    expect(result.nodes.map((node) => node.level)).toEqual([0, 1, 2, 2]);

    const a = directory(result.nodes, 0);
    const b = directory(result.nodes, 1);
    const c = directory(result.nodes, 2);

    expect(b.relativePath).toBe('a');
    expect(c.relativePath).toBe('a/b');
    expect(a.subDirs).toHaveLength(1);
    expect(a.subDirs[0]).toBe(b);
    expect(b.subDirs[0]).toBe(c);
    expect(c.children).toHaveLength(1);
  });

  it('rolls up directory length and the tri-state selection', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: 'a.txt', relativePath: 'p/q', length: 10, selected: true },
        { fileName: 'b.txt', relativePath: 'p/q', length: 20, selected: false },
        { fileName: 'c.txt', relativePath: 'p', length: 30, selected: true },
        { fileName: 'd.txt', relativePath: 'p', length: 40, selected: false },
      ]),
    );

    const result = buildFileTree(files, { taskDir: TASK_DIR });
    const p = directory(result.nodes, 0);
    const q = directory(result.nodes, 1);

    expect(rowNames(result.nodes)).toEqual(['p/', 'q/', 'a.txt', 'b.txt', 'c.txt', 'd.txt']);

    expect(q.length).toBe(30);
    expect(q.completedLength).toBe(0);
    expect(q.selected).toBe(false);
    expect(q.allSelected).toBe(false);
    expect(q.partialSelected).toBe(true);

    expect(p.length).toBe(100);
    expect(p.selected).toBe(false);
    expect(p.partialSelected).toBe(true);
  });

  it('marks a fully selected directory as allSelected', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: 'a.txt', relativePath: 'left', selected: true },
        { fileName: 'b.txt', relativePath: 'right', selected: true },
      ]),
    );

    const result = buildFileTree(files, { taskDir: TASK_DIR });

    expect(result.nodes.filter((node) => node.isDir).every((node) => node.isDir && node.allSelected)).toBe(true);
    expect(result.directoryCount).toBe(2);
  });

  it('leaves a directory unselected when none of its files are', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: 'a.txt', relativePath: 'left', selected: false },
        { fileName: 'b.txt', relativePath: 'right', selected: false },
      ]),
    );

    const result = buildFileTree(files, { taskDir: TASK_DIR });
    const left = directory(result.nodes, 0);

    expect(left.selected).toBe(false);
    expect(left.allSelected).toBe(false);
    expect(left.partialSelected).toBe(false);
  });

  it('memoises directory rows so sibling paths share one node', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: '1.txt', relativePath: 'a' },
        { fileName: '2.txt', relativePath: 'a/b' },
        { fileName: '3.txt', relativePath: 'a' },
      ]),
    );

    const result = buildFileTree(files, { taskDir: TASK_DIR });

    // `a` is reached directly and as the parent of `a/b` — one node only.
    expect(result.directoryCount).toBe(2);
    expect(result.nodes.filter((node) => node.isDir)).toHaveLength(2);
    expect(rowNames(result.nodes)).toEqual(['a/', 'b/', '2.txt', '1.txt', '3.txt']);

    const a = directory(result.nodes, 0);
    const b = directory(result.nodes, 1);

    // Identity, not just equality: the flattened row is the very node the
    // parent holds.
    expect(a.subDirs).toHaveLength(1);
    expect(a.subDirs[0]).toBe(b);
    expect(result.nodes[1]).toBe(a.subDirs[0]);
    expect(a.children).toHaveLength(2);
    expect(a.children[0]).toBe(result.nodes[3]);
    expect(a.children[1]).toBe(result.nodes[4]);
  });

  it('normalises Windows separators', () => {
    const files = deepFreeze([
      {
        index: 0,
        aria2Index: 1,
        fileName: 'b.txt',
        path: 'C:\\downloads\\MyTorrent\\a\\b.txt',
        length: 10,
        completedLength: 0,
        completePercent: 0,
        selected: true,
        extension: 'txt',
      },
      {
        index: 1,
        aria2Index: 2,
        fileName: 'd.txt',
        path: 'C:\\downloads\\MyTorrent\\a\\c\\d.txt',
        length: 20,
        completedLength: 0,
        completePercent: 0,
        selected: true,
        extension: 'txt',
      },
      {
        index: 2,
        aria2Index: 3,
        fileName: 'root.bin',
        path: 'C:\\downloads\\MyTorrent\\root.bin',
        length: 30,
        completedLength: 0,
        completePercent: 0,
        selected: true,
        extension: 'bin',
      },
    ]);

    const result = buildFileTree(files, { taskDir: 'C:\\downloads', torrentRootName: 'MyTorrent' });

    expect(result.directoryCount).toBe(2);
    expect(result.multiDir).toBe(true);
    expect(rowNames(result.nodes)).toEqual(['a/', 'c/', 'd.txt', 'b.txt', 'root.bin']);

    const a = directory(result.nodes, 0);
    const c = directory(result.nodes, 1);

    expect(a.nodePath).toBe('a');
    expect(c.nodePath).toBe('a/c');
    expect(c.relativePath).toBe('a');
    expect(c.level).toBe(1);
    expect(result.nodes[3].relativePath).toBe('a');
    expect(result.nodes[4].relativePath).toBe('');
    // aria2 reported a Windows path, so the row keeps it verbatim.
    expect(result.nodes[3].path).toBe('C:\\downloads\\MyTorrent\\a\\b.txt');
  });

  it('returns an empty tree for an empty file list', () => {
    const result = buildFileTree([], { taskDir: TASK_DIR });

    expect(result).toEqual({ nodes: [], directoryCount: 0, multiDir: false });
  });

  it('does not mutate the input files', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: 'a.txt', relativePath: 'x', selected: false },
        { fileName: 'b.txt', relativePath: 'x' },
      ]),
    );
    const snapshot = JSON.stringify(files);

    buildFileTree(files, { taskDir: TASK_DIR });

    expect(JSON.stringify(files)).toBe(snapshot);
  });
});

describe('flattenFileTree', () => {
  it('returns an empty list for a null root', () => {
    expect(flattenFileTree(null)).toEqual([]);
  });

  it('walks a subtree depth-first, subdirectories before files', () => {
    const files = deepFreeze(
      makeFiles([
        { fileName: '1.txt', relativePath: 'x' },
        { fileName: '2.txt', relativePath: 'x/y' },
        { fileName: '3.txt', relativePath: '' },
      ]),
    );

    const { nodes } = buildFileTree(files, { taskDir: TASK_DIR });
    const x = directory(nodes, 0);

    expect(rowNames(flattenFileTree(x))).toEqual(['y/', '2.txt', '1.txt']);
  });
});