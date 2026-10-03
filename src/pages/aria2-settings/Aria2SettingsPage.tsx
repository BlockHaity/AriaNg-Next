/**
 * `/settings/aria2/:group` — the aria2 / aria2-next option editor, one group
 * per route.
 *
 * AriaNg's version of this page was 8 lines of HTML plus ~20 lines of
 * controller (`controllers/settings-aria2.js`): read the group from the URL,
 * ask `aria2SettingService` for the keys, `getGlobalOption` once, then let
 * `ng-setting` do the rest. That is exactly what this page does; the work moved
 * into `OptionGroupView` and the shared `OptionRow`.
 *
 * ## Load once
 *
 * `aria2.getGlobalOption` returns **every** global option in one payload, so it
 * runs exactly once per group — never per render, and never on every keystroke.
 * The result is kept in local state and only ever written back one key at a time
 * through `aria2.changeGlobalOption({ [key]: value })`, which is what aria2
 * accepts and what keeps a failed row from rolling the whole blob back.
 *
 * The loading state lives in {@link OptionGroupPanel}, which is keyed by the
 * route: switching groups therefore remounts it (fresh state, no reset effect)
 * and a late answer from the previous group can never land in the new one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getOptionMeta } from '@/config/aria2-options';
import { ARIA2_GLOBAL_GROUPS, ARIA2_GROUP_TITLE_KEYS, getGlobalOptionKeys } from '@/config/option-groups';
import { useTranslate } from '@/i18n/react';
import type { OptionGroupRoute } from '@/config/types';
import type { Aria2OptionMap } from '@/rpc/types';
import { useRpcStore } from '@/store/rpc-store';
import { MduiIconButton, MduiProgressBar } from '@/ui/mdui';
import { ExportAria2ConfDialog } from './ExportAria2ConfDialog';
import { Aria2GroupSwitcher } from './GroupSwitcher';
import { OptionGroupView } from './OptionGroupView';
import { useIsCompactLayout } from '@/app/shell';

import './styles.css';

/** Groups aria2-next added that a stock aria2 daemon silently ignores. */
const ARIA2_NEXT_ONLY_GROUPS: readonly string[] = ['ed2k', 'media'];

/**
 * Sticky-header title per route.
 *
 * `ARIA2_GLOBAL_GROUPS[route].labelKey` points into an `optionGroup.*` namespace
 * the shipped translation bundles do not carry, so translating it would render
 * the raw key. AriaNg's own navigation titles ("Basic Settings",
 * "HTTP/FTP/SFTP Settings", …) *are* in every bundle and are the strings users
 * recognise, so they are mapped here; the two aria2-next groups have no upstream
 * title yet and get a plain English one, which `t()` renders verbatim.
 */
/** Header title of a route; the catalogue's own key is the fallback. */
export function groupTitleKey(group: string, catalogueLabelKey?: string): string {
  return ARIA2_GROUP_TITLE_KEYS[group as OptionGroupRoute] ?? catalogueLabelKey ?? group;
}

export interface Aria2SettingsPageProps {
  /** Overrides the route param; the router supplies it, tests can pass it. */
  group?: string;
}

export function Aria2SettingsPage({ group }: Aria2SettingsPageProps = {}) {
  const params = useParams<{ group?: string }>();
  const t = useTranslate();
  // The shell's own breakpoint helper: `md` and up gets the side-by-side layout.
  const compact = useIsCompactLayout();

  const routeGroup = group ?? params.group ?? '';
  const version = useRpcStore((state) => state.version);
  const [exportOpen, setExportOpen] = useState(false);

  // `false` means "illegal route", exactly as AriaNg's option service reported.
  // Memoised because the panel's load effect depends on it: a fresh array would
  // re-fetch the whole blob on every render.
  const keys = useMemo(() => getGlobalOptionKeys(routeGroup), [routeGroup]);

  if (keys === false) {
    // AriaNg: `ariaNgCommonService.showError('Type is illegal!')`.
    return (
      <div className="aria2-settings" role="alert">
        <p className="aria2-settings__error-text">{t('Type is illegal!')}</p>
      </div>
    );
  }

  const meta = ARIA2_GLOBAL_GROUPS[routeGroup as keyof typeof ARIA2_GLOBAL_GROUPS];
  // Only once `aria2.getVersion` has actually answered: before that the product
  // is unknown, not known-to-differ.
  const showAria2NextBanner = version !== undefined && version.product !== 'aria2-next';

  return (
    <div className={compact ? 'aria2-settings aria2-settings--compact' : 'aria2-settings'}>
      {/*
        The switcher sits beside the option list from `md` upwards and scrolls
        horizontally below it. `useIsCompactLayout` is the shell's own breakpoint
        helper rather than a fresh media query, so the switcher's layout can never
        disagree with the navigation's.
      */}
      <Aria2GroupSwitcher compact={compact} />

      <div className="aria2-settings__main">
      <header className="aria2-settings__header">
        <h1 className="aria2-settings__title">{t(groupTitleKey(routeGroup, meta?.labelKey))}</h1>
        <span className="aria2-settings__count">
          {t('format.settings.total-count', { count: keys.length })}
        </span>

        {/*
          Export lives on the page rather than in the navigation because it acts on
          the whole daemon, not on the group on screen: one click exports all ten
          groups, whichever one happens to be open.
        */}
        <MduiIconButton
          icon="save"
          label={t('Export aria2.conf')}
          className="aria2-settings__export"
          onClick={() => setExportOpen(true)}
        />
      </header>

      {/*
        aria2-next retired FTP and added the ED2K / media engines. When the
        daemon does not identify as aria2-next, every option of those groups is
        a guess, so the page says so once instead of failing row by row.
      */}
      {showAria2NextBanner ? (
        <p className="aria2-settings__banner" role="status">
          {t(
            ARIA2_NEXT_ONLY_GROUPS.includes(routeGroup)
              ? 'The connected aria2 is not aria2-next, so this group may not be supported.'
              : 'The connected aria2 is not aria2-next, so the ED2K and media option groups may not be supported.',
          )}
        </p>
      ) : null}

      <OptionGroupPanel key={routeGroup} keys={keys} />
      </div>

      <ExportAria2ConfDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the panel: load once, then save one key at a time                    */
/* ------------------------------------------------------------------ */

interface OptionGroupPanelProps {
  keys: readonly string[];
}

function OptionGroupPanel({ keys }: OptionGroupPanelProps) {
  const t = useTranslate();
  const client = useRpcStore((state) => state.client);

  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  /** Guards against a late `getGlobalOption` overwriting a newer save. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!client) {
        if (cancelled) return;
        setLoading(false);
        setLoadError(t('Cannot connect to aria2!'));
        return;
      }

      const result = await client.getGlobalOption();
      if (cancelled || !mounted.current) return;

      setLoading(false);

      if (!result.success) {
        setLoadError(result.error.message);
        return;
      }

      // Seed every key: aria2 omits options that were never set, and AriaNg
      // showed the catalogue's `defaultValue` as the placeholder in that case.
      const seeded: Record<string, string> = {};
      for (const key of keys) {
        const value = result.data[key];
        const fallback = getOptionMeta(key)?.defaultValue ?? '';
        seeded[key] = value === undefined || value === null ? fallback : String(value);
      }
      setValues(seeded);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [client, keys, t]);

  const changeGlobalOption = useCallback(
    async (key: string, value: string) => {
      if (!client) {
        setErrors((prev) => ({ ...prev, [key]: t('Cannot connect to aria2!') }));
        return;
      }

      // Optimistic: aria2 only accepts one key per call, and the row keeps its
      // own draft anyway, so this is purely so a re-render does not snap back.
      setValues((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      const result = await client.changeGlobalOption({ [key]: value } as Aria2OptionMap);
      if (!mounted.current) return;

      // AriaNg counted a save as successful only when aria2 answered `OK`.
      if (result.success && result.data === 'OK') {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }

      const message = result.success ? t('Operation Result') : result.error.message;
      setErrors((prev) => ({ ...prev, [key]: message }));
    },
    [client, t],
  );

  return (
    <div className="aria2-settings__scroll ariang-scroll-area">
      {loading ? <MduiProgressBar value={100} variant="linear" height={2} label={t('Loading')} /> : null}

      {loadError ? (
        <p className="aria2-settings__error-text" role="alert">
          {loadError}
        </p>
      ) : null}

      <OptionGroupView
        keys={keys}
        values={values}
        errors={errors}
        onChange={(key, value) => void changeGlobalOption(key, value)}
      />
    </div>
  );
}

export default Aria2SettingsPage;