/**
 * No font-based icon attributes, anywhere.
 *
 * mdui's `icon` / `end-icon` / `active-icon` / `start-icon` / `selected-icon` /
 * `delete-icon` **attributes** are font-only: the component renders
 * `<mdui-icon name="…">`, a Material Icons webfont ligature. This app uses the
 * inline-SVG elements from `@mdui/icons` instead and never needed that webfont,
 * so every icon rendered as the literal words "play-arrow" / "delete" /
 * "download".
 *
 * Each affected component also takes the icon through a **slot**, which wins over
 * the attribute. The wrappers in `src/ui/mdui/components.tsx` all do that now, but
 * a page is free to write a raw `<mdui-…>` tag when it needs something the
 * wrapper does not expose — and that is exactly how the bug came back twice:
 *
 *   - `NavigationRail` writes raw `<mdui-navigation-rail-item icon active-icon>`
 *     because the wrapper exposes no `onClick`. Its `activeIcon` is
 *     `outline:<name>`, which the font path cannot resolve at all (mdui-icon
 *     splits variants on `--`, not `:`), so clicking a rail row — which hides
 *     `.icon`, shows `.active-icon` and animates `.indicator` from 2rem to 3.5rem —
 *     left the glyph missing and the icon visibly out of place.
 *   - `TaskContextMenu` writes raw `<mdui-menu-item icon>`, where clicking a row
 *     sets `selected` and mdui swaps `<slot name="icon">` for
 *     `<slot name="selected-icon">`, so the attribute stops being rendered and the
 *     row's leading slot changes shape mid-interaction.
 *
 * `<mdui-icon>` itself is fine as a *child* — it is the documented network-font
 * fallback for names outside the imported SVG set, and `index.html` loads the
 * webfont for it. It is the attribute that must never come back.
 *
 * Lives under `scripts/` because it walks the repo with `node:fs` and
 * `tsconfig.app.json` deliberately has no Node types — application code must not
 * be able to reach the filesystem.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(REPO_ROOT, 'src');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-single', '.git']);

/** Attributes that put an mdui component on the webfont icon path. */
const FONT_ICON_ATTRS = ['icon', 'end-icon', 'active-icon', 'start-icon', 'selected-icon', 'delete-icon'];

/**
 * @param {string} dir
 * @returns {string[]} every `.tsx` file below `dir`, POSIX-ish relative paths
 */
function tsxFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsxFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      found.push(relative(REPO_ROOT, full).split('\\').join('/'));
    }
  }
  return found.sort();
}

/**
 * Raw `<mdui-…>` open tags, one per match.
 *
 * Comments and string literals are stripped first: prose about the font path
 * (`// …the \`icon\` attribute is the webfont path…`) mentions these attributes by
 * name and would otherwise be reported as violations of themselves.
 *
 * @param {string} source
 * @returns {Array<{ tag: string, attrs: string[], line: number }>}
 */
export function rawMduiTags(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (match) => match.replace(/[^\n]/g, ' '));

  /** @type {Array<{ tag: string, attrs: string[], line: number }>} */
  const tags = [];
  const openTag = /<mdui-([a-z0-9-]+)([^>]*?)(\/?)>/g;
  let match = openTag.exec(stripped);
  while (match !== null) {
    const [, name, rawAttrs, selfClosing] = match;
    // A self-closing raw tag has no children, so it cannot project a slotted icon
    // — but it may still be setting a font attribute, which is the bug. So no
    // exemption; the attrs are simply inspected.
    tags.push({
      tag: `mdui-${name}`,
      attrs: FONT_ICON_ATTRS.filter((attr) =>
        new RegExp(`(^|[\\s{])${attr}\\s*=`, 'm').test(rawAttrs),
      ),
      line: stripped.slice(0, match.index).split('\n').length,
    });
    // Skip past a self-closing tag so its `>` is not mis-parsed.
    openTag.lastIndex = match.index + match[0].length - (selfClosing ? 1 : 0);
    match = openTag.exec(stripped);
  }
  return tags;
}

const FILES = tsxFiles(SRC);

describe('no font-based icon attributes on mdui elements', () => {
  it('scans the whole src tree (sanity: the file list is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('finds no raw mdui element setting a font icon attribute', () => {
    /** @type {string[]} */
    const violations = [];
    for (const file of FILES) {
      for (const { tag, attrs, line } of rawMduiTags(readFileSync(resolve(REPO_ROOT, file), 'utf8'))) {
        if (attrs.length > 0) {
          violations.push(`${file}:${line}  <${tag}> sets ${attrs.map((a) => `"${a}"`).join(', ')}`);
        }
      }
    }
    expect(
      violations,
      'these raw mdui elements put the icon on the Material Icons webfont path, which\n' +
        'this app never loads — project an <mdui-icon-*> element into a slot instead:\n' +
        violations.join('\n'),
    ).toEqual([]);
  });
});

describe('rawMduiTags', () => {
  it('flags a font icon attribute', () => {
    const [tag] = rawMduiTags('<mdui-menu-item icon="delete">x</mdui-menu-item>');
    expect(tag.tag).toBe('mdui-menu-item');
    expect(tag.attrs).toEqual(['icon']);
  });

  it('flags active-icon as well as icon', () => {
    const [tag] = rawMduiTags('<mdui-navigation-rail-item icon="a" active-icon="b" />');
    expect(tag.attrs).toEqual(['icon', 'active-icon']);
  });

  it('ignores a slotted child', () => {
    expect(rawMduiTags('<mdui-menu-item><mdui-icon-delete slot="icon" /></mdui-menu-item>')[0].attrs).toEqual(
      [],
    );
  });

  it('ignores an attribute whose name merely ends with "icon"', () => {
    // `data-icon` / `my-icon` are not mdui properties; matching must be anchored.
    expect(rawMduiTags('<mdui-button data-icon="x" my-icon="y" />')[0].attrs).toEqual([]);
  });

  it('ignores prose in comments', () => {
    const source = [
      '// the `icon` attribute is the webfont path',
      '/* active-icon="outline:x" would also be wrong */',
      '<mdui-button variant="text">ok</mdui-button>',
    ].join('\n');
    expect(rawMduiTags(source)).toEqual([{ tag: 'mdui-button', attrs: [], line: 3 }]);
  });

  it('reports a raw tag inside a template literal rather than skipping it', () => {
    // A documented limitation, not a guarantee: telling a JS string literal apart
    // from JSX needs a real parser, and the double quotes that delimit JSX
    // attributes are indistinguishable from a string by regex. The failure message
    // names file:line, so a human can judge a report from inside a template — and
    // in practice the only template literals in this tree are the ECharts tooltip
    // HTML in TaskSpeedChart, which projects `<mdui-icon-schedule>` as a child.
    const [tag] = rawMduiTags('const html = `<mdui-chip icon="x">`;');
    expect(tag.tag).toBe('mdui-chip');
    expect(tag.attrs).toEqual(['icon']);
  });

  it('reports the line number', () => {
    const source = 'const a = 1;\nconst b = 2;\n<mdui-tab icon="home" />;';
    expect(rawMduiTags(source)[0].line).toBe(3);
  });
});