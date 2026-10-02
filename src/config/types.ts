/**
 * Shared configuration types: aria2 option metadata, RPC profiles and the
 * AriaNg application settings blob (1:1 with the original `Options` key).
 */

/** Which editor control an option row must render. */
export type OptionValueType =
  | 'string'
  | 'text'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'option'
  | 'readonly';

/** Where an option shows up in the settings navigation. */
export type OptionCategory = 'basic' | 'http-ftp-sftp' | 'http' | 'ftp-sftp' | 'bt' | 'ed2k' | 'media' | 'metalink' | 'rpc' | 'advanced' | 'file' | 'hook' | 'global' | 'bittorrent';

/** aria2-next compatibility marker for an option key. */
export type OptionSupport = 'current' | 'deprecated' | 'removed';

export interface Aria2OptionMeta {
  key: string;
  /** aria2 version that introduced the option (drives the "requires" tooltip). */
  since?: string;
  type: OptionValueType;
  category: OptionCategory;
  /** Default value as aria2 renders it. */
  defaultValue?: string;
  readonly?: boolean;
  required?: boolean;
  /** Unit suffix shown in an input-group addon (`Bytes`, `Seconds`, ...). */
  suffix?: 'Bytes' | 'Milliseconds' | 'Seconds' | 'Minutes' | 'Hours';
  /** Separator used by `text` options to split into items. */
  separator?: string;
  /** `append` renders the global value read-only above the input. */
  overrideMode?: 'override' | 'append';
  /** `array` splits the value by `separator` before submitting. */
  submitFormat?: 'string' | 'array';
  /** Show "(N items)" under the key label. */
  showCount?: boolean;
  /** Allowed values for `option` type. */
  options?: string[];
  min?: number;
  max?: number;
  /** Regex source used for client-side validation. */
  pattern?: string;
  /** aria2-next compatibility. */
  support?: OptionSupport;
  /** Free-form hint shown in the description popover. */
  aria2NextNote?: string;
}

/** Per-task option visibility rules (1:1 with `aria2TaskAvailableOptions`). */
export interface TaskOptionRule {
  key: string;
  category: 'global' | 'http' | 'bittorrent' | 'media';
  canShow?: TaskOptionContext | `${TaskOptionContext}`;
  canUpdate?: TaskOptionContext | `${TaskOptionContext}`;
  showHistory?: boolean;
}

export type TaskOptionContext = 'new' | 'active' | 'waiting' | 'paused';

export const OPTION_GROUP_ROUTES = [
  'basic',
  'http-ftp-sftp',
  'http',
  'ftp-sftp',
  'bt',
  'ed2k',
  'media',
  'metalink',
  'rpc',
  'advanced',
] as const;

export type OptionGroupRoute = (typeof OPTION_GROUP_ROUTES)[number];

/* ------------------------------------------------------------------ */
/* RPC profiles                                                        */
/* ------------------------------------------------------------------ */

export type RpcProtocol = 'http' | 'https' | 'ws' | 'wss';
export type RpcHttpMethod = 'POST' | 'GET';

export interface RpcProfile {
  /** Stable id for extended profiles; the default profile has none. */
  rpcId?: string;
  isDefault?: boolean;
  rpcAlias: string;
  rpcHost: string;
  rpcPort: string;
  rpcInterface: string;
  protocol: RpcProtocol;
  httpMethod: RpcHttpMethod;
  /** Raw `name: value` lines. */
  rpcRequestHeaders: string;
  /** base64 in storage, plain text at runtime. */
  secret: string;
}

/* ------------------------------------------------------------------ */
/* Application settings (mirrors AriaNg `Options`)                     */
/* ------------------------------------------------------------------ */

export type ThemeSetting = 'light' | 'dark' | 'system';
export type DisplayOrderType =
  | 'default'
  | 'name'
  | 'size'
  | 'percent'
  | 'remain'
  | 'dspeed'
  | 'uspeed';
export type DisplayOrder = `${DisplayOrderType}:asc` | `${DisplayOrderType}:desc`;

export type FileOrderType = 'default' | 'index' | 'name' | 'size' | 'percent' | 'selected';
export type FileOrderBy = `${FileOrderType}:asc` | `${FileOrderType}:desc`;

export type PeerOrderType = 'default' | 'address' | 'client' | 'percent' | 'dspeed' | 'uspeed';
export type PeerOrderBy = `${PeerOrderType}:asc` | `${PeerOrderType}:desc`;

export type LogOrderBy = 'time:asc' | 'time:desc';

export type PiecesInfoSetting = 'always' | 'le102400' | 'le10240' | 'le1024' | 'never';
export type NotificationFrequency = 'unlimited' | 'high' | 'middle' | 'low';
export type RpcListDisplayOrder = 'recentlyUsed' | 'rpcAlias';
export type AfterCreatingNewTask = 'task-list' | 'task-detail';
export type AfterRetryingTask = 'task-list-downloading' | 'task-detail' | 'current-page';
export type DebugAutoRefreshInterval = 0 | 100 | 200 | 500 | 1000 | 2000;

export interface AriaNgSettings {
  /* general */
  language: string;
  theme: ThemeSetting;
  title: string;
  titleRefreshInterval: number;
  browserNotification: boolean;
  browserNotificationSound: boolean;
  browserNotificationFrequency: NotificationFrequency;
  keyboardShortcuts: boolean;
  swipeGesture: boolean;
  dragAndDropTasks: boolean;
  rpcListDisplayOrder: RpcListDisplayOrder;
  taskListIndependentDisplayOrder: boolean;
  afterCreatingNewTask: AfterCreatingNewTask;
  afterRetryingTask: AfterRetryingTask;
  removeOldTaskAfterRetrying: boolean;
  confirmTaskRemoval: boolean;
  includePrefixWhenCopyingFromTaskDetails: boolean;
  showPiecesInfoInTaskDetailPage: PiecesInfoSetting;

  /* rpc */
  webSocketReconnectInterval: number;
  globalStatRefreshInterval: number;
  downloadTaskRefreshInterval: number;
  rpcAlias: string;
  rpcHost: string;
  rpcPort: string;
  rpcInterface: string;
  protocol: RpcProtocol;
  httpMethod: RpcHttpMethod;
  rpcRequestHeaders: string;
  secret: string;
  extendRpcServers: RpcProfile[];

  /* sorting */
  displayOrder: DisplayOrder;
  waitingTaskListPageDisplayOrder: DisplayOrder;
  stoppedTaskListPageDisplayOrder: DisplayOrder;
  fileListDisplayOrder: FileOrderBy;
  peerListDisplayOrder: PeerOrderBy;
}

export type SessionSettings = {
  /** Session-only flag, never persisted (mirrors AriaNg's `sessionSettings`). */
  debugMode: boolean;
};

/** Storage keys. Prefixed with `AriaNg.` exactly like the original. */
export const StorageKey = {
  Options: 'AriaNg.Options',
  Notifications: 'AriaNg.Notifications',
  LanguagePrefix: 'AriaNg.Language.',
  HistoryPrefix: 'AriaNg.History.',
} as const;

/** Per-option input history (newest first, capped). */
export const HISTORY_MAX_STORE_COUNT = 10;
