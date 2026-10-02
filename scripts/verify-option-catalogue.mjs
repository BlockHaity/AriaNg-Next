#!/usr/bin/env node
/**
 * Diff the option catalogue against a live aria2-next `getGlobalOption` response.
 *
 * WHAT IT IS FOR
 * --------------
 * `src/config/aria2-options.ts` is hand-maintained from the aria2-next manual,
 * so it drifts whenever aria2-next gains, renames or retires an option. This
 * script catches that drift by comparing the catalogue with what a real daemon
 * actually reports.
 *
 * USAGE
 * -----
 *   node scripts/verify-option-catalogue.mjs [dump.json]
 *
 *   dump.json  Path to a JSON dump of `aria2.getGlobalOption`. Defaults to
 *              `aria2-global-option.json` in the repository root. Both shapes
 *              are accepted:
 *
 *                { "result": { "dir": "/downloads", ... } }   // raw RPC reply
 *                { "dir": "/downloads", ... }                 // unwrapped
 *
 *              Produce one with a running aria2-next, e.g.
 *
 *                aria2c --enable-rpc=true --rpc-listen-all=false \
 *                       --daemon=true
 *                curl -s -X POST http://127.0.0.1:6800/jsonrpc \
 *                  -H 'Content-Type: application/json' \
 *                  -d '{"jsonrpc":"2.0","id":"verify","method":"aria2.getGlobalOption"}' \
 *                  | jq .result > aria2-global-option.json
 *
 *              (add `--header 'token:<secret>'` when --rpc-secret is set)
 *
 * OUTPUT
 * ------
 *   missing   keys the daemon reports that the catalogue does not know
 *   extra     catalogue keys the daemon does not report
 *   removed   catalogue keys aria2-next is expected to have retired anyway
 *             (reported for context only, never counted as a failure)
 *
 * The exit code is 1 when `missing` is non-empty, so it can gate CI.
 *
 * WHY IT PARSES THE TYPESCRIPT
 * ----------------------------
 * Node cannot import `.ts` directly and this repository has no ts-node /
 * tsx dependency, so the catalogue is read with a regex over its source. The
 * pattern anchors on the record-literal shape emitted by the catalogue
 * (`  'some-option': {`), so it does not match `defaultValue`, notes or the
 * `key:` field. A generated JSON snapshot would be stricter, but keeping one
 * source of truth is worth more here than a second copy to keep in sync.
 *
 * TODO(owner): once an aria2-next binary is available in CI, replace the manual
 * dump with a scripted `getGlobalOption` call and cross-check the values
 * (defaults and allowed-value lists), not just the key set.
 */

/* global console, process */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE_PATH = resolve(REPO_ROOT, 'src/config/aria2-options.ts');
const DEFAULT_DUMP = 'aria2-global-option.json';

/** `  'some-option': {` at the top level of ARIA2_ALL_OPTIONS. */
const CATALOGUE_KEY = /^ {2}'([a-z0-9-]+)': \{$/gm;
/** `    support: 'removed',` inside that entry. */
const REMOVED_SUPPORT = /^ {4}support: 'removed',$/m;

function readCatalogue() {
  const source = readFileSync(CATALOGUE_PATH, 'utf8');
  const keys = [];
  const removed = [];
  CATALOGUE_KEY.lastIndex = 0;
  let match = CATALOGUE_KEY.exec(source);
  while (match !== null) {
    const end = source.indexOf('\n  },', match.index);
    const entry = source.slice(match.index, end === -1 ? source.length : end);
    keys.push(match[1]);
    if (REMOVED_SUPPORT.test(entry)) removed.push(match[1]);
    match = CATALOGUE_KEY.exec(source);
  }
  return { keys, removed };
}

function readDump(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const payload = raw && typeof raw === 'object' && raw.result ? raw.result : raw;
  if (Array.isArray(payload)) {
    // `getGlobalOption` always answers with a map; accept a key list anyway.
    return new Set(payload.filter((entry) => typeof entry === 'string'));
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${path}: expected a JSON object of option keys`);
  }
  return new Set(Object.keys(payload));
}

const USAGE = [
  'Usage: node scripts/verify-option-catalogue.mjs [dump.json]',
  '',
  `  dump.json  aria2.getGlobalOption dump; defaults to ${DEFAULT_DUMP}`,
].join('\n');

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  const dumpArg = argv[0] ?? DEFAULT_DUMP;
  const dumpPath = isAbsolute(dumpArg) ? dumpArg : resolve(REPO_ROOT, dumpArg);

  const { keys, removed } = readCatalogue();
  const catalogue = new Set(keys);
  const live = readDump(dumpPath);

  const missing = [...live].filter((key) => !catalogue.has(key)).sort();
  const extra = [...catalogue].filter((key) => !live.has(key)).sort();
  const retired = extra.filter((key) => removed.includes(key)).sort();
  const unexplained = extra.filter((key) => !removed.includes(key)).sort();

  console.log(`catalogue: ${keys.length} keys (${removed.length} marked removed)`);
  console.log(`${dumpPath}: ${live.size} keys\n`);

  console.log(`missing (${missing.length}) — live aria2-next options the catalogue lacks`);
  for (const key of missing) console.log(`  + ${key}`);

  console.log(`\nremoved (${retired.length}) — expected, aria2-next retired these`);
  for (const key of retired) console.log(`  - ${key}`);

  console.log(`\nextra (${unexplained.length}) — catalogue keys the daemon does not report`);
  for (const key of unexplained) console.log(`  ? ${key}`);

  if (missing.length > 0) {
    console.log('\nFAIL: add the missing options to src/config/aria2-options.ts');
    return 1;
  }
  console.log('\nOK: every live option is in the catalogue');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
