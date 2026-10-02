#!/usr/bin/env node
/**
 * Bundle size guard + sub-path deployability check.
 *
 * Two related budgets, one script:
 *
 * 1. SIZE. The single-file build inlines the whole application (mdui, echarts,
 *    React, icons) into one `index.html` that users open straight from
 *    `file://`. A runaway dependency therefore shows up as an unusable
 *    download, so `index.html` is held to an explicit byte budget.
 *
 * 2. RELATIVE ASSETS. The standard build must run from ANY sub-path (a
 *    reverse proxy, `https://host/aria/`, a GitHub Pages project page). That
 *    requires every asset URL in `index.html` to be relative. A single
 *    `src="/assets/index-abc.js"` pins the app to the domain root and breaks
 *    every sub-path deployment, which is easy to reintroduce by changing
 *    `base` in `vite.config.ts`.
 *
 * USAGE
 * -----
 *   node scripts/check-bundle-size.mjs [options]
 *
 *     --dir <path>                 directory to measure (default: dist-single)
 *     --budget <bytes>             fail when the measured size exceeds it
 *                                   (default: 3145728 = 3 MiB; accepts `3M`,
 *                                   `512K`, `1.5MiB`)
 *     --entry <name>               measure only this file inside <dir>
 *                                   (default: index.html when it exists,
 *                                   otherwise the whole directory)
 *     --check-relative-assets      turn absolute asset references into
 *                                   failures instead of warnings
 *     --json                       machine-readable report on stdout
 *     --help                       usage
 *
 * The size gate exits non-zero when over budget. The asset gate only warns by
 * default, because it is useful information during development; pass
 * `--check-relative-assets` (as CI does) to make it a hard failure.
 */

/* global console, process */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_DIR = 'dist-single';
const DEFAULT_BUDGET = 3 * 1024 * 1024;
const ENTRY_CANDIDATES = ['index.html'];

/** Extensions that never affect the transferred size in a meaningful way. */
const IGNORED_EXTENSIONS = new Set(['.map']);

/* -------------------------------------------------------------------------- */
/* byte parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parse a byte count, tolerating the `K`/`M`/`G` and `KiB`/`MiB` suffixes
 * people reach for out of habit.
 *
 * @param {string|number} input
 * @returns {number} bytes
 */
export function parseBytes(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new Error(`invalid byte count: ${input}`);
    return Math.floor(input);
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*(k|kb|kib|m|mb|mib|g|gb|gib|b)?\s*$/i.exec(String(input));
  if (match === null) throw new Error(`invalid byte count: ${input}`);
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const scale = { b: 1, k: 1024, kb: 1024, kib: 1024, m: 1024 ** 2, mb: 1024 ** 2, mib: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, gib: 1024 ** 3 }[unit];
  return Math.floor(value * scale);
}

/** @returns {string} `1234567 B (1.18 MiB)` */
export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/* -------------------------------------------------------------------------- */
/* measuring                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * List files under `dir`, relative and sorted, skipping source maps.
 *
 * @param {string} dir absolute path
 * @returns {string[]} relative POSIX-ish paths
 */
export function listFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return files.sort();
}

/**
 * Sum the size of `files` inside `dir`.
 *
 * @param {string} dir absolute path
 * @param {string[]} files relative paths
 * @returns {number} bytes
 */
export function measureFiles(dir, files) {
  let total = 0;
  for (const file of files) {
    const name = file.toLowerCase();
    if ([...IGNORED_EXTENSIONS].some((extension) => name.endsWith(extension))) continue;
    total += statSync(join(dir, file)).size;
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* relative-asset check                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Attributes whose value is a URL that Vite rewrites for `base`.
 *
 * @type {Array<[RegExp, string]>}
 */
const URL_ATTRIBUTES = [
  [/\bsrc\s*=\s*"([^"]*)"/gi, 'src'],
  [/\bsrc\s*=\s*'([^']*)'/gi, 'src'],
  [/\bhref\s*=\s*"([^"]*)"/gi, 'href'],
  [/\bhref\s*=\s*'([^']*)'/gi, 'href'],
  [/\bsrcset\s*=\s*"([^"]*)"/gi, 'srcset'],
  [/\bsrcset\s*=\s*'([^']*)'/gi, 'srcset'],
];

/**
 * Is this URL absolute in the deployment-breaking sense?
 *
 * Only root-relative (`/assets/x.js`) and protocol-relative (`//cdn/x.js`)
 * URLs break sub-path hosting. Absolute *remote* URLs (`https://…`) and
 * `#fragment` / `data:` URLs do not, so they are left alone.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isAbsoluteAssetUrl(url) {
  const trimmed = url.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('//')) return true;
  if (!trimmed.startsWith('/')) return false;
  return true;
}

/**
 * Find asset references in `index.html` that are absolute.
 *
 * @param {string} html
 * @returns {Array<{ url: string, attribute: string, index: number }>}
 */
export function findAbsoluteAssetUrls(html) {
  const findings = [];
  for (const [pattern, attribute] of URL_ATTRIBUTES) {
    pattern.lastIndex = 0;
    let match = pattern.exec(html);
    while (match !== null) {
      for (const candidate of match[1].split(',')) {
        const url = candidate.trim().split(/\s+/)[0] ?? '';
        if (isAbsoluteAssetUrl(url)) findings.push({ url, attribute, index: match.index });
      }
      match = pattern.exec(html);
    }
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* report                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Run both checks.
 *
 * @param {object} [options]
 * @param {string} [options.dir] directory to measure
 * @param {number} [options.budget] byte budget
 * @param {string} [options.entry] measure only this file
 * @param {boolean} [options.checkRelativeAssets] make absolute assets fatal
 * @returns {{ ok: boolean, dir: string, entry: string|null, size: number, budget: number|null, overBudget: boolean, files: Array<{path:string,bytes:number}>, absoluteAssets: Array<{url:string,attribute:string}>, absoluteAssetMode: 'error'|'warn'|'off' }}
 */
export function checkBundle(options = {}) {
  const dir = resolve(options.dir ?? join(REPO_ROOT, DEFAULT_DIR));
  const budget = options.budget ?? DEFAULT_BUDGET;
  const checkRelativeAssets = options.checkRelativeAssets ?? false;

  if (!statSync(dir).isDirectory()) {
    throw new Error(`${dir} is not a directory — run the build first`);
  }

  const all = listFiles(dir);
  const requested = options.entry ?? ENTRY_CANDIDATES.find((candidate) => all.includes(candidate));
  const measured = requested && all.includes(requested) ? [requested] : all;

  if (measured.length === 0) {
    throw new Error(`${dir} contains no files to measure`);
  }

  const files = measured.map((path) => ({ path, bytes: statSync(join(dir, path)).size }));
  const size = files.reduce((total, file) => total + file.bytes, 0);

  // The asset check always runs when there is an index.html to inspect, so
  // running the script by hand still surfaces the sub-path problem; only
  // `--check-relative-assets` promotes it from a warning to a failure.
  const htmlPath = join(dir, 'index.html');
  let absoluteAssets = [];
  let absoluteAssetMode = 'off';
  if (all.includes('index.html')) {
    absoluteAssetMode = checkRelativeAssets ? 'error' : 'warn';
    absoluteAssets = findAbsoluteAssetUrls(readFileSync(htmlPath, 'utf8'));
  }

  const overBudget = size > budget;
  const hasAbsoluteAssets = absoluteAssets.length > 0;

  return {
    ok: !overBudget && !(hasAbsoluteAssets && absoluteAssetMode === 'error'),
    dir,
    entry: requested ?? null,
    size,
    budget,
    overBudget,
    files,
    absoluteAssets,
    absoluteAssetMode,
  };
}

/**
 * @param {ReturnType<typeof checkBundle>} report
 * @returns {string} human-readable report
 */
export function formatReport(report) {
  const lines = [];
  const target = report.entry ?? `${report.files.length} file(s)`;

  lines.push(`bundle: ${report.dir}`);
  lines.push(`measure: ${target}`);
  lines.push(`  size    ${report.size} B (${humanSize(report.size)})`);
  if (report.budget !== null) {
    const share = ((report.size / report.budget) * 100).toFixed(1);
    lines.push(`  budget  ${report.budget} B (${humanSize(report.budget)}) — ${share}% used`);
  }

  if (report.files.length > 1) {
    lines.push('');
    for (const file of report.files) {
      lines.push(`  ${file.bytes.toString().padStart(9)} B  ${file.path}`);
    }
  }

  if (report.absoluteAssetMode !== 'off' && report.absoluteAssets.length > 0) {
    lines.push('');
    const label = report.absoluteAssetMode === 'error' ? 'FAIL' : 'WARN';
    lines.push(
      `${label}: ${report.absoluteAssets.length} absolute asset reference(s) in index.html — ` +
        'the app will not run from a sub-path',
    );
    for (const asset of report.absoluteAssets) {
      lines.push(`  ${asset.attribute}="${asset.url}"`);
    }
    lines.push('  Fix: keep `base: \'./\'` in vite.config.ts so URLs stay relative.');
  } else if (report.absoluteAssetMode !== 'off') {
    lines.push('');
    lines.push('OK: every asset reference in index.html is relative.');
  }

  if (report.overBudget) {
    const over = report.size - report.budget;
    lines.push('');
    lines.push(
      `FAIL: over budget by ${over} B (${humanSize(over)}).`,
    );
    lines.push(
      '      Raise the budget deliberately in the workflow after checking what grew,',
    );
    lines.push('      or remove the dependency that pulled it in.');
  } else if (report.budget !== null) {
    const headroom = report.budget - report.size;
    lines.push('');
    lines.push(
      `OK: ${humanSize(headroom)} of headroom under the ${humanSize(report.budget)} budget.`,
    );
  }

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* cli                                                                        */
/* -------------------------------------------------------------------------- */

const USAGE = [
  'Usage: node scripts/check-bundle-size.mjs [options]',
  '',
  `  --dir <path>              directory to measure (default: ${DEFAULT_DIR})`,
  `  --budget <bytes>          fail when over budget (default: ${DEFAULT_BUDGET} = 3 MiB;`,
  '                            accepts 3M, 1.5MiB, 512K)',
  '  --entry <name>            measure only this file inside <dir>',
  '                            (default: index.html when present)',
  '  --check-relative-assets   fail on absolute asset urls in index.html',
  '                            (default: off, so the check is advisory)',
  '  --json                    machine-readable report',
  '  --help                    this message',
].join('\n');

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
export function main(argv) {
  let dir = DEFAULT_DIR;
  let budget = DEFAULT_BUDGET;
  let entry;
  let checkRelativeAssets = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (inline) => {
      if (inline !== undefined) return inline;
      i += 1;
      return argv[i];
    };

    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return 0;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--check-relative-assets') {
      checkRelativeAssets = true;
      continue;
    }
    if (arg === '--dir' || arg.startsWith('--dir=')) {
      dir = takeValue(arg.split('=')[1]);
      continue;
    }
    if (arg === '--entry' || arg.startsWith('--entry=')) {
      entry = takeValue(arg.split('=')[1]);
      continue;
    }
    if (arg === '--budget' || arg.startsWith('--budget=')) {
      try {
        budget = parseBytes(takeValue(arg.split('=')[1]));
      } catch (error) {
        console.error(`check-bundle-size: ${error.message}`);
        return 2;
      }
      continue;
    }
    console.error(`check-bundle-size: unknown option ${arg}\n\n${USAGE}`);
    return 2;
  }

  let report;
  try {
    report = checkBundle({ dir, budget, entry, checkRelativeAssets });
  } catch (error) {
    console.error(`check-bundle-size: ${error.message}`);
    return 2;
  }

  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}