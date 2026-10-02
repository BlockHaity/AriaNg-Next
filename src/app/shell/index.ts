/**
 * The application shell barrel.
 *
 * Everything the shell renders around a page lives under `src/app/shell`, and
 * every other module imports it from here rather than from the individual files.
 */

export {
  AppShell,
  getCurrentRoutePath,
  MD_BREAKPOINT_PX,
  navigateInShell,
  setShellNavigate,
  useIsCompactLayout,
} from './AppShell';
export type { AppShellProps } from './AppShell';

export { ConnectionBanner } from './ConnectionBanner';
export { buildChartOption, CHART_HEIGHT, CHART_WIDTH, GlobalSpeedChart } from './GlobalSpeedChart';
export type { GlobalSpeedChartProps } from './GlobalSpeedChart';
export {
  ARIA2_SETTINGS_ITEMS,
  connectionTone,
  isNavItemActive,
  NAV_DOWNLOAD_ENTRIES,
  NAV_SETTINGS_ENTRIES,
  NavigationDrawer,
} from './NavigationDrawer';
export type { NavBadge, NavCollapse, NavCollapseItem, NavEntry, NavLink } from './NavigationDrawer';
export { NavigationRail } from './NavigationRail';
export { activateRpcProfile, RpcProfileSwitcher } from './RpcProfileSwitcher';
export { SnackbarHost } from './SnackbarHost';
export { StatusBar } from './StatusBar';
export { StorageBrokenOverlay } from './StorageBrokenOverlay';
export { ThemeSwitcher } from './ThemeSwitcher';
export { ARIANG_PROJECT_URL, DISPLAY_ORDERS, FOCUS_SEARCH_EVENT, TopToolbar } from './TopToolbar';