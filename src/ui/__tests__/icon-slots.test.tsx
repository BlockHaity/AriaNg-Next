/**
 * Regression tests for icon rendering.
 *
 * mdui's `icon` / `end-icon` / `active-icon` / `selected-icon` / `delete-icon`
 * **attributes** are font-only: the component renders `<mdui-icon name="...">`,
 * which resolves through the Material Icons webfont ligature. This app never
 * loads that webfont — it uses the inline-SVG elements from `@mdui/icons` — so
 * passing those attributes made every icon render as the literal words
 * "play-arrow", "delete", "download" (reported as "所有图标全部爆炸，全是文字").
 *
 * Every affected component also exposes a **slot** for the icon, and prefers
 * slotted content over the attribute. These tests pin that down: the wrapper must
 * project an SVG element into the right slot and must never set the attribute.
 *
 * jsdom does not run the Lit lifecycle, so nothing is projected into the shadow
 * DOM here — the tests assert the light DOM the wrapper produced, which is
 * exactly the part that was wrong.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  MduiButton,
  MduiChip,
  MduiFab,
  MduiIconButton,
  MduiListItem,
  MduiMenu,
  MduiMenuItem,
  MduiNavigationBarItem,
  MduiNavigationRailItem,
  MduiSegmentedButton,
  MduiSelect,
  MduiTab,
  MduiTabs,
  MduiTextarea,
  MduiTextField,
} from '../mdui';
import { hasIcon } from '../mdui/icons';

/** mdui attributes that resolve an icon through the Material Icons webfont. */
const FONT_ICON_ATTRS = ['icon', 'end-icon', 'active-icon', 'selected-icon', 'delete-icon'];

/**
 * Asserts that no element under `root` carries a font-based icon attribute.
 *
 * React 19 writes unknown custom-element props through as attributes, so a
 * leftover `icon={…}` on `<mdui-button>` is observable here exactly as it would
 * be in the browser.
 */
function expectNoFontIconAttrs(root: HTMLElement): void {
  for (const el of root.querySelectorAll('*')) {
    for (const attr of FONT_ICON_ATTRS) {
      expect(
        el.hasAttribute(attr),
        `<${el.tagName.toLowerCase()}> must not set the font-based "${attr}" ` +
          `attribute; project an <mdui-icon-*> element into a slot instead`,
      ).toBe(false);
    }
  }
}

/** The slotted icon child for the given slot name. */
function slotted(root: ParentNode, slot: string): Element | null {
  return root.querySelector(`[slot="${slot}"]`);
}

function expectSlot(root: ParentNode, slot: string, tag: string): void {
  expect(
    slotted(root, slot)?.tagName.toLowerCase(),
    `expected <${tag}> in slot "${slot}"`,
  ).toBe(tag);
}

describe('icons are projected into slots, never set as font attributes', () => {
  it('MduiButton puts icon and endIcon into their slots', () => {
    const { container } = render(<MduiButton icon="download" endIcon="open-in-new" />);
    const host = container.querySelector('mdui-button')!;
    expectSlot(host, 'icon', 'mdui-icon-download');
    expectSlot(host, 'end-icon', 'mdui-icon-open-in-new');
    expectNoFontIconAttrs(container);
  });

  it('MduiIconButton uses the default slot, which is the icon position', () => {
    const { container } = render(<MduiIconButton icon="play-arrow" label="Start" />);
    const host = container.querySelector('mdui-button-icon')!;
    // No `slot` attribute: `mdui-button-icon` has no icon slot, and a filled
    // default slot is what makes it skip the `<mdui-icon name>` fallback.
    const child = host.querySelector('mdui-icon-play-arrow')!;
    expect(child).not.toBeNull();
    expect(child.hasAttribute('slot')).toBe(false);
    expectNoFontIconAttrs(container);
  });

  it('MduiIconButton puts selectedIcon into the selected-icon slot', () => {
    const { container } = render(
      <MduiIconButton icon="folder-open" selectedIcon="folder" label="Toggle" toggle selected />,
    );
    expectSlot(container.querySelector('mdui-button-icon')!, 'selected-icon', 'mdui-icon-folder');
    expectNoFontIconAttrs(container);
  });

  it('MduiFab puts icon into the icon slot', () => {
    const { container } = render(<MduiFab icon="add" label="New" />);
    expectSlot(container.querySelector('mdui-fab')!, 'icon', 'mdui-icon-add');
    expectNoFontIconAttrs(container);
  });

  it('MduiListItem puts startIcon and endIcon into their slots', () => {
    const { container } = render(<MduiListItem startIcon="folder" endIcon="chevron-right" />);
    const host = container.querySelector('mdui-list-item')!;
    expectSlot(host, 'icon', 'mdui-icon-folder');
    expectSlot(host, 'end-icon', 'mdui-icon-chevron-right');
    expectNoFontIconAttrs(container);
  });

  it('MduiTextField puts icon and endIcon into their slots', () => {
    const { container } = render(<MduiTextField value="" icon="search" endIcon="close" />);
    const host = container.querySelector('mdui-text-field')!;
    expectSlot(host, 'icon', 'mdui-icon-search');
    expectSlot(host, 'end-icon', 'mdui-icon-close');
    expectNoFontIconAttrs(container);
  });

  it('MduiTextarea renders a text field, not the non-existent mdui-textarea', () => {
    // mdui 2.1.5 ships no <mdui-textarea>; `rows > 1` is what makes
    // <mdui-text-field> render a real <textarea>. The old wrapper emitted
    // <mdui-textarea>, i.e. an unknown element, so every multi-line input in the
    // app (new-task links, RPC headers, option values) was invisible.
    const { container } = render(<MduiTextarea value="" label="Links" rows={4} />);
    expect(container.querySelector('mdui-textarea')).toBeNull();
    const host = container.querySelector('mdui-text-field') as unknown as {
      rows?: number;
      getAttribute(name: string): string | null;
    };
    expect(host).not.toBeNull();
    // React 19 prefers the element's own `rows` property over the attribute.
    expect(host.rows ?? Number(host.getAttribute('rows'))).toBe(4);
  });

  it('MduiChip puts icon, selected-icon and delete-icon into their slots', () => {
    const { container } = render(
      <MduiChip icon="filter-list" deleteIcon="close" selectable removable>
        tag
      </MduiChip>,
    );
    const host = container.querySelector('mdui-chip')!;
    expectSlot(host, 'icon', 'mdui-icon-filter-list');
    expectSlot(host, 'selected-icon', 'mdui-icon-filter-list');
    expectSlot(host, 'delete-icon', 'mdui-icon-close');
    expectNoFontIconAttrs(container);
  });

  it('MduiTab puts icon into the icon slot', () => {
    const { container } = render(
      <MduiTabs activeTab="a">
        <MduiTab value="a" icon="cloud-download" label="Get" />
      </MduiTabs>,
    );
    expectSlot(container.querySelector('mdui-tab')!, 'icon', 'mdui-icon-cloud-download');
    expectNoFontIconAttrs(container);
  });

  it('MduiMenuItem puts icon and endIcon into their slots', () => {
    const { container } = render(
      <MduiMenu>
        <MduiMenuItem value="a" icon="content-copy" endIcon="chevron-right">
          Copy
        </MduiMenuItem>
      </MduiMenu>,
    );
    const host = container.querySelector('mdui-menu-item')!;
    expectSlot(host, 'icon', 'mdui-icon-content-copy');
    expectSlot(host, 'end-icon', 'mdui-icon-chevron-right');
    expectNoFontIconAttrs(container);
  });

  it('MduiSelect puts each item icon into the item icon slot', () => {
    const { container } = render(
      <MduiSelect value="a" items={[{ value: 'a', label: 'A', icon: 'hub' }]} />,
    );
    expectSlot(container.querySelector('mdui-menu-item')!, 'icon', 'mdui-icon-hub');
    expectNoFontIconAttrs(container);
  });

  it('MduiSegmentedButton puts each item icon into the item icon slot', () => {
    const { container } = render(
      <MduiSegmentedButton value="a" items={[{ value: 'a', label: 'A', icon: 'table-chart' }]} />,
    );
    expectSlot(container.querySelector('mdui-segmented-button')!, 'icon', 'mdui-icon-table-chart');
    expectNoFontIconAttrs(container);
  });

  it('MduiNavigationRailItem puts icon and activeIcon into their slots', () => {
    const { container } = render(
      <MduiNavigationRailItem value="a" icon="folder-open" activeIcon="folder" label="Tasks" />,
    );
    const host = container.querySelector('mdui-navigation-rail-item')!;
    expectSlot(host, 'icon', 'mdui-icon-folder-open');
    expectSlot(host, 'active-icon', 'mdui-icon-folder');
    expectNoFontIconAttrs(container);
  });

  it('MduiNavigationBarItem puts icon and activeIcon into their slots', () => {
    const { container } = render(
      <MduiNavigationBarItem value="a" icon="folder-open" activeIcon="folder" label="Tasks" />,
    );
    const host = container.querySelector('mdui-navigation-bar-item')!;
    expectSlot(host, 'icon', 'mdui-icon-folder-open');
    expectSlot(host, 'active-icon', 'mdui-icon-folder');
    expectNoFontIconAttrs(container);
  });

  it('every icon name used in these tests is registered in the SVG set', () => {
    // A name missing from ICON_NAMES makes slotIcon() return null, which leaves a
    // blank button — the other half of the same bug.
    for (const name of [
      'add',
      'chevron-right',
      'cloud-download',
      'close',
      'content-copy',
      'download',
      'filter-list',
      'folder',
      'folder-open',
      'hub',
      'open-in-new',
      'play-arrow',
      'search',
      'table-chart',
    ]) {
      expect(hasIcon(name), `icon "${name}" is not registered`).toBe(true);
    }
  });
});