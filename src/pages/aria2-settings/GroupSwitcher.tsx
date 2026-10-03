/**
 * The aria2 settings group's in-page switcher.
 *
 * ## Why this exists
 *
 * AriaNg shows the ten option groups as a collapsible section in its sidebar, and
 * that is still how this app's navigation drawer renders it. But the drawer is not
 * the primary navigation from the `md` breakpoint upwards — there the
 * `<mdui-navigation-rail>` is, and a rail row cannot be a collapse. So the whole
 * section used to exist only inside the drawer: on a desktop-width window the ten
 * groups were reachable solely through the rail's hamburger *and* an accordion that
 * had to be expanded, which is indistinguishable from the section being absent.
 *
 * Putting the switcher on the page fixes it at the root: the ten groups become
 * reachable in one click from wherever the page is entered, at any viewport, with
 * no dependence on a nested disclosure being open. The drawer keeps its collapse
 * because it is AriaNg's own layout.
 *
 * ## Why it navigates rather than switching locally
 *
 * The group is a route (`/settings/aria2/:group`), because AriaNg's sidebar linked
 * each group as its own url and deep links to `#!settings/aria2/bt` have to keep
 * working. So switching a group is a navigation, and the page's panel is keyed by
 * the route — the same reasoning the drawer's rows already rely on.
 */

import { useLocation, useNavigate } from 'react-router-dom';

import { aria2SettingsRoute, OPTION_GROUP_ROUTES } from '../../app/route-paths';
import { useTranslate } from '@/i18n';
import { ARIA2_GROUP_ICONS, ARIA2_GROUP_TITLE_KEYS } from '@/config/option-groups';
import { MduiIcon, MduiList, MduiListItem, MduiListSubheader } from '@/ui/mdui';

import type { OptionGroupRoute } from '@/config/types';

import './group-switcher.css';

/** Is this group the one currently on screen? Prefix match, so `/bt/extra` counts. */
function isActive(pathname: string, group: OptionGroupRoute): boolean {
  const base = aria2SettingsRoute(group);
  return pathname === base || pathname.startsWith(`${base}/`);
}

export interface Aria2GroupSwitcherProps {
  /** Narrow layout: render as a scrollable row instead of a list. */
  compact?: boolean;
}

export function Aria2GroupSwitcher({ compact = false }: Aria2GroupSwitcherProps) {
  const t = useTranslate();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav
      className={compact ? 'aria2-group-switcher aria2-group-switcher--compact' : 'aria2-group-switcher'}
      aria-label={t('Aria2 Settings')}
    >
      <MduiList>
        {/*
          A subheader rather than a heading: the page already has an <h1> naming the
          current group, and this list is the navigation *to* the others.
        */}
        <MduiListSubheader>{t('Aria2 Settings')}</MduiListSubheader>

        {OPTION_GROUP_ROUTES.map((group) => {
          const path = aria2SettingsRoute(group);
          const active = isActive(pathname, group);

          return (
            <MduiListItem
              key={group}
              href={`#!${path}`}
              active={active}
              aria-current={active ? 'page' : undefined}
              onClick={(event: Event) => {
                const mouse = event as MouseEvent;
                // Let the browser handle modified clicks so "open in new tab" works
                // on a hash url, exactly as the drawer rows do.
                if (mouse.defaultPrevented || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey) {
                  return;
                }
                event.preventDefault();
                navigate(path);
              }}
            >
              <MduiIcon name={ARIA2_GROUP_ICONS[group]} slot="icon" />
              <span>{t(ARIA2_GROUP_TITLE_KEYS[group])}</span>
            </MduiListItem>
          );
        })}
      </MduiList>
    </nav>
  );
}

export default Aria2GroupSwitcher;