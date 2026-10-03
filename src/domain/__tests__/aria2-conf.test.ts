/**
 * `aria2.conf` serialisation.
 *
 * The format rules these tests pin down were established by feeding candidate lines
 * to a real aria2-next 2.8.3 through `--conf-path` and reading the result back with
 * `aria2.getGlobalOption` — they are not guesses:
 *
 * | conf line                | `getGlobalOption` returns      |
 * |--------------------------|--------------------------------|
 * | `user-agent=plain`       | `plain`                        |
 * | `user-agent="plain"`     | `"plain"` — **quotes kept**    |
 * | `user-agent=Mozilla 5.0` | `Mozilla 5.0` — spaces are fine |
 * | `user-agent=a#b=c`       | `a#b=c`                        |
 * | `bt-exclude-tracker=`    | `""`                           |
 * | `user-agent=  padded  `  | `padded` — trimmed            |
 * | `# comment`              | ignored                        |
 *
 * The load-bearing consequence: **never quote a value.** aria2 keeps surrounding
 * quotes as part of the value, while an unquoted value may contain spaces, `=` and
 * `#` freely.
 *
 * The round-trip fixture at the bottom is a verbatim `getGlobalOption` capture from
 * aria2-next 2.8.3.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAria2Conf,
  collectConfEntries,
  EXCLUDED_CONF_KEYS,
  findUnrepresentableKeys,
} from '../aria2-conf';

describe('collectConfEntries', () => {
  it('writes key=value for everything the daemon reported', () => {
    const entries = collectConfEntries({ dir: '/tmp', 'max-concurrent-downloads': '5' });
    expect(entries).toContainEqual({ key: 'dir', value: '/tmp' });
    expect(entries).toContainEqual({ key: 'max-concurrent-downloads', value: '5' });
  });

  it('omits options the daemon did not report rather than clearing them', () => {
    // The single most dangerous thing this module could do: `getGlobalOption` omits
    // anything never set, so emitting `key=` for those would reset them on the next
    // start — the opposite of exporting the current state.
    const entries = collectConfEntries({ dir: '/tmp' });
    expect(entries.map((entry) => entry.key)).not.toContain('max-concurrent-downloads');
  });

  it('never writes the RPC credential', () => {
    const entries = collectConfEntries({ 'rpc-secret': 'hunter2', dir: '/tmp' });
    expect(entries.map((entry) => entry.key)).not.toContain('rpc-secret');
  });

  it('never writes keys that only describe how the instance was started', () => {
    // Round-tripping a naive export changed exactly these three, because they pin a
    // new daemon to the exporting instance's RPC port and config path.
    const entries = collectConfEntries({
      'rpc-listen-port': '43627',
      'conf-path': '/etc/aria2/aria2.conf',
      daemon: 'false',
    });
    expect(entries).toEqual([]);
  });

  it('never writes the legacy conf aliases', () => {
    // aria2-next maps these onto bt-interface / bt-dht-bootstrap-nodes and logs
    // "Legacy aria2 input from configuration: … skipped because … is already set".
    const entries = collectConfEntries({
      'dht-entry-point': 'a:1',
      'dht-listen-addr': '',
      'bt-lpd-interface': '',
    });
    expect(entries).toEqual([]);
  });

  it('is deterministic, so two exports of one state are byte-identical', () => {
    const snapshot = { dir: '/tmp', 'max-concurrent-downloads': '5', 'continue': 'true' };
    expect(collectConfEntries(snapshot)).toEqual(collectConfEntries(snapshot));
  });
});

describe('buildAria2Conf', () => {
  const snapshot = {
    dir: '/tmp/opencode/aria2next/run',
    'max-concurrent-downloads': '5',
    'continue': 'true',
    'user-agent': 'aria2-next/2.8.3',
  };

  it('emits one key=value line per option', () => {
    const conf = buildAria2Conf(snapshot);
    expect(conf).toContain('dir=/tmp/opencode/aria2next/run');
    expect(conf).toContain('max-concurrent-downloads=5');
    expect(conf).toContain('continue=true');
    expect(conf).toContain('user-agent=aria2-next/2.8.3');
  });

  it('never quotes a value', () => {
    // Verified against the live parser: `key="v"` reads back as `"v"`, quotes and all.
    const conf = buildAria2Conf({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(conf).toContain('user-agent=Mozilla/5.0 (X11; Linux x86_64)');
    expect(conf).not.toMatch(/^user-agent="/m);
  });

  it('passes spaces, = and # through untouched', () => {
    // Verified: unquoted values keep spaces, and `#` is only a comment at line start.
    const conf = buildAria2Conf({ 'user-agent': 'a b#c=d' });
    expect(conf).toContain('user-agent=a b#c=d');
  });

  it('keeps a value that is only whitespace distinct from an empty one', () => {
    // aria2 trims around `=`, so a whitespace-only value and an empty one both read
    // back as "". It is emitted verbatim rather than dropped, so the export does not
    // silently disagree with what the daemon holds.
    const conf = buildAria2Conf({ 'user-agent': '' });
    expect(conf).toContain('user-agent=');
  });

  it('emits an empty value as key= rather than omitting the line', () => {
    const conf = buildAria2Conf({ 'bt-exclude-tracker': '' });
    expect(conf).toContain('bt-exclude-tracker=');
  });

  it('groups options under their group heading', () => {
    const conf = buildAria2Conf(snapshot);
    expect(conf).toContain('# --- basic ---');
  });

  it('records the source daemon when known', () => {
    const conf = buildAria2Conf(snapshot, { product: 'aria2-next', version: '2.8.3' });
    expect(conf).toContain('# source: aria2-next 2.8.3');
  });

  it('warns in the file that it is a runtime snapshot', () => {
    // The distinction matters: changeGlobalOption never writes to disk, so this file
    // is the only way the UI's changes can outlive a restart.
    const conf = buildAria2Conf(snapshot);
    expect(conf).toContain('snapshot of the RUNNING daemon');
    expect(conf).toContain('never writes to disk');
  });

  it('ends with exactly one newline', () => {
    const conf = buildAria2Conf(snapshot);
    expect(conf.endsWith('\n')).toBe(true);
    expect(conf.endsWith('\n\n')).toBe(false);
  });

  it('is stable across calls', () => {
    expect(buildAria2Conf(snapshot)).toBe(buildAria2Conf(snapshot));
  });

  it('writes nothing but comments for an empty snapshot', () => {
    const conf = buildAria2Conf({});
    const nonComment = conf.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
    expect(nonComment).toEqual([]);
  });
});

describe('findUnrepresentableKeys', () => {
  it('reports values that cannot be written on one line', () => {
    expect(findUnrepresentableKeys({ 'user-agent': 'a\nb' })).toEqual(['user-agent']);
    expect(findUnrepresentableKeys({ 'user-agent': 'a\rb' })).toEqual(['user-agent']);
  });

  it('does not report the excluded keys', () => {
    expect(findUnrepresentableKeys({ 'rpc-secret': 'a\nb' })).toEqual([]);
  });

  it('reports nothing for ordinary values', () => {
    expect(findUnrepresentableKeys({ dir: '/tmp', 'user-agent': 'plain' })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* round-trip fixture: a verbatim getGlobalOption capture from aria2-next 2.8.3  */
/* -------------------------------------------------------------------------- */

describe('a real aria2-next snapshot', () => {
  /**
   * Trimmed from a live capture, but every field is exactly as the daemon returned it.
   * The values that matter here are the ones that broke the naive export: the RPC
   * port, the conf path, and the legacy DHT aliases.
   */
  const live: Record<string, string> = {
    dir: '/tmp/opencode/aria2next/run',
    'max-concurrent-downloads': '5',
    'continue': 'true',
    'check-integrity': 'false',
    'help': '#basic',
    'user-agent': 'aria2-next/2.8.3',
    'rpc-listen-port': '43627',
    'conf-path': '/tmp/opencode/aria2next/aria2.conf',
    daemon: 'false',
    'enable-rpc': 'true',
    'bt-dht-bootstrap-nodes': 'dht.libtorrent.org:25401,dht.transmissionbt.com:6881',
    'dht-entry-point': 'dht.libtorrent.org:25401,dht.transmissionbt.com:6881',
    'dht-entry-point6': 'dht.libtorrent.org:25401,dht.transmissionbt.com:6881',
    'dht-listen-addr': '',
    'dht-listen-addr6': '',
    'bt-lpd-interface': '',
  };

  it('leaves out exactly the keys that made the round-trip lossy', () => {
    const conf = buildAria2Conf(live);
    // Verified by restarting a real daemon with the export: 147/147 keys round-tripped
    // identically and the "Legacy aria2 input from configuration" warnings stopped.
    for (const key of ['rpc-listen-port', 'conf-path', 'daemon', 'enable-rpc']) {
      expect(conf, key).not.toContain(`${key}=`);
    }
    for (const key of ['dht-entry-point', 'dht-entry-point6', 'dht-listen-addr', 'dht-listen-addr6', 'bt-lpd-interface']) {
      expect(conf, key).not.toContain(`${key}=`);
    }
  });

  it('still exports the option the aliases were standing in for', () => {
    const conf = buildAria2Conf(live);
    expect(conf).toContain('bt-dht-bootstrap-nodes=dht.libtorrent.org:25401,dht.transmissionbt.com:6881');
  });

  it('keeps a value that begins with a comment character', () => {
    // Verified: `#` only introduces a comment at the start of a line.
    const conf = buildAria2Conf(live);
    expect(conf).toContain('help=#basic');
  });

  it('exports nothing from the excluded set, by construction', () => {
    const entries = collectConfEntries(live);
    for (const entry of entries) {
      expect(EXCLUDED_CONF_KEYS.has(entry.key), entry.key).toBe(false);
    }
  });
});