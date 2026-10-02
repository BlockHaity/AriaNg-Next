/**
 * Pure drag-logic tests — no DOM, no stores, no @dnd-kit.
 *
 * These are the three functions that carry AriaNg's `dragula` semantics
 * (`isSupportDragTask`) and fix the one thing AriaNg got wrong (mapping a drop in
 * a filtered list onto a server queue index), so they are worth pinning exactly.
 */

import { describe, expect, it } from 'vitest';

import { dropIndexFromVisibleOrder, isDragSupported, parseOrderType, reorderGids } from '../task-list/dnd';

describe('parseOrderType', () => {
  it('splits type and direction', () => {
    expect(parseOrderType('name:asc')).toEqual({ type: 'name', descending: false });
    expect(parseOrderType('percent:desc')).toEqual({ type: 'percent', descending: true });
  });

  it('defaults to asc and to the `default` type', () => {
    expect(parseOrderType('size')).toEqual({ type: 'size', descending: false });
    expect(parseOrderType('')).toEqual({ type: 'default', descending: false });
    expect(parseOrderType('nonsense:desc')).toEqual({ type: 'default', descending: true });
  });
});

describe('isDragSupported', () => {
  it('is enabled only for /waiting with the `default` order and the setting on', () => {
    expect(isDragSupported({ enabledBySetting: true, page: 'waiting', orderType: 'default:asc' })).toBe(true);
    // The direction is irrelevant; only the *type* matters.
    expect(isDragSupported({ enabledBySetting: true, page: 'waiting', orderType: 'default:desc' })).toBe(true);
  });

  it('is disabled when the setting is off, whatever else is true', () => {
    expect(isDragSupported({ enabledBySetting: false, page: 'waiting', orderType: 'default:asc' })).toBe(false);
  });

  it('is disabled on every page except /waiting', () => {
    expect(isDragSupported({ enabledBySetting: true, page: 'downloading', orderType: 'default:asc' })).toBe(false);
    expect(isDragSupported({ enabledBySetting: true, page: 'stopped', orderType: 'default:asc' })).toBe(false);
  });

  it('is disabled by any other display-order type', () => {
    for (const orderType of ['name:asc', 'size:asc', 'percent:desc', 'remain:asc', 'dspeed:desc', 'uspeed:desc']) {
      expect(isDragSupported({ enabledBySetting: true, page: 'waiting', orderType })).toBe(false);
    }
  });

  it('treats a malformed order as `default`', () => {
    expect(isDragSupported({ enabledBySetting: true, page: 'waiting', orderType: '' })).toBe(true);
    expect(isDragSupported({ enabledBySetting: true, page: 'waiting', orderType: 'wat:asc' })).toBe(true);
  });
});

describe('reorderGids', () => {
  it('moves a row onto the target slot', () => {
    expect(reorderGids(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(reorderGids(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderGids(['a', 'b', 'c'], 'b', 'c')).toEqual(['a', 'c', 'b']);
  });

  it('never mutates its input', () => {
    const input = ['a', 'b', 'c'];
    reorderGids(input, 'a', 'c');
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op for an unknown gid or a drop onto itself', () => {
    expect(reorderGids(['a', 'b'], 'x', 'b')).toEqual(['a', 'b']);
    expect(reorderGids(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
    expect(reorderGids(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
  });
});

describe('dropIndexFromVisibleOrder', () => {
  it('matches the visible index when nothing is filtered out', () => {
    const gids = ['a', 'b', 'c', 'd'];
    const visible = ['a', 'b', 'c', 'd'];

    // Dropping `b` on `d` must land after `d` in the queue, i.e. index 3.
    expect(dropIndexFromVisibleOrder({ gids, visibleGids: visible, activeGid: 'b', overIndex: 3 })).toBe(3);
    // Dropping `b` on `a` must land at the front.
    expect(dropIndexFromVisibleOrder({ gids, visibleGids: visible, activeGid: 'b', overIndex: 0 })).toBe(0);
    // Dropping `d` on `b` must land before `b`.
    expect(dropIndexFromVisibleOrder({ gids, visibleGids: visible, activeGid: 'd', overIndex: 1 })).toBe(1);
  });

  it('skips the hidden rows when mapping a drop back onto the server queue', () => {
    // `c` is hidden by the search filter, so the visible list is shorter than the
    // queue. Dropping `b` on `d` (visible index 2) must put `b` *after* `d` in
    // the queue — index 3 — not at the visible index 2, which is what AriaNg
    // sent and which would have landed `b` before `d`.
    expect(
      dropIndexFromVisibleOrder({
        gids: ['a', 'b', 'c', 'd'],
        visibleGids: ['a', 'b', 'd'],
        activeGid: 'b',
        overIndex: 2,
      }),
    ).toBe(3);

    // Symmetrically, dropping `d` on `b` must stay at index 1 even though `c`
    // sits between them on the server.
    expect(
      dropIndexFromVisibleOrder({
        gids: ['a', 'b', 'c', 'd'],
        visibleGids: ['a', 'b', 'd'],
        activeGid: 'd',
        overIndex: 1,
      }),
    ).toBe(1);
  });

  it('produces exactly the visible order reorderGids would produce', () => {
    const cases: Array<[string[], string[], string, number]> = [
      [['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 2],
      [['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 0],
      [['a', 'b', 'c', 'd'], ['a', 'd'], 'a', 1],
      [['x', 'a', 'y', 'b', 'z'], ['a', 'b'], 'b', 0],
      [['a', 'b', 'c', 'd'], ['b', 'c', 'd'], 'd', 0],
    ];

    for (const [gids, visible, active, overIndex] of cases) {
      const target = visible[overIndex] as string;
      const index = dropIndexFromVisibleOrder({ gids, visibleGids: visible, activeGid: active, overIndex });

      // Apply the change to a copy of the queue the way aria2 would.
      const queue = gids.filter((gid) => gid !== active);
      queue.splice(index, 0, active);

      // The queue, filtered back down to the visible rows, must equal what the UI
      // shows after the drop.
      expect(queue.filter((gid) => visible.includes(gid))).toEqual(reorderGids(visible, active, target));
    }
  });

  it('appends when the row was dropped past the last visible one', () => {
    expect(
      dropIndexFromVisibleOrder({ gids: ['a', 'b', 'c'], visibleGids: ['a', 'b'], activeGid: 'a', overIndex: 5 }),
    ).toBe(2);
  });

  it('clamps when the drop target is unknown to the server', () => {
    expect(
      dropIndexFromVisibleOrder({ gids: ['a', 'b'], visibleGids: ['a', 'ghost'], activeGid: 'a', overIndex: 1 }),
    ).toBe(1);
  });

  it('is 0 for a single-task queue', () => {
    expect(
      dropIndexFromVisibleOrder({ gids: ['only'], visibleGids: ['only'], activeGid: 'only', overIndex: 0 }),
    ).toBe(0);
  });
});