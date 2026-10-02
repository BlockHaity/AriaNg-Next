/**
 * Application entry point.
 *
 * Deliberately tiny: the stylesheets, the React root, and the service-worker
 * registration for the **standard** build. Everything else — settings, theme,
 * locale, RPC client, scheduler, shortcuts — happens once, in
 * `src/app/BootstrapGate.tsx`, so it also runs exactly once no matter how many
 * times React remounts the tree.
 */
import 'mdui/mdui.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { i18n } from './i18n';
import { notifyInPage } from './store/notifications';

/* -------------------------------------------------------------------------- */
/* service worker                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The generated worker and its scope, relative to the document.
 *
 * `base: './'` makes every asset url relative, so a plain relative `./sw.js` keeps
 * the app installable from any sub-path — which is what the PWA manifest promises
 * (`start_url: './'`, `scope: './'`).
 */
const SERVICE_WORKER_URL = './sw.js';
const SERVICE_WORKER_SCOPE = './';

/**
 * Registers `sw.js` with `registerType: 'prompt'` semantics: a waiting worker is
 * **never** activated behind the user's back. `updatefound` surfaces the pinned
 * "Reload AriaNg" notice, accepting it asks the waiting worker to take over, and
 * the page reloads once `controllerchange` says it actually did — the only moment
 * swapping the running code is safe.
 *
 * ## Why not `virtual:pwa-register`
 *
 * That module is provided by `vite-plugin-pwa`, and the plugin is only installed
 * for the standard target (the single-file build has no `sw.js` next to the
 * document, and inlines everything into `index.html`). A static
 * `import('virtual:pwa-register')` would therefore make the **single-file** build
 * fail at Rollup resolution time, while the usual escape hatch — building the
 * specifier at runtime so Rollup never resolves it — would break the standard
 * build instead, because the browser cannot resolve a virtual id either. Neither
 * target has a `virtual:*` resolver, so the registration is written against
 * `navigator.serviceWorker` directly and stays behind the same guard.
 */
async function registerServiceWorker(): Promise<void> {
  // No `sw.js` beside the document in the single-file build: nothing to register.
  if (__BUILD_TARGET__ !== 'standard') {
    return;
  }
  // `vite-plugin-pwa`'s `devOptions` are disabled, so dev never gets a worker.
  if (!import.meta.env.PROD) {
    return;
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: SERVICE_WORKER_SCOPE,
      type: 'classic',
    });

    // AriaNg's pinned "Reload AriaNg" notice, driven by the same in-page toast
    // queue every other message uses.
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) {
        return;
      }
      installing.addEventListener('statechange', () => {
        // `controller` is set only when this is an *update*; the first install
        // has nothing to reload.
        if (installing.state !== 'installed' || !navigator.serviceWorker.controller) {
          return;
        }
        notifyInPage({
          title: i18n.t('Reload AriaNg'),
          delay: 0,
          reloadAction: true,
        });
      });
    });

    // The worker took control: the assets on disk are now the new ones, so the
    // page can be reloaded onto them.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) {
        return;
      }
      reloading = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn('[app] service worker registration failed', error);
  }
}

/* -------------------------------------------------------------------------- */
/* bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

function bootstrap(): void {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('[app] #root not found');
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // `index.html` keeps the body at `opacity: 0` until this class lands. The class
  // is added by `BootstrapGate` right after the mdui components are defined; it is
  // also added here as a safety net so a bootstrap failure cannot leave an
  // invisible page.
  document.body.classList.add('ready');

  void registerServiceWorker();
}

bootstrap();