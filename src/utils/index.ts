/**
 * Utility barrel.
 *
 * ```
 * import { copyText, openFile, saveFileContent } from '@/utils';
 * ```
 *
 * Every module is side-effect free at import time (nothing touches
 * `window` / `document` / `localStorage` on load), so importing this barrel is
 * safe under node as well as in the browser — which is what lets the stores
 * import from it unconditionally.
 */
export {
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  generateUniqueId,
} from './base64';

export { copyText, copyToClipboard } from './clipboard';

export {
  FILE_FILTER_ANY,
  FILE_LOAD_FAILED,
  FILE_READER_UNSUPPORTED,
  FILE_TYPE_INVALID,
  isBlobSupported,
  isFileReaderSupported,
  matchesFileFilter,
  openFile,
  readFileAsBase64,
  readFileAsText,
  saveFileContent,
} from './files';
export type { OpenFileOptions, OpenedFile } from './files';

export {
  GLOBAL_SHORTCUT_DESCRIPTIONS,
  bindGlobalShortcuts,
  isBackspacePressed,
  isCtrlAPressed,
  isCtrlEnterPressed,
  isCtrlFPressed,
  isDeletePressed,
  isEditableTarget,
  isMacLike,
} from './keyboard';
export type {
  BindGlobalShortcutsOptions,
  GlobalShortcutHandlers,
} from './keyboard';

export { DEFAULT_SWIPE_THRESHOLD, bindSwipeGestures } from './swipe';
export type { BindSwipeGesturesOptions, SwipeHandlers } from './swipe';
