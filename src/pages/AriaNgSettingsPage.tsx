/**
 * `/settings/ariang` (and `/settings/ariang/:extendType`) — AriaNg's
 * `settings-ariang.html`, the application's own settings.
 *
 * The page owns the tab state and the notice strip; everything inside a tab
 * lives in `./settings-ariang/`:
 *
 * | file                         | responsibility                                    |
 * | ---------------------------- | ------------------------------------------------- |
 * | `groups.ts`                  | the 25 Global rows: order, visibility, options     |
 * | `GlobalSettingsTab.tsx`      | those rows, wired to the settings store            |
 * | `RpcProfileTab.tsx`          | the eight fields of one RPC profile                |
 * | `RpcProfileTabStrip.tsx`     | Global tab + one tab per profile + the `+` tab     |
 * | `Import/ExportSettingsDialog`| the two settings dialogs                          |
 *
 * `extendType === 'debug'` reveals the Debug Mode row, exactly like AriaNg: the
 * flag itself is session-only (`session.debugMode`), so the URL is the only way
 * to unlock it without already having it on.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RpcProfile } from '@/config/types';
import { useTranslate } from '@/i18n/react';
import { LANGUAGE_RELOAD_NOTICE_KEY } from './settings-ariang/groups';
import { useIsWebSocket } from '@/store/hooks';
import { isBrowserNotificationSupported, notifyInPage } from '@/store/notifications';
import { useProfilesStore } from '@/store/profiles';
import { useSettingsStore } from '@/store/settings';
import { useUiStore } from '@/store/ui';
import { confirmDialog, MduiTabPanel } from '@/ui/mdui';
import { GlobalSettingsTab } from './settings-ariang/GlobalSettingsTab';
import type { ReloadReason } from './settings-ariang/GlobalSettingsTab';
import { RpcProfileTab } from './settings-ariang/RpcProfileTab';
import {
  ADD_TAB,
  GLOBAL_TAB,
  rpcTabIndex,
  rpcTabValue,
  RpcProfileTabStrip,
} from './settings-ariang/RpcProfileTabStrip';

import './settings-ariang/styles.css';

/** `matchMedia` support probe — decides the `system` theme option. */
function prefersDarkSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function AriaNgSettingsPage() {
  const params = useParams<{ extendType?: string }>();
  const t = useTranslate();

  const settings = useSettingsStore((state) => state.settings);
  const session = useSettingsStore((state) => state.session);
  const profiles = useProfilesStore((state) => state.profiles);
  const addProfile = useProfilesStore((state) => state.add);
  const removeProfile = useProfilesStore((state) => state.remove);
  const displayName = useProfilesStore((state) => state.displayName);
  const activeIndex = useProfilesStore((state) => state.activeProfileIndex);
  const registerSwipeAction = useUiStore((state) => state.registerSwipeAction);
  const isWebSocket = useIsWebSocket();

  const [activeTab, setActiveTab] = useState<string>(GLOBAL_TAB);
  const [reloadPending, setReloadPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** `/debug` unlocks the row; the session flag keeps it visible afterwards. */
  const debugUnlocked = params.extendType === 'debug' || session.debugMode;

  const env = useMemo(
    () => ({
      isWebSocket,
      browserNotificationsSupported: isBrowserNotificationSupported(),
      prefersDarkSupported: prefersDarkSupported(),
      debugMode: debugUnlocked,
    }),
    [debugUnlocked, isWebSocket],
  );

  const markNeedsReload = useCallback(
    (reason: ReloadReason) => {
      setReloadPending(true);
      if (reason === 'language') {
        // The bundle is applied immediately; the components were built against
        // the previous table, which is what AriaNg's notice was about.
        setNotice(t(LANGUAGE_RELOAD_NOTICE_KEY));
      }
    },
    [t],
  );

  /* ---- add / remove ---------------------------------------------------- */

  const addNewRpcProfile = useCallback(() => {
    const created = addProfile();
    // AriaNg switched to the new tab *and* asked for a reload. Profiles
    // hot-apply here, so the notice is informational: it says what happened
    // rather than demanding a refresh.
    setActiveTab(rpcTabValue(profiles.length));
    const name = displayName(created);
    setNotice(`${t('Add New RPC Setting')}: ${name}`);
    notifyInPage({ title: t('Add New RPC Setting'), content: name, type: 'info' });
  }, [addProfile, displayName, profiles.length, t]);

  const confirmRemoveProfile = useCallback(
    async (profile: RpcProfile) => {
      const name = profile.rpcAlias ? profile.rpcAlias : `${profile.rpcHost}:${profile.rpcPort}`;
      const confirmed = await confirmDialog({
        heading: t('Confirm Remove'),
        text: t('Are you sure you want to remove rpc setting "{rpcName}"?', { rpcName: name }),
        okText: t('Confirm'),
        cancelText: t('Cancel'),
        icon: 'warning',
        danger: true,
      });
      if (!confirmed) return;

      removeProfile(profile);
      // Keep a valid tab selected after the list shrank.
      setActiveTab((current) => {
        const index = rpcTabIndex(current);
        if (index < 0) return current;
        return index <= 0 ? GLOBAL_TAB : rpcTabValue(index - 1);
      });
    },
    [removeProfile, t],
  );

  const selectTab = useCallback(
    (value: string) => {
      if (value === ADD_TAB) {
        addNewRpcProfile();
        return;
      }
      setActiveTab(value);
    },
    [addNewRpcProfile],
  );

  /* ---- swipe ----------------------------------------------------------- */

  // AriaNg: swiping left moves to the next RPC tab, right to the previous one —
  // and a right-swipe on the first RPC tab lands back on Global.
  useEffect(() => {
    const unregisterLeft = registerSwipeAction('left', () => {
      const index = rpcTabIndex(activeTab);
      if (index < 0 || index >= profiles.length - 1) return false;
      setActiveTab(rpcTabValue(index + 1));
      return true;
    });
    const unregisterRight = registerSwipeAction('right', () => {
      const index = rpcTabIndex(activeTab);
      if (index < 0) return false;
      if (index === 0) {
        setActiveTab(GLOBAL_TAB);
        return true;
      }
      setActiveTab(rpcTabValue(index - 1));
      return true;
    });

    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [activeTab, profiles.length, registerSwipeAction]);

  /* ---- render ---------------------------------------------------------- */

  const defaultProfile = profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;

  return (
    <div className="settings-ariang">
      <h1 className="ariang-visually-hidden">{t('AriaNg Settings')}</h1>

      {notice ? (
        <div className="settings-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="settings-notice__dismiss"
            aria-label={t('Close')}
            onClick={() => setNotice(null)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      <RpcProfileTabStrip
        profiles={profiles}
        activeTab={activeTab}
        onSelectTab={selectTab}
        onRemoveProfile={(profile) => void confirmRemoveProfile(profile)}
      >
        <MduiTabPanel value={GLOBAL_TAB}>
          <GlobalSettingsTab
            settings={settings}
            session={session}
            env={env}
            previewProfile={defaultProfile}
            reloadPending={reloadPending}
            onNeedsReload={markNeedsReload}
          />
        </MduiTabPanel>

        {profiles.map((profile, index) => (
          <MduiTabPanel key={profile.rpcId ?? rpcTabValue(index)} value={rpcTabValue(index)}>
            <RpcProfileTab profile={profile} active={index === activeIndex} />
          </MduiTabPanel>
        ))}
      </RpcProfileTabStrip>
    </div>
  );
}

export default AriaNgSettingsPage;