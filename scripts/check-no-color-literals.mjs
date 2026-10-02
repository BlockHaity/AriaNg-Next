#!/usr/bin/env node
/**
 * MD3 colour guard: no hard-coded colours in shipped source.
 *
 * THE RULE
 * --------
 * Every colour, radius, typography and elevation value must come from an mdui
 * design token — `--mdui-color-*`, `--mdui-typescale-*`, `--mdui-shape-*` and
 * friends. This script fails the build when raw colour values leak into
 * `src/**`, because a stray `#6750a4` silently defeats the light/dark scheme,
 * dynamic colour and every contrast guarantee Material Design 3 makes.
 *
 * WHAT IS CHECKED (and where)
 * --------------------------
 *   hex            `#rgb` `#rgba` `#rrggbb` `#rrggbbaa`
 *                  looked for inside CSS declaration values and inside
 *                  string / template literals — never in comments, never in
 *                  CSS selectors (so `#root { … }` is not a hit) and never in
 *                  `url(#fragment)`.
 *   colour-fn      `rgb()` `rgba()` `hsl()` `hsla()` whose arguments contain
 *                  numeric literals. `rgb(var(--mdui-color-primary))` is the
 *                  mdui idiom and is explicitly allowed.
 *   modern-fn      `oklch()` and `color-mix()` built from numbers or raw
 *                  colours; a mix of `--mdui-*` variables is allowed.
 *   named-colour   a curated set of named CSS colours (`white`, `black`,
 *                  `red`, `blue`, `green`, `grey`, `gray`, `silver`) inside
 *                  CSS declaration values, `style={{ … }}` objects or the
 *                  inline style API (`.style.setProperty()`, `.style.color =`).
 *                  `transparent` and `currentColor` are always allowed.
 *
 * Precision matters more than exhaustiveness: a guard with false positives
 * gets disabled, so the checks are anchored on *value positions* (CSS
 * declarations, string literals, style objects) and never on bare text.
 *
 * ALLOWED
 * -------
 * 1. `transparent` / `currentColor` — token-agnostic keywords.
 * 2. Token-based functional colours, e.g. `rgb(var(--mdui-color-surface))`.
 * 3. `SKIP_PATHS` below — data and test files, which never ship styling.
 * 4. `ALLOWLIST` below — a deliberately tiny set of file(s) that legitimately
 *    hold raw colour *data*.
 * 5. THE ESCAPE HATCH: a line carrying the marker
 *
 *        /* mdui-allow-color *\/        … or   // mdui-allow-color
 *
 *    is skipped. Use it when a value genuinely cannot come from a token (a
 *    third-party embed's mandated colour, a canvas-drawn contrast probe, a
 *    vendor palette that is mapped onto tokens in one obvious place).
 *    ALWAYS pair the marker with a one-line comment saying why, because an
 *    unexplained escape hatch is indistinguishable from a bug. See
 *    `docs/ci.md` for the review policy.
 *
 * USAGE
 * -----
 *   node scripts/check-no-color-literals.mjs [options]
 *
 *     --root <dir>   tree to scan (default: <repo>/src)
 *     --json         machine-readable report on stdout
 *     --help         usage
 *
 * Exit code 0 when clean, 1 when at least one violation is found.
 */

/* global console, process */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Extensions treated as "source" for this rule. */
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.css']);

/** Directories that are never worth descending into. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.vite',
  'coverage',
  'dist',
  'dist-single',
  'dev-dist',
]);

/**
 * Files that are skipped wholesale, with the reason. These hold data or
 * assertions, never shipped styling, so a colour literal in them is not a
 * design-token violation.
 */
const SKIP_PATHS = [
  {
    pattern: /^src\/i18n\/locales\//,
    reason: 'converted translation data — `#` is prose (e.g. headings, docs links)',
  },
  {
    pattern: /^src\/i18n\/en\.ts$/,
    reason: 'source translation table — same reasoning as the locales',
  },
  {
    pattern: /(^|\/)__tests__\/|(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/,
    reason: 'test fixtures assert on colour values (mdui call arguments, snapshots); they ship no styling',
  },
];

/**
 * Rule waivers for shipped source. Every entry must stay as narrow as
 * possible — a whole path is granted only when raw colour *data* (not
 * styling) lives there, and only the listed rules are waived.
 */
const ALLOWLIST = [
  {
    path: 'src/ui/mdui/theme.ts',
    rules: ['hex'],
    reason:
      'M3_SEED_COLORS holds the official Material Design 3 baseline palette ' +
      'seeds. They are input data for token generation, not styling.',
  },
  {
    path: 'src/pages/task-detail/PieceBar.tsx',
    rules: ['hex'],
    reason:
      'LEGACY_PIECE_BAR_COLOR is AriaNg\'s 2013 flat blue, kept ONLY as the ' +
      'last-resort canvas `fillStyle` when `--mdui-color-primary` cannot be ' +
      'read from the computed style (jsdom, a detached node, an engine without ' +
      'custom-property support). The themed path is always tried first, so this ' +
      'never paints in a browser. Reviewed in docs/ci.md.',
  },
];

/** Line-level escape hatch. Documented in the file header. */
export const ALLOW_COLOR_MARKER = 'mdui-allow-color';

/** Named CSS colours that actually show up in Material code. */
const NAMED_COLOURS = [
  'white',
  'black',
  'red',
  'blue',
  'green',
  'grey',
  'gray',
  'silver',
];

/**
 * Keywords that are colour-token agnostic and therefore never flagged, even
 * if they ever appear in the curated list above.
 */
const ALWAYS_ALLOWED_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit']);

/** Rule metadata — also drives the grouped report and the `--json` payload. */
export const RULES = [
  { id: 'hex', title: 'hex colour literal', hint: 'use var(--mdui-color-*)' },
  { id: 'colour-fn', title: 'numeric colour function', hint: 'use rgb(var(--mdui-color-*))' },
  { id: 'modern-fn', title: 'oklch()/color-mix() with numbers', hint: 'use var(--mdui-color-*)' },
  { id: 'named-colour', title: 'named CSS colour', hint: 'use var(--mdui-color-*)' },
];

const RULE_TITLES = new Map(RULES.map((rule) => [rule.id, rule]));

/* -------------------------------------------------------------------------- */
/* comment masking                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Replace comment bodies with spaces, keeping every byte offset intact so
 * reported line/column numbers still point at the original source.
 *
 * Strings and (in TS) regular-expression literals are preserved, so a URL
 * containing `//` or a regex containing `#` is not mistaken for a comment.
 *
 * @param {string} text
 * @param {boolean} cssMode `.css` has no line comments
 * @returns {string}
 */
export function maskComments(text, cssMode) {
  const out = text.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    }
  };

  const length = text.length;
  let i = 0;
  while (i < length) {
    const char = text[i];

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(text, i);
      continue;
    }

    // Comments are matched BEFORE regex literals: `*/` from a preceding block
    // comment would otherwise make the "regex or division" heuristic misread a
    // `/** … */` block as a regex and leak its contents back into the scan.
    if (char === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? length : close + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (!cssMode && char === '/' && text[i + 1] === '/') {
      const close = text.indexOf('\n', i);
      const stop = close === -1 ? length : close;
      blank(i, stop);
      i = stop;
      continue;
    }

    // A `/` starts a regex literal when the previous meaningful character
    // cannot end an expression (the standard "regex or division" heuristic).
    if (!cssMode && char === '/') {
      const previous = previousCodeChar(text, i);
      if (previous === null || '(,=:[!&|?{};+-*%<>~^'.includes(previous)) {
        const end = skipRegex(text, i);
        if (end > i) {
          i = end;
          continue;
        }
      }
    }

    i += 1;
  }

  return out.join('');
}

/** @returns {number} offset just past the string literal starting at `start` */
function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    // A template literal's `${…}` may contain a nested backtick-free string.
    if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') depth -= 1;
        else if (text[i] === '"' || text[i] === "'" || text[i] === '`') i = skipString(text, i) - 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

/** @returns {number} offset just past the regex literal starting at `start` */
function skipRegex(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '\n') return start; // not a regex after all
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      i += 1;
      while (i < text.length && /[a-z]/.test(text[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return start;
}

/** @returns {string|null} last non-whitespace character before `index` */
function previousCodeChar(text, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  return i < 0 ? null : text[i];
}

/* -------------------------------------------------------------------------- */
/* value regions                                                              */
/* -------------------------------------------------------------------------- */

/** `prop: value` inside a stylesheet; group 1 is the value. */
const CSS_DECLARATION = /[a-zA-Z-][\w-]*[ \t]*:[ \t]*([^;{}]+)/dg;

/** `style={{` opening an inline style object literal. */
const STYLE_OBJECT = /style=\{\{/g;

/** `el.style.setProperty('prop', …` / `el.style.color = …`. */
const STYLE_API_CALL = /\.style\.setProperty\(\s*['"`][-\w]+['"`]\s*,\s*/g;
const STYLE_API_ASSIGN = /\.style\.[-\w]+\s*=\s*/g;

/**
 * Locate the regions of a file in which a colour literal would be *styling*
 * rather than prose.
 *
 * @param {string} masked comment-stripped source (offsets == original)
 * @param {boolean} isCss
 * @returns {Array<{ start: number, end: number, kind: 'css-value'|'string'|'style-object'|'style-api' }>}
 */
function valueRegions(masked, isCss) {
  const regions = [];

  // CSS declaration values are only a real context in a stylesheet. In
  // TS/TSX the same `prop: value` shape is ordinary object syntax (`{ nameKey:
  // 'theme.color.blue' }`), which would produce noise, so TS files are scanned
  // through their string literals instead — where every colour literal
  // actually lives.
  if (isCss) {
    for (const match of masked.matchAll(CSS_DECLARATION)) {
      const [start, end] = match.indices[1];
      regions.push({ start, end, kind: 'css-value' });
    }
    return regions;
  }

  for (const range of stringRanges(masked)) {
    regions.push({ ...range, kind: 'string' });
  }

  for (const match of masked.matchAll(STYLE_OBJECT)) {
    const open = masked.indexOf('{', match.index + STYLE_OBJECT.lastIndex - 1);
    if (open === -1) continue;
    const close = matchBrace(masked, open);
    if (close === -1) continue;
    // Every string literal inside the object is a style value.
    for (const range of stringRanges(masked.slice(open, close))) {
      regions.push({ start: open + range.start, end: open + range.end, kind: 'style-object' });
    }
  }

  for (const pattern of [STYLE_API_CALL, STYLE_API_ASSIGN]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(masked);
    while (match !== null) {
      const next = stringAt(masked, pattern.lastIndex);
      if (next) regions.push({ ...next, kind: 'style-api' });
      match = pattern.exec(masked);
    }
  }

  return regions;
}

/**
 * Offsets of the *contents* of every quoted string / template literal.
 *
 * @param {string} masked
 * @returns {Array<{ start: number, end: number }>}
 */
function stringRanges(masked) {
  const ranges = [];
  for (let i = 0; i < masked.length; i += 1) {
    const char = masked[i];
    if (char !== '"' && char !== "'" && char !== '`') continue;
    const end = skipString(masked, i);
    ranges.push({ start: i + 1, end: Math.max(i + 1, end - 1) });
    i = end - 1;
  }
  return ranges;
}

/** First string literal at or after `from`. */
function stringAt(masked, from) {
  for (let i = from; i < masked.length; i += 1) {
    const char = masked[i];
    if (char !== '"' && char !== "'" && char !== '`') continue;
    const end = skipString(masked, i);
    return { start: i + 1, end: Math.max(i + 1, end - 1) };
  }
  return null;
}

/** @returns {number} offset of the `}` matching the `{` at `open`, or -1 */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* -------------------------------------------------------------------------- */
/* detection rules                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Hex colours: only the lengths CSS actually accepts (3, 4, 6, 8) and only
 * when the token ends there, so `#added` or `#root` cannot match. A hex
 * preceded by a word character, or used as a `url(#fragment)` reference, is
 * not a colour.
 */
const HEX_TOKEN = /(?<![0-9a-zA-Z_-])(#[0-9a-fA-F]{3,8})(?![0-9a-zA-Z_-])/g;

/** Colour functions whose numeric arguments bypass the token system. */
const COLOUR_FUNCTION = /\b(rgb|rgba|hsl|hsla)\(/g;

/** Modern colour syntax that is not MD3-token based. */
const MODERN_COLOUR_FUNCTION = /\b(oklch|color-mix)\(/g;

const NAMED_COLOUR_TOKEN = new RegExp(
  `\\b(${NAMED_COLOURS.join('|')})\\b`,
  'gi',
);

/** `color: var(--mdui-…)` style token reference. */
const MD3_TOKEN = /var\(\s*--mdui-[a-z0-9-]+/i;

/** A number inside a colour function's arguments. */
const NUMERIC_LITERAL = /(^|[\s,(/])[-+]?\d*\.?\d+(?![-\w])/;

const URL_FRAGMENT = /url\(\s*$/;

/** @returns {boolean} true when the offset sits inside an MD3 token reference */
function referencesMduiToken(value) {
  return MD3_TOKEN.test(value);
}

/**
 * Run every rule over a source string.
 *
 * Exported so the unit tests can exercise the detection logic directly
 * against inline fixtures instead of touching the real `src/` tree.
 *
 * @param {string} text raw file contents
 * @param {object} [options]
 * @param {string} [options.path] path reported in violations and used for allowlist matching
 * @param {string[]} [options.rules] subset of rule ids to evaluate
 * @returns {Array<{ rule: string, path: string, line: number, column: number, snippet: string, message: string }>}
 */
export function checkSource(text, options = {}) {
  const path = options.path ?? '<source>';
  const enabled = new Set(options.rules ?? RULES.map((rule) => rule.id));
  const isCss = extname(path) === '.css';
  const masked = maskComments(text, isCss);
  const regions = valueRegions(masked, isCss);
  const lineStarts = computeLineStarts(text);
  const violations = [];

  const report = (rule, offset, snippet, message) => {
    if (!enabled.has(rule)) return;
    const { line, column } = positionAt(lineStarts, offset);
    if (isEscapeHatch(text, lineStarts, line, offset)) return;
    violations.push({ rule, path, line, column, snippet: snippet.trim(), message });
  };

  for (const region of regions) {
    const value = masked.slice(region.start, region.end);
    // Colour-function argument spans already reported in THIS region, so a
    // named colour inside them is not counted twice.
    const reportedFunctionSpans = [];

    if (enabled.has('hex')) {
      HEX_TOKEN.lastIndex = 0;
      let match = HEX_TOKEN.exec(value);
      while (match !== null) {
        const before = value.slice(0, match.index);
        const token = match[1];
        const isFragment = URL_FRAGMENT.test(before);
        const isValidLength = [3, 4, 6, 8].includes(token.length - 1);
        if (!isFragment && isValidLength) {
          report(
            'hex',
            region.start + match.index,
            lineSnippet(text, lineStarts, region.start + match.index),
            `\`${token}\` is a hard-coded colour`,
          );
        }
        match = HEX_TOKEN.exec(value);
      }
    }

    if (enabled.has('colour-fn')) {
      COLOUR_FUNCTION.lastIndex = 0;
      let match = COLOUR_FUNCTION.exec(value);
      while (match !== null) {
        const open = match.index + match[0].length - 1;
        const args = readCallArguments(value, open);
        if (args && NUMERIC_LITERAL.test(args) && !referencesMduiToken(value)) {
          reportedFunctionSpans.push({ start: match.index, end: open + args.length + 1 });
          report(
            'colour-fn',
            region.start + match.index,
            lineSnippet(text, lineStarts, region.start + match.index),
            `\`${match[1]}()\` with numeric arguments bypasses the MD3 tokens`,
          );
        }
        match = COLOUR_FUNCTION.exec(value);
      }
    }

    if (enabled.has('modern-fn')) {
      MODERN_COLOUR_FUNCTION.lastIndex = 0;
      let match = MODERN_COLOUR_FUNCTION.exec(value);
      while (match !== null) {
        const open = match.index + match[0].length - 1;
        const args = readCallArguments(value, open);
        const hasNumbers = args ? NUMERIC_LITERAL.test(args) : false;
        const hasNamedColour = args ? stripNumbers(args).match(NAMED_COLOUR_TOKEN) : null;
        if ((hasNumbers || hasNamedColour) && !referencesMduiToken(value)) {
          reportedFunctionSpans.push({ start: match.index, end: open + (args ? args.length + 1 : 0) });
          report(
            'modern-fn',
            region.start + match.index,
            lineSnippet(text, lineStarts, region.start + match.index),
            `\`${match[1]}()\` with numeric arguments bypasses the MD3 tokens`,
          );
        }
        match = MODERN_COLOUR_FUNCTION.exec(value);
      }
    }

    // Named colours are only checked where they would really be styling: a
    // CSS declaration value, a `style={{ … }}` object or the inline style API.
    // A bare string such as an i18n key (`'theme.color.blue'`) is not styling,
    // so plain string regions are excluded.
    const stylingContext =
      region.kind === 'css-value' ||
      region.kind === 'style-object' ||
      region.kind === 'style-api';
    if (enabled.has('named-colour') && stylingContext) {
      NAMED_COLOUR_TOKEN.lastIndex = 0;
      let match = NAMED_COLOUR_TOKEN.exec(value);
      while (match !== null) {
        const token = match[1].toLowerCase();
        const preceded = value.slice(0, match.index);
        const isUrl = URL_FRAGMENT.test(preceded);
        // A named colour inside a colour function the colour-function rule has
        // already reported is the same violation; reporting it twice would make
        // the output noisier without adding information.
        const insideReportedFunction = reportedFunctionSpans.some(
          (span) => match.index >= span.start && match.index < span.end,
        );
        if (
          !ALWAYS_ALLOWED_KEYWORDS.has(token) &&
          !isUrl &&
          !insideReportedFunction
        ) {
          report(
            'named-colour',
            region.start + match.index,
            lineSnippet(text, lineStarts, region.start + match.index),
            `\`${token}\` is a named CSS colour, not an MD3 token`,
          );
        }
        match = NAMED_COLOUR_TOKEN.exec(value);
      }
    }
  }

  violations.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  return violations;
}

/**
 * Does the offending line — or, for multi-line constructs, the line the
 * construct starts on — carry the escape-hatch marker?
 *
 * @param {string} text raw source
 * @param {number[]} lineStarts
 * @param {number} line 1-based line of the offending token
 * @param {number} offset absolute offset of the offending token
 */
function isEscapeHatch(text, lineStarts, line, offset) {
  if (lineTextAt(text, lineStarts, line).includes(ALLOW_COLOR_MARKER)) return true;
  const startLine = positionAt(lineStarts, offset).line;
  return startLine !== line && lineTextAt(text, lineStarts, startLine).includes(ALLOW_COLOR_MARKER);
}

/** Replace numeric literals so `color-mix(in srgb, red 40%, …)` can be judged. */
function stripNumbers(value) {
  return value.replace(/[-+]?\d*\.?\d+(?![-\w])/g, '#');
}

/**
 * @param {string} value
 * @param {number} open offset of the opening parenthesis
 * @returns {string|null} argument text, or null when unbalanced
 */
function readCallArguments(value, open) {
  let depth = 0;
  for (let i = open; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    else if (value[i] === ')') {
      depth -= 1;
      if (depth === 0) return value.slice(open + 1, i);
    }
  }
  return null;
}

/** @returns {number[]} offset of the first character of every line */
function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** @returns {{ line: number, column: number }} 1-based position of `offset` */
function positionAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - lineStarts[low] + 1 };
}

/** @returns {string} the whole source line containing `offset`, trimmed */
function lineTextAt(text, lineStarts, line) {
  const start = lineStarts[line - 1];
  const end = line < lineStarts.length ? lineStarts[line] : text.length;
  return text.slice(start, end);
}

function lineSnippet(text, lineStarts, offset) {
  return lineTextAt(text, lineStarts, positionAt(lineStarts, offset).line).trim();
}

/* -------------------------------------------------------------------------- */
/* walking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} root absolute path of the tree to scan
 * @returns {string[]} absolute file paths, sorted for a stable report
 */
export function collectFiles(root) {
  const files = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(full);
        continue;
      }
      if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

/**
 * Logical, repo-style path for matching, so the SKIP_PATHS/ALLOWLIST patterns
 * (which are written as `src/...`) behave identically whether `--root` is the
 * real `<repo>/src` or a `<tmp>/src` fixture tree. Paths outside the repo fall
 * back to their position under the requested root, prefixed with `src/` when
 * the root itself is named `src`.
 */
function logicalPath(absolute, root) {
  const fromRoot = relative(root, absolute).split(sep).join('/');
  if (basename(root) === 'src') return `src/${fromRoot}`;

  // `--root <repo>/src/i18n/locales` should still be recognised as skipped.
  const fromRepo = relative(REPO_ROOT, absolute).split(sep).join('/');
  if (fromRepo !== '' && !fromRepo.startsWith('..')) return fromRepo;

  return fromRoot;
}

/** @returns {{ path: string, reason: string }|null} skip decision for `path` */
export function skipReasonFor(path) {
  for (const entry of SKIP_PATHS) {
    if (entry.pattern.test(path)) return { path, reason: entry.reason };
  }
  return null;
}

/** @returns {{ path: string, rules: string[], reason: string }|null} waiver */
export function allowlistEntryFor(path, rules) {
  return (
    ALLOWLIST.find(
      (entry) => entry.path === path && entry.rules.some((rule) => rules.includes(rule)),
    ) ?? null
  );
}

/**
 * Scan a tree and return every violation found.
 *
 * @param {object} [options]
 * @param {string} [options.root] tree to scan (default `<repo>/src`)
 * @returns {{
 *   ok: boolean,
 *   root: string,
 *   scannedFiles: number,
 *   skippedFiles: Array<{ path: string, reason: string }>,
 *   allowlist: Array<{ path: string, rules: string[], reason: string }>,
 *   violations: Array<{ rule: string, path: string, line: number, column: number, snippet: string, message: string }>,
 *   counts: { byRule: Record<string, number>, byFile: Record<string, number> },
 * }}
 */
export function checkProject(options = {}) {
  const root = resolve(options.root ?? join(REPO_ROOT, 'src'));
  const allRules = RULES.map((rule) => rule.id);
  const violations = [];
  const skippedFiles = [];
  let scannedFiles = 0;

  for (const file of collectFiles(root)) {
    const logical = logicalPath(file, root);
    const skip = skipReasonFor(logical);
    if (skip) {
      skippedFiles.push({ path: logical, reason: skip.reason });
      continue;
    }
    const waiver = allowlistEntryFor(logical, allRules);
    const rules = waiver ? allRules.filter((rule) => !waiver.rules.includes(rule)) : allRules;
    scannedFiles += 1;
    violations.push(...checkSource(readFileSync(file, 'utf8'), { path: logical, rules }));
  }

  const byRule = {};
  const byFile = {};
  for (const violation of violations) {
    byRule[violation.rule] = (byRule[violation.rule] ?? 0) + 1;
    byFile[violation.path] = (byFile[violation.path] ?? 0) + 1;
  }

  return {
    ok: violations.length === 0,
    root,
    scannedFiles,
    skippedFiles,
    allowlist: ALLOWLIST,
    violations,
    counts: { byRule, byFile },
  };
}

/* -------------------------------------------------------------------------- */
/* reporting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatReport(report) {
  const lines = [];
  const usedRules = [...new Set(report.violations.map((violation) => violation.rule))];

  lines.push(
    report.ok
      ? `OK: MD3 colour guard passed — ${report.scannedFiles} files scanned, no hard-coded colours.`
      : `FAIL: MD3 colour guard found ${report.violations.length} violation(s) in ` +
          `${Object.keys(report.counts.byFile).length} file(s).`,
  );

  if (!report.ok) {
    const byFile = new Map();
    for (const violation of report.violations) {
      if (!byFile.has(violation.path)) byFile.set(violation.path, []);
      byFile.get(violation.path).push(violation);
    }
    for (const [path, violations] of byFile) {
      lines.push('', path);
      for (const violation of violations) {
        lines.push(`  ${String(violation.line).padStart(4)}:${String(violation.column).padEnd(3)} ` +
          `[${RULE_TITLES.get(violation.rule)?.title ?? violation.rule}] ${violation.message}`);
        lines.push(`        ${violation.snippet}`);
      }
    }
    lines.push(
      '',
      'rules triggered:',
      ...usedRules.map(
        (rule) =>
          `  ${RULE_TITLES.get(rule)?.title ?? rule} (${report.counts.byRule[rule]}) — ` +
          `${RULE_TITLES.get(rule)?.hint ?? ''}`,
      ),
      '',
      `Fix: replace the literal with var(--mdui-color-*) / rgb(var(--mdui-color-*)).`,
      `Escape hatch (last resort): annotate the line with "${ALLOW_COLOR_MARKER}" plus a`,
      'one-line justification, or add a narrow entry to ALLOWLIST in',
      'scripts/check-no-color-literals.mjs. See docs/ci.md.',
    );
  }

  if (report.skippedFiles.length > 0) {
    lines.push('', `skipped ${report.skippedFiles.length} file(s) (data / fixtures)`);
  }

  return lines.join('\n');
}

const USAGE = [
  'Usage: node scripts/check-no-color-literals.mjs [options]',
  '',
  '  --root <dir>  tree to scan (default: <repo>/src)',
  '  --json        machine-readable report',
  '  --help        this message',
].join('\n');

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
export function main(argv) {
  let root;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return 0;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--root') {
      root = resolve(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (arg.startsWith('--root=')) {
      root = resolve(arg.slice('--root='.length));
      continue;
    }
    console.error(`check-no-color-literals: unknown option ${arg}\n\n${USAGE}`);
    return 2;
  }

  let stats;
  try {
    stats = statSync(root ?? join(REPO_ROOT, 'src'));
  } catch {
    console.error(`check-no-color-literals: no such directory: ${root ?? join(REPO_ROOT, 'src')}`);
    return 2;
  }
  if (!stats.isDirectory()) {
    console.error(`check-no-color-literals: --root must be a directory`);
    return 2;
  }

  const report = checkProject({ root });
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}