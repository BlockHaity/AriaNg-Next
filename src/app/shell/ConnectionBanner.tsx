/**
 * Connection and task notifications.
 *
 * Despite the name this component renders nothing of its own — it is the
 * subscriber that turns store events into notices, exactly like AriaNg's
 * `ariaNgNotificationService` callers:
 *
 * - **first successful connection** → `"<rpcName> is connected"`;
 * - `aria2.onDownloadComplete` → `Download Completed`;
 * - `aria2.onBtDownloadComplete` → `BT Download Completed`;
 * - `aria2.onDownloadError` → `Download Error`.
 *
 * The three task notices go out through the **browser** `Notification` API, and
 * that path is gated inside the store: it only fires when the transport is a
 * WebSocket (those three `aria2.on*` messages do not exist over HTTP), when the
 * `browserNotification` setting is on, when permission was granted, and when the
 * frequency limit allows it. This component therefore does not re-check any of
 * it — asking twice is how a "please enable notifications" prompt ends up firing
 * when the user said no.
 *
 * ## The "Reload AriaNg" notice
 *
 * AriaNg asked for a reload after almost every settings change. With hot profile
 * switching almost all of those cases are gone: a profile change is applied
 * in place, the theme is applied live, the locale is re-loaded on demand and the
 * refresh intervals are hot-applied. What genuinely cannot be applied live is
 * **importing a configuration blob** and **resetting the settings**, both of
 * which replace the whole settings object at once. Those are the only two sources
 * of the pinned notice here.
 *
 * TODO(settings-agent): the settings store exposes no `import` / `reset` event,
 * so the two are detected structurally — a wholesale replacement of the settings
 * blob (several keys changing at once) rather than a single-key edit. If the
 * store ever emits a real event, this heuristic should be replaced by it.
 */
import { useEffect, useRef } from 'react';

import { useTranslate } from '@/i18n';
import type { AriaNgSettings } from '@/config/types';
import { RpcStatus } from '@/config/rpc-constants';
import { notifyBtTaskComplete, notifyInPage, notifyTaskComplete, notifyTaskError } from '@/store/notifications';
import { subscribeTaskEvents, useRpcStore } from '@/store/rpc-store';
import type { TaskEvent } from '@/store/rpc-store';
import { useProfilesStore } from '@/store/profiles';
import { useSettingsStore } from '@/store/settings';
import { useTasksStore } from '@/store/tasks';

/** A normal settings edit touches one key; import / reset touch many. */
const WHOLESALE_CHANGE_THRESHOLD = 4;

/** How many keys differ between two settings blobs. */
function countChangedKeys(previous: AriaNgSettings, next: AriaNgSettings): number {
  let changed = 0;
  for (const key of Object.keys(previous) as (keyof AriaNgSettings)[]) {
    if (!Object.is(previous[key], next[key])) {
      changed += 1;
    }
  }
  return changed;
}

export function ConnectionBanner() {
  const t = useTranslate();
  const firstSuccessPending = useRef(true);
  const previousSettings = useRef<AriaNgSettings | null>(null);

  /* --- connection ------------------------------------------------------ */

  useEffect(() => {
    return useRpcStore.subscribe((state, previous) => {
      const becameConnected =
        state.connection.status === RpcStatus.Connected && previous.connection.status !== RpcStatus.Connected;
      if (!becameConnected || !firstSuccessPending.current) {
        return;
      }
      // AriaNg announced exactly one connection notice per page load: the first
      // transition into `Connected`.
      firstSuccessPending.current = false;
      const profiles = useProfilesStore.getState();
      notifyInPage({
        title: `${profiles.displayName(profiles.activeProfile())} ${t('is connected')}`,
        type: 'success',
        delay: 2000,
      });
    });
  }, [t]);

  /* --- task events ------------------------------------------------------ */

  useEffect(
    () =>
      subscribeTaskEvents((event: TaskEvent) => {
        const task = useTasksStore.getState().byGid[event.gid];
        const name = task?.taskName ?? event.gid;

        switch (event.kind) {
          case 'complete':
            notifyTaskComplete(event.gid, name);
            break;
          case 'btComplete':
            notifyBtTaskComplete(event.gid, name);
            break;
          case 'error':
            notifyTaskError(event.gid, name, task?.errorMessage ?? '');
            break;
          default:
            // start / pause / stop were never notifications in AriaNg either.
            break;
        }
      }),
    [],
  );

  /* --- the one notice that still needs a reload ------------------------ */

  useEffect(() => {
    const start = useSettingsStore.getState().settings;
    previousSettings.current = start;

    return useSettingsStore.subscribe((state, previous) => {
      if (state.settings === previous.settings) {
        return;
      }
      const before = previousSettings.current;
      previousSettings.current = state.settings;
      if (!before) {
        return;
      }
      if (countChangedKeys(before, state.settings) < WHOLESALE_CHANGE_THRESHOLD) {
        // A normal, single-setting edit: applied live, nothing to warn about.
        return;
      }
      notifyInPage({
        title: t('Reload AriaNg'),
        content: t('Configuration has been modified, please reload the page for the changes to take effect.'),
        type: 'warning',
        delay: 0,
        reloadAction: true,
      });
    });
  }, [t]);

  return null;
}