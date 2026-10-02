/**
 * `/settings/aria2/:group` module tree.
 *
 * The router lazy-loads `Aria2SettingsPage`; the shell imports
 * {@link GlobalSpeedLimitDialog} from here for its footer quick-settings button.
 */

export { Aria2SettingsPage, default } from './Aria2SettingsPage';
export type { Aria2SettingsPageProps } from './Aria2SettingsPage';

export { OptionGroupView, requiresAria2Next } from './OptionGroupView';
export type { OptionGroupViewProps } from './OptionGroupView';

export { GlobalSpeedLimitDialog } from './GlobalSpeedLimitDialog';
export type { GlobalSpeedLimitDialogProps } from './GlobalSpeedLimitDialog';