# Verifying the aria2 option catalogue against a live daemon

`src/config/aria2-options.ts` is hand-maintained from the aria2-next manual.
It drifts whenever aria2-next gains, renames or retires an option.
`scripts/verify-option-catalogue.mjs` closes that gap by diffing the catalogue
against what a real daemon reports through `aria2.getGlobalOption`.

**This is a manual gate.** CI has no aria2-next daemon to talk to, and
starting one in a workflow would mean shipping a binary the project does not
control. Run it before a release, or whenever the supported aria2-next version
changes.

## 1. Produce the dump

Start a daemon with RPC enabled:

```sh
aria2c --enable-rpc=true --rpc-listen-all=false --rpc-secret=SECRET --daemon=true
```

Query `getGlobalOption`. The secret must be sent as **`params[0]`**, which is
where aria2 expects the token for its `*Key`-style methods:

```sh
curl -s -X POST http://127.0.0.1:6800/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"verify","method":"aria2.getGlobalOption","params":["SECRET"]}' \
  | jq .result > aria2-global-option.json
```

Without `--rpc-secret`, drop `"params":["SECRET"]` entirely. If the daemon uses
a different port, adjust the URL.

Both shapes are accepted by the script, so the `jq .result` is a convenience
rather than a requirement — the raw `{"result": {...}}` reply works too.

## 2. Run the check

```sh
node scripts/verify-option-catalogue.mjs aria2-global-option.json
```

It exits `1` when the daemon reports options the catalogue does not know.

## Reading the output

| Section   | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| `missing` | The daemon reports it, the catalogue does not. **This fails.**     |
| `removed` | Marked `support: 'removed'` in the catalogue. Context only.       |
| `extra`   | The catalogue knows it, the daemon does not report it. Context only. |

`missing` is the one that matters: those are options a user can set in the UI
once it supports them. `extra` and `removed` are reported so a silent rename
is visible rather than hidden.

## Fixing a failure

For each entry under `missing`, add it to `ARIA2_ALL_OPTIONS` in
`src/config/aria2-options.ts` with its `type`, `defaultValue` and a
`support` field, then re-run both the script and `npx vitest run`.

Options the catalogue marks `support: 'removed'` are expected to be absent from
the daemon and never count as failures, so a retired option needs no action.

## See also

- [`docs/ci.md`](../../docs/ci.md) — the full list of gates.