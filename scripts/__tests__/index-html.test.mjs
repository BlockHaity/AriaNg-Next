/**
 * `index.html` contract.
 *
 * Two things are asserted here that no module test can reach, because they are
 * properties of the shipped HTML rather than of any import:
 *
 * 1. The Material Icons **webfont fallback**. Icons are inline SVG from
 *    `@mdui/icons` — no network, works offline and from `file://`. But mdui's own
 *    icon API, and anything that reaches for a name outside the imported set,
 *    renders `<mdui-icon name="…">`, which is a **font ligature**: with no
 *    webfont the name is displayed as literal text. That was reported as "所有图标
 *    全部爆炸，全是文字". Loading the stylesheet turns that fallback path into a
 *    real icon instead of a word.
 *
 * 2. That nothing in the document re-breaks sub-path deployment. The size guard
 *    (`scripts/check-bundle-size.mjs`) covers asset URLs; this covers the parts
 *    it cannot see.
 *
 * Lives under `scripts/` because it reads the repo with `node:fs`, and
 * `tsconfig.app.json` deliberately has no Node types — application code must not
 * be able to reach the filesystem.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HTML = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf8');

const FONT_CSS = 'https://fonts.googleapis.com/icon?family=Material+Icons';

describe('index.html — Material Icons webfont fallback', () => {
  it('loads the Material Icons stylesheet from the network', () => {
    expect(HTML).toContain(FONT_CSS);
  });

  it('preconnects to the font host so the woff2 is not a second-round trip', () => {
    expect(HTML).toContain('rel="preconnect"');
    expect(HTML).toContain('https://fonts.gstatic.com');
  });

  it('loads it without blocking first paint', () => {
    // `media="print"` + the onload swap is the standard non-blocking pattern: the
    // stylesheet is fetched at low priority and promoted to `all` once it arrives.
    // The app is fully usable without it, so a slow or blocked CDN must not delay
    // the first paint.
    expect(HTML).toMatch(/media="print"/);
    expect(HTML).toContain("this.media='all'");
  });

  it('offers a blocking copy for users without JavaScript', () => {
    // The onload swap cannot run without JS, so `<noscript>` carries a plain copy.
    // Comments are stripped first: the explanatory comment above mentions
    // `<noscript>` in prose, which the regex would otherwise latch onto.
    const markup = HTML.replace(/<!--[\s\S]*?-->/g, '');
    expect(markup).toContain('<noscript>');
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(markup);
    expect(noscript).not.toBeNull();
    expect(noscript[1]).toContain(FONT_CSS);
    expect(noscript[1]).not.toContain('media="print"');
  });

  it('declares light and dark as supported colour schemes', () => {
    expect(HTML).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"/);
  });

  it('ships a media-scoped theme-color per scheme, so the first frame is right', () => {
    // A single hard-coded theme-color makes the browser chrome the wrong shade
    // until JavaScript runs. Two media-scoped tags are correct from frame one,
    // and `syncThemeColor()` rewrites both once the app boots.
    const markup = HTML.replace(/<!--[\s\S]*?-->/g, '');
    const tags = [...markup.matchAll(/<meta\s+name="theme-color"\s+content="([^"]+)"\s+media="([^"]+)"/g)];
    expect(tags).toHaveLength(2);
    expect(tags.map((match) => match[2])).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-color-scheme: dark)',
    ]);
    // MD3 baseline `surface` tones, so the two are actually different.
    expect(tags[0][1]).not.toBe(tags[1][1]);
  });
});

describe('index.html — sub-path deployability', () => {
  it('has no root-relative asset reference', () => {
    // `base: './'` in vite.config.ts must keep every local URL relative, or the
    // app only runs from the domain root.
    const offenders = [...HTML.matchAll(/\b(?:src|href)="(\/[^/][^"]*)"/g)].map((match) => match[1]);
    expect(offenders).toEqual([]);
  });

  it('keeps the entry script relative', () => {
    expect(HTML).toContain('src="./src/main.tsx"');
  });

  it('uses base-relative favicons', () => {
    expect(HTML).toContain('href="./favicon.svg"');
  });
});

describe('index.html — first-paint guard', () => {
  it('hides undefined custom elements so mdui components do not flash', () => {
    expect(HTML).toMatch(/:not\(:defined\)\s*\{[^}]*visibility:\s*hidden/);
  });

  it('keeps the body invisible until the app marks itself ready', () => {
    expect(HTML).toMatch(/body\s*\{[^}]*opacity:\s*0/);
    expect(HTML).toMatch(/\.ready\s*\{[^}]*opacity:\s*1/);
  });
});