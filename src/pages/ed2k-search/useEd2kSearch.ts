/**
 * The ED2K search polling hook.
 *
 * `aria2.ed2kSearch` returns the GID of a **search task**, not a download, and
 * `aria2.getEd2kSearchResults` is the only way to read what it found. Results
 * are "collected asynchronously from configured ED2K servers and Kad bootstrap
 * nodes", so the right shape for this is a poll — and a poll has three failure
 * modes that this file exists to get right:
 *
 * 1. **Overlap.** A tick must never start while the previous
 *    `getEd2kSearchResults` is still in flight, or a slow ED2K server turns into
 *    a request storm the daemon eventually refuses. See the `inFlight` counter.
 * 2. **Liveness.** The interval is torn down on unmount, on `stop()`, and the
 *    moment `moreResults` turns `false` — the manual defines `moreResults` as
 *    "a server indicates more search results are available", so `false` is the
 *    completion signal.
 * 3. **The wrong daemon.** `ed2kSearch` is an aria2-next-only method; asking
 *    stock aria2 for it just yields "Method not found". The hook gates on
 *    `getVersion()` up front instead, and `start` refuses.
 *
 * `state.error` is always an **i18n key**, never pre-rendered text: a known
 * `rpc.error.*` tip from {@link describeError}, the raw aria2 message when there
 * is no tip, or one of the `ed2k.error.*` keys below. The page resolves it with
 * `t()`, which falls back to the message itself for the raw case.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError, isUnauthorized, mapRpcError } from '@/rpc/errors';
import type { Aria2Client } from '@/rpc/contract';
import { useRpcStore } from '@/store/rpc-store';
import { mergeResults, normalizeResults } from './format';
import type { NormalizedEd2kResult } from './format';

/** How often the results are re-read while a search is running. */
export const DEFAULT_POLL_INTERVAL_MS = 1000;

/** `getVersion().product` for a daemon that implements the ED2K RPC contract. */
export const ARIA2_NEXT_PRODUCT = 'aria2-next';

/** The `enabledFeatures` entry that gates the whole ED2K surface. */
export const ED2K_FEATURE = 'ED2K';

/** i18n keys this hook raises itself (see {@link Ed2kSearchState.error}). */
export const ED2K_ERROR_UNSUPPORTED = 'ed2k.error.unsupported';
export const ED2K_ERROR_NOT_CONNECTED = 'ed2k.error.not-connected';
export const ED2K_ERROR_EMPTY_KEYWORD = 'ed2k.error.empty-keyword';

/**
 * Whether the connected daemon can serve ED2K searches at all.
 *
 * `unknown` is the pre-flight state — the page renders a neutral "checking"
 * state rather than flashing the disabled copy on every route change.
 */
export type Ed2kSupport = 'unknown' | 'supported' | 'unsupported';

/** Why {@link Ed2kSearchState.support} is `unsupported`. */
export type Ed2kSupportReason = 'not-aria2-next' | 'feature-disabled' | 'unauthorized' | 'version-failed' | 'no-daemon';

export interface Ed2kSearchState {
  /** The keyword of the current (or last) search. */
  keyword: string;
  /** GID of the search *task*; never a download GID. */
  gid: string | null;
  results: NormalizedEd2kResult[];
  /** The server's own "more results may be available" flag. */
  moreResults: boolean;
  status: 'idle' | 'starting' | 'searching' | 'done' | 'error';
  /** An i18n key — see the module comment. */
  error?: string;
  start(keyword: string, options?: Record<string, string>): Promise<void>;
  stop(): void;
  clear(): void;
  refreshNow(): void;

  /* --- additive: what the page needs to render its disabled state --- */
  support: Ed2kSupport;
  supportReason?: Ed2kSupportReason;
  /** Re-runs the `getVersion()` gate (mount, and after a hot profile swap). */
  checkSupport(): Promise<Ed2kSupport>;
}

export interface UseEd2kSearchOptions {
  pollIntervalMs?: number;
  /**
   * Client override. The page always takes the store's client; this exists so a
   * test can drive the hook without touching the process-wide singleton.
   */
  client?: Aria2Client | null;
}

interface InternalState {
  keyword: string;
  gid: string | null;
  results: NormalizedEd2kResult[];
  moreResults: boolean;
  status: Ed2kSearchState['status'];
  error?: string;
}

const INITIAL: InternalState = {
  keyword: '',
  gid: null,
  results: [],
  moreResults: false,
  status: 'idle',
};

/**
 * `true` when `getVersion()` says this daemon speaks the aria2-next ED2K
 * contract. Pure, so the page, the hook and the tests can never disagree.
 */
export function isEd2kEnabled(version: {
  product?: string;
  enabledFeatures?: readonly string[];
} | null | undefined): boolean {
  return (
    !!version &&
    version.product === ARIA2_NEXT_PRODUCT &&
    Array.isArray(version.enabledFeatures) &&
    version.enabledFeatures.includes(ED2K_FEATURE)
  );
}

/**
 * Drops the blank option entries a form produces, so an untouched Advanced
 * section sends `{}` rather than `{'ed2k-server': ''}` — an empty value is a
 * *request* to clear a global option on the daemon, not a no-op.
 */
export function compactOptions(options: Record<string, string> | undefined): Record<string, string> {
  const compact: Record<string, string> = {};

  for (const [key, value] of Object.entries(options ?? {})) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed !== '') {
      compact[key] = trimmed;
    }
  }

  return compact;
}

export function useEd2kSearch(options: UseEd2kSearchOptions = {}): Ed2kSearchState {
  const { pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, client: clientOverride } = options;

  const storeClient = useRpcStore((state) => state.client);
  const client = clientOverride !== undefined ? clientOverride : storeClient;

  const [state, setState] = useState<InternalState>(INITIAL);
  const [support, setSupport] = useState<Ed2kSupport>('unknown');
  const [supportReason, setSupportReason] = useState<Ed2kSupportReason | undefined>(undefined);

  /** Refs, so the async paths never close over a stale render's values. */
  const clientRef = useRef<Aria2Client | null>(client);
  const gidRef = useRef<string | null>(null);
  /**
   * Number of polls currently in flight. A **count** rather than a boolean: an
   * `ed2kSearch`/`clear()` between two overlapping requests must not be able to
   * reset the guard while the older call is still running.
   */
  const inFlight = useRef(0);
  /** Bumped on every start/stop/clear, so a late answer is discarded. */
  const generation = useRef(0);
  /** The client a `getVersion()` gate was last run against; `null` = never. */
  const supportCheckedFor = useRef<{ client: Aria2Client | null } | null>(null);
  const supportRef = useRef<Ed2kSupport>('unknown');

  clientRef.current = client;
  supportRef.current = support;

  /* ---------------------------------------------------------------- */
  /* support gate                                                     */
  /* ---------------------------------------------------------------- */

  const checkSupport = useCallback(async (): Promise<Ed2kSupport> => {
    const active = clientRef.current;

    // Already validated against this very daemon — `start` calls this on every
    // search and `getVersion()` is not free.
    if (supportCheckedFor.current?.client === active && supportRef.current === 'supported') {
      return 'supported';
    }

    let next: Ed2kSupport = 'unsupported';
    let reason: Ed2kSupportReason;

    if (!active) {
      reason = 'no-daemon';
    } else {
      const version = await active.getVersion();

      if (!version.success) {
        reason = isUnauthorized(mapRpcError(version.error)) ? 'unauthorized' : 'version-failed';
      } else if (isEd2kEnabled(version.data)) {
        next = 'supported';
        reason = 'no-daemon';
      } else {
        reason = version.data.product === ARIA2_NEXT_PRODUCT ? 'feature-disabled' : 'not-aria2-next';
      }
    }

    supportCheckedFor.current = { client: active };
    supportRef.current = next;
    setSupport(next);
    setSupportReason(next === 'supported' ? undefined : reason);
    return next;
  }, []);

  // Re-check whenever the daemon changes (hot profile switch).
  useEffect(() => {
    if (supportCheckedFor.current?.client === client) {
      return;
    }
    void checkSupport();
  }, [client, checkSupport]);

  /* ---------------------------------------------------------------- */
  /* one poll                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Reads the results for the current gid.
   *
   * Everything it touches is a ref or a functional `setState`, so it is safe to
   * call from an interval, from `refreshNow()`, and from a promise that
   * resolves after the component is gone.
   */
  const poll = useCallback(async (): Promise<void> => {
    const active = clientRef.current;
    const gid = gidRef.current;

    // A call already in flight: skip this tick rather than stacking on top of it.
    if (!active || !gid || inFlight.current > 0) {
      return;
    }

    const token = generation.current;
    inFlight.current += 1;

    try {
      const result = await active.getEd2kSearchResults(gid);

      // `start()` / `stop()` / `clear()` ran while we were waiting.
      if (token !== generation.current) {
        return;
      }

      if (!result.success) {
        setState((previous) => ({
          ...previous,
          // `moreResults` is the completion signal, so an error ends the search
          // too: the `error` status tears the interval down.
          status: 'error',
          moreResults: false,
          error: describeError(mapRpcError(result.error)),
        }));
        return;
      }

      const incoming = normalizeResults(result.data?.results);
      const moreResults = result.data?.moreResults === true;

      setState((previous) => ({
        ...previous,
        results: mergeResults(previous.results, incoming),
        moreResults,
        status: moreResults ? 'searching' : 'done',
        error: undefined,
      }));
    } catch (error) {
      if (token !== generation.current) {
        return;
      }
      setState((previous) => ({
        ...previous,
        status: 'error',
        moreResults: false,
        error: describeError(mapRpcError(error)),
      }));
    } finally {
      inFlight.current -= 1;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* the interval                                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (state.status !== 'searching' || !state.gid) {
      return;
    }

    let cancelled = false;
    const tick = (): void => {
      if (!cancelled) {
        void poll();
      }
    };

    // Poll immediately so the first rows appear without waiting a whole tick.
    tick();
    const timer = window.setInterval(tick, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [state.status, state.gid, pollIntervalMs, poll]);

  /* ---------------------------------------------------------------- */
  /* commands                                                         */
  /* ---------------------------------------------------------------- */

  const start = useCallback(
    async (keyword: string, startOptions?: Record<string, string>): Promise<void> => {
      const active = clientRef.current;
      const trimmed = (keyword ?? '').trim();

      if (!active) {
        generation.current += 1;
        setState({ ...INITIAL, status: 'error', error: ED2K_ERROR_NOT_CONNECTED });
        return;
      }

      if (trimmed === '') {
        setState((previous) => ({ ...previous, status: 'error', error: ED2K_ERROR_EMPTY_KEYWORD }));
        return;
      }

      // Refuse *before* issuing the call the daemon would reject anyway.
      if ((await checkSupport()) !== 'supported') {
        generation.current += 1;
        setState({ ...INITIAL, keyword: trimmed, status: 'error', error: ED2K_ERROR_UNSUPPORTED });
        return;
      }

      generation.current += 1;
      const token = generation.current;

      setState({ ...INITIAL, keyword: trimmed, status: 'starting' });

      const result = await active.ed2kSearch(trimmed, compactOptions(startOptions));

      // The user cleared or started something else while the call was in flight.
      if (token !== generation.current) {
        return;
      }

      if (!result.success) {
        setState((previous) => ({
          ...previous,
          status: 'error',
          error: describeError(mapRpcError(result.error)),
        }));
        return;
      }

      gidRef.current = result.data;
      setState((previous) => ({ ...previous, gid: result.data, status: 'searching' }));
    },
    [checkSupport],
  );

  const stop = useCallback((): void => {
    // Bumping the generation makes any in-flight poll discard its answer, and
    // the `idle` status tears the interval down. Collected results are kept:
    // stopping a search should not throw away what it already found.
    generation.current += 1;
    gidRef.current = null;
    setState((previous) => ({ ...previous, gid: null, moreResults: false, status: 'idle' }));
  }, []);

  const clear = useCallback((): void => {
    generation.current += 1;
    gidRef.current = null;
    setState(INITIAL);
  }, []);

  const refreshNow = useCallback((): void => {
    void poll();
  }, [poll]);

  useEffect(() => {
    return () => {
      generation.current += 1;
      gidRef.current = null;
    };
  }, []);

  /* ---------------------------------------------------------------- */

  return useMemo<Ed2kSearchState>(
    () => ({
      ...state,
      start,
      stop,
      clear,
      refreshNow,
      support,
      ...(supportReason === undefined ? {} : { supportReason }),
      checkSupport,
    }),
    [state, start, stop, clear, refreshNow, support, supportReason, checkSupport],
  );
}

export default useEd2kSearch;
