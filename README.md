# IQM Interactive Kiosk

Application scaffold for the IQM touchscreen experience described in the Microsoft Quantum module brief.

The project deliberately reuses the reliable platform choices from the previous Quantum Kiosk—Electron, Vite and a fixed portrait design canvas—without copying its content, assets or tightly coupled interaction code.

## Target hardware

- 55-inch Elo 4K PCAP touchscreen
- Portrait output: 2160 × 3840
- Windows 11 Enterprise
- Offline-first runtime

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Start developing

```bash
nvm use
npm install
npm run dev
```

Development mode opens a resizable 9:16 Electron window. The UI is always laid out on a logical 2160 × 3840 canvas and scaled to fit the window, so the same coordinates are used in development and on the physical kiosk.

## Useful commands

```bash
npm run dev             # Vite + resizable Electron development window
npm run build           # Syntax checks and renderer build
npm run preview         # Built renderer in a safe window
npm run preview:kiosk   # Local fullscreen preview; Ctrl+Shift+Q exits
npm run package:win     # Production Windows NSIS installer (fullscreen kiosk)
npm run package:win:review # Portable Windows EXE (windowed 9:16 review build)
```

`package:win:review` creates a single, no-install EXE in `build/review/`. It
opens the production renderer in a resizable window on the primary display,
keeps the 2160 × 3840 (9:16) aspect ratio and uses the ten-minute review idle
timeout. The normal close button and Escape navigation remain available.

`package:win` (or the explicit alias `package:win:kiosk`) creates the client
NSIS installer. Its installed application starts fullscreen in Electron kiosk
mode by default. The review EXE can still be forced fullscreen with `--kiosk`,
and the production EXE can be manually opened with `--windowed` when needed.

Build and smoke-test the final artifacts on Windows. An unsigned internal build
can trigger Microsoft Defender SmartScreen; client-facing distribution should
use an Authenticode signing certificate. Electron fullscreen is only the
application layer—Windows 11 Enterprise must also be configured with Shell
Launcher and the relevant lockdown policies before deployment. See
[docs/WINDOWS-KIOSK-SETUP.md](docs/WINDOWS-KIOSK-SETUP.md).

The ready-to-copy Windows deployment kit lives in `deployment/windows/`.
`INSTALL-KIOSK.cmd` enables the required Enterprise features and applies Shell
Launcher v2, automatic sign-in, edge-swipe lockdown, Keyboard Filter and
event-safe power settings. `CHECK-KIOSK.cmd` verifies the result and
`DISABLE-KIOSK.cmd` returns the machine to technician service mode. No Node.js
installation or manual PowerShell commands are needed on the kiosk PC.

## Current implementation

The renderer already provides:

- an attract screen;
- a menu generated from the seven built modules in the IQM brief;
- a real lazy-loaded module host with abortable lifecycle and recoverable errors;
- Module 03, **States of Matter**, using the supplied 300-frame 4K video with
  full-screen touch scrubbing, timeline scrubbing and Solid/Liquid/Gas copy;
- Module 05, **Protecting quantum information**, using the supplied 3D device
  with three independent parameter dials, runtime electron behavior and a
  protected-state success sequence;
- Module 07, **Build a Majorana 2**, using the supplied 3D model and HDR lighting
  for Components, Pathways and a validated two-part drag-and-drop build;
- home and back navigation;
- an idle timeout that returns to the attract screen;
- touch-safe defaults and blocked browser gestures;
- fixed-canvas scaling for the 4K portrait display;
- a settings cog in the bottom-right corner holding the volume slider and a
  Top / Center switch for how the module menu is laid out;
- a small development HUD showing the active scale, off unless
  `development.showHud` is switched on.

The attract screen and module menu remain structural UI. All seven registered
modules are lazy-loaded interactive experiences; Modules 03, 05 and 07 use their
supplied reference media and production 3D assets. Module 08, "From quantum
signal to readout", has been dropped from the carousel — it never received design
or production assets, and shipping it as a concept placeholder ended the menu on
an unexplained abstract sphere.

## Project structure

```text
config/
  kiosk.config.json       Runtime display, canvas and timeout settings
electron/
  main.cjs                Window lifecycle, display selection and recovery
  preload.cjs             Read-only runtime bridge for the renderer
src/
  index.html              Three top-level application screens
  js/
    app.js                Application orchestration
    core/                 Scaling, navigation and idle management
    modules/              Registry plus isolated module implementations
  styles/                 Design tokens, reset and application shell
public/assets/             Local video, 3D, HDR and exported Figma UI assets
scripts/                   Validation and reproducible GLB optimization
deployment/windows/        Double-click Windows production and recovery tools
docs/                     Deployment and architecture notes
```

## Module lifecycle

Each interactive module is registered in `src/js/modules/module-registry.js` and
exports the same small boundary:

```js
export function mount(container, { signal, onActivity, navigate }) {
  // Create the interaction and bind abortable listeners.
  return () => {
    // Stop media/RAF, release WebGL and remove listeners.
  }
}
```

Give every new interaction its own directory:

```text
src/js/modules/build-nanowire/
  index.js
  styles.css
  assets/
```

Keep state and cleanup inside the module. Large Three.js scenes and assets are
loaded only when the user opens the relevant experience.

See [docs/ASSET-PRODUCTION-NOTES.md](docs/ASSET-PRODUCTION-NOTES.md) before
replacing the optimized Majorana asset or preparing the Windows package.

## Runtime configuration

Edit `config/kiosk.config.json` to change:

- the logical design resolution;
- preferred display label or index;
- development window size;
- whether the development HUD is drawn (`development.showHud`, off by default);
- development and production idle timeouts;
- the Electron window background.

For multi-display staging, environment overrides are also supported:

- `KIOSK_DISPLAY_ID`
- `KIOSK_DISPLAY_INDEX`
- `KIOSK_DISPLAY_LABEL`
