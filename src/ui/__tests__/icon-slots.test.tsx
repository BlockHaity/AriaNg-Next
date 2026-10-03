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
  MduiDropdown,
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
import { ICON_TAGS, hasIcon, icon } from '../mdui/icons';
import type { IconName } from '../mdui/icons';

/** mdui attributes that resolve an icon through the Material Icons webfont. */
const FONT_ICON_ATTRS = ['icon', 'end-icon', 'active-icon', 'selected-icon', 'delete-icon'];

/**
 * Asserts that no element under `root` carries a font-based icon attribute.
 *
 * React 19 writes unknown custom-element props through as attributes, so a
 * leftover `icon={…}` on `<mdui-button>` is observable here exactly as it would
 * be in the browser.
 *
 * A `<mdui-icon name>` **child** is fine — that is the network-font fallback for
 * names outside the imported SVG set, and `index.html` loads the webfont for it.
 * It is the *attribute* that must never come back.
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

/* -------------------------------------------------------------------------- */
/* every registered name has both variants                                   */
/* -------------------------------------------------------------------------- */

describe('the SVG icon set is complete', () => {
  /**
   * `@mdui/icons` ships one file per variant, and each one self-registers, so a
   * missing import leaves the tag undefined and the element renders as nothing —
   * silently, because the tag name is still correct.
   *
   * That matters for `'outline:<name>'`, which is how the navigation rail spells
   * its active-state icon. `hasIcon()` cannot catch it: it strips the flavour and
   * reports `true` for any registered base name. Checking
   * `customElements.get()` is the only way to know the element really exists.
   */
  const names = [...ICON_TAGS].filter((tag) => !tag.endsWith('--outlined')).map((tag) => tag.slice('mdui-icon-'.length));

  it('registered a filled element for every name', () => {
    const missing = names.filter((name) => customElements.get(`mdui-icon-${name}`) === undefined);
    expect(missing, 'these names have no filled element registered').toEqual([]);
  });

  it("registered an outlined element for every name, so 'outline:<name>' resolves", () => {
    const missing = names.filter((name) => customElements.get(`mdui-icon-${name}--outlined`) === undefined);
    expect(missing, "these names have no '--outlined' element registered").toEqual([]);
  });

  it('maps every outline: name to a registered element', () => {
    for (const name of names as IconName[]) {
      const tag = icon(`outline:${name}`);
      expect(customElements.get(tag), `outline:${name} → <${tag}> is not registered`).toBeDefined();
      expect(hasIcon(`outline:${name}`)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* the dropdown trigger slot                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `mdui-dropdown` resolves its trigger with
 * `queryAssignedElements({ slot: 'trigger' })[0]` and then calls
 * `getOverflowAncestors(triggerElement)` in `connectedCallback`, which dereferences
 * `element.assignedSlot`. An empty trigger slot therefore crashes the component on
 * mount:
 *
 *     TypeError: Cannot read properties of undefined (reading 'assignedSlot')
 *
 * The wrappers take a fixed prop set (`Styleable` is `className` + `style`), so
 * cloning a trigger with `slot: 'trigger'` dropped the prop and every dropdown built
 * from `MduiButton` / `MduiIconButton` hit it. The wrapper owns the slot now, so the
 * trigger can be anything.
 */
describe('MduiDropdown puts the trigger in the trigger slot itself', () => {
  function triggerSlotHost(container: HTMLElement): Element {
    const host = container.querySelector('mdui-dropdown');
    if (!host) throw new Error('no mdui-dropdown rendered');
    return host;
  }

  it('projects a wrapped MduiIconButton trigger into the slot', () => {
    const { container } = render(
      <MduiDropdown trigger={<MduiIconButton icon="menu" label="Menu" />} items={[]} />,
    );
    const host = triggerSlotHost(container);
    const slot = host.querySelector('[slot="trigger"]')!;

    expect(slot).not.toBeNull();
    expect(slot.querySelector('mdui-button-icon')).not.toBeNull();
  });

  it('projects a wrapped MduiButton trigger into the slot', () => {
    const { container } = render(<MduiDropdown trigger={<MduiButton>Go</MduiButton>} items={[]} />);
    expect(triggerSlotHost(container).querySelector('[slot="trigger"] mdui-button')).not.toBeNull();
  });

  it('projects a raw custom element trigger into the slot', () => {
    const { container } = render(
      <MduiDropdown trigger={<mdui-button-icon icon="menu" />} items={[]} />,
    );
    expect(triggerSlotHost(container).querySelector('[slot="trigger"] mdui-button-icon')).not.toBeNull();
  });

  it('keeps the menu items outside the trigger slot', () => {
    const { container } = render(
      <MduiDropdown
        trigger={<MduiIconButton icon="menu" label="Menu" />}
        items={[<mdui-menu key="m" />]}
      />,
    );
    const slot = triggerSlotHost(container).querySelector('[slot="trigger"]')!;
    expect(slot.querySelector('mdui-menu')).toBeNull();
    expect(triggerSlotHost(container).querySelector('mdui-menu')).not.toBeNull();
  });
});
