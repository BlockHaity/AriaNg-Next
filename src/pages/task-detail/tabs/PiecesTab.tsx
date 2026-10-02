/**
 * Pieces tab — the legend plus the piece bitmap.
 *
 * Port of `views/task-detail.html` lines 169-179:
 *
 * ```html
 * <div class="piece-legends">
 *   <div class="piece-legend" title="{{('format.task.pieceinfo' | translate: {...})}}">
 *     <div class="piece piece-completed"></div><span translate>Completed</span>
 *   </div>
 *   <div class="piece-legend" title="…same tooltip…">
 *     <div class="piece"></div><span translate>Uncompleted</span>
 *   </div>
 * </div>
 * <ng-piece-map bit-field="task.bitfield" piece-count="task.numPieces"></ng-piece-map>
 * ```
 *
 * Note AriaNg put the **same** `Completed: x, Total: y` tooltip on *both* legend
 * entries, which is reproduced here: the counts describe the whole map, not one
 * of the two swatches.
 */

import type { NormalizedTask } from '@/domain/types';
import { useTranslate } from '@/i18n/react';
import { PieceMap } from '../PieceMap';

export interface PiecesTabProps {
  task: NormalizedTask;
}

export function PiecesTab({ task }: PiecesTabProps) {
  const t = useTranslate();
  const info = t('format.task.pieceinfo', { completed: task.completedPieces, total: task.numPieces });

  return (
    <div className="ariang-task-detail">
      <div className="ariang-piece-legend">
        <span className="ariang-piece-legend-item" title={info}>
          <span className="ariang-piece ariang-piece-completed" aria-hidden="true" />
          <span>{t('Completed')}</span>
        </span>
        <span className="ariang-piece-legend-item" title={info}>
          <span className="ariang-piece" aria-hidden="true" />
          <span>{t('Uncompleted')}</span>
        </span>
      </div>

      <PieceMap bitfield={task.bitfield} pieceCount={task.numPieces} label={info} />
    </div>
  );
}

export default PiecesTab;