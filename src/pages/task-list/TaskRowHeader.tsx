/**
 * The sortable header row — the `.task-table-title` block from
 * AriaNg's `views/list.html`, including its `changeDisplayOrder(type,
 * autoSetReverse)` semantics.
 *
 * ## The `autoSetReverse` rule
 *
 * `main.js`:
 *
 * ```js
 * if (autoSetReverse && newType.type === oldType.type) {
 *     newType.reverse = !oldType.reverse;
 * }
 * ```
 *
 * So clicking a header that is *not* the current sort applies that header's own
 * default direction (`name`→asc, `percent`→desc, …), and clicking the current
 * header flips whatever direction is active — including one that came from the
 * toolbar rather than from a header click.
 *
 * ## Layout
 *
 * AriaNg's header split each column group in half again (name 8/12 of A,
 * progress 6/12 of B). Those inner boundaries do not line up with anything in the
 * rows, so the header runs its **own** five-column grid with the same outer
 * proportions; `styles.css` keeps the two templates in sync at every breakpoint.
 */

import { memo } from 'react';

import { MduiIcon } from '@/ui/mdui';
import { useTranslate } from '@/i18n/react';
import type { DisplayOrderTypeName } from './dnd';
import { parseOrderType } from './dnd';

/* ------------------------------------------------------------------ */
/* the header's sort types                                             */
/* ------------------------------------------------------------------ */

/** The sortable header columns, in render order. */
export type HeaderColumnType = Exclude<DisplayOrderTypeName, 'default' | 'uspeed'>;

/**
 * The five sortable header columns and the direction each one applies on its
 * first activation — the literals in `list.html`'s `ng-click` handlers.
 */
export const HEADER_COLUMNS: ReadonlyArray<{ type: HeaderColumnType; label: string }> = [
  { type: 'name', label: 'File Name' },
  { type: 'size', label: 'File Size' },
  { type: 'percent', label: 'Progress' },
  { type: 'remain', label: 'Remaining' },
  { type: 'dspeed', label: 'Download Speed' },
];

/** The direction a header applies when it becomes the active sort. */
export const HEADER_DEFAULT_DIRECTION: Readonly<Record<string, 'asc' | 'desc'>> = {
  name: 'asc',
  size: 'asc',
  percent: 'desc',
  remain: 'asc',
  dspeed: 'desc',
};

/**
 * The order a header click produces.
 *
 * @param type         the header that was clicked
 * @param currentOrder the page's current display order
 */
export function nextOrderForHeader(type: string, currentOrder: string): string {
  const current = parseOrderType(currentOrder);

  if (current.type === type) {
    return `${type}:${current.descending ? 'asc' : 'desc'}`;
  }
  return `${type}:${HEADER_DEFAULT_DIRECTION[type] ?? 'asc'}`;
}

/** `aria-sort` for a header cell — `'none'` on the columns that are not sorted. */
export function ariaSortFor(type: string, currentOrder: string): 'ascending' | 'descending' | 'none' {
  const current = parseOrderType(currentOrder);
  if (current.type !== type) {
    return 'none';
  }
  return current.descending ? 'descending' : 'ascending';
}

/* ------------------------------------------------------------------ */
/* the header                                                          */
/* ------------------------------------------------------------------ */

export interface TaskRowHeaderProps {
  /** The page's resolved display order, e.g. `'percent:desc'`. */
  order: string;
  /** Called with the new `<type>:<dir>` value; persists it through the settings store. */
  onChangeOrder: (order: string) => void;
}

export const TaskRowHeader = memo(function TaskRowHeader({ order, onChangeOrder }: TaskRowHeaderProps) {
  const t = useTranslate();
  const current = parseOrderType(order);

  return (
    <div role="row" className="task-table-title">
      {HEADER_COLUMNS.map((column) => {
        const active = current.type === column.type;

        return (
          <div
            key={column.type}
            role="columnheader"
            className={
              active
                ? 'task-header-cell task-header-cell--active'
                : 'task-header-cell'
            }
            aria-sort={ariaSortFor(column.type, order)}
          >
            <button
              type="button"
              className="task-header-button"
              onClick={() => onChangeOrder(nextOrderForHeader(column.type, order))}
            >
              <span className="task-header-label">{t(column.label)}</span>
              <MduiIcon
                name={active ? (current.descending ? 'keyboard-arrow-down' : 'keyboard-arrow-up') : 'swap-vert'}
                size="1rem"
                className="task-header-icon"
              />
            </button>
          </div>
        );
      })}

      {/* Keeps the header grid one column wider than its last sortable column,
          matching the trailing chevron cell every row carries. */}
      <div role="columnheader" className="task-header-cell task-header-cell--trailing" />
    </div>
  );
});

export default TaskRowHeader;