/**
 * mdui component registry.
 *
 * mdui ships every component as its own ES module that self-registers a custom
 * element on import. Importing the full `mdui` bundle would pull in the whole
 * component library, so we cherry-pick only the tags this application renders.
 * Each `mdui/components/<name>.js` module is side-effectful by design (it calls
 * `customElements.define`), which is exactly what we want here.
 *
 * `index.html` already hides unregistered elements with `:not(:defined)`, so as
 * long as `registerMduiComponents()` is awaited before the app paints there is
 * no unstyled flash.
 */

// Global design tokens / theme definitions (colours, typescale, motion, shape).
// Must be imported exactly once, before anything renders.
import 'mdui/mdui.css';

import 'mdui/components/avatar.js';
import 'mdui/components/badge.js';
import 'mdui/components/bottom-app-bar.js';
import 'mdui/components/button-icon.js';
import 'mdui/components/button.js';
import 'mdui/components/card.js';
import 'mdui/components/checkbox.js';
import 'mdui/components/chip.js';
import 'mdui/components/circular-progress.js';
import 'mdui/components/collapse-item.js';
import 'mdui/components/collapse.js';
import 'mdui/components/dialog.js';
import 'mdui/components/divider.js';
import 'mdui/components/dropdown.js';
import 'mdui/components/fab.js';
import 'mdui/components/icon.js';
import 'mdui/components/layout-item.js';
import 'mdui/components/layout-main.js';
import 'mdui/components/layout.js';
import 'mdui/components/linear-progress.js';
import 'mdui/components/list-item.js';
import 'mdui/components/list-subheader.js';
import 'mdui/components/list.js';
import 'mdui/components/menu-item.js';
import 'mdui/components/menu.js';
import 'mdui/components/navigation-bar-item.js';
import 'mdui/components/navigation-bar.js';
import 'mdui/components/navigation-drawer.js';
import 'mdui/components/navigation-rail-item.js';
import 'mdui/components/navigation-rail.js';
import 'mdui/components/radio-group.js';
import 'mdui/components/radio.js';
import 'mdui/components/range-slider.js';
import 'mdui/components/ripple.js';
import 'mdui/components/segmented-button-group.js';
import 'mdui/components/segmented-button.js';
import 'mdui/components/select.js';
import 'mdui/components/slider.js';
import 'mdui/components/snackbar.js';
import 'mdui/components/switch.js';
import 'mdui/components/tab-panel.js';
import 'mdui/components/tab.js';
import 'mdui/components/tabs.js';
import 'mdui/components/text-field.js';
import 'mdui/components/tooltip.js';
import 'mdui/components/top-app-bar-title.js';
import 'mdui/components/top-app-bar.js';

/**
 * Every custom element this app relies on.
 *
 * NOTE: these names were verified against `node_modules/mdui/components/*.js`.
 * mdui 2.x **removed** a number of the v1 elements this list used to contain;
 * they simply do not exist in 2.1.5 and are therefore not imported:
 *
 * - `mdui-card-media` / `-header` / `-content` / `-actions` → plain children of `<mdui-card>`
 * - `mdui-dialog-title` / `-content` / `-actions` / `-top-actions` / `-bottom-actions`
 *   → `slot="headline"` / default slot / `slot="action"`
 * - `mdui-snackbar-action` → the `action` property / `slot="action"`
 * - `mdui-banner`, `mdui-full-screen-dialog` → dropped in 2.x (`<mdui-dialog fullscreen>`)
 * - `mdui-navigation-drawer-close` → dropped in 2.x
 * - `mdui-list-group`, `mdui-chip-set`, `mdui-checkbox-group`, `mdui-select-option`,
 *   `mdui-textarea` → 2.x uses `<mdui-list>`, `<mdui-chip>`,
 *   `<mdui-radio-group>` / `<mdui-checkbox>` (no group wrapper),
 *   `<mdui-menu-item>` inside `<mdui-select>`, and `<mdui-text-field rows>`.
 */
export const MDUI_COMPONENTS: readonly string[] = [
  // Layout scaffolding
  'mdui-layout',
  'mdui-layout-item',
  'mdui-layout-main',
  'mdui-top-app-bar',
  'mdui-top-app-bar-title',
  'mdui-bottom-app-bar',
  'mdui-navigation-drawer',
  'mdui-navigation-rail',
  'mdui-navigation-rail-item',
  'mdui-navigation-bar',
  'mdui-navigation-bar-item',

  // Actions & surfaces
  'mdui-button',
  'mdui-button-icon',
  'mdui-fab',
  'mdui-card',
  'mdui-chip',
  'mdui-divider',
  'mdui-ripple',
  'mdui-icon',

  // Lists & navigation
  'mdui-list',
  'mdui-list-item',
  'mdui-list-subheader',
  'mdui-menu',
  'mdui-menu-item',
  'mdui-dropdown',

  // Tabular / disclosure
  'mdui-tabs',
  'mdui-tab',
  'mdui-tab-panel',
  'mdui-segmented-button',
  'mdui-segmented-button-group',
  'mdui-collapse',
  'mdui-collapse-item',

  // Form controls
  'mdui-checkbox',
  'mdui-radio',
  'mdui-radio-group',
  'mdui-switch',
  'mdui-slider',
  'mdui-range-slider',
  'mdui-select',
  'mdui-text-field',

  // Feedback & overlays
  'mdui-avatar',
  'mdui-badge',
  'mdui-circular-progress',
  'mdui-linear-progress',
  'mdui-dialog',
  'mdui-snackbar',
  'mdui-tooltip',
] as const;

/**
 * `true` when the tag has already been registered.
 *
 * Safe to call in a non-browser environment (returns `false`).
 */
export function hasMduiComponent(tag: string): boolean {
  return typeof customElements !== 'undefined' && customElements.get(tag) !== undefined;
}

/**
 * Resolves once every tag in {@link MDUI_COMPONENTS} has been defined.
 *
 * `Promise.allSettled` (as recommended by the mdui FAQ) is used on purpose: a
 * single unavailable component must never be able to block the whole app from
 * becoming visible, because `index.html` keeps the body hidden until this
 * promise settles.
 */
export async function registerMduiComponents(): Promise<void> {
  if (typeof customElements === 'undefined') return;

  await Promise.allSettled(MDUI_COMPONENTS.map((tag) => customElements.whenDefined(tag)));
}