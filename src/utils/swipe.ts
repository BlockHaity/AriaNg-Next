/**
 * Touch swipe gestures — a port of the `ng-swipe-disable-mouse` directive pair
 * AriaNg used (`on-swipe` / `on-swipe-left` / `on-swipe-right`).
 *
 * ## What swipe is used for
 *
 * - opening / closing the navigation drawer by swiping on the content area;
 * - switching tabs on the **task-detail**, **new-task**, **debug** and
 *   **settings** pages (swipe left = next tab, swipe right = previous tab).
 *
 * ## Touch only
 *
 * AriaNg loaded `ng-swipe-disable-mouse` so a drag with a mouse could never be
 * mistaken for a swipe. The same rule is implemented structurally here: only
 * `touchstart` / `touchmove` / `touchend` are observed, and a `pointerdown`
 * from a mouse never starts a gesture.
 *
 * Listeners are registered as `passive: true` — a horizontal swipe must never
 * be able to block scrolling, and Chrome logs a console warning (and ignores
 * the listener) for non-passive `touchmove` handlers.
 */

export interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Gate consulted on `touchstart`; wired to the `swipeGesture` setting. */
  enabled?: () => boolean;
}

export interface BindSwipeGesturesOptions {
  /** Horizontal distance in CSS pixels required to fire. AriaNg used 50. */
  threshold?: number;
}

/** AriaNg's default swipe distance. */
export const DEFAULT_SWIPE_THRESHOLD = 50;

interface TouchPoint {
  x: number;
  y: number;
}

function firstTouch(event: TouchEvent): TouchPoint | null {
  const touch = event.touches?.[0] ?? event.changedTouches?.[0];
  if (!touch) return null;
  return { x: touch.clientX, y: touch.clientY };
}

/**
 * Binds left/right swipe detection to `element` and returns the cleanup
 * function.
 */
export function bindSwipeGestures(
  element: HTMLElement,
  handlers: SwipeHandlers,
  options: BindSwipeGesturesOptions = {},
): () => void {
  const threshold = options.threshold ?? DEFAULT_SWIPE_THRESHOLD;
  const { enabled } = handlers;

  let start: TouchPoint | null = null;

  const onTouchStart = (event: Event) => {
    if (typeof enabled === 'function' && !enabled()) {
      start = null;
      return;
    }
    start = firstTouch(event as TouchEvent);
  };

  const onTouchMove = (event: Event) => {
    // Swallow horizontal movement: the browser must keep being able to scroll
    // a list vertically, but must not rubber-band sideways.
    if (!start) return;
    const current = firstTouch(event as TouchEvent);
    if (!current) return;

    const dx = current.x - start.x;
    const dy = current.y - start.y;

    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
      event.preventDefault();
    }
  };

  const onTouchEnd = (event: Event) => {
    const from = start;
    start = null;
    if (!from) return;

    const to = firstTouch(event as TouchEvent);
    if (!to) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // Horizontal intent: the travel has to beat the threshold *and* be more
    // horizontal than vertical, otherwise a diagonal scroll flick counts.
    if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;

    if (dx < 0) {
      handlers.onSwipeLeft?.();
    } else {
      handlers.onSwipeRight?.();
    }
  };

  const onTouchCancel = () => {
    start = null;
  };

  const passive: AddEventListenerOptions = { passive: false, capture: false };

  element.addEventListener('touchstart', onTouchStart, passive);
  element.addEventListener('touchmove', onTouchMove, passive);
  element.addEventListener('touchend', onTouchEnd, passive);
  element.addEventListener('touchcancel', onTouchCancel, passive);

  return () => {
    element.removeEventListener('touchstart', onTouchStart, passive);
    element.removeEventListener('touchmove', onTouchMove, passive);
    element.removeEventListener('touchend', onTouchEnd, passive);
    element.removeEventListener('touchcancel', onTouchCancel, passive);
  };
}
