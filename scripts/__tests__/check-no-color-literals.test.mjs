/**
 * Detection tests for the MD3 colour guard.
 *
 * The guard is only useful while its exit code is trusted, and a regex-based
 * guard is easy to make so noisy that people start disabling it. These tests
 * therefore cover BOTH directions: the literals that must be flagged and the
 * perfectly legal mdui code that must not be.
 *
 * Run with: npx vitest run scripts
 *
 * @vitest-environment node
 *
 * The node environment is required, not cosmetic: the guard resolves the
 * repository root through `import.meta.url`, and under the jsdom environment
 * that resolves to an http URL, so `fileURLToPath` throws "The URL must be of
 * scheme file". These are build-time scripts — they touch the filesystem and
 * have no business in a DOM.
 */

/* global process, URL */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ALLOW_COLOR_MARKER,
  RULES,
  checkProject,
  checkSource,
  skipReasonFor,
} from '../check-no-color-literals.mjs';

/** Absolute repository root, so the real-tree checks do not depend on cwd. */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Rule ids present in a source snippet, for terse assertions. */
function rulesFor(source, path = 'src/fixture.tsx') {
  return checkSource(source, { path }).map((violation) => violation.rule);
}

/** All violations found in a snippet. */
function violationsFor(source, path = 'src/fixture.tsx') {
  return checkSource(source, { path });
}

/* -------------------------------------------------------------------------- */
/* hex literals                                                               */
/* -------------------------------------------------------------------------- */

describe('hex colour literals', () => {
  it('flags a hex colour in a string literal', () => {
    const source = `const BORDER = '#4d90fe';\n`;
    const violations = violationsFor(source);
    expect(violations).toHaveLength(1);
    // Column 17 is the `#`; the guard points at the literal, not the string.
    expect(violations[0]).toMatchObject({ rule: 'hex', line: 1, column: 17 });
    expect(violations[0].snippet).toBe("const BORDER = '#4d90fe';");
  });

  it('flags 3, 4, 6 and 8 digit forms', () => {
    const source = [
      `const a = '#fff';`,
      `const b = '#ffff';`,
      `const c = '#6750a4';`,
      `const d = '#6750a480';`,
    ].join('\n');
    expect(rulesFor(source)).toEqual(['hex', 'hex', 'hex', 'hex']);
  });

  it('does not flag a commented-out hex', () => {
    const source = [
      `// the old bar colour was #4d90fe`,
      `/**`,
      ` * Legacy: #208fe5`,
      ` */`,
      `const color = 'rgb(var(--mdui-color-primary))';`,
    ].join('\n');
    expect(violationsFor(source)).toEqual([]);
  });

  it('does not flag a CSS selector such as #root', () => {
    const source = ['#root {', '  color: var(--mdui-color-on-surface);', '}'].join('\n');
    expect(violationsFor(source, 'src/fixture.css')).toEqual([]);
  });

  it('does not flag a url(#fragment) reference', () => {
    const source = ['.icon {', '  mask-image: url(#add);', '}'].join('\n');
    expect(violationsFor(source, 'src/fixture.css')).toEqual([]);
  });

  it('honours the mdui-allow-color escape hatch', () => {
    const plain = violationsFor(`const LEGACY = '#208fe5';`);
    expect(plain).toHaveLength(1);

    const escaped = violationsFor(
      `const LEGACY = '#208fe5'; // ${ALLOW_COLOR_MARKER} last-resort canvas fallback`,
    );
    expect(escaped).toEqual([]);

    const escapedBlock = violationsFor(
      `const LEGACY = '#208fe5'; /* ${ALLOW_COLOR_MARKER} vendor-mandated */`,
    );
    expect(escapedBlock).toEqual([]);
  });

  it('reports a CSS declaration value with its own line number', () => {
    const source = [`.bar {`, `  fill: #208fe5;`, `}`].join('\n');
    const violations = violationsFor(source, 'src/fixture.css');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'hex', line: 2 });
  });
});

/* -------------------------------------------------------------------------- */
/* functional colours                                                         */
/* -------------------------------------------------------------------------- */

describe('functional colours', () => {
  it('allows the mdui rgb(var(--mdui-color-*)) idiom', () => {
    expect(rulesFor(`const bg = 'rgb(var(--mdui-color-surface-container))';`)).toEqual([]);
    expect(rulesFor(`.a {\n  color: rgb(var(--mdui-color-on-surface));\n}`)).toEqual([]);
  });

  it('allows a custom property as the whole argument list', () => {
    expect(rulesFor(`.a {\n  color: rgb(var(--x));\n}`, 'src/fixture.css')).toEqual([]);
  });

  it('flags rgb() with numeric literals', () => {
    const violations = violationsFor(`const c = 'rgb(103, 80, 164)';`);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('colour-fn');
  });

  it('flags rgba() with numeric literals', () => {
    expect(rulesFor(`const c = 'rgba(0, 0, 0, 0.5)';`)).toEqual(['colour-fn']);
  });

  it('flags hsl() with numeric literals', () => {
    const source = [`.a {`, `  color: hsl(258, 90%, 66%);`, `}`].join('\n');
    const violations = violationsFor(source, 'src/fixture.css');
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('colour-fn');
  });

  it('flags hsla() with numeric literals', () => {
    expect(rulesFor(`const c = 'hsla(258, 90%, 66%, 0.4)';`)).toEqual(['colour-fn']);
  });

  it('flags oklch() with numeric literals', () => {
    const source = [`.a {`, `  color: oklch(0.55 0.13 293);`, `}`].join('\n');
    expect(violationsFor(source, 'src/fixture.css').map((v) => v.rule)).toEqual(['modern-fn']);
  });

  it('flags color-mix() that mixes numbers or raw colours', () => {
    const source = [`.a {`, `  color: color-mix(in srgb, red 40%, blue);`, `}`].join('\n');
    expect(violationsFor(source, 'src/fixture.css').map((v) => v.rule)).toEqual(['modern-fn']);
  });

  it('allows color-mix() over MD3 tokens', () => {
    const source = [`.a {`, `  color: color-mix(in srgb, var(--mdui-color-primary), transparent);`, `}`].join('\n');
    expect(violationsFor(source, 'src/fixture.css')).toEqual([]);
  });

  it('does not mistake a colourless function for a colour', () => {
    expect(rulesFor(`const s = 'translate(10px, 20px)';`)).toEqual([]);
    expect(rulesFor(`.a {\n  transform: rotate(45deg);\n}`, 'src/fixture.css')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* named colours                                                              */
/* -------------------------------------------------------------------------- */

describe('named CSS colours', () => {
  it('flags a named colour inside a style object', () => {
    const source = [`const el = <div style={{ color: 'red' }} />;`].join('\n');
    const violations = violationsFor(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: 'named-colour', line: 1 });
  });

  it.each(['white', 'black', 'red', 'blue', 'green', 'grey', 'gray', 'silver'])(
    'flags the named colour %s in a style object',
    (name) => {
      const source = `const el = <span style={{ backgroundColor: '${name}' }} />;`;
      expect(rulesFor(source)).toEqual(['named-colour']);
    },
  );

  it.each(['transparent', 'currentColor'])('always allows %s', (keyword) => {
    expect(rulesFor(`const el = <span style={{ color: '${keyword}' }} />;`)).toEqual([]);
    expect(rulesFor(`.a {\n  color: ${keyword};\n}`, 'src/fixture.css')).toEqual([]);
  });

  it('flags a named colour in a CSS declaration value', () => {
    const source = [`.a {`, `  background: white;`, `}`].join('\n');
    expect(violationsFor(source, 'src/fixture.css').map((v) => v.rule)).toEqual(['named-colour']);
  });

  it('flags a named colour set through the inline style API', () => {
    const source = `el.style.setProperty('color', 'blue');`;
    expect(rulesFor(source)).toEqual(['named-colour']);
    expect(rulesFor(`el.style.backgroundColor = 'red';`)).toEqual(['named-colour']);
  });

  it('does not flag words that merely contain a colour name', () => {
    expect(rulesFor(`const s = 'bluetooth';`)).toEqual([]);
    expect(rulesFor(`const el = <span style={{ fontFamily: 'Roboto' }} />;`)).toEqual([]);
  });

  it('does not flag an i18n key that ends in a colour name', () => {
    const source = `export const SEEDS = [{ nameKey: 'theme.color.blue', hex: '#415f91' }];`;
    const violations = violationsFor(source, 'src/i18n/en.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('hex');
  });
});

/* -------------------------------------------------------------------------- */
/* skipped paths and exit codes                                               */
/* -------------------------------------------------------------------------- */

describe('skipped paths', () => {
  it('skips generated translation data', () => {
    expect(skipReasonFor('src/i18n/locales/zh_Hans.ts')).not.toBeNull();
    expect(skipReasonFor('src/i18n/locales/index.ts')).not.toBeNull();
    expect(skipReasonFor('src/i18n/en.ts')).not.toBeNull();
  });

  it('does not skip ordinary source', () => {
    expect(skipReasonFor('src/ui/mdui/theme.ts')).toBeNull();
    expect(skipReasonFor('src/styles/global.css')).toBeNull();
    expect(skipReasonFor('src/i18n/format.ts')).toBeNull();
  });

  it('skips test fixtures', () => {
    expect(skipReasonFor('src/ui/__tests__/theme.test.ts')).not.toBeNull();
    expect(skipReasonFor('src/domain/foo.spec.tsx')).not.toBeNull();
  });

  it('does not report violations inside skipped files', () => {
    const report = checkProject({ root: `${REPO_ROOT}src/i18n/locales` });
    expect(report.violations).toEqual([]);
    expect(report.scannedFiles).toBe(0);
    expect(report.skippedFiles.length).toBeGreaterThan(0);
  });
});

describe('project report', () => {
  it('passes on the real tree', () => {
    const report = checkProject({ root: `${REPO_ROOT}src` });
    if (!report.ok) {
      const detail = report.violations
        .map((violation) => `${violation.path}:${violation.line} ${violation.message}`)
        .join('\n');
      throw new Error(`guard reported violations on a clean tree:\n${detail}`);
    }
    expect(report.ok).toBe(true);
    expect(report.scannedFiles).toBeGreaterThan(0);
  });
});

describe('cli exit codes', () => {
  const script = `${REPO_ROOT}scripts/check-no-color-literals.mjs`;

  /** Run the guard as a child process against a temporary tree. */
  function runGuard(files, args = []) {
    const root = mkdtempSync(join(tmpdir(), 'md3-guard-'));
    const src = join(root, 'src');
    mkdirSync(join(src, 'ui'), { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(src, name), contents);
    }
    const result = spawnSync(process.execPath, [script, '--root', src, ...args], {
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('exits 0 for a clean tree', () => {
    const result = runGuard({
      'ui/theme.ts': `export const COLOR = 'rgb(var(--mdui-color-primary))';\n`,
      'ui/theme.css': `.a {\n  color: var(--mdui-color-on-surface);\n}\n`,
    });
    expect(result.stdout).toContain('OK');
    expect(result.status).toBe(0);
  });

  it('exits 1 for a dirty tree', () => {
    const result = runGuard({
      'ui/theme.ts': `export const COLOR = '#6750a4';\n`,
    });
    expect(result.stdout).toContain('FAIL');
    expect(result.status).toBe(1);
  });

  it('reports violations as JSON with --json', () => {
    const result = runGuard(
      {
        'ui/theme.ts': `export const COLOR = 'rgb(103, 80, 164)';\n`,
      },
      ['--json'],
    );
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({ rule: 'colour-fn', path: 'src/ui/theme.ts' });
  });
});

describe('rule metadata', () => {
  it('documents every rule id used by the detector', () => {
    const ids = RULES.map((rule) => rule.id);
    const violations = violationsFor(
      [
        `const a = '#fff';`,
        `const b = 'rgb(1, 2, 3)';`,
        `const c = 'oklch(0.5 0.1 200)';`,
        `const d = <span style={{ color: 'red' }} />;`,
      ].join('\n'),
    );
    for (const violation of violations) expect(ids).toContain(violation.rule);
    expect(violations.map((violation) => violation.rule)).toEqual([
      'hex',
      'colour-fn',
      'modern-fn',
      'named-colour',
    ]);
  });
});