/**
 * File type classification — a 1:1 port of AriaNg's `ariaNgFileTypes`
 * (`src/scripts/config/fileTypes.js`).
 *
 * AriaNg used this table in exactly two places:
 *
 * 1. `task-detail.js` → `chooseSpecifiedFiles(type)`: "select all files of this
 *    type" in the multi-file (BitTorrent) picker.
 * 2. `task-detail.js` → `showCustomChooseFileModal()`: the "Custom Choose File"
 *    dialog, which groups the task's files by category and offers a checkbox per
 *    distinct extension.
 *
 * `buildExtensionBuckets` below is the data source for (2).
 *
 * Every extension is stored **with** its leading dot (`.mp4`), exactly like the
 * original, so the literals can be diffed 1:1 against AriaNg's file. Lookups go
 * through `classifyExtension`, which accepts them with or without the dot and in
 * any case.
 *
 * Note: AriaNg normalised with `extension.toLowerCase()` only, so the table was
 * compared against already-lowercase input. We do the same, but defensively.
 */

/** The real categories, in AriaNg's declaration order. */
export const FILE_TYPE_CATEGORIES = [
  'video',
  'audio',
  'picture',
  'document',
  'application',
  'archive',
] as const;

export type KnownFileTypeCategory = (typeof FILE_TYPE_CATEGORIES)[number];

/** `other` is synthetic: everything that is not in the table above. */
export type FileTypeCategory = KnownFileTypeCategory | 'other';

export interface FileTypeDefinition {
  category: FileTypeCategory;
  /**
   * Translation key for the category label. AriaNg keyed the UI strings by
   * their own English text (`Videos`, `Audios`, ...), see `defaultLanguage.js`.
   */
  nameKey: string;
  /** Lower-case extensions, leading dot included. */
  extensions: readonly string[];
}

export const FILE_TYPES: readonly FileTypeDefinition[] = [
  {
    category: 'video',
    nameKey: 'Videos',
    extensions: [
      '.3g2',
      '.3gp',
      '.3gp2',
      '.3gpp',
      '.asf',
      '.asx',
      '.avi',
      '.dat',
      '.divx',
      '.flv',
      '.m1v',
      '.m2ts',
      '.m2v',
      '.m4v',
      '.mkv',
      '.mov',
      '.mp4',
      '.mpe',
      '.mpeg',
      '.mpg',
      '.mts',
      '.ogv',
      '.qt',
      '.ram',
      '.rm',
      '.rmvb',
      '.ts',
      '.vob',
      '.wmv',
    ],
  },
  {
    category: 'audio',
    nameKey: 'Audios',
    extensions: [
      '.aac',
      '.ac3',
      '.adts',
      '.amr',
      '.ape',
      '.eac3',
      '.flac',
      '.m1a',
      '.m2a',
      '.m4a',
      '.mid',
      '.mka',
      '.mp2',
      '.mp3',
      '.mpa',
      '.mpc',
      '.ogg',
      '.ra',
      '.tak',
      '.vqf',
      '.wm',
      '.wav',
      '.wma',
      '.wv',
    ],
  },
  {
    category: 'picture',
    nameKey: 'Pictures',
    extensions: [
      '.abr',
      '.bmp',
      '.emf',
      '.gif',
      '.j2c',
      '.j2k',
      '.jfif',
      '.jif',
      '.jp2',
      '.jpc',
      '.jpe',
      '.jpeg',
      '.jpf',
      '.jpg',
      '.jpk',
      '.jpx',
      '.pcx',
      '.pct',
      '.pic',
      '.pict',
      '.png',
      '.pns',
      '.psd',
      '.psdx',
      '.raw',
      '.svg',
      '.svgz',
      '.tga',
      '.tif',
      '.tiff',
      '.wbm',
      '.wbmp',
      '.webp',
      '.wmf',
      '.xif',
    ],
  },
  {
    category: 'document',
    nameKey: 'Documents',
    extensions: [
      '.csv',
      '.doc',
      '.docm',
      '.docx',
      '.dot',
      '.dotm',
      '.dotx',
      '.key',
      '.mpp',
      '.numbers',
      '.odp',
      '.ods',
      '.odt',
      '.pages',
      '.pdf',
      '.pot',
      '.potm',
      '.potx',
      '.pps',
      '.ppsm',
      '.ppsx',
      '.ppt',
      '.pptm',
      '.pptx',
      '.rtf',
      '.txt',
      '.vsd',
      '.vsdx',
      '.wk1',
      '.wk2',
      '.wk3',
      '.wk4',
      '.wks',
      '.wpd',
      '.wps',
      '.xla',
      '.xlam',
      '.xll',
      '.xlm',
      '.xls',
      '.xlsb',
      '.xlsm',
      '.xlsx',
      '.xlt',
      '.xltx',
      '.xlw',
      '.xps',
    ],
  },
  {
    category: 'application',
    nameKey: 'Applications',
    extensions: [
      '.apk',
      '.bat',
      '.com',
      '.deb',
      '.dll',
      '.dmg',
      '.exe',
      '.ipa',
      '.jar',
      '.msi',
      '.rpm',
      '.sh',
    ],
  },
  {
    category: 'archive',
    nameKey: 'Archives',
    extensions: [
      '.001',
      '.7z',
      '.ace',
      '.arj',
      '.bz2',
      '.cab',
      '.cbr',
      '.cbz',
      '.gz',
      '.img',
      '.iso',
      '.lzh',
      '.qcow2',
      '.r',
      '.rar',
      '.sef',
      '.tar',
      '.taz',
      '.tbz',
      '.tbz2',
      '.uue',
      '.vdi',
      '.vhd',
      '.vmdk',
      '.wim',
      '.xar',
      '.xz',
      '.z',
      '.zip',
    ],
  },
];

/**
 * The synthetic bucket for everything the table above does not know about.
 *
 * AriaNg did not model this: it rendered the leftovers under an "UnClassified"
 * list. `nameKey` is the `Other` string that `defaultLanguage.js` defines.
 */
export const OTHER_FILE_TYPE: FileTypeDefinition = {
  category: 'other',
  nameKey: 'Other',
  extensions: [],
};

/** Total number of classified extensions (175 in AriaNg). */
export const KNOWN_EXTENSION_COUNT = FILE_TYPES.reduce(
  (sum, definition) => sum + definition.extensions.length,
  0,
);

/* ------------------------------------------------------------------ */
/* lookups                                                             */
/* ------------------------------------------------------------------ */

/** `.MP4`, `mp4` and `.mp4` all normalise to `mp4`. */
function normalizeExtension(extension: string): string {
  let value = extension.trim().toLowerCase();

  // `path.extname` style inputs may still carry the dot; AriaNg's own
  // `getFileExtension` already stripped it, but callers may not have.
  while (value.startsWith('.')) {
    value = value.slice(1);
  }

  return value;
}

const EXTENSION_INDEX: ReadonlyMap<string, FileTypeCategory> = (() => {
  const index = new Map<string, FileTypeCategory>();

  for (const definition of FILE_TYPES) {
    for (const extension of definition.extensions) {
      index.set(normalizeExtension(extension), definition.category);
    }
  }

  return index;
})();

/**
 * Which bucket an extension belongs to, or `'other'`.
 *
 * Case-insensitive and dot-insensitive. An empty string (a file without an
 * extension) is `'other'`.
 */
export function classifyExtension(extension: string): FileTypeCategory {
  if (!extension) {
    return OTHER_FILE_TYPE.category;
  }

  return EXTENSION_INDEX.get(normalizeExtension(extension)) ?? OTHER_FILE_TYPE.category;
}

/** The table's extensions for a category (leading dots included). */
export function extensionsForCategory(category: FileTypeCategory): string[] {
  if (category === OTHER_FILE_TYPE.category) {
    return [];
  }

  const definition = FILE_TYPES.find((entry) => entry.category === category);
  return definition ? [...definition.extensions] : [];
}

/** True when the extension appears in the table. */
export function isKnownExtension(extension: string): boolean {
  return EXTENSION_INDEX.has(normalizeExtension(extension));
}

/* ------------------------------------------------------------------ */
/* "Custom Choose File" dialog                                         */
/* ------------------------------------------------------------------ */

/** Shape accepted by {@link buildExtensionBuckets} — `FileTypeInfo` fits. */
export interface FileExtensionInput {
  /** Extension with or without the leading dot, any case. */
  extension: string;
  /**
   * aria2's per-file selection flag. Undefined / false counts as "not
   * selected", which is the state AriaNg counted as `unSelectedCount`.
   */
  selected?: boolean;
}

export interface ExtensionBucket {
  /** How many files in this bucket are currently selected. */
  selected: number;
  /** How many files in this bucket there are, selected or not. */
  total: number;
  /**
   * Distinct extensions found in this bucket, lower-cased, **without** the
   * leading dot, sorted and de-duplicated.
   *
   * `''` means "files without an extension"; AriaNg rendered those with an
   * empty label in its unclassified list.
   */
  extensions: string[];
}

/**
 * Groups a task's files by category for the "Custom Choose File" dialog.
 *
 * Mirrors `showCustomChooseFileModal()`: AriaNg walked the task's files once to
 * collect `{selectedCount, unSelectedCount}` per extension, then copied each
 * extension into its category's list and dumped everything left over into
 * "UnClassified".
 *
 * Only categories that actually contain a file are present in the returned map;
 * insertion order follows {@link FILE_TYPE_CATEGORIES} with `other` last.
 */
export function buildExtensionBuckets(
  files: readonly FileExtensionInput[],
): Map<FileTypeCategory, ExtensionBucket> {
  interface Accumulator {
    extensions: Set<string>;
    selected: number;
    total: number;
  }

  const counters = new Map<FileTypeCategory, Accumulator>();

  for (const file of files ?? []) {
    const extension = normalizeExtension(file.extension);
    const category = classifyExtension(extension);

    let accumulator = counters.get(category);
    if (!accumulator) {
      accumulator = { extensions: new Set<string>(), selected: 0, total: 0 };
      counters.set(category, accumulator);
    }

    accumulator.extensions.add(extension);
    accumulator.total += 1;

    if (file.selected) {
      accumulator.selected += 1;
    }
  }

  const orderedCategories: FileTypeCategory[] = [
    ...FILE_TYPE_CATEGORIES,
    OTHER_FILE_TYPE.category,
  ];
  const buckets = new Map<FileTypeCategory, ExtensionBucket>();

  for (const category of orderedCategories) {
    const accumulator = counters.get(category);
    if (!accumulator) {
      continue;
    }

    buckets.set(category, {
      selected: accumulator.selected,
      total: accumulator.total,
      extensions: [...accumulator.extensions].sort(),
    });
  }

  return buckets;
}