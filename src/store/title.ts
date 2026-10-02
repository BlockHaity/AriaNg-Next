/**
 * Port of AriaNg's `ariaNgTitleService` — the document-title templating used
 * by the `title` setting (`${downspeed}, ${upspeed} - ${title}`).
 *
 * ## Syntax
 *
 * ```
 * ${title}  ${rpcprofile}  ${downloading}  ${waiting}  ${stopped}  ${downspeed}  ${upspeed}
 * ```
 *
 * each optionally followed by any number of tags:
 *
 * | tag           | effect                                                        |
 * | ------------- | ------------------------------------------------------------- |
 * | `:noprefix`   | drop the translated label, keep the value                      |
 * | `:nosuffix`   | drop the `/s` unit on the two speed placeholders               |
 * | `:scale=n`    | divide the numeric value by `n` (e.g. `${downspeed:scale=1024}`) |
 *
 * **The tag pattern is `[a-zA-Z0-9]+(=[a-zA-Z0-9]+)?` and that restriction is
 * load-bearing**: it is exactly what AriaNg's regex accepted, so every title
 * string that ever parsed in AriaNg still parses here. Widening it to
 * `-`/`_`/`.` would be harmless, but narrowing it further would silently break
 * an existing user's saved title — and a template that fails to match is left
 * in the tab verbatim, which looks like a bug rather than a migration.
 *
 * ## i18n
 *
 * The module is deliberately i18n-agnostic: the label fragments are translation
 * **keys** (`Downloading`, `Waiting`, `Finished / Stopped`, `Download`,
 * `Upload`) and are handed to the injected `format` function, so nothing here
 * imports the i18n store. The same function is offered the numeric fragment
 * (`'1048576'`), which is how an app can render `1.00 MB/s` by wiring
 * `readableVolume`; a plain `i18n.t` also works, because unknown keys are
 * returned verbatim.
 */
import { APP_CONSTANTS, rpcProfileDisplayName } from '@/config/defaults';
import type { RpcProfile } from '@/config/types';

/** Every placeholder the template syntax knows about, in AriaNg's order. */
export const TITLE_PLACEHOLDERS = [
  'title',
  'rpcprofile',
  'downloading',
  'waiting',
  'stopped',
  'downspeed',
  'upspeed',
] as const;

export type TitlePlaceholder = (typeof TITLE_PLACEHOLDERS)[number];

export interface GlobalStatLike {
  downloadSpeed: number;
  numActive: number;
  numWaiting: number;
  numStopped: number;
  uploadSpeed: number;
}

export interface TitleContext {
  /** `aria2.getGlobalStat`; absent while the first poll is still in flight. */
  globalStat?: GlobalStatLike;
  currentRpcProfile?: RpcProfile;
}

/**
 * Localisation hook. Called once per visible fragment; the app passes
 * `i18n.t`, tests pass a stub.
 */
export type TitleFormatter = (value: string) => string;

/** The default template (`AriaNgSettings.title`). */
export const DEFAULT_TITLE_TEMPLATE = '${downspeed}, ${upspeed} - ${title}';

/** Unit suffix AriaNg appended to the two speed placeholders. */
const SPEED_SUFFIX = '/s';

/** Translation key per placeholder. `${rpcprofile}` / `${title}` carry none. */
const PREFIX_KEYS: Partial<Record<TitlePlaceholder, string>> = {
  downloading: 'Downloading',
  waiting: 'Waiting',
  stopped: 'Finished / Stopped',
  downspeed: 'Download',
  upspeed: 'Upload',
};

/**
 * AriaNg's matcher, verbatim.
 *
 * The tag group is `(:[a-zA-Z0-9]+(=[a-zA-Z0-9]+)?)*` — see the module comment
 * for why the character class must not be widened. A template whose placeholder
 * is not one of the seven known names does not match at all and is therefore
 * left in the title untouched, which is also what makes `${` + a literal `}`
 * usable.
 */
const TITLE_PATTERN = new RegExp(
  `\\$\\{(${TITLE_PLACEHOLDERS.join('|')})((?::[a-zA-Z0-9]+(?:=[a-zA-Z0-9]+)?)*)\\}`,
  'g',
);

/** Test/preview helper: a template that uses every placeholder. */
export const ALL_PLACEHOLDERS_TEMPLATE = TITLE_PLACEHOLDERS.map((name) => `\${${name}}`).join(' ');

interface PlaceholderTags {
  noPrefix: boolean;
  noSuffix: boolean;
  scale: number;
}

function parseTags(tags: string): PlaceholderTags {
  const parsed: PlaceholderTags = { noPrefix: false, noSuffix: false, scale: 1 };

  if (!tags) return parsed;

  for (const tag of tags.split(':')) {
    if (!tag) continue;
    if (tag === 'noprefix') {
      parsed.noPrefix = true;
    } else if (tag === 'nosuffix') {
      parsed.noSuffix = true;
    } else if (tag.indexOf('scale=') === 0) {
      const raw = tag.slice('scale='.length);
      const value = Number.parseInt(raw, 10);
      // `:scale=abc` matches AriaNg's pattern but produced `NaN`; treat it as
      // "no scaling" instead of poisoning the whole title with `NaN`.
      if (Number.isFinite(value) && value !== 0) parsed.scale = value;
    }
  }

  return parsed;
}

/**
 * `label: value<suffix>`, dropping whichever part a tag switched off.
 *
 * The unit is glued to the value (`1000/s`, not `1000 /s`) and disappears with
 * it, so a missing `globalStat` yields the bare label instead of a dangling
 * `/s`.
 */
function compose(
  format: TitleFormatter,
  prefixKey: string | undefined,
  value: string | undefined,
  suffix: string,
  tags: PlaceholderTags,
): string {
  const parts: string[] = [];

  if (!tags.noPrefix && prefixKey) {
    parts.push(format(prefixKey));
  }
  if (value) {
    parts.push(format(value) + (tags.noSuffix ? '' : suffix));
  }

  return parts.filter((part) => part !== '').join(' ');
}

function safeNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function renderPlaceholder(
  name: TitlePlaceholder,
  tags: PlaceholderTags,
  context: TitleContext,
  format: TitleFormatter,
): string {
  const stat = context.globalStat;
  const scale = tags.scale;

  switch (name) {
    case 'title':
      return compose(format, undefined, APP_CONSTANTS.title, '', tags);

    case 'rpcprofile': {
      const profile = context.currentRpcProfile;
      if (!profile) return '';
      return compose(format, undefined, rpcProfileDisplayName(profile), '', tags);
    }

    case 'downloading': {
      const value = safeNumber(stat?.numActive);
      return compose(
        format,
        PREFIX_KEYS.downloading,
        value === undefined ? undefined : String(value / scale),
        '',
        tags,
      );
    }

    case 'waiting': {
      const value = safeNumber(stat?.numWaiting);
      return compose(
        format,
        PREFIX_KEYS.waiting,
        value === undefined ? undefined : String(value / scale),
        '',
        tags,
      );
    }

    case 'stopped': {
      const value = safeNumber(stat?.numStopped);
      return compose(
        format,
        PREFIX_KEYS.stopped,
        value === undefined ? undefined : String(value / scale),
        '',
        tags,
      );
    }

    case 'downspeed': {
      const value = safeNumber(stat?.downloadSpeed);
      return compose(
        format,
        PREFIX_KEYS.downspeed,
        value === undefined ? undefined : String(value / scale),
        SPEED_SUFFIX,
        tags,
      );
    }

    case 'upspeed': {
      const value = safeNumber(stat?.uploadSpeed);
      return compose(
        format,
        PREFIX_KEYS.upspeed,
        value === undefined ? undefined : String(value / scale),
        SPEED_SUFFIX,
        tags,
      );
    }

    default:
      // Unreachable: the regex only matches the seven known names.
      return '';
  }
}

/**
 * Expands a title template.
 *
 * An empty (or whitespace-only) template falls back to `APP_CONSTANTS.title`,
 * which is AriaNg's behaviour: a user who clears the setting still gets a title
 * instead of a blank tab.
 */
export function getFinalTitle(
  template: string,
  context: TitleContext,
  format: TitleFormatter,
): string {
  const source = typeof template === 'string' ? template.trim() : '';
  if (!source) return format(APP_CONSTANTS.title);

  TITLE_PATTERN.lastIndex = 0;
  return source.replace(TITLE_PATTERN, (_match, name: string, tags: string) =>
    renderPlaceholder(name as TitlePlaceholder, parseTags(tags), context, format),
  );
}

/**
 * `getFinalTitle` + `document.title = …`.
 *
 * A no-op outside a DOM (node tests, a future worker-side use).
 */
export function applyTitle(
  template: string,
  context: TitleContext,
  format: TitleFormatter,
): void {
  if (typeof document === 'undefined') return;
  document.title = getFinalTitle(template, context, format);
}

export interface TitleUpdaterOptions {
  /** `settings.titleRefreshInterval` in ms; `<= 0` disables the updater. */
  intervalMs: number;
  getTemplate: () => string;
  getContext: () => TitleContext;
  format: TitleFormatter;
}

/**
 * Starts the `setInterval` AriaNg ran from its title service.
 *
 * The title is written once immediately (so a reload does not keep the previous
 * template for a whole refresh interval) and then on every tick. Returns the
 * stop function; calling it twice is safe.
 */
export function startTitleUpdater(options: TitleUpdaterOptions): () => void {
  const { intervalMs, getTemplate, getContext, format } = options;

  if (typeof intervalMs !== 'number' || intervalMs <= 0) {
    return () => {};
  }

  const tick = () => applyTitle(getTemplate(), getContext(), format);
  tick();

  const handle = setInterval(tick, intervalMs);

  return () => {
    clearInterval(handle);
  };
}
