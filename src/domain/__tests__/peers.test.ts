import { describe, expect, it } from 'vitest';

import type { Aria2Peer } from '@/rpc/types';
import {
  getCombinedPeerPieces,
  LOCAL_PEER_NAME,
  normalizePeers,
} from '../peers';

function makePeer(overrides: Partial<Aria2Peer> = {}): Aria2Peer {
  return {
    peerId: '-qB4550-1234567890',
    ip: '10.0.0.1',
    port: '51413',
    bitfield: 'ffff',
    amChoking: 'false',
    peerChoking: 'false',
    downloadSpeed: '0',
    uploadSpeed: '0',
    seeder: 'true',
    ...overrides,
  };
}

describe('normalizePeers — speeds', () => {
  it('swaps aria2’s peer-perspective speeds', () => {
    const [peer] = normalizePeers([
      makePeer({ downloadSpeed: '100', uploadSpeed: '200' }),
    ]);

    expect(peer.downloadSpeed).toBe(200);
    expect(peer.uploadSpeed).toBe(100);
  });

  it('coerces missing / garbage speeds to 0', () => {
    const [peer] = normalizePeers([
      makePeer({ downloadSpeed: 'abc', uploadSpeed: '' }),
    ]);

    expect(peer.downloadSpeed).toBe(0);
    expect(peer.uploadSpeed).toBe(0);
  });
});

describe('normalizePeers — identity fields', () => {
  it('formats the name as ip:port', () => {
    const [peer] = normalizePeers([makePeer({ ip: '1.2.3.4', port: '6881' })]);

    expect(peer.name).toBe('1.2.3.4:6881');
    expect(peer.ip).toBe('1.2.3.4');
    expect(peer.port).toBe('6881');
    expect(peer.peerId).toBe('-qB4550-1234567890');
  });

  it('coerces the string flags', () => {
    const [peer] = normalizePeers([
      makePeer({ seeder: 'true', amChoking: 'true', peerChoking: 'false' }),
    ]);

    expect(peer.seeder).toBe(true);
    expect(peer.amChoking).toBe(true);
    expect(peer.peerChoking).toBe(false);

    const [leecher] = normalizePeers([makePeer({ seeder: 'false' })]);
    expect(leecher.seeder).toBe(false);
  });

  it('decodes the client from the peer id', () => {
    const [peer] = normalizePeers([makePeer({ peerId: '-TR3000-1234567890' })]);

    expect(peer.client).toMatchObject({ name: 'Transmission', version: '3.0.0' });
  });

  it('prefers the percent-encoded peerIdRaw when aria2 provides it', () => {
    const [peer] = normalizePeers([
      makePeer({ peerId: 'x', peerIdRaw: '%2DqB4550%2D1234567890' }),
    ]);

    expect(peer.client).toMatchObject({ name: 'qBittorrent', version: '4.5.5' });
  });

  it('leaves the client undefined for an undecodable peer id', () => {
    const [peer] = normalizePeers([makePeer({ peerId: 'aVeryLongUnknownPeerId0' })]);

    expect(peer.client).toBeUndefined();
  });

  it('preserves the input order', () => {
    const peers = normalizePeers([
      makePeer({ ip: '10.0.0.3' }),
      makePeer({ ip: '10.0.0.1' }),
      makePeer({ ip: '10.0.0.2' }),
    ]);

    expect(peers.map((peer) => peer.ip)).toEqual(['10.0.0.3', '10.0.0.1', '10.0.0.2']);
  });
});

describe('normalizePeers — progress', () => {
  it('computes completePercent from the peer bitfield', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: 'a' })], {
      taskNumPieces: 4,
      taskCompletedPieces: 1,
      taskCompletePercent: 0.25,
    });

    // 1010b => pieces 0 and 2 done.
    expect(peer.completePercent).toBe(0.5);
  });

  it('reports 0 percent when the task has no pieces', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: 'ffff' })]);

    expect(peer.completePercent).toBe(0);
  });

  it('overrides the percent of peers with the same completed-piece count', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: 'f' })], {
      taskNumPieces: 4,
      taskCompletedPieces: 4,
      // AriaNg quirk: equal progress renders with the task's own percent.
      taskCompletePercent: 0.42,
    });

    expect(peer.completePercent).toBe(0.42);
  });

  it('keeps the bitfield percent when the completed counts differ', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: '8' })], {
      taskNumPieces: 4,
      taskCompletedPieces: 3,
      taskCompletePercent: 0.75,
    });

    expect(peer.completePercent).toBe(0.25);
  });
});

describe('normalizePeers — piece map', () => {
  it('run-length encodes the peer bitfield', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: 'a0' })], {
      taskNumPieces: 8,
    });

    // 10100000b
    expect(peer.pieces).toEqual([
      { isCompleted: true, count: 1 },
      { isCompleted: false, count: 1 },
      { isCompleted: true, count: 1 },
      { isCompleted: false, count: 5 },
    ]);
  });

  it('clamps a padded bitfield to the task piece count', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: 'ffff' })], {
      taskNumPieces: 6,
    });

    expect(peer.pieces).toEqual([{ isCompleted: true, count: 6 }]);
  });

  it('treats a missing bitfield as all-missing', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: '' })], {
      taskNumPieces: 8,
    });

    expect(peer.pieces).toEqual([{ isCompleted: false, count: 8 }]);
  });

  it('has no piece map when the task piece count is unknown', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: 'ffff' })]);

    expect(peer.pieces).toEqual([]);
  });
});

describe('getCombinedPeerPieces', () => {
  it('returns an empty map when the peer has no pieces', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: '' })]);

    expect(getCombinedPeerPieces(peer, 8)).toEqual([]);
  });

  it('trims the peer map to numPieces and merges the runs', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: 'f' })], {
      taskNumPieces: 4,
    });

    expect(peer.pieces).toEqual([{ isCompleted: true, count: 4 }]);
    expect(getCombinedPeerPieces(peer, 3)).toEqual([{ isCompleted: true, count: 3 }]);
  });

  it('keeps the peer map as-is when numPieces is unknown', () => {
    const [peer] = normalizePeers([makePeer({ bitfield: '5' })], {
      taskNumPieces: 4,
    });

    expect(peer.pieces).toEqual([
      { isCompleted: false, count: 1 },
      { isCompleted: true, count: 1 },
      { isCompleted: false, count: 1 },
      { isCompleted: true, count: 1 },
    ]);
    expect(getCombinedPeerPieces(peer, 0)).toEqual(peer.pieces);
    expect(getCombinedPeerPieces(peer, 3)).toEqual([
      { isCompleted: false, count: 1 },
      { isCompleted: true, count: 1 },
      { isCompleted: false, count: 1 },
    ]);
  });
});

describe('normalizePeers — local pseudo-peer', () => {
  const task = {
    taskBitfield: 'f0',
    taskNumPieces: 8,
    taskCompletedPieces: 4,
    taskCompletePercent: 0.5,
    taskDownloadSpeed: 1234,
    taskUploadSpeed: 56,
    taskSeeder: true,
  };

  it('adds exactly one synthetic entry, flagged isLocal', () => {
    const peers = normalizePeers([makePeer()], { ...task, includeLocalPeer: true });

    expect(peers).toHaveLength(2);
    expect(peers.filter((peer) => peer.isLocal)).toHaveLength(1);

    const local = peers[peers.length - 1];
    expect(local.peerId).toBe('local');
    expect(local.name).toBe(LOCAL_PEER_NAME);
    expect(local.ip).toBe('');
    expect(Number(local.port)).toBe(0);
    expect(local.isLocal).toBe(true);
    expect(local.downloadSpeed).toBe(1234);
    expect(local.uploadSpeed).toBe(56);
    expect(local.completePercent).toBe(0.5);
    expect(local.seeder).toBe(true);
    expect(local.amChoking).toBe(false);
    expect(local.peerChoking).toBe(false);
    expect(local.pieces).toEqual([
      { isCompleted: true, count: 4 },
      { isCompleted: false, count: 4 },
    ]);
  });

  it('defaults the task speeds / seeder flag when they are not given', () => {
    const peers = normalizePeers([], { taskNumPieces: 4, includeLocalPeer: true });
    const local = peers[0];

    expect(local.downloadSpeed).toBe(0);
    expect(local.uploadSpeed).toBe(0);
    expect(local.seeder).toBe(false);
    expect(local.completePercent).toBe(0);
  });
});

describe('normalizePeers — empty input', () => {
  it('returns an empty array', () => {
    expect(normalizePeers([])).toEqual([]);
  });

  it('returns only the local peer when asked for it', () => {
    const peers = normalizePeers([], { includeLocalPeer: true });

    expect(peers).toHaveLength(1);
    expect(peers[0].name).toBe(LOCAL_PEER_NAME);
    expect(peers[0].isLocal).toBe(true);
  });
});