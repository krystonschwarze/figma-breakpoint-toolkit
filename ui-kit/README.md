# Figma plugin UI kit

Shared design system for the sibling Figma plugin repos. The canonical copy is the one repo that
carries a `.ui-kit-canonical` marker at its root. Edit it there, then run `npm run sync:ui-kit` in
every other repo, which finds the canonical copy by that marker rather than by name and keeps all
copies byte identical.

## Rules

**Never redefine a `--figma-color-*` variable.** Figma injects those on `:root` when the manifest UI
is opened with `themeColors: true`. This kit reads them and exposes `--fig-*` aliases with a static
fallback, so a plugin follows the editor theme for free. Redefining them, as an earlier version of one of
these plugins did, silently disables theming.

**Every plugin calls `figma.showUI(__html__, { themeColors: true })`.** Without it there are no
theme variables to read and the kit falls back to `prefers-color-scheme`, which follows the OS rather
than Figma.

**Scale.** Body text is 11px, secondary text 10px. Controls are 32px tall, icon buttons 24px, the
header 40px. Radii are 4px, 6px and 8px. Spacing steps are 4, 8, 12, 16 and 24.

## Components

| Class           | Use                                                                   |
| --------------- | --------------------------------------------------------------------- |
| `fig-header`    | 40px title bar. Pair with `fig-header__dot`, `__title`, `__meta`.     |
| `fig-body`      | Scrolling content area between header and footer.                     |
| `fig-footer`    | Sticky action bar at the bottom.                                      |
| `fig-group`     | Content block. Consecutive groups get a divider automatically.        |
| `fig-label`     | 10px tertiary section label. `fig-label-row` adds a trailing control. |
| `fig-field`     | Input shell with optional leading icon or `fig-field__affix`.         |
| `fig-select`    | Native select, restyled with a chevron.                               |
| `fig-segmented` | Segmented control. Bind it with `bindSegmented` for keyboard support. |
| `fig-btn`       | Button. Modifiers: `--primary`, `--success`, `--icon`.                |
| `fig-check`     | Checkbox with a visible box element.                                  |
| `fig-radio`     | Radio row with a visible dot element.                                 |
| `fig-chip`      | Preset pill. Modifiers: `--custom`, `--add`.                          |
| `fig-notice`    | Inline message. Modifiers: `--error`, `--success`.                    |
| `fig-empty`     | Centred empty or error state.                                         |
| `fig-list`      | Row list. Pair with `fig-list__row` and `fig-list__name`.             |
| `fig-view`      | Full height flex column, used to swap between screens.                |
| `fig-overlay`   | Absolutely positioned screen on top, used for settings.               |
| `fig-sr-only`   | Visually hidden label for icon only controls.                         |

## Helpers

`kit.ts` holds the small pieces every plugin UI needs: `byId`, `postToPlugin`, `onPluginMessage`,
`setVisible`, `clear`, `showNotice`, `bindSegmented`, `bindFieldFocus`, `readNumber` and
`fillSelect`. `bindSegmented` and the `fig-check` and `fig-radio` markup carry the accessibility
wiring, so use them rather than hand rolling a toggle.

Visibility is driven by the `hidden` attribute through `setVisible`, never by inline
`style.display`. That keeps `fig-group[hidden] + fig-group` able to drop the stale divider.
