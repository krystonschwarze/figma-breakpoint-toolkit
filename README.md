# Breakpoint Toolkit

Figma plugin for the breakpoint dimension of a design system. It turns a desktop screen into its
mobile counterpart in one step and back again, by walking every nested instance inside the selected
frame, switching the `Breakpoint` variant property on each of them, setting the `Breakpoint` variable
mode on the frame and clearing the fixed modes on nested layers so the whole tree inherits cleanly.

## What it does

Three tabs. Select one or more screens, sections or instances, and open the plugin.

- **Switch** is the everyday operation. It writes the mode on the selection, switches every nested
  `Breakpoint` variant to match, and resets the explicit modes further down so inheritance works
  again. Optionally it sets the frame width from the settings, or does all of it on a copy beside the
  original and names the copy after the breakpoint.
- **Bind** points the `Breakpoint` variant property of every nested instance at a string variable, so
  the variant follows the mode on its own and Switch only has to set the mode. **Unbind** reverses it.
- **Prepare** gives a component the `Breakpoint` property in the first place, which Figma only allows
  on a component set, so a plain component is turned into one and an existing set is extended.

Every run is one undo step, and afterwards the frame carries a **Switch breakpoint** relaunch button
that reopens the plugin on it.

One limit is worth knowing before you start: a layer inside an instance keeps its size, and no plugin
can change that. The reference explains the case and the way around it.

## Development

```sh
npm install
npm run dev      # rebuild dist/ on every change
npm test         # unit tests for the pure logic, via the Node test runner
npm run preview  # render every built plugin UI in Figma light and dark in the browser
npm run build    # minified production build
npm run verify   # typecheck, lint, format check, test, build
```

Import the plugin in Figma via **Plugins > Development > Import plugin from manifest** and pick
`manifest.json`. The manifest points at `dist/`, so run a build at least once before importing.

## Documentation

- [docs/reference.md](docs/reference.md): all three tabs in full, the settings, the manifest notes and the source layout.
- [ui-kit/README.md](ui-kit/README.md): the shared design system.
