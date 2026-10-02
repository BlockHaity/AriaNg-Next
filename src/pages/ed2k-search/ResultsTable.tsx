/**
 * The ED2K result table.
 *
 * mdui has no data-table component, so this is a `role="grid"` built from a CSS
 * grid and MD3 tokens (`styles.css`), mirroring how the task list is assembled.
 * The grid — not the row — owns sorting, selection and the download actions.
 *
 * ## Why the download path is a loop and not `addUriMany`
 *
 * `aria2.addUri` takes an **array of mirrors for one file**, not an array of
 * files: batching several results into a single call would make aria2 treat them
 * as alternative sources for a single output name. Each result is therefore its
 * own `addUri([ed2kLink])` call. The batch helper would work too, but a dead link
 * is the normal case here — ED2K hits go stale quickly — so the failures are
 * aggregated per link rather than failing the whole batch.
 *
 * ## Why `sourceCount` and the keys matter
 *
 * `getEd2kSearchResults` answers with the **accumulated** set, so rows are keyed
 * by file identity (see `format.resultKey`) and re-created only when the file
 * itself changes. That is what keeps a checkbox in place while results stream in.
 */

import { useCallback, useMemo, useState } from 'react';

import { describeError, mapRpcError } from '@/rpc/errors';
import { getAria2ClientOrNull } from '@/rpc';
import type { Aria2OptionMap } from '@/rpc/types';
import { copyText } from '@/utils/clipboard';
import { appUrl, Routes } from '@/app/route-paths';
import { MduiButton, MduiCheckbox, MduiIcon, MduiIconButton, MduiSnackbar } from '@/ui/mdui';
import type { NormalizedEd2kResult } from './format';
import { ResultRow } from './ResultRow';
import { ResultDetailDialog } from './ResultDetailDialog';
import { useLocalTranslate } from './index';
import type { Ed2kSearchState } from './useEd2kSearch';

export type Ed2kSortKey = 'filename' | 'fileLength' | 'sourceNetwork';
export type Ed2kSortDirection = 'asc' | 'desc';

export interface ResultsTableProps {
  state: Pick<
    Ed2kSearchState,
    'status' | 'error' | 'results' | 'moreResults' | 'keyword'
  >;
  /** Advanced search options; `dir` is forwarded to `addUri` when present. */
  options?: Aria2OptionMap;
  onRetry?: () => void;
  /** Re-reads the current search's results once, without restarting it. */
  onRefresh?: () => void;
}

interface SortState {
  key: Ed2kSortKey;
  direction: Ed2kSortDirection;
}

interface SnackbarState {
  message: string;
  /** Trailing action label, e.g. "Open" for a freshly added download. */
  action?: string;
  onAction?: () => void;
}

const SORTABLE_COLUMNS: readonly { key: Ed2kSortKey; labelKey: string; cell: string }[] = [
  { key: 'filename', labelKey: 'File Name', cell: 'name' },
  { key: 'fileLength', labelKey: 'File Size', cell: 'size' },
  { key: 'sourceNetwork', labelKey: 'ed2k.column.sourceNetwork', cell: 'network' },
];

/**
 * `aria-sort` values, per the ARIA table-sorting pattern: a column that is not
 * the sort column reports `none`, and the direction is reported on the active one
 * only.
 */
function ariaSortFor(sort: SortState, key: Ed2kSortKey): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) {
    return 'none';
  }
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** Case-insensitive, locale-aware compare; missing values sort last. */
function compareValues(a: NormalizedEd2kResult, b: NormalizedEd2kResult, key: Ed2kSortKey): number {
  if (key === 'fileLength') {
    return a.fileLength - b.fileLength;
  }

  const left = key === 'filename' ? a.filename : (a.sourceNetwork ?? '');
  const right = key === 'filename' ? b.filename : (b.sourceNetwork ?? '');

  // A row with no value for the sorted column is noise; keep it at the end
  // regardless of direction rather than interleaving it with real values.
  if (!left && right) return 1;
  if (left && !right) return -1;

  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

export function ResultsTable({ state, options, onRetry, onRefresh }: ResultsTableProps) {
  const t = useLocalTranslate();
  const { status, error, results, moreResults, keyword } = state;

  const [sort, setSort] = useState<SortState>({ key: 'fileLength', direction: 'desc' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [detail, setDetail] = useState<NormalizedEd2kResult | null>(null);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...results].sort((a, b) => compareValues(a, b, sort.key) * factor);
  }, [results, sort]);

  const selectedResults = useMemo(
    () => sorted.filter((result) => selected.has(result.key) && result.isDownloadable),
    [sorted, selected],
  );

  const allSelected = sorted.length > 0 && sorted.every((result) => selected.has(result.key));

  /* ---------------------------------------------------------------- */
  /* sorting                                                           */
  /* ---------------------------------------------------------------- */

  const toggleSort = useCallback((key: Ed2kSortKey) => {
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'fileLength' ? 'desc' : 'asc' },
    );
  }, []);

  /* ---------------------------------------------------------------- */
  /* selection                                                         */
  /* ---------------------------------------------------------------- */

  const toggleRow = useCallback((result: NormalizedEd2kResult) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(result.key)) {
        next.delete(result.key);
      } else {
        next.add(result.key);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (sorted.every((result) => next.has(result.key))) {
        for (const result of sorted) {
          next.delete(result.key);
        }
      } else {
        for (const result of sorted) {
          next.add(result.key);
        }
      }
      return next;
    });
  }, [sorted]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  /* ---------------------------------------------------------------- */
  /* actions                                                           */
  /* ---------------------------------------------------------------- */

  const copyLink = useCallback(
    (result: NormalizedEd2kResult) => {
      if (!result.ed2kLink) {
        setSnackbar({ message: t('ed2k.copyFailed') });
        return;
      }
      void copyText(result.ed2kLink).then((ok) =>
        setSnackbar({ message: ok ? t('ed2k.copied') : t('ed2k.copyFailed') }),
      );
    },
    [t],
  );

  /** The `dir` from the advanced options is honoured, nothing else is. */
  const downloadOptions = useMemo((): Aria2OptionMap => {
    const dir = options?.dir?.trim();
    return dir ? { dir } : {};
  }, [options]);

  const downloadOne = useCallback(
    async (result: NormalizedEd2kResult): Promise<void> => {
      const link = result.ed2kLink;
      if (!link) {
        return;
      }

      const client = getAria2ClientOrNull();

      if (!client) {
        setSnackbar({
          message: t('ed2k.download.failed', {
            filename: result.filename,
            error: t('ed2k.notConnected'),
          }),
        });
        return;
      }

      setBusy(true);

      try {
        const outcome = await client.addUri([link], downloadOptions);

        if (!outcome.success) {
          setSnackbar({
            message: t('ed2k.download.failed', {
              filename: result.filename,
              error: describeError(mapRpcError(outcome.error)),
            }),
          });
          return;
        }

        const gid = outcome.data;
        setSnackbar({
          message: t('ed2k.download.started', { filename: result.filename }),
          action: t('ed2k.download.open'),
          onAction: () => {
            if (typeof window !== 'undefined') {
              window.location.hash = appUrl(Routes.TaskDetail.replace(':gid', encodeURIComponent(gid)));
            }
          },
        });
      } finally {
        setBusy(false);
      }
    },
    [downloadOptions, t],
  );

  /**
   * The bulk action. Each link is its own `addUri` call and each failure is
   * counted rather than aborting the rest — a stale ED2K link is expected, not
   * exceptional.
   */
  const downloadSelected = useCallback(async (): Promise<void> => {
    const client = getAria2ClientOrNull();

    if (!client || selectedResults.length === 0) {
      return;
    }

    setBusy(true);

    let ok = 0;
    let failed = 0;
    let lastGid: string | null = null;

    for (const result of selectedResults) {
      if (!result.ed2kLink) {
        failed += 1;
        continue;
      }

      try {
        const outcome = await client.addUri([result.ed2kLink], downloadOptions);
        if (outcome.success) {
          ok += 1;
          lastGid = outcome.data;
        } else {
          failed += 1;
        }
      } catch {
        // `addUri` is total in the client, but a transport that throws must not
        // take the remaining links down with it.
        failed += 1;
      }
    }

    setBusy(false);
    clearSelection();

    const total = ok + failed;
    const message =
      ok === total
        ? t('ed2k.download.bulkOk', { ok, total })
        : ok === 0
          ? t('ed2k.download.bulkFailed', { total })
          : t('ed2k.download.bulkPartial', { ok, total, failed });

    const openGid = lastGid;

    setSnackbar({
      message,
      ...(openGid === null
        ? {}
        : {
            action: t('ed2k.download.open'),
            onAction: () => {
              if (typeof window !== 'undefined') {
                window.location.hash = appUrl(
                  Routes.TaskDetail.replace(':gid', encodeURIComponent(openGid)),
                );
              }
            },
          }),
    });
  }, [clearSelection, downloadOptions, selectedResults, t]);

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * The server’s own "more results may be available" flag is what keeps the
   * streaming hint up: `status` alone cannot tell "still querying" from
   * "finished, and there happen to be no more".
   */
  const streaming = moreResults || status === 'searching' || status === 'starting';

  return (
    <section className="ed2k-results" aria-label={t('ed2k.results')}>
      <header className="ed2k-results__head">
        <h2 className="ed2k-results__title">{t('ed2k.results')}</h2>

        {/* The count changes on every poll while results stream in, so it is
            announced politely rather than interrupting the user. */}
        <p
          className="ed2k-results__count"
          aria-live="polite"
          aria-atomic="true"
          data-testid="ed2k-result-count"
        >
          {streaming ? (
            <span className="ed2k-results__streaming" data-testid="ed2k-streaming">
              <MduiIcon name="refresh" size="1rem" />
              {t('ed2k.streaming')}
            </span>
          ) : null}
          {t('ed2k.resultCount', { count: results.length })}
        </p>

        <div className="ed2k-results__toolbar">
          <MduiCheckbox
            className="ed2k-results__select-all"
            checked={allSelected}
            indeterminate={!allSelected && selected.size > 0}
            onChange={toggleAll}
            label={t('ed2k.selectAll')}
          />

          <span className="ed2k-results__selected" data-testid="ed2k-selected-count">
            {t('ed2k.selectedCount', { count: selected.size })}
          </span>

          <MduiIconButton
            icon="refresh"
            label={t('ed2k.refresh')}
            disabled={keyword.trim() === ''}
            onClick={() => onRefresh?.()}
          />

          <MduiButton
            variant="filled"
            icon="cloud-download"
            disabled={busy || selectedResults.length === 0}
            onClick={() => void downloadSelected()}
          >
            {t('ed2k.downloadSelected')}
          </MduiButton>

          <MduiButton variant="text" disabled={selected.size === 0} onClick={clearSelection}>
            {t('ed2k.clearSelection')}
          </MduiButton>
        </div>
      </header>

      {status === 'error' ? (
        <div className="ed2k-results__error" role="alert" data-testid="ed2k-error">
          <MduiIcon name="error" size="1.5rem" />
          <div>
            <p className="ed2k-results__error-title">{t('ed2k.error.title')}</p>
            <p className="ed2k-results__error-body">{error ? t(error) : ''}</p>
          </div>
          {onRetry ? (
            <MduiButton variant="outlined" icon="refresh" onClick={onRetry}>
              {t('ed2k.error.retry')}
            </MduiButton>
          ) : null}
        </div>
      ) : null}

      {/* An errored search has no results to show, and the alert above already
          says why — an extra "no results" panel on top would contradict it. */}
      {results.length === 0 && status !== 'error' ? (
        <EmptyState status={status} keyword={keyword} streaming={streaming} />
      ) : null}

      {results.length > 0 ? (
        <div role="grid" className="ed2k-grid" aria-label={t('ed2k.results')}>
          <div role="row" className="ed2k-grid__header">
            <div role="columnheader" className="ed2k-grid__cell ed2k-grid__cell--select" />

            {SORTABLE_COLUMNS.map((column) => (
              <div
                key={column.key}
                role="columnheader"
                className={`ed2k-grid__cell ed2k-grid__cell--${column.cell} ed2k-grid__cell--sortable`}
                aria-sort={ariaSortFor(sort, column.key)}
              >
                <button
                  type="button"
                  className="ed2k-grid__sort"
                  onClick={() => toggleSort(column.key)}
                  data-testid={`ed2k-sort-${column.key}`}
                >
                  {t(column.labelKey)}
                  {sort.key === column.key ? (
                    <MduiIcon name={sort.direction === 'asc' ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size="1rem" />
                  ) : null}
                </button>
              </div>
            ))}

            <div role="columnheader" className="ed2k-grid__cell ed2k-grid__cell--actions">
              {t('ed2k.column.actions')}
            </div>
          </div>

          {sorted.map((result) => (
            <ResultRow
              key={result.key}
              result={result}
              selected={selected.has(result.key)}
              onToggle={toggleRow}
              onDownload={(row) => void downloadOne(row)}
              onCopyLink={copyLink}
              onDetails={setDetail}
            />
          ))}
        </div>
      ) : null}

      <ResultDetailDialog result={detail} onClose={() => setDetail(null)} />

      <MduiSnackbar
        open={snackbar !== null}
        message={snackbar?.message ?? ''}
        action={snackbar?.action}
        onActionClick={() => {
          snackbar?.onAction?.();
          setSnackbar(null);
        }}
        onClosed={() => setSnackbar(null)}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* empty states                                                         */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  status: Ed2kSearchState['status'];
  keyword: string;
  streaming: boolean;
}

/**
 * Four distinct empties, because they mean four different things to the user:
 * nothing was asked for, the network is being queried, the query came back
 * empty, or the query failed (handled above, as an alert rather than an empty).
 */
function EmptyState({ status, keyword, streaming }: EmptyStateProps) {
  const t = useLocalTranslate();

  const variant: 'idle' | 'waiting' | 'none' =
    streaming && keyword.trim() !== '' ? 'waiting' : status === 'idle' ? 'idle' : 'none';

  const title = t(`ed2k.empty.${variant}.title`);
  const body = t(`ed2k.empty.${variant}.body`);

  return (
    <div
      className="ed2k-results__empty"
      data-testid={`ed2k-empty-${variant}`}
      role={variant === 'waiting' ? 'status' : undefined}
    >
      <MduiIcon
        name={variant === 'waiting' ? 'hub' : variant === 'none' ? 'science' : 'search'}
        size="2.5rem"
      />
      <p className="ed2k-results__empty-title">{title}</p>
      <p className="ed2k-results__empty-body">{body}</p>
    </div>
  );
}

export default ResultsTable;
