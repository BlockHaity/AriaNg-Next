/**
 * The RPC profile switcher in the app bar.
 *
 * AriaNg's profile list is a plain dropdown with a check mark on the active
 * server, and **choosing one reloaded the whole page** so every service could be
 * rebuilt against the new endpoint. Here the switch is **hot**: the transport is
 * swapped in place and the cached state is dropped, so the current page stays
 * where it is. That is the one deliberate deviation in this file, and it is
 * called out at the call site.
 *
 * The other AriaNg behaviour is preserved verbatim:
 *
 * - the chosen profile becomes the **default** profile (the top-level settings
 *   slot), and any previous default is demoted into the list — that is
 *   `setDefault(profile, { keepPreviousAsEntry: true })`;
 * - the order honours the `rpcListDisplayOrder` setting;
 * - on an `https` page the `http` / `ws` entries are shown **disabled**: the
 *   browser would block them as mixed content, so offering them would only
 *   produce a confusing failure.
 */
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { DEFAULT_ROUTE } from '../route-paths';
import { isWebSocketProfile } from '@/config/defaults';
import type { RpcProfile } from '@/config/types';
import { setNotificationsTransport } from '@/store/notifications';
import { useProfilesStore } from '@/store/profiles';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import { MduiButton, MduiDropdown, MduiMenu, MduiMenuItem, MduiTooltip } from '@/ui/mdui';

/**
 * TODO(i18n-agent): no locale key exists for these two strings; `t()` would echo
 * the key back at the user, so they are plain English until the i18n agent adds
 * them.
 */
const INSECURE_REASON = 'Blocked: the page itself is served over HTTPS';
const INSECURE_EXPLANATION =
  'This page is served over HTTPS, so the browser refuses the insecure http/ws endpoints (mixed content). Use https/wss, or open AriaNg over http.';

/**
 * Makes `profile` the default RPC profile and hot-switches to it.
 *
 * Shared with `#!/settings/rpc/set`, so the command line and the dropdown end
 * up in exactly the same state.
 *
 * Deliberate deviation from AriaNg: it did `location.reload()` here. Reloading
 * threw away the task list, the search text and every dialog for no benefit —
 * `applyProfile` rebuilds the transport and clears exactly the state that
 * belonged to the old server.
 */
export function activateRpcProfile(profile: RpcProfile): void {
  const settings = useSettingsStore.getState().settings;

  useProfilesStore.getState().setDefault(profile, { forceSet: true });

  const profiles = useProfilesStore.getState();
  const active = profiles.activeProfile();

  // The RPC store keeps its own mirror of the list so `applyProfile` can find
  // the index it is switching to.
  useRpcStore.getState().setProfiles(profiles.profiles, profiles.activeProfileIndex);

  // The notification service has to know whether push notifications can happen
  // at all: `aria2.onDownload*` only exists over a WebSocket.
  setNotificationsTransport(isWebSocketProfile(active) ? 'websocket' : 'http');

  useRpcStore.getState().applyProfile(active, settings.webSocketReconnectInterval);
}

export function RpcProfileSwitcher() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const profiles = useProfilesStore((state) => state.profiles);
  const activeProfile = useProfilesStore((state) => state.activeProfile());
  const isProtocolDisabled = useProfilesStore((state) => state.isProtocolDisabled);
  const listOrder = useSettingsStore((state) => state.settings.rpcListDisplayOrder);

  // `ordered()` builds a new array, so it has to be memoised — zustand v5
  // compares snapshots by identity and would loop on a fresh array.
  const ordered = useMemo(
    () => useProfilesStore.getState().ordered(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profiles, listOrder],
  );

  const hasDisabled = ordered.some((profile) => isProtocolDisabled(profile.protocol));

  const onSelect = (profile: RpcProfile): void => {
    if (isProtocolDisabled(profile.protocol)) {
      return;
    }
    activateRpcProfile(profile);

    // A task detail page is bound to one server's task; after a switch that gid
    // means nothing, so it goes back to the list. Every other page keeps its
    // route — AriaNg reloaded, which lost the page entirely.
    if (pathname.startsWith('/task/')) {
      navigate(DEFAULT_ROUTE);
    }
  };

  const displayName = useProfilesStore.getState().displayName;

  const items = [
    <MduiMenu key="menu" selects="single" value={activeProfile.rpcId ?? 'default'}>
      {ordered.map((profile) => {
        const isActive = profile.rpcId === activeProfile.rpcId || profile === activeProfile;
        const disabled = isProtocolDisabled(profile.protocol);
        return (
          <MduiMenuItem
            key={profile.rpcId ?? `default-${profile.rpcHost}:${profile.rpcPort}`}
            value={profile.rpcId ?? 'default'}
            icon={isActive ? 'check' : undefined}
            endText={disabled ? INSECURE_REASON : undefined}
            disabled={disabled}
            selected={isActive}
            onClick={() => {
              onSelect(profile);
            }}
          >
            {displayName(profile)}
          </MduiMenuItem>
        );
      })}
    </MduiMenu>,
  ];

  const button = (
    <MduiButton variant="text" endIcon="expand-more">
      {displayName(activeProfile)}
    </MduiButton>
  );

  // The explanation rides on the dropdown button rather than on each disabled
  // entry: a tooltip inside an open menu cannot be hovered, so a per-entry one
  // would never be readable.
  const trigger = hasDisabled ? (
    <MduiTooltip content={INSECURE_EXPLANATION} placement="bottom">
      {button}
    </MduiTooltip>
  ) : (
    button
  );

  return <MduiDropdown trigger={trigger} items={items} placement="bottom" />;
}