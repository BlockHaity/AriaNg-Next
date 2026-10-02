# CI and quality gates

How AriaNg-Next is verified on every push, and how to reproduce each gate
locally. Every command below runs from the repository root with Node 22 and the
dependencies already installed (`npm ci`).

---

## Workflows

### `.github/workflows/ci.yml` — every push and PR to `main`

Six independent jobs, so a failure names the problem instead of burying it
behind the first broken step. A `concurrency` group keyed on the workflow and
ref cancels superseded runs: if a third commit lands while the second is still
going, the second's result is discarded.

All jobs use `actions/checkout@v4`, `actions/setup-node@v4` on `node-version:
22` with the built-in npm cache, and `npm ci`.

| Job             | Command                                                              | What it protects                                                        |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `lint`          | `npx eslint .`                                                        | Dead code, broken hook rules, `==`, unused vars.                        |
| `typecheck`     | `npx tsc -b`                                                          | Type errors across `src`, `vite.config.ts` and the configs.             |
| `test`          | `npx vitest run` (+ `--coverage` when available)                       | Domain, RPC and config logic.                                           |
| `build:standard`| `npx vite build`, then artifact + relative-asset assertions            | The deployable build actually works, from any sub-path.                 |
| `build:single`  | `npx vite build --mode single`, then inlining assertion + size budget  | The double-clickable single file stays self-contained and small.        |
| `md3-guard`     | `node scripts/check-no-color-literals.mjs` + its unit tests            | Zero hard-coded colours.                                                |

`dist/` and `dist-single/` are uploaded as artifacts (`dist-standard`,
`dist-single`, retention 7 days) so a failure can be inspected without a local
build.

#### Notes on the individual gates

**`lint` fails on errors only.** The ESLint config deliberately downgrades
`@typescript-eslint/no-explicit-any`, `no-console` and `consistent-type-imports`
to warnings, so `--max-warnings 0` is *not* passed. The gate is about errors.

**`test` coverage is conditional.** `--coverage` needs
`@vitest/coverage-v8`, which is **not yet in `devDependencies`**. The job
detects the package and runs without coverage when it is absent, emitting a
GitHub notice rather than failing. To turn coverage on, add
`"@vitest/coverage-v8": "<version matching vitest>"` to `devDependencies` — the
workflow needs no change. When it is present, `coverage-summary.json` is
rendered as a markdown table into the job summary and `coverage/` is uploaded.

**`build:standard` asserts the PWA output exists.** `dist/index.html`,
`dist/sw.js` and `dist/manifest.webmanifest` must all be produced, and
`scripts/check-bundle-size.mjs --check-relative-assets` fails if any asset URL
in `dist/index.html` is absolute. The app must run from any sub-path
(`https://host/aria/`), so `base: './'` in `vite.config.ts` is load-bearing.

**`build:single` asserts everything is inlined.** Any `<script … src=…>` or
`<link rel="stylesheet">` in `dist-single/index.html` fails the job: the whole
point of the single-file build is that it runs from `file://` with nothing
beside it.

**`md3-guard` runs the guard's own tests.** `scripts/__tests__` sits outside
the `src/**` include in `vite.config.ts`, so the job writes a small
throwaway `vitest.guard.config.mts` and points `vitest run` at it, rather than
changing the shared include (which would put `environment: 'node'` test files
into the jsdom suite).

### `.github/workflows/release.yml` — tag push or manual

Triggered by a `v*` tag push, or by `workflow_dispatch` with a `tag` input.
Requires `contents: write`.

Sequence: verify the tag matches `package.json`'s `version` → lint → typecheck
→ test → both builds → both size guards → the MD3 guard → archive → publish.

The tag check is what stops a `v0.2.0` tag going out against a `0.1.0`
`package.json`.

Release assets:

- `ariang-next-<version>-single.html` — the double-clickable single file.
- `ariang-next-<version>-dist.tar.gz` — the standard build (`dist/`).

The GitHub Release is created with `gh release create --generate-notes`, so the
changelog is derived from merged pull requests since the previous tag. There is
no signing, attestation or registry publishing: those are not implemented and
not invented here.

### `.github/dependabot.yml`

Weekly, Mondays 06:00 UTC: `npm` for `dependencies` and `devDependencies`,
`github-actions` for the workflow actions. Minor and patch bumps are grouped
into one PR per ecosystem; major bumps (React, Vite, mdui) get their own PR,
because those can require source changes.

---

## Reproducing each gate locally

```sh
npm ci                    # once, or after a dependency change

npx eslint .              # lint
npx tsc -b                # typecheck
npx vitest run            # test
npx vite build            # standard build, plus its assertions:
node scripts/check-bundle-size.mjs --dir dist --check-relative-assets
npx vite build --mode single    # single-file build, plus its assertions:
node scripts/check-bundle-size.mjs --dir dist-single --entry index.html --budget 3145728
node scripts/check-no-color-literals.mjs     # MD3 colour guard
```

Both guard scripts exit non-zero on failure and support `--json` for
machine-readable output.

### The guard's own tests

```sh
npx vitest run scripts
```

This needs `scripts/**/*.test.mjs` in the vitest `include` in
`vite.config.ts`. It is not there yet (that file is owned elsewhere), so the
workflow uses a throwaway config. To run them locally without touching
`vite.config.ts`:

```sh
cat > /tmp/vitest.guard.mts <<'EOF'
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['scripts/**/*.test.mjs'] } });
EOF
npx vitest run --config /tmp/vitest.guard.mts
```

---

## The MD3 colour guard

### The rule

**Zero hard-coded colours.** Every colour must come from an mdui design token:
`--mdui-color-*` for colour, `--mdui-typescale-*` for typography,
`--mdui-shape-*` for radii. A stray `#6750a4` silently defeats light/dark
switching, dynamic colour and every contrast guarantee Material Design 3
makes — which is exactly the kind of regression that survives review and ships.

### What it checks

| Rule           | Flags                                                              | Allowed                                              |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `hex`          | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`                             | `transparent`, `currentColor`                         |
| `colour-fn`    | `rgb()`, `rgba()`, `hsl()`, `hsla()` with **numeric** arguments    | `rgb(var(--mdui-color-primary))` — the mdui idiom     |
| `modern-fn`    | `oklch()`, `color-mix()` built from numbers or raw colours          | mixes of `var(--mdui-*)`                              |
| `named-colour` | `white`, `black`, `red`, `blue`, `green`, `grey`, `gray`, `silver` | `transparent`, `currentColor` (always)               |

### Where it looks, and why

A naive `grep` for `#` produces so much noise that the guard gets disabled
within a week. The checks are therefore anchored on **value positions**, never
on bare text:

- **CSS files** — only declaration values (`prop: value`), so `#root` in a
  selector is not a hit.
- **TS/TSX** — only string and template literals, which is where every colour
  literal actually lives.
- **`style={{ … }}` objects and the inline style API** — `style.setProperty(…)`
  and `style.color = …` are treated as styling too.
- **`url(#fragment)` references** are not colours and are never flagged.
- **Comments are stripped before scanning** (with offsets preserved, so
  reported line numbers stay accurate), which is why a commented-out legacy
  colour in a doc block does not fail the build.

Named colours are deliberately **not** checked in bare strings: an i18n key
like `'theme.color.blue'` is data, not styling.

### What is skipped

| Path                                | Why                                                             |
| ----------------------------------- | --------------------------------------------------------------- |
| `src/i18n/locales/**`               | Converted translation data — `#` is prose (headings, doc links).  |
| `src/i18n/en.ts`                    | The source translation table, same reasoning.                    |
| `**/__tests__/**`, `*.test.*`, `*.spec.*` | Fixtures assert *on* colour values; they ship no styling.  |

### The allowlist

A deliberately tiny set of files that legitimately hold raw colour **data**,
each waived for specific rules only (never for the whole rule set):

| Path                              | Rule waived | Why                                                                                                                                        |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ui/mdui/theme.ts`            | `hex`       | `M3_SEED_COLORS` holds the official Material Design 3 baseline palette seeds — input data for token *generation*, not styling.               |
| `src/pages/task-detail/PieceBar.tsx` | `hex`    | `LEGACY_PIECE_BAR_COLOR` (AriaNg's 2013 flat blue) is kept **only** as the last-resort canvas `fillStyle` when `--mdui-color-primary` cannot be read from computed style (jsdom, a detached node, an engine without custom-property support). The themed path is always tried first. |

Neither entry relaxes the rule for the surrounding file: the waiver is
per-rule and per-path, and any other rule still applies there.

### The escape hatch

A line carrying the marker `mdui-allow-color` is skipped:

```ts
const LEGACY = '#208fe5'; // mdui-allow-color last-resort canvas fallback
```

```css
border-color: #123456; /* mdui-allow-color third-party embed mandates this */
```

**Use it responsibly.** It is for the narrow case where a value genuinely
cannot come from a token — a third-party embed that mandates its own colour, a
canvas contrast probe, a vendor palette mapped onto tokens in one obvious
place. Always pair the marker with a one-line comment saying *why*; an
unexplained escape hatch is indistinguishable from a bug, and a reviewer
cannot tell the difference. The marker works per line, so a multi-line
construct needs it on each offending line.

If a file accumulates several escape hatches, that is the signal to add a
narrow `ALLOWLIST` entry with a written justification instead — never to widen
the skip patterns.

### Fixing a violation

1. Find the matching token. `var(--mdui-color-primary)`,
   `--mdui-color-error-container`, `--mdui-color-surface-container-high`, and
   so on. For canvas (`ctx.fillStyle`), read the token from computed style —
   `resolveTokenColor()` in `src/pages/task-detail/PieceMap.tsx` is the
   existing pattern.
2. In CSS, write `color: var(--mdui-color-on-surface);`.
3. In React inline styles, either pass the token string
   (`color: 'var(--mdui-color-on-surface)'`) or build the function form:
   `rgb(var(--mdui-color-primary))`.
4. Re-run `node scripts/check-no-color-literals.mjs` to confirm.

---

## The bundle-size budget

`scripts/check-bundle-size.mjs` measures `dist-single/index.html` against a
budget. The single-file build inlines the entire application — mdui, echarts,
React, icons — into one document users open from `file://`, so a runaway
dependency shows up as an unusable download.

```sh
node scripts/check-bundle-size.mjs --dir dist-single                  # defaults
node scripts/check-bundle-size.mjs --dir dist-single --budget 2M      # 2 MiB
node scripts/check-bundle-size.mjs --dir dist --check-relative-assets
node scripts/check-bundle-size.mjs --dir dist --json
```

| Flag                       | Effect                                                            |
| -------------------------- | ----------------------------------------------------------------- |
| `--dir <path>`             | Directory to measure (default `dist-single`).                      |
| `--entry <name>`           | Measure only that file (default: `index.html` when present).       |
| `--budget <bytes>`         | Fail when over. Accepts `3145728`, `3M`, `1.5MiB`, `512K`.        |
| `--check-relative-assets`  | Make absolute asset URLs in `index.html` a failure, not a warning. |
| `--json`                   | Machine-readable report.                                           |

**Current budget: 3 MiB (3 145 728 bytes)** for `dist-single/index.html`,
used by the `build:single` job and by release.

The relative-asset check also runs on `dist/index.html`. It is a warning by
default, because it is useful during development; `--check-relative-assets`
promotes it to a hard failure, which is what CI does.

### Updating the budget deliberately

Do **not** just raise the number to make CI green. Before changing it:

1. Run the build and read the reported size.
2. Identify what grew — `node scripts/check-bundle-size.mjs --dir dist-single`
   prints the file list and the percentage of budget used.
3. Decide whether the growth is worth it. A legitimate reason: a new echarts
   chart type, an icon set, a locale. A bad reason: a dependency crept in with
   a feature you did not ship.
4. Update the number in `.github/workflows/ci.yml` (`build:single`) **and**
   `.github/workflows/release.yml` (`Check single-file size budget`), then note
   the new baseline and reason in the pull request.

Both workflows hard-code the budget rather than reading it from
`package.json`, so the change is visible in the diff that raises it.

---

## Reproducing a release locally

```sh
npm ci
npx eslint .
npx tsc -b
npx vitest run
node scripts/check-no-color-literals.mjs
npx vite build
node scripts/check-bundle-size.mjs --dir dist --check-relative-assets
npx vite build --mode single
node scripts/check-bundle-size.mjs --dir dist-single --entry index.html --budget 3145728
```

That is the release job's sequence. Then check the tag invariant by hand:

```sh
node -p "require('./package.json').version"   # must equal the tag without its v
```

To exercise the actual publishing step, create the tag and push it — the
workflow does the rest:

```sh
npm version 0.2.0 --no-git-tag-version   # bump package.json
git commit -am 'chore(release): 0.2.0'
git tag v0.2.0
git push origin main --follow-tags
```

---

## Option-catalogue verification (manual gate)

`src/config/aria2-options.ts` is hand-maintained and drifts whenever
aria2-next gains or retires an option.
`scripts/verify-option-catalogue.mjs` diffs it against a live daemon's
`aria2.getGlobalOption` response.

**CI cannot run this.** It needs a running aria2-next daemon, and shipping a
binary the project does not control is not justified. Treat it as a manual
gate before a release.

Full walkthrough, including the exact `curl`, is in
[`.github/workflows/verify-option-catalogue.example.md`](../.github/workflows/verify-option-catalogue.example.md).
In short:

```sh
# the secret must be params[0]
curl -s -X POST http://127.0.0.1:6800/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"verify","method":"aria2.getGlobalOption","params":["SECRET"]}' \
  | jq .result > aria2-global-option.json

node scripts/verify-option-catalogue.mjs aria2-global-option.json
```

It exits `1` when the daemon reports options the catalogue does not know
(`missing`). Options marked `support: 'removed'` are reported for context and
never fail.

---

## Known gaps

- `@vitest/coverage-v8` is not in `devDependencies`, so `test` runs without
  coverage. Add it to enable the reporting already wired into the workflow.
- `scripts/**/*.test.mjs` is not in the vitest `include` in `vite.config.ts`,
  so `npx vitest run scripts` finds nothing until that glob is widened. CI
  works around it with a throwaway config; the durable fix belongs in
  `vite.config.ts`.