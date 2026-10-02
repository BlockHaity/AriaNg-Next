import { describe, expect, it } from 'vitest';

import {
  ARIA2_ALL_OPTIONS,
  ARIA2_ALL_OPTION_KEYS,
  coerceOptionValue,
  getOptionMeta,
  humanizeByteValue,
  isOptionKeyValid,
  isOptionRemoved,
  optionValueLabel,
} from '@/config/aria2-options';
// `?raw` gives us the module source so duplicate object keys can be detected;
// at runtime a duplicate key silently collapses into one `Object.keys` entry.
import catalogueSource from '@/config/aria2-options.ts?raw';
import { OPTION_GROUP_ROUTES } from '@/config/types';
import type { OptionCategory, OptionValueType } from '@/config/types';

/** aria2's classic size syntax: bytes with an optional K/M suffix. */
const BYTE_PATTERN = '^(0|[1-9]\\d*(K|k|M|m)?)$';
/** aria2-next additionally documents a G suffix on some size options. */
const BYTE_PATTERN_G = '^(0|[1-9]\\d*(K|k|M|m|G|g)?)$';
/** `piece-length` has always been restricted to M. */
const PIECE_LENGTH_PATTERN = '^(0|[1-9]\\d*(M|m)?)$';

const VALUE_TYPES: readonly OptionValueType[] = [
  'string',
  'text',
  'integer',
  'float',
  'boolean',
  'option',
  // Dropdown + free text, for aria2-next track selection (`best` / `none` /
  // a language code / an opaque runtime track id).
  'string-or-option',
  'readonly',
];

const entries = Object.entries(ARIA2_ALL_OPTIONS);

/** Read the raw record so duplicate object keys can actually be detected. */
const source = catalogueSource;

describe('ARIA2_ALL_OPTIONS', () => {
  it('is keyed identically to every entry it declares', () => {
    for (const [key, meta] of entries) {
      expect(meta.key).toBe(key);
    }
  });

  it('declares no duplicate keys', () => {
    const declared = [...source.matchAll(/^ {2}'([a-z0-9-]+)': \{$/gm)].map((match) => match[1]);
    // Non-vacuous: the scan must find exactly as many entries as the record has.
    expect(declared).toHaveLength(ARIA2_ALL_OPTION_KEYS.length);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('gives every entry a valid type and category', () => {
    for (const [key, meta] of entries) {
      expect(VALUE_TYPES, key).toContain(meta.type);
      expect(OPTION_GROUP_ROUTES, key).toContain(meta.category);
    }
  });

  it('lists every key exactly once in ARIA2_ALL_OPTION_KEYS', () => {
    expect(ARIA2_ALL_OPTION_KEYS).toEqual(Object.keys(ARIA2_ALL_OPTIONS));
    expect(new Set(ARIA2_ALL_OPTION_KEYS).size).toBe(ARIA2_ALL_OPTION_KEYS.length);
  });

  it('gives every text option a separator', () => {
    for (const [key, meta] of entries) {
      if (meta.type !== 'text') continue;
      expect(meta.separator, key).toBeTruthy();
    }
  });

  it('marks every option with its aria2-next compatibility', () => {
    for (const [key, meta] of entries) {
      expect(['current', 'deprecated', 'removed'], key).toContain(meta.support);
      if (meta.support !== 'current') {
        expect(meta.aria2NextNote, key).toBeTruthy();
      }
    }
  });

  it('never marks a manual option as removed', () => {
    // Sanity check on the two anchors of the retired-name classification.
    expect(getOptionMeta('realtime-chunk-checksum')?.support).toBe('current');
    expect(getOptionMeta('proxy-method')?.support).toBe('removed');
  });
});

describe('byte-suffixed options', () => {
  const classicKeys = [
    'lowest-speed-limit',
    'min-split-size',
    'max-overall-upload-limit',
    'max-upload-limit',
    'max-overall-download-limit',
    'max-download-limit',
    'no-file-allocation-limit',
    'max-mmap-limit',
    'bt-request-peer-speed-limit',
    'ed2k-min-split-size',
  ];

  it.each(classicKeys)('keeps the K/M pattern on --%s', (key) => {
    expect(getOptionMeta(key)?.pattern).toBe(BYTE_PATTERN);
  });

  it.each([
    'stream-max-range-size',
    'bt-disk-queue-size',
    'bt-checking-memory',
    'bt-send-buffer-low-watermark',
    'bt-send-buffer-watermark',
    'log-max-size',
  ])('accepts the G suffix on --%s', (key) => {
    expect(getOptionMeta(key)?.pattern).toBe(BYTE_PATTERN_G);
  });

  it('restricts --piece-length to M', () => {
    expect(getOptionMeta('piece-length')?.pattern).toBe(PIECE_LENGTH_PATTERN);
  });

  it('gives every editable size option a unit suffix', () => {
    for (const [key, meta] of entries) {
      if (!meta.pattern || !meta.pattern.includes('K|k|M')) continue;
      expect(meta.suffix, key).toBe('Bytes');
    }
  });
});

describe('text options', () => {
  it('has exactly the four text rows AriaNg had', () => {
    const textKeys = entries.filter(([, meta]) => meta.type === 'text').map(([key]) => key);
    expect(textKeys.sort()).toEqual(['bt-exclude-tracker', 'bt-tracker', 'header', 'no-proxy']);
  });

  it('splits --no-proxy, --bt-tracker and --bt-exclude-tracker on commas', () => {
    for (const key of ['no-proxy', 'bt-tracker', 'bt-exclude-tracker']) {
      const meta = getOptionMeta(key);
      expect(meta, key).toMatchObject({ type: 'text', separator: ',', showCount: true });
      expect(meta?.trimCount, key).toBeUndefined();
    }
  });

  it('appends --header line by line and submits it as an array', () => {
    expect(getOptionMeta('header')).toMatchObject({
      type: 'text',
      separator: '\n',
      overrideMode: 'append',
      submitFormat: 'array',
      showCount: true,
      trimCount: true,
    });
  });

  it('marks --header as the only appended option', () => {
    const appended = entries.filter(([, meta]) => meta.overrideMode === 'append').map(([key]) => key);
    expect(appended).toEqual(['header']);
  });
});

describe('option-typed values', () => {
  const optionEntries = entries.filter(([, meta]) => meta.type === 'option');

  it('lists allowed values for every option row', () => {
    expect(optionEntries.length).toBeGreaterThan(10);
    for (const [key, meta] of optionEntries) {
      expect(meta.options, key).toBeDefined();
      expect(meta.options?.length, key).toBeGreaterThan(0);
    }
  });

  it('has no blank allowed value', () => {
    for (const [key, meta] of optionEntries) {
      for (const value of meta.options ?? []) {
        expect(value.trim(), key).not.toBe('');
      }
    }
  });

  it('keeps the default inside the allowed values', () => {
    for (const [key, meta] of optionEntries) {
      if (meta.defaultValue === undefined || meta.readonly) continue;
      if (key === 'follow-torrent' || key === 'follow-metalink') continue;
      expect(meta.options, key).toContain(meta.defaultValue);
    }
  });
});

describe('aria2-next spot checks', () => {
  it('exposes the media output containers', () => {
    expect(getOptionMeta('media-format')?.options).toEqual(['mp4', 'mkv', 'vtt']);
  });

  it('offers best/none for the media track selectors', () => {
    expect(getOptionMeta('media-video')?.options).toContain('best');
    expect(getOptionMeta('media-video')?.options).toContain('none');
    expect(getOptionMeta('media-audio')?.options).toContain('best');
    expect(getOptionMeta('media-subtitles')?.options).toContain('none');
  });

  it('lists the ED2K piece selectors', () => {
    expect(getOptionMeta('ed2k-piece-selector')?.options).toEqual([
      'default',
      'inorder',
      'random',
      'geom',
    ]);
  });

  it('treats --optimize-concurrent-downloads as a selectable row', () => {
    const meta = getOptionMeta('optimize-concurrent-downloads');
    expect(meta?.type).toBe('option');
    expect(meta?.options).toEqual(['true', 'false', '<A>:<B>']);
    expect(meta?.support).toBe('current');
  });

  it('keeps --state-dir a free-form path', () => {
    expect(getOptionMeta('state-dir')?.type).toBe('string');
    expect(getOptionMeta('state-dir')?.support).toBe('current');
  });

  it('bounds --stream-max-connections to 1..256', () => {
    expect(getOptionMeta('stream-max-connections')).toMatchObject({
      type: 'integer',
      defaultValue: '6',
      min: 1,
      max: 256,
    });
  });

  it('replaces the retired range-splitting options', () => {
    expect(getOptionMeta('max-connection-per-server')?.support).toBe('removed');
    expect(getOptionMeta('max-connection-per-server')?.aria2NextNote).toContain(
      'stream-max-connections',
    );
    expect(getOptionMeta('min-split-size')?.support).toBe('removed');
    expect(getOptionMeta('min-split-size')?.aria2NextNote).toContain('stream-max-range-size');
  });

  it('replaces --peer-agent and --peer-id-prefix with the bt- names', () => {
    expect(getOptionMeta('peer-agent')?.aria2NextNote).toContain('bt-user-agent');
    expect(getOptionMeta('peer-id-prefix')?.aria2NextNote).toContain('bt-peer-id-prefix');
    expect(getOptionMeta('bt-user-agent')?.defaultValue).toBe('qBittorrent/5.2.3');
  });

  it('drops the whole FTP family', () => {
    for (const key of [
      'ftp-user',
      'ftp-passwd',
      'ftp-pasv',
      'ftp-proxy',
      'ftp-type',
      'ftp-reuse-connection',
    ]) {
      expect(getOptionMeta(key)?.support, key).toBe('removed');
    }
    expect(getOptionMeta('sftp-user')?.support).toBe('current');
    expect(getOptionMeta('ssh-host-key-sha256')?.support).toBe('current');
  });

  it('categorises the ed2k and media families', () => {
    for (const key of ['ed2k-server', 'ed2k-piece-selector', 'detach-share-only']) {
      expect(getOptionMeta(key)?.category, key).toBe('ed2k');
    }
    for (const [key, meta] of entries) {
      if (!key.startsWith('media-')) continue;
      expect(meta.category, key).toBe('media');
    }
  });
});

describe('lookup helpers', () => {
  it('resolves known keys and rejects the prototype chain', () => {
    expect(getOptionMeta('dir')?.type).toBe('string');
    expect(getOptionMeta('nope')).toBeUndefined();
    expect(getOptionMeta('toString')).toBeUndefined();
    expect(isOptionKeyValid('dir')).toBe(true);
    expect(isOptionKeyValid('constructor')).toBe(false);
  });

  it('separates live options from retired names', () => {
    expect(isOptionRemoved('ftp-pasv')).toBe(true);
    expect(isOptionRemoved('peer-id-prefix')).toBe(true);
    expect(isOptionRemoved('dir')).toBe(false);
    expect(isOptionRemoved('nope')).toBe(false);
  });

  it('builds the shared option.<value> i18n key', () => {
    expect(optionValueLabel('file-allocation', 'prealloc')).toBe('option.prealloc');
    expect(optionValueLabel('nope', 'whatever')).toBe('option.whatever');
  });
});

describe('coerceOptionValue', () => {
  it('splits an appended header list into an array', () => {
    const meta = getOptionMeta('header');
    expect(meta).toBeDefined();
    expect(coerceOptionValue(meta!, 'X-A: b\nX-B: 9J1\n\nX-C: c\n')).toEqual([
      'X-A: b',
      'X-B: 9J1',
      'X-C: c',
    ]);
  });

  it('keeps comma lists without submitFormat as one string', () => {
    const meta = getOptionMeta('bt-tracker');
    expect(meta).toBeDefined();
    expect(coerceOptionValue(meta!, 'udp://a, https://b')).toBe('udp://a, https://b');
  });

  it('returns real booleans', () => {
    const meta = getOptionMeta('check-integrity');
    expect(meta).toBeDefined();
    expect(coerceOptionValue(meta!, 'true')).toBe(true);
    expect(coerceOptionValue(meta!, 'false')).toBe(false);
    expect(coerceOptionValue(meta!, '')).toBe(false);
    expect(coerceOptionValue(meta!, 'garbage')).toBe(false);
  });

  it('returns numbers for integer and float rows', () => {
    expect(coerceOptionValue(getOptionMeta('max-concurrent-downloads')!, '16')).toBe(16);
    expect(coerceOptionValue(getOptionMeta('seed-ratio')!, '1.5')).toBe(1.5);
  });

  it('passes unparseable numbers through so the editor can complain', () => {
    expect(coerceOptionValue(getOptionMeta('max-concurrent-downloads')!, 'abc')).toBe('abc');
    expect(coerceOptionValue(getOptionMeta('seed-ratio')!, '')).toBe('');
  });

  it('trims strings and passes option values through untouched', () => {
    expect(coerceOptionValue(getOptionMeta('dir')!, '  /tmp/x  ')).toBe('/tmp/x');
    expect(coerceOptionValue(getOptionMeta('file-allocation')!, 'falloc')).toBe('falloc');
  });
});

describe('humanizeByteValue', () => {
  it('expands the aria2 K/M/G suffixes', () => {
    expect(humanizeByteValue('1K')).toBe('1 KiB (1024 B)');
    expect(humanizeByteValue('20M')).toBe('20 MiB (20971520 B)');
    expect(humanizeByteValue('1G')).toBe('1 GiB (1073741824 B)');
  });

  it('renders plain byte counts and fractions', () => {
    expect(humanizeByteValue('0')).toBe('0 B');
    expect(humanizeByteValue('1024')).toBe('1024 B');
    expect(humanizeByteValue('1.5K')).toBe('1.5 KiB (1536 B)');
  });

  it('echoes values it does not understand', () => {
    expect(humanizeByteValue('unlimited')).toBe('unlimited');
    expect(humanizeByteValue('1X')).toBe('1X');
    expect(humanizeByteValue('')).toBe('');
  });
});

describe('categories', () => {
  it('only uses categories the settings routes know', () => {
    const seen = new Set(entries.map(([, meta]) => meta.category as OptionCategory));
    for (const category of seen) {
      expect(OPTION_GROUP_ROUTES, category).toContain(category);
    }
  });
});
