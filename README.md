# AriaNg Next

A web front end for the [aria2-next](https://github.com/AnInsomniacy/aria2-next)
download engine, written from scratch in TypeScript and React 19, bundled with
Vite 7, and rendered with [mdui](https://github.com/fernvenue/mdui)'s Material
Design 3 implementation. It is a **pure front end**: there is no server, no
backend and no bundled aria2 of any kind. Everything it does, it does by
speaking aria2's JSON-RPC protocol to a daemon you run yourself — and it targets
**aria2-next**, not upstream aria2: seven RPC methods, the native media
(HLS/DASH) engine, the ED2K/eMule engine and a large part of the option
catalogue exist only in aria2-next.

It is a re-implementation of
[AriaNg](https://github.com/mayswind/AriaNg) (MIT), not a fork: the behaviour,
routes, keyboard shortcuts, command-line URL API and translation resources are
derived from AriaNg, while the implementation, the data layer and the design
system are new. See [NOTICE.md](NOTICE.md) and
[migrating-from-ariang.md](docs/migrating-from-ariang.md).

> **This repository is version `0.1.0` and is not released.** Features below are
> described as they are implemented in `src/`; treat the README as a development
> document.

## Screenshots

> TODO: add screenshots
>
> Placeholder only — no image files are referenced by this document yet. When
> they are added, the following are the views worth capturing (and the ones the
> screenshots must not contradict):
>
> - `/downloading` with a mix of HTTP and torrent tasks (task rows, the
>   determinate progress bar with its inline percentage).
> - A task detail page with the piece map (`?tab=pieces`) and with the file tree
>   showing a partially selected directory (tri-state checkbox).
> - A media task's media tab, in `downloading` and in `finalizing` phase, to show
>   the indeterminate progress bar an unknown output length produces.
> - The light and dark themes side by side, plus one screenshot with a
>   non-default MD3 dynamic colour seed.
> - The ED2K search page with results.
> - The narrow (drawer) and wide (rail) layouts.

## Features

### Task lists

One list component serves the three aria2 buckets — `/downloading`,
`/waiting` and `/stopped` — exactly as AriaNg's single `list` view did. Each
row shows the name, size, progress, speeds, ETA, peers/seeders and the
connection count.

- **Sorting** by `default`, `name`, `size`, `percent`, `remain`, `dspeed`,
  `uspeed`, ascending or descending, with a separate order for each of the three
  pages when `taskListIndependentDisplayOrder` is on.
- **Filtering** by a case-insensitive name substring.
- **Drag reordering** on `/waiting` only, and only while the sort is `default`:
  `aria2.changePosition` addresses a slot in aria2's queue, so a sorted list is
  the one place where "the third visible row" and "queue position 2" are not
  the same thing. The index is computed from the server order, not the filtered
  view.
- **Context menu** with the AriaNg action set (retry, start, pause, delete, the
  seven display orders in an mdui submenu, and the select-all / select-failed /
  select-completed entries), scoped by bucket the way AriaNg scoped it — the
  retry entry only appears when a retryable task is selected, and the status
  entries only where they mean something.
- **Multi-select** with *select all*, *select failed*, *select completed* and
  batch operations that report "3 of 5 removed" instead of an all-or-nothing
  result.
- A **health meter** on the task detail Overview tab for tasks whose integrity is
  still being checked, and a global speed chart in the shell.

### Task detail

`/task/detail/:gid`, with the tabs AriaNg had plus the aria2-next media tab:

- **Overview** — every field aria2 reports, including the aria2-next
  `errorMessage`, `dir`, `following` and `belongsTo`.
- **Pieces** — the task's piece map and a per-piece breakdown. Whether it is
  shown is governed by the `showPiecesInfoInTaskDetailPage` setting
  (`always` / `le1024` / `le10240` / `le102400` / `never`).
- **Files** — a real directory tree for multi-file torrents, with **tri-state**
  directory checkboxes (unselected / partial / selected). A "choose files"
  toolbar offers *select all* / *select none*, *invert*, per-category shortcuts
  (video, audio, picture, document, application, archive — only the categories
  the torrent actually contains) and a custom dialog; the selection is submitted
  as the `select-file` option.
- **Peers** — the connected peers with their bitfields, per-peer piece bars,
  client names and speeds.
- **Options** — the per-task option rows aria2 accepts through
  `aria2.changeOption` for this task's state, filtered to the keys the engine
  still honours.
- **Media** (aria2-next) — HLS/DASH phase, protocol, live flag, progress by
  media duration, the available tracks and the structured error code. Progress is
  shown as indeterminate while `lengthKnown` is `false`, because an unknown output
  size is not 0 %.

### New task

`/new`, with the AriaNg link editor plus aria2-next's two new input kinds:

- **Links** — one URL per line, with validation, per-line removal and the
  "Download Now" / "Download Later" actions.
- **Torrent file** — a `.torrent` upload, base64-encoded for
  `aria2.addTorrent`. The RPC client also exposes `aria2.inspectTorrent`
  (parse a torrent for its name and file list without creating a task); the
  new-task page does not call it yet.
- **Metalink file** — a `.meta4`/`.metalink` upload for `aria2.addMetalink`.
- **Media** (aria2-next) — an HLS/DASH/collection manifest, recognised from the
  URL and submitted with the `media*` options and track selection.
- **ED2K** (aria2-next) — an `ed2k://` link, recognised from the URL and
  submitted with the `ed2k-*` options.
- **Options tab** — every task option this frontend knows, with the same
  validation, unit suffixes, allowed-value lists and per-option input history
  as the global editor.
- **Export Command API** — the `#!/new/task?url=…` URL for the current form, so
  the task can be handed to a browser shortcut, a shell alias or a wiki page.

### Option editing

Two editors over one catalogue (`src/config/aria2-options.ts`, 269 keys):

- **Global** — AriaNg's eight settings groups plus the two aria2-next adds,
  `ed2k` and `media`, for ten in all, reachable at `/settings/aria2/:group`.
- **Per task** — the 47 catalogue rules, filtered for the task's protocol
  (HTTP-only rows are hidden for torrents and BitTorrent rows for everything
  else) and for its state (`canShow` / `canUpdate`).
- Every key carries its aria2-next compatibility (`support: 'current'` or
  `'removed'`) and, for retired keys, the note explaining what replaced it.
  Retired keys are never offered as an editable row.

### ED2K search

`/ed2k/search` — `aria2.ed2kSearch` starts a search and returns a GID;
`aria2.getEd2kSearchResults` reads the accumulating results. Results can be
filtered, sorted, copied, or turned straight into a download through
`aria2.addUri` with the `ed2kLink` from the result.

### Connection

- **Multiple RPC profiles**, each with its own host, port, interface, protocol,
  HTTP method, custom request headers and secret. Switching profile does not
  reload the page (see
  [architecture.md](docs/architecture.md#hot-profile-switching)).
- **WebSocket first** (`ws://`, `wss://`) with an **HTTP fallback**
  (`http://`, `https://`, `POST` or `GET`). Notifications only exist over
  WebSocket.
- Automatic reconnect with a configurable interval, an explicit connection
  state (`Connecting` / `Connected` / `Waiting to reconnect` / `Reconnecting` /
  `Disconnected`) and a status row in the navigation drawer.
- The secret is sent both as `params[0]` = `token:<secret>` (for `aria2.*`
  calls) and as an `Authorization: Bearer` header.

### Interface

- **Material Design 3** through mdui only, with **no colour literal in the
  codebase** — see [material-design.md](docs/material-design.md).
- **Light / dark / auto** themes plus **MD3 dynamic colour**: pick one of the
  twelve baseline palette seeds (or extract one from an image) and every
  `--mdui-color-*` role is regenerated.
- **11 languages** — the same set AriaNg shipped, with the same translations:
  `cz_CZ`, `de_DE`, `en`, `es`, `fr_FR`, `it_IT`, `ja_JP`, `pl_PL`, `ru_RU`,
  `zh_Hans`, `zh_Hant`. Browser-language negotiation works with both bare
  subtags (`ja`) and region-qualified tags (`zh-CN`).
- **Responsive navigation** following the MD3 mapping: a modal navigation drawer
  below 840 px, a navigation rail above it.
- **Keyboard shortcuts** (`⌘` on macOS, `Ctrl` elsewhere): `Delete` removes the
  selected tasks, `⌘/Ctrl+A` selects all visible tasks, `⌘/Ctrl+F` focuses the
  search box, `⌘/Ctrl+Enter` is "Download Now". The whole set is documented in
  the settings page and can be switched off.
- **Touch swipe gestures** for the drawer and for tab switches, gated by the
  `swipeGesture` setting.

### Distribution

- **PWA** — installable, with an offline application shell. See
  [build-targets.md](docs/build-targets.md#pwa).
- **Command-line URL API** — the AriaNg `#!/…` URLs keep working, including
  `#!/new/task?url=…` and `#!/settings/rpc/set?…`.

## Requirements

- **Node.js 20.19.0 or newer** (`engines.node` in `package.json`).
- **A modern browser**: ES2022, `import.meta.glob`, `fetch` + `AbortController`,
  CSS custom properties, custom elements / Shadow DOM. Chromium, Firefox and
  current Safari are all fine.
- **An aria2-next daemon with RPC enabled.** Upstream aria2 works for everything
  except the aria2-next-only methods, options and features, which will simply
  fail with a JSON-RPC error.

## Quick start

### Development

```bash
npm install
npm run dev
```

Vite serves the app on <http://localhost:5173> (it takes the next free port if
5173 is taken).

### Production build, served from any sub-path

```bash
npm run build
```

The output is `dist/`. Because `base` is `'./'`, every asset URL is relative, so
`dist/` can be served from `https://host/`, from `https://host/aria/` or from a
GitHub Pages project page without any configuration and **without any server
rewrite** — the app routes on `#!`. Any static file server works:

```bash
python3 -m http.server 8080 --directory dist
```

> `npm run build` does not currently complete on this tree; see
> [Known build blockers](docs/build-targets.md#known-build-blockers).

### Single-file build, runnable from `file://`

```bash
npm run build:single
```

The output is `dist-single/index.html`, one self-contained file with no external
requests. Copy it anywhere, or double-click it: it runs from `file://` without a
web server. See [build-targets.md](docs/build-targets.md) for the constraints
that shape this target and for the [known build
blockers](docs/build-targets.md#known-build-blockers) that currently stop
`npm run build:single` from finishing.

## Connecting to aria2-next

Start a daemon with RPC enabled:

```bash
aria2-next \
  --enable-rpc=true \
  --rpc-listen-all=false \
  --rpc-listen-port=6800 \
  --rpc-secret=YOUR_SECRET \
  --daemon=true
```

Then either set the profile by hand in **Settings → AriaNg Settings → RPC**, or
hand the app a prepared URL:

```
http://localhost:8080/#!/settings/rpc/set?protocol=http&host=localhost&port=6800&interface=jsonrpc&secret=<base64url(YOUR_SECRET)>
```

The default profile points at:

| | |
| --- | --- |
| HTTP JSON-RPC | `http://localhost:6800/jsonrpc` |
| WebSocket JSON-RPC | `ws://localhost:6800/jsonrpc` |

`secret` is base64url-encoded in that URL, exactly as AriaNg required. On first
visit the host defaults to the hostname the page itself was served from
(`window.location.hostname`), and an `https://` page forces `https://` so the
browser never blocks a plaintext sub-resource.

### The `file://` caveat

This is the single most frequent first-run failure, so it is worth stating
plainly.

When the app runs from `file://`, the page's origin is `null`. The browser sends
`Origin: null` with the JSON-RPC `POST`, and aria2-next only adds
`Access-Control-Allow-Origin: *` when `--rpc-allow-origin-all=true`. Without it
the response is rejected by the browser's CORS check and the app reports
`Cannot connect to aria2!` even though the daemon is healthy and reachable.

Two ways out:

1. **Use a WebSocket profile** (`ws://localhost:6800/jsonrpc`). The WebSocket
   handshake is not subject to CORS, so this works from `file://` with no daemon
   flags at all. Recommended for the single-file build.
2. **Start the daemon with `--rpc-allow-origin-all=true`** if you need HTTP:

   ```bash
   aria2-next --enable-rpc=true --rpc-allow-origin-all=true --rpc-secret=YOUR_SECRET
   ```

`--rpc-allow-origin-all` is a daemon-wide relaxation: it makes the RPC endpoint
readable from any origin, so keep it on a trusted network and keep
`--rpc-secret` set.

## Project layout

```
src/
  app/            route table, the `#!` hash history, the router, the MD3 shell
  components/     shared widgets (the option row and its validation)
  config/         option catalogue, option groups, defaults, languages, RPC constants
  domain/         pure logic: normalisation, paths, file tree, pieces, peers, selection
  i18n/           translation tables (11 locales), the i18n store, Intl formatters
  pages/          one directory per route (task list, task detail, new task, settings, …)
  rpc/            contract, client, method catalogue, transports (websocket / http)
  store/          zustand stores, the scheduler, batch commands
  ui/mdui/        the mdui wrapper layer (see src/ui/mdui/README.md)
  utils/          base64, clipboard, files, keyboard, swipe
docs/             the documents linked from this README
scripts/          language conversion, icon generation and the repo guards
```

The dependency direction is one-way: `rpc/` → `domain/` → `store/` → `pages/` +
`components/`, with `config/`, `i18n/`, `ui/mdui/` and `utils/` cross-cutting.
Only `src/rpc/contract.ts` is public to the layers above. See
[architecture.md](docs/architecture.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | `tsc -b && vite build` → `dist/` (standard target, with the PWA). |
| `npm run build:single` | `tsc -b && vite build --mode single` → `dist-single/` (single-file target). |
| `npm run preview` | Serves the last standard build, to check it as deployed. |
| `npm run typecheck` | Type-checks the app and node configs without emitting. |
| `npm run lint` | ESLint over the whole repository. |
| `npm test` | Runs the vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:ui` | Vitest with its browser UI. **Currently broken:** the script exists but `@vitest/ui` is not in `devDependencies`, so it fails until that package is added. |

Repository guards that are run directly rather than through npm:

```bash
node scripts/check-no-color-literals.mjs      # MD3 colour guard
node scripts/check-bundle-size.mjs            # single-file size + relative-asset check
node scripts/verify-option-catalogue.mjs      # diff the option catalogue against getGlobalOption
```

## Testing and linting

- **Unit tests** — vitest with `jsdom`, run by `npm test`. The suites cover the
  pure layers (`src/domain`, `src/rpc`, `src/config`), the stores
  (`src/store`), the i18n pipeline and the mdui wrapper hooks. The vitest
  `coverage.include` is deliberately `src/domain/**`, `src/rpc/**`,
  `src/config/**`: the layers where a silent regression is expensive.
- **Type checking** — `tsc -b` over three projects (`tsconfig.app.json`,
  `tsconfig.node.json`, `tsconfig.test.json`). Both build scripts type-check
  before bundling, so a type error cannot reach a release artifact.
- **Linting** — ESLint with `typescript-eslint` (recommended set), the React
  Hooks rules and `no-console` limited to `warn`/`error`.
- **Colour guard** — `scripts/check-no-color-literals.mjs` fails on any raw
  colour in shipped source. See [material-design.md](docs/material-design.md).
- **Size guard** — `scripts/check-bundle-size.mjs` fails when
  `dist-single/index.html` grows past its byte budget, and can fail when the
  standard build emits an absolute asset URL.
- **Catalogue guard** — `scripts/verify-option-catalogue.mjs` diffs
  `src/config/aria2-options.ts` against a real `aria2.getGlobalOption` dump.
- **Manual verification** — the shell agent's own notes; see
  [build-targets.md](docs/build-targets.md#verification-checklist) for the
  per-target checklist and [architecture.md](docs/architecture.md#testing-strategy)
  for what is deliberately left to manual testing.

## License and attribution

- This project is MIT licensed — see [LICENSE](LICENSE).
- The translated UI strings in `src/i18n/locales/` originate from AriaNg's
  `src/langs/*.txt` and are covered by AriaNg's MIT license — see
  [NOTICE.md](NOTICE.md) and [LICENSE.ariang](LICENSE.ariang).
- **No aria2 source code is included.** aria2 and aria2-next are GPLv2; this
  repository only speaks their JSON-RPC protocol.
- UI components come from mdui (MIT); icons from `@mdui/icons`. No Material
  Design art assets are redistributed.

## Project web site

> TODO: add the project web site link
>
> Placeholder — no URL is asserted here yet.

## Contributing

> TODO: add the contributing guide link
>
> Placeholder. In the meantime: read [docs/architecture.md](docs/architecture.md)
> and [docs/rpc.md](docs/rpc.md) before changing the data layer, read
> [src/ui/mdui/README.md](src/ui/mdui/README.md) before adding a component, and
> keep `npm run lint`, `npm test` and `npx tsc -b` green.

## Documentation

- [docs/architecture.md](docs/architecture.md) — layers, incremental refresh,
  scheduler, state, profile switching, testing.
- [docs/rpc.md](docs/rpc.md) — transports, method table, notifications and the
  protocol gotchas.
- [docs/build-targets.md](docs/build-targets.md) — the two build targets and the
  PWA.
- [docs/material-design.md](docs/material-design.md) — the MD3 compliance
  checklist.
- [docs/migrating-from-ariang.md](docs/migrating-from-ariang.md) — coming from
  AriaNg.
