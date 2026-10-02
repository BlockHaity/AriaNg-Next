/**
 * Behaviour tests for the aria2-next ED2K search page.
 *
 * These drive the real page component against a hand-written fake
 * `Aria2Client`, because the parts worth testing here are all *protocol*
 * behaviour, not rendering detail:
 *
 *   - the `getVersion()` gate that must refuse stock aria2;
 *   - `ed2kSearch` returning a **search** GID, kept out of the task list;
 *   - the poll loop, including that it never overlaps and that it stops when
 *     `moreResults` turns `false` or the credentials are rejected;
 *   - `addUri([ed2kLink])` per result, with the dead-link failures aggregated.
 *
 * mdui's own elements are never registered here: jsdom does not run the Lit
 * lifecycle, so every wrapper (`MduiTextField`, `MduiButton`, `MduiCheckbox`) is
 * driven exactly the way its bridge expects — dispatch the custom event on the
 * host element, or write the JS property.
 *
 * Copy is asserted through the *English* text rather than through keys: AriaNg's
 * catalogue has no ED2K strings, so the page's local catalogue renders them
 * verbatim (see `ed2k-search/index.ts`).
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Aria2Client, RpcResult } from '@/rpc/contract';
import type {
  Aria2Ed2kSearchResult,
  Aria2Ed2kSearchState,
  Aria2OptionMap,
  Aria2VersionInfo,
} from '@/rpc/types';
import { useRpcStore } from '@/store/rpc-store';
import Ed2kSearchPage from '../Ed2kSearchPage';
import { ResultsTable } from '../ed2k-search/ResultsTable';
import { normalizeResults } from '../ed2k-search/format';

/* ------------------------------------------------------------------ */
/* fake client                                                         */
/* ------------------------------------------------------------------ */

const ARIA2_NEXT_VERSION: Aria2VersionInfo = {
  product: 'aria2-next',
  rpcVersion: '1.1.0',
  version: '2.5.2',
  enabledFeatures: ['Async DNS', 'BitTorrent', 'ED2K', 'HTTPS'],
};

const STOCK_ARIA2_VERSION: Aria2VersionInfo = {
  version: '1.37.0',
  enabledFeatures: ['Async DNS', 'BitTorrent', 'Metalink'],
};

function ok<T>(data: T): RpcResult<T> {
  return { success: true, data, context: { method: 'test' } };
}

function fail(message: string, code = 1): RpcResult<never> {
  return { success: false, error: { message, code }, context: { method: 'test' } };
}

interface FakeClient {
  client: Aria2Client;
  ed2kSearch: ReturnType<typeof vi.fn>;
  getEd2kSearchResults: ReturnType<typeof vi.fn>;
  addUri: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
}

interface FakeOptions {
  version?: RpcResult<Aria2VersionInfo>;
  search?: RpcResult<string>;
  /** One entry per `getEd2kSearchResults` call; the last one repeats. */
  results?: Aria2Ed2kSearchState[];
  /** Replaces the whole `getEd2kSearchResults` behaviour (e.g. to hang). */
  resultsImpl?: (gid: string) => Promise<RpcResult<Aria2Ed2kSearchState>>;
  addUri?: (urls: string[], options?: Aria2OptionMap) => Promise<RpcResult<string>>;
}

function createFakeClient(options: FakeOptions = {}): FakeClient {
  const addUri = vi.fn(options.addUri ?? ((urls: string[]) => Promise.resolve(ok(`${urls[0]}-gid`))));

  const queue = options.results ?? [];
  let call = 0;

  const getEd2kSearchResults = vi.fn((gid: string) => {
    if (options.resultsImpl) {
      return options.resultsImpl(gid);
    }
    const state = queue[Math.min(call, queue.length - 1)] ?? { gid, moreResults: false, results: [] };
    call += 1;
    return Promise.resolve(ok(state));
  });

  const fake: FakeClient = {
    ed2kSearch: vi.fn(() => Promise.resolve(options.search ?? ok('search-gid-1'))),
    getEd2kSearchResults,
    addUri,
    getVersion: vi.fn(() => Promise.resolve(options.version ?? ok(ARIA2_NEXT_VERSION))),
    client: null as unknown as Aria2Client,
  };

  // Only the surface this page touches is implemented; the contract has ~60
  // members, so the rest is a no-op stand-in rather than 60 stubs. `disconnect`
  // is mandatory: `attachClient` disposes the previous process-wide singleton.
  fake.client = {
    connection: { status: 'connected', attempt: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
    onConnectionChange: () => () => {},
    onEvent: () => () => {},
    getVersion: fake.getVersion,
    getGlobalOption: vi.fn(() => Promise.resolve(ok<Record<string, string>>({}))),
    ed2kSearch: fake.ed2kSearch,
    getEd2kSearchResults: fake.getEd2kSearchResults,
    addUri: fake.addUri,
  } as unknown as Aria2Client;

  return fake;
}

function attach(client: Aria2Client): void {
  act(() => {
    useRpcStore.getState().attachClient(client);
  });
}

function resetHash(hash = ''): void {
  window.location.hash = hash;
}

/* ------------------------------------------------------------------ */
/* interactions                                                        */
/* ------------------------------------------------------------------ */

/** Drives an `<mdui-text-field>` the way mdui would: set `value`, fire `input`. */
function typeInto(input: HTMLElement, value: string): void {
  (input as unknown as { value: string }).value = value;
  fireEvent(input, new Event('input', { bubbles: true }));
}

/** Drives an `<mdui-checkbox>` the way mdui would: write `checked`, fire `change`. */
function toggleCheckbox(checkbox: HTMLElement): void {
  const element = checkbox as HTMLElement & { checked: boolean };
  element.checked = !element.checked;
  fireEvent(checkbox, new Event('change', { bubbles: true }));
}

/**
 * An `<mdui-text-field>` as an `HTMLElement`.
 *
 * mdui declares its own element types, so a straight cast is rejected; the
 * bridge only ever touches `value`, which is why the widening is safe.
 */
function textField(element: Element | null): HTMLElement {
  return element as unknown as HTMLElement;
}

const form = (): HTMLElement => screen.getByTestId('ed2k-search-form');
const keywordField = (): HTMLElement => textField(form().querySelector('mdui-text-field'));
/** The Advanced section's three text fields, in declaration order. */
const optionField = (index: number): HTMLElement =>
  textField(form().querySelectorAll('mdui-text-field')[index]);

const LINK_A = 'ed2k://|file|alpha.mkv|100|AAAAAAAA|/';
const LINK_B = 'ed2k://|file|beta.mp3|200|BBBBBBBB|/';

// Field names follow `Aria2Ed2kSearchResult`, which mirrors the manual.
const RESULT_A: Aria2Ed2kSearchResult = {
  ed2kLink: LINK_A,
  name: 'alpha.mkv',
  length: '100',
  hash: 'AAAAAAAA',
  mediaCodec: 'H.264',
  sourceNetwork: 'eMule Security',
};

const RESULT_B: Aria2Ed2kSearchResult = {
  ed2kLink: LINK_B,
  name: 'beta.mp3',
  length: '200',
  hash: 'BBBBBBBB',
  sourceNetwork: 'Kad',
};

/** A payload the type does not declare, on purpose. */
function raw(fields: Record<string, unknown>): Aria2Ed2kSearchResult {
  return fields as Aria2Ed2kSearchResult;
}

/** Flushes the microtasks the hook's promises need, optionally advancing timers. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The row whose stable key is `key` — the table sorts by size by default. */
function rowWithKey(key: string): HTMLElement {
  const row = screen
    .getAllByTestId('ed2k-result-row')
    .find((element) => element.getAttribute('data-key') === key);

  if (!row) {
    throw new Error(`no result row with key ${key}`);
  }
  return row;
}

/** Types a keyword and presses Search, then waits for the call to land. */
async function search(keyword = 'ubuntu'): Promise<void> {
  typeInto(keywordField(), keyword);
  fireEvent.click(screen.getByText('Search'));
  await settle();
}

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  // mdui's snackbar opens/closes through the Web Animations API, which jsdom
  // does not implement. A stub that immediately "finishes" is enough: the page
  // only needs the snackbar's text, not its transition.
  if (typeof Element !== 'undefined' && typeof Element.prototype.animate !== 'function') {
    Element.prototype.animate = function animate(): Animation {
      const listeners = new Map<string, Array<() => void>>();

      return {
        onfinish: null,
        oncancel: null,
        finished: Promise.resolve(this as unknown as Animation),
        addEventListener(type: string, handler: () => void) {
          const list = listeners.get(type) ?? [];
          list.push(handler);
          listeners.set(type, list);
          queueMicrotask(() => {
            if (type === 'finish') {
              for (const call of listeners.get('finish') ?? []) call();
            }
          });
        },
        removeEventListener() {},
        cancel() {},
        finish() {},
        pause() {},
        play() {},
      } as unknown as Animation;
    };
  }

  if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
    Element.prototype.getAnimations = () => [];
  }
});

beforeEach(() => {
  vi.useFakeTimers();
  resetHash();
});

afterEach(() => {
  cleanup();
  act(() => {
    useRpcStore.getState().attachClient(null);
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('server-side gate', () => {
  it('renders the disabled state when the daemon is not aria2-next', async () => {
    attach(createFakeClient({ version: ok(STOCK_ARIA2_VERSION) }).client);

    render(<Ed2kSearchPage />);
    await settle();

    expect(screen.getByTestId('ed2k-unsupported')).toHaveTextContent(
      /does not identify itself as aria2-next/i,
    );
    // The form is not offered at all — pressing Search could only fail.
    expect(screen.queryByTestId('ed2k-search-form')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /status page/i })).toBeInTheDocument();
  });

  it('renders the disabled state when aria2-next has no ED2K feature', async () => {
    attach(
      createFakeClient({
        version: ok({ ...ARIA2_NEXT_VERSION, enabledFeatures: ['Async DNS', 'BitTorrent'] }),
      }).client,
    );

    render(<Ed2kSearchPage />);
    await settle();

    expect(screen.getByTestId('ed2k-unsupported')).toHaveTextContent(/no ED2K feature/i);
  });

  it('never issues ed2kSearch against an unsupported daemon', async () => {
    const fake = createFakeClient({ version: ok(STOCK_ARIA2_VERSION) });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();

    expect(fake.ed2kSearch).not.toHaveBeenCalled();
    expect(fake.getEd2kSearchResults).not.toHaveBeenCalled();
  });

  it('explains the asynchronous collection and links to the ED2K settings', async () => {
    attach(createFakeClient().client);

    render(<Ed2kSearchPage />);
    await settle();

    expect(screen.getByText(/How ED2K search works/)).toBeInTheDocument();
    expect(screen.getByText(/built-in bootstrap servers/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Configure ED2K servers and Kad nodes/ }),
    ).toHaveAttribute('href', expect.stringContaining('/settings/aria2/ed2k'));
  });
});

describe('searching', () => {
  it('calls ed2kSearch with the keyword and stores the returned gid', async () => {
    const fake = createFakeClient({ search: ok('the-search-gid') });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    expect(fake.ed2kSearch).toHaveBeenCalledTimes(1);
    expect(fake.ed2kSearch).toHaveBeenCalledWith('ubuntu', {});
    expect(screen.getByTestId('ed2k-search-gid')).toHaveTextContent('the-search-gid');
  });

  it('sends the advanced request options and drops the untouched ones', async () => {
    const fake = createFakeClient();
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();

    // Field 1 is `--ed2k-server`, the only list-valued one; 2 and 3 stay blank.
    typeInto(optionField(1), ' 203.0.113.10:4661 , 198.51.100.7:4662 ');
    await search();

    expect(fake.ed2kSearch).toHaveBeenCalledWith('ubuntu', {
      'ed2k-server': '203.0.113.10:4661 , 198.51.100.7:4662',
    });
  });

  it('auto-starts from the ?keyword= deep link', async () => {
    resetHash('#!/ed2k/search?keyword=ubuntu%20iso');
    const fake = createFakeClient();
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();

    expect(fake.ed2kSearch).toHaveBeenCalledWith('ubuntu iso', {});
  });

  it('polls getEd2kSearchResults on the interval and stops when moreResults is false', async () => {
    const fake = createFakeClient({
      search: ok('the-search-gid'),
      results: [
        { gid: 'the-search-gid', moreResults: true, results: [RESULT_A] },
        { gid: 'the-search-gid', moreResults: true, results: [RESULT_A, RESULT_B] },
        { gid: 'the-search-gid', moreResults: false, results: [RESULT_A, RESULT_B] },
      ],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    // The first poll runs immediately when the gid lands, not one tick later.
    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(1);
    expect(fake.getEd2kSearchResults).toHaveBeenCalledWith('the-search-gid');
    expect(screen.getByTestId('ed2k-streaming')).toBeInTheDocument();

    await settle(1000);
    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('ed2k-result-row')).toHaveLength(2);

    // `moreResults: false` is the completion signal — the interval goes away.
    await settle(1000);
    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(3);

    await settle(10_000);
    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('ed2k-streaming')).not.toBeInTheDocument();
  });

  it('never overlaps two polls', async () => {
    let release: (() => void) | undefined;
    const fake = createFakeClient({
      // The first poll hangs; every tick while it hangs must be skipped.
      resultsImpl: (gid) =>
        new Promise<RpcResult<Aria2Ed2kSearchState>>((resolve) => {
          release = () => resolve(ok({ gid, moreResults: true, results: [RESULT_A] }));
        }),    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(1);

    await settle(10_000);
    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle(1000);
    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(2);
  });

  it('stops the poll on Unauthorized', async () => {
    const fake = createFakeClient({
      resultsImpl: () => Promise.resolve(fail('Unauthorized')),
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    expect(screen.getByTestId('ed2k-error')).toBeInTheDocument();

    // Wrong credentials will not fix themselves by retrying every second.
    await settle(10_000);
    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(1);
  });

  it('stops polling on stop() and keeps what it already found', async () => {
    const fake = createFakeClient({
      results: [{ gid: 'the-search-gid', moreResults: true, results: [RESULT_A] }],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    fireEvent.click(screen.getByText('Stop search'));

    const callsAfterStop = fake.getEd2kSearchResults.mock.calls.length;
    await settle(10_000);

    expect(fake.getEd2kSearchResults).toHaveBeenCalledTimes(callsAfterStop);
    expect(screen.getAllByTestId('ed2k-result-row')).toHaveLength(1);
    // The gid is a *search* task, so it is not left dangling on the form.
    expect(screen.queryByTestId('ed2k-search-gid')).not.toBeInTheDocument();
  });

  it('keeps row keys stable while the accumulated result set is re-sent', async () => {
    const fake = createFakeClient({
      results: [
        { gid: 'g', moreResults: true, results: [RESULT_A] },
        { gid: 'g', moreResults: false, results: [RESULT_A, RESULT_B] },
      ],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    expect(rowWithKey(LINK_A)).toBeInTheDocument();

    await settle(1000);

    // The server re-sends A on the next poll; the row must not be duplicated
    // and its key must not move, or every checkbox would reset each tick.
    expect(screen.getAllByTestId('ed2k-result-row')).toHaveLength(2);
    expect(rowWithKey(LINK_A)).toBeInTheDocument();
    expect(screen.queryByTestId('ed2k-source-count')).not.toBeInTheDocument();
  });
});

describe('downloading', () => {
  it('calls addUri with the ed2kLink of the row', async () => {
    const fake = createFakeClient({
      results: [{ gid: 'g', moreResults: false, results: [RESULT_A, RESULT_B] }],
      addUri: () => Promise.resolve(ok('new-task-gid')),
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    fireEvent.click(rowWithKey(LINK_A).querySelector('mdui-button') as HTMLElement);
    await settle();

    expect(fake.addUri).toHaveBeenCalledWith([LINK_A], {});
    expect(screen.getByText(/Added “alpha.mkv”/)).toBeInTheDocument();
  });

  it('disables Download for a result without an ed2kLink', async () => {
    const fake = createFakeClient({
      results: [
        {
          gid: 'g',
          moreResults: false,
          // The MD4 hash was not resolved, so there is no link to add.
          results: [raw({ name: 'mystery.bin', hash: 'CCCCCCCC', length: '7' })],
        },
      ],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    const button = screen.getByText('Download').closest('mdui-button') as HTMLElement;
    expect(button).toHaveAttribute('disabled');
    expect(screen.getByText(/did not resolve an ED2K link/)).toBeInTheDocument();

    fireEvent.click(button);
    await settle();
    expect(fake.addUri).not.toHaveBeenCalled();
  });

  it('aggregates failures in the bulk download', async () => {
    const fake = createFakeClient({
      results: [{ gid: 'g', moreResults: false, results: [RESULT_A, RESULT_B] }],
      addUri: (urls) =>
        Promise.resolve(
          urls[0] === LINK_A ? ok('gid-a') : fail('The file was not found on any server'),
        ),
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    for (const checkbox of [rowWithKey(LINK_A), rowWithKey(LINK_B)]) {
      toggleCheckbox(checkbox.querySelector('mdui-checkbox') as HTMLElement);
    }
    expect(screen.getByTestId('ed2k-selected-count')).toHaveTextContent('2 selected');

    fireEvent.click(screen.getByText('Download selected'));
    await settle();

    // One `addUri` per file, and the dead link did not abort the other one.
    // The order is the table's (size, descending), not the selection's.
    expect(fake.addUri).toHaveBeenCalledTimes(2);
    expect(fake.addUri.mock.calls).toEqual([[[LINK_B], {}], [[LINK_A], {}]]);
    // The snackbar reports the split rather than pretending it all worked.
    expect(screen.getByText('Added 1 of 2; 1 could not be added.')).toBeInTheDocument();
    // …and the selection is consumed so the same rows are not retried.
    expect(screen.getByTestId('ed2k-selected-count')).toHaveTextContent('0 selected');
  });

  it('forwards dir from the advanced options to addUri', async () => {
    // `dir` is a plain aria2 request option rather than one of the three ED2K
    // discovery options the form exposes, so this drives the table directly.
    const fake = createFakeClient({ addUri: () => Promise.resolve(ok('new-task-gid')) });
    attach(fake.client);

    render(
      <ResultsTable
        state={{ status: 'done', results: normalizeResults([RESULT_A]), moreResults: false, keyword: 'x' }}
        options={{ dir: '/downloads/ed2k' }}
      />,
    );
    await settle();

    fireEvent.click(rowWithKey(LINK_A).querySelector('mdui-button') as HTMLElement);
    await settle();

    expect(fake.addUri).toHaveBeenCalledWith([LINK_A], { dir: '/downloads/ed2k' });
  });

  it('sends no addUri options when dir is blank', async () => {
    const fake = createFakeClient({ addUri: () => Promise.resolve(ok('new-task-gid')) });
    attach(fake.client);

    render(
      <ResultsTable
        state={{ status: 'done', results: normalizeResults([RESULT_A]), moreResults: false, keyword: 'x' }}
        options={{ dir: '   ' }}
      />,
    );
    await settle();

    fireEvent.click(rowWithKey(LINK_A).querySelector('mdui-button') as HTMLElement);
    await settle();

    expect(fake.addUri).toHaveBeenCalledWith([LINK_A], {});
  });
});

describe('empty states', () => {
  it('shows "no search yet" before anything was asked for', async () => {
    attach(createFakeClient().client);

    render(<Ed2kSearchPage />);
    await settle();

    expect(screen.getByTestId('ed2k-empty-idle')).toBeInTheDocument();
    expect(screen.getByText('No search yet')).toBeInTheDocument();
  });

  it('shows "searching" while the network is queried with no hits yet', async () => {
    const fake = createFakeClient({ results: [{ gid: 'g', moreResults: true, results: [] }] });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    expect(screen.getByTestId('ed2k-empty-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('ed2k-streaming')).toBeInTheDocument();
    expect(screen.getByTestId('ed2k-result-count')).toHaveTextContent('0 results');
  });

  it('shows "no results" once the search finished empty', async () => {
    const fake = createFakeClient({ results: [{ gid: 'g', moreResults: false, results: [] }] });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();
    await settle(1000);

    expect(screen.getByTestId('ed2k-empty-none')).toBeInTheDocument();
    expect(screen.getByText(/Try a shorter or more common keyword/)).toBeInTheDocument();
  });

  it('shows the failure alert when ed2kSearch itself fails', async () => {
    const fake = createFakeClient({ search: fail('Bad request') });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    expect(screen.getByTestId('ed2k-error')).toHaveTextContent('The search failed');
    expect(screen.getByTestId('ed2k-error')).toHaveTextContent('Bad request');
    // A failure is not an empty result set.
    expect(screen.queryByTestId('ed2k-empty-none')).not.toBeInTheDocument();
  });
});

describe('table behaviour', () => {
  it('exposes aria-sort on the sortable headers only', async () => {
    const fake = createFakeClient({
      results: [{ gid: 'g', moreResults: false, results: [RESULT_A, RESULT_B] }],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    // The default sort is size, descending.
    expect(screen.getByTestId('ed2k-sort-fileLength').parentElement).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByTestId('ed2k-sort-filename').parentElement).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByTestId('ed2k-sort-sourceNetwork').parentElement).toHaveAttribute(
      'aria-sort',
      'none',
    );

    fireEvent.click(screen.getByTestId('ed2k-sort-filename'));
    expect(screen.getByTestId('ed2k-sort-filename').parentElement).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(screen.getAllByTestId('ed2k-result-row')[0].getAttribute('data-key')).toBe(LINK_A);

    fireEvent.click(screen.getByTestId('ed2k-sort-filename'));
    expect(screen.getAllByTestId('ed2k-result-row')[0].getAttribute('data-key')).toBe(LINK_B);
  });

  it('announces the streaming result count politely', async () => {
    const fake = createFakeClient({
      results: [{ gid: 'g', moreResults: false, results: [RESULT_A] }],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    const count = screen.getByTestId('ed2k-result-count');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(count).toHaveTextContent('1 results');
  });

  it('shows how many sources reported a deduplicated file', async () => {
    const fake = createFakeClient({
      results: [
        {
          gid: 'g',
          moreResults: false,
          results: [RESULT_A, { ...RESULT_A, sourceNetwork: 'second server' }],
        },
      ],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    expect(screen.getAllByTestId('ed2k-result-row')).toHaveLength(1);
    expect(screen.getByTestId('ed2k-source-count')).toHaveTextContent('2');
  });

  it('opens the detail dialog with every raw field', async () => {
    const fake = createFakeClient({
      results: [{ gid: 'g', moreResults: false, results: [RESULT_A] }],
    });
    attach(fake.client);

    render(<Ed2kSearchPage />);
    await settle();
    await search();

    fireEvent.click(screen.getByLabelText('Details'));
    await settle();

    expect(screen.getByTestId('ed2k-detail-filename')).toHaveTextContent('alpha.mkv');
    expect(screen.getByTestId('ed2k-detail-fileLength')).toHaveTextContent('100.00 B');
    expect(screen.getByTestId('ed2k-detail-fileHash')).toHaveTextContent('AAAAAAAA');
    expect(screen.getByTestId('ed2k-detail-sourceNetwork')).toHaveTextContent('eMule Security');
    expect(screen.getByTestId('ed2k-detail-mediaCodec')).toHaveTextContent('H.264');
    expect(screen.getByTestId('ed2k-detail-ed2kLink')).toHaveTextContent(LINK_A);
    expect(screen.getByText(/handed to aria2.addUri/)).toBeInTheDocument();
  });
});
