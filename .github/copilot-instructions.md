# Copilot instructions for IQM Interactive Kiosk

## Project shape

This is an offline-first Electron kiosk application with a Vite-powered,
framework-free renderer. The renderer is plain JavaScript and CSS using
three.js, GSAP, Lottie, local video, and local 3D assets. Electron supplies
the window, display selection, kiosk/windowed modes, custom `file://`-safe
protocol handling, runtime configuration, and recovery behavior; the renderer
owns all visitor-facing UI and interactions.

The renderer is designed around a fixed 2160 x 3840 portrait canvas, not a
responsive layout. `src/js/core/stage-scaler.js` computes `--stage-scale` and
`src/styles/app.css` scales the stage to fit the current viewport. Treat
coordinates in renderer CSS and module layout code as design pixels.

Application flow is coordinated by `src/js/app.js`:

- `ScreenRouter` switches between attract, menu, and module screens.
- `ModuleCarousel` renders and navigates the module menu.
- `module-registry.js` is the inventory and route order for modules. It also
  contains the category, title, preview, and placeholder metadata.
- `ModuleHost` lazy-loads one module at a time, supplies an `AbortSignal`,
  handles loading/error views, and disposes the previous module during
  navigation, retry, Home, Menu, and idle timeout.
- Each module lives in its own directory under `src/js/modules/` and exports a
  `mount(container, context)` boundary. Modules own their state, event
  listeners, media, animation loops, and WebGL cleanup.

Electron code is CommonJS under `electron/`, while renderer and scripts use
ES modules (`package.json` has `"type": "module"`). `electron/preload.cjs`
exposes only the frozen `window.kiosk` runtime payload. Runtime settings come
from `config/kiosk.config.json`, with display overrides available through
`KIOSK_DISPLAY_ID`, `KIOSK_DISPLAY_INDEX`, and `KIOSK_DISPLAY_LABEL`.

## Build, test, and validation commands

Requirements are Node.js 22.12+ and npm 10+. Use `nvm use` where available,
then install dependencies with `npm install`. `HANDOFF.md` specifically
recommends `npm install` rather than `npm ci` when the manifest has been
trimmed.

```bash
npm run dev                 # Vite plus a resizable Electron development window
npm run build               # Syntax, camera, asset checks, then Vite renderer build
npm test                    # All node:test tests
npm test -- tests/foo.test.js
node --test tests/foo.test.js
npm run check               # Syntax, nanoscale camera, and public asset checks
npm run check:assets        # Validate public media assets
npm run check:nanoscale     # Validate nanoscale camera constraints
npm run preview             # Build renderer and open it in a windowed Electron shell
npm run preview:kiosk       # Build renderer and open fullscreen kiosk preview
npm run smoke:protocol      # Build and smoke-test the packaged asset protocol
npm run package:win         # Build the production Windows NSIS installer
npm run package:win:review  # Build the portable windowed review EXE
npm run package:win:dir     # Build an unpacked Windows directory artifact
```

There is no separate lint script. `npm run check` is the repository’s
pre-build validation entry point; `scripts/check-syntax.mjs` runs Node syntax
checks over `electron/`, `scripts/`, and `src/js/`.

For browser-only development, `npx vite` serves the renderer at
`http://127.0.0.1:5173`; Electron is only the kiosk shell. WebGL2 and a
Chromium-based browser are expected.

## Module implementation conventions

Use this boundary for every playable module:

```js
export function mount(container, { signal, onActivity, navigate }) {
  // Build the module inside container and bind abortable interaction handlers.
  return () => {
    // Stop media/RAF, dispose WebGL resources, and remove non-abortable listeners.
  }
}
```

`mount()` may return a disposer function or `{ dispose() }`. A module may also
return `presentationReady()` when compositor/GPU warm-up must complete before
the entry transition is considered settled. Always check `signal.aborted`
around asynchronous work and ensure late-resolving loads release resources
instead of mounting after navigation.

Keep each interaction isolated in its own module directory, with module CSS
next to the JavaScript. Keep reusable shell behavior in `src/js/core/` rather
than reaching into another module’s private state. Report touch/pointer
activity through `onActivity()` so the kiosk idle controller does not navigate
away during use. Use the supplied `navigate.home`, `navigate.menu`, and
`navigate.module` callbacks for shell navigation.

Use `assetUrl()` for runtime media and model paths. Do not hard-code paths that
only work in the Vite dev server: the same assets must resolve beside
`document.baseURI` in packaged Electron `file://` mode. Large module assets
should remain lazy-loaded; `public/assets/` is copied into the renderer build.

Module styles are linked from the document rather than dynamically injected by
Vite, so new module CSS must follow the existing document/CSP-compatible
pattern. Preserve the strict packaged CSP assumptions. Three.js is deduped in
`vite.config.js` and excluded from dependency pre-bundling; do not re-enable
pre-bundling or introduce a second three.js runtime, because WebGL/TSL state
can split.

The registry’s order and printed numbers are product data, not array indexes.
The current registry includes a non-playable production placeholder for slot
07, and `nextPlayableModule()` intentionally skips non-playable entries.
Update registry metadata when changing titles, carousel order, previews, or
playability rather than encoding those decisions in the carousel or host.

## Media, assets, and kiosk behavior

Video scrubbing requires HTTP byte-range support. Test streamed media through
Vite or another range-capable static host, not Python’s basic
`http.server`. Draco-compressed GLB files require the decoder under
`public/assets/draco/`; CSP changes must retain the WebAssembly requirement
documented in `HANDOFF.md`.

Do not replace optimized production models with source-sized assets casually.
Read `docs/ASSET-PRODUCTION-NOTES.md` before regenerating or replacing GLB,
video, texture, or audio assets. Asset preparation scripts are reproducible
and include checks for the runtime constraints.

Electron’s launch modes are intentionally separate: `--dev` uses Vite,
`--windowed` opens a built renderer in a normal window, and packaged
production defaults to kiosk mode unless the review configuration sets a
windowed default. `--kiosk` and `--windowed` explicitly override the packaged
default. The Windows shell lockdown (Shell Launcher, sign-in, edge gestures,
Keyboard Filter, and power settings) is separate from Electron; deployment
details are in `docs/WINDOWS-KIOSK-SETUP.md` and the Windows deployment kit.

## Reference documents

- `README.md`: current feature inventory, commands, runtime configuration, and
  module lifecycle overview.
- `HANDOFF.md`: renderer assumptions, asset/runtime caveats, and browser-only
  workflow.
- `docs/ARCHITECTURE.md`: deliberate Electron/Vite/canvas/module-host design
  decisions.
- `docs/ASSET-PRODUCTION-NOTES.md`: optimization and provenance constraints
  for production media and models.
