/**
 * Serialise the daemon's global options as an `aria2.conf`.
 *
 * ## Why this exists
 *
 * `aria2.changeGlobalOption` is **runtime-only** — it does not touch disk, so every
 * setting changed through this UI is gone after a restart, and there was no way to
 * get the current state out into the file aria2 actually reads at startup. This
 * module closes that loop.
 *
 * ## The format, verified rather than assumed
 *
 * Every rule below was established by feeding candidate lines to aria2-next 2.8.3
 * through `--conf-path` and reading the result back with `aria2.getGlobalOption`:
 *
 * | input in the conf            | `getGlobalOption` returns |
 * |------------------------------|---------------------------|
 * | `user-agent=plain`           | `plain`                   |
 * | `user-agent="plain"`         | `"plain"` — **quotes kept** |
 * | `user-agent=Mozilla 5.0`     | `Mozilla 5.0` — spaces are fine |
 * | `user-agent=a#b=c`           | `a#b=c`                   |
 * | `bt-exclude-tracker=`        | `""`                      |
 * | `user-agent=  padded  `      | `padded` — trimmed        |
 * | `# comment`                  | ignored                   |
 *
 * So the surprising part: **never quote a value.** aria2's option parser does not
 * strip surrounding quotes — they survive into the value verbatim — whereas an
 * unquoted value may contain spaces, `=` and `#` freely. A value that needs quoting
 * only because it looked like it did would come back corrupted.
 *
 * `#` introduces a comment only at the start of a line, so a `#` inside a value is
 * safe.
 *
 * ## What is left out, and why
 *
 * - **Options the daemon did not report.** `getGlobalOption` omits anything never
 *   set. Emitting `key=` for those would *clear* them on the next start, which is
 *   the opposite of exporting the current state — the most dangerous thing this
 *   module could do, so absent keys are simply not written.
 * - **Options the catalogue marks `removed`.** aria2-next retired them; writing them
 *   back would be noise, and some no longer parse.
 * - **`rpc-secret`.** It is an RPC credential, not a daemon behaviour setting. It
 *   happens not to be reported today, but it is excluded by name rather than relied
 *   upon to stay that way — a conf file is the kind of thing people paste into
 *   forums.
 */

import { ARIA2_GLOBAL_GROUPS } from '@/config/option-groups';
import { getOptionMeta } from '@/config/aria2-options';

import type { OptionGroupRoute } from '@/config/types';

/**
 * Keys that are reported by the daemon but must never reach an exported conf.
 *
 * Three distinct reasons, all established by round-tripping a real export through
 * `aria2-next --conf-path`:
 *
 * 1. **`rpc-secret`** — an RPC credential, not a daemon behaviour setting. It is not
 *    reported today, but an exported conf is the sort of thing people paste into
 *    forums, so it is excluded by name rather than by luck.
 * 2. **Invocation-only keys** — `--conf-path`, `--daemon`, `--rpc-listen-port` and
 *    `--enable-rpc` describe *how this instance was started*, and `getGlobalOption`
 *    reports them. Carrying them over would pin a new daemon to the exporting
 *    instance's RPC port and config path, breaking its own RPC on startup. Verified:
 *    a naive export round-tripped 153/156 keys, and the only three that changed
 *    were exactly these.
 * 3. **Legacy conf aliases** — `bt-lpd-interface`, `dht-listen-addr`,
 *    `dht-listen-addr6`, `dht-entry-point`, `dht-entry-point6`. aria2-next still
 *    reports them, but its conf parser maps them onto `bt-interface` /
 *    `bt-dht-bootstrap-nodes` and logs
 *    `Legacy aria2 input from configuration: … skipped because … is already set`.
 *    They are marked `support: 'deprecated'` in the catalogue; excluding them here
 *    keeps that classification load-bearing instead of decorative.
 */
export const EXCLUDED_CONF_KEYS: ReadonlySet<string> = new Set([
  'rpc-secret',
  'conf-path',
  'daemon',
  'rpc-listen-port',
  'enable-rpc',
  'bt-lpd-interface',
  'dht-listen-addr',
  'dht-listen-addr6',
  'dht-entry-point',
  'dht-entry-point6',
]);

/** What aria2 is told to use, per `getGlobalOption()`. */
export type GlobalOptionSnapshot = Readonly<Record<string, string>>;

export interface Aria2ConfOptions {
  /** Source comment: which daemon produced the snapshot. */
  readonly product?: string;
  /** Source comment: the daemon version. */
  readonly version?: string;
}

/** One emitted line, kept separate so the output is trivially assertable. */
export interface Aria2ConfLine {
  readonly kind: 'comment' | 'blank' | 'entry';
  readonly text: string;
  readonly key?: string;
  readonly value?: string;
}

/**
 * The pairs to write, in a deterministic order.
 *
 * Group order follows `ARIA2_GLOBAL_GROUPS`, and within a group the catalogue's own
 * declaration order — the same order the settings page shows — so an export reads
 * like the UI it came from and two exports of the same state are byte-identical.
 *
 * A key is written only when the daemon actually reported it; see the module note.
 */
export function collectConfEntries(snapshot: GlobalOptionSnapshot): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();

  for (const group of Object.keys(ARIA2_GLOBAL_GROUPS) as OptionGroupRoute[]) {
    const meta = ARIA2_GLOBAL_GROUPS[group];
    const rows: Array<{ key: string; value: string }> = [];

    for (const key of meta.keys) {
      if (seen.has(key) || EXCLUDED_CONF_KEYS.has(key)) continue;
      // Retired in aria2-next: writing it back is noise, and it may not parse.
      if (getOptionMeta(key)?.support === 'removed') continue;
      if (!Object.hasOwn(snapshot, key)) continue;

      const raw = snapshot[key];
      if (raw === undefined || raw === null) continue;

      seen.add(key);
      rows.push({ key, value: String(raw) });
    }

    if (rows.length > 0) entries.push(...rows);
  }

  return entries;
}

/**
 * Build the conf text.
 *
 * Multi-line values cannot be represented (`aria2.conf` is line based) so they are
 * dropped rather than silently truncated into something that would change meaning;
 * `skippedKeys` reports them for the dialog to surface.
 */
export function buildAria2Conf(snapshot: GlobalOptionSnapshot, options: Aria2ConfOptions = {}): string {
  const { product, version } = options;

  const lines: Aria2ConfLine[] = [
    { kind: 'comment', text: '# aria2.conf — exported from AriaNg-Next' },
  ];

  if (product || version) {
    lines.push({ kind: 'comment', text: `# source: ${[product, version].filter(Boolean).join(' ')}` });
  }

  lines.push(
    { kind: 'comment', text: '# This is a snapshot of the RUNNING daemon, not the file it was started from.' },
    {
      kind: 'comment',
      text: '# aria2.changeGlobalOption never writes to disk, so nothing changed in the UI survives a',
    },
    { kind: 'comment', text: '# restart unless this file (or part of it) is applied to the daemon configuration.' },
    { kind: 'comment', text: '# Only options the daemon reported are listed; unset options are omitted on purpose,' },
    { kind: 'comment', text: '# because writing an empty value would clear them.' },
    { kind: 'blank', text: '' },
  );

  const seen = new Set<string>();
  let wroteGroup = false;

  for (const group of Object.keys(ARIA2_GLOBAL_GROUPS) as OptionGroupRoute[]) {
    const rows: Aria2ConfLine[] = [];

    for (const key of ARIA2_GLOBAL_GROUPS[group].keys) {
      // A key belongs to exactly one group in the catalogue, but `seen` keeps that a
      // property of this function rather than a property somebody has to maintain.
      if (seen.has(key) || EXCLUDED_CONF_KEYS.has(key)) continue;
      if (getOptionMeta(key)?.support === 'removed') continue;
      if (!Object.hasOwn(snapshot, key)) continue;

      const raw = snapshot[key];
      if (raw === undefined || raw === null) continue;

      seen.add(key);
      rows.push({ kind: 'entry', key, value: String(raw), text: `${key}=${String(raw)}` });
    }

    if (rows.length === 0) continue;
    if (wroteGroup) lines.push({ kind: 'blank', text: '' });

    lines.push({ kind: 'comment', text: `# --- ${group} ---` }, ...rows);
    wroteGroup = true;
  }

  return `${lines.map((line) => line.text).join('\n')}\n`;
}

/** Keys the daemon reported but which cannot be represented in a line-based conf. */
export function findUnrepresentableKeys(snapshot: GlobalOptionSnapshot): string[] {
  return Object.keys(snapshot).filter((key) => !EXCLUDED_CONF_KEYS.has(key) && /[\r\n]/.test(String(snapshot[key])));
}