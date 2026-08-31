# IQM Interactive Kiosk → Dual-Platform Refactoring

Complete design breakdown and task roadmap for converting the Electron kiosk to a shared core + dual-platform (kiosk + web) architecture.

---

## Design Decisions (Grilling Results)

### Initial Scope (Q1–Q8)
| Q | Decision | Answer |
|---|----------|--------|
| **Q1** | Target audience | Web + mobile (not kiosk) |
| **Q2** | Responsive strategy | Adapt layout to viewport (not fixed canvas) |
| **Q3** | Offline capability | Online-only |
| **Q4** | Kiosk mode features | Let Windows/browser handle |
| **Q5** | Electron vs. web stack | Pure web (no Electron) |
| **Q6** | Asset optimization | Same assets everywhere (no mobile variants) |
| **Q7** | Config management | Environment-based at build time |
| **Q8** | Offline capability (clarified) | Online-only |

### Architecture & Features (Q9–Q30)
| Q | Decision | Answer |
|---|----------|--------|
| **Q9** | Module adaptation | One layout per module (internal viewport detection) |
| **Q10** | 3D on mobile | Simplify on mobile (later optimized: keep full complexity for now) |
| **Q11** | Video scrubbing | Lower-res mobile variant (later revised: same assets everywhere) |
| **Q12** | Design canvas | Full removal (no fixed 2160×3840) |
| **Q13** | URL routing | Add URL routing (`/module/:id`) |
| **Q14** | Desktop interaction | Touch + mouse/pointer events |
| **Q15** | Asset loading | Asset proxy/loader system |
| **Q16** | CSS architecture | Keep current structure (global + per-module) |
| **Q17** | State management | Simple routing + localStorage |
| **Q18** | Deployment | Static hosting (Vercel/Netlify) |
| **Q19** | Refactoring order | Attract screen + menu first |
| **Q20** | Testing strategy | Vitest + jsdom |
| **Q21** | Framework | Vanilla + router library |
| **Q22** | Idle timeout | Remove it |
| **Q23** | Settings panel | Simplify (remove volume) |
| **Q24** | Module 01 shader | Keep full complexity for now |
| **Q25** | Error recovery | Error UI + refresh button |
| **Q26** | Build tool | Keep Vite |
| **Q27** | Viewport breakpoints | Simple: 768px threshold |
| **Q28** | Module lazy loading | Keep lazy loading |
| **Q29** | Browser support | Modern only (ES2020+) |
| **Q30** | Analytics/telemetry | No tracking initially |

### Repeatability & Dual-Platform (Q31–Q43)
| Q | Decision | Answer |
|---|----------|--------|
| **Q31** | Single repo vs. dual repos | Single repo |
| **Q32** | Source of truth | Shared core (modules + utilities) |
| **Q33** | Branch strategy | Single main branch |
| **Q34** | Asset versioning | Shared in repo (`public/assets/`) |
| **Q35** | Testing matrix | Shared unit tests + platform integration tests |
| **Q36** | Shared core scope | Modules + core utilities |
| **Q37** | Configuration | Platform-specific configs |
| **Q38** | Build architecture | Dual build scripts |
| **Q39** | Git workflow | Feature branches require both tests pass |
| **Q40** | Breaking changes | Coordinate updates (both platforms) |
| **Q41** | Refactoring order | Refactor kiosk first, then build web |
| **Q42** | Backward compatibility | Feature branch (no production risk) |
| **Q43** | Transition period | Kiosk ships production, web in beta |

---

## Architecture

### Directory Structure

```
src/
  js/
    modules/          ← SHARED (both kiosk & web)
      01-interference-water/
      02-states-of-matter/
      03-majorana-build/
      ...
      module-registry.js
    core/             ← SHARED (both platforms)
      asset-loader.js       (new: centralized asset loading)
      stage-scaler.js       (removed during Phase 0)
      navigation.js         (new: shared navigation state)
      3d-carousel.js
      tooltips.js
  
  index.html          ← SHARED (both platforms)
  
  electron/           ← KIOSK-SPECIFIC
    main.cjs          (window lifecycle, display selection)
    preload.cjs       (Electron bridge)
    graphics-policy.cjs
    app-protocol.cjs
  
  web/                ← WEB-SPECIFIC (added in Phase 2)
    index.js          (Vite entry, routing setup)
    router.js         (navigation wiring)
    layout/           (attract, menu, error UI)

config/
  kiosk.config.json   ← Platform-specific (display, power, idle timeout)
  web.config.json     ← Platform-specific (breakpoints, responsive settings)

public/assets/
  modules/            ← SHARED (video, 3D models, audio)
  
deployment/windows/   ← KIOSK-SPECIFIC (Windows setup scripts)

tests/
  unit/               ← SHARED (Node tests for core logic)
    asset-loader.test.js
    navigation.test.js
  integration/
    kiosk/            ← KIOSK-SPECIFIC (Electron integration)
    web/              ← WEB-SPECIFIC (Vitest + jsdom, Playwright)
```

### Platform Boundary

**SHARED (both platforms):**
- `src/js/modules/*` — All 7 interactive modules (each exports `mount()`)
- `src/js/core/*` — Asset loader, navigation state, 3D utilities, lifecycle
- `public/assets/*` — All media (video, 3D models, audio)
- `src/index.html` — Basic DOM structure (both platforms add wrappers)
- Unit tests in `tests/unit/`

**KIOSK-SPECIFIC:**
- `src/electron/*` — Window management, display selection, preload
- `config/kiosk.config.json` — Display, power, kiosk timeouts
- `deployment/windows/*` — Kiosk provisioning scripts
- Integration tests in `tests/integration/kiosk/`
- Build: `npm run build:kiosk` → NSIS installer or portable EXE

**WEB-SPECIFIC:**
- `src/web/*` — Router, responsive layouts, web lifecycle
- `config/web.config.json` — Breakpoints, responsive settings
- Integration tests in `tests/integration/web/`
- Build: `npm run build:web` → Static `dist/` for Vercel/Netlify

### Build Scripts

```json
{
  "scripts": {
    "dev": "concurrently -k \"vite --host 127.0.0.1\" \"wait-on http://127.0.0.1:5173 && electron . --dev\"",
    "build:kiosk": "npm run check && npm run build:renderer && electron-builder --win nsis --x64",
    "build:web": "npm run check && vite build",
    "build": "npm run build:kiosk && npm run build:web",
    "test": "vitest run",
    "test:kiosk": "vitest run tests/integration/kiosk/",
    "test:web": "vitest run tests/integration/web/ && playwright test",
    "check": "node scripts/check-syntax.mjs && npm run check:assets"
  }
}
```

### Configuration Strategy

**kiosk.config.json:**
```json
{
  "design": { "width": 2160, "height": 3840 },
  "display": { "preferredLabel": "elo", "preferredIndex": null },
  "development": { "windowWidth": 540, "windowHeight": 960, "openDevTools": false, "showHud": false, "idleTimeoutMs": 600000 },
  "kiosk": { "idleTimeoutMs": 60000, "backgroundColor": "#090b1f" }
}
```

**web.config.json:**
```json
{
  "breakpoints": { "mobile": 768 },
  "idleTimeoutMs": null,
  "assetBase": "/assets/"
}
```

---

## Complete Task Breakdown

### Phase 0: Shared Core Abstraction (Foundation)

| Task | Description | Dependencies |
|------|-------------|--------------|
| **phase-0-shared-core-design** | Map what's shared (modules, core utilities) vs platform-specific. Document the boundary between shared and platform logic. | None |
| **phase-0-extract-modules** | All 7 modules in `src/js/modules/`, no platform code inside. Each exports `mount(container, { signal, onActivity, navigate })`. | phase-0-shared-core-design |
| **phase-0-extract-core** | Extract shared logic: asset-loader (new), 3D carousel, tooltip/explainer system, navigation state. Remove Electron-specific code. | phase-0-shared-core-design |
| **phase-0-platform-config** | Split kiosk.config.json → config/kiosk.config.json + config/web.config.json. Define platform-specific fields. | phase-0-shared-core-design |
| **phase-0-dual-build-scripts** | Add `npm run build:kiosk`, `build:web`, `build` (both). Update package.json to support both platforms. | phase-0-shared-core-design |

**Blockers:** None (Phase 0 establishes foundation)

**Estimated effort:** 1–2 sessions

---

### Phase 1: Refactor Kiosk on Shared Core (Prove the abstraction)

| Task | Description | Dependencies |
|------|-------------|--------------|
| **phase-1-kiosk-wrapper** | Restructure `src/electron/` + `src/index.html` to consume shared modules and core utilities. Kiosk becomes thin wrapper. Keep all kiosk features (fullscreen, display selection, power blocking). | phase-0-extract-modules, phase-0-extract-core |
| **phase-1-kiosk-navigation** | Unify kiosk navigation logic (menu → module → back) so shared navigation core can be consumed by both platforms. Move common state to core, leave presentation to wrappers. | phase-1-kiosk-wrapper |
| **phase-1-kiosk-asset-loader** | Wire up `asset-loader.js` so kiosk uses it instead of hardcoded asset paths. Verify all modules load assets via centralized system. | phase-1-kiosk-wrapper, phase-0-dual-build-scripts |
| **phase-1-kiosk-testing** | Add Vitest tests for `asset-loader`, navigation state, viewport detection, module lifecycle. Mock module mount/unmount. Proves shared core works agnostic to platform. | phase-0-extract-core |
| **phase-1-kiosk-validation** | Run refactored kiosk in dev mode. All 7 modules load and work. Navigation flows correctly. Assets load. No regressions vs current kiosk. | phase-1-kiosk-wrapper, phase-1-kiosk-navigation, phase-1-kiosk-asset-loader, phase-1-kiosk-testing |

**Blockers:** Kiosk must pass validation before web work starts (proves shared core is sound)

**Estimated effort:** 2–3 sessions

---

### Phase 2: Build Web on Shared Core (Prove duality)

| Task | Description | Dependencies |
|------|-------------|--------------|
| **phase-2-web-shell** | Create `src/web/` with Vite entry point, router library (page.js or navigo), URL routing (`/module/:id`), localStorage state persistence. No styling yet. | phase-1-kiosk-validation, phase-0-platform-config |
| **phase-2-web-attract-menu** | Responsive HTML/CSS for attract screen and module menu. Works at 768px breakpoint (mobile/desktop). Wire up router to `module/:id` on menu selection. | phase-2-web-shell |
| **phase-2-web-navigation** | Use shared navigation state from `src/js/core/` inside web routing. Back button returns to menu. Router state drives what module loads. | phase-2-web-shell |
| **phase-2-web-responsive-css** | Global CSS reset, utilities, 768px breakpoint. No fixed canvas. Per-module CSS adapted for responsive (flexbox, media queries instead of fixed pixels). | phase-2-web-shell |
| **phase-2-web-module-01** | Module 01 (interference water) detects viewport, renders shader at appropriate size. Works on mobile/desktop. No fixed 2160×3840 assumptions in module code. | phase-2-web-responsive-css, phase-2-web-navigation |
| **phase-2-web-simple-modules** | Adapt Modules 02, 03, 04, 06 to web. Each detects viewport and adapts layout. Video scrubbing, drag-drop, etc. work at any size. Touch + mouse/pointer events. | phase-2-web-module-01 |
| **phase-2-web-testing** | Vitest + jsdom tests for routing, viewport detection, module loading on web. Playwright for critical user flows (attract → menu → module → back) at mobile/desktop sizes. | phase-2-web-simple-modules |

**Blockers:** Web must pass full testing before Phase 3 (mirrors kiosk validation)

**Estimated effort:** 3–4 sessions

---

### Phase 3: Polish Web (Complete feature parity)

| Task | Description | Dependencies |
|------|-------------|--------------|
| **phase-3-complex-modules** | Adapt Modules 05, 07 (complex 3D with full shader complexity) to responsive viewport. Desktop gets full layout, mobile gets scaled view. | phase-2-web-module-01 |
| **phase-3-web-settings** | Build simplified settings panel (remove volume, keep layout toggle if desired). Responsive layout. | phase-2-web-navigation |
| **phase-3-web-error-handling** | Catch unhandled errors, show error message with refresh button. No auto-reload. | phase-2-web-navigation |

**Blockers:** None (Phase 3 tasks parallelizable after Phase 2)

**Estimated effort:** 1–2 sessions

---

### Phase 4: CI/CD & Kiosk Production (Validate both, ship kiosk)

| Task | Description | Dependencies |
|------|-------------|--------------|
| **phase-4-dual-ci** | GitHub Actions (or similar) runs: `npm test` (shared unit tests), `npm run test:kiosk` (kiosk integration), `npm run test:web` (web integration). All must pass before merge. | phase-2-web-testing, phase-1-kiosk-testing |
| **phase-4-kiosk-production-build** | `npm run build:kiosk` creates production Electron installer. Smoke-test on Windows with physical hardware or VM if available. | phase-4-dual-ci |
| **phase-4-kiosk-staging** | Ship refactored kiosk to staging environment. Run for N days (1 week?) to catch any regressions. Verify all 7 modules work, no crashes. | phase-4-kiosk-production-build |

**Blockers:** Kiosk staging must validate before production ship

**Estimated effort:** 1 session

---

### Phase 5: Web Staging & Kiosk Ship (Kiosk production, web ready)

| Task | Description | Dependencies |
|------|-------------|--------------|
| **phase-5-web-static-build** | `npm run build:web` generates `dist/` ready for Vercel/Netlify. Test build locally. No Electron code in output. | phase-3-complex-modules, phase-3-web-settings, phase-3-web-error-handling |
| **phase-5-web-staging** | Host web at staging URL. QA tests on mobile/tablet/desktop. Responsive layout, module loading, error recovery. | phase-5-web-static-build |
| **phase-5-kiosk-production-ship** | After staging validation, merge `refactor/dual-platform` to `main`. Deploy kiosk build to production. Monitor for 1–2 weeks. | phase-4-kiosk-staging |

**Blockers:** Kiosk must ship before web beta (ensure refactored core is stable)

**Estimated effort:** 1 session

---

### Phase 6: Web Beta & Final Cleanup (Web launches, archive refactor work)

| Task | Description | Dependencies |
|------|-------------|--------------|
| **phase-6-web-beta-launch** | After kiosk proves stable in production (1–2 weeks), deploy web to production or beta URL. Public availability. Collect user feedback. | phase-5-kiosk-production-ship, phase-5-web-staging |
| **phase-6-cleanup** | Update README to document dual-platform architecture. Remove old Electron-specific docs that no longer apply. Archive `playground/` if unused. | phase-6-web-beta-launch |

**Blockers:** None (final phase)

**Estimated effort:** <1 session

---

## Timeline Summary

| Phase | Duration | Key Milestone |
|-------|----------|---------------|
| **Phase 0** | 1–2 sessions | Shared core designed and extracted |
| **Phase 1** | 2–3 sessions | ✅ Kiosk refactored; shared core proven |
| **Phase 2** | 3–4 sessions | ✅ Web feature-complete; dual platform ready |
| **Phase 3** | 1–2 sessions | Web polish complete |
| **Phase 4** | 1 session | CI/CD working; kiosk production-ready |
| **Phase 5** | 1 session | ✅ Kiosk in production; web ready for beta |
| **Phase 6** | <1 session | ✅ Web live; dual-platform maintenance model established |

**Total: ~12–14 sessions spread over weeks (not days)**

---

## Key Mileposts & Shipping Strategy

### Shipping Gates
1. **Phase 1 complete** → Kiosk refactored successfully; shared core architecture proven
2. **Phase 2 complete** → Web feature-complete and tested; dual platform validated
3. **Phase 4 complete** → CI/CD passing both platforms; kiosk production build ready
4. **Phase 5 complete** → Kiosk in production (1–2 weeks monitoring); web staging validated
5. **Phase 6 complete** → Web live on production; dual-platform maintenance model operational

### Risk Mitigation
- **Feature branch only** (`refactor/dual-platform`) — No production risk until merge
- **Staged rollout** — Kiosk ships first; web waits for kiosk to stabilize
- **Comprehensive CI** — Both platforms tested before any merge
- **Shared core validation** — Kiosk serves as integration test for shared code before web ships

---

## Maintenance Model (After Launch)

### For Future Updates

**When a module is updated:**
1. Update `src/js/modules/<module>/` (shared)
2. Ensure module has no platform-specific code (internal `mount()` detects viewport)
3. Run tests: `npm test` + `npm run test:kiosk` + `npm run test:web`
4. Merge to `main` only when all tests pass
5. Deploy: `npm run build:kiosk` and `npm run build:web` in parallel

**When adding a new module:**
1. Create `src/js/modules/<new-module>/index.js` (shared)
2. Register in `src/js/modules/module-registry.js`
3. Add platform-agnostic tests in `tests/unit/`
4. Web automatically picks it up (lazy-loaded)
5. Kiosk automatically picks it up (lazy-loaded)

**When kiosk and web need divergent features:**
1. Extract feature detection/toggle into `src/js/core/`
2. Module code detects platform via `globalThis.platform` or similar
3. Fallback gracefully (e.g., no fullscreen mode on web)
4. Coordinate PR to land both changes together

---

## Out of Scope (For Later)

- Analytics/telemetry (can be added as an optional service)
- Keyboard navigation (touch + pointer sufficient for MVP)
- IE/legacy browser support (modern only)
- PWA/offline capability (online-only for MVP)
- Mobile asset optimization (same assets everywhere for MVP)

---

## Next Steps

1. ✅ **Grilling complete** — Design locked, no contradictions
2. 📋 **This document** — Full breakdown, timeline, task list
3. 🚀 **Ready to start Phase 0** — Shared core design and extraction

Start with `phase-0-shared-core-design` task when ready.
