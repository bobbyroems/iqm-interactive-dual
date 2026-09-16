# IQM Interactive Kiosk — source handoff

Everything here is the front end of the kiosk experience. It is a Vite project
in plain JavaScript, CSS and three.js. There is no framework, no TypeScript and
no build step beyond Vite.

Package version 2.0.1. Exported from the kiosk repository at revision
`8f3d535`.

## Running it in a browser

The experience is ordinary web code. Electron is only the shell that puts it on
a kiosk screen — you do not need it to run or port anything.

    npm install
    npx vite                # serves on http://127.0.0.1:5173

Open that URL in Chrome. The whole thing runs: all nine modules, the 3D scenes,
the video scrubbing. This is how the build was developed and reviewed.

`npm run dev` also exists, but it launches Electron alongside Vite.

## The one thing that will catch you out

**The stage is a fixed 2160 x 3840 design canvas, scaled with a CSS transform.**

Every coordinate in the CSS and the layout modules is a *design pixel* on that
canvas, taken from Figma. Nothing is responsive in the usual sense — the stage is
scaled to fit whatever viewport it lands in, and the internal geometry never
changes. `src/js/core/stage-scaler.js` sets the `--stage-scale` custom property, and
`src/styles/app.css` applies it to the stage transform.

If you are translating this to a responsive web layout, this is the assumption to
unpick first. It is why you will see values like `top: 2058px` throughout.

## Layout

    src/js/core/          shared machinery: stage scaling, tooltips, explainers,
                          the 3D carousel, asset URL resolution, settings
    src/js/modules/       one folder per module, numbered 01-09 in
                          module-registry.js. Each exports mount().
    src/styles/           global CSS. Per-module CSS lives with the module.
    public/assets/        all media, addressed by the paths in the modules
    test/                 node:test unit tests - `npm test`. No DOM, they cover
                          the geometry, timing and state machines.
    scripts/              asset verification used by the npm scripts
    playground/, ref/     standalone prototypes several modules were ported
                          from. Code comments reference these by path.

Module registry order and titles: `src/js/modules/module-registry.js`. All nine
slots now carry a `load`, so every card opens. (Earlier drops of this package
shipped eight modules with slot 07 as an unopenable placeholder; that slot is
now the "Computing with topological qubits" module.)

Each module declares a `scheme` of `teal`, `blue` or `purple`. That selects the
band gradient via `data-module-scheme` on `.module-host`; the three gradients are
defined once in `tokens.css`. Do not hardcode a band colour per module.

## Media notes

- **Video scrubbing needs HTTP byte ranges.** Module 02 scrubs a 4K clip by
  seeking it frame by frame. A static host that ignores `Range` and answers 200
  with the whole file will make the video look frozen — the seeks clamp to zero.
  Any normal static host (nginx, S3+CloudFront, Vite's dev server) is fine;
  Python's `http.server` is not.
- **One model is Draco-compressed** (`public/assets/m2_glb_full_chandelier.web.glb`)
  and needs the decoder in `public/assets/draco/`. Decoding is WebAssembly, so a
  restrictive `script-src` CSP must include `'wasm-unsafe-eval'` or the decode
  hangs silently inside its worker.
- Some textures are WebP and some models carry `EXT_texture_webp`.

## What was removed from this package

- `node_modules/`, `dist/`, `build/` — generated
- Windows kiosk provisioning and setup docs — not relevant to web. This covers
  `deployment/`, `docs/WINDOWS-KIOSK-SETUP.md` and the Windows 11 Pro event kit
  (`docs/WINDOWS-PRO-EVENT-SETUP.md`), along with the packaging scripts that
  read them (`package-production-kit.mjs`, `package-pro-kit.mjs`,
  `electron-builder-pro.cjs`) and the tests that exercise them. The matching
  `package:win:kiosk*` and `package:win:pro` npm scripts are gone from the
  manifest; `package:win`, `package:win:review` and `package:win:dir` remain.
- The `quantum-model-debug.html` material study page and the ~27 MB of FBX/OBJ
  source art only it used. The model it studied was replaced by a glTF.
- The vendored `threejs-water-pro` workspace. Nothing in `src/` imports it and
  it does not reach the bundle - module 01's interference water is its own
  shader code in `interference-water.js`. Because `package.json` still declared
  it as a workspace and two scripts built it, the manifest in this package has
  been trimmed accordingly: `workspaces`, `build:water` and `predev` are gone,
  and `prebuild:renderer` now only runs the asset check.
- `pnpm-lock.yaml` and `pnpm-workspace.yaml`, which describe the full repository
  including the workspace above. Unlike earlier drops, this package *does* carry
  a `package-lock.json`, generated from the trimmed manifest, so `npm ci` works.
- `AGENTS.md`, which is repository contribution guidance rather than source.

## Requirements

Node 22 (see `.nvmrc`). WebGL2. Targets Chromium; not tested elsewhere.

## Verified before handoff

    npm install     503 packages, no workspace needed
    npm test        39/39 pass
    npx vite build  succeeds
