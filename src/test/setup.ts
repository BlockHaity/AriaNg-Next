import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Tests for the build-time guard scripts run in the `node` environment (they
 * touch the filesystem, not the DOM), so everything below has to be a no-op
 * when there is no `window`.
 */
const hasDom = typeof window !== 'undefined';

afterEach(() => {
  if (hasDom) cleanup();
});

if (hasDom) {
  // jsdom does not implement these; mdui + chart code touch them.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }

  /**
   * jsdom implements no Web Animations API. mdui's overlay components
   * (`mdui-dialog`, `mdui-snackbar`, `mdui-dropdown`, `mdui-menu`) call
   * `element.getAnimations()` to coordinate their enter/exit transitions, so
   * without this every dialog and menu render throws in tests — which is an
   * environment gap, not a wrapper bug.
   */
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = function getAnimations() {
      return [];
    } as unknown as typeof Element.prototype.getAnimations;
  }

  if (typeof document !== 'undefined' && !document.getAnimations) {
    document.getAnimations = (() => []) as unknown as typeof document.getAnimations;
  }
}
