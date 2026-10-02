/**
 * The application root.
 *
 * ```
 * <I18nProvider>          every string below it re-renders on a locale change
 *   <StorageBrokenOverlay>  fatal storage failure, above everything
 *   <BootstrapGate>         the startup sequence; children only once it is safe
 *     <HashBangRouter>       `#!`-mounted history
 *       <AppShell>           the MD3 scaffold
 *         <AppRoutes />      the lazy page outlet
 * ```
 *
 * `BootstrapGate` sits **above** the router on purpose: it must not create a
 * history (nor a React tree) before the settings have been read and mdui's
 * components are defined.
 */
import { I18nProvider } from '@/i18n';

import { AppRoutes, HashBangRouter } from './router';
import { BootstrapGate } from './BootstrapGate';
import { AppShell, StorageBrokenOverlay } from './shell';

export function App() {
  return (
    <I18nProvider>
      <StorageBrokenOverlay />
      <BootstrapGate>
        <HashBangRouter>
          <AppShell>
            <AppRoutes />
          </AppShell>
        </HashBangRouter>
      </BootstrapGate>
    </I18nProvider>
  );
}

export default App;