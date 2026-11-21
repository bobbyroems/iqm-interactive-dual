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
npm run check:feedback  # Build + browser/Electron feedback integration checks
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
- an optional visitor-feedback add-on with a 1–5-star modal, local records and
  operator export controls;
- a small development HUD showing the active scale, off unless
  `development.showHud` is switched on.

The attract screen and module menu remain structural UI. All seven registered
modules are lazy-loaded interactive experiences; Modules 03, 05 and 07 use their
supplied reference media and production 3D assets. Module 08, "From quantum
signal to readout", has been dropped from the carousel — it never received design
or production assets, and shipping it as a concept placeholder ended the menu on
an unexplained abstract sphere.

## Visitor feedback

The menu's **Give feedback** button opens a touch-friendly, keyboard-accessible
modal with a required 1–5-star rating, a rating guide and bottom-aligned
**Not now** / **Send feedback** actions. No names, contact details, quick reasons
or written comments are collected.
**Send feedback** immediately closes the modal. A snackbar at the bottom of the
viewport shows saving progress, then confirms success for four seconds once the
IndexedDB transaction commits. A storage failure instead leaves an error snackbar
with **Retry**, preserving the submitted rating without reopening the modal.
Tapping the background overlay also dismisses the modal without submitting.

Automatic feedback is enabled by default. After 60 seconds within a visitor
session, the next deliberate return from a module to the menu offers the modal.
It never interrupts a module or appears on an idle return. Opening the modal
(including using **Not now**, Escape or the background overlay) suppresses further automatic offers for
that session. The manual button remains available. Returning to the attract/start
screen, either by Exit or inactivity, starts a fresh session. An abandoned modal
uses the normal menu idle timeout and is dismissed when returning to the start.
Returning to the start also clears snackbars and any failed response awaiting
retry, so a later visitor does not inherit the previous visitor's notification.

In the settings cog, scroll to **Visitor feedback** to:

- enable/disable both the button and automatic offers;
- adjust the delay from 0 to 600 seconds (0 means the first module return);
- view response count and average rating;
- export CSV as a browser download (`iqm-feedback.csv`);
- clear saved responses after a separate confirmation (preferences are retained).

These controls use the existing settings surface, not an authenticated admin area.
CSV exports remain wherever the operator saves them; clearing kiosk data does not
delete previously exported files.

Records and preferences use the `iqm-feedback` IndexedDB database, version 1,
in both regular browsers and Electron. There is no feedback filesystem or IPC
dependency. Each record contains a generated ID, timestamp in UTC, star rating,
reason IDs (empty for new responses), current/most recently visited module ID
(or `null`) and the app version built from `package.json`.

Data survives reloads and restarts within the same site origin and browser
profile. Different protocols, hosts, ports, browsers or profiles have separate
databases. For example, a Vite server changing ports starts with separate feedback,
and Electron's packaged `iqm-app` origin does not share data with a browser.
Clearing site data, deleting a profile, private-browsing cleanup or browser storage
eviction can remove records. There is no application-level expiration; export CSV
regularly for a durable backup. Keep the same URL and profile for ongoing collection.
Browser download settings determine where CSV files are saved.

Read/write transactions serialize concurrent updates, including from separate
tabs, and success is reported only after commit. Quota, blocked-storage and
damaged-data errors are surfaced, not silently replaced with empty feedback.
If browser storage is unavailable, settings offers **Retry storage**.

Old Electron `feedback/feedback.json` files are no longer read, written or
automatically imported. Existing files are left untouched. Export from the older
application first if those responses need to be retained; the new database starts
fresh. The `reasons` CSV column remains compatible with existing exports.

The add-on does not upload feedback. The existing app-wide Clarity integration
remains separate; the feedback modal, snackbar and settings content are marked
for masking. Browser previews and Electron use the same feedback code.

### Extension points

- `src/js/addons/feedback/index.js` owns the modal and operator UI, exposing
  `onScreen`, `close`, `isOpen` and `dispose`, with an injectable storage API.
- `src/js/addons/feedback/session.js` owns the independently tested prompt policy.
- `src/js/addons/feedback/storage.js` owns IndexedDB version 1, validation,
  statistics and CSV formatting.
  Changes to persisted record shape should include an explicit schema migration.
- Navigation in `KioskApp` only sends screen/module context. CSV downloading and
  confirmed clearing use standard browser APIs.

`npm run check:feedback` exercises real Chromium IndexedDB on an HTTP browser page
with no preload and on the packaged Electron protocol. It checks concurrent and
aborted writes, damaged-data protection, reload persistence, the modal/snackbar,
save failure and retry, session/idle behavior, CSV downloads and confirmed clearing.
All browser profiles and downloads are temporary and cleaned up after Electron
exits. It does not touch the installed kiosk's records or the user's browser data.

## Analytics

The renderer loads Microsoft Clarity project `yq1mx1084q` through the local
`src/js/clarity.js` module. Analytics requires internet access; a failed script
load logs a warning without blocking the offline-first kiosk.

The CSP permits HTTPS scripts from `*.clarity.ms` and connections/images from
`*.clarity.ms` and `c.bing.com`, covering Clarity's load-balanced endpoints.
It does not permit inline scripts or broaden `default-src`. See
[Clarity's CSP requirements](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp).

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
