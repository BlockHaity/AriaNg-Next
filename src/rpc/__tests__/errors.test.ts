import { describe, expect, it } from 'vitest';
import {
  describeError,
  isTransientConnectionError,
  isUnauthorized,
  mapRpcError,
  RPC_ERROR_HINTS,
  RPC_TRANSIENT_ERROR_MESSAGES,
  UNKNOWN_RPC_ERROR_MESSAGE,
} from '../errors';
import type { RpcError } from '../contract';

describe('RPC_ERROR_HINTS', () => {
  it('maps the aria2 auth error', () => {
    expect(RPC_ERROR_HINTS.Unauthorized).toBe('rpc.error.unauthorized');
  });

  it('covers every well-known raw message', () => {
    for (const raw of [
      'Cannot connect to aria2!',
      'Bad request',
      'JSON Parse Error',
      'Secret token mismatch',
      'Method not found',
      'Invalid GID',
      'No such file or directory',
      'RPC profile changed',
    ]) {
      expect(RPC_ERROR_HINTS[raw]).toBeTypeOf('string');
      expect(RPC_ERROR_HINTS[raw].startsWith('rpc.error.')).toBe(true);
    }
  });
});

describe('mapRpcError', () => {
  it('coerces a plain string', () => {
    expect(mapRpcError('Unauthorized')).toEqual({
      message: 'Unauthorized',
      tipTextKey: 'rpc.error.unauthorized',
    });
  });

  it('leaves an unknown string alone', () => {
    expect(mapRpcError('something went wrong')).toEqual({ message: 'something went wrong' });
  });

  it('coerces { code, message }', () => {
    expect(mapRpcError({ code: -32601, message: 'Method not found' })).toEqual({
      code: -32601,
      message: 'Method not found',
      tipTextKey: 'rpc.error.methodNotFound',
    });
  });

  it('coerces the JSON-RPC { error: { code, message } } envelope', () => {
    expect(mapRpcError({ error: { code: 1, message: 'Invalid GID' } })).toEqual({
      code: 1,
      message: 'Invalid GID',
      tipTextKey: 'rpc.error.invalidGid',
    });
  });

  it('coerces a nested string error', () => {
    expect(mapRpcError({ error: 'Unauthorized' })).toEqual({
      message: 'Unauthorized',
      tipTextKey: 'rpc.error.unauthorized',
    });
  });

  it('keeps the outer code when the nested error has none', () => {
    expect(mapRpcError({ code: -32000, error: { message: 'Unauthorized' } })).toEqual({
      code: -32000,
      message: 'Unauthorized',
      tipTextKey: 'rpc.error.unauthorized',
    });
  });

  it('coerces an Error instance', () => {
    expect(mapRpcError(new TypeError('Cannot connect to aria2!'))).toEqual({
      message: 'Cannot connect to aria2!',
      tipTextKey: 'rpc.error.cannotConnect',
    });
  });

  it('keeps the numeric code of an Error instance', () => {
    const error = Object.assign(new Error('Bad request'), { code: -32700 });
    expect(mapRpcError(error)).toEqual({
      code: -32700,
      message: 'Bad request',
      tipTextKey: 'rpc.error.badRequest',
    });
  });

  it('falls back to a generic message for empty input', () => {
    expect(mapRpcError(undefined)).toEqual({ message: UNKNOWN_RPC_ERROR_MESSAGE });
    expect(mapRpcError(null)).toEqual({ message: UNKNOWN_RPC_ERROR_MESSAGE });
    expect(mapRpcError({})).toEqual({ message: UNKNOWN_RPC_ERROR_MESSAGE });
    expect(mapRpcError(new Error(''))).toEqual({ message: UNKNOWN_RPC_ERROR_MESSAGE });
    expect(mapRpcError({ message: '   ' })).toEqual({ message: UNKNOWN_RPC_ERROR_MESSAGE });
  });

  it('stringifies other primitives', () => {
    expect(mapRpcError(42)).toEqual({ message: '42' });
    expect(mapRpcError(true)).toEqual({ message: 'true' });
  });

  it('never invents a code', () => {
    expect(mapRpcError('Unauthorized')).not.toHaveProperty('code');
  });

  it('does not loop on a self referencing error envelope', () => {
    const record: Record<string, unknown> = { message: 'Unauthorized' };
    record.error = record;
    expect(mapRpcError(record)).toEqual({
      message: 'Unauthorized',
      tipTextKey: 'rpc.error.unauthorized',
    });
  });

  it('never resolves a hint through the object prototype', () => {
    expect(mapRpcError('constructor')).toEqual({ message: 'constructor' });
    expect(mapRpcError('toString')).toEqual({ message: 'toString' });
    expect(mapRpcError({ message: 'hasOwnProperty' })).toEqual({ message: 'hasOwnProperty' });
  });

  it('ignores a non-numeric code', () => {
    expect(mapRpcError({ code: 'ENOENT', message: 'No such file or directory' })).toEqual({
      message: 'No such file or directory',
      tipTextKey: 'rpc.error.noSuchFile',
    });
  });
});

describe('isUnauthorized', () => {
  it('matches the original message exactly', () => {
    expect(isUnauthorized({ message: 'Unauthorized' })).toBe(true);
    expect(isUnauthorized(mapRpcError({ code: 1, message: 'Unauthorized' }))).toBe(true);
  });

  it('does not match a different case or a padded message', () => {
    expect(isUnauthorized({ message: 'unauthorized' })).toBe(false);
    expect(isUnauthorized({ message: 'Unauthorized ' })).toBe(false);
    expect(isUnauthorized({ message: 'Authorization failed' })).toBe(false);
    expect(isUnauthorized({ message: UNKNOWN_RPC_ERROR_MESSAGE })).toBe(false);
  });
});

describe('isTransientConnectionError', () => {
  it('is true for the connect / parse family', () => {
    for (const raw of RPC_TRANSIENT_ERROR_MESSAGES) {
      expect(isTransientConnectionError({ message: raw })).toBe(true);
      expect(isTransientConnectionError(mapRpcError(raw))).toBe(true);
    }
  });

  it('is false for request-level failures', () => {
    for (const raw of ['Unauthorized', 'Invalid GID', 'Method not found', 'No such file or directory']) {
      expect(isTransientConnectionError({ message: raw })).toBe(false);
    }
  });
});

describe('describeError', () => {
  it('prefers the tip key', () => {
    expect(describeError(mapRpcError('Unauthorized'))).toBe('rpc.error.unauthorized');
  });

  it('falls back to the raw message', () => {
    expect(describeError({ message: 'boom' })).toBe('boom');
    expect(describeError({ code: 1, message: 'boom' })).toBe('boom');
  });

  it('accepts an error built by hand', () => {
    const error: RpcError = { message: 'Unauthorized', tipTextKey: 'rpc.error.unauthorized' };
    expect(describeError(error)).toBe('rpc.error.unauthorized');
  });
});