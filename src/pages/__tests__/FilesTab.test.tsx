/**
 * Files tab behaviour.
 *
 * What is pinned down here is the rule set AriaNg scattered across its
 * controller, because each of these is easy to get subtly wrong:
 *
 * - sorting is **disabled** for a multi-directory torrent (the context menu
 *   offers Expand All / Collapse All instead);
 * - the `(Choose Files)` link only exists for a multi-file waiting / paused
 *   task;
 * - Select All / None / Invert, the category buttons and the tri-state
 *   directory checkboxes all produce the same *copy* of the row list;
 * - Confirm is disabled while nothing is selected, and pushes the 1-based,
 *   ascending aria2 indexes;
 * - the polling latch (`isFileSelectionActive`) is raised while the toolbar is
 *   open, because the detail page's poll must not overwrite the local edits.
 *
 * `aria2.selectFile` is mocked at the command module, and the mdui web
 * components are *not* registered in jsdom, so `mdui-button` is an unknown
 * element: its `click` listener is a real DOM listener and therefore fires,
 * while `<mdui-checkbox>` exposes `checked` / `indeterminate` as plain JS
 * properties. That is exactly what the assertions below read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { selectTaskFiles } from '@/store/commands';
import { useSettingsStore } from '@/store/settings';
import { FilesTab, isFileSelectionActive, resetFileSelection, withIndexesSelection } from '@/pages/task-detail/tabs/FilesTab';
import type { DirectoryNode, FileNode, FileTreeNode, FileTypeInfo, NormalizedTask } from '@/domain/types';

vi.mock('@/store/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/commands')>();
  return {
    ...actual,
    selectTaskFiles: vi.fn(async () => {}),
  };
});

/*
 * mdui's programmatic dialog / snackbar helpers register the whole component
 * family (`<mdui-dialog>` pulls in `<mdui-button>`, `<mdui-checkbox>`,
 * `<mdui-dropdown>`, …) as real custom elements. Their Lit implementations reach
 * for shadow-DOM behaviour jsdom does not fully provide, which surfaces as
 * unhandled rejections from `firstUpdated`.
 *
 * Stubbing the two function modules keeps the elements undefined, i.e. inert
 * unknown elements — which is all these tests need, because the wrappers in
 * `@/ui/mdui` communicate exclusively through plain DOM events and JS
 * properties.
 */
vi.mock('mdui/functions/dialog.js', () => ({ dialog: () => document.createElement('div') }));
vi.mock('mdui/functions/snackbar.js', () => ({ snackbar: () => document.createElement('div') }));

const selectFileMock = vi.mocked(selectTaskFiles);

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function file(index: number, name: string, selected: boolean, extra: Partial<FileTypeInfo> = {}): FileTypeInfo {
  return {
    index,
    aria2Index: index + 1,
    fileName: name,
    path: `/tmp/${name}`,
    length: 1024 * (index + 1),
    completedLength: selected ? 1024 * (index + 1) : 0,
    completePercent: selected ? 100 : 0,
    selected,
    extension: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '',
    ...extra,
  };
}

/**
 * A directory row, rolled up exactly like `domain/filetree`'s `rollUpDirectory`
 * so the fixture can never disagree with what the real builder would produce.
 */
function dir(
  index: number,
  nodePath: string,
  nodeName: string,
  children: FileNode[],
  subDirs: DirectoryNode[] = [],
  level = 0,
): DirectoryNode {
  const length =
    children.reduce((sum, entry) => sum + entry.length, 0) +
    subDirs.reduce((sum, entry) => sum + entry.length, 0);
  const completedLength =
    children.reduce((sum, entry) => sum + entry.completedLength, 0) +
    subDirs.reduce((sum, entry) => sum + entry.completedLength, 0);

  const childCount = children.length + subDirs.length;
  const selectedCount =
    children.filter((entry) => entry.selected).length + subDirs.filter((entry) => entry.selected).length;
  const selected = childCount > 0 && selectedCount === childCount;

  return {
    isDir: true,
    index,
    aria2Index: 0,
    fileName: nodeName,
    nodePath,
    nodeName,
    path: nodePath,
    relativePath: nodePath.includes('/') ? nodePath.slice(0, nodePath.lastIndexOf('/')) : '',
    level,
    length,
    completedLength,
    completePercent: length > 0 ? (completedLength / length) * 100 : 0,
    selected,
    allSelected: selected,
    partialSelected: (selectedCount > 0 && selectedCount < childCount) || subDirs.some((entry) => entry.partialSelected),
    extension: '',
    children,
    subDirs,
  };
}

function makeTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    gid: 'gid-files',
    status: 'paused',
    taskName: 'files',
    hasTaskName: true,
    totalLength: 100,
    completedLength: 0,
    completePercent: 0,
    remainLength: 100,
    remainPercent: 100,
    uploadLength: 0,
    shareRatio: 0,
    uploadSpeed: 0,
    downloadSpeed: 0,
    idle: true,
    connections: 0,
    numSeeders: 0,
    seeder: false,
    dir: '/tmp',
    numPieces: 0,
    completedPieces: 0,
    pieceLength: 0,
    bitfield: '',
    remainTime: null,
    verifyIntegrityPending: false,
    errorDescription: '',
    files: [],
    fileTree: [],
    multiDir: false,
    selectedFileCount: 0,
    trackers: [],
    ...overrides,
  } as NormalizedTask;
}

/** Three files: two video, one archive — enough for the category filters. */
function flatTask(status = 'paused'): NormalizedTask {
  const files = [file(0, 'one.mp4', true), file(1, 'two.mp4', true), file(2, 'pack.zip', false)];
  return makeTask({
    status,
    files,
    fileTree: files.map((entry) => ({ ...entry, isDir: false as const })),
    selectedFileCount: files.filter((entry) => entry.selected).length,
  });
}

/** `season/episode.mkv` — one directory containing one file. */
function treeTask(status = 'paused'): NormalizedTask {
  const episode = { ...file(0, 'episode.mkv', true), isDir: false as const, relativePath: 'season', level: 1 };
  const directory = dir(-1, 'season', 'season', [episode], [], 0);

  return makeTask({
    status,
    multiDir: true,
    files: [directory, episode] as unknown as FileTypeInfo[],
    fileTree: [directory, episode],
    selectedFileCount: 1,
  });
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** The `<mdui-checkbox>` of the row whose text is `label`. */
function checkboxOf(container: HTMLElement, label: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>('[data-node-kind]')].find((entry) =>
    entry.textContent?.includes(label),
  );
  const checkbox = row?.querySelector('mdui-checkbox');
  if (!checkbox) throw new Error(`no checkbox for ${label}`);
  return checkbox as HTMLElement;
}

function rowOf(container: HTMLElement, label: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>('[data-node-kind]')].find((entry) =>
    entry.textContent?.includes(label),
  );
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

function button(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label') === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

/** The choose-files toolbar host. */
function toolbar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector('.ariang-choose-files-bar');
  if (!bar) throw new Error('the choose-files toolbar is not open');
  return bar as HTMLElement;
}

/**
 * The toolbar's main toggle — the "Select All" / "Select None" half of the
 * split control. Deliberately *not* `getByText`, because the dropdown repeats
 * the same three labels on `<mdui-menu-item>`.
 */
function selectToggle(container: HTMLElement): HTMLElement {
  return toolbar(container).querySelector('.ariang-split-button mdui-button') as HTMLElement;
}

/** One of the dropdown's explicit All / None / Invert entries. */
function selectMenuItem(label: string): HTMLElement {
  const found = [...document.querySelectorAll('mdui-menu-item')].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no dropdown entry ${label}`);
  return found as HTMLElement;
}

/** A plain labelled toolbar button (a category, Confirm or Cancel). */
function toolbarButton(container: HTMLElement, label: string): HTMLElement {
  const found = [...toolbar(container).querySelectorAll('mdui-button')].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no toolbar button ${label}`);
  return found as HTMLElement;
}

/**
 * Flips an `<mdui-checkbox>`.
 *
 * The real component keeps `checked` / `indeterminate` as JS properties and
 * announces an interaction with a `change` CustomEvent (that is the whole point
 * of `useMduiModel`); a bare `fireEvent.click` would do neither.
 */
function toggleCheckbox(element: HTMLElement, checked: boolean): void {
  act(() => {
    (element as unknown as { checked: boolean }).checked = checked;
    element.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { checked } }));
  });
}

function setOrder(order: string): void {
  useSettingsStore.getState().set('fileListDisplayOrder', order as never);
}

beforeEach(() => {
  resetFileSelection();
  selectFileMock.mockClear();
  setOrder('default:asc');
});

afterEach(() => {
  cleanup();
  resetFileSelection();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* headers + sorting                                                   */
/* ------------------------------------------------------------------ */

describe('FilesTab — sorting', () => {
  it('renders the three headers', () => {
    const { container } = render(<FilesTab task={flatTask()} />);

    expect(button(container, 'File Name')).toBeInTheDocument();
    expect(button(container, 'Progress')).toBeInTheDocument();
    expect(button(container, 'File Size')).toBeInTheDocument();
  });

  it('enables sorting for a flat file list', () => {
    const { container } = render(<FilesTab task={flatTask()} />);

    for (const label of ['File Name', 'Progress', 'File Size']) {
      expect(button(container, label)).not.toBeDisabled();
    }
  });

  it('disables sorting for a multi-directory task', () => {
    const { container } = render(<FilesTab task={treeTask()} />);

    for (const label of ['File Name', 'Progress', 'File Size']) {
      expect(button(container, label)).toBeDisabled();
    }
  });

  it('sorts by file name on the first click and reverses on the second', () => {
    const { container } = render(<FilesTab task={flatTask()} />);

    fireEvent.click(button(container, 'File Name'));
    expect(useSettingsStore.getState().settings.fileListDisplayOrder).toBe('name:asc');

    const ascending = [...container.querySelectorAll('[data-node-kind="file"]')].map((row) =>
      row.textContent?.trim(),
    );
    expect(ascending[0]).toContain('one.mp4');
    expect(ascending[2]).toContain('two.mp4');

    fireEvent.click(button(container, 'File Name'));
    expect(useSettingsStore.getState().settings.fileListDisplayOrder).toBe('name:desc');

    const descending = [...container.querySelectorAll('[data-node-kind="file"]')].map((row) =>
      row.textContent?.trim(),
    );
    expect(descending[0]).toContain('two.mp4');
  });

  it('never touches the setting for a multi-directory task', () => {
    setOrder('default:asc');
    const { container } = render(<FilesTab task={treeTask()} />);

    fireEvent.click(button(container, 'File Name'));
    expect(useSettingsStore.getState().settings.fileListDisplayOrder).toBe('default:asc');
  });

  it('sorts by progress descending through the Progress header', () => {
    const files = [file(0, 'a.mp4', false), file(1, 'b.mp4', true), file(2, 'c.mp4', true)];
    const task = makeTask({ files, fileTree: files.map((entry) => ({ ...entry, isDir: false as const })) });
    const { container } = render(<FilesTab task={task} />);

    fireEvent.click(button(container, 'Progress'));
    expect(useSettingsStore.getState().settings.fileListDisplayOrder).toBe('percent:desc');

    const order = [...container.querySelectorAll('[data-node-kind="file"]')].map((row) =>
      row.textContent?.trim(),
    );
    expect(order[0]).toContain('b.mp4');
    expect(order[2]).toContain('a.mp4');
  });
});

/* ------------------------------------------------------------------ */
/* choose-files link                                                   */
/* ------------------------------------------------------------------ */

describe('FilesTab — (Choose Files) link', () => {
  const query = (container: HTMLElement): HTMLElement | null =>
    container.querySelector('button[aria-label="(Choose Files)"]');

  it('appears for a multi-file waiting task', () => {
    const { container } = render(<FilesTab task={flatTask('waiting')} />);
    expect(query(container)).not.toBeNull();
  });

  it('appears for a multi-file paused task', () => {
    const { container } = render(<FilesTab task={flatTask('paused')} />);
    expect(query(container)).not.toBeNull();
  });

  it.each(['active', 'complete', 'error', 'removed'])('is hidden while %s', (status) => {
    const { container } = render(<FilesTab task={flatTask(status)} />);
    expect(query(container)).toBeNull();
  });

  it('is hidden for a single-file task', () => {
    const only = file(0, 'only.mp4', true);
    const { container } = render(
      <FilesTab task={makeTask({ files: [only], fileTree: [{ ...only, isDir: false }] })} />,
    );
    expect(query(container)).toBeNull();
  });

  it('toggles the toolbar open and closed', () => {
    const { container } = render(<FilesTab task={flatTask()} />);
    const link = () => container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement;

    fireEvent.click(link());
    expect(container.querySelector('.ariang-choose-files-bar')).not.toBeNull();

    fireEvent.click(link());
    expect(container.querySelector('.ariang-choose-files-bar')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* toolbar: select all / none / invert                                  */
/* ------------------------------------------------------------------ */

describe('FilesTab — Select All / None / Invert', () => {
  function open(task = flatTask()): HTMLElement {
    const { container } = render(<FilesTab task={task} />);
    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    return container;
  }

  function isChecked(container: HTMLElement, label: string): boolean {
    return (checkboxOf(container, label) as unknown as { checked: boolean }).checked;
  }

  it('Select All marks every file', () => {
    const container = open();
    fireEvent.click(selectToggle(container));

    expect(isChecked(container, 'one.mp4')).toBe(true);
    expect(isChecked(container, 'two.mp4')).toBe(true);
    expect(isChecked(container, 'pack.zip')).toBe(true);
  });

  it('Select None clears every file', () => {
    const container = open();
    fireEvent.click(selectToggle(container));
    fireEvent.click(selectToggle(container));

    for (const name of ['one.mp4', 'two.mp4', 'pack.zip']) {
      expect(isChecked(container, name)).toBe(false);
    }
  });

  it('Select Invert flips every file', () => {
    const container = open();
    // one.mp4 / two.mp4 start selected, pack.zip does not.
    fireEvent.click(selectMenuItem('Select Invert'));

    expect(isChecked(container, 'one.mp4')).toBe(false);
    expect(isChecked(container, 'two.mp4')).toBe(false);
    expect(isChecked(container, 'pack.zip')).toBe(true);
  });

  it('relabels the toggle button when everything is selected', () => {
    const container = open();

    // Not everything is selected (pack.zip is not) -> the toggle offers All.
    expect(selectToggle(container).textContent?.trim()).toBe('Select All');

    fireEvent.click(selectToggle(container));
    expect(selectToggle(container).textContent?.trim()).toBe('Select None');

    fireEvent.click(selectToggle(container));
    expect(selectToggle(container).textContent?.trim()).toBe('Select All');
  });

  it('does not touch aria2 while the toolbar is open', () => {
    const container = open();
    fireEvent.click(selectToggle(container));
    expect(selectFileMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* toolbar: category filtering                                         */
/* ------------------------------------------------------------------ */

describe('FilesTab — category buttons', () => {
  function open(): HTMLElement {
    const { container } = render(<FilesTab task={flatTask()} />);
    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    return container;
  }

  function isChecked(container: HTMLElement, label: string): boolean {
    return (checkboxOf(container, label) as unknown as { checked: boolean }).checked;
  }

  it('offers a button per category present in the task', () => {
    const container = open();
    // mp4 -> Videos, zip -> Archives; nothing else is in the torrent.
    expect(toolbarButton(container, 'Videos')).toBeInTheDocument();
    expect(toolbarButton(container, 'Archives')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Audios');
    expect(container.textContent).not.toContain('Documents');
  });

  it('selects the whole category when it is not fully selected', () => {
    const container = open();
    fireEvent.click(toolbarButton(container, 'Archives'));

    expect(isChecked(container, 'pack.zip')).toBe(true);
    // The other category is untouched.
    expect(isChecked(container, 'one.mp4')).toBe(true);
  });

  it('clears the category when every file of it is already selected', () => {
    const container = open();
    // one.mp4 and two.mp4 start selected, so the whole Videos category is.
    expect(isChecked(container, 'one.mp4')).toBe(true);

    fireEvent.click(toolbarButton(container, 'Videos'));
    expect(isChecked(container, 'one.mp4')).toBe(false);
    expect(isChecked(container, 'two.mp4')).toBe(false);
    // Archives untouched.
    expect(isChecked(container, 'pack.zip')).toBe(false);

    // A third press restores them.
    fireEvent.click(toolbarButton(container, 'Videos'));
    expect(isChecked(container, 'one.mp4')).toBe(true);
    expect(isChecked(container, 'two.mp4')).toBe(true);
  });

  it('always offers the Custom dialog button', () => {
    const container = open();
    expect(toolbarButton(container, 'Custom')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* Confirm                                                             */
/* ------------------------------------------------------------------ */

describe('FilesTab — Confirm', () => {
  function open(task = flatTask()): HTMLElement {
    const { container } = render(<FilesTab task={task} />);
    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    return container;
  }

  it('is disabled while nothing is selected', () => {
    const none = [file(0, 'a.mp4', false), file(1, 'b.mp4', false)];
    const container = open(
      makeTask({ files: none, fileTree: none.map((entry) => ({ ...entry, isDir: false as const })), selectedFileCount: 0 }),
    );

    expect(toolbarButton(container, 'Confirm')).toHaveProperty('disabled', true);
  });

  it('becomes enabled as soon as one file is selected', () => {
    const container = open();
    fireEvent.click(selectToggle(container));

    expect(toolbarButton(container, 'Confirm')).toHaveProperty('disabled', false);
  });

  it('pushes the 1-based, ascending aria2 indexes', () => {
    const container = open();
    fireEvent.click(selectMenuItem('Select Invert'));
    fireEvent.click(toolbarButton(container, 'Confirm'));

    // Inverted: only index 3 (pack.zip) remains selected.
    expect(selectFileMock).toHaveBeenCalledWith('gid-files', [3]);
  });

  it('sends an empty list when nothing is selected', () => {
    const container = open();
    fireEvent.click(selectToggle(container));
    // Second press clears everything, which disables Confirm again.
    fireEvent.click(selectToggle(container));

    expect(toolbarButton(container, 'Confirm')).toHaveProperty('disabled', true);
    expect(selectFileMock).not.toHaveBeenCalled();
  });

  it('closes the toolbar and asks for a refresh', () => {
    const onRequestRefresh = vi.fn();
    const { container } = render(<FilesTab task={flatTask()} onRequestRefresh={onRequestRefresh} />);
    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    fireEvent.click(toolbarButton(container, 'Confirm'));

    expect(container.querySelector('.ariang-choose-files-bar')).toBeNull();
    expect(onRequestRefresh).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Cancel                                                              */
/* ------------------------------------------------------------------ */

describe('FilesTab — Cancel', () => {
  it('discards the local edits, resumes polling and refreshes', () => {
    const onRequestRefresh = vi.fn();
    const onPollingPauseChange = vi.fn();
    const { container } = render(
      <FilesTab task={flatTask()} onRequestRefresh={onRequestRefresh} onPollingPauseChange={onPollingPauseChange} />,
    );

    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    fireEvent.click(selectMenuItem('Select Invert'));
    expect((checkboxOf(container, 'pack.zip') as unknown as { checked: boolean }).checked).toBe(true);

    fireEvent.click(toolbarButton(container, 'Cancel'));

    // Back to aria2's state, and the toolbar is gone.
    expect((checkboxOf(container, 'pack.zip') as unknown as { checked: boolean }).checked).toBe(false);
    expect(container.querySelector('.ariang-choose-files-bar')).toBeNull();
    expect(onRequestRefresh).toHaveBeenCalled();
    // Never pushed while the toolbar owned the selection.
    expect(selectFileMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* polling latch                                                       */
/* ------------------------------------------------------------------ */

describe('FilesTab — polling latch', () => {
  it('is raised while the choose-files toolbar is open', () => {
    expect(isFileSelectionActive()).toBe(false);

    const { container } = render(<FilesTab task={flatTask()} />);
    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);

    expect(isFileSelectionActive()).toBe(true);

    fireEvent.click(toolbarButton(container, 'Cancel'));

    expect(isFileSelectionActive()).toBe(false);
  });

  it('notifies the owner and is cleared on unmount', () => {
    const onPollingPauseChange = vi.fn();
    const { container, unmount } = render(
      <FilesTab task={flatTask()} onPollingPauseChange={onPollingPauseChange} />,
    );

    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    expect(onPollingPauseChange).toHaveBeenLastCalledWith(true);

    // Confirm closes the toolbar.
    fireEvent.click(toolbarButton(container, 'Confirm'));
    expect(onPollingPauseChange).toHaveBeenLastCalledWith(false);
    expect(isFileSelectionActive()).toBe(false);

    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    expect(isFileSelectionActive()).toBe(true);

    // Unmounting must never leave the latch set, or polling would stay dead.
    unmount();
    expect(isFileSelectionActive()).toBe(false);
  });

  it('has no choose-files toolbar at all for a single-file task', () => {
    const only = file(0, 'only.mp4', true);
    const { container } = render(<FilesTab task={makeTask({ files: [only] })} />);

    expect(container.querySelector('button[aria-label="(Choose Files)"]')).toBeNull();
    expect(isFileSelectionActive()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* disabled checkboxes                                                 */
/* ------------------------------------------------------------------ */

describe('FilesTab — checkbox availability', () => {
  it('disables every checkbox while the task is active', () => {
    const { container } = render(<FilesTab task={flatTask('active')} />);

    for (const name of ['one.mp4', 'two.mp4', 'pack.zip']) {
      expect(checkboxOf(container, name)).toHaveProperty('disabled', true);
    }
  });

  it('enables the checkboxes for a waiting or paused task', () => {
    const { container } = render(<FilesTab task={flatTask('waiting')} />);

    expect(checkboxOf(container, 'one.mp4')).toHaveProperty('disabled', false);
  });
});

/* ------------------------------------------------------------------ */
/* immediate push while the toolbar is closed                          */
/* ------------------------------------------------------------------ */

describe('FilesTab — immediate select-file', () => {
  it('pushes on every checkbox click when the toolbar is closed', () => {
    const { container } = render(<FilesTab task={flatTask()} />);

    toggleCheckbox(checkboxOf(container, 'pack.zip'), true);

    // aria2 indexes are 1-based and ascending; pack.zip is index 3.
    expect(selectFileMock).toHaveBeenCalledWith('gid-files', [1, 2, 3]);
  });

  it('never mutates the task object', () => {
    const task = flatTask();
    const before = JSON.stringify(task);
    const { container } = render(<FilesTab task={task} />);

    fireEvent.click(container.querySelector('button[aria-label="(Choose Files)"]') as HTMLElement);
    fireEvent.click(selectMenuItem('Select Invert'));

    expect(JSON.stringify(task)).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/* tri-state directory checkbox                                        */
/* ------------------------------------------------------------------ */

describe('FilesTab — directory rows', () => {
  it('renders the directory row before its file and indents both', () => {
    const { container } = render(<FilesTab task={treeTask()} />);

    const directoryRow = rowOf(container, 'season');
    const fileRow = rowOf(container, 'episode.mkv');

    expect(directoryRow.dataset.nodeKind).toBe('dir');
    expect(fileRow.dataset.nodeKind).toBe('file');

    const dirIndent = (directoryRow.querySelector('.ariang-cell-name') as HTMLElement).style.paddingInlineStart;
    const fileIndent = (fileRow.querySelector('.ariang-cell-name') as HTMLElement).style.paddingInlineStart;

    // Directory: level * 16px = 0. File: 11 + 6 + level * 16px = 33.
    expect(dirIndent).toBe('0px');
    expect(fileIndent).toBe('33px');
  });

  it('reports the rolled-up tri-state on the directory checkbox', () => {
    const { container } = render(<FilesTab task={treeTask()} />);

    const checkbox = checkboxOf(container, 'season') as unknown as {
      checked: boolean;
      indeterminate: boolean;
    };

    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(false);
  });

  it('becomes indeterminate once only some descendants are selected', () => {
    const episode = { ...file(0, 'episode.mkv', false), isDir: false as const, relativePath: 'season', level: 1 };
    const second = { ...file(1, 'extra.mkv', true), isDir: false as const, relativePath: 'season', level: 1 };
    const directory = dir(-1, 'season', 'season', [episode, second], [], 0);

    const { container } = render(
      <FilesTab
        task={makeTask({ multiDir: true, files: [directory] as unknown as FileTypeInfo[], fileTree: [directory, episode, second], selectedFileCount: 1 })}
      />,
    );

    const checkbox = checkboxOf(container, 'season') as unknown as {
      checked: boolean;
      indeterminate: boolean;
    };

    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(true);
  });

  it('clears the whole subtree when a fully-selected directory is toggled off', () => {
    const { container } = render(<FilesTab task={treeTask()} />);

    toggleCheckbox(checkboxOf(container, 'season'), false);

    const directory = checkboxOf(container, 'season') as unknown as { checked: boolean };
    const file = checkboxOf(container, 'episode.mkv') as unknown as { checked: boolean };

    expect(directory.checked).toBe(false);
    expect(file.checked).toBe(false);
    expect(selectFileMock).toHaveBeenCalledWith('gid-files', []);
  });

  it('offers Expand All / Collapse All in the context menu instead of the sort order', () => {
    const { container } = render(<FilesTab task={treeTask()} />);

    fireEvent.contextMenu(rowOf(container, 'episode.mkv'));

    expect(screen.getByText('Expand All')).toBeInTheDocument();
    expect(screen.getByText('Collapse All')).toBeInTheDocument();
    // No Display Order entries — sorting is meaningless for a tree.
    expect(screen.queryByText('By File Name')).toBeNull();
  });

  it('collapses and expands a directory', () => {
    const { container } = render(<FilesTab task={treeTask()} />);

    const toggle = rowOf(container, 'season').querySelector('button') as HTMLElement;
    fireEvent.click(toggle);

    // The row is collapsed, so its file disappears.
    expect(container.querySelector('[data-node-kind="file"]')).toBeNull();
    expect(rowOf(container, 'season')).toBeInTheDocument();

    fireEvent.click(rowOf(container, 'season').querySelector('button') as HTMLElement);
    expect(rowOf(container, 'episode.mkv')).toBeInTheDocument();
  });

  it('offers the Display Order submenu for a flat list', () => {
    const { container } = render(<FilesTab task={flatTask()} />);

    fireEvent.contextMenu(rowOf(container, 'one.mp4'));

    for (const label of ['Default', 'By File Name', 'By Progress', 'By File Size', 'By Selected Status']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('Expand All')).toBeNull();
  });

  it('applies a context-menu order without toggling the direction', () => {
    setOrder('name:desc');
    const { container } = render(<FilesTab task={flatTask()} />);

    fireEvent.contextMenu(rowOf(container, 'one.mp4'));
    fireEvent.click(screen.getByText('By Progress'));

    // 'percent:desc' is explicit in the menu, so `autoSetReverse` must not flip it.
    expect(useSettingsStore.getState().settings.fileListDisplayOrder).toBe('percent:desc');
  });
});

/* ------------------------------------------------------------------ */
/* the immutable subtree rewrite                                       */
/* ------------------------------------------------------------------ */

describe('withIndexesSelection', () => {
  function fixture(): FileTreeNode[] {
    const a = { ...file(0, 'a.mkv', true), isDir: false as const, relativePath: 'x/y', level: 2 };
    const b = { ...file(1, 'b.mkv', true), isDir: false as const, relativePath: 'x/y', level: 2 };
    const c = { ...file(2, 'c.mkv', false), isDir: false as const, relativePath: 'x', level: 1 };
    const y = dir(-1, 'x/y', 'y', [a, b], [], 1);
    const x = dir(-1, 'x', 'x', [c], [y], 0);

    return [x, y, a, b, c];
  }

  it('re-rolls the directory aggregates', () => {
    const rows = fixture();
    const next = withIndexesSelection(rows, new Set([1]), false);

    expect(next).not.toBe(rows);

    // File 0 is gone from the selection, so `x/y` is neither full nor empty.
    const inner = next.find((node): node is DirectoryNode => node.isDir && node.nodePath === 'x/y');
    expect(inner?.selected).toBe(false);
    expect(inner?.partialSelected).toBe(true);

    // `x` still holds `c` (unselected) and the now-partial `y`.
    const outer = next.find((node): node is DirectoryNode => node.isDir && node.nodePath === 'x');
    expect(outer?.partialSelected).toBe(true);
  });

  it('shares untouched subtrees by reference', () => {
    const rows = fixture();
    const next = withIndexesSelection(rows, new Set([1]), false);

    // `c` lives directly in `x` and was not touched.
    const c = next.find((node) => !node.isDir && node.fileName === 'c.mkv');
    expect(c).toBe(rows.find((node) => !node.isDir && node.fileName === 'c.mkv'));
  });

  it('never mutates the input', () => {
    const rows = fixture();
    const snapshot = JSON.stringify(rows);
    withIndexesSelection(rows, new Set([1, 2, 3]), true);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it('is a no-op for an empty index set', () => {
    const rows = fixture();
    expect(withIndexesSelection(rows, new Set(), true)).toEqual(rows);
  });
});