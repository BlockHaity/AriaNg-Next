/**
 * `TaskRow` behaviour tests.
 *
 * Everything here is driven through the real stores (`useSelectionStore`) and
 * through `normalizeTask`, so a fixture is a genuine aria2 payload rather than a
 * hand-made object with the right shape — a row that renders correctly against a
 * fake field layout is not evidence of anything.
 *
 * Note: no test calls `unmount()` mid-body. mdui's `<mdui-checkbox>` throws from
 * Lit's `firstUpdated` when the element is removed before its first update settles
 * (a known jsdom/mdui interaction, reproducible with any mdui component), and the
 * resulting unhandled rejection fails the whole vitest run. The global
 * `afterEach(cleanup)` runs after the microtask queue drains, which is safe.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { Aria2File, Aria2Media, Aria2Status, Aria2TaskStatusResult } from '@/rpc/types';
import { normalizeTask } from '@/domain/normalize';
import type { NormalizedTask } from '@/domain/types';
import { FileSelectionState, MediaPhase } from '@/config/rpc-constants';
import { useSelectionStore } from '@/store/selection';
import { i18n } from '@/i18n';
import { TaskRow } from '../task-list/TaskRow';
import { canStartTasks, startableTasks } from '../task-list/TaskListToolbar';

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

/** A minimal but *real* aria2 payload; `overrides` are shallow-merged onto it. */
function makeTask(overrides: Partial<Aria2TaskStatusResult> = {}): NormalizedTask {
  const wire = {
    gid: '2089b05ecca3d829',
    status: 'active',
    totalLength: '1048576',
    completedLength: '524288',
    uploadLength: '0',
    downloadSpeed: '102400',
    uploadSpeed: '2048',
    connections: '4',
    numSeeders: '2',
    dir: '/downloads',
    files: [file(1, 'a.iso')],
    ...overrides,
  } as Aria2TaskStatusResult;

  return normalizeTask(wire);
}

/** A wire `media` block, normalised the same way aria2's answer is. */
function makeMediaTask(media: Partial<Aria2Media>, overrides: Partial<Aria2TaskStatusResult> = {}): NormalizedTask {
  return makeTask({
    ...overrides,
    media: {
      state: MediaPhase.Downloading,
      protocol: 'hls',
      live: false,
      downloadedLength: '1000',
      duration: '10000',
      progress: '0.42',
      lengthKnown: 'true',
      tracks: [],
      ...media,
    } as Aria2Media,
  });
}

const BITTORRENT = { privateTorrent: false } as NormalizedTask['bittorrent'];

function renderRow(task: NormalizedTask, props: { draggable?: boolean; onRetryTask?: (t: NormalizedTask) => void } = {}) {
  return render(<TaskRow task={task} {...props} />);
}

function rowOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="task-row"]') as HTMLElement;
}

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  // The English table has to be in the cache, otherwise `t()` answers with the
  // key (`'format.settings.file-count'`) instead of the rendered string.
  await i18n.ready();
});

beforeEach(() => {
  useSelectionStore.setState({ selected: {}, enabled: true });
});

/* ------------------------------------------------------------------ */
/* progress                                                            */
/* ------------------------------------------------------------------ */

describe('TaskRow progress', () => {
  it('renders the percentage inside the bar and on the ARIA value', () => {
    const { container } = renderRow(makeTask());
    const bar = container.querySelector('.task-progress-bar') as HTMLElement;
    const value = container.querySelector('.task-progress-value') as HTMLElement;

    expect(bar.style.width).toBe('50%');
    expect(value.textContent).toBe('50.00%');
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemin')).toBe('0');
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe('100');
  });

  it('truncates rather than rounds, like AriaNg\'s percent filter', () => {
    const { container } = renderRow({ ...makeTask(), completePercent: 49.999 });
    expect((container.querySelector('.task-progress-value') as HTMLElement).textContent).toBe('49.99%');
  });

  it('uses the lower ink below 50%', () => {
    const { container } = renderRow({ ...makeTask(), completePercent: 49.99 });
    const value = container.querySelector('.task-progress-value') as HTMLElement;
    expect(value.className).toContain('task-progress-value--lower');
    expect(value.textContent).toBe('49.99%');
  });

  it('switches to the normal ink at exactly 50%', () => {
    const { container } = renderRow({ ...makeTask(), completePercent: 50 });
    const value = container.querySelector('.task-progress-value') as HTMLElement;
    expect(value.className).not.toContain('task-progress-value--lower');
    expect(value.textContent).toBe('50.00%');
  });

  it('paints the primary bar for a healthy task', () => {
    const { container } = renderRow(makeTask());
    expect(container.querySelector('.task-progress-bar--error')).toBeNull();
    expect(container.querySelector('.task-progress-bar')).not.toBeNull();
  });

  it('paints the warning bar for an errored task', () => {
    const { container } = renderRow(makeTask({ status: 'error', errorCode: '3' }));
    expect(container.querySelector('.task-progress-bar--error')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* the ETA line                                                        */
/* ------------------------------------------------------------------ */

describe('TaskRow ETA line', () => {
  it('shows --:--:-- while waiting', () => {
    renderRow(makeTask({ status: 'waiting', downloadSpeed: '0' }));
    expect(screen.getByTestId('task-eta')).toHaveTextContent('--:--:--');
  });

  it('shows nothing while paused', () => {
    renderRow(makeTask({ status: 'paused' }));
    expect(screen.getByTestId('task-eta')).toHaveTextContent('');
  });

  it('shows nothing for a terminal status', () => {
    renderRow(makeTask({ status: 'complete' }));
    expect(screen.getByTestId('task-eta')).toHaveTextContent('');
  });

  it('shows HH:mm:ss for an active task under a day', () => {
    renderRow({ ...makeTask(), status: 'active', remainTime: 3661 });
    expect(screen.getByTestId('task-eta')).toHaveTextContent('01:01:01');
  });

  it('shows 00:00:00 for an active task with no remaining bytes', () => {
    renderRow({ ...makeTask(), status: 'active', remainTime: 0 });
    expect(screen.getByTestId('task-eta')).toHaveTextContent('00:00:00');
  });

  it('says "More Than One Day" at exactly 86400 s', () => {
    renderRow({ ...makeTask(), status: 'active', remainTime: 86400 });
    expect(screen.getByTestId('task-eta')).toHaveTextContent('More than 1 day');
  });

  it('says "More Than One Day" beyond a day', () => {
    renderRow({ ...makeTask(), status: 'active', remainTime: 90000 });
    expect(screen.getByTestId('task-eta')).toHaveTextContent('More than 1 day');
  });

  it('shows nothing when aria2 could not estimate', () => {
    renderRow({ ...makeTask(), status: 'active', remainTime: null });
    expect(screen.getByTestId('task-eta')).toHaveTextContent('');
  });
});

/* ------------------------------------------------------------------ */
/* the files line                                                      */
/* ------------------------------------------------------------------ */

describe('TaskRow file size and markers', () => {
  it('shows readableVolume(totalLength)', () => {
    renderRow(makeTask({ totalLength: '1048576', completedLength: '0' }));
    expect(screen.getByText('1.00 MB')).toBeInTheDocument();
  });

  it('renders no (N Files) link for a single-file task', () => {
    const { container } = renderRow(makeTask({ files: [file(1, 'a.iso')] }));
    expect(container.querySelector('.task-files-link')).toBeNull();
  });

  it('renders the (N Files) link, pointing at the Files tab, for a multi-file task', () => {
    const { container } = renderRow(makeTask({ files: [file(1, 'a.iso'), file(2, 'b.iso'), file(3, 'c.iso')] }));
    const link = screen.getByText('(3 Files)');

    expect(container.querySelector('.task-files-link')).not.toBeNull();
    expect(link).toHaveAttribute('href', expect.stringContaining('/task/detail/'));
    expect(link.getAttribute('href')).toContain('tab=files');
  });

  it('counts only the selected files in the (N Files) label', () => {
    const unselected = { ...file(2, 'b.iso'), selected: 'false' } as Aria2File;
    renderRow(makeTask({ files: [file(1, 'a.iso'), file(2, 'b.iso'), unselected] }));
    expect(screen.getByText('(2 Files)')).toBeInTheDocument();
  });

  it('offers Retry for a non-BitTorrent errored task', () => {
    // `errorDescriptionFor` is empty until the aria2 error table is wired up, so
    // the fixture supplies it the way a live aria2 would.
    renderRow({ ...makeTask({ status: 'error', errorCode: '3' }), errorDescription: 'Resource not found' });
    expect(document.querySelector('.task-retry-link')).not.toBeNull();
  });

  it('does not offer Retry for an errored torrent', () => {
    renderRow({
      ...makeTask({ status: 'error', errorCode: '3' }),
      errorDescription: 'Resource not found',
      bittorrent: BITTORRENT,
    });
    expect(document.querySelector('.task-retry-link')).toBeNull();
  });

  it('does not offer Retry without an error description', () => {
    renderRow({ ...makeTask({ status: 'error', errorCode: '3' }), errorDescription: '' });
    expect(document.querySelector('.task-retry-link')).toBeNull();
  });

  it('calls onRetryTask when the Retry link is pressed', () => {
    const onRetryTask = vi.fn();
    renderRow(
      { ...makeTask({ status: 'error', errorCode: '3' }), errorDescription: 'Resource not found' },
      { onRetryTask },
    );

    fireEvent.click(screen.getByTitle('Retry'));
    expect(onRetryTask).toHaveBeenCalledTimes(1);
  });

  it('uses errorDescription as the error marker tooltip', () => {
    renderRow({ ...makeTask({ status: 'error', errorCode: '3' }), errorDescription: 'Resource not found' });
    const marker = document.querySelector('.task-marker--error') as HTMLElement;

    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute('title', 'Resource not found');
    expect(marker).toHaveAttribute('aria-label', 'Resource not found');
  });

  it('shows no error marker for a healthy task', () => {
    renderRow(makeTask());
    expect(document.querySelector('.task-marker--error')).toBeNull();
  });

  it('shows the seeding marker for an active seeder', () => {
    renderRow(makeTask({ status: 'active', seeder: 'true' }));
    const marker = document.querySelector('.task-marker--seeder') as HTMLElement;
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute('title', 'Seeding');
  });

  it('shows no seeding marker for an active non-seeder', () => {
    renderRow(makeTask({ status: 'active', seeder: 'false' }));
    expect(document.querySelector('.task-marker--seeder')).toBeNull();
  });

  it('shows no seeding marker when the seeder flag is set on a paused task', () => {
    // AriaNg required `status === 'active'` as well as the flag.
    renderRow(makeTask({ status: 'paused', seeder: 'true' }));
    expect(document.querySelector('.task-marker--seeder')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* the speed cell                                                      */
/* ------------------------------------------------------------------ */

describe('TaskRow speed cell', () => {
  it('shows the live download speed with a /s suffix', () => {
    const { container } = renderRow(makeTask({ downloadSpeed: '1048576' }));
    expect(container.querySelector('.task-cell--speed')).toHaveTextContent('1.00 MB/s');
  });

  it('shows a dash for a seeding task at 0 B/s', () => {
    const { container } = renderRow(makeTask({ status: 'active', seeder: 'true', downloadSpeed: '0' }));
    expect(container.querySelector('.task-cell--speed')).toHaveTextContent('-');
  });

  it('shows Pending Verification while aria2 is verifying integrity', () => {
    const { container } = renderRow(makeTask({ verifyIntegrityPending: 'true' }));
    expect(container.querySelector('.task-cell--speed')).toHaveTextContent('Pending Verification');
  });

  it('shows Verifying (x%) once a verified length is reported', () => {
    const { container } = renderRow({ ...makeTask(), verifiedPercent: 42 });
    expect(container.querySelector('.task-cell--speed')).toHaveTextContent('Verifying (42%)');
  });

  it('shows the bare Verifying label while the percentage is still zero', () => {
    const { container } = renderRow({ ...makeTask(), verifiedPercent: 0 });
    expect(container.querySelector('.task-cell--speed')).toHaveTextContent('Verifying');
  });

  it('shows Error Occurred (code) with the code interpolated', () => {
    const { container } = renderRow(makeTask({ status: 'error', errorCode: '19' }));
    expect(container.querySelector('.task-cell--speed')).toHaveTextContent('Error Occurred (19)');
  });

  it('adds the upload speed to the tooltip for a torrent', () => {
    const task = { ...makeTask({ downloadSpeed: '1048576', uploadSpeed: '524288' }), bittorrent: BITTORRENT };
    const { container } = renderRow(task);
    const speed = container.querySelector('.task-cell--speed .task-download-speed') as HTMLElement;

    expect(speed.getAttribute('title')).toContain('Download Speed: 1.00 MB/s');
    expect(speed.getAttribute('title')).toContain('Upload Speed: 512.00 KB/s');
  });

  it('leaves the tooltip empty for a non-active task', () => {
    const { container } = renderRow(makeTask({ status: 'waiting', downloadSpeed: '0' }));
    const speed = container.querySelector('.task-cell--speed .task-download-speed') as HTMLElement;
    expect(speed.getAttribute('title')).toBe('');
  });

  it('also renders the compact inline speed for narrow layouts', () => {
    const { container } = renderRow(makeTask({ downloadSpeed: '1048576' }));
    expect(container.querySelector('.task-download-speed--compact')).toHaveTextContent('1.00 MB/s');
  });
});

/* ------------------------------------------------------------------ */
/* seeders                                                             */
/* ------------------------------------------------------------------ */

describe('TaskRow seeders', () => {
  it('renders numSeeders/connections for an active task', () => {
    const { container } = renderRow(makeTask({ status: 'active', numSeeders: '3', connections: '7' }));
    expect(container.querySelector('.task-seeders')).toHaveTextContent('3/7');
  });

  it('drops the seeders half for a task with none', () => {
    const { container } = renderRow(makeTask({ status: 'active', numSeeders: '0', connections: '7' }));
    expect(container.querySelector('.task-seeders')).toHaveTextContent('7');
  });

  it('renders nothing for a non-active task', () => {
    const { container } = renderRow(makeTask({ status: 'paused', numSeeders: '3', connections: '7' }));
    expect(container.querySelector('.task-seeders')).toHaveTextContent('');
  });
});

/* ------------------------------------------------------------------ */
/* selection                                                           */
/* ------------------------------------------------------------------ */

describe('TaskRow selection', () => {
  it('toggles the selection when the row is clicked', () => {
    const task = makeTask();
    const { container } = renderRow(task);
    const row = rowOf(container);

    expect(useSelectionStore.getState().selected[task.gid]).toBeUndefined();

    fireEvent.click(row);
    expect(useSelectionStore.getState().selected[task.gid]).toBe(true);

    fireEvent.click(row);
    expect(useSelectionStore.getState().selected[task.gid]).toBeUndefined();
  });

  it('hides the checkbox and blocks its own clicks until the row is selected', () => {
    const task = makeTask();
    const { container } = renderRow(task);
    const checkbox = container.querySelector('mdui-checkbox') as HTMLElement;

    // AriaNg's `checkbox-hide` + `disable-clickable`.
    expect(checkbox.className).toContain('disable-clickable');
    expect(checkbox.className).toContain('task-checkbox--hidden');

    act(() => {
      useSelectionStore.getState().toggle(task.gid);
    });

    const after = container.querySelector('mdui-checkbox') as HTMLElement;
    expect(after.className).not.toContain('task-checkbox--hidden');
    expect(after.className).not.toContain('disable-clickable');
  });

  it('mirrors the selection onto aria-selected, data-selected and the modifier class', () => {
    const task = makeTask();
    const { container } = renderRow(task);
    const row = rowOf(container);

    expect(row.getAttribute('aria-selected')).toBe('false');
    expect(row.getAttribute('data-selected')).toBe('false');

    act(() => {
      useSelectionStore.getState().toggle(task.gid);
    });

    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.getAttribute('data-selected')).toBe('true');
    expect(row.className).toContain('task-row--selected');
  });

  it('does not toggle when the trailing chevron link is clicked', () => {
    const task = makeTask();
    const { container } = renderRow(task);

    fireEvent.click(container.querySelector('.task-right-arrow') as HTMLElement);
    expect(useSelectionStore.getState().selected[task.gid]).toBeUndefined();
  });

  it('toggles on Space and opens the detail page on Enter', () => {
    const task = makeTask();
    const { container } = renderRow(task);
    const row = rowOf(container);

    fireEvent.keyDown(row, { key: ' ' });
    expect(useSelectionStore.getState().selected[task.gid]).toBe(true);

    const before = window.location.hash;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(window.location.hash).not.toBe(before);
    expect(window.location.hash).toContain('/task/detail/');
  });
});

/* ------------------------------------------------------------------ */
/* name / navigation                                                   */
/* ------------------------------------------------------------------ */

describe('TaskRow name', () => {
  it('keeps the full task name in the title next to the ellipsised text', () => {
    const { container } = renderRow({ ...makeTask(), taskName: 'a-very-long-file-name.iso' });
    const name = container.querySelector('.task-name') as HTMLElement;

    expect(name.textContent).toBe('a-very-long-file-name.iso');
    expect(name).toHaveAttribute('title', 'a-very-long-file-name.iso');
  });

  it('navigates to the detail page on double-click', () => {
    const { container } = renderRow(makeTask());
    fireEvent.doubleClick(container.querySelector('.task-name') as HTMLElement);
    expect(window.location.hash).toContain('/task/detail/2089b05ecca3d829');
  });

  it('points the chevron at the detail page', () => {
    const { container } = renderRow(makeTask());
    const arrow = container.querySelector('.task-right-arrow') as HTMLElement;
    expect(arrow).toHaveAttribute('href', expect.stringContaining('/task/detail/2089b05ecca3d829'));
  });
});

/* ------------------------------------------------------------------ */
/* aria2-next extras                                                   */
/* ------------------------------------------------------------------ */

describe('TaskRow media chip', () => {
  it('renders the duration-based progress when the length is known', () => {
    renderRow(makeMediaTask({ progress: '0.42', lengthKnown: 'true' }));
    expect(screen.getByTestId('task-media-chip')).toHaveTextContent('42%');
  });

  it('never renders 0% when the length is unknown', () => {
    // `normalizeMedia` maps `lengthKnown: 'false'` onto `progress: null`; AriaNg's
    // `!length` bail-out existed for exactly this case.
    renderRow(makeMediaTask({ progress: '0', lengthKnown: 'false' }));

    const chip = screen.getByTestId('task-media-chip');
    expect(chip.textContent).not.toContain('0%');
    expect(chip).toHaveTextContent('Downloading');
  });

  it('shows the phase instead of a percentage when the duration is unknown', () => {
    renderRow(makeMediaTask({ state: MediaPhase.Probing, progress: '0', lengthKnown: 'false', duration: undefined }));
    expect(screen.getByTestId('task-media-chip')).toHaveTextContent('Probing');
  });

  it('labels a live stream instead of a percentage', () => {
    renderRow(makeMediaTask({ live: 'true', progress: '0', lengthKnown: 'false' }));
    expect(screen.getByTestId('task-media-chip')).toHaveTextContent('Live');
  });

  it('renders no chip for a task without media', () => {
    renderRow(makeTask());
    expect(screen.queryByTestId('task-media-chip')).toBeNull();
  });
});

describe('TaskRow awaiting file selection', () => {
  const awaiting = (gid: string) => ({
    ...makeTask({ gid, status: 'paused' as Aria2Status }),
    bittorrent: {
      privateTorrent: false,
      fileSelectionState: FileSelectionState.Awaiting,
    } as NormalizedTask['bittorrent'],
  });

  it('shows the warning chip', () => {
    renderRow(awaiting('gid-awaiting'));
    expect(screen.getByTestId('task-file-selection-warning')).toHaveTextContent('Select files to continue');
  });

  it('shows no warning chip for a torrent whose files are ready', () => {
    renderRow({
      ...makeTask({ gid: 'gid-ready', status: 'paused' as Aria2Status }),
      bittorrent: { privateTorrent: false, fileSelectionState: FileSelectionState.Ready } as NormalizedTask['bittorrent'],
    });
    expect(screen.queryByTestId('task-file-selection-warning')).toBeNull();
  });

  it('disables Start for it, so aria2.unpause is never sent in vain', () => {
    const task = awaiting('gid-awaiting');
    expect(startableTasks([task])).toEqual([]);
    expect(canStartTasks([task])).toBe(false);
  });

  it('keeps Start available for a ready torrent', () => {
    const task = {
      ...makeTask({ gid: 'gid-ready', status: 'paused' as Aria2Status }),
      bittorrent: { privateTorrent: false, fileSelectionState: FileSelectionState.Ready } as NormalizedTask['bittorrent'],
    };
    expect(canStartTasks([task])).toBe(true);
  });

  it('keeps Start available when another selected task can be started', () => {
    const blocked = awaiting('gid-awaiting');
    const startable = makeTask({ gid: 'gid-ok', status: 'paused' });

    expect(startableTasks([blocked, startable]).map((task) => task.gid)).toEqual(['gid-ok']);
    expect(canStartTasks([blocked, startable])).toBe(true);
  });
});

describe('TaskRow ED2K indicator', () => {
  it('renders nothing for a task without an ed2k block', () => {
    const { container } = renderRow(makeTask());
    expect(container.querySelector('[data-testid="task-ed2k-chip"]')).toBeNull();
  });

  it('renders the indicator for an ed2k task', () => {
    renderRow({
      ...makeTask(),
      ed2k: { hash: 'ABCDEF0123456789', name: 'movie.mkv', ed2kLink: 'ed2k://|file|movie.mkv|' } as NormalizedTask['ed2k'],
    });
    expect(screen.getByTestId('task-ed2k-chip')).toHaveTextContent('ED2K');
  });
});

/* ------------------------------------------------------------------ */
/* drag handle                                                         */
/* ------------------------------------------------------------------ */

describe('TaskRow drag handle', () => {
  it('is absent when dragging is not supported for this page', () => {
    const { container } = renderRow(makeTask());
    expect(container.querySelector('.task-drag-handle')).toBeNull();
  });

  it('is present and keyboard-reachable when dragging is enabled', () => {
    const task = makeTask();
    const { container } = renderRow(task, { draggable: true });
    const handle = container.querySelector('.task-drag-handle') as HTMLButtonElement;

    expect(handle).not.toBeNull();
    expect(handle.tagName).toBe('BUTTON');
    // Named after the row it moves, so the screen reader reads something useful.
    expect(handle.getAttribute('aria-label')).toContain(task.taskName);
    // @dnd-kit fills `aria-describedby` in when it is mounted; the attribute must
    // at least be there so the hook has a slot to write into.
    expect(handle.hasAttribute('aria-describedby')).toBe(true);
  });
});