/**
 * `@/pages/new-task` — the pieces of the `/new` page.
 *
 * `src/pages/NewTaskPage.tsx` (the default-exported route component) owns the
 * state; everything here is either a pure helper or a presentational child, so
 * they can be reused (and tested) on their own.
 */

export { LinksTab, isCtrlEnterPressed } from './LinksTab';
export type { LinksTabProps } from './LinksTab';

export { TaskTypeTabs } from './TaskTypeTabs';
export type { NewTaskTab, TaskTypeTabsProps } from './TaskTypeTabs';

export {
  DEFAULT_OPTION_FILTERS,
  OPTION_FILTER_CATEGORIES,
  OptionFilters,
} from './OptionFilters';
export type { OptionFilterCategory, OptionFilterState, OptionFiltersProps } from './OptionFilters';

export { NewTaskOptionsTab } from './NewTaskOptionsTab';
export type { NewTaskOptionsTabProps } from './NewTaskOptionsTab';

export {
  ExportCommandApiDialog,
  buildNewTaskCommandUrl,
  buildNewTasksCommandUrl,
  buildRpcProfileCommandUrl,
  defaultExportBaseUrl,
} from './ExportCommandApiDialog';
export type {
  ExportCommandApiDialogProps,
  ExportCommandApiOptions,
  ExportableNewTask,
} from './ExportCommandApiDialog';

export {
  buildAddUriEntries,
  coerceOptionsForRpc,
  detectKindFromUrls,
  isAcceptedUri,
  isDraftValid,
  parsePrefillUrl,
  validateUrls,
} from './validation';
export type {
  NewTaskDraft,
  NewTaskFileDraft,
  NewTaskKind,
  UrlValidationResult,
} from './validation';