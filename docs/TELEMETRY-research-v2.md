## TELEMETRY for IQM

Add **two complementary telemetry streams**:

1. **Experience analytics:** which interactions attract engagement, where visitors stop, and what they complete.
2. **Operational telemetry:** whether the kiosk is healthy, responsive, and recovering successfully.

My initial shortlist is **PostHog + Sentry**, with **Matomo + Sentry** as the alternative when self-hosting or tighter data ownership is the priority. Keep collection vendor-independent and offline-first.

## What makes this project different

The current `module registry` contains **nine experiences**, including scrubbers, parameter controls, guided sequences, and 3D assembly.

Several existing behaviors matter to telemetry design:

- **Shared device:** one installation serves many visitors, potentially several simultaneously.
- **Offline-first operation:** network access cannot be a dependency.
- **Two-stage idle return:** modules return to the menu before the menu returns to attract mode.
- **Automatic recovery:** `Electron recovery handlers` reload unresponsive or crashed renderers.
- **Heavy graphics and media:** loading, warm-up, rendering, and interaction latency all affect the experience.
- **Guided continuation:** the `up-next popup` provides a useful opportunity to measure whether visitors continue, restart, or leave.

Standard website metrics—particularly “unique users” and pageviews—would be misleading here.

## Tools to consider

| Tool | Best use here | Main considerations |
|---|---|---|
| **[PostHog](https://posthog.com/docs/product-analytics/funnels)** | Custom interaction events, module funnels, drop-off, and journey analysis | Strong first choice for experience analytics. Use explicit events rather than autocapture; disable replay, persistent visitor identity, and unnecessary enrichment. |
| **[Matomo](https://developer.matomo.org/api-reference/tracking-api)** | Event analytics with an on-premises ownership option | Good alternative where hosting control matters most. Expect more administration and deliberate mapping of kiosk sessions into its visit model. Check licensing for desired reporting features. |
| **[Sentry for Electron](https://docs.sentry.io/platforms/javascript/guides/electron/)** | Main/renderer errors, native crashes, performance, and release regressions | Best diagnostic fit. Start with minimal collection; assess native crash dumps separately because they can contain process-memory data. |
| **[OpenTelemetry](https://opentelemetry.io/docs/languages/js/)** | Vendor-neutral operational metrics and traces, particularly with existing monitoring infrastructure | Useful later, but not a visitor-analytics dashboard itself. Browser instrumentation is still experimental; I would not make it the MVP’s foundation. |

**Suggested starting combination:** PostHog for engagement and Sentry for diagnostics, with overlapping features disabled. If cloud procurement is difficult, begin with local collection/export while evaluating Matomo.

I would validate offline delivery, historical-event ingestion, retention, region, and cost before selecting a vendor—not assume SDK buffering covers unattended kiosk operation.

## What to capture

### Shared experience events

Start with a small, explicit vocabulary:

- `session_started` / `session_ended`
- `module_selected` / `module_ready` / `module_exited`
- `step_started` / `step_completed`
- `interaction_outcome`
- `module_completed`
- `continuation_offered` / `continuation_selected`
- `module_restarted`
- `idle_return`

Useful properties include module and step IDs, entry source, exit reason, duration, and outcome. Distinguish **selection**, **successful presentation**, and **first meaningful interaction**: each answers a different question.

### Module-specific opportunities

These are proposed measurements, not existing instrumentation:

| Experience | Useful signals |
|---|---|
| **What makes quantum different?** | Principles explored, comparison activities attempted/completed, progression between activities |
| **A new state of matter** | States reached, transitions explored, scrub coverage, replay |
| **Build a topoconductor** | Materials explored, combination attempts, successful combination |
| **Protection of quantum information** | Parameters adjusted, coarse parameter ranges explored, protected state achieved |
| **Build a qubit** | Layers completed, scan used, defects discovered/repaired, stage abandonment |
| **Build a Majorana 2** | Components/pathways explored, placement attempts, rejected placements, successful assembly |
| **Computing with topological qubits** | Measurement steps attempted/completed, sequence completion, restart |
| **The scale of topological qubits** | Zoom levels reached, hotspots opened, comparisons explored |
| **Microsoft Quantum Platform** | Stack layers explored, progression depth, completion |

For continuous controls, record **summaries or meaningful transitions**, not every pointer movement, video frame, dial tick, or camera coordinate.

Completion should reflect a defined domain milestone—not simply reaching a screen or clicking “Next.” Nor should completion be presented as proof of learning.

### Operational telemetry

Capture:

- Startup and module-ready duration, including cold versus warm loads.
- Module load failures, media failures, WebGL context loss, and retries.
- Renderer hangs, crashes, recovery attempts, and recovery success.
- Sampled frame-time and memory trends during active experiences.
- App/content version and production versus review/development mode.
- Upload failures, queue size, oldest pending event, and dropped-event counts.
- Low-frequency health heartbeats during expected operating hours.

A missing heartbeat means **“unreachable”**, not necessarily “crashed”: power-off and lost connectivity look similar remotely.

## Kiosk-specific measurement rules

### Sessions are interaction attempts—not people

Use a fresh random session ID for each interaction session, never a persistent visitor profile.

Proposed boundaries:

- Start on deliberate engagement, such as pressing Start.
- End on Home, inactivity, or interruption.
- End at the **first idle-return stage**, rather than waiting through the additional menu countdown.
- If someone resumes from that menu, begin a new session.
- Preserve explicit module-to-module continuation within the same session.

Immediate handoffs between visitors and group use cannot be reliably distinguished without intrusive sensing. Reports should say **sessions**, not visitors or unique people.

### Separate dwell from activity

Record visible dwell and an explicitly defined activity estimate separately. Avoid counting the full idle timeout as engagement—but also avoid treating reading or intentionally watching media as abandonment.

Exclude attract playback, preloading, warm-ups, automated tests, and staff demonstrations from visitor metrics.

### Measure exposure as well as selection

The carousel makes placement important. Capture sufficiently visible module-card exposures so we can distinguish:

- “This module was rarely selected.”
- “This module was rarely seen.”

Similarly, measure up-next acceptance against **offers actually displayed**, separating band offers from popup offers.

## Proposed architecture

```text
Explicit shell/module events
        ↓
Narrow preload bridge
        ↓
Main-process validation and privacy filtering
        ↓
Bounded, durable local queue
        ↓
Background upload → selected analytics service
```

The existing `module lifecycle boundary` is a natural place to supply modules with a small tracking interface.

Important implementation requirements:

- Keep analytics networking and persistence out of individual modules.
- Preserve the current sandbox/context isolation and restrictive `renderer CSP`.
- Validate event names, properties, sizes, and sending context in the main process.
- Batch asynchronously; never block navigation or rendering.
- Retain event IDs, occurrence timestamps, and sequence numbers across retries.
- Use bounded storage, expiry, retry backoff, and explicit loss accounting.
- Test restart/power-loss recovery and duplicate handling; do not promise exactly-once delivery.
- Keep diagnostic SDK delivery separate, with its own verified offline behavior.

Common metadata should remain small: schema version, event ID, session ID where relevant, module/attempt ID, app/content version, environment, and an assigned kiosk/site alias—not a hostname or hardware serial number.

## Privacy baseline

**Collect the minimum needed to improve the exhibit, not to identify its audience.**

Recommended defaults:

- No names, emails, demographic inference, cameras, microphones, or visitor-device tracking.
- No session replay, screenshots, raw touch paths, keystrokes, or unrestricted DOM capture.
- No persistent visitor identifiers or cross-session profiling.
- Disable IP retention and location enrichment where supported; review infrastructure access logs too.
- Scrub filesystem usernames, tokens, URLs, and arbitrary error text before transmission.
- Review native crash-dump collection separately; ordinary event scrubbing is not sufficient protection.
- Use access-controlled local storage, encrypted transport, restricted dashboard access, and an operator-controlled collection switch.
- Provide a short, accessible visitor notice explaining purpose, collection, and retention.
- If consent is required, scope it to the current session—not every subsequent visitor using the same kiosk.

**Cookieless does not automatically mean anonymous or consent-exempt.** [Matomo’s documentation explicitly makes this distinction](https://matomo.org/faq/general/faq_157/). Also, [PostHog documents that disabling IP retention does not itself disable location enrichment](https://posthog.com/docs/privacy/data-collection#ip-data-capture).

Proposed retention starting points, subject to approval: short local buffering, **30 days of raw events**, and longer-lived aggregate reports with small-group suppression. Confirm jurisdiction, audience—including children—hosting region, contracts, and lawful basis before enabling production collection.

## Implementation plan

1. **Agree on questions and policy**
   - Define completion per module, session boundaries, retention, hosting, and access.
   - Choose three initial dashboards: engagement, module friction, and kiosk health.

2. **Build the collection foundation**
   - Event schema, validated bridge, durable queue, filtering, local inspection/export, and collection controls.

3. **Instrument the shell and diagnostics**
   - Session/navigation lifecycle, load timing, idle reasons, continuation, crashes, and recovery.

4. **Pilot two contrasting modules**
   - States of Matter for continuous interaction.
   - Majorana assembly for multi-step validated outcomes.
   - Refine the schema before extending to all nine.

5. **Validate and roll out**
   - Test offline operation, restart recovery, delayed uploads, duplicates, privacy payloads, and disabled collection.
   - Compare instrumented versus baseline responsiveness on the actual 4K touchscreen.
   - Manually reconcile several scripted journeys against dashboard results.
   - Pilot on one kiosk before wider deployment.

**MVP success:** trustworthy session/module funnels and actionable failure alerts, without collecting identifiable visitor data or making the kiosk dependent on connectivity.

No project files changed.