/**
 * Public surface of the mdui UI foundation.
 *
 * Import from `@/ui/mdui` (or `@/ui/mdui/index`) everywhere else in the app —
 * never reach into `./registry`, `./use-mdui` or `./icons` directly from a page.
 *
 * Typical bootstrap (owned by `src/main.tsx`):
 *
 * ```ts
 * import { registerMduiComponents } from '@/ui/mdui';
 * await registerMduiComponents();
 * createRoot(document.getElementById('root')!).render(<App />);
 * ```
 */

/* Registration ------------------------------------------------------------ */
export { MDUI_COMPONENTS, hasMduiComponent, registerMduiComponents } from './registry';

/* React ↔ Web Components bridge ------------------------------------------- */
export { shallowEqual, useMduiDefined, useMduiEvent, useMduiEvents, useMduiImperative, useMduiModel, useMduiProperty } from './use-mdui';
export type { MduiEventDetail, MduiEventHandler } from './use-mdui';

/* Icons ------------------------------------------------------------------- */
export { ICON_TAGS, hasIcon, icon } from './icons';
export type { IconName } from './icons';

/* Components -------------------------------------------------------------- */
export {
  MduiAvatar,
  MduiBadge,
  MduiButton,
  MduiCard,
  MduiCheckbox,
  MduiChip,
  MduiCollapse,
  MduiCollapseItem,
  MduiDivider,
  MduiFab,
  MduiIcon,
  MduiIconButton,
  MduiLayout,
  MduiLayoutItem,
  MduiLayoutMain,
  MduiList,
  MduiListItem,
  MduiListSubheader,
  MduiMenu,
  MduiNavigationBar,
  MduiNavigationBarItem,
  MduiNavigationDrawer,
  MduiNavigationRail,
  MduiNavigationRailItem,
  MduiProgressBar,
  MduiRadio,
  MduiRadioGroup,
  MduiSegmentedButton,
  MduiSelect,
  MduiSlider,
  MduiSwitch,
  MduiTab,
  MduiTabPanel,
  MduiTabs,
  MduiTextField,
  MduiTextarea,
  MduiTooltip,
  MduiTopAppBar,
} from './components';

export type {
  MduiAvatarProps,
  MduiBadgeProps,
  MduiButtonProps,
  MduiCardProps,
  MduiCheckboxProps,
  MduiChipProps,
  MduiCollapseItemProps,
  MduiCollapseProps,
  MduiDividerProps,
  MduiFabProps,
  MduiIconButtonProps,
  MduiIconProps,
  MduiListItemProps,
  MduiListProps,
  MduiMenuItemProps,
  MduiMenuProps,
  MduiProgressBarProps,
  MduiRadioGroupProps,
  MduiSegmentedButtonProps,
  MduiSegmentedItem,
  MduiSelectItem,
  MduiSelectProps,
  MduiSliderProps,
  MduiSwitchProps,
  MduiTabPanelProps,
  MduiTabProps,
  MduiTabsProps,
  MduiTextareaProps,
  MduiTextFieldProps,
  MduiTooltipProps,
  MduiTopAppBarProps,
  MduiTone,
  MduiTarget,
  Styleable,
} from './components';

/* Overlays ---------------------------------------------------------------- */
export { MduiBanner, MduiDialog, MduiDropdown, MduiMenuItem, MduiSnackbar } from './overlays';
export type { MduiBannerProps, MduiDialogProps, MduiSnackbarProps } from './overlays';

/* Promise-based dialogs --------------------------------------------------- */
export {
  alertDialog,
  confirmDialog,
  promptDialog,
  registerDialogTypes,
  snackbarMessage,
} from './dialogs';
export type {
  AlertOptions,
  ConfirmOptions,
  PromptOptions,
  SnackbarMessageOptions,
} from './dialogs';

/* Theme ------------------------------------------------------------------- */
export {
  M3_SEED_COLORS,
  THEME_CHANGE_EVENT,
  currentColorScheme,
  getColorSchemeFromImage,
  getTheme,
  nextThemeSetting,
  notifyThemeChange,
  onThemeChange,
  prefersDark,
  removeColorScheme,
  resolveTheme,
  setColorScheme,
  setTheme,
} from './theme';
export type { ResolvedTheme, ThemeChangeDetail, ThemeSetting } from './theme';