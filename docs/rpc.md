# The aria2 / aria2-next JSON-RPC contract

Everything this front end knows about the daemon is in one place:
[src/rpc/catalog.ts](../src/rpc/catalog.ts) (the method registry),
[src/rpc/contract.ts](../src/rpc/contract.ts) (the client interface) and
[src/config/rpc-constants.ts](../src/config/rpc-constants.ts) (the enums).
This document explains the transports, the authentication rules, the connection
state machine, the method table, and the protocol details that are easy to get
wrong.

Every claim below was checked against the aria2-next manual
(`docs/manual/en/aria2-next.rst`), `docs/media-downloads.md` and — where the
manual is silent — against the aria2-next sources. Claims that could not be
verified that way are marked as such.

## Transports

| | WebSocket | HTTP |
| --- | --- | --- |
| Profile protocols | `ws`, `wss` | `http`, `https` |
| URL | `ws://host:port/jsonrpc` | `http://host:port/jsonrpc` |
| Methods | request/response **plus server-initiated notifications** | request/response only |
| Request framing | one JSON text frame (WebSocket version 13, RFC 6455) | `POST` with a JSON body, or `GET` with `?method=&id=&params=<base64>` |
| Timeout | none (a slow call simply takes long) | 20 s `httpRequestTimeout`, via `AbortController` |
| Auto-reconnect | yes, `webSocketReconnectInterval` ms | no |

Implementation: [src/rpc/transport/websocket.ts](../src/rpc/transport/websocket.ts)
and [src/rpc/transport/http.ts](../src/rpc/transport/http.ts).

### Why WebSocket first

`aria2` sends the six `aria2.on*` notifications **only over WebSocket** — the
manual is explicit: "The JSON-RPC interface does not support notifications over
HTTP, but the RPC server will send notifications over WebSocket." Without a push
channel there is no way to learn that a task finished without polling every task
on a timer.

The app still defaults to HTTP because AriaNg did and because HTTP is the only
thing that works out of the box from a `file://` page with a stock daemon. WebSocket
is one dropdown away, and the UI says so: the connection state, the browser
notification path and the "task complete" notices are all gated on
`supportsNotifications`.

### aria2-next prerequisite

WebSocket RPC is an **aria2-next extension**, not upstream aria2. It is gated on
the CMake option:

```
# aria2-next CMakeLists.txt
option(ARIA2_ENABLE_WEBSOCKET "Enable WebSocket support" ON)
```

It is `ON` by default, so a normal aria2-next build has it. An aria2 built with
`-DARIA2_ENABLE_WEBSOCKET=OFF` (or a distro build that did so) will refuse the
handshake; fall back to an `http`/`https` profile.

Upstream aria2 has no WebSocket RPC at all, so on aria2 the WebSocket profile
simply never connects.

## The secret token

aria2-next offers two mechanisms and this front end uses both.

1. **Method-level authorization.** The token is the **first** parameter of an
   `aria2.*` call, prefixed with `token:`:

   ```
   aria2.addUri("token:$$secret$$", ["http://example.org/file"])
   ```

   The manual adds two rules that matter:

   > Even when the `--rpc-secret` option is not used, if the first parameter in
   > the RPC method is a string and starts with `token:`, it will be removed
   > from the parameter list before the request is being processed.

   So the token slot is always safe to send, and is never mistaken for a gid.

   > `system.listMethods` and `system.listNotifications` can be executed without
   > token.

   Accordingly, `#buildCall()` prepends `token:<secret>` **only for non-system
   methods** ([src/rpc/client.ts](../src/rpc/client.ts)).

2. **`Authorization: Bearer <secret>`.** The HTTP transport also sends a bearer
   header, which keeps old and new builds working behind proxies that rewrite or
   strip the body or the query string.

`system.multicall` is the special case the manual calls out: the outer call must
**not** carry a token, and every nested call must carry its own
(`token:<secret>` as its first parameter). The client's `buildCall()` returns
`[fullMethodName, params]` with the token already injected, so a multicall entry
is self-contained.

The secret is stored base64-encoded under `AriaNg.Options` and kept plain text in
memory. On a `#!/settings/rpc/set?…` URL it travels base64url-encoded.

## Connection state machine

Defined in [src/config/rpc-constants.ts](../src/config/rpc-constants.ts) as
`RpcStatus`, and driven by `Aria2ClientImpl` plus the WebSocket transport:

```
   connect() / profile switch
            │
            ▼
      ┌───────────┐   transport error or close, interval > 0
      │ Connecting│ ─────────────────────────────────┐
      └─────┬─────┘                                  │
            │ socket open, or any successful RPC reply │
            ▼                                        ▼
      ┌───────────┐    close with interval === 0    ┌────────────────────┐
      │ Connected │ ─────────────────────────────► │ Disconnected       │
      └─────┬─────┘                                  └────────────────────┘
            │ close with interval > 0                   ▲
            ▼                                           │ reconnect timer
      ┌────────────────────┐                            │ fires
      │ Waiting to reconnect│ ────────────┐             │
      └─────────┬───────────┘             │             │
                │ timer fires             │ socket creation failed
                ▼                         ▼             │
          ┌────────────┐  socket open  ┌──────────┐     │
          │Reconnecting│ ────────────► │ Connected│     │
          └─────┬──────┘               └──────────┘     │
                │ close again                             │
                └────────────────────────────────────────►┘

  reconnect(): any state → Reconnecting → (Connected | Disconnected)
```

- **A successful reply also counts as connected.** `#onResult` sets
  `Connected` and clears the error, so an HTTP profile — which has no persistent
  connection at all — reports `Connected` after its first successful call.
- **A JSON-RPC error is not a connection failure.** The daemon answered, so the
  transport is fine; only a transport-level error moves the state machine.
- **Only the WebSocket transport reconnects.** `#handleClose` checks
  `this.#transport?.kind === 'websocket'`; AriaNg's `canReconnect()` returned
  `false` for its HTTP service for the same reason.
- **Interval `0` disables reconnect** and a close is then reported as a hard
  failure (`Disconnected`), matching AriaNg's "Disabled" setting.
- **The reconnect timer is single-flight.** AriaNg guarded with a
  `pendingReconnect` flag but could only ever replace a brand-new `$websocket`
  instance whose factory had captured the closure of its first creation, so a real
  reconnect was impossible without a page reload. Here one timer owns the retry
  cadence, and it does not start a second socket while one is already connecting.
- **`attempt`** counts consecutive reconnects and is surfaced in the UI.

## Method table

`RPC_METHOD_CATALOG` holds **47 methods**: 44 `aria2.*` and 3 `system.*`.
`destructive` marks the six that trigger the destructive-action confirmation;
`aria2-next only` marks the seven that upstream aria2 does not have.

### Task lifecycle

| Method | Notes |
| --- | --- |
| `aria2.addUri` | `urls[], options?, position?` |
| `aria2.addTorrent` | base64 `.torrent`, `uris?, options?, position?` |
| `aria2.addMetalink` | base64 metalink document |
| `aria2.inspectTorrent` | **aria2-next only** — parses a torrent without creating a task |
| `aria2.remove` | **destructive** |
| `aria2.forceRemove` | **destructive** |
| `aria2.pause` / `aria2.pauseAll` | |
| `aria2.forcePause` / `aria2.forcePauseAll` | |
| `aria2.unpause` / `aria2.unpauseAll` | see the `awaiting` rule below |
| `aria2.changePosition` | `pos`, `how` = `POS_SET` / `POS_CUR` / `POS_END` |
| `aria2.changeUri` | add/remove URIs of a running download in place |

### Queries

| Method | Notes |
| --- | --- |
| `aria2.tellStatus` | optional third argument: the key filter |
| `aria2.tellActive` | key filter only |
| `aria2.tellWaiting` | `offset`, `num`, `[keys]` — default offset `0` |
| `aria2.tellStopped` | `offset`, `num`, `[keys]` — default offset `-1` |
| `aria2.getUris` | includes whether each URI was already tried |
| `aria2.getFiles` | per-file progress, 1-based `index` |
| `aria2.getPeers` | |
| `aria2.getServers` | the BitTorrent servers a download is using |

### Options

| Method | Notes |
| --- | --- |
| `aria2.getOption` / `aria2.changeOption` | per task; answers `OK` on success |
| `aria2.getGlobalOption` / `aria2.changeGlobalOption` | global |
| `aria2.getGlobalStat` | the drawer badges and the global chart |
| `aria2.purgeDownloadResult` | **destructive** — "Clear stopped" |
| `aria2.removeDownloadResult` | **destructive** |

### Daemon

| Method | Notes |
| --- | --- |
| `aria2.getVersion` | see the capability probing note |
| `aria2.getSessionInfo` | |
| `aria2.saveSession` | answers `OK` |
| `aria2.shutdown` | **destructive** |
| `aria2.forceShutdown` | **destructive** |

### BitTorrent

| Method | Notes |
| --- | --- |
| `aria2.getBtTrackers` | |
| `aria2.forceBtAnnounce` | |
| `aria2.addBtPeers` | magnet link or a plain peer list |
| `aria2.getBtSessionStatus` | |
| `aria2.forceBtRecheck` | **aria2-next only** — full libtorrent hash check |

### aria2-next: media

| Method | Notes |
| --- | --- |
| `aria2.finishMedia` | **aria2-next only** — end a live recording and finalise it |
| `aria2.retryMedia` | **aria2-next only** — requeue a failed media task, same GID |
| `aria2.resolveFilename` | **aria2-next only** — ask which filename a URL maps to |

### aria2-next: ED2K

| Method | Notes |
| --- | --- |
| `aria2.ed2kSearch` | **aria2-next only** — starts a search, returns the search GID |
| `aria2.getEd2kSearchResults` | **aria2-next only** — reads the accumulating results |

### JSON-RPC system

| Method | Notes |
| --- | --- |
| `system.multicall` | batches several calls into one request |
| `system.listMethods` | no token required |
| `system.listNotifications` | no token required |

> **Known gap.** aria2-next master also exposes
> `aria2.setBtPeerBlocklist([secret], rules)`, which is documented in the manual
> but is **not** in `RPC_METHOD_CATALOG`. The debug page therefore reports it as
> "AriaNg does not support this RPC method!". Not a functional problem — nothing
> in the UI needs it — but it is a gap in the registry.

## Notifications

Six server-initiated notifications, defined as `RpcEvent` in
`src/config/rpc-constants.ts`:

| Event | Fires when |
| --- | --- |
| `aria2.onDownloadStart` | a download starts |
| `aria2.onDownloadPause` | a download is paused |
| `aria2.onDownloadStop` | a download stops |
| `aria2.onDownloadComplete` | a download completes |
| `aria2.onDownloadError` | a download aborts with an error |
| `aria2.onBtDownloadComplete` | a BitTorrent download completes |

Each carries a struct whose only member is `gid`. Three details:

- **They exist only over WebSocket.** `HttpRpcTransport.supportsNotifications` is
  `false`, and the notification store defaults its transport to `'http'` so a
  browser notification can never be fired before the transport is known.
- **The payload is `params[0]`.** aria2 always sends the notification body as the
  first parameter, so the client unwraps it before dispatching.
- **A notification means the task list may have moved.** aria2 moves a task
  between its `active` / `waiting` / `stopped` buckets without asking, which is
  exactly the structural change the incremental refresh cannot detect by itself.
  Every event therefore calls `useTasksStore.getState().invalidate()`, forcing one
  full reload on the next tick. See
  [architecture.md](architecture.md#the-incremental-refresh).
- **The WebSocket transport dispatches on the presence of `id`, not on the
  truthiness of `result`.** AriaNg used `if (content.result && …)`, which
  treated `0`, `''`, `false` and `null` as failures — exactly the values
  `changePosition` and friends return.

## Gotchas

Every item here was checked against the aria2-next manual or the daemon's own
source. The two that contradict common assumptions are marked.

### There is no `aria2.selectFile`

File selection is the **`select-file` option**, written through
`aria2.changeOption`. The manual documents `--select-file=<INDEX>...` (including
ranges: `1-5,8,9`) and, in the `--pause-metadata` description, says explicitly:

> Set `select-file` through `aria2.changeOption`, then resume the same GID with
> `aria2.unpause`.

`RPC_METHOD_CATALOG` therefore has no `selectFile` entry, and
`Aria2Client.selectFile(gid, indexes)` is a convenience wrapper that calls
`changeOption(gid, { 'select-file': '1,4,9' })` with the 1-based indexes joined by
commas. `src/rpc/__tests__/catalog.test.ts` asserts the absence.

### `system.multicall` takes structs, not tuples (and the code disagrees)

**The manual and the daemon source both say JSON objects:**

> *methods* is an array of structs. The structs contain two keys: `methodName`
> and `params`. […] The following example […] `'params':[[{'methodName':'aria2.addUri', 'params':[…]}, …]]`

and `SystemMulticallRpcMethod::execute` in `src/rpc/SystemMethods.cc` downcasts
every entry to a `Dict`, answering `"system.multicall expected struct."` for
anything else. aria2-next's own unit test (`tests/rpc/SystemMethodsTest.cc`,
`testSystemMulticall`) builds dict entries and asserts that a non-struct entry
becomes an error element.

So the wire shape is:

```jsonc
{"jsonrpc":"2.0","id":"qwer","method":"system.multicall",
 "params":[[{"methodName":"aria2.tellStatus","params":["token:…","2089b05ecca3d829"]},
            {"methodName":"aria2.getOption",  "params":["token:…","2089b05ecca3d829"]}]]}
```

> **Discrepancy, unresolved.** `Aria2ClientImpl.multicall()` and
> `src/store/commands.ts` (`fetchRetryInputs`) build **tuples**
> (`[methodName, params]`) and the comments in `client.ts` / `catalog.ts` claim the
> struct form is what aria2 rejects. That is the opposite of what the manual and
> the daemon source say, and the claim that the original AriaNg's per-task-detail
> poll was "silently broken" does not hold up either: AriaNg passed its request
> *context* objects straight through, and `JSON.stringify` drops the function
> properties, leaving exactly the `{methodName, params}` struct aria2 expects.
> This is listed here because the retry path depends on it and has **not** been
> exercised against a live daemon. Treat `system.multicall` as unverified until it
> is; the fallback (`tellStatus` then `getOption` as two calls) is known to work.

`system.multicall` also refuses to nest: a recursive entry is rejected with
`"Recursive system.multicall forbidden."`, and a missing `params` member is
treated as an empty parameter list.

### Do not unpause a magnet task that is `awaiting`

`bittorrent.fileSelectionState` is aria2-next's authoritative file-selection
state (`none` / `awaiting` / `ready` / `applying`). With
`--pause-metadata=true`, a magnet task fetches its metadata, pauses the same GID
and reports `awaiting`. The manual:

> A Magnet task whose `bittorrent.fileSelectionState` is `awaiting` rejects this
> method until `aria2.changeOption` sets a valid `select-file`. […] Resuming
> without a valid selection fails and leaves the task paused.

The UI must therefore: render the file tree, submit `select-file`, wait for the
state to leave `awaiting`, and only then offer unpause. The state enum lives in
`FileSelectionState` (`src/config/rpc-constants.ts`).

### `tellStopped` starts at `-1`, `tellWaiting` at `0`

`offset` is measured **from the end** of the stopped list — the least recently
stopped download is offset `0`, so `-1` is the *newest* one. `num` counts
backwards from there (`aria2.tellWaiting(-1, 2)` returns `["C","B"]` for a queue
`A, B, C`). The app therefore uses `DEFAULT_STOPPED_OFFSET = -1` and
`DEFAULT_WAITING_OFFSET = 0` with `DEFAULT_TASK_LIST_SIZE = 1000`
([src/rpc/params.ts](../src/rpc/params.ts)), which is AriaNg's behaviour: the
stopped list is consumed from the newest end.

### Every number arrives as a string

Including the ones you would least expect:

- `media.duration` and `media.completedDuration` are **milliseconds**, as decimal
  strings. They are not seconds and they are not numbers.
- `mediaTrack.frameRate` is a decimal string; `0` means unknown.
- `media.progress` and `bittorrent.progress` are `0..1` strings.
- `live`, `lengthKnown`, `selected` are the strings `'true'` / `'false'`, not
  booleans.
- `changePosition` returns an integer (the only genuinely numeric result the
  client sees).
- **`aria2.getFiles` returns strings for everything, including `index`.** The
  manual says so explicitly ("Values are strings"), and `index` "starts at 1".
  `Aria2File.index` is typed `number` in `src/rpc/types.ts`, which is convenient
  but wrong at the type level; the normaliser coerces with `toInt()` before
  anything uses it, so the runtime behaviour is correct.
- **`bittorrent.searchActive` / `searchMoreResults` are real JSON booleans**, not
  `'true'`/`'false'` strings.

The manual states the interface "does not support floating point numbers", so
`Number.parseFloat` is the correct coercion and `%` precision must not be
assumed. `src/domain/normalize.ts` is the only place any coercion happens;
`src/rpc/types.ts` documents the rule at the top ("Everything the server sends is
a *string* unless stated otherwise").

### `changePosition` can legitimately return `0`

The manual: "The response is an integer denoting the resulting position." Moving a
task to the front of the queue returns `0`, and moving it one slot up from
position 0 returns `0` too. A naive `if (result)` therefore reports success as
failure. Always check `result.success`, never the truthiness of `result.data`.

### `getVersion()` reports the product and advertises optional capabilities

```
aria2.getVersion
  → { product: 'aria2-next', rpcVersion: '1.1.0', version: '2.5.2',
      enabledFeatures: ['Async DNS','BitTorrent','ED2K', …],
      mediaFeatures:    ['request-contexts','stable-track-ids','structured-errors','captured-inputs'],
      downloadFeatures: ['filename-hints','filename-resolution'] }
```

- `product` is `aria2-next`. That is how a client tells the two daemons apart;
  the string is a value, not a version comparison.
- `mediaFeatures` and `downloadFeatures` are **optional and unversioned**. The
  manual's `getVersion` entry documents `product` / `rpcVersion` / `version` /
  `enabledFeatures` only. `mediaFeatures` is documented in
  `docs/media-downloads.md` ("advertises `request-contexts`, `stable-track-ids`
  and `structured-errors`"), and both lists are emitted by
  `GetVersionRpcMethod` in aria2-next's `src/rpc/SessionMethods.cc`, which also
  adds `captured-inputs`. `downloadFeatures` appears only in the aria2-next
  `docs/architecture.md`. `Aria2VersionInfo` therefore declares both as optional
  and a consumer must never require them — treat a missing list as "this build
  does not advertise the capability", not as an error.
- `enabledFeatures` is a list of strings, not flags. `BitTorrent`, `ED2K`,
  `Metalink`, `HTTPS`, `GZip`, `Message Digest`, `Firefox3 Cookie`,
  `Async DNS` and `XML-RPC` are the names upstream aria2 uses; treat an unknown
  name as "present", never as an error.

## Media progress semantics

The single most important thing to understand about an aria2-next media task:

> Media progress is based on completed media duration. Output byte lengths remain
> unknown until remuxing finishes: source segment bytes are not the same quantity
> as the final container size. […] Live tasks do not report a fabricated total
> duration percentage. **Frontends must use the media fields, not interpret
> unknown output size as zero download progress.**

Consequences this front end honours:

- `totalLength` and `completedLength` are `"0"` for a media task until the
  remuxer has produced the final container. Computing a percentage from them
  yields a permanent, wrong `0 %`.
- `media.progress` is `completedDuration / duration`, and `media.lengthKnown` is
  `'false'` while the total is unknown. The media tab shows an **indeterminate**
  progress bar plus the absolute `completedDuration` and `downloadedLength`
  instead of a percentage.
- `media.downloadedLength` is retained media payload, **not** network speed. It
  is plotted in its own chart series.
- `media.state` (`MediaPhase`) is finer-grained than the task `status`:
  `waiting`, `probing`, `awaiting-selection`, `downloading`, `recording`,
  `finalizing`, `paused`, `complete`, `error`, `removed`. The standard RPC status
  keeps the ordinary task lifecycle; only a successful mux **and** publication of
  the output file produce a completed task.
- `media.errorCode` is empty outside a failure. A failure identifies one of
  `unsupported_source`, `authentication_required`, `protected_media`,
  `unsupported_selection`, `probe_failed` independently of the diagnostic text in
  `media.error`.
- Track `id`s are **opaque**. They derive from native representation identity, not
  manifest position, and must never be parsed or synthesised. They are submitted
  verbatim to `media-video` / `media-audio` / `media-subtitles`.
- Selecting tracks is a three-step transaction: add with
  `media-pause-after-probe=true`, inspect `media.tracks`, then `changeOption` the
  selection and set `media-pause-after-probe=false` before `unpause`.

## Retrying a media task

- **`aria2.retryMedia(gid[, options])`** requeues a failed media task with the
  **same GID** and its retained native recovery data (committed segments,
  playlist position, media clocks). It does not delete the stopped result until
  the queue insertion succeeds, and it rejects invalid or non-media results
  without mutating anything. Optional option changes go through the native
  paused-task validator.
- **`aria2.removeDownloadResult(gid)` deliberately discards the recovery data.**
  The manual says so in as many words: "Use this method instead of removing the
  result and submitting a new GID: `removeDownloadResult` intentionally discards
  media recovery data."

So a media task's Retry button must call `retryMedia`, never *remove + re-add the
URL*. `retryTask()` in `src/store/commands.ts` refuses media tasks outright and
says why (`RETRY_MEDIA_MESSAGE`), because a fresh GID would break every open
detail page and throw away the partial download.

## ED2K search

- `aria2.ed2kSearch(keyword[, options])` starts a search and returns the **GID of
  the search task**. `options` accepts the normal request options (`dir`,
  `ed2k-server`, `ed2k-server-list`, `ed2k-node-list`) plus the search filters
  `fileType`, `extension`, `minSize`, `maxSize`, `minSourceCount`,
  `minCompleteSourceCount`.
- `aria2.getEd2kSearchResults(gid)` returns `{ gid, moreResults, results }`.
  `moreResults` is a **boolean** here (not `'true'`/`'false'`) — the manual's own
  example shows `"moreResults":false`.
- Each result carries `hash`, `name`, `length`, `sourceCount`,
  `completeSourceCount`, `fileType`, `extension`, `mediaArtist`, `mediaAlbum`,
  `mediaTitle`, `mediaLength`, `mediaBitrate`, `mediaCodec`, `sourceNetwork` and
  `ed2kLink`. Numeric values are decimal strings.
- `ed2kLink` is what you pass to `aria2.addUri` to create the download; the search
  page does exactly that.

> **Discrepancy.** `Aria2Ed2kSearchResult` in
> [src/rpc/types.ts](../src/rpc/types.ts) declares `filename`, `fileLength` and
> `fileHash`, which are **not** the names in the manual (`name`, `length`,
> `hash`). `ed2kLink` and `sourceNetwork` / `mediaCodec` do match. Likewise
> `Aria2Ed2k` names the "still collecting results" flag `searching` while the
> manual calls it `searchActive`, and declares `numServers` / `connectedServers`
> / `numPeers…` where the manual documents `kadRouterCount`, `kadFirewalled`,
> `kadObservedAddressCount`, `uploadingPeerCount` and `sharingTime`. The types
> need reconciling with the manual before the ED2K views can rely on them.

## The HTTP GET interface

Only used when a profile sets `httpMethod: 'GET'`. The manual's format:

```
/jsonrpc?method=aria2.tellStatus&id=foo&params=WyIyMDg5YjA1ZWNjYTNkODI5Il0%3D
```

where `params` is the base64 of the JSON params array, percent-encoded.
`buildGetUrl` emits exactly the three documented members (`method`, `id`,
`params`), percent-encoding the base64 because `+`, `/` and `=` are mangled by
most query parsers, and omits `params` for a call with no arguments. AriaNg
appended *every* member of the request envelope (including `jsonrpc`) because it
iterated the body object.
