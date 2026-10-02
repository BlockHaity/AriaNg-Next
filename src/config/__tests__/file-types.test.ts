import { describe, expect, it } from 'vitest';
import {
  FILE_TYPE_CATEGORIES,
  FILE_TYPES,
  KNOWN_EXTENSION_COUNT,
  OTHER_FILE_TYPE,
  buildExtensionBuckets,
  classifyExtension,
  extensionsForCategory,
  isKnownExtension,
} from '../file-types';
import type { FileTypeCategory } from '../file-types';

const allExtensions = FILE_TYPES.flatMap((definition) => [...definition.extensions]);

describe('FILE_TYPES', () => {
  it('declares the six AriaNg categories in order', () => {
    expect([...FILE_TYPE_CATEGORIES]).toEqual([
      'video',
      'audio',
      'picture',
      'document',
      'application',
      'archive',
    ]);
    expect(FILE_TYPES.map((definition) => definition.category)).toEqual([
      'video',
      'audio',
      'picture',
      'document',
      'application',
      'archive',
    ]);
  });

  it('ports AriaNg\'s per-category extension counts', () => {
    // Counted straight out of `scripts/config/fileTypes.js`.
    expect(extensionsForCategory('video')).toHaveLength(29);
    expect(extensionsForCategory('audio')).toHaveLength(24);
    expect(extensionsForCategory('picture')).toHaveLength(35);
    expect(extensionsForCategory('document')).toHaveLength(47);
    expect(extensionsForCategory('application')).toHaveLength(12);
    expect(extensionsForCategory('archive')).toHaveLength(29);
  });

  it('ports all 176 extensions', () => {
    // 29 + 24 + 35 + 47 + 12 + 29. (The brief said 175; AriaNg ships 176 —
    // `.mpe` and `.vob` / `.abr` … all of the above are verbatim.)
    expect(allExtensions).toHaveLength(176);
    expect(KNOWN_EXTENSION_COUNT).toBe(176);
  });

  it('never repeats an extension across categories', () => {
    const seen = new Set<string>();
    for (const extension of allExtensions) {
      expect(seen.has(extension)).toBe(false);
      seen.add(extension);
    }
    expect(seen.size).toBe(allExtensions.length);
  });

  it('stores every extension lower-cased and dot-prefixed', () => {
    for (const extension of allExtensions) {
      expect(extension.startsWith('.'), `${extension} must start with a dot`).toBe(true);
      expect(extension).toBe(extension.toLowerCase());
      expect(extension).not.toBe('.');
      expect(extension.slice(1)).not.toContain('.');
    }
  });

  it('uses AriaNg\'s label keys', () => {
    expect(FILE_TYPES.map((definition) => definition.nameKey)).toEqual([
      'Videos',
      'Audios',
      'Pictures',
      'Documents',
      'Applications',
      'Archives',
    ]);
  });
});

describe('OTHER_FILE_TYPE', () => {
  it('is the synthetic, extension-less bucket', () => {
    expect(OTHER_FILE_TYPE.category).toBe('other');
    expect(OTHER_FILE_TYPE.nameKey).toBe('Other');
    expect(OTHER_FILE_TYPE.extensions).toEqual([]);
  });
});

describe('classifyExtension', () => {
  it('classifies a sample from every category', () => {
    expect(classifyExtension('.mp4')).toBe('video');
    expect(classifyExtension('.flac')).toBe('audio');
    expect(classifyExtension('.webp')).toBe('picture');
    expect(classifyExtension('.xlsx')).toBe('document');
    expect(classifyExtension('.apk')).toBe('application');
    expect(classifyExtension('.torrent')).toBe('other'); // not in AriaNg's table
  });

  it('is case-insensitive', () => {
    expect(classifyExtension('.MP4')).toBe('video');
    expect(classifyExtension('MP4')).toBe('video');
    expect(classifyExtension('mP4')).toBe('video');
    expect(classifyExtension('.XLSX')).toBe('document');
  });

  it('is dot-insensitive', () => {
    expect(classifyExtension('mp4')).toBe(classifyExtension('.mp4'));
    expect(classifyExtension('..mp4')).toBe(classifyExtension('.mp4'));
    expect(classifyExtension('.MP4')).toBe(classifyExtension('mp4'));
  });

  it('tolerates surrounding whitespace', () => {
    expect(classifyExtension('  .mp4  ')).toBe('video');
  });

  it('falls back to other for unknown, empty and absent extensions', () => {
    expect(classifyExtension('.exe.bak')).toBe('other');
    expect(classifyExtension('.torrent')).toBe('other');
    expect(classifyExtension('')).toBe('other');
    expect(classifyExtension('.')).toBe('other');
    expect(classifyExtension('...')).toBe('other');
  });

  it('agrees with the table for every single extension', () => {
    for (const definition of FILE_TYPES) {
      for (const extension of definition.extensions) {
        expect(classifyExtension(extension)).toBe(definition.category);
        expect(classifyExtension(extension.toUpperCase())).toBe(definition.category);
        expect(classifyExtension(extension.slice(1))).toBe(definition.category);
      }
    }
  });
});

describe('extensionsForCategory', () => {
  it('returns a mutable copy, not the frozen table', () => {
    const first = extensionsForCategory('video');
    const second = extensionsForCategory('video');

    expect(first).toEqual(second);
    expect(first).not.toBe(second);

    first.push('.nope');
    expect(extensionsForCategory('video')).not.toContain('.nope');
  });

  it('is empty for the synthetic bucket and for nonsense', () => {
    expect(extensionsForCategory('other')).toEqual([]);
    expect(extensionsForCategory('nonsense' as FileTypeCategory)).toEqual([]);
  });
});

describe('isKnownExtension', () => {
  it('accepts every table entry and rejects everything else', () => {
    for (const extension of allExtensions) {
      expect(isKnownExtension(extension)).toBe(true);
      expect(isKnownExtension(extension.toUpperCase())).toBe(true);
      expect(isKnownExtension(extension.slice(1))).toBe(true);
    }

    expect(isKnownExtension('.torrent')).toBe(false);
    expect(isKnownExtension('.nfo')).toBe(false);
    expect(isKnownExtension('')).toBe(false);
  });
});

describe('buildExtensionBuckets', () => {
  it('returns nothing for an empty file list', () => {
    expect(buildExtensionBuckets([]).size).toBe(0);
  });

  it('groups by category, counting selection and listing distinct extensions', () => {
    const buckets = buildExtensionBuckets([
      { extension: 'mp4', selected: true },
      { extension: 'mkv' },
      { extension: 'mp4', selected: true },
      { extension: 'flac', selected: true },
      { extension: 'flac' },
      { extension: 'txt', selected: true },
    ]);

    expect([...buckets.keys()]).toEqual(['video', 'audio', 'document']);

    expect(buckets.get('video')).toEqual({
      selected: 2,
      total: 3,
      extensions: ['mkv', 'mp4'],
    });
    expect(buckets.get('audio')).toEqual({
      selected: 1,
      total: 2,
      extensions: ['flac'],
    });
    expect(buckets.get('document')).toEqual({
      selected: 1,
      total: 1,
      extensions: ['txt'],
    });
  });

  it('collects unknown extensions in the other bucket', () => {
    const buckets = buildExtensionBuckets([
      { extension: 'torrent', selected: true },
      { extension: 'torrent' },
      { extension: 'nfo' },
      { extension: '', selected: true },
    ]);

    expect([...buckets.keys()]).toEqual(['other']);
    expect(buckets.get('other')).toEqual({
      selected: 2,
      total: 4,
      extensions: ['', 'nfo', 'torrent'],
    });
  });

  it('lower-cases, de-duplicates and sorts the extension list', () => {
    const buckets = buildExtensionBuckets([
      { extension: 'MP4' },
      { extension: '.mp4' },
      { extension: 'mkv' },
      { extension: 'MKV' },
    ]);

    expect(buckets.get('video')).toEqual({
      selected: 0,
      total: 4,
      extensions: ['mkv', 'mp4'],
    });
  });

  it('treats blank and whitespace-only extensions as extension-less', () => {
    const buckets = buildExtensionBuckets([
      { extension: 'mp4' },
      { extension: '' },
      { extension: '   ' },
      { extension: '.' },
    ]);

    expect([...buckets.keys()]).toEqual(['video', 'other']);
    expect(buckets.get('video')).toEqual({ selected: 0, total: 1, extensions: ['mp4'] });
    expect(buckets.get('other')).toEqual({ selected: 0, total: 3, extensions: [''] });
  });

  it('keeps category order and puts other last', () => {
    const buckets = buildExtensionBuckets([
      { extension: 'zip' },
      { extension: 'unknown-ext' },
      { extension: 'mp4' },
      { extension: 'doc' },
    ]);

    expect([...buckets.keys()]).toEqual(['video', 'document', 'archive', 'other']);
  });

  it('omits categories that have no files', () => {
    const buckets = buildExtensionBuckets([{ extension: 'mp4' }]);

    expect(buckets.has('audio')).toBe(false);
    expect(buckets.has('other')).toBe(false);
    expect(buckets.size).toBe(1);
  });

  it('treats a missing selected flag as not selected', () => {
    const buckets = buildExtensionBuckets([{ extension: 'mp4' }, { extension: 'mkv', selected: false }]);

    expect(buckets.get('video')?.selected).toBe(0);
    expect(buckets.get('video')?.total).toBe(2);
  });
});