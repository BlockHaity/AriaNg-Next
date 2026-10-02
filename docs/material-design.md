# Material Design 3

The UI is built **exclusively** on [mdui](https://github.com/fernvenue/mdui)
2.1.5's implementation of Google's
[Material Design 3](https://m3.material.io/) specification. There is no second
component library, no CSS framework and no hand-rolled Material clone in the tree.

The rule that makes this more than a slogan: **no colour literal is used
anywhere.** Every colour, radius, type style and shadow comes from an mdui design
token.

```
✅  background: rgb(var(--mdui-color-surface-container-low));
✅  color:      rgb(var(--mdui-color-on-surface-variant));
✅  font:       var(--mdui-typescale-label-small-font);
✅  radius:     var(--mdui-shape-corner-small);
✅  box-shadow: var(--mdui-elevation-level2);

❌  background: #fef7ff;
❌  color: rgb(103, 80, 164);
❌  color: oklch(0.49 0.19 293);
```

## The colour guard

`scripts/check-no-color-literals.mjs` enforces the rule mechanically. It scans
`.ts`, `.tsx` and `.css` under `src/` and fails the build on four rule classes:

| Rule | Catches | Hint |
| --- | --- | --- |
| `hex` | `#rgb` `#rgba` `#rrggbb` `#rrggbbaa` | `var(--mdui-color-*)` |
| `colour-fn` | `rgb()` / `rgba()` / `hsl()` / `hsla()` with **numeric** arguments | `rgb(var(--mdui-color-*))` |
| `modern-fn` | `oklch()` / `color-mix()` built from numbers or raw colours | `var(--mdui-color-*)` |
| `named-colour` | `white`, `black`, `red`, `blue`, `green`, `grey`, `gray`, `silver` in a styling position | `var(--mdui-color-*)` |

Deliberate design decisions in the guard, because a guard with false positives
gets disabled:

- **It only looks at value positions**: CSS declaration values in a stylesheet,
  string and template literals in TS/TSX, `style={{ … }}` objects and the inline
  style API (`.style.setProperty()`, `.style.color =`). A `const key =
  'theme.color.blue'` is not styling and is never flagged.
- **Comments are masked first** (byte offsets preserved, so line/column numbers
  still point at the original source), and CSS selectors are skipped, so `#root {`
  is not a hex colour and `url(#gradient)` is not either.
- **`transparent`, `currentColor` and `inherit` are always allowed.**
- **`rgb(var(--mdui-color-surface))` is the mdui idiom and explicitly passes**,
  which is why the codebase writes it rather than using the tokens bare.
- Named colours are only checked where they would really be styling.

Current state: **165 files scanned, 0 violations** (67 further files skipped as
data or fixtures).

Three narrow exemptions exist, and each is justified in the script itself:

| File | Rule waived | Why |
| --- | --- | --- |
| `src/ui/mdui/theme.ts` | `hex` | `M3_SEED_COLORS` holds the official Material Design 3 baseline palette **seeds**. They are input data for token generation, not styling. |
| `src/pages/task-detail/PieceBar.tsx` | `hex` | `LEGACY_PIECE_BAR_COLOR` (`#208fe5`, AriaNg's 2013 flat blue) is the last-resort canvas `fillStyle`, used only when `--mdui-color-primary` cannot be read from the computed style (jsdom, a detached node, an engine without custom properties). The themed path is always tried first. See [known deviations](#known-deviations). |
| any line | — | The escape hatch marker `mdui-allow-color` in a comment waives the line. It must always be paired with a one-line justification, because an unexplained escape hatch is indistinguishable from a bug. |

## Compliance checklist

| MD3 area | How it is met |
| --- | --- |
| **Colour roles** | Every surface, on-surface, container, outline, primary/secondary/tertiary and error value is an `--mdui-color-*` role. Paired roles (`surface` + `on-surface`, `*-container` + `on-*-container`) are always used together — the hand-built tables use `surface-container-low` with `on-surface-variant` and `secondary-container` with `on-secondary-container`, never a container with the wrong `on-` colour. Enforced by the colour guard. |
| **Dynamic colour** | `setColorScheme(seed)` / `removeColorScheme()` / `getColorSchemeFromImage(url)` from mdui regenerate every role from one seed. `M3_SEED_COLORS` in `src/ui/mdui/theme.ts` offers the twelve MD3 baseline palette seeds as a picker; the user can also extract a seed from an image. Because no colour is hard-coded, a new seed repaints the whole app, including the canvas-drawn piece maps and the ECharts series. |
| **Light / dark / auto** | `setTheme('light' \| 'dark' \| 'system')` from `src/ui/mdui/theme.ts`. `'system'` maps onto mdui's `mdui-theme-auto` class **and** keeps a live `prefers-color-scheme` listener alive while anything is subscribed. On every change the module syncs `<meta name="theme-color">` from the resolved `--mdui-color-surface` token and dispatches a `themechange` `CustomEvent` on `window` — which is how the ECharts instances learn to re-theme instead of polling. |
| **Type scale** | Every text style is a `--mdui-typescale-*` token, with all three parts (family, size, line-height) taken together rather than mixed. In use, by frequency: `body-small` (47), `body-medium` (43), `title-small` (28), `label-medium` (22), `label-small` (16), `title-medium` (14), `label-large` (13), `title-large` (7), `headline-medium` (4), `body-large` (2). The document body sets `body-medium` once in `src/styles/global.css`; individual components override only when the MD3 role calls for it. No `display-*` style is used — there is no display-scale text in the app. |
| **Shape scale** | Radii come from `--mdui-shape-corner-{none,extra-small,small,medium,large,extra-large,full}`. In use across `src/`: `small` (21 — chips, icon buttons, inline rows), `extra` (13 — FAB, dialogs), `full` (13 — badges, avatars, progress tracks), `medium` (6 — menus, popovers), `large` (5 — cards, error cards). `none` and `extra-small` are available but unused. A "roundness 0" theme therefore flattens the app the way MD3 says it should. |
| **Elevation** | `--mdui-elevation-level0`–`level5` only. The app uses level 2 for the three genuinely raised surfaces: a dragged task row, the piece-map popup, and the option row's overflow menu. Everything else is a tonal surface shift with no shadow at all, which is what MD3 asks for. |
| **State layers** | Hover / focus / pressed / dragged overlays. mdui components carry their own. The hand-built tables use the same tokens' values: `rgb(var(--mdui-color-on-surface) / 0.06)` on hover and `/ 0.1` on press for task rows, `opacity: 0.08` for the ED2K result rows, `surface-container-highest` for the dragged row. |
| **Motion** | mdui's own emphasis/deceleration curves for components; `src/styles/global.css` adds a `prefers-reduced-motion: reduce` block that collapses every custom animation and transition to 0.001 ms and sets `scroll-behavior: auto`, so no hand-written transition can ignore the preference. |
| **Touch targets** | Every interactive row and control is at least 48 dp. Task rows are 64 px compact / 72 px comfortable; tab headers, settings rows, file-tree rows and toolbar buttons are all `min-height: 48px` (or larger). Icon buttons inside rows are 40 px visually but sit inside a 48 px hit area. |
| **Focus visibility** | Every custom focusable element has a `:focus-visible` rule with a visible ring (`outline: 2–3px solid rgb(var(--mdui-color-primary))` plus an offset), never `outline: none`. Dragula, which AriaNg used, gave the list no focus handling at all; this is the improvement. |
| **Keyboard operability** | Drag reordering is driven by `@dnd-kit`'s `KeyboardSensor` with `sortableKeyboardCoordinates`, and it announces moves through an `Announcements` function, so the list is fully reorderable without a pointer. Dialogs close on Escape, the drawer closes on overlay click and on Escape. Global shortcuts are documented in the settings and can be switched off. |
| **ARIA** | Icon-only controls require a `label` in their types and emit `aria-label` plus `title`. `MduiIconButton` with `toggle` emits `aria-pressed`; `MduiChip` with `selectable` emits `aria-selected`; `MduiProgressBar` exposes `role="progressbar"` with `aria-valuenow/min/max`; `MduiBanner` uses `role="alert"`; disabled tabs get `aria-disabled` and are removed from the tab order. Task rows carry `aria-selected`. A `.ariang-visually-hidden` utility is available for text that must be announced but not seen. Translations are rendered as **text**, never as markup, so a translation cannot inject HTML. |
| **Contrast** | Guaranteed structurally rather than by hand-tuning: MD3's role pairs already meet 4.5:1 for body text and 3:1 for large text and UI components, and dynamic colour regenerates the roles from a tonal palette rather than mixing arbitrary values. Nothing in the app picks a foreground/background pair by hand, so there is nowhere for a contrast failure to hide. |
| **Window size classes** | Breakpoints come from mdui's own `--mdui-breakpoint-*` tokens (`xs` 0, `sm` 600, `md` 840, `lg` 1080, `xl` 1440, `xxl` 1920), read through `mdui/functions/breakpoint.js` so a theme that redefines them is honoured. The shell falls back to the MD3 default of 840 px when the token is unavailable, which is also what keeps it working in jsdom where `mdui.css` is not applied. |

## Responsive navigation

MD3's canonical mapping, and the mapping this app uses
([src/app/shell/AppShell.tsx](../src/app/shell/AppShell.tsx)):

| Window size class | Navigation component |
| --- | --- |
| Compact (< 840 px, `md` and below) | **Modal navigation drawer** over the content |
| Medium and expanded (≥ 840 px) | **Navigation rail**, docked |

```tsx
<mdui-layout full-height>
  <TopToolbar />                          {/* mdui-top-app-bar      */}
  <NavigationDrawer modal={compact} />    {/* < 840px: modal overlay */}
  {!compact && <NavigationRail />}         {/* ≥ 840px: docked rail  */}
  <mdui-layout-main>…</mdui-layout-main>
  <StatusBar />                            {/* AriaNg's footer       */}
</mdui-layout>
```

### Why a rail and not a bottom navigation bar

The MD3 bottom navigation bar is specified for **3–5 destinations** at the bottom
of the screen. This app's navigation tree is far deeper:

```
Download
  /downloading      (numActive badge)
  /waiting          (numWaiting badge)
  /stopped          (numStopped badge)
  /ed2k/search                          ← aria2-next
Settings
  /settings/ariang
  Aria2 Settings (collapsible, the 10 option groups)
  /status            + the live connection label
  /debug             (only with debug mode on)
```

Nine first-level destinations and fifteen routes in total. A bottom bar would
have to hide half of them behind an overflow, which is exactly what the
specification does not want a bottom bar to be.

So the rail carries what it has room for — the three task lists with their live
count badges, the ED2K search helper, and the settings entries that are a single
hop (`AriaNg Settings`, `Aria2 Status`, and `AriaNg Debug Console` when debug
mode is on) — and its top **menu icon opens the full navigation drawer as a modal
overlay**, which is precisely what MD3 prescribes ("a menu icon at the top of the
rail opens a modal navigation drawer"). The full tree, including the ten aria2
option groups, is therefore always one tap away on a desktop layout.

Active-state matching follows AriaNg's `data-href-match` rule: an entry is active
when the current path equals it, or continues with a `/`. So `/settings/ariang`
stays active on `/settings/ariang/language`, while a link to `/settings` would
never swallow it.

## The one place MD3 has no component: the data table

**mdui ships no data table**, and neither does MD3 itself. Every table in this app
is hand-built, which makes it the one place where compliance has to be argued
rather than inherited:

- the **task list** (`/downloading`, `/waiting`, `/stopped`),
- the **file tree** on a task's Files tab,
- the **peers** table,
- the **ED2K search results** table,
- the **debug log** table.

### The conventions they follow

1. **Surfaces come from the container scale, not from `surface`.** A table is
   usually a scrolled container inside a page, so the body uses
   `surface-container-low`, the header row uses `surface-container-high`, and
   header/footer rules are separated by a 1 px `--mdui-color-outline-variant`
   line rather than a shadow.
2. **Rows are state-layer surfaces.** Hover paints
   `rgb(var(--mdui-color-on-surface) / 0.06)`, press `/ 0.1`, and the selected
   state switches to the `secondary-container` / `on-secondary-container` pair —
   a tone change, which is the MD3 way of saying "this row is selected" without
   a highlight colour.
3. **Typography is the MD3 table pattern**: `label-small` or `title-small` for
   headers, `body-medium` for cells, `label-small` for secondary metadata (size,
   ETA, speed). Numbers are `body-medium` with `text-align: end` where they are
   meant to be compared in a column.
4. **Density is a type decision, not a font-size decision.** Compact and
   comfortable row heights are achieved with the type tokens plus padding, never
   by shrinking text below `body-small`.
5. **Layout is CSS grid, not a table layout model.** Column tracks are named per
   AriaNg's own column groups (`8fr / 2fr / 2fr / auto`) and switched at AriaNg's
   breakpoints, because the layout must stay recognisable to someone who used
   AriaNg. Bootstrap's `.col-*` classes are gone.
6. **Every interactive element keeps its MD3 affordances.** Sortable headers are
   real buttons with a `:focus-visible` ring and a `label-small` sort indicator in
   the primary role; the row itself is focusable and carries `aria-selected`; the
   row minimum height is 48 dp (64/72 px in the task list).
7. **Horizontal scrolling is a container decision.** `.ariang-scroll-area`
   (`overflow: auto; scrollbar-width: thin`) is used where a table genuinely has
   more columns than the width allows, instead of truncating data silently.

## Known deviations

| Deviation | Why |
| --- | --- |
| **The peer piece bar uses `--mdui-color-primary`, not AriaNg's hard-coded `#208fe5`.** | AriaNg painted every piece bar the same flat 2013-era blue, which matches neither light nor dark mode nor the user's dynamic scheme. `PieceBar` resolves the primary role from the element's computed style and repaints on `themechange`. `#208fe5` survives only as `LEGACY_PIECE_BAR_COLOR`, the canvas `fillStyle` of last resort when a custom property cannot be read. |
| **The task-row progress bar is hand-built rather than `<mdui-linear-progress>`.** | mdui's component renders its label *outside* the track and cannot put a percentage that travels with the fill. AriaNg puts the percentage inside the bar, absolutely positioned over the track, and switches its ink at 50 % so the label stays legible on both halves. Reproducing that needs a custom element, so `TaskProgress` is built from `--mdui-color-*` tokens instead. It also fixes an AriaNg typo: `aria-valuemin="1"` is now `0`. |
| **Hand-built state layers are 6 % hover / 10 % pressed, not MD3's 8 % / 10 %.** | The task rows are 64–72 px tall and dense; MD3's 8 % hover layer reads as a selection highlight at that size. The pressed value is MD3's own 10 %. The ED2K result table does use 8 %. mdui's own components ship hover `0.08`, focus `0.12`, pressed `0.12`, dragged `0.16` as `--mdui-state-layer-*`, so MD3's published focus/pressed figures and mdui's shipped values differ — worth knowing when comparing a screenshot against a reference. |
| **`Connected` uses the `tertiary` role.** | MD3 has no "success" role. `Connected` is the one non-error positive status in the UI, so it maps onto `tertiary`; `Connecting` / `Reconnecting` use `primary`, `Waiting to reconnect` uses `on-surface-variant`, and `Disconnected` uses `error`. This is the same substitution mdui's own components make for non-error tones. |
| **The layout grid switches at AriaNg's breakpoints (768 / 992 / 1200 px), not MD3's (600 / 840 / 1080 / 1440).** | The column proportions come from AriaNg's task table, and keeping them means a returning user finds the same columns in the same places. Only the **navigation** switch follows MD3 (840 px), because that one changes which component is mounted. |
| **No MD3 "large" data table density variants, no sticky-header shimmer, no column-resize handles.** | These are desktop power-user features with no MD3 specification to comply with. Adding them would mean inventing a design. |

## How to stay compliant

Contributors should read [src/ui/mdui/README.md](../src/ui/mdui/README.md)
before touching a component. The short version:

1. **Import from the barrel.** `import { MduiButton } from '@/ui/mdui'` — never
   reach into `components.tsx` / `dialogs.ts` / `overlays.tsx` directly.
2. **Never hard-code a colour, radius, type style or shadow.** Use
   `rgb(var(--mdui-color-*))`, `var(--mdui-typescale-*)`,
   `var(--mdui-shape-corner-*)` and `var(--mdui-elevation-level*)`. Run
   `node scripts/check-no-color-literals.mjs` before committing.
3. **If a value genuinely cannot come from a token**, use the
   `mdui-allow-color` escape hatch and write the one-line justification next to
   it — or, preferably, add a narrow entry to `ALLOWLIST` in the guard script with
   a reason. Review policy is in `docs/ci.md`.
4. **Prefer CSS custom properties or `::part()` over deep selectors.** The
   components are Shadow-DOM encapsulated, so a deep selector is a bug waiting to
   happen on the next mdui release.
5. **Label every icon-only control.** `MduiIconButton` and the navigation items
   require `label` in their types; TypeScript enforces it.
6. **Pass translated strings for every label.** Nothing in the app has a
   hard-coded English default, and the accessibility rules in the mdui README
   (section 7) are the checklist.
7. **Do not add a second component library.** If MD3 and mdui genuinely do not
   cover a need, build it from tokens — that is what the data tables do — and
   document it in *Known deviations* above.
