import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONSTANTS, DEFAULT_SETTINGS } from '@/config/defaults';
import type { RpcProfile } from '@/config/types';
import {
  ALL_PLACEHOLDERS_TEMPLATE,
  DEFAULT_TITLE_TEMPLATE,
  TITLE_PLACEHOLDERS,
  applyTitle,
  getFinalTitle,
  startTitleUpdater,
} from '@/store/title';
import type { TitleContext, TitleFormatter } from '@/store/title';

/**
 * Stand-in for `i18n.t`: the five label keys become short bracketed tags so a
 * test can tell which key the module asked for, everything else (numbers, the
 * app title, an RPC alias) is passed through untouched — which is exactly what
 * AriaNg's `translate` filter did for an unknown key.
 */
const LABELS: Record<string, string> = {
  Downloading: '<dn>',
  Waiting: '<wt>',
  'Finished / Stopped': '<fs>',
  Download: '<dl>',
  Upload: '<ul>',
};

const format: TitleFormatter = (value) => LABELS[value] ?? value;

const profile: RpcProfile = {
  isDefault: false,
  rpcAlias: '',
  rpcHost: '192.168.1.10',
  rpcPort: '6800',
  rpcInterface: 'jsonrpc',
  protocol: 'ws',
  httpMethod: 'POST',
  rpcRequestHeaders: '',
  secret: '',
};

const stat = {
  downloadSpeed: 1000,
  numActive: 3,
  numWaiting: 2,
  numStopped: 5,
  uploadSpeed: 400,
};

const context: TitleContext = { globalStat: stat, currentRpcProfile: profile };

describe('getFinalTitle', () => {
  it('exports AriaNg placeholder list in order', () => {
    expect(TITLE_PLACEHOLDERS).toEqual([
      'title',
      'rpcprofile',
      'downloading',
      'waiting',
      'stopped',
      'downspeed',
      'upspeed',
    ]);
    expect(ALL_PLACEHOLDERS_TEMPLATE).toBe(
      '${title} ${rpcprofile} ${downloading} ${waiting} ${stopped} ${downspeed} ${upspeed}',
    );
  });

  it('renders every placeholder', () => {
    expect(getFinalTitle(ALL_PLACEHOLDERS_TEMPLATE, context, format)).toBe(
      'AriaNg 192.168.1.10:6800 <dn> 3 <wt> 2 <fs> 5 <dl> 1000/s <ul> 400/s',
    );
  });

  it('renders ${title} as the application title', () => {
    expect(getFinalTitle('${title}', context, format)).toBe(APP_CONSTANTS.title);
  });

  it('renders ${rpcprofile} as alias-or-host:port', () => {
    expect(getFinalTitle('${rpcprofile}', context, format)).toBe('192.168.1.10:6800');
    expect(
      getFinalTitle('${rpcprofile}', { currentRpcProfile: { ...profile, rpcAlias: 'nas' } }, format),
    ).toBe('nas');
    // No profile yet -> nothing at all, not the word "undefined".
    expect(getFinalTitle('[${rpcprofile}]', {}, format)).toBe('[]');
  });

  it('renders the three counters with their label', () => {
    expect(getFinalTitle('${downloading}', context, format)).toBe('<dn> 3');
    expect(getFinalTitle('${waiting}', context, format)).toBe('<wt> 2');
    expect(getFinalTitle('${stopped}', context, format)).toBe('<fs> 5');
  });

  it('renders the two speeds with a /s suffix', () => {
    expect(getFinalTitle('${downspeed}', context, format)).toBe('<dl> 1000/s');
    expect(getFinalTitle('${upspeed}', context, format)).toBe('<ul> 400/s');
  });

  it('renders the default template as "<dl>, <ul> - AriaNg" without a stat', () => {
    // No `globalStat` yet: the labels are still localised, the numbers are
    // simply absent.
    expect(getFinalTitle(DEFAULT_TITLE_TEMPLATE, {}, format)).toBe('<dl>, <ul> - AriaNg');
    expect(DEFAULT_TITLE_TEMPLATE).toBe('${downspeed}, ${upspeed} - ${title}');
    expect(DEFAULT_SETTINGS.title).toBe(DEFAULT_TITLE_TEMPLATE);
  });

  it('renders the default template with a stat', () => {
    expect(getFinalTitle(DEFAULT_TITLE_TEMPLATE, context, format)).toBe(
      '<dl> 1000/s, <ul> 400/s - AriaNg',
    );
  });
});

describe('tags', () => {
  it(':noprefix drops the label but keeps the value', () => {
    expect(getFinalTitle('${downloading:noprefix}', context, format)).toBe('3');
    expect(getFinalTitle('${downspeed:noprefix}', context, format)).toBe('1000/s');
  });

  it(':nosuffix drops the /s unit', () => {
    expect(getFinalTitle('${downspeed:nosuffix}', context, format)).toBe('<dl> 1000');
    expect(getFinalTitle('${upspeed:nosuffix}', context, format)).toBe('<ul> 400');
  });

  it(':scale=n divides the value', () => {
    expect(getFinalTitle('${downspeed:scale=1000}', context, format)).toBe('<dl> 1/s');
    expect(getFinalTitle('${upspeed:scale=1000:nosuffix}', context, format)).toBe('<ul> 0.4');
    expect(getFinalTitle('${downloading:scale=3}', context, format)).toBe('<dn> 1');
  });

  it('accepts several tags on one placeholder, in any order', () => {
    expect(getFinalTitle('${downspeed:noprefix:nosuffix:scale=2}', context, format)).toBe('500');
    expect(getFinalTitle('${downspeed:nosuffix:noprefix:scale=2}', context, format)).toBe('500');
    expect(getFinalTitle('${downloading:scale=2:noprefix}', context, format)).toBe('1.5');
  });

  it('keeps the [a-zA-Z0-9] tag alphabet AriaNg had', () => {
    // `:scale=2` parses, `:scale_2` does not even match the pattern, so the
    // whole placeholder is left in the title verbatim.
    expect(getFinalTitle('${downloading:scale=2}', context, format)).toBe('<dn> 1.5');
    expect(getFinalTitle('${downloading:scale_2}', context, format)).toBe('${downloading:scale_2}');
    expect(getFinalTitle('${downloading:bogus}', context, format)).toBe('<dn> 3');
  });

  it('treats a non-numeric or zero scale as "no scaling"', () => {
    expect(getFinalTitle('${downspeed:scale=0}', context, format)).toBe('<dl> 1000/s');
    expect(getFinalTitle('${downspeed:scale=abc}', context, format)).toBe('<dl> 1000/s');
  });
});

describe('unknown placeholders', () => {
  it('leaves them in the title untouched', () => {
    expect(getFinalTitle('${unknown}', context, format)).toBe('${unknown}');
    expect(getFinalTitle('${titleX}', context, format)).toBe('${titleX}');
    expect(getFinalTitle('${down}', context, format)).toBe('${down}');
    expect(getFinalTitle('${ title }', context, format)).toBe('${ title }');
  });

  it('mixes known and unknown placeholders', () => {
    expect(getFinalTitle('${downloading} ${nope} ${stopped}', context, format)).toBe(
      '<dn> 3 ${nope} <fs> 5',
    );
  });
});

describe('empty template', () => {
  it('falls back to the application title', () => {
    expect(getFinalTitle('', context, format)).toBe(APP_CONSTANTS.title);
    expect(getFinalTitle('   ', context, format)).toBe(APP_CONSTANTS.title);
  });

  it('passes the fallback through the formatter', () => {
    const spy = vi.fn(format);
    getFinalTitle('', context, spy);
    expect(spy).toHaveBeenCalledWith('AriaNg');
  });
});

describe('applyTitle', () => {
  it('writes document.title', () => {
    applyTitle(DEFAULT_TITLE_TEMPLATE, context, format);
    expect(document.title).toBe('<dl> 1000/s, <ul> 400/s - AriaNg');
  });
});

describe('startTitleUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a no-op when intervalMs <= 0', () => {
    const getTemplate = vi.fn(() => DEFAULT_TITLE_TEMPLATE);
    const stop = startTitleUpdater({ intervalMs: 0, getTemplate, getContext: () => context, format });

    expect(getTemplate).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
    vi.advanceTimersByTime(100_000);
    expect(getTemplate).not.toHaveBeenCalled();
  });

  it('applies the title once immediately and then on every tick', () => {
    const getTemplate = vi.fn(() => '${downspeed}');
    const stop = startTitleUpdater({
      intervalMs: 5000,
      getTemplate,
      getContext: () => context,
      format,
    });

    expect(getTemplate).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('<dl> 1000/s');

    vi.advanceTimersByTime(15_000);
    expect(getTemplate).toHaveBeenCalledTimes(4);

    stop();
  });

  it('reads the template and the context on every tick', () => {
    let downloadSpeed = 1000;
    const stop = startTitleUpdater({
      intervalMs: 1000,
      getTemplate: () => '${downspeed:nosuffix}',
      getContext: () => ({ globalStat: { ...stat, downloadSpeed } }),
      format,
    });

    expect(document.title).toBe('<dl> 1000');
    downloadSpeed = 2000;
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('<dl> 2000');

    stop();
  });

  it('clears itself on stop and is safe to stop twice', () => {
    const getTemplate = vi.fn(() => '${title}');
    const stop = startTitleUpdater({
      intervalMs: 1000,
      getTemplate,
      getContext: () => ({}),
      format,
    });

    stop();
    expect(() => stop()).not.toThrow();

    vi.advanceTimersByTime(10_000);
    expect(getTemplate).toHaveBeenCalledTimes(1);
  });
});
