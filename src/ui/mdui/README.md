# `@/ui/mdui` — the mdui foundation layer

Every UI component in this app is built on the wrappers in this folder. Import
from the barrel (`@/ui/mdui`) and never reach into the individual files.

```ts
import { MduiButton, registerMduiComponents } from '@/ui/mdui';
```

## 1. Bootstrapping (once, in `src/main.tsx`)

```ts
import { registerMduiComponents } from '@/ui/mdui';
await registerMduiComponents();          // resolves once every tag is defined
createRoot(el).render(<App />);           // then add `document.body.classList.add('ready')`
```

`registerMduiComponents()` uses `Promise.allSettled` internally, so one missing
component can never hang the app. `index.html` hides unregistered elements with
`:not(:defined)` — that is what prevents the FOUC while the promise is pending.

## 2. The two React limitations this layer solves

| Problem | Why it happens | Fix |
| --- | --- | --- |
| Custom events | React only synthesises a fixed list of DOM events, so `<mdui-dialog onClosed={…}>` silently does nothing | `useMduiEvent` / `useMduiEvents` |
| JS-only properties | `value={['a','b']}`, `value={0.5}`, `labelFormatter={fn}` cannot survive an HTML attribute round-trip | `useMduiProperty` / `useMduiModel` |

When you reach for a hook directly:

```tsx
// one or more custom events, latest handler always wins (no re-subscribe)
const ref = useRef<Dialog>(null);
useMduiEvent(ref, 'closed', () => setOpen(false));
useMduiEvents(ref, { open: onOpen, closed: onClosed });

// JS properties that have no attribute form
useMduiProperty(ref, { open, labelFormatter: (v) => `${v} KiB` });

// two-way binding — the workhorse for text-field / switch / slider / select / tabs
useMduiModel(ref, value, setValue, 'change');        // property `value`
useMduiModel(ref, checked, setChecked, 'change', 'checked'); // property `checked`

// imperative escape hatch
const dialog = useMduiImperative(ref);
useEffect(() => { dialog?.close(); }, [dialog]);

// "is this element upgraded yet?" for FOUC-free placeholders
const ready = useMduiDefined('mdui-button');
```

### Controlled components

`useMduiModel` gives you: prop → element property on every render (only when the
value actually differs, array-aware), and element → `setValue` whenever the named
custom event fires (duplicate reports of the same value are swallowed).

Passing `undefined` for the value marks the component **uncontrolled**: the
element owns the value and `onChange` becomes an observer. That is what
`MduiCheckbox` / `MduiSwitch` do when you omit `checked`.

## 3. Wrapper catalogue

**Buttons / actions** — `MduiButton` `MduiIconButton` `MduiFab` `MduiChip` `MduiSegmentedButton`

**Inputs** — `MduiTextField` `MduiTextarea` `MduiSelect` `MduiCheckbox` `MduiSwitch` `MduiRadio` `MduiRadioGroup` `MduiSlider`

**Display** — `MduiCard` `MduiList` `MduiListItem` `MduiListSubheader` `MduiBadge` `MduiProgressBar` `MduiDivider` `MduiAvatar` `MduiIcon`

**Structure** — `MduiLayout` `MduiLayoutItem` `MduiLayoutMain` `MduiTopAppBar` `MduiNavigationDrawer` `MduiNavigationRail` `MduiNavigationRailItem` `MduiNavigationBar` `MduiNavigationBarItem`

**Disclosure** — `MduiTabs` `MduiTab` `MduiTabPanel` `MduiCollapse` `MduiCollapseItem` `MduiMenu` `MduiMenuItem` `MduiDropdown` `MduiTooltip`

**Overlays** — `MduiDialog` `MduiSnackbar` `MduiBanner`

Common props: every wrapper accepts `className` and `style`.

### Notes on individual wrappers

* `MduiTextarea` is `<mdui-text-field rows={n}>` — mdui 2.x has no `<mdui-textarea>`.
* `MduiSelect` takes an `items: { value, label }[]` array and renders
  `<mdui-menu-item>` children — `<mdui-select>` has no `<option>` children.
* `MduiSegmentedButton` renders a `<mdui-segmented-button-group>`; selection
  lives on the group, not on the individual buttons.
* `MduiTabs` expects `<MduiTab>` and `<MduiTabPanel>` as children.
* `MduiTooltip`'s `children` must be **exactly one element** — mdui uses the
  first default-slot child as the tooltip trigger.
* `MduiDialog` / `MduiSnackbar` / `MduiNavigationDrawer` take `open` as a
  *property*, driven with `useMduiProperty`. `MduiDialog` fires `closed` (→ `onClosed`)
  and `close` (→ `onCancel`); mdui 2.x has **no** `cancel` event.
* `MduiBanner` is a plain `<div>` styled from MD3 error-container tokens:
  `<mdui-banner>` only existed in mdui v1 and was removed in 2.x.

## 4. Promise-based dialogs (the SweetAlert replacement)

```ts
import { alertDialog, confirmDialog, promptDialog, snackbarMessage } from '@/ui/mdui';

if (await confirmDialog({ heading: t('remove'), okText: t('ok'), danger: true })) { … }
await alertDialog({ heading: t('failed'), text: message });
const name = await promptDialog({ heading: t('rename'), value: current });
snackbarMessage({ message: t('copied'), actionText: t('undo'), onAction: undo });
```

**They never reject and never throw.** A dismissed `confirm` resolves `false`, a
dismissed `prompt` resolves `null`, a broken overlay logs a warning and returns
the same safe default — a dialog can never take a page down.

`dialogs.ts` builds on `mdui/functions/dialog.js` rather than
`confirm()`/`prompt()` because those reject on dismissal and bake in English
`OK` / `Cancel` strings. Pass your own translated button text.

## 5. Theming

```ts
import { getTheme, nextThemeSetting, onThemeChange, setTheme, M3_SEED_COLORS } from '@/ui/mdui';

setTheme('dark');                       // 'light' | 'dark' | 'system'
getTheme();                            // the scheme actually in effect
nextThemeSetting('dark');               // → 'system'  (light → dark → system → light)

const stop = onThemeChange((resolved) => charts.retheme(resolved)); // returns unsubscribe
```

`'system'` maps onto mdui's `mdui-theme-auto` class **and** installs a live
`prefers-color-scheme` listener while at least one subscriber exists. On every
change the module also:

* syncs `<meta name="theme-color">` from the resolved `--mdui-color-surface` token, and
* dispatches `themechange` on `window` with `{ resolved, setting }` — this is how
  ECharts learns it must re-theme.

Dynamic colour: `setColorScheme('#6750a4')` / `removeColorScheme()` /
`currentColorScheme()` / `getColorSchemeFromImage(url)`. `M3_SEED_COLORS` holds the
twelve Material Design 3 baseline palette seeds (`{ nameKey, hex }`); resolve
`nameKey` through i18n at the call site.

## 6. Icons

`@mdui/icons` ships one self-registering custom element per icon. Only the icons
this app uses are imported (see `icons.ts`).

```ts
import { MduiIcon, icon, ICON_TAGS } from '@/ui/mdui';

<MduiIcon name="play-arrow" />            // → <mdui-icon-play-arrow>
<MduiIcon name="outline:download" />      // → <mdui-icon-download--outlined>
<MduiButton icon="play-arrow" />          // font-style name, see below
```

`icon(name)` returns the raw tag string; use it only when you need the element
name (e.g. inside a custom wrapper). `ICON_TAGS` / `hasIcon(name)` tell you
whether a name was actually imported.

> `<mdui-icon name="…">` renders the name as a **font glyph** and needs the
> Material Icons webfont. `MduiIcon` uses the SVG elements instead, which need no
> font. That is why the wrappers prefer them; only names outside the imported set
> fall back to the font-based element.

Available names (`IconName`): `download` `pause` `play-arrow` `stop` `delete`
`settings` `add` `search` `close` `refresh` `more-vert` `folder` `folder-open`
`insert-drive-file` `link` `error` `warning` `info` `check` `edit` `sort`
`filter-list` `tune` `dark-mode` `light-mode` `language` `dns` `terminal` `upload`
`schedule` `content-copy` `hub` `menu` `keyboard-arrow-down` `keyboard-arrow-right`
`keyboard-arrow-up` `arrow-back` `restart-alt` `done-all` `speed` `open-in-new`
`public` `lan` `key` `visibility` `cloud-download` `bolt` `expand-more`
`expand-less` `chevron-right` `save` `table-chart` `swap-vert` `remove` `done`
`block` `playlist-add` `cast` `subtitles` `movie` `music-note` `image` `archive`
`insert-chart` `bug-report` `science` `timeline` `data-exploration`
`rocket-launch` `fiber-manual-record` `graphic-eq`

Adding one: import `@mdui/icons/<name>.js` (plus `--outlined`), add the kebab-case
name to `ICON_NAMES`, and it becomes available everywhere. `IconName` is derived
from that tuple, so the type follows automatically.

## 7. Accessibility rules

1. **Icon-only controls must be labelled.** `MduiIconButton` requires `label`
   (typed as required) and emits `aria-label` + `title`; rail/bar items require
   `label` too. `MduiFab` falls back to its icon name.
2. `MduiIconButton` with `toggle` emits `aria-pressed`; `MduiChip` with
   `selectable` emits `aria-selected`.
3. `MduiProgressBar` exposes `role="progressbar"` with `aria-valuenow/min/max`.
4. `MduiBanner` uses `role="alert"`.
5. Pass translated strings for every label; nothing here has a hard-coded
   English default except mdui's own components.

## 8. Styling rules

* **Never hard-code a colour.** Use `rgb(var(--mdui-color-primary))`,
  `var(--mdui-typescale-*)`, `var(--mdui-shape-corner-*)`, `var(--mdui-elevation-level*)`.
* Prefer CSS custom properties or `::part()` over deep selectors — the components
  are Shadow DOM encapsulated.
* Component-specific custom properties lose the `--mdui-` prefix
  (e.g. `mdui-dialog { --z-index: 3000 }`).