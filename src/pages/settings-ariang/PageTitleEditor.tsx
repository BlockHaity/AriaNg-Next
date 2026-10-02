/**
 * The **Page Title** row of the Global settings tab: a text field, a live
 * preview and the popover that documents the `${…}` placeholder syntax.
 *
 * AriaNg rendered the preview through
 * `ariaNgTitleService.getFinalTitleByGlobalStat({ globalStat, currentRpcProfile })`,
 * which is `getFinalTitle` + the monitor's last global stat. Both halves live
 * elsewhere here (`@/store/title`, `@/store/rpc-store`), so this component only
 * wires them together and renders the result.
 */

import { useMemo } from 'react';
import type { RpcProfile } from '@/config/types';
import { useTranslate } from '@/i18n/react';
import { readableVolume } from '@/i18n/format';
import type { TranslateFn } from '@/i18n/types';
import { getFinalTitle } from '@/store/title';
import type { GlobalStatLike, TitleFormatter } from '@/store/title';
import { useRpcStore } from '@/store/rpc-store';
import { MduiIconButton, MduiTextField, MduiTooltip } from '@/ui/mdui';

import './styles.css';

/** Prefix keys of the two placeholders that carry a byte value. */
const SPEED_LABEL_KEYS: readonly string[] = ['Download', 'Upload'];

/**
 * One formatter for every visible fragment of the template.
 *
 * `getFinalTitle` hands both the translated label (`'Downloading'`, `'Download'`,
 * …) and the raw value (`'3'`, `'1048576'`) to the same callback. AriaNg ran
 * only the two speeds through `readableVolume` and left the three counters raw,
 * so the label that was formatted immediately before a numeric fragment is
 * what tells the two apart — and `compose()` always renders the label first,
 * which makes this deterministic.
 */
export function createTitleFormatter(t: TranslateFn): TitleFormatter {
  let lastLabel = '';

  return (value: string): string => {
    if (value === '') return '';

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return SPEED_LABEL_KEYS.includes(lastLabel) ? readableVolume(numeric) : value;
    }

    lastLabel = value;
    return t(value);
  };
}

/** aria2 reports every global-stat field as a string. */
function toGlobalStatLike(raw: Record<string, unknown> | undefined): GlobalStatLike | undefined {
  if (!raw) return undefined;

  const num = (key: string): number => {
    const value = Number(raw[key]);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    downloadSpeed: num('downloadSpeed'),
    uploadSpeed: num('uploadSpeed'),
    numActive: num('numActive'),
    numWaiting: num('numWaiting'),
    numStopped: num('numStopped'),
  };
}

export interface PageTitleEditorProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * `${rpcprofile}` source.
   *
   * AriaNg previewed with the **default** profile (`getCurrentRPCProfile`
   * returned the entry flagged `isDefault`), because the title applies to the
   * app rather than to whichever profile happens to be selected.
   */
  profile: RpcProfile | null;
  className?: string;
}

export function PageTitleEditor({ value, onChange, profile, className }: PageTitleEditorProps) {
  const t = useTranslate();
  const globalStat = useRpcStore((state) => state.globalStat);

  const preview = useMemo(() => {
    const stat = toGlobalStatLike(globalStat as unknown as Record<string, unknown> | undefined);
    return getFinalTitle(
      value,
      { globalStat: stat, currentRpcProfile: profile ?? undefined },
      createTitleFormatter(t),
    );
  }, [value, globalStat, profile, t]);

  return (
    <div className={className ?? 'title-editor'}>
      <div className="title-editor-row">
        <MduiTextField
          value={value}
          label={t('Page Title')}
          variant="outlined"
          placeholder="${title}"
          onInput={onChange}
          clearable
        />
        <MduiTooltip
          variant="rich"
          placement="right"
          trigger="hover"
          headline={t('Supported Placeholder')}
          content={<PlaceholderHelp />}
        >
          <MduiIconButton icon="info" variant="standard" label={t('Supported Placeholder')} />
        </MduiTooltip>
      </div>
      <p className="settings-preview">
        <em>[{t('Preview')}]</em> <span data-testid="title-preview">{preview}</span>
      </p>
    </div>
  );
}

/**
 * The placeholder table.
 *
 * Rendered as elements rather than an HTML string: the i18n layer returns plain
 * text by contract (AriaNg fed translations through `ng-bind-html`, which was
 * an XSS footgun), so line breaks have to be built here.
 */
function PlaceholderHelp() {
  const t = useTranslate();
  const rows: readonly [string, string][] = [
    ['AriaNg Title', '${title}'],
    ['Current RPC Alias', '${rpcprofile}'],
    ['Downloading Count', '${downloading}'],
    ['Waiting Count', '${waiting}'],
    ['Stopped Count', '${stopped}'],
    ['Download Speed', '${downspeed}'],
    ['Upload Speed', '${upspeed}'],
  ];

  return (
    <>
      {rows.map(([label, placeholder]) => (
        <div key={placeholder} className="placeholder-row">
          <span>{t(label)}</span>
          <code>{placeholder}</code>
        </div>
      ))}
      <p>{t('Tips: You can use the "noprefix" tag to ignore the prefix, "nosuffix" tag to ignore the suffix, and "scale=n" tag to set the decimal precision.')}</p>
      <code>{t('Example: ${downspeed:noprefix:nosuffix:scale=1}')}</code>
    </>
  );
}

export default PageTitleEditor;