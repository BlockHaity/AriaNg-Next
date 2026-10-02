/**
 * BitTorrent peer id → client name decoder.
 *
 * AriaNg pulled in `angular-bittorrent-peerid`, which was itself a thin wrapper
 * around the "peer ID conventions" wiki.  Rather than shipping a full client
 * database we only decode the two styles that actually show up in a swarm:
 *
 * 1. **Azureus style** — `'-' + <client code> + <3 version digits>`, e.g.
 *    `-qB4550` (qBittorrent 4.5.5), `-TR3000` (Transmission 3.0.0).  Codes are
 *    2 chars for most clients, 3 for libtorrent (`-lt0120`).  Used by ~95 % of
 *    the peers in a swarm.
 * 2. **MPEG-4 style** — the BEP-41 style ids whose 4th byte is a digit.  The
 *    real client name is not recoverable, so we surface the style byte only.
 *
 * Anything else (BitTorrent v2 / hybrid ids, aria2's own `aria2-…` prefix being
 * classified by the MPEG-4 rule above, random junk, …) yields `undefined` so the
 * UI can fall back to the raw peer id.
 *
 * Pure module: no React, no I/O, no network.
 */

import type { PeerClient } from './types';

/**
 * AriaNg exposed this as `PeerIdClient`.  It is an alias of the shared
 * {@link PeerClient} model so `parsePeerClient()` output is assignable to
 * `TaskPeer.client` without a conversion step.
 */
export type PeerIdClient = PeerClient;

interface ClientEntry {
  name: string;
  /** Short implementation note shown next to the name (optional). */
  info?: string;
}

/**
 * Known Azureus client codes, keyed LOWERCASE — peer ids in the wild are
 * inconsistent about case (`-qB…` vs `-QB…`, `-lt0…` vs `-LT0…`).
 */
const AZUREUS_CLIENTS = new Map<string, ClientEntry>([
  ['qb', { name: 'qBittorrent', info: 'Qt/C++' }],
  ['tr', { name: 'Transmission', info: 'C++' }],
  ['ut', { name: 'µTorrent', info: 'C++, BitTorrent compatible' }],
  ['bt', { name: 'BitTorrent', info: 'C++, original client' }],
  ['lt', { name: 'libtorrent', info: 'C++' }],
  ['lt0', { name: 'libtorrent', info: 'C++, 1.x' }],
  ['ltt', { name: 'libtorrent', info: 'C++, 2.x' }],
  ['de', { name: 'Deluge', info: 'Python' }],
  ['dl', { name: 'Deluge', info: 'Python, legacy' }],
  ['vy', { name: 'Vuze', info: 'Java' }],
  ['az', { name: 'Azureus', info: 'Java, Vuze legacy' }],
  ['ww', { name: 'WebTorrent', info: 'JavaScript' }],
  ['tx', { name: 'Tixati', info: 'C++' }],
  ['kt', { name: 'KTorrent', info: 'C++/Qt' }],
  ['fd', { name: 'Free Download Manager', info: 'C++' }],
  ['xl', { name: 'Xunlei', info: 'C++' }],
]);

const AZUREUS_FALLBACK_INFO = 'Azureus-style peer id';

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

/**
 * `decodeURIComponent` that never throws.
 *
 * aria2 may hand us `peerIdRaw` percent-encoded (binary ids contain bytes that
 * are not legal in a JSON string), and a peer is free to send a truncated or
 * bogus `%`-sequence.  Anything undecodable is returned verbatim.
 */
export function decodePercentEncoded(peerIdRaw: string): string {
  try {
    return decodeURIComponent(peerIdRaw);
  } catch {
    return peerIdRaw;
  }
}

/**
 * The 3 chars after the Azureus client code each carry one decimal digit of
 * `major.minor.patch`, offset by the ASCII code of `'0'`.
 *
 * Clients that do not follow the scheme put arbitrary bytes there (or simply
 * run out of id), in which case no version is reported.
 */
function decodeAzureusVersion(digits: string): string | undefined {
  if (digits.length !== 3) {
    return undefined;
  }
  for (const char of digits) {
    if (!isDigit(char)) {
      return undefined;
    }
  }
  return `${digits.charAt(0)}.${digits.charAt(1)}.${digits.charAt(2)}`;
}

/** An Azureus peer id split into its client code and version. */
interface AzureusId {
  code: string;
  version: string | undefined;
}

/**
 * Client codes are 2 chars (`-qB4550`, `-TR3000`, `-UT3500`, `-DE2400`) except
 * for a few families that use 3 (`-lt0120` = libtorrent 1.x, `-ltt` = libtorrent
 * 2.x).  The 3-char form is tried first — slicing 3 chars off a 2-char code
 * would eat the first version digit.
 */
function decodeAzureus(peerId: string): AzureusId | undefined {
  if (peerId.charAt(0) !== '-') {
    return undefined;
  }

  const code3 = peerId.slice(1, 4);
  if (code3.length === 3 && AZUREUS_CLIENTS.has(code3.toLowerCase())) {
    return { code: code3, version: decodeAzureusVersion(peerId.slice(4, 7)) };
  }

  const code2 = peerId.slice(1, 3);
  return { code: code2, version: decodeAzureusVersion(peerId.slice(3, 6)) };
}

/**
 * Decode a raw aria2 peer id into a client descriptor, or `undefined` when the
 * encoding is not one we recognise.
 *
 * Accepts both the plain (`-qB4550`) and the percent-encoded
 * (`%2DqB4550` → `aria2.peerIdRaw`) form.
 */
export function parsePeerClient(peerIdRaw: string): PeerIdClient | undefined {
  if (!peerIdRaw) {
    return undefined;
  }

  const peerId = decodePercentEncoded(peerIdRaw);
  if (peerId.length < 3) {
    return undefined;
  }

  // Style 1 — Azureus: '-' + client code + version.
  const azureus = decodeAzureus(peerId);
  if (azureus) {
    const known = AZUREUS_CLIENTS.get(azureus.code.toLowerCase());
    const client: PeerIdClient = known
      ? { name: known.name, info: known.info }
      : { name: azureus.code, info: AZUREUS_FALLBACK_INFO };

    return azureus.version === undefined ? client : { ...client, version: azureus.version };
  }

  // Style 2 — MPEG-4: byte 3 is the style number.
  const style = peerId.charAt(3);
  if (isDigit(style)) {
    return { name: `MPEG-4/${style}` };
  }

  // BitTorrent v2 / hybrid ids and anything else: not decodable.
  return undefined;
}