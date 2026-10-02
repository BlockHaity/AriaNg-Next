/**
 * The inline filter chips above the option list — AriaNg's
 * `settings-table-title.new-task-filter-title` row (`Global` / `Http` /
 * `BitTorrent` checkboxes, all on the same line as the `Filters:` caption).
 *
 * The chip set drives exactly one thing: which
 * {@link ResolvedTaskOptionRule.category} buckets are rendered. AriaNg defaults
 * to `global` only, because a fresh task normally needs nothing else.
 */

import { useTranslate } from '@/i18n/react';
import { MduiChip } from '@/ui/mdui';
import type { TaskOptionRule } from '@/config/types';

/** The four buckets {@link getTaskOptionKeys} can assign. */
export type OptionFilterCategory = TaskOptionRule['category'];

export type OptionFilterState = Record<OptionFilterCategory, boolean>;

/** AriaNg's `context.optionFilter` initial value. */
export const DEFAULT_OPTION_FILTERS: OptionFilterState = {
  global: true,
  http: false,
  bittorrent: false,
  media: false,
};

/** Chip order and labels; `media` is aria2-next and only offered for manifests. */
export const OPTION_FILTER_CATEGORIES: readonly OptionFilterCategory[] = ['global', 'http', 'bittorrent', 'media'];

const CATEGORY_LABEL_KEYS: Record<OptionFilterCategory, string> = {
  global: 'Global',
  http: 'Http',
  bittorrent: 'BitTorrent',
  media: 'Media',
};

export interface OptionFiltersProps {
  value: OptionFilterState;
  onChange: (next: OptionFilterState) => void;
  /** Adds the aria2-next `Media` chip (HLS/DASH tasks). */
  showMedia?: boolean;
}

export function OptionFilters({ value, onChange, showMedia }: OptionFiltersProps) {
  const t = useTranslate();

  return (
    <div className="option-filters" role="group" aria-label={t('Filters')}>
      <span className="option-filters__caption">{t('Filters')}:</span>

      {OPTION_FILTER_CATEGORIES.filter((category) => showMedia || category !== 'media').map((category) => (
        <MduiChip
          key={category}
          variant="filter"
          selectable
          selected={Boolean(value[category])}
          onChange={(selected) => onChange({ ...value, [category]: selected })}
        >
          {t(CATEGORY_LABEL_KEYS[category])}
        </MduiChip>
      ))}
    </div>
  );
}