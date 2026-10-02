/**
 * RPC profile management — a 1:1 port of the profile half of
 * `ariaNgSettingService`.
 *
 * There is exactly one source of truth: the settings store. `profiles` is a
 * *derived mirror* kept in sync through zustand's `subscribe`, so no state is
 * ever duplicated by hand and `syncFromSettings()` is only needed when the
 * shell wants an explicit refresh (e.g. right after `hydrate()`).
 *
 * Layout rules:
 * - `profiles[0]` is always the default profile. It is built from the
 *   top-level `rpcAlias` / `rpcHost` / `rpcPort` / `rpcInterface` /
 *   `protocol` / `httpMethod` / `rpcRequestHeaders` / `secret` settings and
 *   carries `isDefault: true`; it has no `rpcId`.
 * - Every other entry comes from `settings.extendRpcServers` and keeps its
 *   `rpcId`.
 * - Secrets are plain text in this store (runtime) and base64 in storage; the
 *   settings store does the encoding, so write paths simply pass the value.
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { AriaNgSettings, RpcProfile, RpcProtocol } from '@/config/types';
import {
  cloneRpcProfile,
  createNewRpcProfile,
  generateRpcId,
  isWebSocketProfile,
  naturalCompare,
  rpcProfileDisplayName,
  rpcProfilesEqual,
  rpcProfileUrl,
} from '@/config/defaults';
import { DEFAULT_RPC_DISPLAY_NAME, normalizeRpcPort, useSettingsStore } from './settings';

// Re-exported for convenience: profile helpers are always used together.
// Re-exported for convenience: profile helpers are always used together, and
// consumers of the store barrel should not have to reach into `@/config`.
export {
  isWebSocketProfile,
  naturalCompare,
  rpcProfileDisplayName,
  rpcProfilesEqual,
  rpcProfileUrl,
};

/** Settings key -> profile field, for the default profile (top-level slot). */
const TOP_LEVEL_FIELDS = [
  'rpcAlias',
  'rpcHost',
  'rpcPort',
  'rpcInterface',
  'protocol',
  'httpMethod',
  'rpcRequestHeaders',
  'secret',
] as const satisfies readonly (keyof RpcProfile)[];

function pageIsHttps(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return window.location.protocol === 'https:';
}

function settingsState() {
  return useSettingsStore.getState();
}

function topLevelProfile(): RpcProfile {
  const { settings } = settingsState();
  return {
    isDefault: true,
    rpcAlias: settings.rpcAlias,
    rpcHost: settings.rpcHost,
    rpcPort: settings.rpcPort,
    rpcInterface: settings.rpcInterface,
    protocol: settings.protocol,
    httpMethod: settings.httpMethod,
    rpcRequestHeaders: settings.rpcRequestHeaders,
    // Already decoded by the settings store.
    secret: settings.secret,
  };
}

function extendedProfiles(): RpcProfile[] {
  const { settings } = settingsState();
  const list = Array.isArray(settings.extendRpcServers) ? settings.extendRpcServers : [];
  return list.map((entry) => ({ ...cloneRpcProfile(entry), isDefault: false }));
}

function buildProfiles(): RpcProfile[] {
  return [topLevelProfile(), ...extendedProfiles()];
}

function findIndex(profiles: RpcProfile[], profile: RpcProfile): number {
  if (profile.rpcId) {
    const byId = profiles.findIndex((entry) => entry.rpcId === profile.rpcId);
    if (byId >= 0) return byId;
  }
  return profiles.findIndex((entry) => rpcProfilesEqual(entry, profile));
}

/**
 * Reuses the previous object for every entry that did not actually change, so
 * selectors like `useRpcProfile()` do not hand a fresh reference to the rest
 * of the app on every unrelated settings write.
 */
function reuseUnchanged(previous: RpcProfile[], next: RpcProfile[]): RpcProfile[] {
  return next.map((profile, index) => {
    const before = previous[index];
    if (
      before &&
      before.isDefault === profile.isDefault &&
      before.rpcId === profile.rpcId &&
      rpcProfilesEqual(before, profile)
    ) {
      return before;
    }
    return profile;
  });
}

export interface ProfilesState {
  /** Index 0 is always the default profile. */
  profiles: RpcProfile[];
  activeProfileIndex: number;

  activeProfile(): RpcProfile;
  displayName(profile: RpcProfile): string;
  add(): RpcProfile;
  update(profile: RpcProfile, patch: Partial<RpcProfile>): void;
  remove(profile: RpcProfile): void;
  /** Make `profile` the default; optionally demote the old default into the list. */
  setDefault(profile: RpcProfile, options?: { keepPreviousAsEntry?: boolean; forceSet?: boolean }): void;
  isEqualToDefault(profile: RpcProfile): boolean;
  ordered(): RpcProfile[];
  /** http/https/ws are unusable when the page itself is served over https. */
  isProtocolDisabled(protocol: RpcProtocol): boolean;

  /* --- extras (not part of the original service) --- */
  /** Select the active profile; always stays within range. */
  setActiveProfileIndex(index: number): void;
  /** Pull the mirror from the settings store (subscription already does this). */
  syncFromSettings(): void;
}

function toTopLevelPatch(profile: RpcProfile): Partial<AriaNgSettings> {
  const patch: Record<string, unknown> = {};
  for (const field of TOP_LEVEL_FIELDS) patch[field] = profile[field];
  // AriaNg always coerced the port on write.
  patch.rpcPort = normalizeRpcPort(profile.rpcPort);
  return patch as Partial<AriaNgSettings>;
}

export const useProfilesStore: UseBoundStore<StoreApi<ProfilesState>> =
  create<ProfilesState>()((commit, get) => {
    /** Rebuild the mirror, keeping the active selection and referential
     * stability of unchanged entries (so selectors do not re-render). */
    function sync(force = false): void {
      const prev = get().profiles;
      const next = reuseUnchanged(prev, buildProfiles());
      const unchanged =
        next.length === prev.length && next.every((profile, index) => profile === prev[index]);
      if (!force && unchanged) return;

      const previousActive = prev[get().activeProfileIndex];
      let index = 0;
      if (previousActive) {
        if (previousActive.isDefault) {
          index = 0;
        } else {
          const byId = previousActive.rpcId
            ? next.findIndex((entry) => entry.rpcId === previousActive.rpcId && !entry.isDefault)
            : -1;
          index = byId >= 0 ? byId : 0;
        }
      }
      commit({ profiles: next, activeProfileIndex: Math.min(index, next.length - 1) });
    }

    return {
      profiles: buildProfiles(),
      activeProfileIndex: 0,

      activeProfile() {
        const { profiles, activeProfileIndex } = get();
        return profiles[activeProfileIndex] ?? profiles[0] ?? topLevelProfile();
      },

      displayName(profile) {
        // `rpcProfileDisplayName` falls back to `host:port`, which is
        // meaningless for a brand new (blank) profile — show the generic label
        // there instead, exactly like AriaNg's unnamed default server.
        if (!profile.rpcAlias && !profile.rpcHost) return DEFAULT_RPC_DISPLAY_NAME;
        return rpcProfileDisplayName(profile);
      },

      add() {
        const created = createNewRpcProfile();
        const profile: RpcProfile = {
          ...cloneRpcProfile(created),
          rpcId: created.rpcId || generateRpcId(),
          isDefault: false,
        };
        const list = [...(settingsState().get('extendRpcServers') ?? []), profile];
        settingsState().update({ extendRpcServers: list });
        sync();
        return profile;
      },

      update(profile, patch) {
        const store = settingsState();
        if (profile.isDefault) {
          // The default profile *is* the top-level settings slot.
          store.update(toTopLevelPatch({ ...profile, ...patch }));
          sync();
          return;
        }
        const list = [...(store.get('extendRpcServers') ?? [])];
        const index = findIndex(list, profile);
        if (index < 0) return;
        const merged: RpcProfile = { ...list[index], ...patch, isDefault: false };
        merged.rpcPort = normalizeRpcPort(merged.rpcPort);
        list[index] = merged;
        store.update({ extendRpcServers: list });
        sync();
      },

      remove(profile) {
        // The default profile is not a list entry — it cannot be removed.
        if (profile.isDefault) return;
        const store = settingsState();
        const list = [...(store.get('extendRpcServers') ?? [])];
        const index = findIndex(list, profile);
        if (index < 0) return;
        list.splice(index, 1);
        store.update({ extendRpcServers: list });
        sync();
      },

      setDefault(profile, options) {
        const { keepPreviousAsEntry = false, forceSet = false } = options ?? {};
        const store = settingsState();
        const previousDefault = topLevelProfile();
        const list = [...(store.get('extendRpcServers') ?? [])];

        const index = findIndex(list, profile);
        // `forceSet` trusts the caller's copy (e.g. an unsaved form) instead of
        // the stored entry.
        const promoted: RpcProfile = forceSet || index < 0
          ? { ...cloneRpcProfile(profile), isDefault: true, rpcId: undefined }
          : { ...cloneRpcProfile(list[index] as RpcProfile), isDefault: true, rpcId: undefined };
        if (index >= 0) list.splice(index, 1);

        if (keepPreviousAsEntry) {
          const template = createNewRpcProfile();
          list.unshift({
            ...template,
            rpcId: template.rpcId || generateRpcId(),
            isDefault: false,
            rpcAlias: previousDefault.rpcAlias,
            rpcHost: previousDefault.rpcHost,
            rpcPort: previousDefault.rpcPort,
            rpcInterface: previousDefault.rpcInterface,
            protocol: previousDefault.protocol,
            httpMethod: previousDefault.httpMethod,
            rpcRequestHeaders: previousDefault.rpcRequestHeaders,
            secret: previousDefault.secret,
          });
        }

        // The settings store base64-encodes `secret` on write, which is the
        // "re-encode" step of `forceSet`.
        store.update({ ...toTopLevelPatch(promoted), extendRpcServers: list });
        commit({ activeProfileIndex: 0 });
        sync(true);
      },

      isEqualToDefault(profile) {
        return rpcProfilesEqual(profile, topLevelProfile());
      },

      ordered() {
        const { profiles } = get();
        if (settingsState().get('rpcListDisplayOrder') !== 'rpcAlias') {
          // 'recentlyUsed': default first, then stored order.
          return [...profiles];
        }
        return [...profiles].sort((a, b) => naturalCompare(a.rpcAlias, b.rpcAlias));
      },

      isProtocolDisabled(protocol) {
        // An https page cannot talk to an insecure endpoint (mixed content).
        if (!pageIsHttps()) return false;
        return protocol === 'http' || protocol === 'ws';
      },

      setActiveProfileIndex(index) {
        const { profiles } = get();
        if (profiles.length === 0) return;
        const next = Math.min(Math.max(Math.trunc(index) || 0, 0), profiles.length - 1);
        if (next === get().activeProfileIndex) return;
        commit({ activeProfileIndex: next });
      },

      syncFromSettings() {
        sync();
      },
    };
  });

// Single source of truth: any settings write refreshes the mirror.
useSettingsStore.subscribe((state, prev) => {
  if (state.settings === prev.settings) return;
  useProfilesStore.getState().syncFromSettings();
});
