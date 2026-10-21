# Telemetry research

## Prompt 1

describe the scope work to integrate telemetry data using Microsoft Clarity

## Response 1

**The scope is a lightweight Clarity integration plus explicit instrumentation across all nine modules.** Adding the tracking script is straightforward; the meaningful work is defining interactions, consent, and useful reporting for this graphics-heavy application.

**Two constraints need addressing first:** Microsoft states Clarity should not be used on apps targeting under-18s, which matters for an educational exhibit. Also, Clarity **cannot reproduce canvas contents**, so recordings will not faithfully show the Three.js scenes. Explicit interaction events are essential. [Microsoft FAQ](https://learn.microsoft.com/en-us/clarity/faq)

### Proposed scope

| Workstream | Work involved |
|---|---|
| **Project setup** | Create the Clarity project, assign dashboard access, and configure the project ID through Vite environment settings. Keep production and development traffic separate. |
| **Shared integration** | Add one telemetry adapter under `src\js\core\`, initialize once at startup, and expose small event/tag helpers. Analytics must never block loading, navigation, or gameplay. |
| **Privacy and consent** | Integrate consent controls, support withdrawal, review masking, exclude personal information from events, and update the privacy notice. Do not assume an unattended kiosk implies consent. |
| **CSP and connectivity** | Update the explicit CSP directives in `src\index.html` to permit the necessary Clarity resources without broadly weakening the policy. Verify deployment firewall restrictions. |
| **Application instrumentation** | Connect screen navigation, module loading, errors, exits, and idle returns to the shared adapter. |
| **Module instrumentation** | Add meaningful milestones and completion signals to all nine experiences, rather than logging every click or animation frame. |
| **Dashboard and handoff** | Configure named events, useful session filters, and available funnel views; document event meanings and reporting limitations. |

### Events worth capturing

| Area | Examples |
|---|---|
| Visitor journey | Experience started, menu opened, module selected |
| Module lifecycle | Module ready, load failed, retry selected, module exited |
| Engagement | Lesson started, meaningful milestone reached, restart, completion |
| Navigation | Next module accepted, return to menu, return to attract |
| Abandonment | Idle return from a module, exit before completion |

Module-specific examples include finishing a quantum-principles lesson, reaching a matter state, successfully configuring protection parameters, repairing a nanowire defect, or completing Majorana assembly.

Use **stable module-qualified event names**, such as `build_nanowire_completed`, and session tags for application release and deployment environment. Clarity's event API accepts an event name—not an arbitrary structured payload—and tags apply to sessions, so tags should not be treated as per-event properties. [Client API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api)

### Project-specific considerations

- **Single-page navigation:** modules share one document and URL. Explicit events are needed to distinguish journeys; module-specific heatmaps require verification rather than assuming automatic separation.
- **Shared kiosks:** a browser session can contain several visitors. Define an anonymous “experience run” separately; Clarity user/session counts are not reliable visitor counts.
- **Offline operation:** the experience must remain fully functional without Clarity. Guaranteed offline capture and later synchronization are **not included**.
- **Consent:** denying cookies does not necessarily prevent all collection. If the requirement is *no telemetry before consent*, gate loading accordingly. Microsoft documents separate analytics and advertising consent states. [Consent management](https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-management)

**Acceptance criteria:** agreed actions appear once under the correct module, denied consent follows the approved policy, no personal information is transmitted, blocked analytics does not affect the app, and recordings/events remain useful across representative viewport sizes.

**Outside this scope:** reliable crash reporting, GPU/FPS monitoring, precise aggregate duration metrics, and durable offline telemetry. Those need a separate observability or analytics solution; Clarity is primarily for understanding user behavior.

## Prompt 2

Do some research and recommend a telemetry solution (or 2) that might work well with canvas elements, for ex: Three.js scenes

## Response 2

**I recommend PostHog for usage analytics, with Sentry as the second option for diagnosing failures.** Both have documented canvas-recording support, making them better candidates than Clarity for this Three.js-heavy project.

The important distinction is **visual replay versus scene understanding**: recording a canvas shows what was displayed, but neither tool automatically knows that a visitor assembled a component, repaired a defect, or completed a lesson. Those actions still need explicit events.

### 1. PostHog — best primary choice

**Best for:** understanding which modules people use, where they abandon them, and which interactions they complete.

PostHog explicitly supports recording **2D and WebGL canvases**. Its documented default is **4 frames per second**, with configurable capture frequency and image quality. This is useful for reviewing interactions—not for evaluating animation smoothness. [Canvas recording documentation](https://posthog.com/docs/session-replay/canvas-recording)

It also supports custom events with structured properties, which fits this application well:

```js
posthog.capture('component_placed', {
  module_id: 'build-majorana-2',
  component_id: 'processor',
  correct: true,
  attempt_number: 2,
  elapsed_ms: 18400
})
```

Those events can drive module-completion funnels, abandonment analysis, and time-to-complete reports. [Event API](https://posthog.com/docs/libraries/js/usage) · [Funnels](https://posthog.com/docs/product-analytics/funnels)

**Tradeoffs**
- Canvas capture requires image extraction and encoding, so overhead must be measured—particularly with multiple canvases and a 4K display.
- DOM masking does **not** automatically mask canvas pixels. PostHog now documents programmable canvas mask regions, but these require explicit implementation.
- Recording visuals does not capture the underlying Three.js scene graph or provide deterministic gameplay replay.

**My recommendation:** start with semantic events throughout the app and enable low-frequency canvas replay only for a sample of sessions.

### 2. Sentry — best for technical diagnostics

**Best for:** explaining failed loads, broken interactions, exceptions, and slow module preparation.

Sentry's `replayCanvasIntegration()` supports canvas replay, with specific guidance for **Three.js/WebGL rendering**. Its strongest feature for this project is **manual snapshotting immediately after rendering**.

Automatic WebGL capture needs `preserveDrawingBuffer`, which can affect performance. Sentry documents manual snapshots as an alternative that avoids that requirement:

```js
renderer.render(scene, camera)

// When a capture is due, in the same execution turn:
replayCanvasIntegration.snapshot(renderer.domElement)
```

This is illustrative—the integration would be initialized once, and capture frequency controlled rather than blindly adding work to every frame. [WebGL capture guidance](https://docs.sentry.io/platforms/javascript/session-replay/#3d-and-webgl-canvases)

Sentry links errors to replays and supports custom performance spans, making it useful for investigating module-mount failures, asset loading, and interaction errors. **Caught errors must be explicitly reported**, including errors already handled by `ModuleHost`. [Replay documentation](https://docs.sentry.io/platforms/javascript/session-replay/) · [Tracing](https://docs.sentry.io/platforms/javascript/tracing/)

**Tradeoffs**
- It is not my first choice for learning-outcome or visitor-journey analytics.
- Sentry explicitly warns that canvas recordings have **no PII scrubbing**.
- Error-triggered replay can still involve capture and buffering before an error; it is not zero-overhead until something fails.

### What I would choose for this project

| Main objective | Recommendation |
|---|---|
| Module popularity, completion, abandonment, interaction journeys | **PostHog alone** |
| Debugging broken or slow Three.js experiences | **Sentry alone** |
| Both product insights and operational reliability | **PostHog events + Sentry errors/tracing**, with one replay recorder enabled initially |

Before rollout, I would run a small proof of concept on **Majorana assembly and a multi-canvas quantum lesson**. Compare telemetry disabled, events-only, and canvas replay enabled; measure frame times, memory, upload volume, and whether replay actually captures the final composited scene correctly.

For shared kiosks, define anonymous experience-run boundaries instead of treating a device as one visitor. Consent, audience-age suitability, retention, and network-loss behavior also need explicit review—neither canvas support nor anonymous identifiers resolve those requirements.
