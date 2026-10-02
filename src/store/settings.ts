/**
 * The AriaNg settings store.
 *
 * Mirrors `ariaNgSettingService`: one `AriaNg.Options` blob in storage that is
 * merged over `DEFAULT_SETTINGS` on boot, lazily back-filled (AriaNg's
 * migration behaviour) and re-persisted whenever a key was added by a newer
 * version.
 *
 * Key rules:
 * - `secret` is **base64 in storage, plain text at runtime**. Every write path
 *   encodes, every read path decodes (`encodeSecret` / `decodeSecret`).
 * - Persistence is debounced (300 ms) and always writes the whole blob —
 *   AriaNg never wrote on every keystroke.
 * - No cross-tab sync (see `storage.ts`).
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type {
  AriaNgSettings,
  DisplayOrder,
  RpcHttpMethod,
  RpcProfile,
  RpcProtocol,
  SessionSettings,
} from '@/config/types';
import { StorageKey } from '@/config/types';
// TODO: switch to @/config/defaults once available
import {
  DEFAULT_SETTINGS,
  createDefaultSettings,
  createNewRpcProfile,
  RPC_HTTP_METHODS,
  RPC_PROTOCOLS,
} from './_pending-defaults';
import { storageGet, storageIsAvailable, storageSet } from './storage';

/** Debounce for the read-modify-write against `AriaNg.Options`. */
const PERSIST_DEBOUNCE_MS = 300;

const FALLBACK_RPC_HOST = 'localhost';
const FALLBACK_DISPLAY_ORDER = 'default:asc';
/** Label used when a profile has neither alias nor host. */
export const DEFAULT_RPC_DISPLAY_NAME = 'Default';
const INVALID_SETTINGS_MESSAGE = 'Invalid settings data format!';

const DISPLAY_ORDER_RE = /^[a-z_]+:(asc|desc)$/i;

/**
 * Legacy language keys AriaNg accepted, mapped onto the modern ones.
 * TODO: the canonical registry lives in `@/i18n` (written in parallel) — swap
 * `repairLanguage` for that registry once it lands.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  zh: 'zh_Hans',
  zh_CN: 'zh_Hans',
  zh_SG: 'zh_Hans',
  zh_TW: 'zh_Hant',
  zh_HK: 'zh_Hant',
  zh_MO: 'zh_Hant',
};

/** Structurally valid locale key, e.g. `en`, `pt_BR`, `zh_Hans`. */
const LANGUAGE_KEY_RE = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$/;

/* ------------------------------------------------------------------ */
/* environment helpers                                                 */
/* ------------------------------------------------------------------ */

function pageHostname(): string {
  if (typeof window === 'undefined' || !window.location) return FALLBACK_RPC_HOST;
  return window.location.hostname || FALLBACK_RPC_HOST;
}

/** AriaNg forced `https` on https pages so insecure protocols are never used. */
function pageIsHttps(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return window.location.protocol === 'https:';
}

/* ------------------------------------------------------------------ */
/* secret codec                                                        */
/* ------------------------------------------------------------------ */

/** Runtime (plain text) -> storage (base64). */
export function encodeSecret(plain: string): string {
  if (!plain) return '';
  try {
    const bytes = new TextEncoder().encode(plain);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } catch {
    return '';
  }
}

/**
 * Storage (base64) -> runtime (plain text).
 *
 * AriaNg's `angular-base64` silently returned the input when decoding failed,
 * so a hand-edited plain-text secret keeps working instead of turning into
 * an empty string.
 */
export function decodeSecret(encoded: string): string {
  if (!encoded) return '';
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return encoded;
  }
}

/** AriaNg coerced ports with `Math.max(parseInt(v) || 0, 0)`. */
export function normalizeRpcPort(value: unknown): string {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return String(Math.max(Number.isNaN(parsed) ? 0 : parsed, 0));
}

function normalizeDisplayOrder(value: unknown): DisplayOrder | null {
  return typeof value === 'string' && DISPLAY_ORDER_RE.test(value.trim())
    ? (value.trim() as DisplayOrder)
    : null;
}

/* ------------------------------------------------------------------ */
/* profile / settings normalisation                                    */
/* ------------------------------------------------------------------ */

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asProtocol(value: unknown): RpcProtocol {
  return RPC_PROTOCOLS.includes(value as RpcProtocol)
    ? (value as RpcProtocol)
    : DEFAULT_SETTINGS.protocol;
}

function asHttpMethod(value: unknown): RpcHttpMethod {
  return RPC_HTTP_METHODS.includes(value as RpcHttpMethod)
    ? (value as RpcHttpMethod)
    : DEFAULT_SETTINGS.httpMethod;
}

/**
 * Rebuilds an `extendRpcServers` entry field by field into a **fresh**
 * profile: unknown fields, prototypes and `isDefault` never survive.
 */
export function sanitizeRpcProfile(raw: unknown): RpcProfile | null {
  if (!isRecord(raw)) return null;
  const fresh = createNewRpcProfile();
  return {
    rpcId: asString(raw.rpcId) || fresh.rpcId,
    isDefault: false,
    rpcAlias: asString(raw.rpcAlias),
    rpcHost: asString(raw.rpcHost),
    rpcPort: normalizeRpcPort(raw.rpcPort),
    rpcInterface: asString(raw.rpcInterface),
    protocol: asProtocol(raw.protocol),
    httpMethod: asHttpMethod(raw.httpMethod),
    rpcRequestHeaders: asString(raw.rpcRequestHeaders),
    // Stored base64 -> runtime plain text.
    secret: decodeSecret(asString(raw.secret)),
  };
}

function repairLanguage(value: unknown): { value: string; changed: boolean } {
  const fallback = typeof DEFAULT_SETTINGS.language === 'string' ? DEFAULT_SETTINGS.language : 'auto';
  if (typeof value !== 'string') return { value: fallback, changed: true };
  const raw = value.trim();
  if (!raw || raw.toLowerCase() === 'auto') {
    return { value: fallback, changed: raw !== fallback };
  }
  const normalized = LANGUAGE_ALIASES[raw] ?? raw;
  if (!LANGUAGE_KEY_RE.test(normalized)) return { value: fallback, changed: true };
  return { value: normalized, changed: normalized !== value };
}

/** in-memory (plain secret) -> storage shape (base64 secret). */
function encodeSettings(settings: AriaNgSettings): AriaNgSettings {
  const merged: AriaNgSettings = { ...DEFAULT_SETTINGS, ...settings };
  return {
    ...merged,
    secret: encodeSecret(merged.secret),
    extendRpcServers: merged.extendRpcServers.map((profile) => ({
      ...profile,
      secret: encodeSecret(profile.secret),
    })),
  };
}

function coerceSetting<K extends keyof AriaNgSettings>(key: K, value: unknown): AriaNgSettings[K] {
  if (key === 'secret') {
    return decodeSecret(asString(value)) as AriaNgSettings[K];
  }
  if (key === 'extendRpcServers') {
    const list = Array.isArray(value) ? value : [];
    return list
      .map((entry) => sanitizeRpcProfile(entry))
      .filter((entry): entry is RpcProfile => entry !== null) as AriaNgSettings[K];
  }
  return value as AriaNgSettings[K];
}

/**
 * Pristine defaults with the boot-time repairs applied: a usable `rpcHost`
 * and a protocol that is never insecure on an https page.
 */
function bootstrapDefaults(): AriaNgSettings {
  const next = createDefaultSettings();
  next.language = repairLanguage(next.language).value;
  if (!next.rpcHost.trim()) next.rpcHost = pageHostname();
  if (pageIsHttps()) next.protocol = 'https';
  return next;
}

/**
 * Stored blob over defaults. `changed` is true whenever a key had to be
 * back-filled, dropped or repaired — the caller re-persists in that case so
 * the migration is durable (AriaNg did the same).
 */
function mergeStored(stored: Record<string, unknown>): { settings: AriaNgSettings; changed: boolean } {
  const next = createDefaultSettings();
  let changed = false;

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AriaNgSettings)[]) {
    if (!Object.prototype.hasOwnProperty.call(stored, key)) {
      // Lazily back-fill: keep the default, mark the blob as stale.
      changed = true;
      continue;
    }
    const value = stored[key];
    if (value === undefined) {
      changed = true;
      continue;
    }
    (next as unknown as Record<string, unknown>)[key] = coerceSetting(key, value);
  }

  const language = repairLanguage(next.language);
  if (language.changed) {
    next.language = language.value;
    changed = true;
  }
  if (!next.rpcHost.trim()) {
    next.rpcHost = pageHostname();
    changed = true;
  }
  if (pageIsHttps() && next.protocol !== 'https') {
    next.protocol = 'https';
    changed = true;
  }

  return { settings: next, changed };
}

/* ------------------------------------------------------------------ */
/* persistence (debounced read-modify-write)                           */
/* ------------------------------------------------------------------ */

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSettings: AriaNgSettings | null = null;

function writeNow(settings: AriaNgSettings): void {
  if (useSettingsStore.getState().storageBroken) return;
  storageSet(StorageKey.Options, encodeSettings(settings));
}

function schedulePersist(): void {
  if (useSettingsStore.getState().storageBroken) return;
  pendingSettings = useSettingsStore.getState().settings;
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot = pendingSettings;
    pendingSettings = null;
    if (snapshot) writeNow(snapshot);
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Writes any pending debounced change immediately. Call it on `pagehide` /
 * before navigating away, and in tests.
 */
export function flushSettingsPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const snapshot = pendingSettings;
  pendingSettings = null;
  if (snapshot) writeNow(snapshot);
}

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

export interface SettingsState {
  settings: AriaNgSettings;
  session: SessionSettings;
  /** true until the first read from storage completes. */
  hydrated: boolean;
  /** true when neither localStorage nor cookies work — the app must go read-only. */
  storageBroken: boolean;
  firstVisit: boolean;

  hydrate(): void;
  get<K extends keyof AriaNgSettings>(key: K): AriaNgSettings[K];
  set<K extends keyof AriaNgSettings>(key: K, value: AriaNgSettings[K]): void;
  update(patch: Partial<AriaNgSettings>): void;
  reset(): void;
  setSessionDebugMode(enabled: boolean): void;

  exportAll(): string;
  importAll(json: string): { ok: true } | { ok: false; error: string };
  resolveDisplayOrder(page: 'downloading' | 'waiting' | 'stopped'): string;
  setDisplayOrder(page: 'downloading' | 'waiting' | 'stopped', value: string): void;
}

export const useSettingsStore: UseBoundStore<StoreApi<SettingsState>> =
  create<SettingsState>()((commit, get) => ({
    settings: createDefaultSettings(),
    session: { debugMode: false },
    hydrated: false,
    storageBroken: !storageIsAvailable(),
    firstVisit: false,

    hydrate() {
      // Idempotent: React StrictMode mounts effects twice.
      if (get().hydrated) return;

      const raw = storageGet<unknown>(StorageKey.Options, null);
      const stored = isRecord(raw) ? raw : null;
      const { settings, changed } = stored ? mergeStored(stored) : {
        settings: bootstrapDefaults(),
        changed: true,
      };

      commit({
        settings,
        hydrated: true,
        firstVisit: stored === null,
        storageBroken: !storageIsAvailable(),
      });

      // Back-fill / repair must reach storage, otherwise it repeats on every
      // boot. Written synchronously: this is a migration, not a user edit.
      if (changed) writeNow(settings);
    },

    get(key) {
      return get().settings[key];
    },

    set(key, value) {
      const current = get().settings;
      if (Object.is(current[key], value)) return;
      commit({ settings: { ...current, [key]: value } });
      schedulePersist();
    },

    update(patch) {
      const current = get().settings;
      const next: AriaNgSettings = { ...current };
      let dirty = false;
      for (const key of Object.keys(patch) as (keyof AriaNgSettings)[]) {
        const value = patch[key];
        if (value === undefined || Object.is(next[key], value)) continue;
        // Secret values arrive as plain text and are encoded on write.
        (next as unknown as Record<string, unknown>)[key] = value;
        dirty = true;
      }
      if (!dirty) return;
      commit({ settings: next });
      schedulePersist();
    },

    reset() {
      const next = bootstrapDefaults();
      // `firstVisit` is intentionally preserved: a reset rewrites the options
      // blob, it does not wipe localStorage.
      commit({ settings: next });
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
        pendingSettings = null;
      }
      writeNow(next);
    },

    setSessionDebugMode(enabled) {
      // Session settings are never persisted (AriaNg's `sessionSettings`).
      commit({ session: { ...get().session, debugMode: enabled === true } });
    },

    exportAll() {
      // Portable blob: complete (defaults merged in) and pretty printed, with
      // secrets still base64 exactly like AriaNg's export.
      return JSON.stringify(encodeSettings(get().settings), null, 2);
    },

    importAll(json) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { ok: false, error: INVALID_SETTINGS_MESSAGE };
      }
      if (!isRecord(parsed)) {
        return { ok: false, error: INVALID_SETTINGS_MESSAGE };
      }

      const next = createDefaultSettings();
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AriaNgSettings)[]) {
        const fallback = DEFAULT_SETTINGS[key];
        // Only scalars are copied wholesale. `extendRpcServers` is an array and
        // is therefore skipped here — it is rebuilt field by field below, so a
        // hostile blob cannot smuggle an object into a scalar slot.
        if (fallback === null || typeof fallback === 'object') continue;
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
        const value = parsed[key];
        if (value === null || value === undefined) continue;
        if (typeof value !== typeof fallback) continue;
        if (key === 'secret') {
          next.secret = decodeSecret(value as string);
          continue;
        }
        (next as unknown as Record<string, unknown>)[key] = value;
      }

      const servers = Array.isArray(parsed.extendRpcServers) ? parsed.extendRpcServers : [];
      next.extendRpcServers = servers
        .map((entry) => sanitizeRpcProfile(entry))
        .filter((entry): entry is RpcProfile => entry !== null);

      next.language = repairLanguage(next.language).value;
      if (!next.rpcHost.trim()) next.rpcHost = pageHostname();
      if (pageIsHttps()) next.protocol = 'https';

      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
        pendingSettings = null;
      }
      commit({ settings: next, firstVisit: false });
      writeNow(next);
      return { ok: true };
    },

    resolveDisplayOrder(page) {
      const current = get().settings;
      if (current.taskListIndependentDisplayOrder) {
        const pageKey =
          page === 'waiting'
            ? ('waitingTaskListPageDisplayOrder' as const)
            : page === 'stopped'
              ? ('stoppedTaskListPageDisplayOrder' as const)
              : null;
        if (pageKey) {
          const independent = normalizeDisplayOrder(current[pageKey]);
          if (independent) return independent;
        }
      }
      return normalizeDisplayOrder(current.displayOrder) ?? FALLBACK_DISPLAY_ORDER;
    },

    setDisplayOrder(page, value) {
      const order = normalizeDisplayOrder(value) ?? (FALLBACK_DISPLAY_ORDER as DisplayOrder);
      const current = get().settings;
      if (page !== 'downloading' && current.taskListIndependentDisplayOrder) {
        const pageKey =
          page === 'waiting'
            ? ('waitingTaskListPageDisplayOrder' as const)
            : ('stoppedTaskListPageDisplayOrder' as const);
        get().set(pageKey, order);
        return;
      }
      get().set('displayOrder', order);
    },
  }));
