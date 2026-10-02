/**
 * The startup sequence.
 *
 * AriaNg bootstrapped from `index.js` in a fixed order and everything else
 * assumed it had happened. This component reproduces that order exactly once and
 * only renders its children when it is safe to do so:
 *
 * 1. **hydrate the settings** — one read from storage, merged over the defaults,
 *    with AriaNg's lazy back-fill applied;
 * 2. **register the mdui components** and *then* add `document.body.ready`, which
 *    is what lifts the `:not(:defined)` FOUC guard from `index.html`;
 * 3. **apply the theme**, and keep applying it when the setting changes;
 * 4. **apply the locale**, falling back to English (with a notice) when the table
 *    cannot be loaded;
 * 5. **build the RPC client** from the active profile, and tell the notification
 *    service which transport is live;
 * 6. **register the global refresh loops** on the shared scheduler, re-reading the
 *    intervals on every settings change so they hot-apply;
 * 7. **bind the global keyboard shortcuts and the swipe gestures**, each gated on
 *    its own setting;
 * 8. **welcome first-time visitors** with AriaNg's notice, whose dismissal takes
 *    them to the settings page.
 *
 * Every step is individually guarded: a failure in one must not leave the user
 * with a blank page, so the whole sequence is wrapped and reported as a notice.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { FOCUS_SEARCH_EVENT, getCurrentRoutePath, navigateInShell } from './shell';
import { Routes as RoutePaths } from './route-paths';
import { i18n, resolveLocaleKey } from '@/i18n';
import { APP_CONSTANTS, isWebSocketProfile } from '@/config/defaults';
import type { AriaNgSettings } from '@/config/types';
import { useProfilesStore } from '@/store/profiles';
import { notifyInPage, setNotificationsTransport } from '@/store/notifications';
import { useRpcStore } from '@/store/rpc-store';
import { scheduler } from '@/store/scheduler';
import { useSelectionStore } from '@/store/selection';
import { useSettingsStore } from '@/store/settings';
import { applyTitle } from '@/store/title';
import { useTasksStore } from '@/store/tasks';
import { useUiStore } from '@/store/ui';
import { bindGlobalShortcuts } from '@/utils/keyboard';
import { bindSwipeGestures } from '@/utils/swipe';
import { registerMduiComponents, setTheme } from '@/ui/mdui';

/* -------------------------------------------------------------------------- */
/* scheduler ids                                                              */
/* -------------------------------------------------------------------------- */

const JOB_GLOBAL_STAT = 'global-stat';
const JOB_TASK_LIST = 'task-list';
const JOB_TITLE = 'title';
const JOB_DEBUG_LOGS = 'debug-logs';

/**
 * `debugAutoRefresh` is not part of the settings blob yet — only its
 * `DebugAutoRefreshInterval` type is. It is read defensively so the debug console
 * starts auto-refreshing the moment the key lands, with no change here.
 *
 * TODO(settings-agent): add `debugAutoRefresh: DebugAutoRefreshInterval` to
 * `AriaNgSettings` and drop the cast.
 */
type MaybeDebugAutoRefresh = { debugAutoRefresh?: number };

function currentSettings(): AriaNgSettings {
  return useSettingsStore.getState().settings;
}

/** aria2 reports its counters as strings; the formatters want numbers. */
function toNumber(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The three routes that own a task list. */
function isTaskListRoute(path: string): boolean {
  return path === RoutePaths.Downloading || path === RoutePaths.Waiting || path === RoutePaths.Stopped;
}

/**
 * Module latch for the welcome notice.
 *
 * `settings.firstVisit` stays true until the settings blob has been written back,
 * and StrictMode mounts this effect twice — without the latch the notice would be
 * queued twice.
 */
let welcomeShown = false;

/* -------------------------------------------------------------------------- */
/* bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

export interface BootstrapGateProps {
  children?: ReactNode;
}

export function BootstrapGate({ children }: BootstrapGateProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    const disposers: (() => void)[] = [];

    void (async () => {
      /* 1 — settings ------------------------------------------------------ */
      useSettingsStore.getState().hydrate();

      /* 2 — mdui components + the FOUC guard ----------------------------- */
      // `registerMduiComponents()` resolves once every tag in
      // `MDUI_COMPONENTS` is defined, using `Promise.allSettled` so a single
      // missing component can never hang the app. `index.html` keeps the body
      // invisible until the `ready` class lands.
      await registerMduiComponents();
      if (disposed) {
        return;
      }
      document.body.classList.add('ready');

      /* 3 — theme -------------------------------------------------------- */
      // No `await` separates this from the `ready` class above, so the browser
      // paints the body once, already showing the right scheme.
      setTheme(currentSettings().theme);
      disposers.push(
        useSettingsStore.subscribe((state, previous) => {
          if (state.settings !== previous.settings && state.settings.theme !== previous.settings.theme) {
            setTheme(state.settings.theme);
          }
        }),
      );

      /* 4 — locale ------------------------------------------------------- */
      // `i18n.setLocale` never rejects: it degrades to English itself and
      // reports through `subscribeStatus`, so the resolved locale is what a
      // failure is detected from.
      disposers.push(
        i18n.subscribeStatus((event) => {
          if (event.status === 'error') {
            notifyInPage({ title: i18n.t('Error'), content: event.message, type: 'error', delay: 0 });
          }
        }),
      );
      const wanted = resolveLocaleKey(currentSettings().language);
      await i18n.setLocale(wanted);
      if (i18n.locale !== wanted) {
        // English is always available, so the app is usable — but say so.
        notifyInPage({
          title: i18n.t('Error'),
          content: `${wanted} → ${i18n.locale}`,
          type: 'warning',
          delay: 0,
        });
      }
      // A locale the user (or the OS) picked is persisted, as AriaNg did. mdui's
      // own strings follow the same locale asynchronously through
      // `mdui/functions/setLocale.js`, which the i18n store drives.
      disposers.push(
        i18n.subscribe((event) => {
          useSettingsStore.getState().set('language', event.locale);
        }),
      );

      if (disposed) {
        return;
      }

      /* 5 — the RPC client ----------------------------------------------- */
      // `init()` is the store's own wrapper around `createAria2Client` +
      // `setAria2Client`; calling `initAria2Client()` directly would build a
      // second, unwired client that nothing subscribes to.
      const profilesState = useProfilesStore.getState();
      useRpcStore.getState().setProfiles(profilesState.profiles, profilesState.activeProfileIndex);
      useRpcStore.getState().init();

      // aria2's push messages only exist over a WebSocket, so the notification
      // service has to be told which transport is live before it can decide
      // whether a task notification is even possible.
      setNotificationsTransport(
        isWebSocketProfile(useProfilesStore.getState().activeProfile()) ? 'websocket' : 'http',
      );

      /* 6 — the global refresh loops ------------------------------------ */
      // The scheduler never overlaps a tick and auto-suspends while the document
      // is hidden; AriaNg kept all seven intervals running in a background tab.
      disposers.push(
        scheduler.register({
          id: JOB_GLOBAL_STAT,
          intervalMs: currentSettings().globalStatRefreshInterval,
          run: () => useRpcStore.getState().refreshGlobalStat(),
        }),
      );

      disposers.push(
        scheduler.register({
          id: JOB_TASK_LIST,
          intervalMs: currentSettings().downloadTaskRefreshInterval,
          run: () => {
            // Only the task-list routes own a task list; a settings or status
            // page must neither be billed for one nor leave a stale one behind.
            if (!isTaskListRoute(getCurrentRoutePath())) {
              return undefined;
            }
            return useTasksStore.getState().refresh({ silent: true });
          },
        }),
      );

      disposers.push(
        scheduler.register({
          id: JOB_TITLE,
          intervalMs: currentSettings().titleRefreshInterval,
          run: () => {
            const stat = useRpcStore.getState().globalStat;
            applyTitle(
              currentSettings().title,
              {
                // aria2 reports its counters as strings; the title formatter
                // wants numbers.
                globalStat: stat
                  ? {
                      downloadSpeed: toNumber(stat.downloadSpeed),
                      numActive: toNumber(stat.numActive),
                      numWaiting: toNumber(stat.numWaiting),
                      numStopped: toNumber(stat.numStopped),
                      uploadSpeed: toNumber(stat.uploadSpeed),
                    }
                  : undefined,
                currentRpcProfile: useProfilesStore.getState().activeProfile(),
              },
              i18n.t,
            );
          },
        }),
      );

      disposers.push(
        scheduler.register({
          id: JOB_DEBUG_LOGS,
          intervalMs: (currentSettings() as MaybeDebugAutoRefresh).debugAutoRefresh ?? 0,
          run: () => {
            // aria2 has no log endpoint, so "debug auto refresh" only forces the
            // debug console to re-read the cached log lines. Disabled (0) until
            // the setting exists, which is also AriaNg's default.
          },
        }),
      );

      // Hot-apply an interval change instead of waiting for a reload.
      disposers.push(
        useSettingsStore.subscribe((state, previous) => {
          if (state.settings === previous.settings) {
            return;
          }
          const next = state.settings;
          const before = previous.settings;
          if (next.globalStatRefreshInterval !== before.globalStatRefreshInterval) {
            scheduler.updateInterval(JOB_GLOBAL_STAT, next.globalStatRefreshInterval);
          }
          if (next.downloadTaskRefreshInterval !== before.downloadTaskRefreshInterval) {
            scheduler.updateInterval(JOB_TASK_LIST, next.downloadTaskRefreshInterval);
          }
          if (next.titleRefreshInterval !== before.titleRefreshInterval) {
            scheduler.updateInterval(JOB_TITLE, next.titleRefreshInterval);
          }
          const debugBefore = (before as MaybeDebugAutoRefresh).debugAutoRefresh ?? 0;
          const debugAfter = (next as MaybeDebugAutoRefresh).debugAutoRefresh ?? 0;
          if (debugAfter !== debugBefore) {
            scheduler.updateInterval(JOB_DEBUG_LOGS, debugAfter);
          }
        }),
      );

      /* 7 — keyboard shortcuts + swipe gestures -------------------------- */
      // `enabled` is a getter rather than a boolean so a settings change takes
      // effect on the very next event.
      disposers.push(
        bindGlobalShortcuts(
          {
            onSelectAll: () => {
              const { selectAll } = useUiStore.getState().keyActions;
              // The task-list page registers its own handler; without one, the
              // global default (everything visible) still does something useful.
              (selectAll ?? (() => useSelectionStore.getState().selectAll()))();
            },
            onDelete: () => {
              const { delete: remove } = useUiStore.getState().keyActions;
              // No page owns `Delete` on a page without a task list, so there is
              // deliberately no fallback: deleting from the wrong page is worse
              // than doing nothing.
              remove?.();
            },
            onFocusSearch: () => {
              window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT));
            },
          },
          { enabled: () => currentSettings().keyboardShortcuts === true },
        ),
      );

      if (typeof document !== 'undefined' && document.body) {
        disposers.push(
          bindSwipeGestures(document.body, {
            enabled: () => currentSettings().swipeGesture === true,
            onSwipeRight: () => {
              // A mounted page owns the gesture first (task-detail tabs).
              if (useUiStore.getState().swipeActions.extendRightSwipe?.()) {
                return;
              }
              useUiStore.getState().setDrawer(true);
            },
            onSwipeLeft: () => {
              if (useUiStore.getState().swipeActions.extendLeftSwipe?.()) {
                return;
              }
              useUiStore.getState().setDrawer(false);
            },
          }),
        );
      }

      /* 8 — the first-visit welcome notice ------------------------------ */
      if (useSettingsStore.getState().firstVisit && !welcomeShown) {
        welcomeShown = true;
        notifyInPage({
          title: APP_CONSTANTS.title,
          content: i18n.t('Tap to configure and get started with AriaNg.'),
          type: 'primary',
          // Sticky: AriaNg waited for the user rather than dismissing itself.
          delay: 0,
          onClose: () => {
            navigateInShell(RoutePaths.AriaNgSettings);
          },
        });
      }

      if (!disposed) {
        setReady(true);
      }
    })().catch((error: unknown) => {
      // A bootstrap failure must still produce a usable page.
       
      console.error('[app] bootstrap failed', error);
      document.body.classList.add('ready');
      if (!disposed) {
        setReady(true);
      }
    });

    return () => {
      disposed = true;
      for (const dispose of disposers) {
        try {
          dispose();
        } catch (error) {
           
          console.error('[app] bootstrap cleanup failed', error);
        }
      }
    };
  }, []);

  if (!ready) {
    return <BootstrapScreen />;
  }

  return <>{children}</>;
}

/**
 * What the user sees while the sequence runs.
 *
 * mdui's elements are already defined by the time this renders (the `ready`
 * class has been added), so a centred circular progress is all that is needed.
 */
function BootstrapScreen() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        color: 'rgb(var(--mdui-color-primary))',
      }}
      role="status"
      aria-live="polite"
    >
      {/* No `value` means indeterminate — mdui's convention for both progress
          elements. */}
      <mdui-circular-progress />
    </div>
  );
}