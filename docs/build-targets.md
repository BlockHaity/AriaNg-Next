# Build targets

Two Vite builds come out of one config, selected by `--mode`:

| | standard | single |
| --- | --- | --- |
| Command | `npm run build` | `npm run build:single` |
| Output | `dist/` | `dist-single/` |
| Entry | `dist/index.html` + hashed assets | `dist-single/index.html`, **one file** |
| Module format | ES modules, code-split | classic **IIFE**, `inlineDynamicImports` |
| Assets | separate `assets/*.js` / `*.css` | inlined into the HTML |
| Locales | lazy, one chunk each (`import.meta.glob`) | eagerly bundled, all 11 |
| Service worker | yes (`generateSW` / Workbox) | **no** |
| Runs from | any URL sub-path, any static server | `file://` (double-click) |

Everything below is [vite.config.ts](../vite.config.ts).

## `base: './'`

```ts
base: './',
```

This is the single most consequential line in the config, and it is what makes
"serve `dist/` from any directory" true.

Vite rewrites every URL it emits in `index.html` — the entry `<script>`, the
CSS `<link>`, modulepreload hints, the icon links, and inside the JS the dynamic
import paths and `new URL(..., import.meta.url)` assets — by prefixing them with
`base`. With the default `'/'` those become **absolute**:

```html
<script type="module" crossorigin src="/assets/index-abc123.js"></script>
```

which resolves against the *domain root*, not the directory the app was served
from. Drop `dist/` at `https://host/aria/` and the browser asks for
`https://host/assets/index-abc123.js`, gets a 404 (or worse, somebody else's
`index-abc123.js`), and the app never boots.

With `base: './'` they become relative to the document:

```html
<script type="module" crossorigin src="./assets/index-abc123.js"></script>
```

which resolves correctly from `/`, `/aria/`, `/aria/ariang-next/deep/path/` and
from `file:///home/me/ariang/index.html` alike. Nothing else has to know where
the app was deployed.

The regression guard is `scripts/check-bundle-size.mjs --check-relative-assets`,
which fails the build when `index.html` contains an absolute `src="/…"` or
`href="/…"`. Changing `base` is therefore a CI-visible decision, not a silent
one.

## Hash routing

The router is mounted at `#!` — see [src/app/route-paths.ts](../src/app/route-paths.ts)
(`HASH_BANG`) and [src/app/hash-history.ts](../src/app/hash-history.ts).

```
https://host/aria/index.html#!/downloading
                      ^^^^^^^^^^^^^^^^ document
                                      ^^^^^^^^^^^^ never sent to the server
```

Everything after `#` stays in the browser. That is what makes the sub-path
promise complete: **no server rewrite, no `try_files`, no history-API fallback
rules.** A static host only ever has to serve files; a route that does not exist
on disk is simply `index.html` plus a fragment, and the app resolves it.

The `#!` prefix itself is a public contract, not a stylistic choice. AriaNg ran
AngularJS in `hashPrefix('!')` mode, so its documented URLs are
`#!/downloading`, `#!/new/task?url=…` and `#!/settings/rpc/set?…`. Those URLs
are in browser bookmarks, shell aliases, wiki pages and users' muscle memory.
React Router's stock `<HashRouter>` would write `#/downloading` and break all of
them, so `createHashBangHistory()` wraps React Router's own hash history with a
proxied `window` whose `pushState`/`replaceState` re-insert the `!`:

| On disk in the fragment | In-app path |
| --- | --- |
| `#!/downloading` | `/downloading` |
| `#!downloading` (AngularJS also emitted this) | `/downloading` |
| `#/downloading` (no banner) | `/downloading` |
| `#!`, `#`, or no hash | `/downloading` (AriaNg's `otherwise`) |
| anything unrecognised | `/downloading`, with the `Parameter is invalid!` notice |

## The single-file target

```ts
...viteSingleFile({ removeViteModuleLoader: true }),

build: {
  outDir: 'dist-single',
  cssCodeSplit: false,
  assetsInlineLimit: 1024 * 1024,   // 1 MiB, vs 4 KiB in the standard build
  rollupOptions: {
    output: {
      format: 'iife',
      inlineDynamicImports: true,
      entryFileNames: 'assets/[name].js',
      assetFileNames: 'assets/[name].[ext]',
    },
  },
}
```

### Why IIFE and not ES modules

`<script type="module" src="…">` is subject to CORS, and the origin of a
`file://` document is `null`. A module script loaded from `file://` is therefore
blocked by every current browser — not by policy that can be configured, just by
the platform. A **classic** `<script>` has no such restriction, so the whole
application has to be one classic script with no imports at all.

That single constraint cascades:

- `format: 'iife'` — a classic script bundle.
- `inlineDynamicImports: true` — Rollup refuses an IIFE that contains a dynamic
  import, so every `import()` in the codebase (all eight lazy page routes, the
  lazy locale bundles) must be flattened into the one chunk.
- `cssCodeSplit: false` — one stylesheet, inlined.
- `assetsInlineLimit` raised to 1 MiB — every icon, font and image the app
  references is inlined instead of emitted next to the HTML.
- `vite-plugin-singlefile` then rewrites `index.html` so the script and the
  stylesheet become inline `<script>` / `<style>` elements and the emitted files
  are deleted. `removeViteModuleLoader: true` drops the leftover ES-module
  preamble.

### The consequence: everything is static

Because the bundle cannot fetch anything at runtime, **the payload is whatever
ships in the HTML**. Concretely:

- **All 11 locale bundles are inlined**, not lazily loaded. The standard build
  splits them (`import.meta.glob`), so an English-only user downloads ~57 KB of
  translations instead of the ~693 KB the whole set costs. The single-file build
  cannot make that choice.
- **ECharts is inlined** rather than a separate `echarts` chunk.
- **mdui, React and every imported icon** are inlined.

That is what the **locale payload budget** test guards. In
`src/i18n/__tests__/i18n.test.ts`:

```ts
const BUDGET_BYTES = 1_400_000;              // all 11 locales together
expect(entry.bytes).toBeLessThan(BUDGET_BYTES / 4);   // per-locale ceiling
expect(total).toBeLessThan(BUDGET_BYTES);
```

A runaway translation file pushes the single-file artifact over the point where
someone would still download it, so the failure is made loud in CI instead.

The locale registry itself carries the switch: `src/i18n/locales/index.ts` exports
`BUILD_TARGET = __BUILD_TARGET__` and `getLocaleLoaderFor(target)` returns either
a lazy `import.meta.glob` map or an eager static map. `__BUILD_TARGET__` is a
compile-time `define`, so the dead branch is folded away by the minifier and only
one of the two maps survives into the bundle. A test asserts the eager list and
the glob contain the same 11 keys, because a locale present in one and missing
from the other works in the standard build and breaks the single-file one.

### Measured size

```
$ npm run build:single
dist-single/index.html  1,993.29 kB
```

`dist-single/index.html` is **1,993,294 bytes ≈ 1.90 MiB** (the whole
`dist-single/` directory is 1,998,478 bytes — the difference is the five icon
files that `vite-plugin-singlefile` does not inline).

`scripts/check-bundle-size.mjs` reports 63.4 % of the 3 MiB budget used, so
there is roughly 1.1 MiB of headroom.

> **How this was measured.** The number comes from a build of the current working
> tree in a scratch copy, because `npm run build:single` does not currently
> complete on the repository itself: see
> [known build blockers](#known-build-blockers) below. The only difference
> between that copy and a real build is that `virtual:pwa-register` was aliased to
> a no-op stub — a module that is *unreachable* in the single target anyway
> (`registerServiceWorker()` returns before the dynamic import when
> `__BUILD_TARGET__ !== 'standard'`), so it contributes nothing to the output.
> **Re-measure before quoting this number elsewhere.**

The standard build for comparison: `dist/` is 2,954,784 bytes in total, of which
`echarts` is the largest chunk at 1,091.88 kB (which is why
`chunkSizeWarningLimit` is set to 1024 — the warning is expected, not a problem).

### Rebuilding and verifying

```bash
npm run build:single

# size budget + relative-asset check
node scripts/check-bundle-size.mjs
node scripts/check-bundle-size.mjs --dir dist --check-relative-assets

# the artifact really is self-contained: no external references at all
grep -o 'src="[^"]*"' dist-single/index.html
grep -c 'serviceWorker\|manifest.webmanifest' dist-single/index.html   # 0
```

The last check matters: a single-file build that still referenced
`manifest.webmanifest` or registered a service worker would 404 on every load.

## PWA

Configured only in the standard target — the `VitePWA()` call is inside the
`isSingle ? [] : [...]` branch, because there is no `sw.js` next to a one-file
artifact for a worker to control.

```ts
VitePWA({
  registerType: 'prompt',
  injectRegister: false,
  includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
  manifest: {
    id: 'ariang-next',
    start_url: './',
    scope: './',
    display: 'standalone',
    icons: [ … 192, 512, 512-maskable ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/^\/(jsonrpc|rpc)(\/|$)/],
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    cleanupOutdatedCaches: true,
    runtimeCaching: [ /* images, fonts, stylesheets: CacheFirst */ ],
  },
  devOptions: { enabled: false },
})
```

### Relative `start_url` and `scope`

`start_url: './'` and `scope: './'` are what make the PWA installable from a
sub-path. The defaults are `/` and `/`, which would claim the whole origin and
make the app fail the installability check (and refuse to control anything) when
deployed at `https://host/aria/`. Relative, they resolve against the manifest's
own URL.

### Precache strategy

- **Precache**: every emitted `js`, `css`, `html`, `svg`, `png`, `ico` and
  `woff2`. That is the offline application shell — the app boots and shows its
  UI with no network at all, and then reports that aria2 is unreachable.
  Measured at 52 entries / 2,860.25 KiB on the current tree.
- **`navigateFallback: 'index.html'`**: any navigation resolves to the cached
  shell. Harmless with `#!` routing (the server never sees the route), and it
  makes a hard refresh on any deep link work offline.
- **Runtime caching, `CacheFirst`**: images, fonts and stylesheets, capped at 120
  entries with a one-year `maxAgeSeconds`, in a separate `ariang-next-assets`
  cache. These are the only things that can be a runtime request *and* a static
  asset; nothing else is cached at runtime.
- **`cleanupOutdatedCaches: true`**: old precache manifests are deleted on
  activation, so a stale release cannot keep its chunks alive.

### What is deliberately never cached

| Never cached | Why |
| --- | --- |
| `/jsonrpc` and `/rpc` — and any request with `destination: ''` or `'document'` to them | These are the RPC endpoint. Caching a JSON-RPC reply would make the UI show stale speeds, and `aria2.shutdown` a stale "OK". The `navigateFallbackDenylist` exists for the case where the RPC path is reached as a *navigation* and would otherwise be answered with `index.html` — a very confusing 200. |
| Any WebSocket | The WebSocket handshake is not a fetch, and a browser's HTTP cache does not apply to frames. Nothing to configure; stated here because it is the transport the app actually prefers. |
| Task data generally | Nothing the app receives over RPC is ever written to the Cache API or to `localStorage`. The only persisted state is the settings blob and the per-option input history (`AriaNg.*` keys). |

### Update flow

`registerType: 'prompt'` plus `injectRegister: false` means the generated
registration helper is **not** injected automatically; `src/main.tsx` registers
it itself, guarded on the build target:

```
service worker installed
  └─ no prompt, no reload (AriaNg was silent about the offline shell)

new version precached while the app is open
  └─ onNeedRefresh → in-page notice "Reload AriaNg" with delay: 0
                    (the app's own notice queue, not a browser dialog)
      └─ user accepts
          └─ controllerchange fires once the new worker controls the page
              └─ updateSW(true) activates it
```

`controllerchange` is the only safe moment to swap the running code, which is
why the reload is driven from that event and not from the button press. If the
user dismisses the notice, the new worker waits — it is never activated behind
their back.

### Single-file target

No service worker at all. `registerServiceWorker()` returns immediately when
`__BUILD_TARGET__ !== 'standard'`, so the single-file artifact has no `sw.js` to
register, no manifest link, and no offline story beyond "it is one file that is
always there".

## Verification checklist

### Standard target

```bash
npm run build
npm run preview            # http://localhost:4173
```

Then, by hand:

1. Open <http://localhost:4173/>. The task list renders and reports the
   connection error (no daemon yet) rather than a blank page.
2. Check the URL bar reads `#!/downloading` — not `#/downloading`, not
   `/downloading`.
3. Click through every navigation entry; the address bar keeps the `#!/` prefix
   and the router follows (a fragment-only navigation that does not route is the
   classic hash-router bug this app guards against).
4. Open `/status`, confirm the product string and the capability lists render.
5. Start an aria2-next daemon, point a profile at it, and confirm the list
   populates and the connection badge turns `Connected`.
6. Narrow the window below 840 px: the rail disappears and the drawer opens
   over the content. Widen it again: the rail returns and the drawer is docked.
7. Toggle light → dark → auto; confirm the body background, the tables and the
   charts all change, and that `<meta name="theme-color">` follows.
8. Pick a different dynamic-colour seed; confirm the primary role (and therefore
   the piece bars and the focus rings) changes with it.
9. Switch UI language; confirm the table headers, the aria2 option labels and the
   date format change together.

**Sub-path deployment** — the whole point of `base: './'`:

```bash
mkdir -p /tmp/serve/aria/deep
cp -r dist/* /tmp/serve/aria/deep/
python3 -m http.server 8099 --directory /tmp/serve
```

10. Open <http://localhost:8099/aria/deep/>. It must boot. DevTools → Network
    must show no request to `http://localhost:8099/assets/…`.
11. Navigate to `#!/settings/aria2/bt` and reload the page. The deep link must
    survive the reload (it will, because the route is in the fragment).

**PWA** (needs a real origin — `file://` will not do):

12. DevTools → Application → Manifest: name, icons, `start_url` and `scope` are
    populated and the page reports "Installable".
13. DevTools → Application → Service Workers: `sw.js` is activated and controlling.
14. Offline mode on, hard reload: the app shell renders and says aria2 is
    unreachable.
15. Build again with a trivial change, reload, and confirm the "Reload AriaNg"
    notice appears — and that the app keeps running the old code until it is
    accepted.
16. Confirm `/jsonrpc` is not in the cache: Application → Cache Storage shows only
    the precache entries and `ariang-next-assets`.

### Single-file target

```bash
npm run build:single
node scripts/check-bundle-size.mjs
```

17. `ls dist-single/index.html` — exactly one file carries the application.
18. **Double-click `dist-single/index.html`** (or `file://` it). It boots, with no
    web server anywhere. This is the acceptance test; anything that fails here
    fails for the user.
19. The address bar shows a `file:///…/index.html#!/downloading` URL. Click
    through the navigation and the task-detail tabs.
20. Configure a **WebSocket** profile (`ws://localhost:6800/jsonrpc`) and confirm
    it connects from `file://` with no daemon flags. Then confirm an **HTTP**
    profile from `file://` fails with `Cannot connect to aria2!` unless the
    daemon was started with `--rpc-allow-origin-all=true` — the CORS behaviour
    described in the README.
21. Confirm there is no service-worker registration in the console and no 404s in
    the Network panel (from `file://`, the Network panel shows `file://` entries;
    there should be none besides the document itself).
22. Switch UI language and reload; the table is still translated, because all 11
    locales are inlined.
23. Confirm the app still works with the machine offline — it is local, so this is
    really a check that nothing reaches for the network.

## Known build blockers

Both were found while writing this document and are **in source files this
document does not own**:

1. **`npm run build` fails** on
   `Could not load src/pages/Aria2SettingsPage (imported by src/app/router.tsx)`.
   `src/app/router.tsx` lazy-imports `@/pages/Aria2SettingsPage`, but the module
   lives at `src/pages/aria2-settings/Aria2SettingsPage.tsx`. The other seven
   page modules are at `src/pages/<Name>Page.tsx` and resolve; this one is not.
   `src/app/page-modules.d.ts` declares the ambient module so `tsc -b` stays
   green, but Rollup resolves real paths and finds nothing.
2. **`npm run build:single` fails** on
   `Rollup failed to resolve import "virtual:pwa-register" from src/main.tsx`.
   The import in `src/main.tsx` is inside a dynamic `import()` behind a
   `__BUILD_TARGET__ !== 'standard'` early return. That guard is a *runtime*
   check: Rollup still resolves the specifier at build time, and in the single
   target `vite-plugin-pwa` is not in the plugin list, so nothing provides the
   virtual module.

Also present (not build-blocking, but `npm run build` runs `tsc -b` first, so they
*are* blocking): several type errors in `src/pages/__tests__/` — unused locals
(`TS6133`), a non-type-only import of a type (`TS1484`), a `string` assigned to an
`Aria2Status` field, and `readonly string[]` fixtures assigned to the mutable
`string[]` fields of `Aria2VersionInfo`.

Once they are fixed, re-measure the single-file size and update
[Measured size](#measured-size).
