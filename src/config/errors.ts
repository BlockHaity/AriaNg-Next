/**
 * aria2 `errorCode` → translation key — a 1:1 port of AriaNg's `aria2Errors`
 * (`src/scripts/config/aria2Errors.js`).
 *
 * aria2 reports failures through the per-task `errorCode` / `errorMessage`
 * pair. AriaNg showed `errorMessage` as-is and looked the description up here;
 * `defaultLanguage.js` ships the matching `[error]` bundle (`error.unknown`,
 * `error.operation.timeout`, ...).
 *
 * Three codes are deliberately **absent** from the table because they are not
 * failures and must never render a description:
 *
 * - `0`  — all downloads were successful;
 * - `7`  — there were unfinished downloads when aria2 exited;
 * - `31` — reserved by aria2, never emitted.
 *
 * `0` and `7` are exactly what AriaNg commented out; `31` it marked
 * "Reserved. Not used.".
 */

export interface Aria2ErrorMeta {
  /** The numeric code aria2 reports in `errorCode`. */
  code: number;
  /** i18n key into the `[error]` bundle, e.g. `error.unknown`. */
  descriptionKey: string;
  /** Never surface this code to the user. */
  hide?: boolean;
}

export const ARIA2_ERRORS: Record<string, Aria2ErrorMeta> = {
  '1': { code: 1, descriptionKey: 'error.unknown' },
  '2': { code: 2, descriptionKey: 'error.operation.timeout' },
  '3': { code: 3, descriptionKey: 'error.resource.notfound' },
  '4': { code: 4, descriptionKey: 'error.resource.notfound.max-file-not-found' },
  '5': { code: 5, descriptionKey: 'error.download.aborted.lowest-speed-limit' },
  '6': { code: 6, descriptionKey: 'error.network.problem' },
  '8': { code: 8, descriptionKey: 'error.resume.notsupported' },
  '9': { code: 9, descriptionKey: 'error.space.notenough' },
  '10': { code: 10, descriptionKey: 'error.piece.length.different' },
  '11': { code: 11, descriptionKey: 'error.download.sametime' },
  '12': { code: 12, descriptionKey: 'error.download.torrent.sametime' },
  '13': { code: 13, descriptionKey: 'error.file.exists' },
  '14': { code: 14, descriptionKey: 'error.file.rename.failed' },
  '15': { code: 15, descriptionKey: 'error.file.open.failed' },
  '16': { code: 16, descriptionKey: 'error.file.create.failed' },
  '17': { code: 17, descriptionKey: 'error.io.error' },
  '18': { code: 18, descriptionKey: 'error.directory.create.failed' },
  '19': { code: 19, descriptionKey: 'error.name.resolution.failed' },
  '20': { code: 20, descriptionKey: 'error.metalink.file.parse.failed' },
  '21': { code: 21, descriptionKey: 'error.ftp.command.failed' },
  '22': { code: 22, descriptionKey: 'error.http.response.header.bad' },
  '23': { code: 23, descriptionKey: 'error.redirects.toomany' },
  '24': { code: 24, descriptionKey: 'error.http.authorization.failed' },
  '25': { code: 25, descriptionKey: 'error.bencoded.file.parse.failed' },
  '26': { code: 26, descriptionKey: 'error.torrent.file.corrupted' },
  '27': { code: 27, descriptionKey: 'error.magnet.uri.bad' },
  '28': { code: 28, descriptionKey: 'error.option.bad' },
  '29': { code: 29, descriptionKey: 'error.server.overload' },
  '30': { code: 30, descriptionKey: 'error.rpc.request.parse.failed' },
  '32': { code: 32, descriptionKey: 'error.checksum.failed' },
};

/** "All downloads were successful" / "there were unfinished downloads". */
export const NO_ERROR_CODES: readonly string[] = ['0', '7'];

/** Reserved by aria2, documented as "Reserved. Not used.". */
export const RESERVED_ERROR_CODES: readonly string[] = ['31'];

/** Codes that must never produce a description, whether or not they are in the table. */
export const HIDDEN_ERROR_CODES: readonly string[] = [...NO_ERROR_CODES, ...RESERVED_ERROR_CODES];

/** Every code the table knows about, ascending. */
export const KNOWN_ERROR_CODES: string[] = Object.keys(ARIA2_ERRORS).sort(
  (a, b) => Number(a) - Number(b),
);

/**
 * AriaNg's `aria2Errors[code].descriptionKey` lookup, hardened:
 * `''` when the code is missing, unknown, or explicitly hidden.
 */
export function getErrorDescriptionKey(code: string | number | undefined): string {
  if (code === undefined || code === null) {
    return '';
  }

  const key = typeof code === 'number' ? String(code) : code;
  if (key === '') {
    return '';
  }

  if (isHiddenError(key)) {
    return '';
  }

  return ARIA2_ERRORS[key]?.descriptionKey ?? '';
}

/** True for codes that carry no user-facing meaning. */
export function isHiddenError(code: string | undefined): boolean {
  if (code === undefined || code === null || code === '') {
    return false;
  }

  return HIDDEN_ERROR_CODES.includes(code) || ARIA2_ERRORS[code]?.hide === true;
}