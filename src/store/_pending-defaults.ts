/**
 * TEMPORARY STAND-IN for `src/config/defaults.ts`.
 *
 * TODO: switch to `@/config/defaults` once available — every consumer in
 * `src/store/*` imports from this module and carries a
 * `// TODO: switch to @/config/defaults once available` marker.  Delete this
 * file (and flip the four import sites) as soon as the real module lands.
 *
 * The values below are the documented AriaNg defaults, copied from
 * `aria-ng-setting-service.js` / `aria-ng-constants.js` of the original
 * project.  Keep the export shape identical to the final module.
 */
import type {
  AriaNgSettings,
  RpcHttpMethod,
  RpcProfile,
  RpcProtocol,
} from '@/config/types';
import { DEFAULT_RPC_HOST, DEFAULT_RPC_PORT } from '@/config/rpc-constants';

/** All values AriaNg shipped with. `AriaNgSettings` has no other members. */
export const DEFAULT_SETTINGS: AriaNgSettings = {
  /* general */
  language: 'auto',
  theme: 'system',
  title: '',
  titleRefreshInterval: 500,
  browserNotification: true,
  browserNotificationSound: true,
  browserNotificationFrequency: 'middle',
  keyboardShortcuts: true,
  swipeGesture: true,
  dragAndDropTasks: true,
  rpcListDisplayOrder: 'rpcAlias',
  taskListIndependentDisplayOrder: false,
  afterCreatingNewTask: 'task-list',
  afterRetryingTask: 'task-list-downloading',
  removeOldTaskAfterRetrying: true,
  confirmTaskRemoval: true,
  includePrefixWhenCopyingFromTaskDetails: false,
  showPiecesInfoInTaskDetailPage: 'always',

  /* rpc */
  webSocketReconnectInterval: 3,
  globalStatRefreshInterval: 1000,
  downloadTaskRefreshInterval: 1000,
  rpcAlias: '',
  rpcHost: DEFAULT_RPC_HOST,
  rpcPort: DEFAULT_RPC_PORT,
  rpcInterface: '',
  protocol: 'http',
  httpMethod: 'POST',
  rpcRequestHeaders: '',
  secret: '',
  extendRpcServers: [],

  /* sorting */
  displayOrder: 'default:asc',
  waitingTaskListPageDisplayOrder: 'default:asc',
  stoppedTaskListPageDisplayOrder: 'default:asc',
  fileListDisplayOrder: 'default:asc',
  peerListDisplayOrder: 'default:asc',
};

/** Fresh, deeply independent copy of {@link DEFAULT_SETTINGS}. */
export function createDefaultSettings(): AriaNgSettings {
  return {
    ...DEFAULT_SETTINGS,
    extendRpcServers: DEFAULT_SETTINGS.extendRpcServers.map((p) => cloneRpcProfile(p)),
  };
}

const HEX = '0123456789abcdef';

/** AriaNg's `generateUuid()` — used for `extendRpcServers[].rpcId`. */
export function generateUuid(): string {
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
    const n = Math.floor(Math.random() * 16);
    out += HEX[n] ?? '0';
  }
  return out;
}

/** A brand new (blank) extended RPC server entry. */
export function createNewRpcProfile(): RpcProfile {
  return {
    rpcId: generateUuid(),
    isDefault: false,
    rpcAlias: '',
    rpcHost: '',
    rpcPort: '',
    rpcInterface: '',
    protocol: 'http',
    httpMethod: 'POST',
    rpcRequestHeaders: '',
    secret: '',
  };
}

/** Structural copy; `rpcId` / `isDefault` are preserved. */
export function cloneRpcProfile(profile: RpcProfile): RpcProfile {
  return {
    ...profile,
    isDefault: profile.isDefault === true,
  };
}

/** Label shown in the RPC list; empty when neither alias nor host is set. */
export function rpcProfileDisplayName(profile: RpcProfile): string {
  if (profile.rpcAlias) return profile.rpcAlias;
  if (profile.rpcHost) return profile.rpcHost;
  return '';
}

/** Human readable endpoint, used in the profile list and tooltips. */
export function rpcProfileUrl(profile: RpcProfile): string {
  const host = profile.rpcHost || DEFAULT_RPC_HOST;
  const port = profile.rpcPort;
  const iface = profile.rpcInterface.replace(/^\/+/, '');
  return `${profile.protocol}://${host}${port ? `:${port}` : ''}${iface ? `/${iface}` : ''}`;
}

export function isWebSocketProfile(profile: RpcProfile): boolean {
  return profile.protocol === 'ws' || profile.protocol === 'wss';
}

const PROFILE_FIELDS = [
  'rpcAlias',
  'rpcHost',
  'rpcPort',
  'rpcInterface',
  'protocol',
  'httpMethod',
  'rpcRequestHeaders',
  'secret',
] as const satisfies readonly (keyof RpcProfile)[];

/** Field-by-field comparison, ignoring `rpcId` / `isDefault`. */
export function rpcProfilesEqual(a: RpcProfile, b: RpcProfile): boolean {
  return PROFILE_FIELDS.every((f) => a[f] === b[f]);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** AriaNg's `naturalCompare` — "server 2" sorts before "server 10". */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a ?? '', b ?? '');
}

export const APP_CONSTANTS = {
  /** Namespace every persisted key lives in (`StorageKey.Options` = `AriaNg.Options`). */
  STORAGE_PREFIX: 'AriaNg',
  /** `document.cookie` lifetime, kept byte-compatible with AriaNg. */
  COOKIE_MAX_AGE: 365,
  /** Debounce for settings writes — never persist on every keystroke. */
  SETTINGS_PERSIST_DEBOUNCE_MS: 300,
  /** Label used when a profile has neither alias nor host. */
  DEFAULT_RPC_DISPLAY_NAME: 'Default',
} as const;

export const RPC_PROTOCOLS: readonly RpcProtocol[] = ['http', 'https', 'ws', 'wss'];
export const RPC_HTTP_METHODS: readonly RpcHttpMethod[] = ['POST', 'GET'];
