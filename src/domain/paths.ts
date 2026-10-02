/**
 * Pure path / name helpers ported from AriaNg.
 *
 * Sources:
 *  - `src/scripts/services/aria2TaskService.js` — `getFileName`,
 *    `getTaskName`, `getRelativePath`
 *  - `src/scripts/services/ariaNgCommonService.js` — `getFileExtension`,
 *    `parseUrlsFromOriginInput`
 *
 * Every function here is side-effect free and never mutates its input.
 */

import type { Aria2Uri } from '@/rpc/types';

/** `ariaNgConstants.defaultPathSeparator` — AriaNg normalises `\` to this. */
export const DEFAULT_PATH_SEPARATOR = '/';

/** AriaNg renders the localized `Unknown` when a task has no usable name. */
export const UNKNOWN_TASK_NAME = 'Unknown';

/**
 * The minimum a file needs for {@link getFileNameFromFile}.
 *
 * Deliberately structural so both the wire shape (`Aria2File`) and the
 * already-normalised shape (`FileTypeInfo`) can be passed in.
 */
export interface FileLike {
  path?: string;
  uris?: readonly Pick<Aria2Uri, 'uri'>[];
}

/** The `bittorrent.info` subset used to derive a torrent name. */
export interface BittorrentInfoNameSource {
  name?: string;
  'name.utf-8'?: string;
}

/**
 * Structural shape satisfied by both `Aria2Bittorrent` (nested `info.name`)
 * and `TaskBittorrentView` (flattened `infoName`).
 */
export interface BittorrentNameSource {
  mode?: 'single' | 'multi';
  info?: BittorrentInfoNameSource;
  infoName?: string;
}

/** Minimal task shape required by {@link getTaskName} / {@link getRelativePath}. */
export interface TaskNameContext {
  bittorrent?: BittorrentNameSource;
  files?: readonly FileLike[];
}

export interface RelativePathTask {
  dir?: string;
  bittorrent?: BittorrentNameSource;
}

export interface RelativePathFile {
  path?: string;
  fileName?: string;
}

export interface TaskNameResult {
  name: string;
  /** `false` when the name had to fall back to {@link UNKNOWN_TASK_NAME}. */
  success: boolean;
}

/**
 * Every accepted spell of a torrent name, most-preferred first.
 *
 * aria2 writes the `name.utf-8` variant to disk when the torrent provides it,
 * so it is the one most likely to prefix-match a real path; the plain name and
 * the already-flattened `infoName` are kept as fallbacks.
 */
function getBittorrentNameCandidates(bittorrent: BittorrentNameSource | undefined): string[] {
  if (!bittorrent) {
    return [];
  }

  const info = bittorrent.info;
  const names: string[] = [];

  for (const candidate of [info?.['name.utf-8'], info?.name, bittorrent.infoName]) {
    if (candidate && !names.includes(candidate)) {
      names.push(candidate);
    }
  }

  return names;
}

/** The torrent name, preferring `info['name.utf-8']`, or `''`. */
export function getBittorrentName(bittorrent: BittorrentNameSource | undefined): string {
  return getBittorrentNameCandidates(bittorrent)[0] ?? '';
}

/**
 * AriaNg's `aria2TaskService.getFileName`.
 *
 * Uses `file.path`; falls back to `file.uris[0].uri` (which then needs URL
 * decoding). Only the part after the last `/` is kept, with a `?query` suffix
 * stripped. Returns `''` when there is nothing to work with.
 */
export function getFileNameFromFile(file: FileLike | null | undefined): string {
  if (!file) {
    return '';
  }

  let path = file.path ?? '';
  let needUrlDecode = false;

  if (!path && file.uris && file.uris.length > 0) {
    path = file.uris[0].uri;
    needUrlDecode = true;
  }

  if (!path) {
    return '';
  }

  const index = path.lastIndexOf(DEFAULT_PATH_SEPARATOR);

  // `index <= 0` also covers "no separator at all" (-1) and paths that start
  // with the separator; `index === path.length` means a trailing separator.
  // AriaNg returned the whole path in both cases, so we do too.
  if (index <= 0 || index === path.length) {
    return path;
  }

  const fileNameAndQueryString = path.substring(index + 1);
  const queryStringStartPos = fileNameAndQueryString.indexOf('?');
  let fileName = fileNameAndQueryString;

  if (queryStringStartPos > 0) {
    fileName = fileNameAndQueryString.substring(0, queryStringStartPos);
  }

  if (needUrlDecode) {
    try {
      fileName = decodeURI(fileName);
    } catch {
      // Malformed percent-encoding: AriaNg logged and kept the raw name.
    }
  }

  return fileName;
}

/**
 * AriaNg's `aria2TaskService.getRelativePath` (`aria2TaskService.js:75-122`).
 *
 * Strips the download directory, then the multi-mode torrent root directory,
 * then the file name itself, leaving only the *directory* part relative to the
 * torrent root — which is exactly what `filetree.ts` needs as a node path.
 */
export function getRelativePath(task: RelativePathTask, file: RelativePathFile): string {
  const downloadPath = task.dir ? task.dir.replace(/\\/g, DEFAULT_PATH_SEPARATOR) : '';
  let relativePath = file.path ? file.path.replace(/\\/g, DEFAULT_PATH_SEPARATOR) : '';

  if (!relativePath) {
    return '';
  }

  const trimStartPathSeparator = (): void => {
    if (relativePath.length > 1 && relativePath.charAt(0) === DEFAULT_PATH_SEPARATOR) {
      relativePath = relativePath.substring(1);
    }
  };

  const trimEndPathSeparator = (): void => {
    if (
      relativePath.length > 1 &&
      relativePath.charAt(relativePath.length - 1) === DEFAULT_PATH_SEPARATOR
    ) {
      relativePath = relativePath.substring(0, relativePath.length - 1);
    }
  };

  if (downloadPath && relativePath.indexOf(downloadPath) === 0) {
    relativePath = relativePath.substring(downloadPath.length);
  }

  trimStartPathSeparator();

  // AriaNg only stripped the torrent root for `mode === 'multi'`; single-file
  // torrents put the file directly inside `dir`, so there is nothing to strip.
  if (task.bittorrent && task.bittorrent.mode === 'multi') {
    for (const name of getBittorrentNameCandidates(task.bittorrent)) {
      if (relativePath.indexOf(name) === 0) {
        relativePath = relativePath.substring(name.length);
        break;
      }
    }
  }

  trimStartPathSeparator();

  if (
    file.fileName &&
    relativePath.lastIndexOf(file.fileName) + file.fileName.length === relativePath.length
  ) {
    relativePath = relativePath.substring(0, relativePath.length - file.fileName.length);
  }

  trimEndPathSeparator();

  return relativePath;
}

/**
 * `ariaNgCommonService.getFileExtension`, but without the leading dot and
 * lower-cased (the file-type filters compare against lowercase keys).
 *
 * Returns `''` when there is no extension, for dot-files (`.gitignore`) and for
 * names ending in a bare dot.
 */
export function getFileExtension(fileName: string): string {
  if (!fileName) {
    return '';
  }

  const lastSeparator = Math.max(
    fileName.lastIndexOf('/'),
    fileName.lastIndexOf('\\'),
  );
  const baseName = lastSeparator >= 0 ? fileName.substring(lastSeparator + 1) : fileName;
  const dotIndex = baseName.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === baseName.length - 1) {
    return '';
  }

  return baseName.substring(dotIndex + 1).toLowerCase();
}

/**
 * `ariaNgCommonService.parseUrlsFromOriginInput`, hardened:
 *  - each line is trimmed and blanks are dropped (AriaNg pushed them verbatim)
 *  - the scheme test is case-insensitive
 *  - `ed2k://` is accepted as well — an intentional aria2-next extension,
 *    since `ed2k.addUri` / `ed2kSearch` are first-class there.
 */
const ACCEPTED_URI_PATTERNS: readonly RegExp[] = [
  /^(?:http|https|ftp|sftp):\/\/.+$/i,
  /^magnet:\?.+$/i,
  /^ed2k:\/\/.+$/i,
];

/** Parses a textarea of user-entered links into the URIs aria2 can consume. */
export function normalizeUrlInput(text: string): string[] {
  if (!text) {
    return [];
  }

  const result: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (ACCEPTED_URI_PATTERNS.some((pattern) => pattern.test(line))) {
      result.push(line);
    }
  }

  return result;
}

/**
 * AriaNg's `aria2TaskService.getTaskName`.
 *
 * `bittorrent.info.name` (preferring `name.utf-8`) → first file name →
 * {@link UNKNOWN_TASK_NAME}.
 */
export function getTaskName(task: TaskNameContext): TaskNameResult {
  let name = getBittorrentName(task.bittorrent);

  if (!name && task.files && task.files.length > 0) {
    name = getFileNameFromFile(task.files[0]);
  }

  if (!name) {
    return { name: UNKNOWN_TASK_NAME, success: false };
  }

  return { name, success: true };
}
