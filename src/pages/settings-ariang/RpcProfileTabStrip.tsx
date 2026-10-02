/**
 * The tab strip of `/settings/ariang` — AriaNg's `ul.nav.nav-tabs` inside
 * `.nav-tabs-custom`, 1:1:
 *
 * - one **Global** tab,
 * - one tab per RPC profile, labelled `RPC (alias)` / `RPC (host:port)`,
 * - a **×** close button on every non-default profile,
 * - a trailing slim **+** tab that adds a profile.
 *
 * `<mdui-tabs>` owns the active state, so the strip also carries
 * `role="tablist"` (mdui's own `<mdui-tablist>` does) and `aria-selected` on each
 * tab. Panels are passed in as children by the page, because mdui requires
 * `<mdui-tab-panel slot="panel">` to be a child of the same `<mdui-tabs>`.
 */

import type { ReactNode } from 'react';
import type { RpcProfile } from '@/config/types';
import { rpcProfileDisplayName } from '@/config/defaults';
import { useTranslate } from '@/i18n/react';
import { MduiTab, MduiTabs } from '@/ui/mdui';

import './styles.css';

/** Tab value of the Global tab. */
export const GLOBAL_TAB = 'global';

/** Tab value of the trailing "add profile" tab. */
export const ADD_TAB = 'add';

/** AriaNg's `RPC (alias)` / `RPC (host:port)` tab label. */
export function rpcTabLabel(t: (key: string) => string, profile: RpcProfile): string {
  const name =
    profile.rpcAlias || profile.rpcHost ? ` (${rpcProfileDisplayName(profile)})` : '';
  return `${t('RPC')}${name}`;
}

export interface RpcProfileTabStripProps {
  profiles: readonly RpcProfile[];
  activeTab: string;
  /**
   * Called with the new tab value, including {@link ADD_TAB} for the trailing
   * `+`. The page turns that into `profiles.add()`; the strip stays dumb so it
   * never has to know how a profile is created.
   */
  onSelectTab: (value: string) => void;
  onRemoveProfile: (profile: RpcProfile) => void;
  /** `<mdui-tab-panel slot="panel">` children, one per tab value. */
  children?: ReactNode;
}

export function RpcProfileTabStrip(props: RpcProfileTabStripProps) {
  const { profiles, activeTab, onSelectTab, onRemoveProfile, children } = props;
  const t = useTranslate();

  return (
    <MduiTabs
      className="settings-tabs"
      activeTab={activeTab}
      variant="primary"
      onTabChange={onSelectTab}
    >
      <MduiTab value={GLOBAL_TAB} label={t('Global')} />

      {profiles.map((profile, index) => {
        const value = rpcTabValue(index);
        const label = rpcTabLabel(t, profile);

        return (
          <MduiTab key={profile.rpcId ?? value} value={value}>
            <span className="settings-tab__label" title={rpcProfileDisplayName(profile)}>
              {label}
              {profile.isDefault ? null : (
                <button
                  type="button"
                  className="settings-tab__close"
                  aria-label={t('Delete RPC Setting')}
                  title={t('Delete RPC Setting')}
                  onClick={(event) => {
                    // The close button lives inside the tab, so without this the
                    // tab's own activation handler would also fire.
                    event.stopPropagation();
                    onRemoveProfile(profile);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </span>
          </MduiTab>
        );
      })}

      {/* Slim: a bare `+`, with the full label kept for assistive technology. */}
      <MduiTab value={ADD_TAB} label="+">
        <span className="ariang-visually-hidden">{t('Add New RPC Setting')}</span>
      </MduiTab>

      {children}
    </MduiTabs>
  );
}

/** Tab value of the profile at `index` (index 0 is the default profile). */
export function rpcTabValue(index: number): string {
  return `rpc${index}`;
}

/** Index of the profile shown by `value`, or `-1` for the Global tab. */
export function rpcTabIndex(value: string): number {
  if (!value.startsWith('rpc')) return -1;
  const index = Number.parseInt(value.slice(3), 10);
  return Number.isFinite(index) ? index : -1;
}

export default RpcProfileTabStrip;