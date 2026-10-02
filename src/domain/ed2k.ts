/**
 * ED2K link helpers.
 *
 * The `ed2k` struct in `tellStatus` has **no** `ed2kLink` field — the manual's
 * key list is `hash, name, length, partHashCount, aichRoot, serverCount,
 * connectedServerCount, peerCount, queuedPeerCount, acceptedPeerCount,
 * deadPeerCount, lowIdPeerCount, callbackWaitingPeerCount, kadNodeCount,
 * kadRouterCount, kadFirewalled, kadObservedAddressCount, searchActive,
 * searchMoreResults, searchResultCount, sharingTime, uploadingPeerCount,
 * waitingUploadPeerCount, peerCreditCount`. `ed2kLink` only appears on
 * `getEd2kSearchResults` entries.
 *
 * So a task that is already downloading has to have its link reconstructed from
 * the identity triple the struct does carry.
 */

import type { TaskEd2kView } from './types';

/** MD4 hashes are 32 hex characters; reject anything else rather than emit a broken link. */
const ED2K_HASH_RE = /^[0-9a-fA-F]{32}$/;

export interface Ed2kLinkParts {
  name: string;
  length: number;
  hash: string;
}

/**
 * Builds an `ed2k://|file|…` link, or `undefined` when the task does not carry
 * a complete identity triple.
 *
 * The wire format is
 * `ed2k://|file|<name>|<length>|<MD4 HASH>|/` with `|` and `:` percent-escaped
 * in the name. A trailing path segment after the final `|` selects a mirror,
 * which is empty here.
 */
export function buildEd2kLink(ed2k: TaskEd2kView | undefined): string | undefined {
  if (!ed2k) return undefined;

  const { name, length, hash } = ed2k;

  if (!name || !hash || !ED2K_HASH_RE.test(hash)) return undefined;
  if (!Number.isFinite(length) || (length ?? 0) <= 0) return undefined;

  const escaped = name.replace(/([|%])/g, (match) => `%${match.charCodeAt(0).toString(16).toUpperCase()}`);

  return `ed2k://|file|${escaped}|${length}|${hash.toUpperCase()}|/`;
}

/** True when {@link buildEd2kLink} would produce a link for this task. */
export function hasEd2kLink(ed2k: TaskEd2kView | undefined): boolean {
  return buildEd2kLink(ed2k) !== undefined;
}
