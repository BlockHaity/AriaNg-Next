/**
 * Public surface of the debug page's internals.
 *
 * `DebugPage` itself lives one level up (`src/pages/DebugPage.tsx`) because the
 * router lazy-loads that exact path; everything it composes lives here so the
 * pieces stay independently testable.
 *
 * ```
 * import { LatestLogsTab, LogDetailDialog, RpcDebugTab, validateRpcForm } from '@/pages/debug';
 * ```
 */

export { default } from '../DebugPage';

export { LatestLogsTab } from './LatestLogsTab';
export type { LogOrder } from './LatestLogsTab';

export { LevelPill, LogDetailDialog, logLevelName } from './LogDetailDialog';
export type { LogDetailDialogProps } from './LogDetailDialog';

export { RpcDebugTab } from './RpcDebugTab';
export type { RpcDebugTabProps } from './RpcDebugTab';

export {
  AUTO_REFRESH_OPTIONS,
  buildInvokeContext,
  DEFAULT_AUTO_REFRESH_INTERVAL,
  DEFAULT_LOG_LEVEL_FILTER,
  LOG_LEVEL_OPTIONS,
  RPC_METHOD_ILLEGAL_KEY,
  RPC_METHOD_UNSUPPORTED_KEY,
  RPC_PARAMS_INVALID_KEY,
  validateRpcForm,
} from './rpc-form';
export type { RpcFormState, RpcFormValidation, RpcInvokeContext } from './rpc-form';