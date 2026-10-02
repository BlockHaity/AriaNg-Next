import { describe, expect, it } from 'vitest';

import type {
  Aria2Bittorrent,
  Aria2Ed2k,
  Aria2File,
  Aria2Media,
  Aria2TaskStatusResult,
} from '@/rpc/types';
import { buildEd2kLink } from '../ed2k';
import {
  calculateRemainTime,
  computeShareRatio,
  errorDescriptionFor,
  isSeeding,
  isTaskRetryable,
  normalizeTask,
  normalizeTasks,
} from '../normalize';

/**
 * `tellStatus` also reports bitfield / numPieces / pieceLength; those are read
 * defensively by `normalize.ts` but are not declared on `Aria2TaskStatusResult`
 * yet, so fixtures may carry them.
 */
type TaskWireExtras = {
  bitfield?: string;
  numPieces?: string | number;
  pieceLength?: string | number;
  completedPieces?: string | number;
};

type TaskFixture = Aria2TaskStatusResult & TaskWireExtras;

/* ------------------------------------------------------------------ */
/* immutability guard                                                  */
/* ------------------------------------------------------------------ */

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }

  return value;
}

/** Spread helper that keeps literal types narrow (`'true'`, `'complete'`, ...). */
function withOverrides(base: TaskFixture, overrides: Partial<TaskFixture>): TaskFixture {
  return { ...base, ...overrides };
}

/** Snapshots the fixture and deep-freezes it so any mutation throws loudly. */
function guard<T extends object>(raw: T): { readonly raw: T; readonly snapshot: T } {
  const snapshot = JSON.parse(JSON.stringify(raw)) as T;
  deepFreeze(raw);
  return { raw, snapshot };
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function httpFile(overrides: Partial<Aria2File> = {}): Aria2File {
  return {
    // aria2's file index is a **1-based decimal string** ("Values are strings",
    // "Index of the file, starting at 1").
    index: '1',
    path: '/home/user/downloads/movie.mp4',
    length: '1000',
    completedLength: '250',
    selected: 'true',
    uris: [{ uri: 'http://example.com/movie.mp4', status: 'used' }],
    ...overrides,
  };
}

function buildHttpActive(): TaskFixture {
  return {
    gid: '2089b05ecca3d829',
    status: 'active',
    totalLength: '1000',
    completedLength: '250',
    uploadLength: '50',
    downloadSpeed: '100',
    uploadSpeed: '10',
    connections: '5',
    numSeeders: '0',
    dir: '/home/user/downloads',
    files: [httpFile()],
  };
}

function buildCompletedUnknownLength(): TaskFixture {
  return {
    gid: '0000000000000001',
    status: 'complete',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    numSeeders: '0',
    dir: '/home/user/downloads',
    files: [],
  };
}

function buildPaused(): TaskFixture {
  return {
    gid: '0000000000000002',
    status: 'paused',
    totalLength: '200',
    completedLength: '50',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '3',
    numSeeders: '0',
    dir: '/home/user/downloads',
    files: [httpFile({ path: '/home/user/downloads/paused.bin', length: '200', completedLength: '50' })],
  };
}

function buildErrored(): TaskFixture {
  return {
    gid: '0000000000000003',
    status: 'error',
    totalLength: '1000',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '1',
    numSeeders: '0',
    errorCode: '3',
    errorMessage: 'Resource not found',
    dir: '/home/user/downloads',
    files: [httpFile({ completedLength: '0' })],
  };
}

function btInfo(overrides: Partial<Aria2Bittorrent['info']> = {}): Aria2Bittorrent['info'] {
  return {
    name: 'Plain Torrent Name',
    'name.utf-8': 'Ünïcode Tôrrent',
    comment: 'info comment',
    creationDate: '1700000000',
    mode: 'multi',
    privateTorrent: 'true',
    ...overrides,
  };
}

function buildMagnetBt(): TaskFixture {
  return {
    gid: '0000000000000004',
    status: 'active',
    totalLength: '786432',
    completedLength: '196608',
    uploadLength: '1024',
    downloadSpeed: '65536',
    uploadSpeed: '512',
    connections: '12',
    numSeeders: '4',
    seeder: 'false',
    dir: '/home/user/downloads',
    infoHash: 'aabbccddeeff00112233445566778899aabbccdd',
    pieceLength: '262144',
    bitfield: 'a0',
    files: [
      httpFile({
        index: '1',
        path: '/home/user/downloads/Ünïcode Tôrrent/a.mkv',
        length: '262144',
        completedLength: '262144',
      }),
    ],
    bittorrent: {
      mode: 'multi',
      comment: 'top level comment',
      info: btInfo(),
      privateTorrent: 'true',
      fileSelectionState: 'ready',
      state: 'downloading',
      infoHashV1: 'aabbccddeeff00112233445566778899aabbccdd',
      infoHashV2: '1122334455667788990011223344556677889900',
      currentTracker: 'udp://tracker.example.com:6969/announce',
      numPeers: '12',
      connectingPeers: '3',
      handshakingPeers: '2',
      numSeeds: '4',
      progress: '0.25',
      activeTime: '60',
      finishedTime: '0',
      seedingTime: '0',
    },
  };
}

function buildAwaitingFileSelection(): TaskFixture {
  return {
    gid: '0000000000000005',
    status: 'waiting',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    numSeeders: '0',
    dir: '/home/user/downloads',
    infoHash: 'ffff0000ffff0000ffff0000ffff0000ffff0000',
    files: [],
    bittorrent: {
      mode: 'multi',
      info: btInfo({ name: 'Awaiting Torrent', 'name.utf-8': 'Awaiting Torrent' }),
      fileSelectionState: 'awaiting',
      state: 'downloadingMetadata',
    },
  };
}

function buildBtStructuredError(): TaskFixture {
  return {
    gid: '0000000000000006',
    status: 'error',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    numSeeders: '0',
    errorCode: '26',
    dir: '/home/user/downloads',
    infoHash: 'aaaabbbbccccddddeeeeffff00001111aaaabbbb',
    files: [],
    bittorrent: {
      mode: 'single',
      info: btInfo({ name: 'Broken Torrent' }),
      state: 'error',
      error: {
        code: 26,
        kind: 'torrent_corrupted',
        category: 'input',
        message: 'torrent file is corrupted',
        recoverable: true,
        operation: 'addTorrent',
        file: 'broken.torrent',
      },
    },
  };
}

function buildMediaHls(): TaskFixture {
  const media: Aria2Media = {
    state: 'downloading',
    protocol: 'hls',
    live: 'false',
    duration: '10000',
    completedDuration: '2500',
    downloadedLength: '1048576',
    progress: '0.25',
    lengthKnown: 'true',
    tracks: [
      {
        id: '1',
        type: 'video',
        label: '1080p',
        bandwidth: '4000000',
        frameRate: '24/1',
        width: '1920',
        height: '1080',
        mimeType: 'video/mp4',
        selected: 'true',
      },
      {
        id: '2',
        type: 'audio',
        language: 'en',
        bandwidth: '128000',
        selected: 'false',
      },
    ],
  };

  return {
    gid: '0000000000000007',
    status: 'active',
    totalLength: '2097152',
    completedLength: '524288',
    downloadSpeed: '131072',
    uploadSpeed: '0',
    connections: '1',
    numSeeders: '0',
    dir: '/home/user/downloads',
    files: [httpFile({ path: '/home/user/downloads/stream', length: '2097152', completedLength: '524288' })],
    media,
  };
}

function buildEd2k(): TaskFixture {
  // Field names transcribed from the aria2-next manual's `ed2k` struct. Note it
  // carries **no** `ed2kLink` — that exists only on search results, which is why
  // the ED2K link has to be reconstructed (see `domain/ed2k.ts`).
  const ed2k: Aria2Ed2k = {
    hash: '31D6CFE0D16AE931B73C59D7E0C089C0',
    name: 'movie.avi',
    length: '734003200',
    partHashCount: '512',
    aichRoot: 'ABCDEF0123456789',
    serverCount: '5',
    connectedServerCount: '2',
    peerCount: '30',
    queuedPeerCount: '10',
    acceptedPeerCount: '3',
    deadPeerCount: '1',
    lowIdPeerCount: '4',
    callbackWaitingPeerCount: '2',
    kadNodeCount: '9',
    kadRouterCount: '2',
    kadFirewalled: false,
    kadObservedAddressCount: '3',
    searchActive: false,
    searchMoreResults: true,
    searchResultCount: '120',
    sharingTime: '3600',
    uploadingPeerCount: '3',
    waitingUploadPeerCount: '7',
    peerCreditCount: '1',
  };

  return {
    gid: '0000000000000008',
    status: 'active',
    totalLength: '734003200',
    completedLength: '100',
    uploadLength: '50',
    downloadSpeed: '1024',
    uploadSpeed: '10',
    connections: '2',
    numSeeders: '0',
    dir: '/home/user/downloads',
    files: [
      httpFile({
        path: '/home/user/downloads/movie.avi',
        length: '734003200',
        completedLength: '100',
        selected: 'true',
      }),
    ],
    ed2k,
  };
}

function buildMultiFileBt(): TaskFixture {
  const base = '/home/user/downloads/My.Torrent';

  return {
    gid: '0000000000000009',
    status: 'waiting',
    totalLength: '786432',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    numSeeders: '0',
    dir: '/home/user/downloads',
    infoHash: '9999888877776666555544443333222211110000',
    pieceLength: '262144',
    files: [
      httpFile({
        index: '1',
        path: `${base}/a.mkv`,
        length: '262144',
        completedLength: '0',
        selected: 'true',
        uris: undefined,
      }),
      httpFile({
        index: '2',
        path: `${base}/Season 1/b.mkv`,
        length: '262144',
        completedLength: '0',
        selected: 'true',
        uris: undefined,
      }),
      httpFile({
        index: '3',
        path: `${base}/readme.txt`,
        length: '262144',
        completedLength: '0',
        selected: 'false',
        uris: undefined,
      }),
    ],
    bittorrent: {
      mode: 'multi',
      info: btInfo({ name: 'My.Torrent' }),
      privateTorrent: 'false',
      fileSelectionState: 'none',
      state: 'downloadingMetadata',
    },
  };
}

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

describe('normalizeTask — plain HTTP download (active)', () => {
  it('computes percentages, remainders, share ratio and remain time', () => {
    const { raw } = guard(buildHttpActive());
    const task = normalizeTask(raw);

    expect(task.gid).toBe('2089b05ecca3d829');
    expect(task.status).toBe('active');
    expect(task.totalLength).toBe(1000);
    expect(task.completedLength).toBe(250);
    expect(task.completePercent).toBe(25);
    expect(task.remainLength).toBe(750);
    expect(task.remainPercent).toBe(75);
    expect(task.uploadLength).toBe(50);
    expect(task.shareRatio).toBe(0.2);
    expect(task.downloadSpeed).toBe(100);
    expect(task.uploadSpeed).toBe(10);
    expect(task.connections).toBe(5);
    expect(task.numSeeders).toBe(0);
    expect(task.seeder).toBe(false);
    expect(task.idle).toBe(false);
    // 750 bytes remaining at 100 B/s.
    expect(task.remainTime).toBe(7.5);
    expect(task.remainTime).not.toBeNull();
  });

  it('exposes the file list, selected count and singleUrl', () => {
    const { raw } = guard(buildHttpActive());
    const task = normalizeTask(raw);

    expect(task.files).toHaveLength(1);
    expect(task.files[0]).toEqual({
      index: 1,
      aria2Index: 1,
      fileName: 'movie.mp4',
      path: '/home/user/downloads/movie.mp4',
      length: 1000,
      completedLength: 250,
      completePercent: 25,
      selected: true,
      extension: 'mp4',
    });
    expect(task.selectedFileCount).toBe(1);
    expect(task.singleUrl).toBe('http://example.com/movie.mp4');
    expect(task.taskName).toBe('movie.mp4');
    expect(task.hasTaskName).toBe(true);
    expect(task.fileTree).toEqual([]);
    expect(task.multiDir).toBe(false);
    expect(task.trackers).toEqual([]);
  });

  it('builds the file tree and flips multiDir for a multi-file torrent', () => {
    const { raw } = guard(buildMultiFileBt());
    const task = normalizeTask(raw, { addVirtualFileNode: true });

    // `buildFileTree` owns the shape; here we only pin that the request is
    // honoured and that multiDir is derived from the directory count.
    expect(task.fileTree.length).toBeGreaterThan(0);
    expect(task.multiDir).toBe(true);
    expect(task.fileTree.some((node) => node.isDir)).toBe(true);
  });

  it('leaves the tree empty unless it is explicitly requested', () => {
    const { raw } = guard(buildMultiFileBt());

    // AriaNg only built the virtual tree when the caller asked for it, because
    // it is only ever rendered by the detail page's Files tab.
    expect(normalizeTask(raw).fileTree).toEqual([]);
    expect(normalizeTask(raw).multiDir).toBe(false);
  });

  it('does not build a tree for a single-mode torrent or a non-torrent', () => {
    const http = guard(buildHttpActive());
    expect(normalizeTask(http.raw, { addVirtualFileNode: true }).fileTree).toEqual([]);

    const single = guard(
      withOverrides(buildMultiFileBt(), { bittorrent: { mode: 'single' } }),
    );
    expect(normalizeTask(single.raw, { addVirtualFileNode: true }).fileTree).toEqual([]);
  });

  it('reports verifiedPercent / verifyIntegrityPending only when present', () => {
    const { raw } = guard(buildHttpActive());
    expect(normalizeTask(raw).verifiedPercent).toBeUndefined();
    expect(normalizeTask(raw).verifyIntegrityPending).toBe(false);

    const verifying = guard(
      withOverrides(buildHttpActive(), {
        verifiedLength: '500',
        verifyIntegrityPending: 'true',
      }),
    );
    const verifyingTask = normalizeTask(verifying.raw);

    expect(verifyingTask.verifiedPercent).toBe(50);
    expect(verifyingTask.verifyIntegrityPending).toBe(true);
  });
});

describe('normalizeTask — completed task with unknown length', () => {
  it('is 100% complete even though totalLength is 0', () => {
    const { raw } = guard(buildCompletedUnknownLength());
    const task = normalizeTask(raw);

    expect(task.status).toBe('complete');
    expect(task.completePercent).toBe(100);
    expect(task.remainLength).toBe(0);
    expect(task.remainPercent).toBe(0);
    expect(task.shareRatio).toBe(0);
    expect(task.idle).toBe(true);
    // Not active → no remain time at all.
    expect(task.remainTime).toBeNull();
    expect(task.taskName).toBe('Unknown');
    expect(task.hasTaskName).toBe(false);
    expect(task.files).toEqual([]);
    expect(task.selectedFileCount).toBe(0);
    expect(task.singleUrl).toBeUndefined();
  });
});

describe('normalizeTask — paused task', () => {
  it('has no remain time and is idle', () => {
    const { raw } = guard(buildPaused());
    const task = normalizeTask(raw);

    expect(task.status).toBe('paused');
    expect(task.completePercent).toBe(25);
    expect(task.remainLength).toBe(150);
    expect(task.remainPercent).toBe(75);
    expect(task.idle).toBe(true);
    expect(task.remainTime).toBeNull();
  });

  it('clamps remainLength/remainPercent to >= 0 when completed exceeds total', () => {
    const { raw } = guard(
      withOverrides(buildPaused(), { totalLength: '100', completedLength: '150' }),
    );
    const task = normalizeTask(raw);

    expect(task.completePercent).toBe(150);
    expect(task.remainLength).toBe(0);
    expect(task.remainPercent).toBe(0);
  });
});

describe('normalizeTask — errored task', () => {
  it('keeps errorCode / errorMessage and leaves the description empty for now', () => {
    const { raw } = guard(buildErrored());
    const task = normalizeTask(raw);

    expect(task.status).toBe('error');
    expect(task.errorCode).toBe('3');
    expect(task.errorMessage).toBe('Resource not found');
    // TODO: config/errors.ts does not exist yet, so no descriptions resolve.
    expect(task.errorDescription).toBe('');
  });

  it('is not retryable: AriaNg also requires a known errorDescription', () => {
    const { raw } = guard(buildErrored());
    // Becomes `true` once the errorCode -> i18n table is wired up.
    expect(isTaskRetryable(normalizeTask(raw))).toBe(false);

    const { raw: ok } = guard(buildHttpActive());
    expect(isTaskRetryable(normalizeTask(ok))).toBe(false);
  });

  it('is never retryable for a BitTorrent task', () => {
    const { raw } = guard(buildBtStructuredError());
    const task = normalizeTask(raw);

    expect(task.bittorrent).toBeDefined();
    expect(isTaskRetryable(task)).toBe(false);
  });
});

describe('normalizeTask — magnet / BitTorrent task with aria2-next fields', () => {
  it('maps the bittorrent view', () => {
    const { raw } = guard(buildMagnetBt());
    const task = normalizeTask(raw);
    const bt = task.bittorrent;

    expect(bt).toBeDefined();
    expect(bt?.mode).toBe('multi');
    expect(bt?.comment).toBe('top level comment');
    expect(bt?.creationDate).toBe(1700000000);
    // utf-8 name wins over the plain name.
    expect(bt?.infoName).toBe('Ünïcode Tôrrent');
    expect(bt?.privateTorrent).toBe(true);
    expect(bt?.fileSelectionState).toBe('ready');
    expect(bt?.state).toBe('downloading');
    expect(bt?.infoHashV1).toBe('aabbccddeeff00112233445566778899aabbccdd');
    expect(bt?.infoHashV2).toBe('1122334455667788990011223344556677889900');
    expect(bt?.currentTracker).toBe('udp://tracker.example.com:6969/announce');
    expect(bt?.numPeers).toBe(12);
    expect(bt?.connectingPeers).toBe(3);
    expect(bt?.handshakingPeers).toBe(2);
    expect(bt?.numSeeds).toBe(4);
    expect(bt?.progress).toBe(0.25);
    expect(bt?.activeTime).toBe(60);
    expect(bt?.finishedTime).toBe(0);
    expect(bt?.seedingTime).toBe(0);
    expect(task.infoHash).toBe('aabbccddeeff00112233445566778899aabbccdd');
    expect(task.taskName).toBe('Ünïcode Tôrrent');
    expect(task.hasTaskName).toBe(true);
  });

  it('derives the piece counters from pieceLength / bitfield', () => {
    const { raw } = guard(buildMagnetBt());
    const task = normalizeTask(raw);

    // 786432 / 262144 = 3 pieces; 'a0' = 1010 0000 → pieces 0 and 2 done.
    expect(task.pieceLength).toBe(262144);
    expect(task.numPieces).toBe(3);
    expect(task.completedPieces).toBe(2);
    expect(task.bitfield).toBe('a0');
  });

  it('prefers an explicitly reported completedPieces', () => {
    const { raw } = guard(withOverrides(buildMagnetBt(), { completedPieces: '1' }));
    expect(normalizeTask(raw).completedPieces).toBe(1);
  });

  it('coerces a "seeding" bittorrent state', () => {
    const bt = buildMagnetBt().bittorrent;
    const { raw } = guard(
      withOverrides(buildMagnetBt(), {
        status: 'complete',
        seeder: 'true',
        bittorrent: bt ? { ...bt, state: 'seeding' } : undefined,
      }),
    );
    const task = normalizeTask(raw);

    expect(task.seeder).toBe(true);
    expect(isSeeding(task)).toBe(true);
  });
});

describe('normalizeTask — fileSelectionState: awaiting', () => {
  it('keeps the awaiting state so the UI can block unpause', () => {
    const { raw } = guard(buildAwaitingFileSelection());
    const task = normalizeTask(raw);

    expect(task.bittorrent?.fileSelectionState).toBe('awaiting');
    expect(task.bittorrent?.state).toBe('downloadingMetadata');
    expect(task.bittorrent?.infoName).toBe('Awaiting Torrent');
    expect(task.remainTime).toBeNull();
  });
});

describe('normalizeTask — structured BitTorrent error', () => {
  it('flattens bittorrent.error', () => {
    const { raw } = guard(buildBtStructuredError());
    const bt = normalizeTask(raw).bittorrent;

    expect(bt?.errorCode).toBe(26);
    expect(bt?.errorKind).toBe('torrent_corrupted');
    expect(bt?.errorCategory).toBe('input');
    expect(bt?.errorMessage).toBe('torrent file is corrupted');
    expect(bt?.errorRecoverable).toBe(true);
    expect(bt?.errorOperation).toBe('addTorrent');
    expect(bt?.errorFile).toBe('broken.torrent');
  });
});

describe('normalizeTask — media (HLS) task', () => {
  it('maps the media view and its tracks', () => {
    const { raw } = guard(buildMediaHls());
    const task = normalizeTask(raw);
    const media = task.media;

    expect(media).toBeDefined();
    expect(media?.state).toBe('downloading');
    expect(media?.protocol).toBe('hls');
    expect(media?.live).toBe(false);
    expect(media?.duration).toBe(10000);
    expect(media?.completedDuration).toBe(2500);
    expect(media?.downloadedLength).toBe(1048576);
    expect(media?.progress).toBe(0.25);
    expect(media?.lengthKnown).toBe(true);
    expect(media?.tracks).toEqual([
      {
        id: '1',
        type: 'video',
        label: '1080p',
        bandwidth: '4000000',
        frameRate: '24/1',
        width: '1920',
        height: '1080',
        selected: true,
      },
      {
        id: '2',
        type: 'audio',
        language: 'en',
        bandwidth: '128000',
        frameRate: undefined,
        width: undefined,
        height: undefined,
        label: undefined,
        selected: false,
      },
    ]);
  });

  it('reports progress: null for a live stream with an unknown duration', () => {
    const base = buildMediaHls();
    const { raw } = guard(
      withOverrides(base, {
        media: {
          ...base.media,
          live: 'true',
          lengthKnown: 'false',
          duration: '0',
          progress: '0.5',
        },
      }),
    );
    const media = normalizeTask(raw).media;

    expect(media?.live).toBe(true);
    expect(media?.lengthKnown).toBe(false);
    expect(media?.progress).toBeNull();
  });

  it('reports progress: null when the duration is missing', () => {
    const base = buildMediaHls();
    const { raw } = guard(
      withOverrides(base, {
        media: { ...base.media, duration: undefined, progress: '0.5' },
      }),
    );
    expect(normalizeTask(raw).media?.progress).toBeNull();
  });
});

describe('normalizeTask — ED2K task', () => {
  it('maps every ED2K counter as a number', () => {
    const { raw } = guard(buildEd2k());
    const ed2k = normalizeTask(raw).ed2k;

    expect(ed2k).toEqual({
      hash: '31D6CFE0D16AE931B73C59D7E0C089C0',
      name: 'movie.avi',
      length: 734003200,
      partHashCount: 512,
      aichRoot: 'ABCDEF0123456789',
      serverCount: 5,
      connectedServerCount: 2,
      peerCount: 30,
      queuedPeerCount: 10,
      acceptedPeerCount: 3,
      deadPeerCount: 1,
      lowIdPeerCount: 4,
      callbackWaitingPeerCount: 2,
      kadNodeCount: 9,
      kadRouterCount: 2,
      // Real booleans on the wire, not 'true'/'false' strings.
      kadFirewalled: false,
      kadObservedAddressCount: 3,
      searchActive: false,
      searchMoreResults: true,
      searchResultCount: 120,
      sharingTime: 3600,
      uploadingPeerCount: 3,
      waitingUploadPeerCount: 7,
      peerCreditCount: 1,
    });
  });

  it('lets the ED2K link be rebuilt from the identity triple', () => {
    const { raw } = guard(buildEd2k());
    expect(buildEd2kLink(normalizeTask(raw).ed2k)).toBe(
      'ed2k://|file|movie.avi|734003200|31D6CFE0D16AE931B73C59D7E0C089C0|/',
    );
  });
});

describe('normalizeTask — multi-file BT task', () => {
  it('counts the selected files and omits singleUrl', () => {
    const { raw } = guard(buildMultiFileBt());
    const task = normalizeTask(raw);

    expect(task.files.map((file) => file.fileName)).toEqual([
      'a.mkv',
      'b.mkv',
      'readme.txt',
    ]);
    expect(task.files.map((file) => file.aria2Index)).toEqual([1, 2, 3]);
    expect(task.files.map((file) => file.selected)).toEqual([true, true, false]);
    expect(task.files.map((file) => file.extension)).toEqual(['mkv', 'mkv', 'txt']);
    expect(task.selectedFileCount).toBe(2);
    expect(task.singleUrl).toBeUndefined();
    expect(task.numPieces).toBe(3);
    expect(task.completedPieces).toBe(0);
  });

  it('omits singleUrl when a single file has differing uris', () => {
    const { raw } = guard(
      withOverrides(buildHttpActive(), {
        files: [
          httpFile({
            uris: [
              { uri: 'http://a/one', status: 'used' },
              { uri: 'http://b/two', status: 'waiting' },
            ],
          }),
        ],
      }),
    );
    expect(normalizeTask(raw).singleUrl).toBeUndefined();
  });

  it('sets singleUrl when every uri of the single file is identical', () => {
    const { raw } = guard(
      withOverrides(buildHttpActive(), {
        files: [
          httpFile({
            uris: [
              { uri: 'http://a/one', status: 'used' },
              { uri: 'http://a/one', status: 'waiting' },
            ],
          }),
        ],
      }),
    );
    expect(normalizeTask(raw).singleUrl).toBe('http://a/one');
  });
});

describe('immutability', () => {
  it('never mutates a plain HTTP fixture', () => {
    const { raw, snapshot } = guard(buildHttpActive());
    const before = JSON.stringify(raw);

    const task = normalizeTask(raw);

    expect(task.gid).toBe(raw.gid);
    expect(raw).toEqual(snapshot);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('never mutates a BitTorrent / media / ed2k fixture', () => {
    const { raw, snapshot } = guard(buildMagnetBt());
    normalizeTask(raw, { addVirtualFileNode: true });
    expect(raw).toEqual(snapshot);

    const media = guard(buildMediaHls());
    normalizeTask(media.raw);
    expect(media.raw).toEqual(media.snapshot);

    const ed2k = guard(buildEd2k());
    normalizeTask(ed2k.raw);
    expect(ed2k.raw).toEqual(ed2k.snapshot);

    const multi = guard(buildMultiFileBt());
    normalizeTask(multi.raw, { addVirtualFileNode: true });
    expect(multi.raw).toEqual(multi.snapshot);
  });

  it('allocates fresh objects and arrays on every call', () => {
    const { raw } = guard(buildHttpActive());

    const a = normalizeTask(raw);
    const b = normalizeTask(raw);

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.files).not.toBe(b.files);
    expect(a.files[0]).not.toBe(b.files[0]);
    expect(a.trackers).not.toBe(b.trackers);
  });
});

describe('normalizeTasks', () => {
  it('normalises every task in order', () => {
    const { raw } = guard([buildHttpActive(), buildPaused(), buildErrored()]);
    const tasks = normalizeTasks(raw);

    expect(tasks.map((task) => task.gid)).toEqual([
      '2089b05ecca3d829',
      '0000000000000002',
      '0000000000000003',
    ]);
    expect(tasks).toHaveLength(3);
    expect(raw).toHaveLength(3);
  });

  it('returns an empty array for an empty list', () => {
    expect(normalizeTasks([])).toEqual([]);
  });
});

describe('helpers', () => {
  it('calculateRemainTime returns 0 when stalled', () => {
    expect(calculateRemainTime(1000, 0)).toBe(0);
    expect(calculateRemainTime(1000, 100)).toBe(10);
    expect(calculateRemainTime(0, 100)).toBe(0);
  });

  it('computeShareRatio guards against a zero denominator', () => {
    expect(computeShareRatio(100, 0)).toBe(0);
    expect(computeShareRatio(100, 200)).toBe(0.5);
    expect(computeShareRatio(0, 200)).toBe(0);
  });

  it('errorDescriptionFor returns an empty string while the table is unwired', () => {
    expect(errorDescriptionFor(undefined)).toBe('');
    expect(errorDescriptionFor('')).toBe('');
    expect(errorDescriptionFor('3')).toBe('');
  });

  it('isSeeding mirrors AriaNg: active + seeder', () => {
    const bt = buildMagnetBt().bittorrent;
    const { raw } = guard(buildMagnetBt());
    expect(isSeeding(normalizeTask(raw))).toBe(false);

    const { raw: seedingRaw } = guard(withOverrides(buildMagnetBt(), { seeder: 'true' }));
    expect(isSeeding(normalizeTask(seedingRaw))).toBe(true);

    // A seeder flag on a stopped task is not "seeding".
    const { raw: stoppedRaw } = guard(
      withOverrides(buildMagnetBt(), {
        status: 'complete',
        seeder: 'true',
        bittorrent: bt ? { ...bt, state: 'finished' } : undefined,
      }),
    );
    expect(isSeeding(normalizeTask(stoppedRaw))).toBe(false);
  });
});
