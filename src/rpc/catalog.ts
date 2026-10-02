/**
 * The aria2 / aria2-next JSON-RPC method registry.
 *
 * A single source of truth shared by:
 *  - the debug page (method list, tooltips, "AriaNg does not support this
 *    RPC method!" validation),
 *  - the destructive-action confirmation UI,
 *  - the RPC client, which needs to expand a bare method name (`tellStatus`)
 *    into the wire name (`aria2.tellStatus`).
 */

import { RPC_SERVICE_NAME, RPC_SYSTEM_SERVICE_NAME } from '@/config/rpc-constants';

export type RpcServiceName = 'aria2' | 'system';

export interface RpcMethodMeta {
  /** Bare name, e.g. `tellStatus`. `system.*` keeps the dot. */
  name: string;
  /** `aria2.tellStatus` or `system.listMethods`. */
  fullName: string;
  service: RpcServiceName;
  /** i18n key for the display label, if the UI needs one. */
  labelKey?: string;
  /** Whether this call triggers the destructive-action confirmation UI. */
  destructive?: boolean;
  /** aria2-next only. */
  aria2NextOnly?: boolean;
  /** Short summary used as the debug-page tooltip. */
  summary: string;
}

type RpcMethodSeed = Omit<RpcMethodMeta, 'fullName'>;

/** Keeps `fullName` in sync with `service` + `name` — they can never drift. */
function withFullNames(seeds: readonly RpcMethodSeed[]): readonly RpcMethodMeta[] {
  return seeds.map((seed) => {
    const prefix = `${seed.service}.`;
    // System methods already spell out their service in the name
    // (`system.multicall`), the aria2 ones do not.
    return { ...seed, fullName: seed.name.startsWith(prefix) ? seed.name : prefix + seed.name };
  });
}

/**
 * Every RPC method AriaNg knows about, in the order `aria2.system.listMethods`
 * reports them: add, control, query, options, daemon, bittorrent, aria2-next,
 * JSON-RPC system.
 */
export const RPC_METHOD_CATALOG: readonly RpcMethodMeta[] = withFullNames([
  /* ---- add ---- */
  {
    name: 'addUri',
    service: RPC_SERVICE_NAME,
    summary: 'Add a download from one or more URIs (HTTP/FTP/SFTP/BitTorrent/Metalink).',
  },
  {
    name: 'addTorrent',
    service: RPC_SERVICE_NAME,
    summary: 'Add a BitTorrent download from a base64 encoded .torrent file.',
  },
  {
    name: 'addMetalink',
    service: RPC_SERVICE_NAME,
    summary: 'Add a download from a base64 encoded metalink document.',
  },
  {
    name: 'inspectTorrent',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Parse a .torrent payload and return its metadata without adding a task.',
  },

  /* ---- remove ---- */
  {
    name: 'remove',
    service: RPC_SERVICE_NAME,
    destructive: true,
    summary: 'Remove a task, along with the file it downloaded.',
  },
  {
    name: 'forceRemove',
    service: RPC_SERVICE_NAME,
    destructive: true,
    summary: 'Remove a task immediately, without waiting for its connections to close.',
  },

  /* ---- pause / resume ---- */
  {
    name: 'pause',
    service: RPC_SERVICE_NAME,
    summary: 'Pause a task.',
  },
  {
    name: 'pauseAll',
    service: RPC_SERVICE_NAME,
    summary: 'Pause every active task.',
  },
  {
    name: 'forcePause',
    service: RPC_SERVICE_NAME,
    summary: 'Pause a task immediately.',
  },
  {
    name: 'forcePauseAll',
    service: RPC_SERVICE_NAME,
    summary: 'Pause every active task immediately.',
  },
  {
    name: 'unpause',
    service: RPC_SERVICE_NAME,
    summary: 'Resume a paused task.',
  },
  {
    name: 'unpauseAll',
    service: RPC_SERVICE_NAME,
    summary: 'Resume every paused task.',
  },

  /* ---- task queries ---- */
  {
    name: 'tellStatus',
    service: RPC_SERVICE_NAME,
    summary: 'Read the current status of a single task.',
  },
  {
    name: 'getUris',
    service: RPC_SERVICE_NAME,
    summary: 'List the URIs of a download and whether each one was already tried.',
  },
  {
    name: 'getFiles',
    service: RPC_SERVICE_NAME,
    summary: 'List the files of a download with their per-file progress.',
  },
  {
    name: 'getPeers',
    service: RPC_SERVICE_NAME,
    summary: 'List the peers connected to a BitTorrent download.',
  },
  {
    name: 'getServers',
    service: RPC_SERVICE_NAME,
    summary: 'List the BitTorrent servers a download is using.',
  },
  {
    name: 'tellActive',
    service: RPC_SERVICE_NAME,
    summary: 'List the tasks that are currently downloading.',
  },
  {
    name: 'tellWaiting',
    service: RPC_SERVICE_NAME,
    summary: 'List the queued and paused tasks.',
  },
  {
    name: 'tellStopped',
    service: RPC_SERVICE_NAME,
    summary: 'List the stopped tasks (finished, failed or removed).',
  },

  /* ---- re-order / re-point ---- */
  {
    name: 'changePosition',
    service: RPC_SERVICE_NAME,
    summary: 'Move a queued task to another position in the list (POS_SET / POS_CUR).',
  },
  {
    name: 'changeUri',
    service: RPC_SERVICE_NAME,
    summary: 'Add or remove URIs of a running download in place.',
  },
  // NOTE: there is deliberately no `aria2.selectFile` entry. Verified against
  // the aria2-next manual: file selection is the `select-file` *option*, set
  // through `aria2.changeOption`. `Aria2Client.selectFile()` is a convenience
  // wrapper over changeOption and is therefore absent from this catalogue.

  /* ---- options ---- */
  {
    name: 'getOption',
    service: RPC_SERVICE_NAME,
    summary: 'Read the per-task options of a download.',
  },
  {
    name: 'changeOption',
    service: RPC_SERVICE_NAME,
    summary: 'Change the per-task options of a download.',
  },
  {
    name: 'getGlobalOption',
    service: RPC_SERVICE_NAME,
    summary: 'Read the global aria2 options.',
  },
  {
    name: 'changeGlobalOption',
    service: RPC_SERVICE_NAME,
    summary: 'Change the global aria2 options (some of them need a restart).',
  },
  {
    name: 'getGlobalStat',
    service: RPC_SERVICE_NAME,
    summary: 'Read the global speed and the active / waiting / stopped task counts.',
  },

  /* ---- stopped list ---- */
  {
    name: 'purgeDownloadResult',
    service: RPC_SERVICE_NAME,
    destructive: true,
    summary: 'Remove every stopped result from the list at once.',
  },
  {
    name: 'removeDownloadResult',
    service: RPC_SERVICE_NAME,
    destructive: true,
    summary: 'Remove a single stopped result from the list.',
  },

  /* ---- daemon ---- */
  {
    name: 'getVersion',
    service: RPC_SERVICE_NAME,
    summary: 'Read the aria2 version and the features it was built with.',
  },
  {
    name: 'getSessionInfo',
    service: RPC_SERVICE_NAME,
    summary: 'Read the session id of the running aria2 instance.',
  },
  {
    name: 'shutdown',
    service: RPC_SERVICE_NAME,
    destructive: true,
    summary: 'Shut the aria2 daemon down gracefully.',
  },
  {
    name: 'forceShutdown',
    service: RPC_SERVICE_NAME,
    destructive: true,
    summary: 'Shut the aria2 daemon down immediately.',
  },
  {
    name: 'saveSession',
    service: RPC_SERVICE_NAME,
    summary: 'Persist the current session into the session file.',
  },

  /* ---- bittorrent extras ---- */
  {
    name: 'getBtTrackers',
    service: RPC_SERVICE_NAME,
    summary: 'List the trackers of a BitTorrent download.',
  },
  {
    name: 'forceBtAnnounce',
    service: RPC_SERVICE_NAME,
    summary: 'Force an announce to the trackers of a BitTorrent download.',
  },
  {
    name: 'addBtPeers',
    service: RPC_SERVICE_NAME,
    summary: 'Add peers to a BitTorrent download from a magnet link or a plain peer list.',
  },
  {
    name: 'getBtSessionStatus',
    service: RPC_SERVICE_NAME,
    summary: 'Read the BitTorrent session state (max concurrent downloads, limits, ...).',
  },
  {
    name: 'forceBtRecheck',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Force a full recheck of the pieces of a BitTorrent download.',
  },
  {
    // Documented in the aria2-next manual (docs/manual/en/aria2-next.rst) but
    // absent from upstream aria2, which is why it is aria2-next only.
    name: 'setBtPeerBlocklist',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Replace the BitTorrent peer blocklist with the given rules.',
  },

  /* ---- aria2-next: native media ---- */
  {
    name: 'finishMedia',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Mark a native media (HLS / DASH) task as finished.',
  },
  {
    name: 'retryMedia',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Retry the media pipeline of a failed native media task.',
  },
  {
    name: 'resolveFilename',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Ask the daemon which filename a URL (or its Content-Disposition) maps to.',
  },

  /* ---- aria2-next: ed2k ---- */
  {
    name: 'ed2kSearch',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Start an ED2K/eMule search and return the gid that tracks it.',
  },
  {
    name: 'getEd2kSearchResults',
    service: RPC_SERVICE_NAME,
    aria2NextOnly: true,
    summary: 'Read the results of a running ED2K search.',
  },

  /* ---- JSON-RPC system methods ---- */
  {
    name: 'system.multicall',
    service: RPC_SYSTEM_SERVICE_NAME,
    summary: 'Send several RPC calls in a single request.',
  },
  {
    name: 'system.listMethods',
    service: RPC_SYSTEM_SERVICE_NAME,
    summary: 'List every method the connected daemon exposes.',
  },
  {
    name: 'system.listNotifications',
    service: RPC_SYSTEM_SERVICE_NAME,
    summary: 'List every notification the connected daemon emits.',
  },
]);

const METHODS_BY_NAME = new Map<string, RpcMethodMeta>();
const METHODS_BY_FULL_NAME = new Map<string, RpcMethodMeta>();
for (const meta of RPC_METHOD_CATALOG) {
  METHODS_BY_NAME.set(meta.name, meta);
  METHODS_BY_FULL_NAME.set(meta.fullName, meta);
}

/** Looks a method up by bare name (`tellStatus`) or full name (`aria2.tellStatus`). */
export function getMethodMeta(name: string): RpcMethodMeta | undefined {
  const trimmed = name?.trim() ?? '';
  return METHODS_BY_FULL_NAME.get(trimmed) ?? METHODS_BY_NAME.get(trimmed);
}

/** `system.multicall` and `system.listMethods` live in the `system` service. */
export function isSystemMethod(name: string): boolean {
  return getMethodMeta(name)?.service === RPC_SYSTEM_SERVICE_NAME;
}

/**
 * Expands a bare method name into the name that goes on the wire.
 * `tellStatus` -> `aria2.tellStatus`; already qualified names are kept as-is.
 */
export function getAria2MethodFullName(name: string): string {
  const trimmed = name?.trim() ?? '';
  const meta = getMethodMeta(trimmed);
  if (meta) {
    return meta.fullName;
  }
  if (
    trimmed.startsWith(`${RPC_SERVICE_NAME}.`) ||
    trimmed.startsWith(`${RPC_SYSTEM_SERVICE_NAME}.`)
  ) {
    return trimmed;
  }
  return `${RPC_SERVICE_NAME}.${trimmed}`;
}

/** The debug page rejects anything that is not in `RPC_METHOD_CATALOG`. */
export function isSupportedMethod(name: string): boolean {
  return getMethodMeta(name) !== undefined;
}

export type RpcMethodInput =
  | { ok: true; /** Normalised (trimmed) method name, e.g. `aria2.tellStatus`. */ name: string }
  | { ok: false; reason: 'illegal' | 'unsupported' };

/**
 * Validates a hand-typed method the same way AriaNg does: the input must be
 * `service.method` with exactly one dot and two non-empty halves, and the
 * method must be one AriaNg knows.
 */
export function parseRpcMethodInput(input: string): RpcMethodInput {
  const name = input?.trim() ?? '';
  const parts = name.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'illegal' };
  }
  if (!isSupportedMethod(name)) {
    return { ok: false, reason: 'unsupported' };
  }
  return { ok: true, name };
}