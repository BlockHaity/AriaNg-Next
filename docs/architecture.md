# Architecture

This document explains how the code is layered, why it is layered that way, and
which three pieces of the data layer are subtle enough to deserve their own
section: the incremental task-list refresh, the immutability rule, and the
scheduler.

## Layers

```
                     ┌──────────────────────────────────────────────┐
                     │  config/   i18n/   ui/mdui/   utils/          │
                     │  (cross-cutting: no upward, no downward edges) │
                     └───────────────┬──────────────────┬─────────────┘
                                     │                  │
   ┌─────────────────────────────────┴──────────────────┴──────────────┐
   │  rpc/                                                             │
   │    contract.ts  ← the ONLY public surface of this layer            │
   │    catalog.ts   client.ts   errors.ts   params.ts   types.ts       │
   │    transport/   websocket.ts   http.ts                            │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     │  RpcResult<T> / Aria2Client
   ┌─────────────────────────────────┴──────────────────────────────────┐
   │  domain/                                                           │
   │    normalize.ts  paths.ts  filetree.ts  pieces.ts  peers.ts         │
   │    selection.ts   health.ts   peer-id.ts   types.ts                │
   │    (pure functions in, pure values out — no rpc, no store, no DOM)  │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     │  NormalizedTask and friends
   ┌─────────────────────────────────┴──────────────────────────────────┐
   │  store/                                                            │
   │    tasks.ts  settings.ts  profiles.ts  storage.ts  rpc-store.ts    │
   │    scheduler.ts  commands.ts  selection.ts  ui.ts  history.ts      │
   │    logs.ts  monitor.ts  notifications.ts  title.ts  hooks.ts       │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     │  narrow selector hooks
   ┌─────────────────────────────────┴───────────────┬──────────────────┐
   │  pages/                                        │  components/     │
   │    task-list/  task-detail/  new-task/         │    option-row/   │
   │    aria2-settings/  settings-ariang/           └──────────────────┘
   │    debug/  ed2k-search/                                        │
   └───────────────────────────────────────────────────────────────────┘

   app/ sits above everything: route-paths.ts, hash-history.ts, router.tsx,
   CommandRoutes.tsx and shell/ mount the pages into the mdui layout.
```

The rule is one-directional:

- **No page or component imports a transport.** Nothing outside `src/rpc/`
  may reference `WebSocket`, `fetch` against the RPC endpoint, or a JSON-RPC
  envelope. A page that needs a task asks the store; a store that needs data
  calls `Aria2Client`.
- **`src/rpc/contract.ts` is the only public module of `src/rpc/`.** Stores import
  the `Aria2Client` interface, `RpcResult` and the field-key constants from it.
  `client.ts` and `transport/` are implementation and are re-exported through
  `src/rpc/index.ts` only as factories (`createAria2Client`,
  `setAria2Client`, `getAria2ClientOrNull`).
- **`domain/` never imports `store/` or `rpc/client`.** It only knows the *wire*
  types from `rpc/types.ts` (passive type imports) and nothing else. That is why
  `mergeTaskList`, `normalizeTask`, `getCombinedPieces` and the file-selection
  maths are unit-testable without a client, a DOM or a store.

### Why each layer exists

| Layer | Its job | Why it is separate |
| --- | --- | --- |
| `rpc/` | Put envelopes on the wire and translate aria2's answers. Owns method-name qualification, the secret, the connection state machine, notifications and the `[method, params]` shapes. | The protocol changes with the daemon (aria2 vs aria2-next), not with the UI. Keeping it behind one interface means a protocol fix touches one directory, and a UI change never has to think about tokens or ids. |
| `domain/` | Convert wire values into view values. Every number arrives as a string; every display figure (`completePercent`, `remainTime`, `fileTree`, piece runs, peer summaries) is computed here. | Pure functions are the cheapest thing to test exhaustively, and they are the only place where "aria2 says X, the user should see Y" is decided. Keeping them out of the stores makes the stores orchestration. |
| `store/` | Own long-lived state and the polling cadence. zustand stores, one per concern, with selectors that keep re-renders narrow. | React needs a subscription model, aria2 needs a polling model. The store is the adapter: it is the only place that both a 1 s timer and a component can touch. |
| `pages/` + `components/` | Rendering and event wiring. No protocol knowledge, no arithmetic beyond display formatting. | Standard separation: a page can be replaced without touching the protocol. |
| `config/` | The aria2 option catalogue (269 keys), the settings groups, the default settings blob, the 11 languages and the protocol constants. | It is data, not logic, but it is data that must be *shared* by the settings page, the new-task page, the task-detail page and the command-line URL parser — and that must be verifiable in isolation. `src/config/__tests__` checks it against its own invariants. |
| `i18n/` | Locale tables, the `t()` store and the `Intl`-based formatters. | Translations are the largest data payload in the app (11 locales) and they need their own loading strategy per build target. |
| `ui/mdui/` | The wrapper layer over mdui. See [../src/ui/mdui/README.md](../src/ui/mdui/README.md). | mdui is a custom-element library; React needs adapters for its custom events and JS-only properties. Centralising that is what makes "MD3 only" enforceable. |
| `utils/` | Base64, clipboard, file reading, keyboard predicates, swipe gestures. | Small, stateless, and each one has a focused test file. |

## The incremental refresh

This is AriaNg's "only request incremental data" feature and the subtlest part of
the data layer. It is implemented in
[src/store/tasks.ts](../src/store/tasks.ts) (`mergeTaskList`, `runRefresh`) with
the field lists in [src/rpc/contract.ts](../src/rpc/contract.ts).

### The two key sets

`aria2.tellStatus` / `tellActive` / `tellWaiting` / `tellStopped` all accept an
optional array of keys and answer only those fields. Two sets are defined:

| | `BASIC_TASK_PARAMS` | `FULL_TASK_PARAMS` |
| --- | --- | --- |
| Fields | `gid`, `totalLength`, `completedLength`, `uploadSpeed`, `downloadSpeed`, `connections`, `numSeeders`, `seeder`, `status`, `errorCode`, `verifiedLength`, `verifyIntegrityPending` | basic **+** `files`, `bittorrent`, `infoHash` |
| Cost | one row of counters | the whole file list and the torrent info dict, per task |
| Used for | every 1 s tick | the first load, the load after a structural change, the detail page |

`ARIA2_NEXT_TASK_PARAMS` (`errorMessage`, `media`, `ed2k`, `dir`, `following`,
`belongsTo`) is the third list: the aria2-next extras a detail view needs. It is
not part of the list poll, because a media task's `media` object is expensive and
only one task at a time is inspected.

### The algorithm

```
 tick N                                 tick N+1
 ──────                                 ────────
 needFullRefresh?                       needFullRefresh?
   yes ─────► tellActive(FULL_TASK_… )     no ─────► tellActive(BASIC_TASK_…)
   no  ─────► tellActive(BASIC_TASK_…)               │
         │                                          ▼
         ▼                                 merge positionally by gid
  merge = replace                          │
  needFullRefresh = false                  ├─ shape unchanged  → copy the
                                           │   16 BASIC_MERGE_FIELDS onto the
                                           │   cached task, keep files/bittorrent
                                           │
                                           ├─ shape changed    → take the basic
                                           │   rows, flag needFullRefresh
                                           │
                                           └─ nothing in the list ever had full
                                               data → drop the list, force a full
                                               load next tick
```

In prose:

1. Ask for the **basic** field set unless a full load is pending.
2. **Merge positionally, by gid.** The cached list and the incoming list must
   have the same length *and* the same gid at every index
   (`isPositionalMatch`). When they line up, each incoming row overwrites exactly
   the 16 fields in `BASIC_MERGE_FIELDS` on its cached counterpart and every
   other cached field survives — the file list, the torrent info, the name.
3. A **structural change** (a task added, removed, moved between aria2's
   active/waiting/stopped buckets, or reordered) is detected by the positional
   mismatch. When one happens, the basic rows are kept as they are (they are
   better than nothing) and `needFullRefresh` is raised, so the *next* tick asks
   for the full field set once and clears the flag.
4. Structural changes that aria2 does not announce are covered by the
   notification path: every `aria2.on*` event calls
   `useTasksStore.getState().invalidate()`
   ([src/store/rpc-store.ts](../src/store/rpc-store.ts)), which sets
   `needFullRefresh`. A task moving from `active` to `stopped` therefore forces a
   full reload even though the *list being polled* did not change shape.
5. A list that **never contained full data** is useless — `hasFullTaskData` asks
   whether any row has a name, files or a bittorrent block. If not, the list is
   dropped and a full load is forced, instead of rendering nameless rows forever.

### Why `verifiedLength` and `verifyIntegrityPending` are stripped before merging

AriaNg deleted two fields from the incoming task before copying it over the
cached one (`src/rpc/params.ts` ports the helper: `stripVolatileTaskKeys`,
`VOLATILE_TASK_KEYS = ['verifiedLength', 'verifyIntegrityPending']`). The reason
is that a basic payload simply does not contain them: they were not requested, so
normalisation turns them into `verifiedPercent: undefined` and
`verifyIntegrityPending: false`. Copying those normalised defaults over the cached
task would erase a real verification percentage that a detail load had just
fetched, and the number would never come back until the next full load.

The port has to do a little more than AriaNg did. AriaNg deleted the *wire* keys
from the object it was about to merge; here the wire key has already been
normalised into `verifiedPercent` (a ratio, computed with
`Math.trunc(verifiedLength / totalLength * 100)` to keep AriaNg's truncation
quirk), so `stripVolatile` additionally resets `verifiedPercent` and
`verifyIntegrityPending` explicitly.

The helper mutates its argument — it is a `delete`-based port — so it is only
ever handed a throwaway copy:

```ts
function stripVolatile(task: NormalizedTask): NormalizedTask {
  const copy: NormalizedTask = { ...task };
  stripVolatileTaskKeys(copy);
  copy.verifiedPercent = undefined;
  copy.verifyIntegrityPending = false;
  return copy;
}
```

Two related guards live in the same place:

- `BASIC_MERGE_FIELDS` is an explicit allow-list rather than "everything except
  these". A field that is added to the wire types later is therefore *not*
  merged by accident.
- `setPage()` wipes `list` and `byGid` when the user switches between
  `/downloading`, `/waiting` and `/stopped`. The cached rows belong to a
  *different* aria2 list, so a positional merge across them would be nonsense.

## Immutability

Every mutation in `domain/` and `store/` allocates new objects and arrays. There
are three places where that rule is load-bearing:

1. **The task merge.** React compares object identity. Mutating the cached task
   in place would leave the list component with the same references it already
   rendered, so `React.memo` would skip the re-render and the speed would freeze
   on screen while the data was already stale.
2. **The file tree.** `domain/selection.ts` treats the incoming tree as a frozen
   snapshot and returns a new one, sharing unchanged subtrees by reference so a
   directory selection does not re-render the whole tree.
3. **The profile mirror.** `reuseUnchanged` in
   [src/store/profiles.ts](../src/store/profiles.ts) reuses the previous object
   for every profile that did not really change, so a settings write unrelated to
   RPC does not hand the whole app a new profile array.

AriaNg's `ariaNgCommonService.extendArray` and `copyObjectTo` cannot be ported.
They existed to keep AngularJS `ng-repeat`'s row identity stable while mutating
the objects underneath — an optimisation that only makes sense because
AngularJS re-rendered a list by diffing a stable collection. React's
reconciliation is reference-based, so the same trick inverts the result: the rows
would be considered unchanged and never re-rendered. The port keeps the
*behaviour* (cheap updates) and drops the *mechanism* (mutation), and pays for it
with explicit copy-on-write in the few places that mutate something.

`stripVolatileTaskKeys` is the one deliberate exception, and it is documented as
one: it is a faithful `delete`-based port of an AriaNg helper, so it only ever
receives a copy.

## The scheduler

[src/store/scheduler.ts](../src/store/scheduler.ts) replaces the seven
independent `$interval`s AriaNg registered (`globalStatRefreshInterval`,
`downloadTaskRefreshInterval`, the task-detail intervals, the title interval, …)
with one primitive.

```ts
scheduler.register({ id: 'tasks', intervalMs: 1000, run: () => refresh() });
```

Four properties, each fixing a specific AriaNg failure mode:

- **Ticks never overlap.** Each entry carries a `running` latch; a tick that
  arrives while the previous `run()` promise has not settled is dropped. AriaNg's
  `$interval` started a new `tellStatus` regardless, so a slow or flaky link
  accumulated an unbounded number of in-flight requests until the UI stopped
  responding. `activeCount()` / `inFlightCount()` expose the state so the shell
  can show a busy indicator.
- **Interval `0` disables the job**, which is AriaNg's "Disabled" setting value.
- **Pause without unregistering.** `pause(id)` / `resume(id)` let a modal dialog
  suspend a job for as long as it is open and keep its registration.
- **Visibility-aware suspend — an intentional improvement.** When
  `document.hidden` is true and `allowHidden` was not set, every timer is torn
  down and re-created on `visibilitychange`. AriaNg kept all seven intervals
  running in a background tab, spending battery and hammering aria2 for numbers
  nobody is looking at. `createScheduler({ allowHidden: true })` restores the old
  behaviour for users who keep the app open in a second window; the app-wide
  singleton does not set it.

`updateInterval(id, ms)` hot-applies a settings change: the timer is restarted so
the new period takes effect immediately, without a page reload.

## State management

zustand, one store per concern. There is no provider and no global context for
state — `i18n` is the only React context, and it carries the translator, not data.

| Store | Owns |
| --- | --- |
| `storage` | The persistence backend: `AriaNg.*` keys in `localStorage`, falling back to `document.cookie`, then to an in-memory `Map` that flips `storageIsEphemeral()`. Not a zustand store — a module with functions, plus `subscribeStorage`. |
| `settings` | The `AriaNg.Options` blob (every key in `AriaNgSettings`), the session-only `debugMode`, hydration, import/export and the debounced (300 ms) whole-blob write. |
| `profiles` | A **derived mirror** of the settings' RPC profiles. Index 0 is always the default profile, built from the top-level `rpcAlias`/`rpcHost`/`rpcPort`/`rpcInterface`/`protocol`/`httpMethod`/`rpcRequestHeaders`/`secret` settings; the rest come from `settings.extendRpcServers`. Kept in sync by a `useSettingsStore.subscribe` call, never by hand. |
| `tasks` | The task list, the `gid → task` detail cache, the page, the search text, and the incremental refresh state machine. |
| `rpc-store` | The single `Aria2Client`, the connection state, `version`, `globalStat`, the profile list mirror and the `aria2.on*` event fan-out. |
| `selection` | `gid → boolean`, plus derived selectors. It reads the list from `tasks` on demand instead of duplicating it. |
| `ui` | Cross-route UI state that is not a setting: drawer open, rail extended, shared search text, and the per-page keyboard/swipe registrations (reset on every route change). |
| `history` | Per-option input history, `AriaNg.History.<optionKey>`, capped at 10 entries. |
| `logs` | The debug ring buffer and the unconditional console output. |
| `monitor` | Speed history for the charts (120 global samples, 300 per task). In-memory only, by design. |
| `notifications` | The in-page notice queue and the browser `Notification` API, including the frequency limiter. |

**How the settings store derives profiles.** There is exactly one source of truth:
`settings.extendRpcServers` plus the eight top-level RPC keys. `profiles` never
stores anything itself; `buildProfiles()` reconstructs the array on every sync and
`reuseUnchanged` keeps referential stability for entries that did not change.
`setDefault()` promotes an entry into the top-level slot (demoting the old
default into the list only when asked), so the default profile is never a list
entry and cannot be deleted.

Secrets are **base64 in storage and plain text at runtime**. Every write path
encodes (`encodeSecret`), every read path decodes (`decodeSecret`), and the
import path rebuilds each profile field by field (`sanitizeRpcProfile`) so a
hostile blob cannot smuggle an object into a scalar slot.

Two more behaviours are preserved deliberately:

- **The whole blob is written, debounced, never per keystroke.**
- **There is no cross-tab `storage` event sync.** AriaNg did not do it, and
  silently merging two tabs produces conflicting writes.

## Hot profile switching

AriaNg captured the transport once, when AngularJS built its services, and a
profile change called `location.reload()`.

AriaNg-Next does not. `useRpcStore.applyProfile(profile, reconnectInterval)`
([src/store/rpc-store.ts](../src/store/rpc-store.ts)) performs the swap in place:

1. Everything cached belongs to the **old server** and is thrown away:
   `useTasksStore.getState().clear()` (which also clears the peer cache and the
   `Unauthorized` auth latch), `resetStats('global')`, `version` and `globalStat`
   set to `undefined`, and the "first success" latch re-armed so the version is
   re-read exactly once after the new server answers.
2. `client.connect(profile, …)` tears down the transport, fails every in-flight
   request immediately with `RPC_PROFILE_CHANGED` (so a pending `tellStatus`
   never resolves against the new server), clears the cached version, resets the
   reconnect attempt counter and opens a new transport.
3. The active index is moved to the matching profile; if there is no client yet,
   one is created.

The same code path is what `#!/settings/rpc/set?…` uses, so a prepared URL
changes the server without a reload and without the user losing their place on a
task detail page.

The one thing a switch does *not* do is keep anything per-server: sort orders,
filters and the selection are global settings, not profile state, and they
survive.

## Testing strategy

**Unit-tested (vitest, `jsdom`):**

| Area | Why it is worth testing |
| --- | --- |
| `src/domain` | Pure, high-branch-count logic: normalisation and its string coercion, path derivation (including the torrent-root rule and the single-file case), piece arithmetic, run-length piece maps, peer normalisation, the file-tree selection maths, ETA, health. Every edge case here used to be an AriaNg bug. |
| `src/rpc` | Method-name qualification, the catalogue's completeness and flags, parameter building (`tellWaiting`/`tellStopped` defaults, key trimming, `select-file` joining, trailing-argument dropping), the WebSocket transport's buffering / reconnect / falsy-result dispatch, the HTTP URL and header building, and the error-to-i18n-key mapping. |
| `src/config` | The option catalogue's own invariants: no duplicate keys, every key self-identifying, every type and category valid, byte-pattern coverage, the exact four `text` rows AriaNg had, and the retired-key classification. Also the settings defaults, the language registry, the option groups and the file-type table. |
| `src/store` | The incremental merge (`mergeTaskList`), sorting and filtering, the settings store's merge/repair/import path, the storage backends and their degradation, the profile mirror, the scheduler's latch, the title templating, the log ring buffer and the notification limiter. |
| `src/i18n` | The INI parser, the `t()` fallback behaviour, the `Intl` formatters (including AriaNg's quirks), the per-target locale loader and the **locale payload budget**. |
| `src/ui/mdui` | The wrapper hooks: custom-event subscription, property binding, controlled components, the promise-based dialogs (which must never throw) and the theme functions. |
| `scripts/` | The colour guard's detection logic against inline fixtures. |

**Deliberately left to manual verification:**

- **Everything visual.** No component snapshot tests and no visual regression
  suite; the MD3 compliance claim rests on the token discipline and the colour
  guard, not on rendered assertions.
- **The shell.** `AppShell`, the drawer/rail switch and the lazy-chunk loading
  are exercised by hand in a browser at both sides of the 840 px breakpoint.
- **The real protocol.** The client is tested against fake transports
  (`socketFactory` / `fetchImpl` are injection seams), not against a live
  aria2-next. `scripts/verify-option-catalogue.mjs` closes part of that gap for
  the option catalogue by diffing it against a real `getGlobalOption` dump, but
  there is no automated round trip against a daemon.
- **The two build targets.** Both are verified by running them
  ([build-targets.md](build-targets.md#verification-checklist)); the size guard
  covers only the single-file byte budget and the relative-asset rule.
- **The PWA update flow** (the service worker registration and its reload
  prompt) needs a browser with a service worker, i.e. `file://` will not do.
- **Browser Notification permission** prompts and the notification frequency
  limiter's real timing.
