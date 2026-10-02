/**
 * Icon registry.
 *
 * `@mdui/icons` ships one self-registering custom element per Material Symbols
 * icon (`play-arrow.js` → `<mdui-icon-play-arrow>`). Importing the whole package
 * would add thousands of modules, so only the icons this app uses are imported.
 *
 * Two flavours exist for every icon:
 *   - `@mdui/icons/<name>.js`             → `<mdui-icon-<name>>`             (filled)
 *   - `@mdui/icons/<name>--outlined.js`   → `<mdui-icon-<name>--outlined>`   (outlined)
 *
 * `icon('download')` resolves to the filled tag, `icon('outline:download')` to
 * the outlined one.
 *
 * NOTE: `<mdui-icon name="...">` (the `mdui` component) renders the name as a
 * *font glyph* and therefore needs the Material Icons webfont. The elements
 * registered here are inline SVG and need no font at all, which is why the
 * wrappers prefer them.
 */

import '@mdui/icons/graphic-eq.js';
import '@mdui/icons/fiber-manual-record.js';
import '@mdui/icons/data-exploration.js';
import '@mdui/icons/timeline.js';
import '@mdui/icons/rocket-launch.js';
import '@mdui/icons/science.js';
import '@mdui/icons/bug-report.js';
import '@mdui/icons/insert-chart.js';
import '@mdui/icons/archive.js';
import '@mdui/icons/image.js';
import '@mdui/icons/music-note.js';
import '@mdui/icons/movie.js';
import '@mdui/icons/subtitles.js';
import '@mdui/icons/cast.js';
import '@mdui/icons/playlist-add.js';
import '@mdui/icons/block.js';
import '@mdui/icons/done.js';
import '@mdui/icons/remove.js';
import '@mdui/icons/swap-vert.js';
import '@mdui/icons/table-chart.js';
import '@mdui/icons/save.js';
import '@mdui/icons/folder-open.js';
import '@mdui/icons/folder.js';
import '@mdui/icons/chevron-right.js';
import '@mdui/icons/expand-less.js';
import '@mdui/icons/expand-more.js';
import '@mdui/icons/bolt.js';
import '@mdui/icons/cloud-download.js';
import '@mdui/icons/visibility.js';
import '@mdui/icons/key.js';
import '@mdui/icons/lan.js';
import '@mdui/icons/public.js';
import '@mdui/icons/open-in-new.js';
import '@mdui/icons/speed.js';
import '@mdui/icons/done-all.js';
import '@mdui/icons/restart-alt.js';
import '@mdui/icons/arrow-back.js';
import '@mdui/icons/keyboard-arrow-up.js';
import '@mdui/icons/keyboard-arrow-right.js';
import '@mdui/icons/keyboard-arrow-down.js';
import '@mdui/icons/menu.js';
import '@mdui/icons/hub.js';
import '@mdui/icons/content-copy.js';
import '@mdui/icons/schedule.js';
import '@mdui/icons/upload.js';
import '@mdui/icons/terminal.js';
import '@mdui/icons/dns.js';
import '@mdui/icons/language.js';
import '@mdui/icons/light-mode.js';
import '@mdui/icons/dark-mode.js';
import '@mdui/icons/contrast.js';
import '@mdui/icons/tune.js';
import '@mdui/icons/filter-list.js';
import '@mdui/icons/sort.js';
import '@mdui/icons/edit.js';
import '@mdui/icons/check.js';
import '@mdui/icons/info.js';
import '@mdui/icons/warning.js';
import '@mdui/icons/error.js';
import '@mdui/icons/link.js';
import '@mdui/icons/insert-drive-file.js';
import '@mdui/icons/more-vert.js';
import '@mdui/icons/refresh.js';
import '@mdui/icons/close.js';
import '@mdui/icons/search.js';
import '@mdui/icons/add.js';
import '@mdui/icons/settings.js';
import '@mdui/icons/delete.js';
import '@mdui/icons/stop.js';
import '@mdui/icons/play-arrow.js';
import '@mdui/icons/pause.js';
import '@mdui/icons/download.js';

// Outlined variants. Every one of the above ships an `--outlined` sibling.
import '@mdui/icons/graphic-eq--outlined.js';
import '@mdui/icons/fiber-manual-record--outlined.js';
import '@mdui/icons/data-exploration--outlined.js';
import '@mdui/icons/timeline--outlined.js';
import '@mdui/icons/rocket-launch--outlined.js';
import '@mdui/icons/science--outlined.js';
import '@mdui/icons/bug-report--outlined.js';
import '@mdui/icons/insert-chart--outlined.js';
import '@mdui/icons/archive--outlined.js';
import '@mdui/icons/image--outlined.js';
import '@mdui/icons/music-note--outlined.js';
import '@mdui/icons/movie--outlined.js';
import '@mdui/icons/subtitles--outlined.js';
import '@mdui/icons/cast--outlined.js';
import '@mdui/icons/playlist-add--outlined.js';
import '@mdui/icons/block--outlined.js';
import '@mdui/icons/done--outlined.js';
import '@mdui/icons/remove--outlined.js';
import '@mdui/icons/swap-vert--outlined.js';
import '@mdui/icons/table-chart--outlined.js';
import '@mdui/icons/save--outlined.js';
import '@mdui/icons/folder-open--outlined.js';
import '@mdui/icons/folder--outlined.js';
import '@mdui/icons/chevron-right--outlined.js';
import '@mdui/icons/expand-less--outlined.js';
import '@mdui/icons/expand-more--outlined.js';
import '@mdui/icons/bolt--outlined.js';
import '@mdui/icons/cloud-download--outlined.js';
import '@mdui/icons/visibility--outlined.js';
import '@mdui/icons/key--outlined.js';
import '@mdui/icons/lan--outlined.js';
import '@mdui/icons/public--outlined.js';
import '@mdui/icons/open-in-new--outlined.js';
import '@mdui/icons/speed--outlined.js';
import '@mdui/icons/done-all--outlined.js';
import '@mdui/icons/restart-alt--outlined.js';
import '@mdui/icons/arrow-back--outlined.js';
import '@mdui/icons/keyboard-arrow-up--outlined.js';
import '@mdui/icons/keyboard-arrow-right--outlined.js';
import '@mdui/icons/keyboard-arrow-down--outlined.js';
import '@mdui/icons/menu--outlined.js';
import '@mdui/icons/hub--outlined.js';
import '@mdui/icons/content-copy--outlined.js';
import '@mdui/icons/schedule--outlined.js';
import '@mdui/icons/upload--outlined.js';
import '@mdui/icons/terminal--outlined.js';
import '@mdui/icons/dns--outlined.js';
import '@mdui/icons/language--outlined.js';
import '@mdui/icons/light-mode--outlined.js';
import '@mdui/icons/dark-mode--outlined.js';
import '@mdui/icons/tune--outlined.js';
import '@mdui/icons/filter-list--outlined.js';
import '@mdui/icons/sort--outlined.js';
import '@mdui/icons/edit--outlined.js';
import '@mdui/icons/check--outlined.js';
import '@mdui/icons/info--outlined.js';
import '@mdui/icons/warning--outlined.js';
import '@mdui/icons/error--outlined.js';
import '@mdui/icons/link--outlined.js';
import '@mdui/icons/insert-drive-file--outlined.js';
import '@mdui/icons/more-vert--outlined.js';
import '@mdui/icons/refresh--outlined.js';
import '@mdui/icons/close--outlined.js';
import '@mdui/icons/search--outlined.js';
import '@mdui/icons/add--outlined.js';
import '@mdui/icons/settings--outlined.js';
import '@mdui/icons/delete--outlined.js';
import '@mdui/icons/stop--outlined.js';
import '@mdui/icons/play-arrow--outlined.js';
import '@mdui/icons/pause--outlined.js';
import '@mdui/icons/download--outlined.js';

/** Every icon base name that was imported above (without flavour suffix). */
const ICON_NAMES = [
  'download',
  'pause',
  'play-arrow',
  'stop',
  'delete',
  'settings',
  'add',
  'search',
  'close',
  'refresh',
  'more-vert',
  'folder',
  'folder-open',
  'insert-drive-file',
  'link',
  'error',
  'warning',
  'info',
  'check',
  'edit',
  'sort',
  'filter-list',
  'tune',
  'dark-mode',
  'light-mode',
  'contrast',
  'language',
  'dns',
  'terminal',
  'upload',
  'schedule',
  'content-copy',
  'hub',
  'menu',
  'keyboard-arrow-down',
  'keyboard-arrow-right',
  'keyboard-arrow-up',
  'arrow-back',
  'restart-alt',
  'done-all',
  'speed',
  'open-in-new',
  'public',
  'lan',
  'key',
  'visibility',
  'cloud-download',
  'bolt',
  'expand-more',
  'expand-less',
  'chevron-right',
  'save',
  'table-chart',
  'swap-vert',
  'remove',
  'done',
  'block',
  'playlist-add',
  'cast',
  'subtitles',
  'movie',
  'music-note',
  'image',
  'archive',
  'insert-chart',
  'bug-report',
  'science',
  'timeline',
  'data-exploration',
  'rocket-launch',
  'fiber-manual-record',
  'graphic-eq',
] as const;

/** Icon base names available to {@link icon}. */
export type IconName = (typeof ICON_NAMES)[number];

/** Every registered `<mdui-icon-*>` custom element tag. */
export const ICON_TAGS: ReadonlySet<string> = new Set(
  ICON_NAMES.flatMap((name) => [`mdui-icon-${name}`, `mdui-icon-${name}--outlined`]),
);

const ICON_NAME_SET: ReadonlySet<string> = new Set<string>(ICON_NAMES);

/** `true` when `name` resolves to an icon this module actually imported. */
export function hasIcon(name: string): name is IconName | `${IconName}` {
  return ICON_NAME_SET.has(stripFlavour(name));
}

function stripFlavour(name: string): string {
  return name.startsWith('outline:') ? name.slice('outline:'.length) : name;
}

/**
 * Resolve an icon name to its custom element tag.
 *
 * `'download'`            → `'mdui-icon-download'`
 * `'outline:download'`    → `'mdui-icon-download--outlined'`
 *
 * Unknown names are returned kebab-cased as-is, so the helper never throws and
 * the caller can decide whether to fall back to the font-based `<mdui-icon>`.
 */
export function icon(name: string): string {
  const outlined = name.startsWith('outline:');
  const base = stripFlavour(name).replace(/[\s_]+/g, '-').toLowerCase();
  return outlined ? `mdui-icon-${base}--outlined` : `mdui-icon-${base}`;
}