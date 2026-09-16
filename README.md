# IQM Interactive Kiosk

Application scaffold for the IQM touchscreen experience described in the Microsoft Quantum module brief.

The project deliberately reuses the reliable platform choices from the previous Quantum Kiosk—Electron, Vite and a fixed portrait design canvas—without copying its content, assets or tightly coupled interaction code.

## Target hardware

- 55-inch Elo 4K PCAP touchscreen
- Portrait output: 2160 × 3840
- Windows 11 Enterprise, or Windows Pro for a supervised event session
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

Development mode opens a resizable 9:16 Electron window. It starts at port 5173 and automatically advances to the next available port when that port is occupied. The UI is always laid out on a logical 2160 × 3840 canvas and scaled to fit the window, so the same coordinates are used in development and on the physical kiosk.

## Useful commands

```bash
npm run dev             # Vite + resizable Electron development window
npm run build           # Syntax checks and renderer build
npm run preview         # Built renderer in a safe window
npm run preview:kiosk   # Local fullscreen preview; Ctrl+Shift+Q exits
npm run package:win     # Production Windows NSIS application installer
npm run package:win:kiosk # Complete client ZIP with one-click install/update
npm run package:win:pro # Windows Pro event ZIP: fullscreen + Explorer/session control
npm run package:win:review # Portable Windows EXE (windowed 9:16 review build)
```

`package:win:review` creates a single, no-install EXE in `build/review/`. It
opens the production renderer in a resizable window on the primary display,
keeps the 2160 × 3840 (9:16) aspect ratio and uses ten-minute review idle
timeouts for both return stages. The normal close button and Escape navigation
remain available.

`package:win` creates the raw NSIS application installer.
`package:win:pro` creates `build/pro-event/IQM-Kiosk-Windows-Pro-Event-<version>-x64.zip`.
Extract it, run `01-CONFIGURE-WINDOWS.cmd`, restart Windows, and run
`02-START-KIOSK.cmd` normally. It opens the full-screen app, stops Explorer in
that session, filters common desktop shortcuts and restores Explorer on service
exit (Ctrl+Shift+Q followed by the PIN set during Configure). App exits trigger
relaunches; repeated failures or supervisor failure leave the recovery screen.
The Pro setup has its own reversible settings backup and does not use Shell Launcher, create accounts or auto-logon.
See [the Polish operator instructions](deployment/windows-pro/README.txt) and
[the implementation and validation notes](docs/WINDOWS-PRO-EVENT-SETUP.md).

`package:win:kiosk` additionally creates a transferable production ZIP with
top-level install/update and full-removal launchers. `START-IQM-KIOSK-SETUP.cmd`
handles clean installation, recoverable updates, smoke testing and Windows kiosk
verification. `UNINSTALL-IQM-KIOSK.cmd` restores the captured pre-deployment
Windows state and moves the installed application into a protected recovery
archive. The installed application starts in Electron kiosk mode by default. The review EXE can still
be forced fullscreen with `--kiosk`, and the production EXE can be manually
opened with `--windowed` when needed.

Client-kit packaging refuses a dirty Git working tree. Use
`package:win:kiosk-kit:test` only to exercise the installer workflow locally
before its source changes are committed.

Build and smoke-test the final artifacts on Windows. An unsigned internal build
can trigger Microsoft Defender SmartScreen; client-facing distribution should
use an Authenticode signing certificate. Electron fullscreen is only the
application layer—Windows 11 Enterprise must also be configured with Shell
Launcher and the relevant lockdown policies before deployment. See
[docs/WINDOWS-KIOSK-SETUP.md](docs/WINDOWS-KIOSK-SETUP.md).

The source for the generated Windows deployment kit lives in
`deployment/windows/`. Its support tools enable Shell Launcher v2, automatic
sign-in, edge-swipe lockdown, Keyboard Filter and event-safe power settings.
No Node.js installation, Git checkout or manual PowerShell commands are needed
on the kiosk PC.

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
- a two-stage idle return that moves an abandoned module to the menu, then the
  menu to the attract screen;
- touch-safe defaults and blocked browser gestures;
- fixed-canvas scaling for the 4K portrait display;
- a settings cog in the bottom-right corner holding volume, menu layout, up-next
  visibility and persisted module/menu idle-return controls;
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
- development and production module-to-menu (`idleReturnToMenuMs`) and
  menu-to-home (`idleReturnToHomeMs`) timeouts;
- the Electron window background.

For multi-display staging, environment overrides are also supported:

- `KIOSK_DISPLAY_ID`
- `KIOSK_DISPLAY_INDEX`
- `KIOSK_DISPLAY_LABEL`
