/**
 * Legacy conf aliases must not render as editable rows.
 *
 * aria2-next's conf parser accepts the pre-rename spellings of its DHT/LPD options
 * and still reports them over RPC, so they have to stay in the catalogue — removing
 * them would make `scripts/verify-option-catalogue.mjs` report five options "missing"
 * from a live dump. But they are **aliases**: aria2-next maps them onto
 * `--bt-interface` / `--bt-dht-bootstrap-nodes` and logs
 * `Legacy aria2 input from configuration: … skipped because … is already set` when
 * they are written to a conf file.
 *
 * Listing them in the `bt` group therefore produced five locked rows, each tagged
 * `deprecated`, each carrying a paragraph explaining why it should not be used, and
 * each duplicating a setting the user can already edit two rows away. The real options
 * are the targets; the aliases are noise.
 */

import { describe, expect, it } from 'vitest';
import { getOptionMeta } from '@/config/aria2-options';
import { getGlobalOptionKeys } from '@/config/option-groups';
import { OPTION_GROUP_ROUTES } from '@/config/types';
import { EXCLUDED_CONF_KEYS } from '@/domain/aria2-conf';

/** The pre-rename spellings aria2-next still accepts in a conf file. */
const ALIASES = [
  'bt-lpd-interface',
  'dht-listen-addr',
  'dht-listen-addr6',
  'dht-entry-point',
  'dht-entry-point6',
] as const;

/** What each alias resolves to, and therefore what the user should edit instead. */
const TARGETS: Record<(typeof ALIASES)[number], string> = {
  'bt-lpd-interface': 'bt-interface',
  'dht-listen-addr': 'bt-interface',
  'dht-listen-addr6': 'bt-interface',
  'dht-entry-point': 'bt-dht-bootstrap-nodes',
  'dht-entry-point6': 'bt-dht-bootstrap-nodes',
};

/**
 * Every group, flattened — the list the settings page actually renders from.
 *
 * `getGlobalOptionKeys` returns `false` for an unknown group, so the helper is where
 * that is dealt with rather than in each assertion.
 */
function renderedKeys(): string[] {
  return OPTION_GROUP_ROUTES.flatMap((group) => {
    const keys = getGlobalOptionKeys(group);
    if (keys === false) throw new Error(`no such option group: ${group}`);
    return keys;
  });
}

const allRenderedKeys = renderedKeys();

describe('legacy conf aliases', () => {
  it('stay in the catalogue, so verify-option-catalogue does not report them missing', () => {
    for (const key of ALIASES) {
      expect(getOptionMeta(key), key).toBeDefined();
    }
  });

  it('are marked deprecated rather than current or removed', () => {
    for (const key of ALIASES) {
      expect(getOptionMeta(key)?.support, key).toBe('deprecated');
    }
  });

  it('are not rendered on any settings page', () => {
    for (const key of ALIASES) {
      expect(allRenderedKeys, key).not.toContain(key);
    }
  });

  it('name the option to configure instead', () => {
    for (const key of ALIASES) {
      expect(getOptionMeta(key)?.aria2NextNote ?? '', key).toContain(TARGETS[key]);
    }
  });

  it('leave their target options visible', () => {
    // The point of hiding the alias is that the real setting is one click away.
    expect(allRenderedKeys).toContain('bt-interface');
    expect(allRenderedKeys).toContain('bt-dht-bootstrap-nodes');
  });

  it('are excluded from the exported conf, since writing them warns', () => {
    for (const key of ALIASES) {
      expect(EXCLUDED_CONF_KEYS.has(key), key).toBe(true);
    }
  });
});