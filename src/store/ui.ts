/**
 * Cross-page UI state that outlives a single route but is not a setting.
 *
 * AriaNg kept this in the root scope of `index.html` plus a `$scope` reset on
 * every `$locationChangeSuccess`: the drawer, the rail, the search box text and
 * the page's keyboard/swipe handlers. Anything that has to survive a route
 * change (drawer open, search text) and anything that must **not** (which page
 * currently owns `Ctrl+A`, the swipe handlers) lives here.
 *
 * The per-page registrations are functions, not booleans, because the mounted
 * page owns the behaviour: the task list registers `selectAll` / `delete`, the
 * task detail page registers the tab swipe handlers. {@link UiState.resetForRoute}
 * drops them so a stale closure from an unmounted page can never fire.
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

/** Which mounted page currently owns a global shortcut. */
export type KeyActionName = 'selectAll' | 'delete';

/** Which mounted page currently owns a swipe direction. */
export type SwipeSide = 'left' | 'right';

export interface KeyActions {
  selectAll?: () => void;
  delete?: () => void;
}

export interface SwipeActions {
  /**
   * Extend a swipe the page already consumed. Returns `true` when it handled
   * the gesture, so the global handler knows to leave it alone.
   */
  extendLeftSwipe?: () => boolean;
  extendRightSwipe?: () => boolean;
}

export interface UiState {
  /** Navigation drawer (mdui `mdui-drawer` / AriaNg's `md-sidenav`). */
  drawerOpen: boolean;
  /** Expanded navigation rail on wide layouts. */
  railExtended: boolean;
  /** Shared search box text — survives a route change, unlike the handlers. */
  searchText: string;

  keyActions: KeyActions;
  swipeActions: SwipeActions;

  /**
   * true once a snackbar host has mounted. The notification service keeps
   * queuing in-page notices either way; this only tells the shell whether it
   * can render the queue yet.
   */
  snackbarHost: boolean;

  toggleDrawer(): void;
  setDrawer(open: boolean): void;
  setSearchText(text: string): void;
  setRailExtended(extended: boolean): void;
  setSnackbarHost(present: boolean): void;

  /** Clears per-page registrations — call on every route change. */
  resetForRoute(): void;

  /** Returns the unregister function. */
  registerKeyAction(name: KeyActionName, fn: () => void): () => void;
  /** Returns the unregister function. */
  registerSwipeAction(side: SwipeSide, fn: () => boolean): () => void;
}

const EMPTY_KEY_ACTIONS: KeyActions = {};
const EMPTY_SWIPE_ACTIONS: SwipeActions = {};

export const useUiStore: UseBoundStore<StoreApi<UiState>> = create<UiState>()((commit, get) => ({
  drawerOpen: false,
  railExtended: false,
  searchText: '',
  keyActions: EMPTY_KEY_ACTIONS,
  swipeActions: EMPTY_SWIPE_ACTIONS,
  snackbarHost: false,

  toggleDrawer() {
    commit({ drawerOpen: !get().drawerOpen });
  },

  setDrawer(open) {
    if (get().drawerOpen === open) return;
    commit({ drawerOpen: open });
  },

  setSearchText(text) {
    if (get().searchText === text) return;
    commit({ searchText: text });
  },

  setRailExtended(extended) {
    if (get().railExtended === extended) return;
    commit({ railExtended: extended });
  },

  setSnackbarHost(present) {
    if (get().snackbarHost === present) return;
    commit({ snackbarHost: present });
  },

  resetForRoute() {
    // The shared state (drawer / rail / search text) is intentionally kept:
    // AriaNg only reset what belonged to the page that was being left.
    commit({ keyActions: EMPTY_KEY_ACTIONS, swipeActions: EMPTY_SWIPE_ACTIONS });
  },

  registerKeyAction(name, fn) {
    commit({ keyActions: { ...get().keyActions, [name]: fn } });

    return () => {
      const current = get().keyActions;
      // Only clear when it is still *our* function: a page that re-registers
      // on a fast remount must not have its handler removed by the older
      // cleanup.
      if (current[name] !== fn) return;
      const next: KeyActions = { ...current };
      delete next[name];
      commit({ keyActions: next });
    };
  },

  registerSwipeAction(side, fn) {
    const key = side === 'left' ? 'extendLeftSwipe' : 'extendRightSwipe';
    commit({ swipeActions: { ...get().swipeActions, [key]: fn } });

    return () => {
      const current = get().swipeActions;
      if (current[key] !== fn) return;
      const next: SwipeActions = { ...current };
      delete next[key];
      commit({ swipeActions: next });
    };
  },
}));

/** Resets the whole store — used between tests. */
export function resetUiStore(): void {
  useUiStore.setState({
    drawerOpen: false,
    railExtended: false,
    searchText: '',
    keyActions: EMPTY_KEY_ACTIONS,
    swipeActions: EMPTY_SWIPE_ACTIONS,
    snackbarHost: false,
  });
}
