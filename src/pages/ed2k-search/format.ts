/**
 * Pure helpers for the aria2-next ED2K search page.
 *
 * Nothing in this module touches React, the RPC client or the DOM, so every
 * branch the search page depends on — including the malformed-payload branches
 * — is unit-testable in isolation.
 *
 * ## The contract, and why so much of this is defensive
 *
 * From `aria2-next`'s manual (`docs/manual/en/aria2-next.rst`):
 *
 * ```
 * aria2.ed2kSearch([secret], keyword[, options])   -> gid of the *search task*
 * aria2.getEd2kSearchResults([secret], gid)        -> { gid, moreResults, results[] }
 * ```
 *
 * Two facts from that section shape the whole module:
 *
 * 1. *"Search results are collected asynchronously from configured ED2K servers
 *    and Kad bootstrap nodes."* The result array therefore **grows between
 *    polls** and every snapshot can be a partial one, so nothing may be assumed
 *    about a row's fields.
 * 2. *"Numeric values are returned as decimal strings, matching existing aria2
 *    RPC conventions."* Every scalar crosses the wire as a string.
 *
 * `getEd2kSearchResults` also reports the **accumulated** set rather than a
 * delta, which is why {@link mergeResults} (used by the polling hook) is
 * idempotent — see the comment on it for why `dedupeResults` alone cannot be.
 */

import { classifyExtension } from '@/config/file-types';
import type { FileTypeCategory } from '@/config/file-types';
import { readableVolume } from '@/i18n/format';
import type { Aria2Ed2kSearchResult } from '@/rpc/types';

/* ------------------------------------------------------------------ */
/* placeholders                                                        */
/* ------------------------------------------------------------------ */

/**
 * AriaNg renders `--` for a field it has no value for, so the size cell uses
 * that; a result with no name at all is rare enough that a word is better.
 */
export const UNKNOWN_SIZE = '-';

export const UNKNOWN_FILENAME = 'Unknown file name';

/* ------------------------------------------------------------------ */
/* result shape                                                        */
/* ------------------------------------------------------------------ */

export interface NormalizedEd2kResult {
  /**
   * Stable React key.
   *
   * Rows stream in over several polls, so the key must be derived from the
   * *identity* of the file and never from the position in the array — otherwise
   * every poll would remount every row and throw away focus and checkbox state.
   * See {@link resultKey}.
   */
  key: string;
  /**
   * The value handed to `aria2.addUri`. Absent when aria2-next could not
   * resolve the MD4 hash for this result — see {@link isDownloadable}.
   */
  ed2kLink?: string;
  filename: string;
  /** Always a number, `0` when the server reported nothing usable. */
  fileLength: number;
  fileHash?: string;
  mediaCodec?: string;
  sourceNetwork?: string;
  /** Derived from the filename through the shared AriaNg file-type table. */
  category: FileTypeCategory;
  /**
   * aria2-next resolves the MD4 hash lazily; a search hit without an `ed2kLink`
   * cannot be turned into a download, so the action is disabled rather than
   * fabricating a link (a wrong MD4 hash would poison the whole swarm).
   */
  isDownloadable: boolean;
  /** How many sources reported this file. Seeded from the server, grown by dedupe. */
  sourceCount: number;
}

/* ------------------------------------------------------------------ */
/* field extraction                                                    */
/* ------------------------------------------------------------------ */

/**
 * The manual names the result fields `hash`, `name` and `length`
 * ("Each entry in ``results`` contains … ``hash``, ``name``, ``length``,
 * ``sourceCount`` …"), while `Aria2Ed2kSearchResult` models the same data as
 * `fileHash`, `filename` and `fileLength`.
 *
 * Both spellings are accepted so the UI keeps working whichever one the daemon
 * actually emits; the canonical (local) name wins when both are present.
 */
const FIELD_ALIASES = {
  ed2kLink: ['ed2kLink'],
  filename: ['filename', 'name'],
  fileLength: ['fileLength', 'length'],
  fileHash: ['fileHash', 'hash'],
  mediaCodec: ['mediaCodec'],
  sourceNetwork: ['sourceNetwork'],
  sourceCount: ['sourceCount'],
} as const satisfies Record<string, readonly string[]>;

/**
 * First usable value among `keys`, coerced to a trimmed string.
 *
 * Every JSON-RPC scalar arrives as a string, but a hand-rolled or proxied
 * backend can send a number, and a boolean is a legitimate value for a
 * flag-ish field — so all three are accepted rather than trusted.
 */
function pickString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') return trimmed;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return String(value);
    }
  }

  return undefined;
}

/**
 * Coerces a wire scalar to a byte count.
 *
 * Anything unparseable, negative, `NaN` or infinite collapses to `0` — a bogus
 * size must never render as `NaN B` in the table.
 */
export function toFileLength(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }
  if (typeof value !== 'string') {
    return 0;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return 0;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

/** The extension of a file name, leading dot included, or `''`. */
export function extensionOf(filename: string): string {
  const value = typeof filename === 'string' ? filename : '';
  const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const base = separator >= 0 ? value.slice(separator + 1) : value;
  const dot = base.lastIndexOf('.');

  // `dot <= 0` keeps dotfiles (`.bashrc`) extension-less, and `dot` at the very
  // end means a trailing dot, which is not an extension either.
  if (dot <= 0 || dot === base.length - 1) {
    return '';
  }

  return base.slice(dot);
}

/**
 * The stable identity of a result.
 *
 * `ed2kLink` already contains the file name, size and MD4 hash, so it is the
 * identity. Without a link the hash plus the length is the next best thing
 * (two different files can share a *name*, but not a hash). With neither there
 * is nothing to key on, and the row falls back to its position — documented as
 * the one case where the key is not stable across polls.
 */
export function resultKey(
  ed2kLink: string | undefined,
  fileHash: string | undefined,
  fileLength: number,
  index: number,
): string {
  if (ed2kLink) {
    return ed2kLink;
  }
  if (fileHash) {
    return `hash:${fileHash.toLowerCase()}:${fileLength}`;
  }
  return `anon:${index}`;
}

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Normalises one raw search hit.
 *
 * Returns `null` for anything that is not an object (a `null` / `undefined`
 * entry in the array, a stray number, …) and for an object that carries no
 * identity whatsoever — no link, no hash **and** no name. Such an entry has
 * nothing to show, nothing to dedupe on and nothing to download, so rendering
 * it would only produce a permanently disabled blank row.
 *
 * `index` is only used for the anonymous key fallback, and is the position in
 * the array the entry arrived in.
 */
export function normalizeResult(
  raw: Aria2Ed2kSearchResult | undefined,
  index: number,
): NormalizedEd2kResult | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const source = raw as unknown as Record<string, unknown>;

  const ed2kLink = pickString(source, FIELD_ALIASES.ed2kLink);
  const fileHash = pickString(source, FIELD_ALIASES.fileHash);
  const rawFilename = pickString(source, FIELD_ALIASES.filename);

  if (!ed2kLink && !fileHash && !rawFilename) {
    return null;
  }

  const filename = rawFilename ?? UNKNOWN_FILENAME;
  const fileLength = toFileLength(pickString(source, FIELD_ALIASES.fileLength));
  const rawSourceCount = pickString(source, FIELD_ALIASES.sourceCount);
  const parsedSourceCount = rawSourceCount === undefined ? 0 : Number(rawSourceCount);
  const sourceCount =
    Number.isFinite(parsedSourceCount) && parsedSourceCount > 1 ? Math.trunc(parsedSourceCount) : 1;

  return {
    key: resultKey(ed2kLink, fileHash, fileLength, index),
    ed2kLink,
    filename,
    fileLength,
    fileHash,
    mediaCodec: pickString(source, FIELD_ALIASES.mediaCodec),
    sourceNetwork: pickString(source, FIELD_ALIASES.sourceNetwork),
    category: classifyExtension(extensionOf(filename)),
    // The MD4 hash is resolved lazily by aria2-next, so a hit can come back
    // without a usable link. Never synthesise one.
    isDownloadable: ed2kLink !== undefined,
    sourceCount,
  };
}

/**
 * Normalises a whole snapshot, dropping everything unusable.
 *
 * The array comes straight off the wire and grows while the search runs, so
 * `null`, `undefined`, non-objects and field-less objects are all expected
 * input rather than errors.
 */
export function normalizeResults(raw: readonly unknown[] | undefined): NormalizedEd2kResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: NormalizedEd2kResult[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const entry = normalizeResult(raw[index] as Aria2Ed2kSearchResult | undefined, index);
    if (entry) {
      normalized.push(entry);
    }
  }

  return normalized;
}

/* ------------------------------------------------------------------ */
/* dedupe                                                              */
/* ------------------------------------------------------------------ */

/**
 * Merge strategy for two hits that describe the same file.
 *
 * - `accumulate` — used inside a **single** snapshot: ED2K servers routinely
 *   report the same file from several sources, so the entries are summed.
 * - `replace` — used when folding a **fresh poll** into what is already shown:
 *   the server reports the *accumulated* set, so re-adding an entry it already
 *   sent must be a no-op rather than a second vote.
 */
export type MergeMode = 'accumulate' | 'replace';

/**
 * What two hits are matched on: the MD4 hash when present, else the link.
 *
 * `null` means "no identity" — such entries are never merged, because nothing
 * says they are the same file.
 */
function identityOf(result: NormalizedEd2kResult): string | null {
  if (result.fileHash) {
    return `hash:${result.fileHash.toLowerCase()}`;
  }
  if (result.ed2kLink) {
    return `link:${result.ed2kLink}`;
  }
  return null;
}

function mergeOne(
  base: NormalizedEd2kResult,
  next: NormalizedEd2kResult,
  mode: MergeMode,
): NormalizedEd2kResult {
  const preferNext = mode === 'replace';
  const text = (a: string | undefined, b: string | undefined): string | undefined =>
    preferNext ? (b ?? a) : (a ?? b);

  const length = (a: number, b: number): number => (preferNext ? (b > 0 ? b : a) : a > 0 ? a : b);
  const ed2kLink = text(base.ed2kLink, next.ed2kLink);
  const filename = text(base.filename, next.filename) ?? UNKNOWN_FILENAME;

  return {
    // Deliberately the *first* entry's key: changing it mid-flight would remount
    // the row and lose the user's checkbox state.
    key: base.key,
    ed2kLink,
    filename,
    fileLength: length(base.fileLength, next.fileLength),
    fileHash: text(base.fileHash, next.fileHash),
    mediaCodec: text(base.mediaCodec, next.mediaCodec),
    sourceNetwork: text(base.sourceNetwork, next.sourceNetwork),
    category: classifyExtension(extensionOf(filename)),
    isDownloadable: ed2kLink !== undefined,
    sourceCount:
      mode === 'accumulate'
        ? base.sourceCount + next.sourceCount
        : Math.max(base.sourceCount, next.sourceCount),
  };
}

function mergeAll(
  results: readonly NormalizedEd2kResult[],
  mode: MergeMode,
): NormalizedEd2kResult[] {
  const merged: NormalizedEd2kResult[] = [];
  const seen = new Map<string, number>();

  for (const result of results) {
    const identity = identityOf(result);

    if (identity === null) {
      merged.push(result);
      continue;
    }

    const at = seen.get(identity);

    if (at === undefined) {
      seen.set(identity, merged.length);
      merged.push(result);
      continue;
    }

    merged[at] = mergeOne(merged[at], result, mode);
  }

  return merged;
}

/**
 * Collapses the duplicates inside one snapshot, keeping the first occurrence and
 * remembering how many sources reported each file.
 *
 * The server's own `sourceCount` (the manual lists it among the result fields)
 * seeds the tally; extra entries for the same file add to it.
 */
export function dedupeResults(
  results: readonly NormalizedEd2kResult[],
): NormalizedEd2kResult[] {
  return mergeAll(results ?? [], 'accumulate');
}

/**
 * Folds a fresh poll into what is already on screen.
 *
 * `getEd2kSearchResults` answers with the **accumulated** result set, so the same
 * entry arrives on every tick. Re-adding it must therefore be idempotent — which
 * is why this is not just {@link dedupeResults}: that one *sums* the source
 * counts, so polling ten times would inflate a 1-source file to 10 sources.
 */
export function mergeResults(
  previous: readonly NormalizedEd2kResult[],
  incoming: readonly NormalizedEd2kResult[],
): NormalizedEd2kResult[] {
  return mergeAll([...(previous ?? []), ...(incoming ?? [])], 'replace');
}

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * The size cell.
 *
 * Delegates to the shared AriaNg `readableVolume` filter so the ED2K table can
 * never disagree with the task table; only the "no value at all" case is ours,
 * and it shows `--` like the rest of the app.
 */
export function formatFileLength(value: string | number | undefined): string {
  if (value === undefined || value === null) {
    return UNKNOWN_SIZE;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return UNKNOWN_SIZE;
  }

  return readableVolume(toFileLength(value));
}

/* ------------------------------------------------------------------ */
/* deep link                                                           */
/* ------------------------------------------------------------------ */

/**
 * Reads `?keyword=` out of a hash-router location.
 *
 * The page is shareable: `#!/ed2k/search?keyword=ubuntu%20iso` runs the search
 * on arrival. AriaNg's command API puts its query behind the `#!` prefix, so
 * both `#!…?keyword=…` and a bare `?keyword=…` are accepted.
 */
export function parseKeywordFromHash(hash: string | undefined): string | undefined {
  if (!hash) {
    return undefined;
  }

  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryIndex = value.indexOf('?');
  if (queryIndex < 0) {
    return undefined;
  }

  const keyword = new URLSearchParams(value.slice(queryIndex + 1)).get('keyword');
  const trimmed = keyword?.trim();

  return trimmed ? trimmed : undefined;
}

/* ------------------------------------------------------------------ */
/* file-type icons                                                     */
/* ------------------------------------------------------------------ */

/**
 * The icon each file-type bucket gets in the name column.
 *
 * Reuses the AriaNg classification table (`classifyExtension`) rather than
 * inventing a parallel one, so an `.mkv` from a search result is grouped the
 * same way as the same `.mkv` inside a torrent.
 */
export function categoryIcon(category: FileTypeCategory): string {
  switch (category) {
    case 'video':
      return 'movie';
    case 'audio':
      return 'music-note';
    case 'picture':
      return 'image';
    case 'document':
      return 'insert-drive-file';
    case 'application':
      return 'settings';
    case 'archive':
      return 'archive';
    default:
      return 'insert-drive-file';
  }
}
