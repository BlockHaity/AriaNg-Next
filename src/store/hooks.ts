/**
 * Narrow selector hooks.
 *
 * Every hook subscribes to the smallest possible slice of a store so a
 * component only re-renders when the value it actually renders changes. The
 * profile helpers return stable references because the profile mirror is only
 * rebuilt when a relevant setting really changed.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { AriaNgSettings, RpcProfile } from '@/config/types';
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

export function useIsWebSocket(): boolean {
  return useProfilesStore((state) => {
    const profile = state.activeProfile();
    return profile.protocol === 'ws' || profile.protocol === 'wss';
  });
}

/** true when neither localStorage nor cookies work — render AriaNg's fatal overlay. */
export function useIsStorageBroken(): boolean {
  return useSettingsStore((state) => state.storageBroken);
}

function subscribeStorageSnapshot(onChange: () => void): () => void {
  return subscribeStorage(onChange);
}

function getStorageSnapshot(): boolean {
  return storageIsAvailable();
}

/**
 * true when settings will actually survive a reload. Flips to false when the
 * storage layer degrades to the in-memory fallback (private browsing, blocked
 * cookies) so the shell can warn the user.
 */
export function useStorageAvailable(): boolean {
  const getSnapshot = useCallback(getStorageSnapshot, []);
  return useSyncExternalStore(subscribeStorageSnapshot, getSnapshot, () => true);
}

/** true when writes currently land in the in-memory fallback. */
export function useStorageEphemeral(): boolean {
  return useSyncExternalStore(subscribeStorageSnapshot, storageIsEphemeral, () => false);
}
