/**
 * `/debug` — the debug console.
 *
 * The whole page is gated on debug mode, exactly like AriaNg's
 * `ng-show="enableDebugMode()"`: with the mode off the user gets the
 * "Access Denied!" error dialog whose OK button sends them to the AriaNg
 * settings, because that is the only place the mode can be turned on.
 *
 * Two tabs: **Latest Logs** and **Aria2 RPC Debug**. Swiping left / right moves
 * between them when the `swipeGesture` setting is on, mirroring the
 * `swipeActions.extendLeftSwipe` / `extendRightSwipe` handlers AriaNg's
 * `debug.js` installed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Routes } from '@/app/route-paths';
import { APP_CONSTANTS } from '@/config/defaults';
import { useTranslate } from '@/i18n';
import { bindSwipeGestures } from '@/utils/swipe';
import { useSettingsStore } from '@/store/settings';
import { alertDialog } from '@/ui/mdui';
import { useMduiModel } from '@/ui/mdui';

import { LatestLogsTab } from './debug/LatestLogsTab';
import { RpcDebugTab } from './debug/RpcDebugTab';
import './debug/debug.css';

/** AriaNg's `tabStatusItems`, in the order the swipe steps through them. */
const TABS = ['logs', 'rpc'] as const;
type DebugTab = (typeof TABS)[number];

function isTab(value: string): value is DebugTab {
  return (TABS as readonly string[]).includes(value);
}

/**
 * Reads the flag straight from the store rather than through React state:
 * AriaNg re-checked it inside the dialog callback ("…if debug mode is still
 * off, navigate"), so a user who switches it on while the dialog is open stays
 * on the page.
 */
function isDebugModeEnabled(): boolean {
  return useSettingsStore.getState().session.debugMode === true;
}

export default function DebugPage() {
  const t = useTranslate();
  const navigate = useNavigate();

  const debugMode = useSettingsStore((state) => state.session.debugMode);
  const swipeGesture = useSettingsStore((state) => state.settings.swipeGesture);

  const [tab, setTab] = useState<DebugTab>('logs');
  const tabsRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const logsTitle = t('format.debug.latest-logs', { count: APP_CONSTANTS.cachedDebugLogsLimit });

  /* --- access gate -------------------------------------------------------- */

  useEffect(() => {
    if (debugMode) return undefined;

    let cancelled = false;
    void (async () => {
      await alertDialog({
        heading: t('Error'),
        text: t('Access Denied!'),
        okText: t('OK'),
        icon: 'error',
      });
      // Re-checked, exactly like AriaNg's `if (!isEnableDebugMode())`.
      if (!cancelled && !isDebugModeEnabled()) {
        navigate(Routes.AriaNgSettings);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debugMode, navigate, t]);

  /* --- tab switching ------------------------------------------------------ */

  const changeTab = useCallback((next: DebugTab) => {
    setTab(next);
  }, []);

  // Two-way binding for `<mdui-tabs>`; the raw elements are used because the
  // `MduiTabs` wrapper cannot forward `role="tablist"` / `role="tab"`, which the
  // ARIA pattern for a tab strip requires.
  useMduiModel(tabsRef, tab, (next: string) => {
    if (isTab(next)) changeTab(next);
  }, 'change');

  /* --- swipe (AriaNg's `swipeActions.extend{Left,Right}Swipe`) ------------ */

  useEffect(() => {
    const node = pageRef.current;
    if (!node) return undefined;

    return bindSwipeGestures(node, {
      enabled: () => swipeGesture,
      onSwipeLeft: () => {
        const index = TABS.indexOf(tab);
        // The last tab swallows the gesture instead of wrapping around, which is
        // what `getVisibleTabOrders()` + the `tabIndex < length - 1` guard did.
        if (index < TABS.length - 1) changeTab(TABS[index + 1]);
      },
      onSwipeRight: () => {
        const index = TABS.indexOf(tab);
        if (index > 0) changeTab(TABS[index - 1]);
      },
    });
  }, [changeTab, swipeGesture, tab]);

  if (!debugMode) {
    // AriaNg rendered nothing (`ng-show`); the dialog above is the whole answer.
    return <div ref={pageRef} className="ariang-debug-page" />;
  }

  return (
    <div ref={pageRef} className="ariang-debug-page">
      <mdui-tabs
        ref={tabsRef}
        value={tab}
        variant="secondary"
        role="tablist"
        aria-label={t('Aria2 RPC Debug')}
      >
        {/*
          `aria-selected` is passed as a *string*: React 19 renders a boolean
          prop on a custom element as the empty attribute (and drops it for
          `false`), which is not what the ARIA tab pattern expects.
        */}
        <mdui-tab
          value="logs"
          role="tab"
          aria-selected={tab === 'logs' ? 'true' : 'false'}
          id="debug-tab-logs"
          aria-controls="debug-panel-logs"
        >
          {logsTitle}
        </mdui-tab>
        <mdui-tab
          value="rpc"
          role="tab"
          aria-selected={tab === 'rpc' ? 'true' : 'false'}
          id="debug-tab-rpc"
          aria-controls="debug-panel-rpc"
        >
          {t('Aria2 RPC Debug')}
        </mdui-tab>

        <mdui-tab-panel
          slot="panel"
          value="logs"
          role="tabpanel"
          id="debug-panel-logs"
          aria-labelledby="debug-tab-logs"
        >
          <LatestLogsTab title={logsTitle} />
        </mdui-tab-panel>

        <mdui-tab-panel
          slot="panel"
          value="rpc"
          role="tabpanel"
          id="debug-panel-rpc"
          aria-labelledby="debug-tab-rpc"
        >
          <RpcDebugTab active={tab === 'rpc'} />
        </mdui-tab-panel>
      </mdui-tabs>
    </div>
  );
}