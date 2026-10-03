/**
 * RPC error normalisation.
 *
 * aria2, the JSON-RPC layer, the transport and the client itself all report
 * failures with different shapes (`{ code, message }`, `{ error: {...} }`, a
 * bare string, an `Error`). Everything funnels through `mapRpcError` so the UI
 * only ever deals with an `RpcError`.
 */

import type { RpcError } from './contract';
import { RPC_ERROR_UNAUTHORIZED } from '@/config/rpc-constants';
import { RPC_HTTP_UNREACHABLE } from './transport/types';

/** Used when a failure carries no usable message at all. */
export const UNKNOWN_RPC_ERROR_MESSAGE = 'Unknown RPC error';

/**
 * Raw RPC / transport error message -> i18n tip key.
 *
 * aria2 answers with English literals (`Unauthorized`, `Bad request`, ...),
 * so an exact match is the right lookup — no substring guessing.
 */
export const RPC_ERROR_HINTS: Record<string, string> = {
  [RPC_ERROR_UNAUTHORIZED]: 'rpc.error.unauthorized',
  'Cannot connect to aria2!': 'rpc.error.cannotConnect',
  [RPC_HTTP_UNREACHABLE]: 'rpc.error.httpUnreachable',
  'Bad request': 'rpc.error.badRequest',
  'JSON Parse Error': 'rpc.error.jsonParseError',
  'Secret token mismatch': 'rpc.error.secretTokenMismatch',
  'Method not found': 'rpc.error.methodNotFound',
  'Invalid GID': 'rpc.error.invalidGid',
  'No such file or directory': 'rpc.error.noSuchFile',
  'RPC profile changed': 'rpc.error.rpcProfileChanged',
};

/**
 * Connection / parsing failures. They never describe the caller's request, so
 * the UI answers them by retrying instead of by telling the user they did
 * something wrong.
 */
export const RPC_TRANSIENT_ERROR_MESSAGES: readonly string[] = [
  'Cannot connect to aria2!',
  // Transient in the sense that matters here: the poll that hit it should retry
  // quietly rather than raise a toast every few seconds. It is not *hidden* — the
  // connection state carries `lastError`, so the banner and the settings page show
  // it once with the tip attached.
  'Cannot reach aria2 over HTTP from this page!',
  'Bad request',
  'JSON Parse Error',
  'Secret token mismatch',
];

function asCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

interface ErrorParts {
  code?: number;
  message?: string;
}

/** Digs `{ code, message }` out of any of the shapes we may be handed. */
function extractErrorParts(raw: unknown): ErrorParts {
  if (raw === null || raw === undefined) {
    return {};
  }

  if (raw instanceof Error) {
    const withCode = raw as Error & { code?: unknown };
    return { code: asCode(withCode.code), message: asMessage(raw.message) };
  }

  if (typeof raw !== 'object') {
    return { message: asMessage(raw) };
  }

  const record = raw as Record<string, unknown>;

  // JSON-RPC wraps the failure: `{ error: { code, message } }`.
  const nested = record.error;
  if (nested !== undefined && nested !== null && nested !== record) {
    const inner = extractErrorParts(nested);
    return { code: inner.code ?? asCode(record.code), message: inner.message };
  }

  return {
    code: asCode(record.code),
    message: asMessage(record.message) ?? asMessage(record.faultString),
  };
}

/** Own-property lookup only: `constructor` must not resolve to `Object`. */
function findErrorHint(message: string): string | undefined {
  return Object.hasOwn(RPC_ERROR_HINTS, message) ? RPC_ERROR_HINTS[message] : undefined;
}

/** Coerces anything into an `RpcError`, attaching a tip key when we know one. */
export function mapRpcError(raw: unknown): RpcError {
  const { code, message } = extractErrorParts(raw);
  const finalMessage = message?.trim() ? (message as string) : UNKNOWN_RPC_ERROR_MESSAGE;
  const tipTextKey = findErrorHint(finalMessage) ?? findErrorHint(finalMessage.trim());
  return {
    ...(code === undefined ? {} : { code }),
    message: finalMessage,
    ...(tipTextKey === undefined ? {} : { tipTextKey }),
  };
}

/** AriaNg compares the message exactly — keep it that way. */
export function isUnauthorized(error: RpcError): boolean {
  return error.message === RPC_ERROR_UNAUTHORIZED;
}

/** True for failures worth retrying instead of reporting as a broken request. */
export function isTransientConnectionError(error: RpcError): boolean {
  return RPC_TRANSIENT_ERROR_MESSAGES.includes(error.message);
}

/** What to show for an error: the translated tip when we have one, else the raw message. */
export function describeError(error: RpcError): string {
  return error.tipTextKey ?? error.message;
}