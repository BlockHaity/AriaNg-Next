/**
 * A faithful, **immutable** port of AriaNg's `aria2TaskService.processDownloadTask`.
 *
 * The original mutated the RPC payload in place (and used
 * `ariaNgCommonService.extendArray` / `copyObjectTo` to keep `ng-repeat`
 * identity stable). That is a footgun in React, so everything here allocates
 * fresh objects and arrays and never touches `raw` or anything nested in it.
 *
 * aria2 sends every number as a *string*; all coercion happens in this module.
 */

import type {
  Aria2Bittorrent,
  Aria2Ed2k,
  Aria2File,
  Aria2Media,
  Aria2TaskStatusResult,
} from '@/rpc/types';
import { Aria2TaskStatus } from '@/config/rpc-constants';
import { completedPiecesOf, computeNumPieces, computePieceLength } from './pieces';
import type {
  FileTreeNode,
  FileTypeInfo,
  NormalizedTask,
  TaskBittorrentView,
  TaskEd2kView,
  TaskMediaView,
} from './types';
import { getBittorrentName, getFileExtension, getFileNameFromFile, getTaskName } from './paths';

/**
 * `aria2.tellStatus` also reports `bitfield` / `numPieces` / `pieceLength`
 * (and aria2-next can add `completedPieces`), but `src/rpc/types.ts` does not
 * declare them. We read them defensively through this intersection so the RPC
 * layer stays untouched.
 */
type TaskStatusExtras = {
  bitfield?: string;
  numPieces?: string | number;
  pieceLength?: string | number;
  completedPieces?: string | number;
};

type TaskStatusWire = Aria2TaskStatusResult & TaskStatusExtras;

export interface NormalizeOptions {
  /**
   * Mirrors AriaNg's `processDownloadTask(task, addVirtualFileNode)`.
   * It only ever has an effect for multi-file torrents.
   */
  addVirtualFileNode?: boolean;
}

/* ------------------------------------------------------------------ */
/* scalar coercion                                                     */
/* ------------------------------------------------------------------ */

function toInt(value: string | number | undefined | null, fallback = 0): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value: string | number | undefined | null, fallback = 0): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : parseFloat(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `undefined` stays `undefined` so optional view fields stay absent. */
function optionalInt(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return toInt(value);
}

function optionalFloat(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return toFloat(value);
}

/** aria2 sends booleans as the strings `'true'` / `'false'`. */
function toBool(value: 'true' | 'false' | boolean | undefined | null): boolean {
  return value === true || value === 'true';
}

/* ------------------------------------------------------------------ */
/* error descriptions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Placeholder for AriaNg's `aria2Errors` table (`descriptionKey` per code).
 *
 * The real table belongs to `src/config/errors.ts`, which is owned by another
 * agent — do NOT create it here.
 */
// TODO: wire aria2 errorCode descriptions once config/errors.ts lands
const ARIA2_ERROR_DESCRIPTION_KEYS: Readonly<Record<string, string>> = {};

/**
 * Maps an aria2 `errorCode` to the i18n key describing it.
 *
 * AriaNg returned `''` for unknown codes *and* for codes flagged `hide`
 * (e.g. `0` and `7`, which are not user-actionable).
 */
export function errorDescriptionFor(errorCode: string | undefined): string {
  if (!errorCode) {
    return '';
  }

  return ARIA2_ERROR_DESCRIPTION_KEYS[errorCode] ?? '';
}

/* ------------------------------------------------------------------ */
/* public arithmetic helpers                                           */
/* ------------------------------------------------------------------ */

/** Remaining time in **seconds**; `0` when stalled. */
export function calculateRemainTime(remain: number, speed: number): number {
  if (speed === 0) {
    return 0;
  }

  return remain / speed;
}

/** Upload / downloaded ratio; `0` while nothing has been downloaded yet. */
export function computeShareRatio(uploadLength: number, completedLength: number): number {
  if (completedLength <= 0) {
    return 0;
  }

  return uploadLength / completedLength;
}

/* ------------------------------------------------------------------ */
/* piece counters (delegated to pieces.ts)                            */
/* ------------------------------------------------------------------ */

/**
 * aria2 reports `numPieces` / `pieceLength` for BitTorrent tasks, but omits
 * both for plain HTTP ones. When only one of the pair is present we derive the
 * other with the same `ceil` rule aria2 itself uses.
 */
function resolvePieceLength(
  wirePieceLength: string | number | undefined,
  wireNumPieces: string | number | undefined,
  totalLength: number,
): number {
  const declaredLength = optionalInt(wirePieceLength);
  if (declaredLength !== undefined && declaredLength > 0) {
    return declaredLength;
  }

  const declaredCount = optionalInt(wireNumPieces);
  if (declaredCount !== undefined && declaredCount > 0) {
    return computePieceLength(totalLength, declaredCount);
  }

  return 0;
}

function resolveNumPieces(
  wireNumPieces: string | number | undefined,
  pieceLength: number,
  totalLength: number,
): number {
  const declared = optionalInt(wireNumPieces);
  if (declared !== undefined && declared > 0) {
    return declared;
  }

  return computeNumPieces(totalLength, pieceLength);
}

/**
 * AriaNg derived this from the bitfield with
 * `countArray(getPieceStatus(bitfield, numPieces), true)`; an explicitly
 * reported value wins.
 */
function resolveCompletedPieces(
  wireCompletedPieces: string | number | undefined,
  bitfield: string,
  numPieces: number,
): number {
  const declared = optionalInt(wireCompletedPieces);
  if (declared !== undefined) {
    return declared;
  }

  return completedPiecesOf(bitfield, numPieces);
}

/* ------------------------------------------------------------------ */
/* sub-views                                                           */
/* ------------------------------------------------------------------ */

function normalizeBittorrent(bt: Aria2Bittorrent): TaskBittorrentView {
  const info = bt.info;
  const error = bt.error;
  const creationDateRaw = bt.creationDate ?? info?.creationDate;

  return {
    mode: bt.mode ?? info?.mode,
    comment: bt.comment ?? info?.['comment.utf-8'] ?? info?.comment,
    creationDate:
      creationDateRaw === undefined || creationDateRaw === ''
        ? undefined
        : toInt(creationDateRaw),
    infoName: getBittorrentName(bt) || undefined,
    privateTorrent: toBool(bt.privateTorrent ?? info?.privateTorrent),

    /* ---- aria2-next ---- */
    fileSelectionState: bt.fileSelectionState,
    state: bt.state,
    errorCode: error?.code,
    errorKind: error?.kind,
    errorCategory: error?.category,
    errorMessage: error?.message,
    errorRecoverable: error?.recoverable,
    errorOperation: error?.operation,
    errorFile: error?.file,
    infoHashV1: bt.infoHashV1,
    infoHashV2: bt.infoHashV2,
    currentTracker: bt.currentTracker,
    numPeers: optionalInt(bt.numPeers),
    connectingPeers: optionalInt(bt.connectingPeers),
    handshakingPeers: optionalInt(bt.handshakingPeers),
    numSeeds: optionalInt(bt.numSeeds),
    progress: optionalFloat(bt.progress),
    activeTime: optionalInt(bt.activeTime),
    finishedTime: optionalInt(bt.finishedTime),
    seedingTime: optionalInt(bt.seedingTime),
  };
}

function normalizeMedia(media: Aria2Media): TaskMediaView {
  const duration = optionalInt(media.duration);
  const lengthKnown = media.lengthKnown !== 'false';

  return {
    state: media.state,
    protocol: media.protocol,
    live: toBool(media.live),
    duration,
    completedDuration: optionalInt(media.completedDuration),
    downloadedLength: toInt(media.downloadedLength),
    /**
     * `null` means "total duration unknown", which the UI renders as an
     * indeterminate bar. AriaNg used the same `!length` bail-out for live
     * streams. When the duration *is* known but aria2 sent no `progress`,
     * this yields `0`.
     */
    progress: !lengthKnown || !duration ? null : toFloat(media.progress),
    lengthKnown,
    error: media.error,
    errorCode: media.errorCode,
    tracks: (media.tracks ?? []).map((track) => ({
      id: track.id,
      type: track.type ?? '',
      language: track.language,
      label: track.label,
      bandwidth: track.bandwidth,
      frameRate: track.frameRate,
      width: track.width,
      height: track.height,
      selected: toBool(track.selected),
    })),
  };
}

function normalizeEd2k(ed2k: Aria2Ed2k): TaskEd2kView {
  // Field names mirror the aria2-next manual's `ed2k` struct verbatim.
  return {
    hash: ed2k.hash,
    name: ed2k.name,
    length: optionalInt(ed2k.length),
    partHashCount: optionalInt(ed2k.partHashCount),
    aichRoot: ed2k.aichRoot,

    serverCount: optionalInt(ed2k.serverCount),
    connectedServerCount: optionalInt(ed2k.connectedServerCount),

    peerCount: optionalInt(ed2k.peerCount),
    queuedPeerCount: optionalInt(ed2k.queuedPeerCount),
    acceptedPeerCount: optionalInt(ed2k.acceptedPeerCount),
    deadPeerCount: optionalInt(ed2k.deadPeerCount),
    lowIdPeerCount: optionalInt(ed2k.lowIdPeerCount),
    callbackWaitingPeerCount: optionalInt(ed2k.callbackWaitingPeerCount),

    kadNodeCount: optionalInt(ed2k.kadNodeCount),
    kadRouterCount: optionalInt(ed2k.kadRouterCount),
    kadFirewalled: ed2k.kadFirewalled,
    kadObservedAddressCount: optionalInt(ed2k.kadObservedAddressCount),

    // Real booleans on the wire, not `'true'` / `'false'` strings.
    searchActive: ed2k.searchActive,
    searchMoreResults: ed2k.searchMoreResults,
    searchResultCount: optionalInt(ed2k.searchResultCount),

    sharingTime: optionalInt(ed2k.sharingTime),
    uploadingPeerCount: optionalInt(ed2k.uploadingPeerCount),
    waitingUploadPeerCount: optionalInt(ed2k.waitingUploadPeerCount),
    peerCreditCount: optionalInt(ed2k.peerCreditCount),
  };
}

function normalizeFile(file: Aria2File, status: string): FileTypeInfo {
  const index = toInt(file.index);
  const length = toInt(file.length);
  const completedLength = toInt(file.completedLength);
  const fileName = getFileNameFromFile(file);

  return {
    index,
    // aria2's `select-file` is 1-based.
    aria2Index: index + 1,
    fileName,
    path: file.path ?? '',
    length,
    completedLength,
    completePercent:
      length > 0
        ? (completedLength / length) * 100
        : status === Aria2TaskStatus.Complete
          ? 100
          : 0,
    selected: toBool(file.selected),
    extension: getFileExtension(fileName),
  };
}

/**
 * AriaNg only set `singleUrl` when the task had exactly one file and every one
 * of that file's URIs was the same string.
 */
function detectSingleUrl(rawFiles: readonly Aria2File[] | undefined): string | undefined {
  if (!rawFiles || rawFiles.length !== 1) {
    return undefined;
  }

  const uris = rawFiles[0]?.uris;
  if (!uris || uris.length === 0) {
    return undefined;
  }

  const firstUri = uris[0].uri;
  if (!firstUri) {
    return undefined;
  }

  for (const entry of uris) {
    if (entry.uri !== firstUri) {
      return undefined;
    }
  }

  return firstUri;
}

/* ------------------------------------------------------------------ */
/* entry points                                                        */
/* ------------------------------------------------------------------ */

export function normalizeTask(
  raw: Aria2TaskStatusResult,
  opts: NormalizeOptions = {},
): NormalizedTask {
  const wire = raw as TaskStatusWire;
  const status = raw.status;

  const totalLength = toInt(raw.totalLength);
  const completedLength = toInt(raw.completedLength);
  const uploadLength = toInt(raw.uploadLength);
  const downloadSpeed = toInt(raw.downloadSpeed);
  const uploadSpeed = toInt(raw.uploadSpeed);

  const completePercent =
    totalLength > 0
      ? (completedLength / totalLength) * 100
      : status === Aria2TaskStatus.Complete
        ? 100
        : 0;

  const remainLength = Math.max(totalLength - completedLength, 0);
  const remainPercent = Math.max(100 - completePercent, 0);

  const bitfield = wire.bitfield ?? '';
  const pieceLength = resolvePieceLength(wire.pieceLength, wire.numPieces, totalLength);
  const numPieces = resolveNumPieces(wire.numPieces, pieceLength, totalLength);
  const completedPieces = resolveCompletedPieces(wire.completedPieces, bitfield, numPieces);

  const rawFiles = raw.files;
  const files: FileTypeInfo[] = [];
  let selectedFileCount = 0;

  for (const file of rawFiles ?? []) {
    const info = normalizeFile(file, status);

    if (info.selected) {
      selectedFileCount++;
    }

    files.push(info);
  }

  const { name: taskName, success: hasTaskName } = getTaskName(raw);

  // AriaNg wrote `parseInt(verifiedLength / totalLength * 100)`, i.e. it
  // truncated the ratio rather than rounding it.
  const verifiedPercent =
    raw.verifiedLength !== undefined && totalLength > 0
      ? Math.trunc((toInt(raw.verifiedLength) / totalLength) * 100)
      : undefined;

  // AriaNg only ever built the virtual tree for multi-file torrents.
  const wantVirtualFileNode = opts.addVirtualFileNode === true && raw.bittorrent?.mode === 'multi';

  // TODO: populate `fileTree` from domain/filetree.ts once that module lands
  // (AriaNg's rule: `allDirectories.length > 1` → `multiDir`).
  const fileTree: FileTreeNode[] = [];
  const multiDir = wantVirtualFileNode && fileTree.length > 1;

  return {
    gid: raw.gid,
    status,
    taskName,
    hasTaskName,

    totalLength,
    completedLength,
    completePercent,
    remainLength,
    remainPercent,
    uploadLength,
    shareRatio: computeShareRatio(uploadLength, completedLength),
    uploadSpeed,
    downloadSpeed,
    // Primary sort key for "remaining" (AriaNg: `task.downloadSpeed === 0`).
    idle: downloadSpeed === 0,

    connections: toInt(raw.connections),
    numSeeders: toInt(raw.numSeeders),
    seeder: toBool(raw.seeder),
    dir: raw.dir ?? '',

    numPieces,
    completedPieces,
    pieceLength,
    bitfield,

    // Seconds. AriaNg showed `HH:mm:ss` only for `0 <= remainTime < 86400`,
    // so the raw value is kept here and the UI decides what to render.
    remainTime:
      status === Aria2TaskStatus.Active ? calculateRemainTime(remainLength, downloadSpeed) : null,

    verifiedPercent,
    verifyIntegrityPending: toBool(raw.verifyIntegrityPending),

    errorCode: raw.errorCode,
    errorMessage: raw.errorMessage,
    errorDescription: errorDescriptionFor(raw.errorCode),

    files,
    fileTree,
    multiDir,
    selectedFileCount,
    singleUrl: detectSingleUrl(rawFiles),

    infoHash: raw.infoHash,
    bittorrent: raw.bittorrent ? normalizeBittorrent(raw.bittorrent) : undefined,
    // TODO: populated lazily by the task store via `aria2.getBtTrackers`.
    trackers: [],
    media: raw.media ? normalizeMedia(raw.media) : undefined,
    ed2k: raw.ed2k ? normalizeEd2k(raw.ed2k) : undefined,

    following: raw.following,
    belongsTo: raw.belongsTo,
  };
}

export function normalizeTasks(
  raw: Aria2TaskStatusResult[],
  opts: NormalizeOptions = {},
): NormalizedTask[] {
  return (raw ?? []).map((task) => normalizeTask(task, opts));
}

/* ------------------------------------------------------------------ */
/* task predicates (ported from AriaNg `root.js` / `list.html`)         */
/* ------------------------------------------------------------------ */

/**
 * `root.js`: `task && task.status === 'error' && task.errorDescription &&
 * !task.bittorrent`.
 *
 * Note this also requires a *known* `errorDescription`, so it stays `false`
 * for every code until the `errorCode` → i18n table is wired up.
 */
export function isTaskRetryable(task: NormalizedTask): boolean {
  return task.status === 'error' && !!task.errorDescription && !task.bittorrent;
}

/**
 * AriaNg badges "Seeding" for `active` + `seeder` (`list.html`,
 * `filters/taskStatus.js`); aria2-next additionally advertises the phase
 * explicitly through `bittorrent.state`.
 */
export function isSeeding(task: NormalizedTask): boolean {
  if (task.bittorrent?.state === 'seeding') {
    return true;
  }

  return task.status === 'active' && task.seeder;
}
