# Architecture decisions

## What was carried over

The previous Quantum Kiosk proved that Electron, Vite and vanilla web graphics can deliver the required 4K touchscreen experience. This scaffold keeps those foundations and the portrait development-window workflow.

## What was intentionally not carried over

The previous renderer grew around three fixed content sections and imported its animation and 3D systems up front. The IQM brief contains eight independent interactions with different mechanics, so copying that structure would create unnecessary coupling and longer startup times.

The new shell therefore uses:

- one small application controller;
- an inventory-driven module menu;
- independent future module directories;
- lazy loading as the intended pattern for 3D and large assets;
- one fixed logical coordinate system across development and production;
- a JSON runtime configuration instead of build-time source edits.

## Canvas and window model

The renderer always uses a logical canvas of 2160 × 3840. `StageScaler` calculates the largest scale that fits inside the available browser area. A 540 × 960 development window therefore renders the exact same layout at 25%.

Electron has three practical modes:

- `--dev`: windowed, connected to Vite and safe to resize;
- `--windowed`: built renderer in a normal window;
- packaged/no flag or `--kiosk`: fullscreen production behavior.

Windows packaging exposes these modes as two deliberately separate artifacts:

- `package:win:review`: a portable EXE with `windowed` stored as its packaged
  default, intended for frictionless review without installation;
- `package:win`: the production NSIS application installer with `kiosk` stored
  as its packaged default;
- `package:win:kiosk`: the same installer wrapped in a versioned production kit
  with client-facing install/update and recoverable full-removal launchers.

Explicit `--windowed` and `--kiosk` flags override the packaged default. No
source file is rewritten between flavors, so an interrupted build cannot leave
the next artifact in the wrong launch mode.

The operating-system kiosk lockdown remains separate. Electron owns the application window; Windows 11 Enterprise owns edge gestures, shell replacement, automatic sign-in and keyboard filtering.

Full removal reverses that ownership boundary in the safe order: Windows shell
replacement and input lockdown are removed first, captured machine policy and
power state are restored next, and only then are the managed account and
application registration removed. Application and deployment files are moved
to an administrator-only archive so a failed field operation remains recoverable.

## Module boundary

Each implemented interaction exposes a minimal lifecycle:

```js
export function mount(container, { signal, onActivity, navigate }) {
  // Create the module and attach abortable listeners.
  return () => {
    // Stop render loops, release WebGL resources and remove listeners.
  }
}
```

`ModuleHost` lazy-loads one module at a time, supplies an `AbortSignal`, and runs
the returned disposer on Menu, Home, idle return, retry or replacement. A stale
dynamic import cannot mount after navigation. Only the active module can hold
media, animation loops or GPU resources.

## Offline asset URLs

Vite builds with a relative base. Runtime asset paths go through `assetUrl()`,
which resolves beside `document.baseURI` in both development HTTP and packaged
Electron `file://` mode. Large module media is copied from `public/` and unpacked
from ASAR so Chromium can stream video and fetch GLB/HDR data normally.

Module styles are linked from the document rather than injected by Vite. This
keeps the development window compatible with the same strict CSP used by the
packaged kiosk.
