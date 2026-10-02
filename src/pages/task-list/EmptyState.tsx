/**
 * The three "there is nothing here" states.
 *
 * AriaNg had none of them — `list.html` rendered an empty `.task-table-body`,
 * which on a stopped page looked indistinguishable from a page that had not
 * finished loading. MD3 wants an explicit empty state, and the three cases are
 * genuinely different to the user:
 *
 * | variant      | meaning                                    |
 * |--------------|--------------------------------------------|
 * | `empty`      | the list is genuinely empty                |
 * | `search`     | a filter hid everything                    |
 * | `disconnected` | the last refresh could not reach aria2   |
 *
 * Every string goes through `useTranslate`; the fallback chain
 * (`locale → en → key`) means a key that is not in the table yet renders as its
 * own English text rather than disappearing.
 */

import { MduiIcon } from '@/ui/mdui';
import { useTranslate } from '@/i18n/react';

export type EmptyStateVariant = 'empty' | 'search' | 'disconnected';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** The active search text, echoed back in the `search` variant. */
  searchText?: string;
  /** `Downloading` / `Waiting` / `Finished / Stopped` — names the list. */
  pageLabel?: string;
}

export function EmptyState({ variant, searchText, pageLabel }: EmptyStateProps) {
  const t = useTranslate();

  const copy: Record<EmptyStateVariant, { icon: string; title: string; description: string }> = {
    empty: {
      icon: 'info',
      title: t('No Data'),
      description: pageLabel ?? '',
    },
    search: {
      icon: 'search',
      title: t('No Data'),
      description: `${t('Search')}: ${(searchText ?? '').trim()}`,
    },
    disconnected: {
      icon: 'error',
      title: t('Cannot connect to aria2!'),
      description: t('Disconnected'),
    },
  };

  const { icon, title, description } = copy[variant];

  return (
    <mdui-card className="task-empty-state" variant="filled" data-testid="task-empty-state" data-variant={variant}>
      <MduiIcon name={icon} size="3rem" />
      <p className="task-empty-title">{title}</p>
      {description ? <p className="task-empty-description">{description}</p> : null}
    </mdui-card>
  );
}

export default EmptyState;