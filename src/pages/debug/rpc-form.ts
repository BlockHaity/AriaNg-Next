/**
 * Pure validation for the debug page's "Aria2 RPC Debug" form.
 *
 * Nothing here touches React, the DOM, a store or the network: given the two
 * text fields the user typed, {@link validateRpcForm} answers either
 * "you may send exactly this" or "here is the i18n key of what is wrong". That
 * is what makes AriaNg's three-step check — *method shape*, *method known*,
 * *parameters parse* — testable without a client.
 *
 * ## Ported rules (`src/scripts/controllers/debug.js`)
 *
 * 1. `executeAria2Method` bailed out with `RPC method is illegal!` unless the
 *    name contained a dot **and** split into exactly two halves.
 * 2. It then looked the bare method name up on `aria2RpcService`; a miss meant
 *    `AriaNg does not support this RPC method!`. Here the lookup is the
 *    catalogue (`parseRpcMethodInput`), which is the same registry the client
 *    expands names through — so the debug page and the wire format can never
 *    disagree about what exists.
 * 3. `angular.fromJson` wrapped in try/catch → `RPC request parameters are
 *    invalid!`.
 * 4. `silent` / `callback` were copied onto the *request context* and
 *    therefore **never** reached the server. AriaNg authored them by name, so a
 *    JSON payload could only carry a placeholder for them; they are still
 *    stripped here so a hand-written `{"silent": true}` behaves the way a user
 *    expects instead of becoming a positional argument.
 *
 * ## Shape of the parameters
 *
 * AriaNg's textarea held an *object* whose keys were named request-context
 * fields (`{"gid": "abc", "silent": true}`). The client contract instead takes
 * a positional `unknown[]`, so the object's values are sent in insertion order
 * and an empty object degrades to `[]` — which is what aria2 expects for a
 * zero-argument method. An array is passed through untouched, because there the
 * entries *are* the positional arguments.
 */

import { parseRpcMethodInput } from '@/rpc/catalog';
import { LogLevel } from '@/store/logs';

/* ------------------------------------------------------------------ */
/* message keys                                                         */
/* ------------------------------------------------------------------ */

/**
 * AriaNg's own strings are kept verbatim as the i18n keys: they are what
 * `en.ts` (and every shipped translation) already carries, so the debug page
 * stays localised for free. `AriaNg does not support this RPC method!` is the
 * fallback wording — there is no better key in the table today.
 */
export const RPC_METHOD_ILLEGAL_KEY = 'RPC method is illegal!';
export const RPC_METHOD_UNSUPPORTED_KEY = 'AriaNg does not support this RPC method!';
export const RPC_PARAMS_INVALID_KEY = 'RPC request parameters are invalid!';

/** Never sent to the server; they belong to AriaNg's request context. */
const INTERNAL_PARAM_KEYS = ['silent', 'callback'] as const;

/* ------------------------------------------------------------------ */
/* types                                                                */
/* ------------------------------------------------------------------ */

/** The two editable fields of the RPC debug form. */
export interface RpcFormState {
  /** e.g. `aria2.tellStatus` — what `system.listMethods` reports. */
  method: string;
  /** Raw JSON typed into the parameters textarea. */
  paramsText: string;
}

/** The ready-to-send request, with the internal flags already separated out. */
export interface RpcInvokeContext {
  /** Normalised, catalogue-validated method name. */
  method: string;
  /** Positional arguments; `[]` for a zero-argument method. */
  params: unknown[];
  /** Suppress the user-facing error toast for this call. */
  silent: boolean;
}

export type RpcFormValidation =
  | ({ ok: true } & RpcInvokeContext)
  | { ok: false; messageKey: string };

/* ------------------------------------------------------------------ */
/* validation                                                           */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies AriaNg's three checks and produces the exact `RpcRequestContext`
 * fields the client wants.
 *
 * The failure path is order-sensitive and must stay so: a malformed method is
 * reported before its unknownness, and the method is validated before the
 * parameters are parsed — exactly the order of AriaNg's `executeAria2Method`.
 */
export function validateRpcForm(state: RpcFormState): RpcFormValidation {
  const parsed = parseRpcMethodInput(state.method);
  if (!parsed.ok) {
    return {
      ok: false,
      messageKey:
        parsed.reason === 'illegal' ? RPC_METHOD_ILLEGAL_KEY : RPC_METHOD_UNSUPPORTED_KEY,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(state.paramsText);
  } catch {
    return { ok: false, messageKey: RPC_PARAMS_INVALID_KEY };
  }

  // Already positional — passed through verbatim, `silent` included, because in
  // an array every entry is an argument and AriaNg's `for..in` would have
  // treated `silent` as the argument at index `'silent'` (i.e. not a key at all).
  if (Array.isArray(raw)) {
    return { ok: true, method: parsed.name, params: raw, silent: false };
  }

  // AriaNg assigned the parsed value onto its context with `for (key in ...)`,
  // which silently ignored scalars and strings (`for..in` over a primitive
  // yields nothing). Answering "invalid" instead of sending nothing is the
  // only honest option — a typo must be visible.
  if (!isRecord(raw)) {
    return { ok: false, messageKey: RPC_PARAMS_INVALID_KEY };
  }

  let silent = false;
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if ((INTERNAL_PARAM_KEYS as readonly string[]).includes(key)) {
      if (key === 'silent') {
        // AriaNg let the truthiness of the value decide (`if (context.silent)`).
        silent = value === true;
      }
      continue;
    }
    params.push(value);
  }

  return { ok: true, method: parsed.name, params, silent };
}

/**
 * The validated request, or `null` when the form is not sendable.
 *
 * Used to drive the `Execute` button's disabled state without duplicating the
 * rules at the call site.
 */
export function buildInvokeContext(state: RpcFormState): RpcInvokeContext | null {
  const validation = validateRpcForm(state);
  if (!validation.ok) return null;
  return { method: validation.method, params: validation.params, silent: validation.silent };
}

/* ------------------------------------------------------------------ */
/* option lists                                                         */
/* ------------------------------------------------------------------ */

/**
 * The "Auto Refresh" intervals, exactly AriaNg's
 * `getTimeOptions([100, 200, 500, 1000, 2000], true)`.
 *
 * `0` is AriaNg's `withDisabled` entry. `labelKey` is the plural form
 * AriaNg's `timeDisplayName` filter resolves (`{{value}}` is filled in by
 * `formatTimeOption`, which also divides by 1000 for the second / minute
 * buckets).
 */
export const AUTO_REFRESH_OPTIONS = [
  { value: 0, labelKey: 'Disabled' },
  { value: 100, labelKey: 'format.time.milliseconds' },
  { value: 200, labelKey: 'format.time.milliseconds' },
  { value: 500, labelKey: 'format.time.milliseconds' },
  { value: 1000, labelKey: 'format.time.seconds' },
  { value: 2000, labelKey: 'format.time.seconds' },
] as const satisfies readonly { value: number; labelKey: string }[];

/** AriaNg's `logAutoRefreshInterval` initial value. */
export const DEFAULT_AUTO_REFRESH_INTERVAL = 1000;

/**
 * The "Log Level" dropdown entries.
 *
 * The filter is a **minimum** level: `filterLogsByLevel` keeps everything with
 * `level >= minimum`, which is AriaNg's `compareLogLevel(...) >= 0`.
 */
export const LOG_LEVEL_OPTIONS = [
  { value: LogLevel.Debug, labelKey: 'DEBUG' },
  { value: LogLevel.Info, labelKey: 'INFO' },
  { value: LogLevel.Warn, labelKey: 'WARN' },
  { value: LogLevel.Error, labelKey: 'ERROR' },
] as const satisfies readonly { value: number; labelKey: string }[];

/** AriaNg's `logLevelFilter` initial value. */
export const DEFAULT_LOG_LEVEL_FILTER = LogLevel.Debug;