/**
 * Port of AriaNg's `ariaNgFileService` (`File / Download` of the settings and
 * the new-task editor).
 *
 * AriaNg used a hidden `<input type="file">` + `FileReader` behind two
 * `$q` promises. The observable behaviour is kept byte for byte, including the
 * three error messages, because the callers match on them (and they are what a
 * user of an existing install expects to read):
 *
 * - `'Your browser does not support loading file!'` — no `FileReader`.
 * - `'Failed to load file!'` — the picker was dismissed, or `files` was empty.
 * - `'The selected file type is invalid!'` — `fileFilter` rejected the name.
 *
 * The one structural change is that the temporary `<input>` is **always**
 * removed from the DOM in a `finally`; AriaNg leaked one node per open.
 */

/** `fileFilter` value that accepts everything (AriaNg's own sentinel). */
export const FILE_FILTER_ANY = '*.*';

export const FILE_LOAD_FAILED = 'Failed to load file!';
export const FILE_TYPE_INVALID = 'The selected file type is invalid!';
export const FILE_READER_UNSUPPORTED = 'Your browser does not support loading file!';

/** Content type used by {@link saveFileContent} when the caller has no better guess. */
const DEFAULT_SAVE_CONTENT_TYPE = 'application/octet-stream';

export interface OpenedFile {
  fileName: string;
  /** Set when `binary` was false. */
  textContent?: string;
  /** Set when `binary` was true: the raw payload, data-url prefix removed. */
  base64Content?: string;
}

export interface OpenFileOptions {
  /** `accept` attribute of the picker, e.g. `.json,.txt` — filters in the OS dialog. */
  accept?: string;
  /** Extension whitelist checked *after* the selection, e.g. `.json` or `*.*`. */
  fileFilter?: string;
  /** Read as a data-url and return `base64Content` instead of `textContent`. */
  binary?: boolean;
}

/* ------------------------------------------------------------------ */
/* capability probes                                                   */
/* ------------------------------------------------------------------ */

/** AriaNg's `isFileReaderSupported`. */
export function isFileReaderSupported(): boolean {
  return typeof FileReader !== 'undefined';
}

/** Blob + `URL.createObjectURL` are both needed to write a file from a string. */
export function isBlobSupported(): boolean {
  return (
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * AriaNg's `checkFileType`.
 *
 * The filter is a comma separated list of patterns, each matched as an
 * **anchored regular expression suffix**. AriaNg did not escape the pattern, so
 * the leading dot of `.json` is a regex "any character" and `json` alone also
 * matches `foo-json`. That is kept verbatim — users have muscle memory for
 * these filters and the quirk is harmless for the values AriaNg itself writes
 * (`.json`, `.torrent`, `.metalink`, `.txt`).
 */
export function matchesFileFilter(fileName: string, fileFilter?: string): boolean {
  if (!fileFilter || fileFilter === FILE_FILTER_ANY) return true;

  const name = fileName ?? '';

  for (const raw of fileFilter.split(',')) {
    const pattern = raw.trim();
    if (!pattern) continue;
    try {
      if (new RegExp(`${pattern}$`).test(name)) return true;
    } catch {
      // A malformed pattern must not break the whole check; fall through to
      // the next candidate.
    }
  }

  return false;
}

function readAs(file: File, mode: 'text' | 'dataUrl'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === 'string' ? result : '');
    };
    reader.onerror = () => {
      reject(new Error(FILE_LOAD_FAILED));
    };
    reader.onabort = () => {
      reject(new Error(FILE_LOAD_FAILED));
    };

    if (mode === 'text') {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  });
}

/** `readAsText`. Rejects with `Failed to load file!` on an I/O error. */
export function readFileAsText(file: File): Promise<string> {
  return readAs(file, 'text');
}

/**
 * `readAsDataURL` with the `data:<mime>;base64,` prefix removed, i.e. exactly
 * the payload AriaNg fed to `FileUtil.readFile` and then to aria2's
 * `base64` RPC field.
 */
export async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await readAs(file, 'dataUrl');
  const comma = dataUrl.indexOf(',');
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

/* ------------------------------------------------------------------ */
/* opening                                                             */
/* ------------------------------------------------------------------ */

/**
 * Shows the OS file picker and resolves with the chosen file's content.
 *
 * The promise never stays pending after the picker closes: cancelling the
 * dialog fires `cancel` (and, in some browsers, a `change` with no files) and
 * both reject with `Failed to load file!`.
 */
export function openFile(options: OpenFileOptions = {}): Promise<OpenedFile> {
  const { accept, fileFilter, binary = false } = options;

  return new Promise<OpenedFile>((resolve, reject) => {
    if (!isFileReaderSupported()) {
      reject(new Error(FILE_READER_UNSUPPORTED));
      return;
    }
    if (typeof document === 'undefined') {
      reject(new Error(FILE_READER_UNSUPPORTED));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    // `accept` filters the OS dialog, `fileFilter` re-checks afterwards (a
    // picker filter is a hint, not a guarantee).
    if (accept) input.accept = accept;
    else if (fileFilter && fileFilter !== FILE_FILTER_ANY) input.accept = fileFilter;

    let settled = false;
    let inputRemoved = false;

    const cleanup = () => {
      if (inputRemoved) return;
      inputRemoved = true;
      input.remove();
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const succeed = (result: OpenedFile) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        fail(FILE_LOAD_FAILED);
        return;
      }
      if (!matchesFileFilter(file.name, fileFilter)) {
        fail(FILE_TYPE_INVALID);
        return;
      }

      const reading = binary
        ? readFileAsBase64(file).then((base64Content) => ({ fileName: file.name, base64Content }))
        : readFileAsText(file).then((textContent) => ({ fileName: file.name, textContent }));

      reading.then(succeed, () => fail(FILE_LOAD_FAILED));
    });

    // `cancel` is not universal; the `change`-with-no-files path above covers
    // the browsers that do not fire it.
    input.addEventListener('cancel', () => fail(FILE_LOAD_FAILED));

    document.body.appendChild(input);
    input.click();
  });
}

/* ------------------------------------------------------------------ */
/* saving                                                              */
/* ------------------------------------------------------------------ */

/**
 * Offers `content` as a download named `fileName`.
 *
 * Returns `false` when the environment cannot do it (no `Blob` /
 * `createObjectURL`, or a blocked object URL), which is the only thing a caller
 * can usefully react to.
 */
export function saveFileContent(content: string, fileName: string, contentType?: string): boolean {
  if (!isBlobSupported() || typeof document === 'undefined') return false;

  const blob = new Blob([content ?? ''], { type: contentType || DEFAULT_SAVE_CONTENT_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  try {
    anchor.href = url;
    anchor.download = fileName || 'download';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    anchor.remove();
    // Revoked on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has started reading the blob.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
    }, 0);
  }
}
