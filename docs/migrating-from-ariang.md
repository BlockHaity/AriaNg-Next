# Migrating from AriaNg

AriaNg-Next is a from-scratch re-implementation of AriaNg, so this is a
migration, not a port. Most of what an AriaNg user relies on is unchanged;
this document lists what stays, what changes, and how to bring your settings
across.

## What is identical

These are compatibility guarantees, not coincidences.

| | |
| --- | --- |
| **Routes** | The route table in `src/app/route-paths.ts` is AriaNg's, path for path: `#!/downloading`, `#!/waiting`, `#!/stopped`, `#!/new`, `#!/new/task`, `#!/task/detail/:gid`, `#!/settings/ariang`, `#!/settings/ariang/:extendType`, `#!/settings/rpc/set`, `#!/settings/rpc/set/:protocol/:host/:port/:interface/:secret`, `#!/debug`, `#!/status`. Unknown paths land on `#!/downloading` with the `Parameter is invalid!` notice, exactly as AriaNg's `otherwise('/downloading')` did. `#!/ed2k/search` is new. `#!/settings/aria2/:group` is the ten-group settings navigation, which AriaNg reached through its own sidebar rather than a URL. |
| **`#!/` hash prefix** | Not `#/`. See [build-targets.md](build-targets.md#hash-routing). Every AriaNg bookmark, shell alias and shortcut keeps working. The router also tolerates AriaNg's slash-less `#!downloading` form and a bare `#/downloading`. |
| **Command-line URL API** | `#!/new/task?url=<base64url>&<aria2-option>=<value>…` and `#!/settings/rpc/set?protocol=&host=&port=&interface=&secret=` behave as before, including the rules that `pause=true` adds the task paused and redirects to `#!/waiting` rather than `#!/downloading`, that every query key which is a valid aria2 option key becomes a task option, that the query string wins over the path parameters, and that the secret is base64url-encoded in the URL. |
| **The settings storage key** | `AriaNg.Options`, in `localStorage`, JSON, with `AriaNg.Notifications`, `AriaNg.History.*` and `AriaNg.Language.*` alongside it. AriaNg-Next reads and writes the same keys, so both apps can share a profile. |
| **Default values** | Every key of `DEFAULT_SETTINGS` is AriaNg's value: `theme: 'light'`, `title: '${downspeed}, ${upspeed} - ${title}'`, `titleRefreshInterval: 5000`, `webSocketReconnectInterval: 5000`, `globalStatRefreshInterval: 1000`, `downloadTaskRefreshInterval: 1000`, `rpcPort: '6800'`, `rpcInterface: 'jsonrpc'`, `protocol: 'http'`, `httpMethod: 'POST'`, `showPiecesInfoInTaskDetailPage: 'le10240'`, and so on. `APP_CONSTANTS` ports AriaNg's `httpRequestTimeout` (20 s), `lazySaveTimeout` (500 ms) and `cachedDebugLogsLimit` (100) too. |
| **The option catalogue** | AriaNg's 162 `aria2AllOptions` entries with their type, suffix, separator, `required`, `readonly`, `overrideMode`, `submitFormat`, `showCount`, `trimCount`, `min`/`max` and validation pattern — including the exact four `text` rows (`header`, `bt-tracker`, `bt-exclude-tracker`, `no-proxy`) and `header` as the only `append` option. |
| **Settings groups** | AriaNg's eight global option groups, in AriaNg's navigation order. `ed2k` and `media` are added; `http-ftp-sftp` and `ftp-sftp` keep AriaNg's names even though aria2-next retired FTP. |
| **Per-task option rules** | AriaNg's `aria2TaskAvailableOptions` — 32 rows with the same `category` (`global` / `http` / `bittorrent`), the same `canShow` and `canUpdate` masks (`'new|waiting|paused'`), and the same "history dropdown only on `dir`" rule. Fifteen rows are added for aria2-next. |
| **Translations** | The same 11 locales with the same strings. `src/i18n/locales/*` are converted from AriaNg's `src/langs/*.txt` by `scripts/convert-langs.mjs`. |
| **Keyboard shortcuts** | `⌘/Ctrl+A` (select all), `⌘/Ctrl+F` (focus search), `⌘/Ctrl+Enter` (Download Now), `Delete` (remove selected) — same keys, same actions, same "ignored while a text field has focus" rule for `⌘A` and `Delete`. `⌘` on macOS, `Ctrl` elsewhere, detected through `navigator.userAgentData.platform` with `navigator.platform` as the fallback. |
| **Sweep of the smaller behaviours** | The title templating (`${downspeed}`, `${upspeed}`, `${title}`, `${rpcprofile}`, `${downloading}`, `${waiting}`, `${stopped}` and their `:noprefix` / `:nosuffix` / `:scale=n` tags, with AriaNg's exact tag regex). Per-option input history, newest first, capped at 10. Natural-order sorting of RPC aliases by alias. The `localStorage` → `document.cookie` → in-memory storage fallback. The `Volume` filters, which keep AriaNg's `KB`/`MB`/`GB` labels stepping by 1024. |

## Importing your settings

**Settings → AriaNg Settings → Import Settings** accepts a pasted blob or an
`AriaNgConfig.json` file. An export produced by AriaNg itself imports directly:

```jsonc
// AriaNg's Export Settings output, imported as-is
{
  "language": "zh_CN",          // → collapsed onto "zh_Hans"
  "theme": "dark",
  "title": "${downspeed}, ${upspeed} - ${title}",
  "rpcHost": "nas.local",
  "rpcPort": "6800",
  "protocol": "http",
  "http": "POST",
  "secret": "eXhhbXBsZQ==",     // base64 in, decoded at runtime
  "extendRpcServers": [
    { "rpcAlias": "seedbox", "rpcHost": "10.0.0.9", "rpcPort": "6801",
      "rpcInterface": "jsonrpc", "protocol": "ws", "httpMethod": "POST",
      "rpcRequestHeaders": "", "secret": "c2VjcmV0" }
  ]
}
```

What the import does:

- **Unknown keys are dropped.** Only keys that exist in `DEFAULT_SETTINGS` are
  read; anything else in the file is ignored. A key added by a newer AriaNg-Next
  release is back-filled with its default and the blob is rewritten, so the
  migration is durable instead of repeating on every boot.
- **Type mismatches are rejected per key.** A value whose JavaScript type does
  not match the default's type is skipped, and the default is kept.
- **Arrays are never copied wholesale.** `extendRpcServers` is rebuilt field by
  field through `sanitizeRpcProfile`, into a fresh object: unknown fields,
  prototypes and a smuggled `isDefault` never survive.
- **`secret` is decoded, not re-encoded.** A stored base64 secret becomes plain
  text in memory; a hand-edited plain-text secret also works, because a failed
  decode returns the input unchanged (AriaNg's `angular-base64` did the same).
- **`rpcPort` is coerced** with `Math.max(parseInt(v) || 0, 0)`, and
  `protocol` / `httpMethod` fall back to the default when the value is not one of
  `http|https|ws|wss` / `POST|GET`.
- **A legacy language key is repaired** through the canonical registry:
  `zh_CN`, `zh-CHS`, `zh_SG` collapse onto `zh_Hans`, `zh_TW` / `zh_HK` / `zh_MO`
  onto `zh_Hant`. `auto` passes through untouched — it is AriaNg's
  "follow the browser" value.
- **An empty `rpcHost` is filled in** from the page's own hostname, and an
  `https://` page forces `protocol: 'https'` so the browser does not block a
  plaintext sub-resource.
- **The whole blob is written back immediately** and the page reloads, because
  every connection setting — including the decoded secrets — has changed.

### How the RPC profiles map

AriaNg's model is preserved exactly: the top-level `rpcAlias` / `rpcHost` /
`rpcPort` / `rpcInterface` / `protocol` / `httpMethod` / `rpcRequestHeaders` /
`secret` settings *are* the default profile, and `extendRpcServers` holds the
rest. `src/store/profiles.ts` derives the profile array from those two sources
rather than storing it separately, so index 0 is always the default profile and
it has no `rpcId`.

One addition: `AriaNg.Options` entries in `extendRpcServers` that have no
`rpcId` get a fresh one (`crypto.randomUUID`, or AriaNg's base64 recipe where it
is unavailable), so an imported profile can be addressed unambiguously.

## Deliberate differences

### Hot profile switching — no page reload

AriaNg captured the RPC transport once, when AngularJS built its services, and a
profile change called `location.reload()`.

AriaNg-Next swaps the transport in place: `client.connect(profile, …)` tears the
old transport down, fails every in-flight request immediately so a pending
`tellStatus` never resolves against the new server, and clears everything that
belongs to the old server (task list, detail cache, peer cache, speed history,
version, global stat, the auth latch). See
[architecture.md](architecture.md#hot-profile-switching).

**What this changes for you:** switching servers no longer costs a reload, so you
keep your place on a task detail page and your filter text. What it does *not*
change: sort orders and the task selection are global settings, not per-server
state, and they survive the switch.

### Incremental refresh, one scheduler

- **One scheduler replaces seven `$interval`s.** Ticks never overlap, `0`
  disables a job, a job can be paused without being unregistered, and the whole
  thing suspends when the tab is hidden. AriaNg kept polling a background tab;
  AriaNg-Next stops, which means a task list you are not looking at does not
  refresh until you come back to it — at which point the first tick is
  immediate.
- **The incremental merge is preserved** (basic key set every tick, full key set
  only after a structural change), so a large queue does not re-download every
  file list every second. See
  [architecture.md](architecture.md#the-incremental-refresh).
- **One sorting fix.** AriaNg built its task comparator with `_.sortBy` and then
  called `.reverse()`, which flipped "missing values sort last" into "missing
  values sort first" for every descending order. Missing values now sort last in
  both directions.

### `Intl` instead of moment.js

AriaNg's `$filter('number')`, `moment` and its custom filters (`volume`,
`percent`, `dateDuration`, `longDate`, `timeDisplayName`) are reproduced against
`Intl` in `src/i18n/format.ts`, including the quirks: the truncation in
`verifiedLength / totalLength`, the two-fraction-digit default, Angular's
20-fraction-digit cap, the "More Than One Day" cutoff, and the `KB`/`MB`/`GB`
labels that step by 1024. Date patterns come from the per-language
`format.longdate` that AriaNg stored in `src/langs/*.txt`, translated into
`Intl.DateTimeFormat` syntax (`YYYY` → `yyyy`).

One upstream bug is fixed: AriaNg's `cz_CZ` pattern is `MM/DD/RRRR HH:mm:ss`,
where `RRRR` is not a real moment token. It is rendered as a calendar year.

### `selectFile` is an option, not a method

There is no `aria2.selectFile` RPC method. File selection is the `select-file`
**option**, set through `aria2.changeOption`, which is what the aria2-next manual
says. `Aria2Client.selectFile()` is a convenience wrapper that does exactly
that. `RPC_METHOD_CATALOG` deliberately has no `selectFile` entry, and the
catalogue test asserts it.

Consequence: the tri-state file tree submits the 1-based indexes as a
comma-separated `select-file` value and then waits for
`bittorrent.fileSelectionState` to leave `awaiting` before unpausing.

### `system.multicall`

> **Read this before assuming the retry path works.** AriaNg-Next's
> `Aria2ClientImpl.multicall()` builds **tuples** (`[methodName, params]`). The
> aria2-next manual, the daemon's own `SystemMulticallRpcMethod::execute` and its
> unit test all say the entries must be **structs**
> (`{"methodName": …, "params": […]}`) and answer `"system.multicall expected
> struct."` otherwise. AriaNg's own shape was a struct. This has **not** been
> exercised against a live daemon; see [rpc.md](rpc.md#systemmulticall-takes-structs-not-tuples-and-the-code-disagrees)
> for the full analysis. Until it is, treat the multicall-based task retry as
> unverified.

### Immutable state

AriaNg mutated the RPC payload in place, using `ariaNgCommonService.extendArray`
and `copyObjectTo` to keep `ng-repeat`'s row identity stable. That trick is
meaningless — and actively harmful — in React, whose reconciliation is
reference-based. AriaNg-Next allocates fresh objects and arrays everywhere and
pays for it with explicit copy-on-write. See
[architecture.md](architecture.md#immutability).

Visible consequences, all of them improvements: rows re-render when *their*
task changed rather than when the array changed, the selection toggle re-renders
one row instead of the list, and the file tree shares unchanged subtrees by
reference.

### Aria2-next-only features

Everything below simply does not exist in AriaNg:

- **Native media (HLS/DASH)**: a Media tab on every task (phase, protocol, live
  flag, progress by media duration, available tracks, structured error codes),
  `--media*` options, `aria2.finishMedia`, `aria2.retryMedia`,
  `aria2.resolveFilename`, and the media variants of the new-task page. Retry
  keeps the GID and the daemon's recovery data.
- **ED2K/eMule**: `#!/ed2k/search`, `aria2.ed2kSearch`,
  `aria2.getEd2kSearchResults`, the `--ed2k-*` and `detach-share-only` options,
  and `ed2k://` links in the new-task editor.
- **`aria2.inspectTorrent`**: parse a `.torrent` for its name and file list
  without creating a task.
- **`aria2.forceBtRecheck`**: force a full libtorrent hash check.
- **MD3 dynamic colour**: AriaNg had no component library at all.
- **Installable PWA** with an offline shell.

## The option catalogue

269 keys are known. That splits into:

| | Count | Meaning |
| --- | --- | --- |
| `support: 'current'` | **217** | The daemon honours this name. Editable, and submitted as-is. |
| `support: 'removed'` | **52** | aria2-next retired the name. Known and renderable, but **never offered as an editable row**. |

`getOptionMeta(key).support` is the single source of truth, and both editors use
it: `getGlobalOptionKeys(group)` filters retired keys out of the settings pages
and `getTaskOptionKeys(context, isBittorrent)` filters them out of the per-task
rows.

`aria2NextNote` explains what happened to every retired key — whether it was
renamed to a current equivalent or dropped in favour of a native engine:

| Retired key | `aria2NextNote` says |
| --- | --- |
| `max-connection-per-server` | normalized to `--stream-max-connections` |
| `min-split-size` | normalized to `--stream-max-range-size` |
| `peer-agent` | renamed to `--bt-user-agent` |
| `peer-id-prefix` | renamed to `--bt-peer-id-prefix` |
| `bt-force-encryption` | shorthand for `--bt-require-crypto --bt-min-crypto-level=arc4`, normalized to `--bt-encryption` |
| `ftp-user`, `ftp-passwd`, `ftp-pasv`, `ftp-proxy`, `ftp-type`, `ftp-reuse-connection`, … | the whole FTP family is dropped; SFTP replaces it |

The count drifts as aria2-next changes.
`scripts/verify-option-catalogue.mjs` diffs the catalogue against a real
`aria2.getGlobalOption` dump and fails when the daemon knows a key the catalogue
does not:

```bash
aria2c --enable-rpc=true --rpc-listen-all=false --daemon=true
curl -s -X POST http://127.0.0.1:6800/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"verify","method":"aria2.getGlobalOption"}' \
  | jq .result > aria2-global-option.json

node scripts/verify-option-catalogue.mjs
```

Retired keys are reported for context only and never counted as a failure.

## AriaNg URLs that keep working

| AriaNg URL | Behaviour in AriaNg-Next |
| --- | --- |
| `#!/downloading` | Same page, same filters. |
| `#!/waiting` | Same. |
| `#!/stopped` | Same. |
| `#!/new` | Same form. `?url=…` prefills it without creating anything. |
| `#!/new/task?url=<base64url>` | Creates the task, then redirects to `#!/downloading` (or `#!/waiting` with `pause=true`). |
| `#!/new/task?url=…&dir=/tmp&seed-time=3600` | Same: any query key that is a valid aria2 option key becomes a task option. |
| `#!/new?url=…` | Prefills the new-task form. Does **not** create a task — same as AriaNg. |
| `#!/task/detail/<gid>` | Same, plus `?tab=overview\|pieces\|files\|peers\|options\|media` for a deep-linked tab. |
| `#!/settings/ariang` | Same tabs: Global + one tab per RPC profile + a `+` tab. |
| `#!/settings/ariang/debug` | Same: the URL still unlocks the session-only Debug Mode row without the flag already being on. |
| `#!/settings/aria2/basic` and the other nine groups | Same paths, same group names. Two groups are new. |
| `#!/settings/rpc/set?protocol=&host=&port=&interface=&secret=` | Same. Applies without a reload. |
| `#!/settings/rpc/set/<protocol>/<host>/<port>/<interface>/<secret>` | Same. The query string still wins over the path parameters. |
| `#!/status` | Same. |
| `#!/debug` | Same. Still only visible when session debug mode is on. |
| `#!/` , `#!` , `#`, no hash | Lands on `#!/downloading`, as AriaNg's `otherwise` did. |
| `#!downloading` (no leading slash) | Treated as `#!/downloading` — AngularJS emitted both. |
| any unknown `#!/…` | `Parameter is invalid!`, then `#!/downloading`. |
| `#!/ed2k/search` | **New.** No AriaNg equivalent. |

## A short migration checklist

1. **Copy your settings out of AriaNg first** (AriaNg Settings → Export
   Settings), so you still have them if you go back.
2. `npm run build` (or `npm run build:single`) and serve `dist/`.
3. **Settings → AriaNg Settings → Import Settings**, paste or open the file. The
   page reloads.
4. Point the default profile at your daemon if the imported host is not right, or
   just visit a prepared `#!/settings/rpc/set?…` URL.
5. Expect to see **retired options disappear** from the aria2 settings pages
   (FTP, `max-connection-per-server`, `min-split-size`, `peer-agent`, …). Their
   replacements are listed in their place.
6. Expect the **ED2K and Media** settings groups and the `#!/ed2k/search` page to
   be new.
7. If you were on HTTP from a sub-path, nothing changes. If you were opening
   `index.html` straight from disk, switch to a `ws://` profile or start the
   daemon with `--rpc-allow-origin-all=true` — see the `file://` caveat in the
   [README](../README.md#the-file-caveat).
