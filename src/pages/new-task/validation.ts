/**
 * Pure validation / shaping helpers for the new-task page.
 *
 * Ported from AriaNg's `ng-valid-urls` (`scripts/directives/validUrls.js`) and
 * `NewTaskController` (`scripts/controllers/new.js`):
 *
 *   - `parseUrlsFromOriginInput`      -> {@link validateUrls}
 *   - `getDownloadTasksByLinks`       -> {@link buildAddUriEntries}
 *   - `isNewTaskValid`                -> {@link isDraftValid}
 *
 * plus the two aria2-next kinds AriaNg never had: `ed2k://` links
 * ({@link NewTaskKind} `'ed2k'`) and HLS/DASH manifests (`'media'`).
 *
 * Nothing here touches the DOM, the store or the RPC layer, so the whole page
 * behaviour that is not UI glue is unit-testable.
 */

import type { Aria2OptionMeta } from '@/config/types';
import { decodeBase64Url } from '@/utils/base64';

/**
 * What kind of task the page is composing.
 *
 * - `urls`     — ordinary HTTP/FTP/SFTP/magnet links.
 * - `torrent`  — a `.torrent` **file** picked from disk (`aria2.addTorrent`).
 * - `metalink` — a metalink 3/4 **file** (`aria2.addMetalink`).
 * - `media`    — HLS/DASH manifests (aria2-next; still submitted with `addUri`).
 * - `ed2k`     — `ed2k://` links (aria2-next; still submitted with `addUri`).
 */
export type NewTaskKind = 'urls' | 'torrent' | 'metalink' | 'media' | 'ed2k';

/** The file the 📂 dropdown loaded, already base64-encoded for the RPC call. */
export interface NewTaskFileDraft {
  name: string;
  base64: string;
}

/** Everything the page collects, before it is turned into RPC parameters. */
export interface NewTaskDraft {
  kind: NewTaskKind;
  /** One entry per textarea line, in input order. */
  urls: string[];
  file?: NewTaskFileDraft;
  /** aria2 option bag; string values only (arrays are produced on submit). */
  options: Record<string, string>;
}

export interface UrlValidationResult {
  /** Accepted lines, trimmed, in input order. */
  urls: string[];
  /** Rejected non-blank lines, trimmed — reported so the UI can list them. */
  invalid: string[];
  /** AriaNg's `ng-valid-urls`: at least one accepted line. */
  isValid: boolean;
}

/**
 * URI schemes aria2-next accepts in a task.
 *
 * `normalizeUrlInput` (`src/domain/paths.ts`) already implements the same list
 * for the app-wide URL parser; the page needs the *rejected* lines as well, and
 * this module must stay free of the task domain so it can be reused by the
 * command route. The schemes are therefore duplicated deliberately — keep the
 * two lists in sync.
 */
const ACCEPTED_URI_PATTERNS: readonly RegExp[] = [
  /^(?:http|https|ftp|sftp):\/\/.+$/i,
  /^magnet:\?.+$/i,
  /^ed2k:\/\/.+$/i,
];

/** One `.torrent` download (a magnet link is a torrent too, but is a plain uri). */
const TORRENT_FILE_PATTERN = /\.torrent$/i;

/** Manifest suffixes aria2-next's media engine sniffs. */
const MEDIA_MANIFEST_PATTERN = /\.(?:m3u8|mpd|m3u)$/i;

const ED2K_PATTERN = /^ed2k:\/\//i;

/** Whether one trimmed line is something `aria2.addUri` can consume. */
export function isAcceptedUri(line: string): boolean {
  const value = (line ?? '').trim();
  return value.length > 0 && ACCEPTED_URI_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Splits a textarea into the URIs to download and the lines to complain about.
 *
 * 1:1 with AriaNg: blank lines are skipped, everything else is trimmed, input
 * order is preserved, and validity only requires **one** accepted line — extra
 * junk lines make the list invalid-looking but never disable the button.
 */
export function validateUrls(text: string): UrlValidationResult {
  const urls: string[] = [];
  const invalid: string[] = [];

  for (const rawLine of (text ?? '').split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (isAcceptedUri(line)) {
      urls.push(line);
    } else {
      invalid.push(line);
    }
  }

  return { urls, invalid, isValid: urls.length > 0 };
}

/** Strips the query string / fragment before matching a file suffix. */
function barePath(uri: string): string {
  return uri.split('#', 1)[0].split('?', 1)[0];
}

/**
 * Guesses the tab label / media behaviour from the links the user pasted.
 *
 * A kind is only reported when **every** line agrees on it, so a mixed list
 * (`magnet` + `https`) keeps the neutral `Links` label. Note that a remote
 * `.torrent` link is still submitted with `addUri` — aria2 fetches the
 * metainfo itself — so `'torrent'` here is a *label*, not a submission route.
 *
 * `'metalink'` is deliberately unreachable: metalink files come from the 📂 file
 * picker, never from the textarea.
 */
export function detectKindFromUrls(urls: string[]): NewTaskKind {
  const lines = (urls ?? []).map((url) => url.trim()).filter((url) => url.length > 0);

  if (lines.length === 0) {
    return 'urls';
  }

  const all = (predicate: (line: string) => boolean): boolean => lines.every(predicate);

  if (all((line) => ED2K_PATTERN.test(line))) {
    return 'ed2k';
  }

  if (all((line) => TORRENT_FILE_PATTERN.test(barePath(line)))) {
    return 'torrent';
  }

  if (all((line) => MEDIA_MANIFEST_PATTERN.test(barePath(line)))) {
    return 'media';
  }

  return 'urls';
}

/** Whether the draft can be submitted (`isNewTaskValid` in AriaNg). */
export function isDraftValid(draft: NewTaskDraft): boolean {
  if (draft.kind === 'torrent' || draft.kind === 'metalink') {
    // AriaNg returned `true` outright as soon as a file was loaded.
    return Boolean(draft.file && draft.file.base64);
  }

  return (draft.urls ?? []).some((url) => isAcceptedUri(url));
}

/**
 * One `aria2.addUri` call per link — AriaNg's `getDownloadTasksByLinks`.
 *
 * The same option bag is shared by every entry (aria2 has no notion of a batch
 * with per-entry options), and `pause` is merged in when the task is created
 * through "Download Later".
 */
export function buildAddUriEntries(
  draft: NewTaskDraft,
  pause: boolean,
): { urls: string[]; options: Record<string, string> }[] {
  const entries: { urls: string[]; options: Record<string, string> }[] = [];

  for (const raw of draft.urls ?? []) {
    const url = (raw ?? '').trim();

    if (!url) {
      continue;
    }

    const options: Record<string, string> = { ...draft.options };

    if (pause) {
      options.pause = 'true';
    }

    entries.push({ urls: [url], options });
  }

  return entries;
}

/**
 * Turns the editor's option bag into the shape an `add*` call expects.
 *
 * - `submitFormat: 'array'` + `separator` (only `header`) splits into trimmed,
 *   non-empty items — aria2 accepts a real JSON array there.
 * - An empty value is dropped, unless the option is `required`, which is how
 *   "the user cleared this row" becomes "do not send this option at all".
 */
export function coerceOptionsForRpc(
  options: Record<string, string>,
  getMeta: (key: string) => Aria2OptionMeta | undefined,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const [key, raw] of Object.entries(options ?? {})) {
    const value = raw ?? '';
    const meta = getMeta(key);

    if (meta && meta.submitFormat === 'array' && meta.separator) {
      result[key] = value
        .split(meta.separator)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      continue;
    }

    if (value === '' && !meta?.required) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * Reads the `?url=` prefill out of a query string or a whole `#!` hash.
 *
 * AriaNg's command API (`#!/new/task?url=<base64url>`) hands the new-task page
 * a base64url-encoded link, which the controller decoded into the textarea
 * (`$location.search().url` -> `base64UrlDecode`). The same value reaching the
 * bare `/new` route is a **prefill only** — creating the task from a command url
 * is the shell's `/new/task` route, not this page's job.
 *
 * Returns `undefined` when the parameter is absent or not decodable, so a
 * malformed link degrades to an empty form instead of throwing.
 */
export function parsePrefillUrl(query: string): string | undefined {
  if (!query) {
    return undefined;
  }

  const questionMark = query.indexOf('?');
  const search = questionMark >= 0 ? query.slice(questionMark + 1) : query;
  const encoded = new URLSearchParams(search).get('url');

  if (!encoded) {
    return undefined;
  }

  const decoded = decodeBase64Url(encoded).trim();
  return decoded ? decoded : undefined;
}