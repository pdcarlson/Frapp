### ADR-22: Sentry is the system of record for exceptions and traces; PostHog for product analytics

**Decision (2026-09-09):** Split observability by signal, not by vendor convenience.

- **Sentry** is the system of record for unhandled exceptions, crashes, 5xx, and distributed
  performance traces. It owns the Node trace provider on the API. Do not install a second global
  tracer. Do not enable Sentry Replay.
- **PostHog** is the system of record for product analytics, feature flags, chapter groups,
  session replay / heatmaps, and searchable **sanitized** logs. Disable PostHog exception
  autocapture in every SDK and in the project. Errors are counted only in Sentry.
- **`x-request-id`** stays a request-correlation id, minted or honored by API middleware. It is
  not a Sentry/OTEL trace id and is not replaced by one.
- **Identity** is HMAC with an API-only per-environment salt. Clients receive validated
  pseudonyms from `GET /v1/analytics/identity`. Landing stays anonymous and is never aliased
  onto an authenticated distinct id.
- **Replay** is PostHog-only, masked and blocklisted by default, gated by
  `chapters.analytics_opt_out`, and **production-disabled until Paul approves** privacy
  disclosure, consent, and retention.
- **Vendor SDK init stays runtime-local.** Shared policy (scrubber, correlation types, safe env
  parsing, PII redaction) lives in the browser-safe `@repo/observability` package
  (`packages/observability`). Vendor SDK init stays in NestJS, Next.js, and React Native.
  **Correction (2026-09-09):** the original decision named this as a later slice and still
  pointed at `packages/validation/src/sentry-scrubbing.ts`. That module was **moved**, not
  copied. The package is listed under [`spec/architecture/README.md` §4](../README.md#4-shared-packages).

The product rules, identifier table, sampling bounds, and definition of done live in
[`spec/behavior/observability.md`](../../behavior/observability.md) and are not restated here.

**Context.** The repo already ships a shared Sentry scrubber (#865 / #896 / #966), API-only
HMAC analytics (#431 family), and `x-request-id` middleware that honors inbound ids. Live
provider state on 2026-09-09 did **not** match that intended split, and this ADR does not
rewrite the intended split to match the dashboards. Alert-rule observations for that date
live in [`ALERT_ROUTING.md`](../../../docs/internal/ops/ALERT_ROUTING.md) (Sentry issue-alert
*read* works; metric-alert list still HTTP 410; *create* is human-only; Render unread).
Product-analytics project state, recorded here because it is the evidence this decision is
not a description of the current PostHog project:

| Surface | Observed 2026-09-09 | How |
| --- | --- | --- |
| Sentry org `frapp-live` | Three projects (`frapp-api`, `frapp-web`, `frapp-mobile`); not separate staging/prod orgs. `frapp-web` 0 events / 90d; `frapp-mobile` 0; `frapp-api` 5 including unresolved `FRAPP-API-2`. Sentry Replay: 0 replays on `frapp-web` / 90d | Sentry MCP |
| PostHog org Signet, project `569878` | `ingested_event: false`; HogQL `count()` on `events` last 90d = **0**. `autocapture_exceptions_opt_in: true`. `session_recording_opt_in: true`, `session_recording_sample_rate: null` (treat as 100%), `maskAllInputs: true`, replay retention `30d`, `anonymize_ips: false`. No workflows, no feature flags. One project only — production project still missing | PostHog MCP; #1173, #709 |
| Granola / Supermemory / Infisical names / Render | Granola MCP `needsAuth`; Supermemory MCP discovery error; Infisical secrets endpoints 404 with a present service token; Render MCP unauthorized. Last live proof of staging `POSTHOG_API_KEY` remains the 2026-08-21 comment on #1173 | blocked this session |

**Correction (2026-09-09 ~21:32Z):** the PostHog row above is the *then*-current project, not today's. Live settings (and that project-level `session_recording_opt_in` is not production replay) live in [`ALERT_ROUTING.md`](../../../docs/internal/ops/ALERT_ROUTING.md); do not copy them back here.

Code-side gaps on the same date (current behavior, not this decision): identity DTO is
`{ distinct_id, enabled }` with no chapter-group pseudonym; landing has no Sentry/PostHog SDK
(privacy copy still names Sentry); API/web `tracesSampleRate` was still `Number(env ?? '0.1')`
and could be `NaN` (closed #904 covered mobile only).
**Correction (2026-09-09):** `@repo/observability` `parseTracesSampleRate` now clamps API and
web traces rates to finite `[0, 1]` with default `0.1` (#2040). Landing still
has no Sentry/PostHog SDK.
**Correction (2026-09-09):** `GET /v1/analytics/identity` now returns
`chapter_group_id` (64-hex HMAC of `chapter_id`, or `null`) alongside
`distinct_id` / `enabled` (#2042). HMAC stays API-side.
**Correction (2026-09-09):** API `Sentry.init` lives in `apps/api/src/instrument.ts` (first
import from `main.ts`). `skipOpenTelemetrySetup` is explicitly `false` so Sentry owns
the Node tracer; `@opentelemetry/sdk-node` is not a dependency. Request-correlation
context is AsyncLocalStorage bound in `requestIdMiddleware`, not a second tracer.
**Correction (2026-09-09):** `apps/web` initializes PostHog JS for identify /
chapter groups / flags / replay-gates / `sentry-error-correlated`. Replay stays
off in every environment in that slice.
**Correction (2026-09-09):** `apps/mobile` initializes PostHog RN the same way
(identify / chapter groups / flags / replay-gates / the marker). Sentry Replay
stays off. PostHog replay stays off in every environment. Release is
`bundleId@version+nativeBuildNumber`; git SHA is a `git_sha` tag, not the
release name. Native crash / EAS DSN proof remains #938 / #1361. Landing
still has no Sentry/PostHog SDK (WS6).

**Alternatives rejected.**

- **PostHog as a second exception autocapture.** Two SoRs for the same crash double-count,
  split alert routing, and send stack frames to a product-analytics dataset. Observed
  `autocapture_exceptions_opt_in: true` *(earlier 2026-09-09 observation)* was a bug
  against this decision, not evidence it was wrong. **Correction (2026-09-09 ~21:32Z):**
  that project flag has since been flipped; live settings live in
  [`ALERT_ROUTING.md`](../../../docs/internal/ops/ALERT_ROUTING.md), not here.
- **Sentry Replay.** Two replay products means two consent surfaces and two PII leak paths.
  Session replay stays PostHog-only, production-off until approval.
- **One PostHog project for staging and production.** A shared dataset aliases staging
  traffic onto production funnels and makes the deleted-users automation (#709) unsafe to
  reason about. Staging project `569878` must not become that shared dataset.
- **Client-held `ANALYTICS_HMAC_SALT` or a PostHog personal API key.** A browser
  or RN bundle is readable; either secret would let the analytics dataset be
  rainbow-tabled or queried from the client. The write-only `phc_` project
  token is a different class (ingest, not read), like a Sentry DSN.
  **Correction (2026-09-09):** Workstream 5 ships PostHog JS in `apps/web` with
  `NEXT_PUBLIC_POSTHOG_KEY` (`${POSTHOG_API_KEY}`). Named product events remain
  `POST /v1/analytics/events` so they are not double-counted with the API
  adapter. Landing stays out of that slice (WS6).
- **Reusing `x-request-id` as the trace id.** Inbound clients already send one; Sentry/OTEL
  traces are a different identifier space. Collapsing them loses either inbound honor or
  vendor trace continuity.
- **A second global OpenTelemetry tracer beside Sentry.** Competing providers corrupt
  context propagation. Integrate with Sentry's OTEL context.
- **Aliasing landing visitors onto later authenticated distinct ids.** Landing is a public
  marketing surface; aliasing would attach pre-auth browsing to a member record.
- **Tailing Render stdout into PostHog.** Internal logs lawfully carry raw `userId` /
  `chapterId`. The external sink is a separate transform (pseudonyms, `originHash`,
  path-only URLs), not a pipe.
- **Feature flags or analytics as an authorization input.** Authz is a permission check.
  Flags evaluate the same pseudonymous context for product behavior only, and
  server-enforced behavior evaluates server-side.

**Consequences.**

- Work to make *current* dashboards and code match this decision is a series of reviewable
  slices (shared package, identity DTO, sampling parser, landing anonymous init, provider
  toggles), each branched from `main`, not a mega-PR. This ADR does not ship that code.
- Production PostHog ingest, including replay, waits on the human-only list in
  [`observability.md` § Verification](../../behavior/observability.md#verification-and-definition-of-done).
  This ADR does not close those items.
- Dated live observations of alert rules belong in
  [`ALERT_ROUTING.md`](../../../docs/internal/ops/ALERT_ROUTING.md), refreshed when re-checked,
  not copied into this ADR on every pass.

**Trigger to revisit:** Paul approves production replay (disclosure, consent, retention) —
amend the replay row, do not silently turn it on. A second Sentry org or a second PostHog
project for production is an expected follow-through of this decision, not a reversal.
Reconsider the split only if a single vendor becomes the SoR for *both* exceptions and
product analytics; that would supersede this ADR.
