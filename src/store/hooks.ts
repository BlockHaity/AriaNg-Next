/**
 * Narrow selector hooks.
 *
 * Every hook subscribes to the smallest possible slice of a store so a
 * component only re-renders when the value it actually renders changes. The
 * profile helpers return stable references because the profile mirror is only
 * rebuilt when a relevant setting really changed.
 */
import { useSyncExternalStore } from 'react';
import type { AriaNgSettings, RpcProfile, RpcProtocol } from '@/config/types';
import { isWebSocketProfile } from '@/config/defaults';
import { useProfilesStore } from './profiles';
import { useSettingsStore } from './settings';
import { storageIsAvailable, storageIsEphemeral, subscribeStorage } from './storage';

/** Reads a single settings key. */
export function useTranslateSetting<K extends keyof AriaNgSettings>(key: K): AriaNgSettings[K] {
  return useSettingsStore((state) => state.settings[key]);
}

/** The currently selected RPC profile (stable object reference). */
export function useRpcProfile(): RpcProfile {
  return useProfilesStore((state) => state.activeProfile());
}

/** Display label of the active profile (alias, else host, else `Default`). */
export function useRpcDisplayName(): string {
  return useProfilesStore((state) => state.displayName(state.activeProfile()));
}

/** Reads the protocol of the active profile — a primitive, so it never churns. */
export function useRpcProtocol(): RpcProtocol {
  return useProfilesStore((state) => state.activeProfile().protocol);
}

export function useIsWebSocket(): boolean {
  return useProfilesStore((state) => isWebSocketProfile(state.activeProfile()));
}

/** true when neither localStorage nor cookies work — render AriaNg's fatal overlay. */
export function useIsStorageBroken(): boolean {
  return useSettingsStore((state) => state.storageBroken);
}

/** Module level so the identity stays stable (no resubscribe per render). */
function subscribeStorageSnapshot(onChange: () => void): () => void {
  return subscribeStorage(onChange);
}

/**
 * true when settings will actually survive a reload. Flips to false when the
 * storage layer degrades to the in-memory fallback (private browsing, blocked
 * cookies) so the shell can warn the user.
 *
 * `subscribe` must be stable, `getSnapshot` only has to be cheap and return a
 * primitive — probing storage on every call is what makes this correct when the
 * environment degrades mid-session.
 */
export function useStorageAvailable(): boolean {
  return useSyncExternalStore(subscribeStorageSnapshot, storageIsAvailable, () => true);
}

/** true when writes currently land in the in-memory fallback. */
export function useStorageEphemeral(): boolean {
  return useSyncExternalStore(subscribeStorageSnapshot, storageIsEphemeral, () => false);
}
