/**
 * Tab visibility for `/task/detail/:gid`.
 *
 * Port of AriaNg's `tabStatusItems` + `setTabItemShow()` /
 * `getVisibleTabOrders()` (`src/scripts/controllers/task-detail.js` lines 5-46)
 * and of `isShowPiecesInfo()` (lines 56-72).
 *
 * The original kept a mutable array of `{name, show}` in the controller and
 * flipped individual flags on every poll. Everything here is a **pure function
 * of the current task state**, which is the same rule expressed without the
 * bookkeeping — and it makes every boundary directly unit-testable.
 *
 * AriaNg's rules, 1:1:
 *
 * | tab       | visible when                                            |
 * |-----------|---------------------------------------------------------|
 * | Overview  | always                                                  |
 * | Pieces    | `isPiecesInfoVisible(numPieces, piecesSetting)`          |
 * | Files     | always                                                  |
 * | Peers     | `status === 'active' && isBittorrent`                    |
 * | Options   | `status ∈ {active, waiting, paused}`                    |
 * | (Media)   | aria2-next: the task carries a `media` view              |
 *
 * The order of the returned array is the tab strip order and is the order the
 * swipe gestures walk (left = next, right = previous).
 */

import { isPiecesInfoVisible } from '@/domain/pieces';
import type { PiecesInfoSetting } from '@/config/types';

/** Every tab the detail page can show. */
export type DetailTabValue = 'overview' | 'pieces' | 'files' | 'peers' | 'options' | 'media';

export interface DetailTab {
  value: DetailTabValue;
  /** i18n key for the label; the options tab is rendered icon-only. */
  labelKey: string;
  /** mdui icon name; only the options tab carries one (AriaNg's ⚙). */
  icon?: string;
}

export interface VisibleTabsInput {
  status: string;
  isBittorrent: boolean;
  numPieces: number;
  piecesSetting: PiecesInfoSetting;
  /** aria2-next: `task.media` is present. */
  hasMedia: boolean;
}

/** Declaration order = tab strip order. Never reorder without re-reading the spec. */
const DETAIL_TABS: readonly DetailTab[] = [
  { value: 'overview', labelKey: 'Overview' },
  { value: 'pieces', labelKey: 'Pieces' },
  { value: 'files', labelKey: 'Files' },
  { value: 'peers', labelKey: 'Peers' },
  { value: 'options', labelKey: 'Options', icon: 'settings' },
  // Media has no icon: AriaNg had no media tab, so there is no reference to
  // copy, and every other label-only tab stays label-only.
  { value: 'media', labelKey: 'Media' },
];

/** Statuses whose per-task options aria2 still accepts. */
const OPTION_STATUSES: ReadonlySet<string> = new Set(['active', 'waiting', 'paused']);

export const DEFAULT_DETAIL_TAB: DetailTabValue = 'overview';

/** The query parameter that makes a tab deep-linkable: `?tab=files`. */
export const TAB_QUERY_PARAM = 'tab';

function isVisible(tab: DetailTabValue, input: VisibleTabsInput): boolean {
  switch (tab) {
    case 'overview':
    case 'files':
      return true;

    case 'pieces':
      return isPiecesInfoVisible(input.numPieces, input.piecesSetting);

    case 'peers':
      return input.status === 'active' && input.isBittorrent;

    case 'options':
      return OPTION_STATUSES.has(input.status);

    case 'media':
      return input.hasMedia;

    default:
      return false;
  }
}

/**
 * The tabs to render, in order.
 *
 * Never returns an empty array: Overview and Files are unconditional, so a task
 * that cannot be fetched at all still shows a usable tab strip.
 */
export function getVisibleTabs(input: VisibleTabsInput): DetailTab[] {
  return DETAIL_TABS.filter((tab) => isVisible(tab.value, input));
}

/** The values of {@link getVisibleTabs}, in order. */
export function getVisibleTabValues(input: VisibleTabsInput): DetailTabValue[] {
  return getVisibleTabs(input).map((tab) => tab.value);
}

/**
 * Clamp a requested tab to something the current task actually has.
 *
 * `requested` comes straight from the URL, so it can be anything — a stale
 * deep link, a typo, or a tab that disappeared because the task finished.
 */
export function resolveTab(
  requested: string | null | undefined,
  input: VisibleTabsInput,
): DetailTabValue {
  const visible = getVisibleTabValues(input);

  if (requested && visible.includes(requested as DetailTabValue)) {
    return requested as DetailTabValue;
  }

  return visible[0] ?? DEFAULT_DETAIL_TAB;
}

/** Index of `tab` inside the visible order, or `-1`. */
export function tabIndexOf(tab: DetailTabValue, input: VisibleTabsInput): number {
  return getVisibleTabValues(input).indexOf(tab);
}

/**
 * Swipe target: the next / previous tab, or `null` at the edge.
 *
 * Mirrors `$rootScope.swipeActions.extendLeftSwipe` / `extendRightSwipe`
 * (task-detail.js:277-301), which returned `false` at the boundary so the
 * shell could fall back to its own gesture (the navigation drawer).
 */
export function adjacentTab(
  tab: DetailTabValue,
  direction: -1 | 1,
  input: VisibleTabsInput,
): DetailTabValue | null {
  const visible = getVisibleTabValues(input);
  const index = visible.indexOf(tab);
  if (index < 0) return null;

  return visible[index + direction] ?? null;
}