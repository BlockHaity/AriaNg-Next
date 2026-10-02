# `@/ui/mdui` — the mdui foundation layer

Every UI component in this app builds on the wrappers in this folder. Import from
the barrel (`@/ui/mdui`); never reach into the individual files.

```ts
import { MduiButton, registerMduiComponents } from '@/ui/mdui';
```

## 1. Bootstrapping (once, in `src/main.tsx`)

```ts
await registerMduiComponents();   // resolves once every tag is defined
createRoot(el).render(<App />);   // then document.body.classList.add('ready')
```

Internally it uses `Promise.allSettled`, so one missing component can never hang
the app. `index.html` hides unregistered elements with `:not(:defined)` — that is
what prevents the FOUC while the promise is pending.

## 2. The two React limitations solved here

| Problem | Why | Fix |
| --- | --- | --- |
| Custom events | React only synthesises a fixed list of DOM events, so `<mdui-dialog onClosed>` silently does nothing | `useMduiEvent` / `useMduiEvents` |
| JS-only properties | `value={['a','b']}`, `value={0.5}`, `labelFormatter={fn}` cannot survive an HTML attribute round-trip | `useMduiProperty` / `useMduiModel` |

Reach for a hook directly only when no wrapper fits:

```tsx
const ref = useRef<Dialog>(null);
useMduiEvent(ref, 'closed', () => setOpen(false));      // latest handler wins; no re-subscribe
useMduiEvents(ref, { open: onOpen, closed: onClosed });  // several events, one stable set
useMduiProperty(ref, { open, labelFormatter: (v) => `${v} KiB` });
useMduiModel(ref, value, setValue, 'change');           // property `value`
useMduiModel(ref, checked, setChecked, 'change', 'checked'); // property `checked`
const dialog = useMduiImperative(ref);                  // imperative escape hatch
const ready = useMduiDefined('mdui-button');            // "is it upgraded yet?"
```

### Controlled components

`useMduiModel` writes prop → element property on every render (only when the
value actually differs, array-aware) and calls `setValue` when the named custom
event fires (duplicate reports of the same value are swallowed).

Passing `undefined` for the value marks the component **uncontrolled**: the
element owns the value and the callback becomes an observer. That is what
`MduiCheckbox` / `MduiSwitch` do when you omit `checked`.

## 3. Wrapper catalogue

* **Buttons / actions** — `MduiButton` `MduiIconButton` `MduiFab` `MduiChip` `MduiSegmentedButton`
* **Inputs** — `MduiTextField` `MduiTextarea` `MduiSelect` `MduiCheckbox` `MduiSwitch` `MduiRadio` `MduiRadioGroup` `MduiSlider`
* **Display** — `MduiCard` `MduiList` `MduiListItem` `MduiListSubheader` `MduiBadge` `MduiProgressBar` `MduiDivider` `MduiAvatar` `MduiIcon`
* **Structure** — `MduiLayout` `MduiLayoutItem` `MduiLayoutMain` `MduiTopAppBar` `MduiNavigationDrawer` `MduiNavigationRail` `MduiNavigationRailItem` `MduiNavigationBar` `MduiNavigationBarItem`
* **Disclosure** — `MduiTabs` `MduiTab` `MduiTabPanel` `MduiCollapse` `MduiCollapseItem` `MduiMenu` `MduiMenuItem` `MduiDropdown` `MduiTooltip`
* **Overlays** — `MduiDialog` `MduiSnackbar` `MduiBanner`

Every wrapper accepts `className` and `style`.

Things that are not what they look like in mdui 1:

* `MduiTextarea` is `<mdui-text-field rows={n}>` — there is no `<mdui-textarea>`.
* `MduiSelect` takes an `items: { value, label }[]` array and renders
  `<mdui-menu-item>` children — `<mdui-select>` has no `<option>` children.
* `MduiSegmentedButton` renders a `<mdui-segmented-button-group>`; selection
  lives on the group, not on the buttons.
* `MduiTabs` expects `<MduiTab>` + `<MduiTabPanel>` children.
* `MduiTooltip`'s `children` must be **exactly one element** — mdui uses the
  first default-slot child as the tooltip trigger.
* `MduiDialog` / `MduiSnackbar` / `MduiNavigationDrawer` take `open` as a
  *property*. `MduiDialog` fires `closed` (→ `onClosed`) and `close` (→
  `onCancel`); mdui 2.x has **no** `cancel` event, so `onCancel` fires for any
  close the app did not request.
* `MduiBanner` is a plain `<div>` styled from MD3 error-container tokens —
  `<mdui-banner>` only existed in mdui v1.
* `MduiListItem`'s `value` is JS-only in 2.x (v1 used it for `list-group`).

## 4. Promise-based dialogs (the SweetAlert replacement)

```ts
if (await confirmDialog({ heading: t('remove'), okText: t('ok'), danger: true })) { … }
await alertDialog({ heading: t('failed'), text: message });
const name = await promptDialog({ heading: t('rename'), value: current });
snackbarMessage({ message: t('copied'), actionText: t('undo'), onAction: undo });
```

**They never reject and never throw.** A dismissed `confirm` resolves `false`, a
dismissed `prompt` resolves `null`, and a broken overlay logs a warning and
returns the same safe default — a dialog can never take a page down. Pass your own
translated button text (nothing defaults to `OK` / `Cancel`).

## 5. Theming

```ts
setTheme('dark');                       // 'light' | 'dark' | 'system'
getTheme();                            // the scheme actually in effect
nextThemeSetting('dark');               // → 'system'  (light → dark → system → light)
const stop = onThemeChange((r) => charts.retheme(r)); // returns unsubscribe
```

`'system'` maps onto mdui's `mdui-theme-auto` class **and** installs a live
`prefers-color-scheme` listener while at least one subscriber exists. On every
change the module also syncs `<meta name="theme-color">` from the resolved
`--mdui-color-surface` token and dispatches `themechange` on `window` with
`{ resolved, setting }` — that event is how ECharts learns to re-theme.

Dynamic colour: `setColorScheme('#6750a4')` / `removeColorScheme()` /
`currentColorScheme()` / `getColorSchemeFromImage(url)`. `M3_SEED_COLORS` holds
the twelve Material Design 3 baseline palette seeds as `{ nameKey, hex }`;
resolve `nameKey` through i18n at the call site.

## 6. Icons

`@mdui/icons` ships one self-registering custom element per icon; only the ones
this app uses are imported (see `icons.ts`).

```ts
<MduiIcon name="play-arrow" />        // → <mdui-icon-play-arrow>
<MduiIcon name="outline:download" />  // → <mdui-icon-download--outlined>
<MduiButton icon="play-arrow" />      // font-style name, see below
```

`icon(name)` returns the raw tag string; use it only when you need the element
name (e.g. inside a custom wrapper). `ICON_TAGS` / `hasIcon(name)` report whether
a name was actually imported.

> **Never pass an `icon` / `end-icon` / `active-icon` / `selected-icon` /
> `delete-icon` *attribute* to an mdui element.** Those attributes are font-only:
> mdui renders `<mdui-icon name="play-arrow">`, which resolves through the
> Material Icons **webfont ligature**. This app never loads that webfont, so the
> attribute renders as the literal words "play-arrow" / "delete" / "download".
>
> Pass the icon as a **slotted child** instead — the wrappers in `components.tsx`
> do this via the internal `slotIcon(name, slot)` helper, which returns `null` for
> an unregistered name rather than silently falling back to the font. Slots in
> use: `mdui-button` (`icon`, `end-icon`), `mdui-button-icon` (default slot,
> `selected-icon`), `mdui-fab` (`icon`), `mdui-chip` (`icon`, `selected-icon`,
> `delete-icon`), `mdui-list-item` / `mdui-menu-item` (`icon`, `end-icon`),
> `mdui-navigation-rail-item` / `mdui-navigation-bar-item` (`icon`, `active-icon`),
> `mdui-segmented-button` (`icon`), `mdui-tab` (`icon`), `mdui-text-field`
> (`icon`, `end-icon`), `mdui-dialog` (`icon`).
>
> `src/ui/__tests__/icon-slots.test.tsx` fails if any of those attributes comes
> back, so this cannot regress silently.
>
> `<mdui-icon name="…">` still exists as the documented fallback for names
> outside the imported SVG set.

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

Adding one: import `@mdui/icons/<name>.js` (plus `--outlined`), add the
kebab-case name to `ICON_NAMES`; the `IconName` union follows automatically.

## 7. Accessibility rules

1. **Icon-only controls must be labelled.** `MduiIconButton` and the
   navigation items require `label` in their types and emit `aria-label` (+`title`).
2. `MduiIconButton` with `toggle` emits `aria-pressed`; `MduiChip` with
   `selectable` emits `aria-selected`.
3. `MduiProgressBar` exposes `role="progressbar"` with `aria-valuenow/min/max`.
4. `MduiBanner` uses `role="alert"`.
5. Pass translated strings for every label; nothing here has a hard-coded
   English default beyond mdui's own components.

## 8. Styling rules

* **Never hard-code a colour.** Use `rgb(var(--mdui-color-primary))`,
  `var(--mdui-typescale-*)`, `var(--mdui-shape-corner-*)`,
  `var(--mdui-elevation-level*)`.
* Prefer CSS custom properties or `::part()` over deep selectors — the components
  are Shadow DOM encapsulated.
* Component-specific custom properties drop the `--mdui-` prefix
  (e.g. `mdui-dialog { --z-index: 3000 }`).