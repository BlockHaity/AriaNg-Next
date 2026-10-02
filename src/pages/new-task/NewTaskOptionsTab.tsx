/**
 * The second tab of the new-task page — `views/new.html`'s options pane.
 *
 * Renders `getTaskOptionKeys('new', false)` through {@link OptionRow}, one row
 * per rule, with the same attributes AriaNg passed to `<ng-setting>`:
 *
 * ```html
 * <ng-setting ng-repeat="option in context.availableOptions"
 *             ng-if="context.optionFilter[option.category]"
 *             option="option" show-placeholder-count="true"
 *             lazy-save-timeout="0" delete-key-always-change-value="true"
 *             default-value="…context.globalOptions[option.key]…"
 *             fixed-value="…append ? context.globalOptions[option.key] : ''"
 *             on-change-value="setOption(key, value, optionStatus)"/>
 * ```
 *
 * `default-value` is the *placeholder* here (nothing is submitted until the user
 * edits a row) and `fixed-value` is the append-mode prefix, both fed from the
 * global options the page fetched lazily when the tab was opened.
 *
 * `getTaskOptionKeys('new', false)` is called with `isBittorrent: false` on
 * purpose: AriaNg listed **both** the HTTP and the BitTorrent rows on the
 * new-task page (`getNewTaskOptionKeys` never filtered by protocol), and it is
 * the user who decides with the filters which of them applies.
 */

import { useMemo } from 'react';

import { getOptionMeta } from '@/config/aria2-options';
import { getTaskOptionKeys } from '@/config/option-groups';
import type { ResolvedTaskOptionRule } from '@/config/option-groups';
import { useTranslate } from '@/i18n/react';
import { OptionRow } from '@/components/option-row';
import { MduiBanner } from '@/ui/mdui';
import { OptionFilters } from './OptionFilters';
import type { OptionFilterState } from './OptionFilters';
import type { NewTaskKind } from './validation';

/** The aria2-next options the media explainer talks about, in render order. */
const MEDIA_EXPLAIN_KEYS = ['media-audio', 'media-video', 'media-pause-after-probe'] as const;

/** The row list is stable for the lifetime of the page. */
const NEW_TASK_RULES: ResolvedTaskOptionRule[] = getTaskOptionKeys('new', false);

export interface NewTaskOptionsTabProps {
  kind: NewTaskKind;
  filters: OptionFilterState;
  onFiltersChange: (next: OptionFilterState) => void;
  /** The unsaved option bag of the draft task. */
  options: Record<string, string>;
  /** `aria2.getGlobalOption()`, loaded lazily when the tab is first opened. */
  globalOptions: Record<string, string> | null;
  onOptionChange: (key: string, value: string) => void;
}

/**
 * The aria2-next media note.
 *
 * Track ids only exist once aria2 has probed the manifest, so the row cannot
 * offer them as a dropdown — hence the `string-or-option` control and this
 * reminder. The text is the catalogue's own `aria2NextNote`, which is the same
 * source the option tooltips read.
 */
function mediaExplainText(): string[] {
  return MEDIA_EXPLAIN_KEYS.map((key) => getOptionMeta(key)?.aria2NextNote).filter(
    (note): note is string => Boolean(note),
  );
}

export function NewTaskOptionsTab(props: NewTaskOptionsTabProps) {
  const { kind, filters, onFiltersChange, options, globalOptions, onOptionChange } = props;
  const t = useTranslate();

  /**
   * A media task always shows the `media` bucket: the track-selection rows are
   * the whole reason to pick an HLS/DASH manifest, and the explainer above them
   * only makes sense when they are visible.
   */
  const activeFilters = useMemo<OptionFilterState>(
    () => (kind === 'media' ? { ...filters, media: true } : filters),
    [kind, filters],
  );

  const rules = useMemo(() => NEW_TASK_RULES.filter((rule) => activeFilters[rule.category]), [activeFilters]);
  const mediaNotes = useMemo(() => (kind === 'media' ? mediaExplainText() : []), [kind]);

  return (
    <div className="new-task-options">
      {mediaNotes.length > 0 ? (
        <MduiBanner
          className="new-task-options__media-note"
          icon="info"
          open
          message={
            <ul className="new-task-options__media-list">
              {mediaNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <OptionFilters value={activeFilters} onChange={onFiltersChange} showMedia={kind === 'media'} />

      <div className="new-task-options__list" data-testid="new-task-option-rows">
        {rules.map((rule) => (
          <OptionRow
            key={rule.key}
            optionKey={rule.key}
            value={options[rule.key]}
            globalValue={globalOptions ? globalOptions[rule.key] : undefined}
            showHistory={rule.showHistory}
            readOnly={rule.readonly}
            lazySaveTimeout={0}
            disableRequired
            onChange={(value, key) => onOptionChange(key, value)}
          />
        ))}
      </div>

      {rules.length === 0 ? <p className="new-task-options__empty">{t('No Data')}</p> : null}
    </div>
  );
}