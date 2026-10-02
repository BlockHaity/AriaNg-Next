/**
 * Public surface of the task detail view.
 *
 * ```
 * import TaskDetailPage from '@/pages/TaskDetailPage';       // the lazy route
 * import { getVisibleTabs } from '@/pages/task-detail';       // anything else
 * ```
 *
 * The route component itself lives in `src/pages/TaskDetailPage.tsx` because the
 * router lazy-loads exactly that path; everything it composes lives here so the
 * sub-components can be imported (and unit tested) without pulling the page in.
 *
 * `styles.css` is imported by the page, not by this barrel: importing the barrel
 * for a single helper must not pull a stylesheet into a consumer's chunk.
 */

/* ---- tabs ---- */
export { FilesTab, isFileSelectionActive, resetFileSelection, setFileSelectionActive, subscribeFileSelection } from './tabs/FilesTab';
export type { FilesTabProps } from './tabs/FilesTab';
export { MediaTab } from './tabs/MediaTab';
export type { MediaTabProps } from './tabs/MediaTab';
export { OptionsTab } from './tabs/OptionsTab';
export type { OptionsTabProps } from './tabs/OptionsTab';
export { OverviewTab } from './tabs/OverviewTab';
export type { OverviewTabProps } from './tabs/OverviewTab';
export { PeersTab } from './tabs/PeersTab';
export type { PeersTabProps } from './tabs/PeersTab';
export { PiecesTab } from './tabs/PiecesTab';
export type { PiecesTabProps } from './tabs/PiecesTab';

/* ---- tab visibility (pure) ---- */
export {
  adjacentTab,
  DEFAULT_DETAIL_TAB,
  getVisibleTabValues,
  getVisibleTabs,
  resolveTab,
  tabIndexOf,
  TAB_QUERY_PARAM,
} from './tabs/visibility';
export type { DetailTab, DetailTabValue, VisibleTabsInput } from './tabs/visibility';

/* ---- widgets ---- */
export { ChooseFilesToolbar, CATEGORY_BUTTONS } from './ChooseFilesToolbar';
export type { ChooseFilesToolbarProps } from './ChooseFilesToolbar';
export { CustomChooseFileDialog } from './CustomChooseFileDialog';
export type { CustomChooseFileDialogProps } from './CustomChooseFileDialog';
export { FileTree, FILE_INDENT_BASE, LEVEL_INDENT } from './FileTree';
export type { FileTreeProps } from './FileTree';
export { HealthMeter } from './HealthMeter';
export type { HealthMeterProps } from './HealthMeter';
export { formatTaskStatus, OverviewTable } from './OverviewTable';
export type { OverviewRow, OverviewTableProps } from './OverviewTable';
export { LEGACY_PIECE_BAR_COLOR, mergePieceRuns, PieceBar } from './PieceBar';
export type { PieceBarProps } from './PieceBar';
export {
  bitfieldFromRuns,
  CANVAS_RENDER_THRESHOLD,
  completedPieceColor,
  missingPieceColor,
  PieceMap,
  resolveTokenColor,
  useThemeVersion,
} from './PieceMap';
export type { PieceMapProps } from './PieceMap';
export { loadECharts, TaskSpeedChart } from './TaskSpeedChart';
export type { EChartsRuntime, TaskSpeedChartProps } from './TaskSpeedChart';