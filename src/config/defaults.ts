/**
 * Application constants, the default settings blob and the RPC-profile helpers —
 * a port of AriaNg's `ariaNgConstants` / `ariaNgDefaultOptions`
 * (`src/scripts/config/constants.js`) plus the RPC-profile parts of
 * `ariaNgSettingService`.
 *
 * Every default below is byte-identical to AriaNg's, because the settings blob
 * is persisted under the same `AriaNg.Options` storage key and imported/exported
 * as-is.
 *
 * **Immutability**: `DEFAULT_SETTINGS`, `DEFAULT_SESSION_SETTINGS` and
 * `DEFAULT_RPC_PROFILE` are frozen. Use `createDefaultSettings()` /
 * `createNewRpcProfile()` whenever you need a mutable object.
 */

import type { AriaNgSettings, RpcProfile, SessionSettings } from './types';
import { HISTORY_MAX_STORE_COUNT } from './types';
import { DEFAULT_RPC_HOST, DEFAULT_RPC_INTERFACE, DEFAULT_RPC_PORT } from './rpc-constants';

/**
 * `ariaNgConstants`.
 *
 * The original also carried storage keys (`optionStorageKey`,
 * `languageStorageKeyPrefix`, …) and the stat cache capacities; those live in
 * `config/types.ts` (`StorageKey`) and are applied by the RPC layer.
 */
export const APP_CONSTANTS = {
  title: 'AriaNg',
  appPrefix: 'AriaNg',
  defaultLanguage: 'en',
  defaultHost: DEFAULT_RPC_HOST,
  defaultSecureProtocol: 'https',
  defaultPathSeparator: '/',
  httpRequestTimeout: 20000,
  lazySaveTimeout: 500,
  errorTooltipDelay: 500,
  notificationInPageTimeout: 2000,
  historyMaxStoreCount: HISTORY_MAX_STORE_COUNT,
  cachedDebugLogsLimit: 100,
} as const;

/** `ariaNgDefaultOptions`, field for field. */
export const DEFAULT_SETTINGS: AriaNgSettings = Object.freeze<AriaNgSettings>({
  /* general */
  language: APP_CONSTANTS.defaultLanguage,
  theme: 'light',
  title: '${downspeed}, ${upspeed} - ${title}',
  titleRefreshInterval: 5000,
  browserNotification: false,
  browserNotificationSound: true,
  browserNotificationFrequency: 'unlimited',
  keyboardShortcuts: true,
  swipeGesture: true,
  dragAndDropTasks: true,
  rpcListDisplayOrder: 'recentlyUsed',
  taskListIndependentDisplayOrder: false,
  afterCreatingNewTask: 'task-list',
  afterRetryingTask: 'task-list-downloading',
  removeOldTaskAfterRetrying: false,
  confirmTaskRemoval: true,
  includePrefixWhenCopyingFromTaskDetails: true,
  showPiecesInfoInTaskDetailPage: 'le10240',

  /* rpc */
  webSocketReconnectInterval: 5000,
  globalStatRefreshInterval: 1000,
  downloadTaskRefreshInterval: 1000,
  /**
   * Intentionally empty: AriaNg fills the host from `window.location.host` on
   * first visit (`initRpcSettingWithDefaultHostAndProtocol`), so persisting a
   * made-up default here would only add noise to the settings blob.
   */
  rpcAlias: '',
  rpcHost: '',
  rpcPort: DEFAULT_RPC_PORT,
  rpcInterface: DEFAULT_RPC_INTERFACE,
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
});

/** Never persisted — mirrors `sessionSettings` in `ariaNgSettingService`. */
export const DEFAULT_SESSION_SETTINGS: SessionSettings = Object.freeze<SessionSettings>({
  debugMode: false,
});

/**
 * The "default" RPC profile: AriaNg's top-level rpc fields with the page host
 * filled in (`getAllRpcSettings` clones the options and flags them as default).
 */
export const DEFAULT_RPC_PROFILE: RpcProfile = Object.freeze<RpcProfile>({
  isDefault: true,
  rpcAlias: DEFAULT_SETTINGS.rpcAlias,
  rpcHost: APP_CONSTANTS.defaultHost,
  rpcPort: DEFAULT_SETTINGS.rpcPort,
  rpcInterface: DEFAULT_SETTINGS.rpcInterface,
  protocol: DEFAULT_SETTINGS.protocol,
  httpMethod: DEFAULT_SETTINGS.httpMethod,
  rpcRequestHeaders: DEFAULT_SETTINGS.rpcRequestHeaders,
  secret: DEFAULT_SETTINGS.secret,
});

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

/**
 * A fresh, fully mutable copy of the defaults.
 *
 * Deep clone, so the caller can push into `extendRpcServers` without touching
 * the frozen constant.
 */
export function createDefaultSettings(): AriaNgSettings {
  return {
    ...DEFAULT_SETTINGS,
    extendRpcServers: DEFAULT_SETTINGS.extendRpcServers.map(cloneRpcProfile),
  };
}

/** A fresh copy of the session-only settings. */
export function createSessionSettings(): SessionSettings {
  return { ...DEFAULT_SESSION_SETTINGS };
}

/* ------------------------------------------------------------------ */
/* rpc profiles                                                        */
/* ------------------------------------------------------------------ */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * UTF-8 → base64.
 *
 * AriaNg's `generateUniqueId` hashed `appPrefix_timestamp_random` with angular's
 * `base64` service. There is no dependency here, and `btoa` only handles latin1,
 * so this is the minimal replacement. Only used to mint an id when
 * `crypto.randomUUID` is missing.
 */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let output = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    output += BASE64_ALPHABET[b0 >> 2];
    output += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    output += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    output += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }

  return output;
}

/**
 * Stable-ish id for an extended RPC profile.
 *
 * `crypto.randomUUID` when the browser offers it, otherwise AriaNg's
 * base64(prefix_seconds_random) recipe.
 */
export function generateRpcId(): string {
  const globalCrypto = typeof crypto === 'undefined' ? undefined : crypto;

  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }

  const sourceId = `${APP_CONSTANTS.appPrefix}_${Math.round(Date.now() / 1000)}_${Math.random()}`;
  return encodeBase64(sourceId);
}

/**
 * AriaNg's `createNewRpcSetting`: the default rpc fields, a fresh id, the page
 * host, and `https` when the page itself was served over https (browsers refuse
 * plaintext sub-resource requests from a secure page).
 */
export function createNewRpcProfile(host?: string, forceHttps?: boolean): RpcProfile {
  return {
    ...cloneRpcProfile(DEFAULT_RPC_PROFILE),
    isDefault: false,
    rpcId: generateRpcId(),
    rpcHost: host || APP_CONSTANTS.defaultHost,
    protocol: forceHttps ? APP_CONSTANTS.defaultSecureProtocol : DEFAULT_SETTINGS.protocol,
  };
}

/**
 * Structural copy of a profile.
 *
 * Unlike AriaNg's `cloneRpcSetting` (which dropped `rpcId` / `isDefault` because
 * it wrote the result back into the settings blob) this keeps the identity
 * fields, so it is safe to use for editing.
 */
export function cloneRpcProfile(profile: RpcProfile): RpcProfile {
  return { ...profile };
}

/** `getCurrentRpcDisplayName`: the alias when set, otherwise `host:port`. */
export function rpcProfileDisplayName(profile: RpcProfile): string {
  if (profile.rpcAlias) {
    return profile.rpcAlias;
  }

  return `${profile.rpcHost}:${profile.rpcPort}`;
}

/** `getCurrentRpcUrl`. */
export function rpcProfileUrl(profile: RpcProfile): string {
  return `${profile.protocol}://${profile.rpcHost}:${profile.rpcPort}/${profile.rpcInterface}`;
}

/** Whether the profile talks JSON-RPC over a WebSocket. */
export function isWebSocketProfile(profile: RpcProfile): boolean {
  return profile.protocol === 'ws' || profile.protocol === 'wss';
}

/**
 * Field-by-field equality over the eight settings-backed fields (everything
 * except `rpcId` / `isDefault`, i.e. exactly AriaNg's `cloneRpcSetting` shape).
 */
export function rpcProfilesEqual(a: RpcProfile, b: RpcProfile): boolean {
  return (
    a.rpcAlias === b.rpcAlias &&
    a.rpcHost === b.rpcHost &&
    a.rpcPort === b.rpcPort &&
    a.rpcInterface === b.rpcInterface &&
    a.protocol === b.protocol &&
    a.httpMethod === b.httpMethod &&
    a.rpcRequestHeaders === b.rpcRequestHeaders &&
    a.secret === b.secret
  );
}

/* ------------------------------------------------------------------ */
/* naturalCompare                                                      */
/* ------------------------------------------------------------------ */

/**
 * Port of the `natural-compare` npm package (v1.4.0, MIT, Lauri Rooden), which
 * AriaNg patched onto `String` and used to sort RPC profiles by alias
 * (`ariaNgSettingService`: `String.naturalCompare(rpc1.rpcAlias, rpc2.rpcAlias)`).
 *
 * The original remaps char codes into one ordered space — punctuation first,
 * then digits (`0`–`9` → 66–75), then `A`–`Z`, then `a`–`z` — and compares
 * **runs** of digits as numbers, which is why `item2` sorts before `item10`.
 *
 * Faithful quirks worth keeping:
 * - a digit run starting with `0` is *not* treated as a number, so `a01` < `a1`;
 * - uppercase sorts before lowercase (`A` → 76, `a` → 102);
 * - everything outside ASCII 45–127 keeps its raw code point.
 */
export function naturalCompare(a: string, b: string): number {
  const left = String(a);
  const right = String(b);

  let posA = 0;
  let posB = 0;
  let codeB = 1;

  // `codeB === 0` marks "right-hand string exhausted".
  while (codeB) {
    let codeA = charCode(left, posA++);
    codeB = charCode(right, posB++);

    // Both sides sit on a digit (`0` → 66 is excluded, so a run may not start
    // with `0`). The whole run is then compared as a single number — which is
    // exactly why `a1a` sorts *before* `a10`.
    if (codeA < 76 && codeB < 76 && codeA > 66 && codeB > 66) {
      const numberA = digitRun(left, posA);
      const numberB = digitRun(right, posB);
      posA = numberA.next;
      posB = numberB.next;
      codeA = numberA.value;
      codeB = numberB.value;
    }

    if (codeA !== codeB) {
      return codeA < codeB ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Character code folded into the ordering space.
 *
 * `NaN` (past the end of the string) becomes `0`, which is also what makes the
 * `while (codeB)` loop terminate.
 */
function charCode(str: string, pos: number): number {
  const code = str.charCodeAt(pos) || 0;

  if (code < 45 || code > 127) {
    return code;
  }
  if (code < 46) {
    return 65; // -
  }
  if (code < 48) {
    return code - 1; // . /
  }
  if (code < 58) {
    return code + 18; // 0-9
  }
  if (code < 65) {
    return code - 11; // : ;
  }
  if (code < 91) {
    return code + 11; // A-Z
  }
  if (code < 97) {
    return code - 37; // [ \ ] ^ _ `
  }
  if (code < 123) {
    return code + 5; // a-z
  }
  return code - 63; // { | } ~
}

/**
 * Consumes the rest of a digit run and returns it as a number.
 *
 * `pos` is the index right after the *first* digit (the caller already consumed
 * it), matching the original's `+str.slice(pos - 1, i)`.
 */
function digitRun(str: string, pos: number): { value: number; next: number } {
  let next = pos;

  while (next < str.length) {
    const code = charCode(str, next);
    if (code < 66 || code >= 76) {
      break;
    }
    next++;
  }

  return { value: Number.parseInt(str.slice(pos - 1, next), 10), next };
}