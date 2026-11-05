# Kiosk telemetry

The initial integration collects shared session/module lifecycle analytics for
PostHog and minimal error/recovery diagnostics for Sentry. Detailed interactions
and completion milestones inside the nine experiences are not instrumented yet.

## Collection and delivery

- Collection requires a packaged production kiosk, a local configuration with
  `enabled: true`, and the corresponding provider's ingestion configuration.
  Development, windowed, and both review builds do not collect production data.
- Events are written locally. Starting, reconnecting, recovering, and quitting
  **never initiate an upload**.
- An operator launches the application with `--telemetry-upload`, reviews the
  queue counts, and explicitly chooses **Upload now** in a native dialog. If the
  kiosk is already running, the command is forwarded to that instance. Cancel
  is the default.
- Each request has a 15-second deadline. A failure stops that destination's
  current upload; the other destination can still proceed. Failed events remain
  queued. There are no scheduled retries, including after HTTP 429 responses.
- An upload covers a snapshot, not events collected after it started. Positive
  ingestion acknowledgements remove accepted records. Retried records retain
  their vendor event IDs; an interrupted upload may be delivered more than once.
- The queue expires events after seven days and holds at most 10,000 records or
  25 MiB, whichever is reached first. Oldest events are removed at these limits.
  Expiry is enforced on startup, enqueue, status inspection, and upload, not by a
  background cleanup timer. Upload at least daily during an event.
- At most 256 writes can wait in memory. An overload drops additional events
  with an explicit diagnostic rather than growing a backlog without bounds.
- Files are synced before an enqueue completes. Pending asynchronous writes or
  partially written records can still be lost on abrupt power/process failure.
  Corrupt records are logged and removed. The operator dialog reports storage
  failures and drops observed during the current run.

## Set up the EU projects

### PostHog

1. Create a PostHog Cloud account/organization in the **EU region** and create a
   dedicated production kiosk project.
2. Copy the **public project token** (`phc_...`) from project settings. Do not use
   a personal API token. This integration sends directly to the
   [EU capture/batch API](https://posthog.com/docs/api/capture).
3. Disable IP retention and the GeoIP transformation in project settings.
   [Discarding IP addresses alone does not disable location enrichment](https://posthog.com/docs/privacy/data-collection#ip-data-capture).
4. Configure retention and restrict dashboard access. Keep autocapture, replay,
   surveys, and other optional collection off.

The kiosk uses the HTTP API rather than a browser SDK: no tracking scripts,
cookies, local-storage visitor IDs, remote feature configuration, or browser
autocapture are needed. Every event explicitly sets
`$process_person_profile: false` and `$geoip_disable: true`.

### Sentry

1. Create a Sentry organization in the **EU region** and an **Electron** project.
2. Copy its public **DSN** from project settings / client keys. The hostname
   should resemble `o123.ingest.de.sentry.io`. US DSNs and arbitrary endpoints
   are rejected by this integration.
3. Set project retention, access, and server-side scrubbing appropriately.
4. Do not enable replay, screenshots, native crash dumps, or user feedback.

The Electron SDK runs in the main process with default integrations disabled.
Only its uncaught-main-exception integration is enabled. Renderer errors,
unhandled rejections, module failures, and recovery signals use the kiosk's
validated preload bridge. The custom SDK transport writes sanitized events to
disk instead of making network requests.

No Sentry authentication token is required on the kiosk. Private source-map
upload is not implemented; stack frames retain only JavaScript file basenames
and line/column numbers. This limits diagnostics, especially for bundled code.

## Configure a kiosk

1. Copy [config/telemetry.example.json](../config/telemetry.example.json) outside
   the installed application, to `telemetry.config.json` inside Electron's
   per-user application data directory.
2. Choose a non-personal kiosk alias, fill in the PostHog token and Sentry DSN,
   and leave `enabled: true`. Either provider can be left blank to disable its
   collection independently.
3. Restart the kiosk. Configuration is read at startup.

On Windows the production application data directory is normally
`%APPDATA%\IQM Interactive Kiosk`. The operator dialog displays the exact
configuration path. Alternatively, set `IQM_TELEMETRY_CONFIG` to an absolute
configuration file path in the **kiosk account's** environment.

Example operator command, adjusting the installation path:

```powershell
& 'C:\Program Files\IQM Interactive Kiosk\IQM Interactive Kiosk.exe' --telemetry-upload
```

The command shows status even when collection is unconfigured/disabled. Upload
is refused when the runtime or configuration disables telemetry. Previously
queued events are not automatically deleted by disabling collection.

Queue files live in the `telemetry` subdirectory of the same application data
directory. They contain neither provider credentials nor raw error messages.
Treat the configuration and queue as access-controlled operational data: Windows
directory ACLs and the restricted kiosk account are the protection boundary.
Do not commit real configuration. The repository ignores a root-level
`telemetry.local.json` for local setup, but development still does not collect.

If a kiosk is reassigned to another organization/project, stop the application
and clear its queue under an approved maintenance procedure before changing
ingestion configuration.
Queued data otherwise goes to the currently configured projects.

## Event semantics

| Event | Meaning |
| --- | --- |
| `session_started` | Start is selected, or a visitor resumes an abandoned menu |
| `screen_viewed` | Deliberate menu/module navigation; no attract-loop views |
| `module_selected` | A valid experience is selected, with menu/module source |
| `module_loading` | The host starts a mount attempt; retries get new attempt IDs |
| `module_ready` | The current host mount and presentation-ready barrier settle |
| `module_failed` | A mount or post-mount interaction fails |
| `module_exited` | Navigation, inactivity, retry, shutdown, or renderer recovery ends the attempt |
| `idle_return` | Inactivity closes an active interaction session |
| `session_ended` | Home, first-stage inactivity, graceful shutdown, or renderer recovery |

`module_ready` is **host readiness**, not a measurement of the final transition
finishing or the first presented GPU frame. `load_ms` measures selection to
host readiness, or retry start to readiness.

Session IDs are fresh random identifiers kept in memory only. There are no
cross-session visitor profiles. Module-to-module continuation retains a session;
module-to-menu inactivity ends it immediately, without counting the second idle
stage as another session. Subsequent deliberate menu activity starts a new one.
Group use and immediate handoffs cannot be distinguished: report **sessions**,
not visitors or unique people.

`duration_ms` is elapsed dwell, including reading, watching, and the idle grace
period. It is not an active-engagement estimate or proof of learning. Events
include a per-session sequence, attempt IDs where relevant, occurrence timestamp,
schema version, app version, and kiosk alias. Preloading/warm-up alone creates no
sessions, although a warm-up failure may produce a diagnostic.

Main-process death or power loss can leave sessions without end events; treat
these as interrupted, not completed. Recovery while the main process survives
adds explicit interruption events.

## Privacy and operational approval

Analytics accept only a fixed event/property vocabulary. Diagnostics omit raw
messages, arbitrary extras, breadcrumbs, identities, request data, and machine
paths. Neither pipeline captures touch trajectories, keystrokes, photos, audio,
demographics, or precise location.

Transport endpoints necessarily receive the kiosk's network IP during an
operator upload. Configure provider/infrastructure retention accordingly; the
integration cannot prevent that network-level disclosure.

The selected policy permits minimal collection without a consent prompt.
This is a deployment decision, **not a legal determination**. The operator
remains responsible for the visitor notice, lawful basis, children/group-use
considerations, contracts, retention, access, and regional compliance. Random
session IDs and timestamps should still be treated as potentially linkable
data rather than guaranteed anonymous data. No visitor-consent UI is included.

Suggested initial raw-event retention is 30 days where the selected service
plan permits it. Do not claim that deleting the local queue deletes data already
uploaded to either provider.

## Validation and first live upload

```powershell
npm test
npm run build
npm run check:telemetry
```

The Electron smoke test uses temporary storage and fake EU ingestion credentials.
It exercises the actual Sentry SDK, sandboxed preload, built renderer, module
host, privacy filtering, and explicit uploads to an in-process fake transport.
It makes no real vendor requests.

Before deployment, use a configured production build to:

1. Complete a short Start / module / Menu / Home journey while disconnected.
2. Confirm queue counts and cancel an upload; reconnecting must do nothing.
3. Explicitly upload and verify both services show the expected event IDs,
   timestamps, release, counts, and absence of sensitive properties.
4. Repeat with a deliberately failed upload and verify a later manual retry.
5. Test delayed ingestion after the expected offline interval against provider
   limits. Local retention does not guarantee vendor acceptance of older data.
6. Compare responsiveness on the actual 4K touchscreen with collection on/off.

Live provider acceptance, project settings, and physical-device performance
cannot be verified by the fake-transport tests.
