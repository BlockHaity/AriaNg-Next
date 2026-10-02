/**
 * The fatal overlay for an environment without usable storage.
 *
 * AriaNg detected "no localStorage and no cookies" up front and showed a blurred,
 * unusable page with one message, because **every** setting the user has would be
 * lost on the next reload — there is no way to make the app meaningful in that
 * state. The storage layer here degrades to an in-memory `Map` instead of
 * throwing, so this is the only place that says so.
 *
 * ## Never throws during render
 *
 * The check is a plain zustand selector (a boolean the store computed while
 * probing) and the overlay is drawn with plain elements rather than an mdui
 * component: if the storage layer is broken, so may anything that depends on it,
 * and this overlay is the last thing that must still work.
 */
import { useTranslate } from '@/i18n';
import { useSettingsStore } from '@/store/settings';

export function StorageBrokenOverlay() {
  const t = useTranslate();
  const broken = useSettingsStore((state) => state.storageBroken);

  if (!broken) {
    return null;
  }

  return (
    <div
      className="ariang-storage-broken"
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 4000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '1.5rem',
        textAlign: 'center',
        backgroundColor: 'rgb(var(--mdui-color-scrim))',
        color: 'rgb(var(--mdui-color-on-surface))',
      }}
    >
      <p style={{ margin: 0, maxWidth: '32rem', font: 'var(--mdui-typescale-body-large-font)' }}>
        {t('You cannot use AriaNg because this browser does not meet the minimum requirements for data storage.')}
      </p>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        style={{
          minHeight: '3rem',
          padding: '0 1.5rem',
          border: 0,
          borderRadius: 'var(--mdui-shape-corner-full)',
          backgroundColor: 'rgb(var(--mdui-color-primary))',
          color: 'rgb(var(--mdui-color-on-primary))',
          font: 'var(--mdui-typescale-label-large-font)',
          cursor: 'pointer',
        }}
      >
        {t('Reload AriaNg')}
      </button>
    </div>
  );
}