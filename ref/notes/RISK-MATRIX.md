# IQM Interactive Kiosk Risk Matrix

| Priority | Risk | Evidence | Impact | Recommended mitigation |
| --- | --- | --- | --- | --- |
| High | Dependency resolution and release builds are not reproducible. | `package.json` uses version ranges and no committed lockfile is present. The repository's `main` branch has no commits. | A future install can resolve different transitive packages, and there is no stable source baseline or rollback point. | Commit a reviewed lockfile, use `npm ci` in CI and release builds, and create an initial source-control baseline. |
| Medium | The Majorana portal transition may allocate a new menu preview while the full Majorana experience is still active. | `src/js/app.js` re-invokes `ensureMajoranaMenuPreview()` in `openMajoranaWithPortal()`'s `finally` block, including after a preview scene has been transferred to the active module. | Two Three.js scenes can overlap during a resource-intensive 4K experience, increasing GPU memory and compositor pressure. | Defer menu-preview recreation until the menu is shown, or measure the transition on target hardware and retain it only if it fits the GPU budget. |
| Medium | Production delivery has a large media footprint. | `public/assets/` contains 197 files totaling approximately 371 MB, including 4K video and 3D assets. | Installer size, download time, installation time, and antivirus scanning delays may affect field deployment. | Track packaged installer size in release acceptance, test installation on representative kiosk hardware, and continue validating packaged media assets. |
| Medium | End-to-end kiosk flows have less automated coverage than module logic. | The Node test suite exercises protocol, packaging, graphics, media cleanup, and module state machines, but not browser/Electron journeys driven through `KioskApp`. | DOM timing, idle resets, portal failure recovery, and repeated navigation could regress without being detected by unit tests. | Add a browser or Electron smoke flow covering attract, menu, every playable module, home, idle return, and recovery from a failed module load. |
| Low | Documentation describes playable module counts inconsistently. | `README.md` and `HANDOFF.md` describe the module set differently, while `src/js/modules/module-registry.js` defines eight slots with module 07 as a placeholder. | Reviewers and deployment teams may misunderstand the current shipped scope. | Standardize documentation on: eight carousel slots, seven playable experiences, and one in-production placeholder. |

## Confirmed controls

- Electron renderer isolation is enabled through sandboxing, context isolation, and disabled Node integration.
- External window opening, renderer navigation, and permission requests are denied.
- The `iqm-app` protocol enforces renderer-root path containment and supports byte-range media requests.
- Module lifecycle and media cleanup are covered by targeted automated tests.
- Automated validation passes: 150 tests, syntax validation of 128 source files, Nanoscale camera validation, and required-media validation.
