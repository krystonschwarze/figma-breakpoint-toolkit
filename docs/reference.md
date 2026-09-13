# Breakpoint Toolkit, reference

The full version of what the README summarises.

## Why the modes need resetting

A design system that reacts to a `Breakpoint` mode (Desktop, Tablet, Mobile) is meant to be
switched at the top: set the mode on the screen and everything below follows. That breaks as soon as
a nested layer carries an explicit mode of its own, because it stops inheriting. Switching the screen
back to Desktop then leaves that layer locked on Mobile. The plugin resets those explicit modes to
Auto in the same run, which is what makes the round trip work.

## Switch

Select one or more screens, sections or instances and open the plugin. Pick the breakpoint at the
top, then Apply.

- **The mode.** The chosen breakpoint is always written on the selection as its explicit
  `Breakpoint` mode. **Auto** clears it instead, so the frame inherits from its parent or the page.
- **Variants.** Every nested instance whose variant property is called `Breakpoint` is switched to
  the matching value. Instances are visited top down and the children of a switched instance are read
  afterwards, so instances that only exist in the mobile variant are switched as well. Instances
  whose property already follows a variable are left alone, the mode drives them.
- **Reset fixed modes on nested layers.** Clears the explicit `Breakpoint` mode on every descendant.
  On by default, see above.
- **Also set the mode on direct children.** Optional, for sections whose screens should each carry
  the mode themselves.
- **Work on a copy beside the original.** Optional. The selection is cloned first and everything
  above happens on the copy, so the desktop screen stays as it is. The copy keeps its place in the
  layer tree, lands to the right of the rightmost frame that shares its row, and is renamed after the
  breakpoint: `Home / Desktop` becomes `Home / Mobile`, a name without a breakpoint in it gets one
  appended. Afterwards the copies are selected and the viewport moves to them.
- **Set the width.** Optional. Sets the width of the frame, the copy when there is one, to the width
  the settings name for this breakpoint. Auto names none, because it inherits its breakpoint. An auto
  layout frame that hugs on that axis is switched to fixed first, and the width is read back, because
  a silently ignored resize is the failure mode here.

After a run the frame carries a **Switch breakpoint** button under Plugins in the right panel, with
the breakpoint it is on written under it. It reopens the plugin on that frame without a trip to the
menu.

The variant value comes from the breakpoint name, so it is not asked for twice. Only a breakpoint
that names no variant needs a choice: Tablet, where the components offer Desktop and Mobile only, and
Auto, where no mode decides. That choice is remembered per breakpoint.

**A layer inside an instance keeps its size.** The frame itself is the one node a plugin may resize,
which is what **Set the width** does. Verified in a real file: a card that is 328 wide in
its Desktop variant and 256 in its Mobile one becomes 256 when it stands on its own or sits in a main
component, but stays 328 when it sits inside an instance. Neither `resize`,
`resizeWithoutConstraints` nor `swapComponent` moves it there, so no plugin can do it and Switch
reports how many instances it affected. The way out belongs to the design system: give the
surrounding module its own `Breakpoint` variants with the Prepare tab, so the mobile sizes come from
the module rather than from an override that Figma will not accept. A layer that fills its parent has
no such problem, because the parent drives its width.

Sizing is otherwise not touched. A layer that reads as fill in the desktop variant and fixed in the mobile one
is defined that way in the component: verified on a real screen, the run adds no size override of its
own.

## Bind

**Bind** connects the `Breakpoint` variant property of every nested instance to a string variable
from the mode collection, for example a variable whose value is `Desktop` in the Desktop and Tablet
mode and `Mobile` in the Mobile mode. After that the variant follows the mode of the frame on its
own and Switch only has to set the mode. **Unbind** writes the current value back as a plain variant.

## Prepare

**Prepare** gives a component the `Breakpoint` property, which Figma only allows on a component set.
So a plain component is cloned once per value, the copies are named `Breakpoint=Desktop` and
`Breakpoint=Mobile`, and they are combined into a set that keeps the component's name. The first
value stays the top left variant, because that is what Figma hands out as the default. Boolean, text
and swap properties survive the combine, with new ids.

Instances of the component survive the combine: verified on a probe, an instance keeps its property
overrides, gains the new property and points at the first value.

A component set that already has variants is extended instead: the property is added to every
variant, then each variant carrying the first value is copied into a new column for every value that
is still missing. That also fills a gap later, for example adding Tablet to sets that only know
Desktop and Mobile. A set that already carries every value is left alone. Selecting a single variant
counts as selecting its set. Sets do not grow around appended variants by themselves, so the plugin
resizes them, except when the set has auto layout and places its variants itself.

The values are chips. The first one is the default variant, clicking another one promotes it, and
the plus chip adds one. A value cannot contain a comma or an equals sign: Figma builds variant names
as `Prop=Value, Prop2=Value2`, so such a value puts the whole set into an error state, which Figma
answers by renaming the variant to something like `Property 1=Breakpoint=Desktop, wide`. The chip
input says so instead of letting it happen.

The property is appended at the end of the variant name. Where it belongs in the middle, as in
`Style=Image, Breakpoint=Mobile, Alignment=Left`, reorder the property in Figma afterwards.

## Failures

Every run is one undo step.

Failures are reported in plain words. Figma's own messages name the internal getter that failed and
a node id, so they are translated: "in get_explicitVariableModes: The node ... does not exist"
becomes the sentence that a layer disappeared because switching a variant replaced it, and that a
second run picks up the rest. Those vanished layers are now skipped instead of reported.

When a start step fails, the plugin does not close: it falls back, names the failing step in the
window and parks the same text on the current page as plugin data under
`breakpoint-toolkit.diagnostics`, which is the only channel out of the sandbox that survives closing
the window. Settings live in `figma.clientStorage` under `breakpoint-toolkit.settings`; a value left
by the plugin's former name is moved over on first read.

## Settings

The gear in the header opens the settings. The variant property name defaults to `Breakpoint` and is
matched without regard to case.

**Breakpoint widths** is the table behind Set the width: a name and a width per breakpoint, matched
to the breakpoint without regard to case. It starts at Desktop 1680, Tablet 1024 and Mobile 400,
every row can be renamed, changed or removed, and a row may name a breakpoint this file does not
offer, so one table serves several files. An emptied table stays empty, a missing one comes back
with those three. The mode collection can be local or come from an enabled library.
On first start the plugin picks the collection that carries the property name, if there is exactly
one. The string variable for Bind is picked the same way.

Library collections need `"permissions": ["teamlibrary"]` in the manifest, which is already set. A
library collection only exposes its modes after one of its variables has been imported into the file,
which the plugin does on first use.

## The manifest

Changing `relaunchButtons` in the manifest takes a fresh import to show up, otherwise the button
on the frame stays a no-op.

The manifest needs its `id`. Without one Figma rejects `figma.clientStorage` and
`setPluginData` with "Cannot access client storage without a plugin ID", which takes the settings
and the diagnostics down with it. The id in here is a locally generated one, good enough for
development; publishing replaces it with the id Figma issues.

## Layout

| Path                 | Role                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `src/code.ts`        | Sandbox side. Scans, switches variants and modes, binds, adds properties.  |
| `src/breakpoint.ts`  | Pure helpers: property matching, value picking, error text, summaries.     |
| `src/errors.ts`      | Turns Figma's internal error wording into a sentence with a way out.       |
| `src/variants.ts`    | Pure variant name parsing and the prepare summaries. Unit tested.          |
| `src/walk.ts`        | Top down tree walk that reads children after the visit. Unit tested.       |
| `src/collections.ts` | Local and library variable collections and variables.                      |
| `src/settings.ts`    | Settings in `figma.clientStorage`, sanitised on the way in and out.        |
| `src/messages.ts`    | Message contract shared by both sides.                                     |
| `src/ui/`            | Plugin window. `index.html` is a template, the build inlines CSS and JS.   |
| `ui-kit/`            | Shared design system of the sibling Figma plugin repos, synced from there. |

`ui-kit/` is a copy. The canonical version lives in the sibling repo that carries a
`.ui-kit-canonical` marker. Edit it there and run `npm run sync:ui-kit` here.
