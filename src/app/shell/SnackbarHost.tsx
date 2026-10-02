/**
 * The in-page snackbar host — the UI half of `@/store/notifications`.
 *
 * AriaNg showed every `ariaNgNotificationService` message through `$mdToast`.
 * Here the queue is a plain subscribe-able list (the store owns it, deliberately
 * UI-free) and this component renders it as a stack of `<mdui-snackbar>`s.
 *
 * It supports everything the queue can express:
 *
 * - several notices at once, each with its own id;
 * - `positionY: 'top' | 'bottom'`;
 * - the pinned **Reload** notice (`reloadAction`), which AriaNg used whenever a
 *   change could not be applied live;
 * - `type` → the MD3 role the title is painted with.
 *
 * Mounting marks the shell as ready for notices through
 * `ui.setSnackbarHost(true)`, and unmounting clears the flag, so a host that is
 * not on screen can never silently swallow a queued notice.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useTranslate } from '@/i18n';
import { dismissInPage, getInPageNotices, subscribeInPage } from '@/store/notifications';
import type { InPageNotice, InPageType } from '@/store/notifications';
import { useUiStore } from '@/store/ui';
import { MduiSnackbar } from '@/ui/mdui';

/** MD3 role per notice type. */
const TYPE_ROLE: Record<InPageType, string> = {
  primary: 'primary',
  success: 'tertiary',
  error: 'error',
  info: 'primary',
  warning: 'secondary',
  progress: 'primary',
};

function noticeBody(notice: InPageNotice): ReactNode {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
      <span style={{ color: `rgb(var(--mdui-color-${TYPE_ROLE[notice.type] ?? 'primary'}))`, font: 'var(--mdui-typescale-title-small-font)' }}>
        {notice.title}
      </span>
      {notice.contentPrefix ? (
        <code
          style={{
            fontFamily: 'monospace',
            font: 'var(--mdui-typescale-body-small-font)',
            overflowWrap: 'anywhere',
          }}
        >
          {notice.contentPrefix}
        </code>
      ) : null}
      {notice.content ? (
        <span style={{ font: 'var(--mdui-typescale-body-medium-font)' }}>{notice.content}</span>
      ) : null}
    </span>
  );
}

export function SnackbarHost() {
  const t = useTranslate();
  const [notices, setNotices] = useState<InPageNotice[]>(() => getInPageNotices());

  useEffect(() => {
    useUiStore.getState().setSnackbarHost(true);
    const unsubscribe = subscribeInPage(setNotices);
    return () => {
      unsubscribe();
      useUiStore.getState().setSnackbarHost(false);
    };
  }, []);

  if (notices.length === 0) {
    return null;
  }

  return (
    <div
      className="ariang-snackbar-host"
      // `mdui-snackbar` positions itself; this only decides the stacking order
      // when several are visible at once.
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
    >
      {notices.map((notice) => (
        <MduiSnackbar
          key={notice.id}
          open
          message={noticeBody(notice)}
          position={notice.positionY === 'top' ? 'top' : 'bottom'}
          timeout={notice.delay > 0 ? notice.delay : 0}
          closeable
          action={notice.reloadAction ? t('Reload AriaNg') : undefined}
          onActionClick={
            notice.reloadAction
              ? () => {
                  dismissInPage(notice.id);
                  window.location.reload();
                }
              : undefined
          }
          onClosed={() => {
            // Fires for the close button *and* for the auto-close timer; the
            // store's own timer does the same thing, and `dismissInPage` is
            // idempotent, so the two can never double-fire a callback.
            dismissInPage(notice.id);
          }}
        />
      ))}
    </div>
  );
}