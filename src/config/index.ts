/**
 * `src/config` barrel.
 *
 * Re-exports the data modules that used to be angular constants in AriaNg:
 * file types, aria2 error descriptions, languages and the app defaults.
 *
 * `types.ts`, `rpc-constants.ts`, `aria2-options.ts` and `option-groups.ts` are
 * **not** re-exported here — import them directly. Re-exporting `types.ts` in
 * particular would drag `StorageKey` / `HISTORY_MAX_STORE_COUNT` into every
 * consumer of this barrel and, worse, make it ambiguous which module owns them.
 */

export {
  FILE_TYPE_CATEGORIES,
  FILE_TYPES,
  KNOWN_EXTENSION_COUNT,
  OTHER_FILE_TYPE,
  buildExtensionBuckets,
  classifyExtension,
  extensionsForCategory,
  isKnownExtension,
} from './file-types';
export type {
  ExtensionBucket,
  FileExtensionInput,
  FileTypeCategory,
  FileTypeDefinition,
  KnownFileTypeCategory,
} from './file-types';

export {
  ARIA2_ERRORS,
  HIDDEN_ERROR_CODES,
  KNOWN_ERROR_CODES,
  NO_ERROR_CODES,
  RESERVED_ERROR_CODES,
  getErrorDescriptionKey,
  isHiddenError,
} from './errors';
export type { Aria2ErrorMeta } from './errors';

export {
  DEFAULT_LANGUAGE_KEY,
  DEFAULT_LONG_DATE_PATTERN,
  LONG_DATE_PATTERNS,
  LANGUAGES,
  MDUI_LOCALE_FILES,
  detectBrowserLanguage,
  getLanguageByKey,
  getLongDatePattern,
  isMduiLocale,
  resolveLanguageByAlias,
  toMduiLocale,
} from './languages';

export {
  APP_CONSTANTS,
  DEFAULT_RPC_PROFILE,
  DEFAULT_SESSION_SETTINGS,
  DEFAULT_SETTINGS,
  cloneRpcProfile,
  createDefaultSettings,
  createNewRpcProfile,
  createSessionSettings,
  generateRpcId,
  isWebSocketProfile,
  naturalCompare,
  rpcProfileDisplayName,
  rpcProfileUrl,
  rpcProfilesEqual,
} from './defaults';