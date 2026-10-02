/**
 * UTF-8 correct base64 / base64url codecs.
 *
 * AriaNg reached for `angular-utf8-base64` because the built-in `btoa` /
 * `atob` only understand **latin1** and throw `InvalidCharacterError` on
 * anything above U+00FF — which is every CJK file name, every emoji and most
 * of the translated UI text. Since that package is not a dependency here, this
 * is a small hand-rolled replacement built on `TextEncoder` / `TextDecoder`,
 * which are available in every environment that can run this bundle
 * (browser, worker and node).
 *
 * Why not just use `btoa` on a UTF-8 binary string? Because it still depends on
 * a `String.fromCharCode` round-trip of every byte and is missing entirely in
 * some non-browser hosts; doing the alphabet math by hand keeps the module
 * dependency-free and byte-exact.
 *
 * ### Failure policy
 *
 * AriaNg's `angular-base64` **returned the input unchanged** when decoding
 * failed, so a hand-edited plain-text secret kept working. That behaviour lives
 * in `store/settings.ts` (`decodeSecret`). The codecs here are deliberately
 * stricter: {@link decodeBase64} and {@link decodeBase64Url} resolve invalid
 * input to the **empty string** and never throw, because their callers
 * (task ids, exported option blobs) treat a decode failure as "nothing usable
 * was stored" and must not accidentally display the mangled input back to the
 * user.
 */

/** RFC 4648 §4 standard alphabet (note `+` and `/`). */
const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** RFC 4648 §5 URL-safe alphabet (`-` and `_`, no padding). */
const URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Reverse lookup for the standard alphabet; `-1` marks a character to drop. */
const STANDARD_LOOKUP = buildLookup(STANDARD_ALPHABET);

/**
 * Reverse lookup for base64url.
 *
 * `+` and `/` are mapped as aliases of `-` and `_` so a value produced by
 * {@link encodeBase64} (or written by an older AriaNg into the options blob)
 * still decodes.
 */
const URL_LOOKUP = buildLookup(URL_ALPHABET);

function buildLookup(alphabet: string): Int8Array {
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i += 1) {
    lookup[alphabet.charCodeAt(i)] = i;
  }
  // `=` is padding, never a value.
  lookup[0x3d] = -1;
  // Standard-alphabet aliases, so both variants decode.
  lookup[0x2b] = 62; // +
  lookup[0x2f] = 63; // /
  return lookup;
}

function encodeBytes(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;

    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];

    if (hasB1) {
      out += alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)];
    } else if (pad) {
      out += '=';
    }

    if (hasB2) {
      out += alphabet[b2 & 0x3f];
    } else if (pad) {
      out += '=';
    }
  }

  return out;
}

function decodeToBytes(text: string, lookup: Int8Array): Uint8Array | null {
  // Whitespace is legal inside a base64 payload (line-wrapped exports, cookies)
  // and `atob` ignored it, so it is dropped here too.
  const clean = text.replace(/[\s\r\n]+/g, '');
  if (clean.length === 0) return new Uint8Array(0);

  // Padding is optional on the way in; anything past `==` is junk.
  const body = clean.replace(/=+$/, '');
  const remainder = body.length % 4;
  if (remainder === 1) return null;

  const byteLength = Math.floor((body.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let buffer = 0;
  let bits = 0;
  let offset = 0;

  for (let i = 0; i < body.length; i += 1) {
    const code = body.charCodeAt(i);
    const value = code < 128 ? lookup[code] : -1;
    if (value < 0) return null;

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }

  return offset === byteLength ? bytes : bytes.subarray(0, offset);
}

/* ------------------------------------------------------------------ */
/* standard base64                                                     */
/* ------------------------------------------------------------------ */

/** UTF-8 text -> padded base64. `encodeBase64('中') === '5Lit'`. */
export function encodeBase64(text: string): string {
  return encodeBytes(new TextEncoder().encode(text ?? ''), STANDARD_ALPHABET, true);
}

/**
 * Base64 -> UTF-8 text.
 *
 * Returns `''` for input that is not decodable base64 (bad alphabet, a
 * truncated group) instead of throwing — see the failure policy above.
 */
export function decodeBase64(text: string): string {
  const bytes = decodeToBytes(text ?? '', STANDARD_LOOKUP);
  if (!bytes) return '';
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/* base64url                                                           */
/* ------------------------------------------------------------------ */

/** UTF-8 text -> unpadded base64url (`-` / `_`, no `=`). */
export function encodeBase64Url(text: string): string {
  return encodeBytes(new TextEncoder().encode(text ?? ''), URL_ALPHABET, false);
}

/**
 * base64url -> UTF-8 text.
 *
 * Accepts the standard alphabet and missing padding as well, so it also decodes
 * a value that came out of {@link encodeBase64}. Returns `''` on failure.
 */
export function decodeBase64Url(text: string): string {
  const bytes = decodeToBytes(text ?? '', URL_LOOKUP);
  if (!bytes) return '';
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/* ids                                                                 */
/* ------------------------------------------------------------------ */

/**
 * AriaNg's `generateUniqueId` (used for the `rpcId` of an extended profile):
 * `base64('<appPrefix>_<unixSeconds>_<Math.random()>')`.
 *
 * Kept on the **standard** alphabet on purpose — the id is only ever compared
 * for equality and persisted in the options blob, and AriaNg's ids contain
 * `+` / `/` / `=`.
 */
export function generateUniqueId(prefix = 'AriaNg'): string {
  const seconds = Math.round(Date.now() / 1000);
  return encodeBase64(`${prefix}_${seconds}_${Math.random()}`);
}
