/**
 * Barrel for the ED2K search page, plus the page's English copy.
 *
 * ## Why these strings live here instead of `src/i18n/en.ts`
 *
 * `src/i18n/en.ts` is **generated** (`node scripts/convert-langs.mjs` from
 * AriaNg's `defaultLanguage.js`) and carries AriaNg's 724 keys. Upstream aria2
 * has no ED2K support at all, so not one of them mentions ED2K: there is no key
 * for `ed2kSearch`, none for a search result table, none for the "ED2K link
 * cannot be resolved" warning.
 *
 * Writing to the generated file would be overwritten on the next regeneration
 * run, and hand-maintaining a 725th entry in a file that claims not to be edited
 * by hand is worse than not having it at all. So this page carries its own small
 * catalogue and resolves it through {@link useLocalTranslate}:
 *
 * ```
 * const translated = t(key, params);          // real catalogue first
 * if (translated !== key) return translated;   // a real key exists — use it
 * return interpolate(ED2K_STRINGS[key] ?? key, params);
 * ```
 *
 * `t()` returns the key itself when nothing matches, which is exactly the
 * "not in the catalogue" signal. This is the standard escape hatch for shipping
 * UI ahead of the translation catalogue: an English string always renders today,
 * and the day someone adds the key to `src/i18n/en.ts` (and to the other
 * locales) the real translation takes over with no code change. Deleting a key
 * from `ED2K_STRINGS` once it exists upstream is the only follow-up needed.
 */

import { useCallback } from 'react';

import { interpolate } from '@/i18n';
import { useTranslate } from '@/i18n/react';
import type { TranslateFn, TranslateParams } from '@/i18n/types';

export * from './format';
export { useEd2kSearch, isEd2kEnabled, compactOptions, DEFAULT_POLL_INTERVAL_MS } from './useEd2kSearch';
export type { Ed2kSearchState, Ed2kSupport, Ed2kSupportReason } from './useEd2kSearch';

/**
 * English copy for everything the ED2K page shows that AriaNg has no key for.
 *
 * Keys use the catalogue's dotted `section.key` style so a future real key can
 * take over verbatim. `{{placeholders}}` use angular-translate's syntax, which
 * is what `interpolate()` implements.
 */
export const ED2K_STRINGS: Readonly<Record<string, string>> = {
  /* ---- page ---- */
  'ed2k.title': 'ED2K Search',
  'ed2k.subtitle': 'Query the ED2K/eMule network and add any result as a download.',
  'ed2k.how.title': 'How ED2K search works',
  'ed2k.how.body':
    'Results are gathered asynchronously from the configured ED2K servers and Kad bootstrap nodes, so they keep arriving for a while after the search starts. With no ED2K server, server list or node list configured, aria2-next falls back to its built-in bootstrap servers and the results are often sparse.',
  'ed2k.how.settings': 'Configure ED2K servers and Kad nodes',
  'ed2k.how.share':
    'This page is shareable: append ?keyword=… to the URL and the search runs on arrival.',
  'ed2k.checking': 'Checking whether this daemon supports ED2K search…',
  'ed2k.notConnected': 'aria2 is not connected.',

  /* ---- unsupported ---- */
  'ed2k.unsupported.title': 'ED2K search is not available',
  'ed2k.unsupported.notAria2Next':
    'The connected daemon does not identify itself as aria2-next, and aria2.ed2kSearch / aria2.getEd2kSearchResults are aria2-next-only methods.',
  'ed2k.unsupported.featureDisabled':
    'The connected daemon is aria2-next, but it reports no ED2K feature. Rebuild it with ED2K support to use this page.',
  'ed2k.unsupported.unauthorized':
    'The RPC secret was rejected, so the daemon version could not be read. Check the secret in Settings → RPC.',
  'ed2k.unsupported.versionFailed': 'The daemon version could not be read.',
  'ed2k.unsupported.noDaemon': 'No RPC connection, so the daemon version cannot be read.',
  'ed2k.unsupported.statusPage': 'Open the Status page',

  /* ---- errors raised by the hook ---- */
  'ed2k.error.unsupported': 'ED2K search is not supported by the connected daemon.',
  'ed2k.error.not-connected': 'aria2 is not connected.',
  'ed2k.error.empty-keyword': 'Enter a keyword to search for.',

  /**
   * `RPC_ERROR_HINTS` in `src/rpc/errors.ts` maps aria2's English error
   * literals onto `rpc.error.*` keys, but AriaNg's catalogue only defines
   * `rpc.error.unauthorized` — so `describeError()` would hand the UI a key that
   * resolves to *itself*. The fallbacks below are page-local and can be deleted
   * wholesale once the catalogue defines them.
   */
  'rpc.error.cannotConnect': 'Cannot connect to aria2!',
  'rpc.error.badRequest': 'Bad request',
  'rpc.error.jsonParseError': 'JSON Parse Error',
  'rpc.error.secretTokenMismatch': 'Secret token mismatch',
  'rpc.error.methodNotFound': 'Method not found — this daemon does not implement aria2.ed2kSearch',
  'rpc.error.invalidGid': 'Invalid GID',
  'rpc.error.noSuchFile': 'No such file or directory',
  'rpc.error.rpcProfileChanged': 'RPC profile changed',

  /* ---- form ---- */
  'ed2k.keyword': 'Keyword',
  'ed2k.keywordPlaceholder': 'What are you looking for?',
  'ed2k.search': 'Search',
  'ed2k.searching': 'Searching…',
  'ed2k.stop': 'Stop search',
  'ed2k.refresh': 'Refresh results',
  'ed2k.clear': 'Clear',
  'ed2k.advanced': 'Advanced',
  'ed2k.advanced.hint':
    'Sent with this search only. Leave a field empty to fall back to the global ED2K setting.',
  'ed2k.option.ed2k-server': 'ED2K Servers',
  'ed2k.option.ed2k-server-list': 'ED2K Server List',
  'ed2k.option.ed2k-node-list': 'Kad Node List',
  'ed2k.option.ed2k-server.hint':
    'Comma-separated HOST:PORT list (for example 203.0.113.10:4661,198.51.100.7:4662).',
  'ed2k.option.ed2k-server-list.hint': 'Path to a local eMule server.met file.',
  'ed2k.option.ed2k-node-list.hint': 'Path to a local eMule nodes.dat file.',
  'ed2k.usingGlobal': 'Global: {{value}}',

  /* ---- table ---- */
  'ed2k.results': 'Results',
  'ed2k.resultCount': '{{count}} results',
  'ed2k.streaming': 'More results may still arrive…',
  'ed2k.column.sourceNetwork': 'Source Network',
  'ed2k.column.mediaCodec': 'Media Codec',
  'ed2k.column.actions': 'Actions',
  'ed2k.sources': '{{count}} sources',
  'ed2k.download': 'Download',
  'ed2k.copyLink': 'Copy ED2K Link',
  'ed2k.details': 'Details',
  'ed2k.notDownloadable':
    'aria2-next did not resolve an ED2K link for this file, so it cannot be added as a download.',
  'ed2k.selectAll': 'Select all results',
  'ed2k.clearSelection': 'Clear selection',
  'ed2k.selectedCount': '{{count}} selected',
  'ed2k.downloadSelected': 'Download selected',
  'ed2k.downloading': 'Adding…',

  /* ---- empty & error states ---- */
  'ed2k.empty.idle.title': 'No search yet',
  'ed2k.empty.idle.body': 'Enter a keyword above and press Search to query the ED2K network.',
  'ed2k.empty.waiting.title': 'Searching the ED2K network…',
  'ed2k.empty.waiting.body':
    'Results arrive as the configured servers answer, which usually takes a few seconds.',
  'ed2k.empty.none.title': 'No results',
  'ed2k.empty.none.body':
    'The search finished without a single hit. Try a shorter or more common keyword, or configure more ED2K servers and Kad nodes.',
  'ed2k.error.title': 'The search failed',
  'ed2k.error.retry': 'Try again',

  /* ---- download feedback ---- */
  'ed2k.download.started': 'Added “{{filename}}” to the download queue.',
  'ed2k.download.failed': 'Could not add “{{filename}}”: {{error}}',
  'ed2k.download.open': 'Open',
  'ed2k.download.bulkOk': 'Added {{ok}} of {{total}} to the download queue.',
  'ed2k.download.bulkPartial': 'Added {{ok}} of {{total}}; {{failed}} could not be added.',
  'ed2k.download.bulkFailed': 'None of the {{total}} selected files could be added.',
  'ed2k.copied': 'ED2K link copied.',
  'ed2k.copyFailed': 'Could not copy the ED2K link.',

  /* ---- detail dialog ---- */
  'ed2k.detail.title': 'Search result',
  'ed2k.detail.addUriNote':
    'The ED2K link below is the value handed to aria2.addUri to create a normal ED2K download.',
  'ed2k.detail.filename': 'File Name',
  'ed2k.detail.fileLength': 'File Size',
  'ed2k.detail.fileHash': 'File Hash (MD4)',
  'ed2k.detail.ed2kLink': 'ED2K Link',
  'ed2k.detail.sourceNetwork': 'Source Network',
  'ed2k.detail.mediaCodec': 'Media Codec',
  'ed2k.detail.category': 'Category',
  'ed2k.detail.sources': 'Sources',
  'ed2k.detail.copyField': 'Copy {{field}}',
  'ed2k.detail.unknown': '—',
};

/**
 * `useTranslate` plus the local ED2K catalogue (see the module comment).
 *
 * The identity check `t(key) !== key` is what `i18n` documents as its
 * last-resort behaviour, so a key that *does* exist in the active locale — or in
 * the English fallback — wins over {@link ED2K_STRINGS}, and a key that exists
 * nowhere falls through to the local English string.
 */
export function useLocalTranslate(): TranslateFn {
  const t = useTranslate();

  return useCallback<TranslateFn>(
    (key: string, params?: TranslateParams) => {
      const translated = t(key, params);
      if (translated !== key) {
        return translated;
      }

      const local = ED2K_STRINGS[key];
      return local === undefined ? key : interpolate(local, params);
    },
    [t],
  );
}

/**
 * The option keys the Advanced section exposes, in the order they are shown.
 *
 * All three are real aria2-next options (`--ed2k-server`, `--ed2k-server-list`,
 * `--ed2k-node-list`) and all three are accepted by `aria2.ed2kSearch` as
 * request options, so overriding them per search needs no special casing.
 */
export const ED2K_SEARCH_OPTION_KEYS = ['ed2k-server', 'ed2k-server-list', 'ed2k-node-list'] as const;

export type Ed2kSearchOptionKey = (typeof ED2K_SEARCH_OPTION_KEYS)[number];

/** Localised label of one advanced option, falling back to the raw key. */
export function optionLabel(key: string, t: TranslateFn): string {
  const translated = t(`ed2k.option.${key}`);
  return translated === `ed2k.option.${key}` ? key : translated;
}

/** Localised hint of one advanced option, or `undefined` when there is none. */
export function optionHint(key: string, t: TranslateFn): string | undefined {
  const hintKey = `ed2k.option.${key}.hint`;
  const translated = t(hintKey);
  return translated === hintKey ? undefined : translated;
}
