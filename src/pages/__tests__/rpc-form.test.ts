/**
 * Tests for the pure RPC-debug-form validation.
 *
 * These pin AriaNg's exact rules (`src/scripts/controllers/debug.js`):
 * the `prefix.method` shape check, the catalogue lookup, the JSON parse, and
 * the fact that `silent` / `callback` are internal flags that must never reach
 * the server.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTO_REFRESH_OPTIONS,
  buildInvokeContext,
  DEFAULT_AUTO_REFRESH_INTERVAL,
  DEFAULT_LOG_LEVEL_FILTER,
  LOG_LEVEL_OPTIONS,
  RPC_METHOD_ILLEGAL_KEY,
  RPC_METHOD_UNSUPPORTED_KEY,
  RPC_PARAMS_INVALID_KEY,
  validateRpcForm,
} from '../debug/rpc-form';
import { LogLevel } from '@/store/logs';

describe('validateRpcForm — the happy path', () => {
  it('accepts a catalogue method with an empty object and sends no parameters', () => {
    expect(validateRpcForm({ method: 'aria2.getVersion', paramsText: '{}' })).toEqual({
      ok: true,
      method: 'aria2.getVersion',
      params: [],
      silent: false,
    });
  });

  it('trims the method name before validating it', () => {
    expect(validateRpcForm({ method: '  aria2.tellStatus  ', paramsText: '{}' })).toEqual({
      ok: true,
      method: 'aria2.tellStatus',
      params: [],
      silent: false,
    });
  });

  it('turns the AriaNg named-argument object into positional arguments', () => {
    const result = validateRpcForm({ method: 'aria2.tellStatus', paramsText: '{"gid":"abc"}' });
    expect(result).toEqual({ ok: true, method: 'aria2.tellStatus', params: ['abc'], silent: false });
  });

  it('keeps a parameters array exactly as written', () => {
    expect(validateRpcForm({ method: 'aria2.tellActive', paramsText: '["gid","status"]' })).toEqual({
      ok: true,
      method: 'aria2.tellActive',
      params: ['gid', 'status'],
      silent: false,
    });
  });

  it('accepts system methods', () => {
    expect(validateRpcForm({ method: 'system.listMethods', paramsText: '{}' })).toEqual({
      ok: true,
      method: 'system.listMethods',
      params: [],
      silent: false,
    });
  });
});

describe('validateRpcForm — method rules', () => {
  it('rejects a bare method with no dot', () => {
    const result = validateRpcForm({ method: 'tellStatus', paramsText: '{}' });
    expect(result).toEqual({ ok: false, messageKey: RPC_METHOD_ILLEGAL_KEY });
    expect(RPC_METHOD_ILLEGAL_KEY).toBe('RPC method is illegal!');
  });

  it('rejects a name with more than one dot', () => {
    const result = validateRpcForm({ method: 'aria2.bittorrent.tellStatus', paramsText: '{}' });
    expect(result).toEqual({ ok: false, messageKey: RPC_METHOD_ILLEGAL_KEY });
  });

  it('rejects an empty half', () => {
    expect(validateRpcForm({ method: 'aria2.', paramsText: '{}' })).toEqual({
      ok: false,
      messageKey: RPC_METHOD_ILLEGAL_KEY,
    });
    expect(validateRpcForm({ method: '.tellStatus', paramsText: '{}' })).toEqual({
      ok: false,
      messageKey: RPC_METHOD_ILLEGAL_KEY,
    });
  });

  it('rejects a well-formed but unknown method with the unsupported message', () => {
    const result = validateRpcForm({ method: 'aria2.makeCoffee', paramsText: '{}' });
    expect(result).toEqual({ ok: false, messageKey: RPC_METHOD_UNSUPPORTED_KEY });
    expect(RPC_METHOD_UNSUPPORTED_KEY).toBe('AriaNg does not support this RPC method!');
  });

  it('reports the shape error before the unknown-method error', () => {
    // Both illegal *and* unsupported: AriaNg checked the dot first.
    expect(validateRpcForm({ method: 'makeCoffee', paramsText: '{}' })).toEqual({
      ok: false,
      messageKey: RPC_METHOD_ILLEGAL_KEY,
    });
  });
});

describe('validateRpcForm — parameters rules', () => {
  it('rejects unparseable JSON', () => {
    const result = validateRpcForm({ method: 'aria2.getVersion', paramsText: '{oops' });
    expect(result).toEqual({ ok: false, messageKey: RPC_PARAMS_INVALID_KEY });
    expect(RPC_PARAMS_INVALID_KEY).toBe('RPC request parameters are invalid!');
  });

  it('rejects an empty textarea', () => {
    expect(validateRpcForm({ method: 'aria2.getVersion', paramsText: '' })).toEqual({
      ok: false,
      messageKey: RPC_PARAMS_INVALID_KEY,
    });
  });

  it('rejects a scalar / null parameters value', () => {
    for (const paramsText of ['null', '42', '"gid"', 'true']) {
      expect(validateRpcForm({ method: 'aria2.getVersion', paramsText })).toEqual({
        ok: false,
        messageKey: RPC_PARAMS_INVALID_KEY,
      });
    }
  });

  it('validates the method before touching the parameters', () => {
    expect(validateRpcForm({ method: 'tellStatus', paramsText: '{oops' })).toEqual({
      ok: false,
      messageKey: RPC_METHOD_ILLEGAL_KEY,
    });
  });
});

describe('validateRpcForm — silent / callback are internal', () => {
  it('lifts `silent` out of the parameters and does not send it', () => {
    const result = validateRpcForm({ method: 'aria2.tellStatus', paramsText: '{"silent":true,"gid":"a"}' });
    expect(result).toEqual({ ok: true, method: 'aria2.tellStatus', params: ['a'], silent: true });
  });

  it('treats `{"silent":false}` as a not-silent call', () => {
    expect(validateRpcForm({ method: 'aria2.tellStatus', paramsText: '{"silent":false}' })).toEqual({
      ok: true,
      method: 'aria2.tellStatus',
      params: [],
      silent: false,
    });
  });

  it('drops `callback` entirely', () => {
    expect(validateRpcForm({ method: 'aria2.tellStatus', paramsText: '{"callback":"noop","gid":"a"}' })).toEqual({
      ok: true,
      method: 'aria2.tellStatus',
      params: ['a'],
      silent: false,
    });
  });

  it('reduces a parameters object holding only internal keys to `[]`', () => {
    expect(validateRpcForm({ method: 'aria2.getVersion', paramsText: '{"silent":true,"callback":"x"}' })).toEqual({
      ok: true,
      method: 'aria2.getVersion',
      params: [],
      silent: true,
    });
  });

  it('leaves a positional array untouched (the entries are arguments)', () => {
    expect(validateRpcForm({ method: 'aria2.tellStatus', paramsText: '["silent","gid"]' })).toEqual({
      ok: true,
      method: 'aria2.tellStatus',
      params: ['silent', 'gid'],
      silent: false,
    });
  });
});

describe('buildInvokeContext', () => {
  it('returns the sendable request for a valid form', () => {
    expect(buildInvokeContext({ method: 'aria2.tellStatus', paramsText: '{"gid":"a"}' })).toEqual({
      method: 'aria2.tellStatus',
      params: ['a'],
      silent: false,
    });
  });

  it('returns null when the form is not sendable', () => {
    expect(buildInvokeContext({ method: 'nope', paramsText: '{}' })).toBeNull();
    expect(buildInvokeContext({ method: 'aria2.getVersion', paramsText: '{' })).toBeNull();
  });
});

describe('option lists', () => {
  it('offers AriaNg\'s auto-refresh intervals, "Disabled" first', () => {
    expect(AUTO_REFRESH_OPTIONS.map((option) => option.value)).toEqual([0, 100, 200, 500, 1000, 2000]);
    expect(AUTO_REFRESH_OPTIONS[0].labelKey).toBe('Disabled');
    expect(
      AUTO_REFRESH_OPTIONS.filter((option) => option.value > 0 && option.value < 1000).map((option) => option.labelKey),
    ).toEqual([
      'format.time.milliseconds',
      'format.time.milliseconds',
      'format.time.milliseconds',
    ]);
    expect(AUTO_REFRESH_OPTIONS.filter((option) => option.value >= 1000).map((option) => option.labelKey)).toEqual([
      'format.time.seconds',
      'format.time.seconds',
    ]);
    expect(DEFAULT_AUTO_REFRESH_INTERVAL).toBe(1000);
    expect(AUTO_REFRESH_OPTIONS.some((option) => option.value === DEFAULT_AUTO_REFRESH_INTERVAL)).toBe(true);
  });

  it('offers the four log levels in ascending order', () => {
    expect(LOG_LEVEL_OPTIONS.map((option) => option.value)).toEqual([
      LogLevel.Debug,
      LogLevel.Info,
      LogLevel.Warn,
      LogLevel.Error,
    ]);
    expect(LOG_LEVEL_OPTIONS.map((option) => option.labelKey)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
    expect(DEFAULT_LOG_LEVEL_FILTER).toBe(LogLevel.Debug);
  });

  it('keeps the levels strictly ascending so `>=` minimum semantics work', () => {
    for (let i = 1; i < LOG_LEVEL_OPTIONS.length; i += 1) {
      expect(LOG_LEVEL_OPTIONS[i].value).toBeGreaterThan(LOG_LEVEL_OPTIONS[i - 1].value);
    }
  });
});