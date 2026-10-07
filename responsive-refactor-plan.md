# Responsive Refactor Plan

Goal: refactor the IQM Interactive Kiosk from a fixed 2160 x 3840 kiosk canvas
into a fully fluid, truly responsive web app, no longer constrained to a
single kiosk display.

## Scope reality check

This is a large rewrite, not a CSS tweak. Current numbers:

- **~13,800 lines of CSS**, virtually all authored in absolute `px` against a
  2160x3840 canvas (`majorana.css` alone is 4,082 lines).
- **`#kiosk-stage`** is transform-scaled as a single rigid unit
  (`src/styles/app.css:9-19`, `src/js/core/stage-scaler.js`) — removing that
  is the crux of the change.
- **9 modules**, several with three.js/WebGL scenes (`nanoscale-camera.js`,
  `shape-scene-3d.js`, `state-shader.js`, etc.) whose cameras/canvases are
  also sized against the fixed design canvas, not just the CSS.
- Interaction model is touch-first (large hit targets, no hover states, no
  keyboard nav) — going "web app" means adding those too.

Mechanically converting every `px` to `vw`/`%` would just reproduce today's
uniform-scaling behavior with different units — not true responsiveness.
Real responsiveness means the *layout itself* reflows at different sizes
(stacking, hiding, resizing independently), which requires re-thinking each
screen's structure, not just its units.

## Decision: drop kiosk mode

To keep complexity to a minimum, kiosk mode is being retired rather than
kept alongside the responsive layout. Running two layout systems, two
settings surfaces, and two deployment pipelines indefinitely works against
the goal of a fluid/responsive rewrite. Target state is:

- **One layout model** — a single fluid, reflowing layout; no fixed-canvas
  scale mode to keep in sync.
- **One settings panel** — kiosk-only controls (e.g. the Top/Center layout
  toggle, which exists to fill dead space on the fixed portrait canvas) are
  removed rather than dual-maintained.
- **One build target** — a standard responsive web app; no Electron shell,
  no Windows kiosk packaging pipeline.

This means removing:

- `electron/` shell and all `package:win*` / kiosk packaging scripts
- `config/kiosk.config.json` (design width/height, display selection, kiosk
  idle timeouts)
- `stage-scaler.js` and `--stage-scale` entirely — no fallback scale-mode
- Kiosk-only settings UI (e.g. the layout Top/Center toggle)
- `docs/WINDOWS-KIOSK-SETUP.md`, `docs/WINDOWS-PRO-EVENT-SETUP.md`, and
  related test coverage

What stays (it's generic, not kiosk-specific): the `IdleController` /
idle-return-to-menu behavior is reasonable for any public-facing display and
can remain as an optional, non-default setting rather than core
architecture.

## Phased plan

### Phase 0 — Decisions

- **Supported viewport range:** 320px up through ultra-wide (1920px+).
- **3D scene fallbacks:** none for now. WebGL scenes are not given a reduced
  quality tier or static fallback for low-power/mobile devices in this
  round; revisit later if needed.
- **Design source of truth:** figure layouts out in code for now rather than
  producing new Figma frames per breakpoint; may be revisited later.
- **Typography/spacing baseline:** per-property `clamp()` — each font-size,
  spacing, and sizing declaration gets its own `clamp(min, preferred, max)`
  tuned individually, rather than a single fluid root `font-size` or a
  shared token scale. Chosen because most of this app's ~2,000 `px` values
  are position/spacing (e.g. `top: 2058px`), not font sizes, so a
  root-font-size trick alone wouldn't cover them, and per-property tuning
  gives the most control over how each element scales. Keep each clamp's
  preferred term in `rem` so it still respects user browser font-size
  settings.
- **Accessibility target:** considered now, as each module is converted —
  not deferred to a later pass.
- **Browser support:** modern evergreen browsers only — current + previous
  major version of Chrome, Edge, Firefox, Safari (desktop and mobile). No
  IE11/legacy Edge. This matches the minimal-complexity goal: `clamp()`,
  container queries, `ResizeObserver`, and CSS Grid are all natively
  supported on that matrix with no polyfills needed, and dropping
  kiosk/Electron removes any legacy embedded-browser constraint.
- **Testing approach:** manual resize/viewport checks for now; no automated
  visual-regression or viewport test matrix in this phase.

**Breakpoint strategy: fluid CSS first, few content-driven breakpoints.**

- Fluid CSS (tokens + `clamp()`-based spacing/type/sizing) is the default
  mechanism everywhere. Most of what would traditionally need a breakpoint
  (font sizes, gaps, padding, image sizing) should just scale continuously
  instead of needing a rule at every device width — this keeps the breakpoint
  count, and the long-term maintenance burden, down.
- Breakpoints are the exception, not the default. Reject guessed
  device-width breakpoints (phone/tablet/desktop pixel buckets) in favor of
  content-driven ones: add a breakpoint only where a specific module's
  layout demonstrably breaks (e.g. a two-column scene needs to stack to one
  column, a carousel needs to switch from row to grid), discovered by
  testing that module, not decided up front.
- A small set of *shared* structural breakpoints belongs in the shell
  (header/menu/carousel — Phase 2) for things like touch-target sizing and
  nav layout. Each of the 9 modules is otherwise free to add its own
  breakpoint(s) only where its own content requires it — modules have very
  different content (3D scenes, carousels, dial interactions), so a single
  shared breakpoint set for all of them would be the wrong fit.
- Prefer container queries over viewport media queries where a module's
  internal layout should react to its own box rather than the full
  viewport, since modules render inside a shared host and may not always
  occupy the full window.

### Phase 1 — Foundation ✅ done

- Remove the fixed-canvas scale entirely: `#viewport-shell` / `#kiosk-stage`
  become normal in-flow containers (`width: 100%`, no `transform: scale`);
  delete `StageScaler` / `--stage-scale` outright rather than keeping a
  fallback.
- Remove `electron/`, kiosk packaging scripts, `config/kiosk.config.json`,
  and the kiosk-only settings UI (Top/Center layout toggle) as part of this
  same pass, since they only exist to serve the fixed-canvas/kiosk model.
- Introduce a token layer for fluid values: `clamp()`-based spacing/type
  scale in `tokens.css` replacing literal px, plus real breakpoints
  (container queries where a module's internal layout should adapt
  independent of viewport).
- Add a `ResizeObserver`-based sizing utility to replace design-canvas math
  in the three.js modules (canvas/camera aspect recalculated from its actual
  container, not a fixed 2160x3840 assumption).

> **Note:** the Electron shell/packaging removal itself was deferred (large,
> separate blast radius) — `electron/main.cjs`/`preload.cjs`,
> `config/kiosk.config.json`, and packaging scripts are still present.
> `window.kiosk` is `undefined` in a plain browser, so this doesn't block
> anything; it's tracked as its own future cleanup, not part of the
> responsive layout work.

### Phase 2 — Shell first ✅ done

Convert `base.css`, `app.css` (headers, screen shell, menu/carousel, settings
panel) to Grid/Flexbox reflow layouts. This is shared by every module, so
getting it right unblocks everything else and is the best place to validate
the new pattern.

All shell chrome (header/brand/CTA, attract screen, settings popover, touch
hints, module header band, 1-2-3 sub-nav, up-next popup, concept/placeholder
module view, dev HUD, screen transitions) is converted to fluid `clamp()`
sizing. The module carousel — deferred here into Phase 3 because of its
coupling to 3D camera/composition code — is also done (see below).

### Phase 3 — Module-by-module migration (carousel done, per-module CSS not started)

Tackle smallest to largest so the pattern is proven before the big ones:

1. `quantum-platform` (422 lines)
2. `states-of-matter`
3. `qubit-explorer`
4. `measurement-based`
5. `build-nanowire`
6. `nanoscale`
7. `protecting-information`
8. `quantum-vs-classical`
9. `build-majorana-2` (largest, do last)

Each module: rework CSS to fluid/reflowing layout, then adjust its JS/canvas
sizing to match.

**Done so far:** the shared module carousel (`.module-carousel`,
`.module-card` and children in `app.css`) is fully converted — fixed
2460px/2160px/1200px sizing replaced with `flex:1`, a content-safe fluid
card width, `aspect-ratio: 9/5` on the visual, and a container-query-driven
gap that pushes neighbouring cards off-screen so only the active card and
nav arrows are visible. The 3D camera/render pipeline
(`module-navigation-projection.js`, `shape-scene-3d.js`,
`module-carousel.js`) turned out to already be aspect/DOM-size-driven, not
canvas-pixel-driven, so it needed no changes.

**Not started:** each of the 9 modules' own CSS files still hardcode
`width: 2160px` internally and need their own conversion pass, one at a
time in the order above.

### Phase 4 — Interaction/accessibility pass

Add hover/focus states, keyboard navigation, pointer-type detection (touch
vs mouse) now that this targets arbitrary browsers, not just a touchscreen.

### Phase 5 — Cross-device QA

Test at real breakpoints (not just resizing a window) — phone, tablet,
laptop, ultrawide — plus orientation change, since portrait-only assumptions
are baked in throughout.

## Nice-to-haves (stretch, not required for the core refactor)

- **Deep-linking URLs** — the app currently has no URL/history integration;
  screens are pure in-memory state (`ScreenRouter.show()` in
  `screen-router.js`) with only a dev-only `sessionStorage` restore hack
  (`rememberDevelopmentView`/`restoreDevelopmentView` in `app.js`). Add a
  small hash-based router (`#/menu`, `#/module/<id>`) that:
  - Parses `location.hash` on load and calls `openMenu()`/`openModule(id)`
    accordingly (falling back to attract for anything invalid).
  - Calls `history.pushState`/`replaceState` at the existing `openMenu()`,
    `openModule()`, `goHome()` call sites to keep the URL in sync.
  - Listens for `popstate`/`hashchange` for back/forward and pasted-URL
    support while the app is already running.
  - Adds a "cold open" path for modules opened directly via URL, since the
    normal open plays a portal animation from the module's carousel card,
    which doesn't exist when there's no prior screen to animate from.
  - Replaces (rather than runs alongside) the existing sessionStorage
    dev-restore hack, to keep this to one mechanism.
  Estimated effort: half a day to a day. Not blocking any other phase; can
  be picked up whenever, ideally after Phase 3 so module IDs/screens are
  stable.

## Suggested starting point

Start with **Phase 0** (a quick breakpoint/target decision) and then
**Phase 1 + Phase 2** as a first PR, since that's the shared foundation
everything else depends on.

## Addendum: media asset size audit (not yet scheduled as a phase)

A scan of `public/assets/` (270 MB across 197 files, copied into `dist`
as-is — `vite.config.js` has no image/video/model optimization step) found
sizable, low-risk wins that are independent of the layout work above and
can be picked up whenever, but are worth tracking alongside it since a
fluid/responsive layout makes oversized fixed-resolution assets even more
wasteful on smaller viewports:

- **PNGs are the single biggest category (78.5 MB / 53 files)** and the
  worst offenders are raw, uncompressed 4096px-wide photographic images
  served as PNG instead of WebP/AVIF, several multiples larger than their
  rendered size:
  - `majorana-schematic-backdrop.png` — 4096×4096, 17 MB
  - `salt-background.png` — 4096×2788, 6.9 MB
  - `majorana-intro-hero.png` — 3090×2482, 6.6 MB (HTML only requests
    `width="1500"`)
  - `red-blood-cell-background.png` — 4096×2487, 5.5 MB
  - `menu-preview.png` — 3735×2535, 4.4 MB
  - `guitar-cutout.png`, `salt-cutout.png`, `som-condensation-overlay.png`,
    `nanoscale.png` — 2.9–4.1 MB each
  - Re-encoding these as WebP/AVIF at display-appropriate dimensions could
    plausibly take this category from ~78 MB to ~10-15 MB.
- **Inconsistent GLB compression.** `protecting-information` already ships
  a meshopt decoder and uses it for one model, but its two largest models
  aren't compressed at all: `protect-gold-topplate.glb` (10.9 MB) and
  `protect-gold-plate.glb` (7.8 MB). `Ice+Cube.glb` (states-of-matter, 6.9
  MB) is likewise uncompressed. Running these through the same
  meshopt/draco pipeline already used elsewhere (`majorana-2.glb`,
  `m2_glb_full_chandelier.web.glb`) is close to a free win.
- **Video.** `SoM_IceCube_4k_vertical.mp4` is 41 MB at full 4K resolution;
  almost certainly displayed smaller. Re-encoding at actual display
  resolution and/or a tighter bitrate (or converting to WebM/AV1) could
  save tens of MB.

This is scoped as asset re-encoding/compression only — no markup or CSS
changes are implied beyond swapping file references, so it can be done in
parallel with, or independent of, the phases above.
