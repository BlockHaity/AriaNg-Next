/**
 * `TaskTable` tests: the column grid, the sortable header and the three empty
 * states.
 *
 * The sort assertions deliberately go through the **settings store** rather than
 * through the table's props, because that is the half of AriaNg's behaviour that
 * is easy to get wrong: `waiting` / `stopped` only get their own display-order key
 * when `taskListIndependentDisplayOrder` is on, and `downloading` always shares the
 * global `displayOrder`.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { Aria2File, Aria2TaskStatusResult } from '@/rpc/types';
import { normalizeTask } from '@/domain/normalize';
import type { NormalizedTask } from '@/domain/types';
import type { AriaNgSettings, DisplayOrder } from '@/config/types';
import { DEFAULT_SETTINGS, createDefaultSettings } from '@/config/defaults';
import { useSettingsStore } from '@/store/settings';
import { useSelectionStore } from '@/store/selection';
import { useTasksStore } from '@/store/tasks';
import { i18n } from '@/i18n';
import { TaskTable } from '../task-list/TaskTable';
import { TaskRowHeader, nextOrderForHeader } from '../task-list/TaskRowHeader';
import { TaskListToolbar, DISPLAY_ORDER_ENTRIES } from '../task-list/TaskListToolbar';
import { TaskContextMenu, magnetLinkFor } from '../task-list/TaskContextMenu';
import { EmptyState } from '../task-list/EmptyState';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function file(index: number, name: string): Aria2File {
  return {
    index: String(index),
    path: `/downloads/${name}`,
    length: '1048576',
    completedLength: '0',
    selected: 'true',
    uris: [{ uri: `http://example.test/${name}` }],
  } as Aria2File;
}

function makeTask(gid: string, name: string, overrides: Partial<Aria2TaskStatusResult> = {}): NormalizedTask {
  return normalizeTask({
    gid,
    status: 'active',
    totalLength: '1048576',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '1024',
    uploadSpeed: '0',
    connections: '1',
    numSeeders: '0',
    dir: '/downloads',
    files: [file(1, name)],
    ...overrides,
  } as Aria2TaskStatusResult);
}

/** Puts a task list straight into the store, the way a refresh would. */
function seedList(tasks: NormalizedTask[]): void {
  useTasksStore.setState({ list: tasks, byGid: {}, searchText: '', loading: false, error: undefined });
}

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  await i18n.ready();
});

beforeEach(() => {
  useTasksStore.setState({
    list: [],
    byGid: {},
    searchText: '',
    loading: false,
    error: undefined,
    page: 'downloading',
  });
  useSelectionStore.setState({ selected: {}, enabled: false });
  useSettingsStore.setState({ settings: createDefaultSettings(), hydrated: false });
});

/* ------------------------------------------------------------------ */
/* columns                                                             */
/* ------------------------------------------------------------------ */

describe('TaskTable columns', () => {
  it('renders AriaNg\'s three column groups plus the chevron on every row', () => {
    seedList([makeTask('a', 'a.iso'), makeTask('b', 'b.iso')]);
    const { container } = render(<TaskTable kind="downloading" />);

    const rows = container.querySelectorAll('[data-testid="task-row"]');
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      // group A: name + file size
      expect(row.querySelector('.task-cell--main .task-name')).not.toBeNull();
      expect(row.querySelector('.task-cell--main .task-size')).not.toBeNull();
      // group B: progress + remaining
      expect(row.querySelector('.task-cell--progress [role="progressbar"]')).not.toBeNull();
      expect(row.querySelector('.task-cell--progress .task-last-time')).not.toBeNull();
      // group C: download speed
      expect(row.querySelector('.task-cell--speed .task-download-speed')).not.toBeNull();
      // trailing chevron
      expect(row.querySelector('.task-cell--chevron .task-right-arrow')).not.toBeNull();
    }
  });

  it('applies the search filter before sorting', () => {
    seedList([makeTask('a', 'alpha.iso'), makeTask('b', 'beta.iso')]);
    useTasksStore.setState({ searchText: 'beta' });

    const { container } = render(<TaskTable kind="downloading" />);
    const rows = container.querySelectorAll('[data-testid="task-row"]');

    expect(rows).toHaveLength(1);
    expect((rows[0] as HTMLElement).getAttribute('data-gid')).toBe('b');
  });

  it('exposes the grid to assistive technology', () => {
    seedList([makeTask('a', 'a.iso'), makeTask('b', 'b.iso')]);
    const { container } = render(<TaskTable kind="downloading" />);

    const grid = container.querySelector('[role="grid"]') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.getAttribute('aria-rowcount')).toBe('2');
  });

  it('does not enable dragging outside /waiting', () => {
    seedList([makeTask('a', 'a.iso')]);
    const { container } = render(<TaskTable kind="downloading" />);
    expect(container.querySelector('.task-drag-handle')).toBeNull();
  });

  it('enables dragging on /waiting with the default order', () => {
    seedList([makeTask('a', 'a.iso')]);
    const { container } = render(<TaskTable kind="waiting" />);
    expect(container.querySelector('.task-drag-handle')).not.toBeNull();
  });

  it('disables dragging on /waiting once another order type is active', () => {
    seedList([makeTask('a', 'a.iso')]);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, displayOrder: 'name:asc' } });

    const { container } = render(<TaskTable kind="waiting" />);
    expect(container.querySelector('.task-drag-handle')).toBeNull();
  });

  it('disables dragging when the setting is off', () => {
    seedList([makeTask('a', 'a.iso')]);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, dragAndDropTasks: false } });

    const { container } = render(<TaskTable kind="waiting" />);
    expect(container.querySelector('.task-drag-handle')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* the sortable header                                                 */
/* ------------------------------------------------------------------ */

describe('TaskRowHeader', () => {
  it('renders the five sortable column names', () => {
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskTable kind="downloading" />);

    const header = screen.getByRole('columnheader', { name: /File Name/ }).closest(
      '[role="row"]',
    ) as HTMLElement;

    for (const label of ['File Name', 'File Size', 'Progress', 'Remaining', 'Download Speed']) {
      expect(within(header).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(header.querySelectorAll('[role="columnheader"]')).toHaveLength(6); // 5 + the chevron slot
  });

  it('marks the active column with aria-sort and the others with none', () => {
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskTable kind="downloading" />);

    const cells = Array.from(document.querySelectorAll('[role="columnheader"]'));
    const byLabel = (text: string) =>
      cells.find((cell) => cell.textContent?.includes(text)) as HTMLElement;

    // The default display order is `default:asc`, so no column is sorted.
    for (const text of ['File Name', 'File Size', 'Progress', 'Remaining', 'Download Speed']) {
      expect(byLabel(text).getAttribute('aria-sort')).toBe('none');
    }
  });

  it('reflects the current order in aria-sort', () => {
    seedList([makeTask('a', 'a.iso')]);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, displayOrder: 'percent:desc' } });
    render(<TaskTable kind="downloading" />);

    const cells = Array.from(document.querySelectorAll('[role="columnheader"]'));
    const progress = cells.find((cell) => cell.textContent?.includes('Progress')) as HTMLElement;
    const name = cells.find((cell) => cell.textContent?.includes('File Name')) as HTMLElement;

    expect(progress.getAttribute('aria-sort')).toBe('descending');
    expect(name.getAttribute('aria-sort')).toBe('none');
  });
});

describe('clicking a header', () => {
  const order = () => useSettingsStore.getState().settings.displayOrder;

  it('applies the header\'s own default direction for a new type', () => {
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskTable kind="downloading" />);

    // `name:asc` — a brand new sort starts ascending.
    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));
    expect(order()).toBe('name:asc');

    // `percent:desc` — Progress defaults to descending.
    fireEvent.click(screen.getByRole('button', { name: /Progress/ }));
    expect(order()).toBe('percent:desc');

    // `dspeed:desc` — Download Speed also defaults to descending.
    fireEvent.click(screen.getByRole('button', { name: /Download Speed/ }));
    expect(order()).toBe('dspeed:desc');
  });

  it('flips the direction when the same type is clicked again', () => {
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskTable kind="downloading" />);

    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));
    expect(order()).toBe('name:asc');

    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));
    expect(order()).toBe('name:desc');

    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));
    expect(order()).toBe('name:asc');
  });

  it('flips away from a direction that came from the toolbar, not from the header', () => {
    // AriaNg's `autoSetReverse` compares against the *current* direction, so a
    // `percent:asc` set elsewhere flips to `desc` on the first header click.
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, displayOrder: 'percent:asc' } });
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskTable kind="downloading" />);

    fireEvent.click(screen.getByRole('button', { name: /Progress/ }));
    expect(order()).toBe('percent:desc');
  });

  it('re-sorts the rendered rows', () => {
    seedList([
      makeTask('a', 'charlie.iso'),
      makeTask('b', 'alpha.iso'),
      makeTask('c', 'bravo.iso'),
    ]);
    render(<TaskTable kind="downloading" />);

    const gids = () =>
      Array.from(document.querySelectorAll('[data-testid="task-row"]')).map((row) =>
        row.getAttribute('data-gid'),
      );

    expect(gids()).toEqual(['a', 'b', 'c']);

    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));
    expect(gids()).toEqual(['b', 'c', 'a']);
  });

  it('computes the next order without touching the store', () => {
    // The pure rule, pinned separately from the click wiring.
    expect(nextOrderForHeader('name', 'default:asc')).toBe('name:asc');
    expect(nextOrderForHeader('name', 'name:asc')).toBe('name:desc');
    expect(nextOrderForHeader('name', 'name:desc')).toBe('name:asc');
    expect(nextOrderForHeader('percent', 'default:asc')).toBe('percent:desc');
    expect(nextOrderForHeader('percent', 'percent:desc')).toBe('percent:asc');
    expect(nextOrderForHeader('dspeed', 'size:asc')).toBe('dspeed:desc');
    expect(nextOrderForHeader('remain', 'name:desc')).toBe('remain:asc');
  });
});

/* ------------------------------------------------------------------ */
/* where the order is persisted                                        */
/* ------------------------------------------------------------------ */

describe('display-order key switching', () => {
  const settings = (): AriaNgSettings => useSettingsStore.getState().settings;

  it('always shares the global displayOrder for /downloading', () => {
    const initial: DisplayOrder = 'default:asc';
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, displayOrder: initial, taskListIndependentDisplayOrder: false },
    });
    seedList([makeTask('a', 'a.iso')]);

    render(<TaskTable kind="downloading" />);
    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));

    expect(settings().displayOrder).toBe('name:asc');
    expect(settings().waitingTaskListPageDisplayOrder).toBe(DEFAULT_SETTINGS.waitingTaskListPageDisplayOrder);
  });

  it('gives /waiting its own key once independent display order is on', () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        displayOrder: 'default:asc',
        taskListIndependentDisplayOrder: true,
      },
    });
    seedList([makeTask('a', 'a.iso')]);

    render(<TaskTable kind="waiting" />);
    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));

    expect(settings().waitingTaskListPageDisplayOrder).toBe('name:asc');
    // The shared key is untouched, so /downloading keeps its own order.
    expect(settings().displayOrder).toBe('default:asc');
  });

  it('gives /stopped its own key once independent display order is on', () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        displayOrder: 'default:asc',
        taskListIndependentDisplayOrder: true,
      },
    });
    seedList([makeTask('a', 'a.iso')]);

    render(<TaskTable kind="stopped" />);
    fireEvent.click(screen.getByRole('button', { name: /Progress/ }));

    expect(settings().stoppedTaskListPageDisplayOrder).toBe('percent:desc');
    expect(settings().displayOrder).toBe('default:asc');
  });

  it('falls back to the shared key when independent display order is off', () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        displayOrder: 'default:asc',
        taskListIndependentDisplayOrder: false,
        waitingTaskListPageDisplayOrder: 'name:desc',
      },
    });
    seedList([makeTask('a', 'a.iso')]);

    render(<TaskTable kind="waiting" />);
    fireEvent.click(screen.getByRole('button', { name: /File Size/ }));

    expect(settings().displayOrder).toBe('size:asc');
    expect(settings().waitingTaskListPageDisplayOrder).toBe('name:desc');
  });

  it('renders with the page\'s own order once it has one', () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        displayOrder: 'default:asc',
        taskListIndependentDisplayOrder: true,
        waitingTaskListPageDisplayOrder: 'name:desc',
      },
    });
    seedList([makeTask('a', 'charlie.iso'), makeTask('b', 'alpha.iso')]);

    const { container } = render(<TaskTable kind="waiting" />);
    const name = Array.from(container.querySelectorAll('[role="columnheader"]')).find((cell) =>
      cell.textContent?.includes('File Name'),
    ) as HTMLElement;

    expect(name.getAttribute('aria-sort')).toBe('descending');
  });
});

/* ------------------------------------------------------------------ */
/* the empty states                                                    */
/* ------------------------------------------------------------------ */

describe('TaskTable empty states', () => {
  it('shows the "no tasks" state for an empty list', () => {
    seedList([]);
    const { container } = render(<TaskTable kind="downloading" />);
    const state = container.querySelector('[data-testid="task-empty-state"]') as HTMLElement;

    expect(state).not.toBeNull();
    expect(state.getAttribute('data-variant')).toBe('empty');
    expect(state).toHaveTextContent('No Data');
  });

  it('shows the "no matches" state when the filter hides everything', () => {
    seedList([makeTask('a', 'alpha.iso')]);
    useTasksStore.setState({ searchText: 'zzz-nothing-matches' });

    const { container } = render(<TaskTable kind="downloading" />);
    const state = container.querySelector('[data-testid="task-empty-state"]') as HTMLElement;

    expect(state.getAttribute('data-variant')).toBe('search');
    expect(state).toHaveTextContent('zzz-nothing-matches');
  });

  it('shows the "not connected" state when the last refresh failed', () => {
    seedList([]);
    const { container } = render(<TaskTable kind="downloading" error="Cannot connect to aria2!" />);
    const state = container.querySelector('[data-testid="task-empty-state"]') as HTMLElement;

    expect(state.getAttribute('data-variant')).toBe('disconnected');
    expect(state).toHaveTextContent('Cannot connect to aria2!');
  });

  it('shows the spinner only on the first load', () => {
    seedList([]);
    const { container, rerender } = render(<TaskTable kind="downloading" initialLoading />);
    expect(container.querySelector('[data-testid="task-table-loading"]')).not.toBeNull();

    rerender(<TaskTable kind="downloading" initialLoading={false} />);
    expect(container.querySelector('[data-testid="task-table-loading"]')).toBeNull();
  });

  it('renders each EmptyState variant directly', () => {
    const { container, rerender } = render(<EmptyState variant="empty" pageLabel="Downloading" />);
    expect(container.querySelector('[data-variant="empty"]')).toHaveTextContent('Downloading');

    rerender(<EmptyState variant="search" searchText="foo" />);
    expect(container.querySelector('[data-variant="search"]')).toHaveTextContent('foo');

    rerender(<EmptyState variant="disconnected" />);
    expect(container.querySelector('[data-variant="disconnected"]')).toHaveTextContent('Cannot connect to aria2!');
  });
});

/* ------------------------------------------------------------------ */
/* toolbar + context menu                                              */
/* ------------------------------------------------------------------ */

describe('TaskListToolbar', () => {
  it('offers all seven display-order entries', () => {
    seedList([makeTask('a', 'a.iso')]);
    const { container } = render(<TaskListToolbar kind="downloading" />);

    // The dropdown panel is only mounted while it is open, so the canonical list
    // is asserted directly and the trigger is spot-checked in the DOM.
    expect(DISPLAY_ORDER_ENTRIES.map((entry) => entry.label)).toEqual([
      'Default',
      'By File Name',
      'By File Size',
      'By Progress',
      'By Remaining',
      'By Download Speed',
      'By Upload Speed',
    ]);
    expect(DISPLAY_ORDER_ENTRIES.map((entry) => entry.type)).toEqual([
      'default',
      'name',
      'size',
      'percent',
      'remain',
      'dspeed',
      'uspeed',
    ]);

    const trigger = container.querySelector('mdui-dropdown mdui-button') as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain('Display Order');
  });

  it('shows the three select-all toggles and disables them on an empty list', () => {
    seedList([]);
    render(<TaskListToolbar kind="downloading" />);

    // React 19 assigns custom-element props as *properties*, which is what Lit's
    // reactive accessors want — so `disabled` is read off the element, not off
    // `getAttribute`.
    for (const label of ['Select All Tasks', 'Select All Failed Tasks', 'Select All Completed Tasks']) {
      const chip = screen.getByText(label).closest('mdui-chip') as HTMLElement & { disabled: boolean };
      expect(chip).not.toBeNull();
      expect(chip.disabled).toBe(true);
    }
  });

  it('disables Delete with nothing selected', () => {
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskListToolbar kind="downloading" />);

    const remove = screen.getByText('Delete').closest('mdui-button') as HTMLElement & { disabled: boolean };
    expect(remove.disabled).toBe(true);
  });

  it('enables Delete with a selection', () => {
    seedList([makeTask('a', 'a.iso')]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskListToolbar kind="downloading" />);
    const remove = screen.getByText('Delete').closest('mdui-button') as HTMLElement & { disabled: boolean };
    expect(remove.disabled).toBe(false);
  });

  it('disables Clear Stopped Tasks while nothing terminal is visible', () => {
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskListToolbar kind="downloading" />);

    const clear = screen
      .getByText('Clear Stopped Tasks')
      .closest('mdui-button') as HTMLElement & { disabled: boolean };
    expect(clear.disabled).toBe(true);
  });

  it('enables Clear Stopped Tasks once a completed task is visible', () => {
    seedList([makeTask('b', 'b.iso', { status: 'complete' })]);
    render(<TaskListToolbar kind="stopped" />);

    const clear = screen
      .getByText('Clear Stopped Tasks')
      .closest('mdui-button') as HTMLElement & { disabled: boolean };
    expect(clear.disabled).toBe(false);
  });
});

describe('TaskContextMenu visibility', () => {
  /** Every item's text, flattened — the menu has no ARIA roles in jsdom. */
  const labels = () =>
    Array.from(document.querySelectorAll('mdui-menu > mdui-menu-item')).map((node) => node.textContent ?? '');

  it('offers only Select All and Display Order with nothing selected', () => {
    seedList([makeTask('a', 'a.iso')]);
    render(<TaskContextMenu kind="downloading" />);

    const text = labels().join('|');
    expect(text).toContain('Select All');
    expect(text).toContain('Display Order');
    expect(text).not.toContain('Start');
    expect(text).not.toContain('Pause');
    expect(text).not.toContain('Delete');
    expect(text).not.toContain('Retry Selected Tasks');
    expect(text).not.toContain('Copy');
  });

  it('offers Start for a paused selection', () => {
    seedList([makeTask('a', 'a.iso', { status: 'paused' })]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskContextMenu kind="downloading" />);
    const text = labels().join('|');

    expect(text).toContain('Start');
    // A paused task is not pausable, so Pause must stay away.
    expect(text).not.toContain('Pause');
    expect(text).toContain('Delete');
  });

  it('offers Pause for an active selection', () => {
    seedList([makeTask('a', 'a.iso')]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskContextMenu kind="downloading" />);
    const text = labels().join('|');

    expect(text).toContain('Pause');
    expect(text).not.toContain('Start');
    expect(text).toContain('Delete');
  });

  it('hides Retry Selected Tasks when only some selected tasks are retryable', () => {
    seedList([makeTask('a', 'a.iso', { status: 'error', errorCode: '3' }), makeTask('b', 'b.iso')]);
    useSelectionStore.setState({ selected: { a: true, b: true } });

    render(<TaskContextMenu kind="downloading" />);
    expect(labels().join('|')).not.toContain('Retry Selected Tasks');
  });

  it('shows Retry Selected Tasks when every selected task is retryable', () => {
    // `isTaskRetryable` also needs a known error description.
    seedList([{ ...makeTask('a', 'a.iso', { status: 'error', errorCode: '3' }), errorDescription: 'boom' }]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskContextMenu kind="downloading" />);
    expect(labels().join('|')).toContain('Retry Selected Tasks');
  });

  it('shows Copy Download Url when the selected task has a single url', () => {
    seedList([makeTask('a', 'a.iso')]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskContextMenu kind="downloading" />);
    expect(labels().join('|')).toContain('Copy Download Url');
  });

  it('hides Copy Download Url when the selected task has several urls', () => {
    const twoUris = {
      ...file(1, 'a.iso'),
      uris: [{ uri: 'http://one.test/a.iso' }, { uri: 'http://two.test/a.iso' }],
    } as Aria2File;
    seedList([makeTask('a', 'a.iso', { files: [twoUris] })]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskContextMenu kind="downloading" />);
    expect(labels().join('|')).not.toContain('Copy Download Url');
  });

  it('shows Copy Magnet Link for a selected torrent with an info hash', () => {
    seedList([
      { ...makeTask('a', 'a.iso', { infoHash: 'AAAA' }), bittorrent: { privateTorrent: false } },
    ]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskContextMenu kind="downloading" />);
    expect(labels().join('|')).toContain('Copy Magnet Link');
  });

  it('shows Copy ED2K Link for a selected ed2k task', () => {
    seedList([
      {
        ...makeTask('a', 'a.iso'),
        ed2k: { hash: 'HASH', name: 'a.iso', ed2kLink: 'ed2k://|file|a.iso|' } as NormalizedTask['ed2k'],
      },
    ]);
    useSelectionStore.setState({ selected: { a: true } });

    render(<TaskContextMenu kind="downloading" />);
    expect(labels().join('|')).toContain('Copy ED2K Link');
  });

  it('builds a magnet link the way AriaNg did', () => {
    const task = { ...makeTask('a', 'a.iso'), infoHash: 'DEADBEEF' };
    expect(magnetLinkFor(task)).toBe('magnet:?xt=urn:btih:DEADBEEF');
  });

  it('exposes the seven order types in the Display Order submenu', () => {
    seedList([makeTask('a', 'a.iso')]);
    const { container } = render(<TaskContextMenu kind="downloading" />);

    const submenu = container.querySelector('mdui-menu[slot="submenu"]') as HTMLElement;
    expect(submenu).not.toBeNull();
    expect(submenu.querySelectorAll('mdui-menu-item')).toHaveLength(7);
  });
});

describe('TaskRowHeader in isolation', () => {
  it('renders without a store round-trip', () => {
    const onChangeOrder = vi.fn();
    const { container } = render(<TaskRowHeader order="size:asc" onChangeOrder={onChangeOrder} />);

    fireEvent.click(screen.getByRole('button', { name: /File Size/ }));
    expect(onChangeOrder).toHaveBeenCalledWith('size:desc');

    fireEvent.click(screen.getByRole('button', { name: /File Name/ }));
    expect(onChangeOrder).toHaveBeenCalledWith('name:asc');
    expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(6);
  });
});