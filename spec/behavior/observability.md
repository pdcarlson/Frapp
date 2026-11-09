# Observability

This file is the **product-behavior contract** for observability: which provider owns which signal, how identifiers correlate, what may leave the process, how releases are named, and how sampling is bounded. The **decision and rejected alternatives** live in [ADR-22](../architecture/adr/adr-22.md). Pseudonymous identity, chapter opt-out, and account-deletion forget live in [`data-retention.md`](data-retention.md#analytics-events-pseudonymous). Operational routing lives in [`alert-routing.md`](../../docs/ops/alert-routing.md). Env-var names live in [`ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md).

**Provider dashboards count as current behavior here, alongside code.** A dashboard default or a leak that disagrees with this file is handled like any spec-vs-code disagreement ([`AGENTS.md` § Spec vs code](../../AGENTS.md#spec-vs-code)), not by rewriting the file to match it.

## Provider ownership

| Signal | System of record | Must not |
| --- | --- | --- |
| Unhandled exceptions, crashes, 5xx, distributed performance traces | **Sentry** | A second exception autocapture (PostHog), a second session-replay product (Sentry Replay) |
| Product analytics, feature flags, chapter groups, session replay / heatmaps, searchable **sanitized** logs | **PostHog** | Raw user/chapter ids, emails, IPs, tokens, query strings, bodies, chat/document/upload content, AI prompts/outputs |
| Internal request/security/push logs (Render stdout) | **API structured logs** | Shipping that stream unchanged to PostHog or Sentry |
| Authorization / permission decisions | **Not a telemetry input** | Feature flags or analytics gating authz |

Sentry projects are one per runtime: `frapp-api`, `frapp-web`, `frapp-mobile`, and (when landing is wired) a distinct landing project. PostHog projects are one per **environment** (staging and production must not share a dataset — #1173).

Clients do not hold `ANALYTICS_HMAC_SALT` or a PostHog **personal** API key. A write-only `phc_` project token may ship in a client bundle (`NEXT_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_KEY`) — it authorizes ingest, not read, the same class as a Sentry DSN. Named product events still go through the API (`POST /v1/analytics/events`, `GET /v1/analytics/identity`) so they are HMAC-keyed, opt-out-gated, and not double-counted with the API PostHog adapter. The client SDKs are identify / chapter groups / feature flags / replay-gates / the `sentry-error-correlated` marker / route views / mobile app lifecycle events ([§ Route views](#route-views)). Vendor SDK **init calls** stay runtime-local to each app (`Sentry.init`, `posthog.init`). Shared policy, correlation types, safe env parsing, and PII redaction live in the browser-safe `@repo/observability` CJS barrel. Identify / groups / opt-out / hex validation / identified Sentry attach live on `@repo/observability/identified-posthog` (web and mobile only). Anonymous Next.js option builders (replay-off, both scrubber hooks, debug-ID webpack defaults, path-only analytics, session/replay tags) live on `@repo/observability/next` and export **no** identify / group / `setUser` / `posthog_distinct_id` APIs. Landing must not import the identified entry.

**Correction (2026-09-09):** an earlier revision of this paragraph said clients do not hold a PostHog project API key and that the API is the only analytics transport. Workstream 5 ships PostHog JS in `apps/web`. Workstream 6 ships PostHog JS on `apps/landing` for anonymous page/CTA analytics only. Workstream 7 ships PostHog RN in `apps/mobile` the same way as web. The salt and personal API keys stay out of every bundle.

Landing stays **anonymous**: no `GET /v1/analytics/identity`, no alias onto an authenticated distinct id, no chapter group. Landing's PostHog `before_send` is `sanitizeAnonymousPostHogCapture`, which drops `$set` / `$set_once`.

**Correction (2026-09-10):** `apps/web` PostHog JS still has `capture_pageview: false`, but `posthog-js` attaches `$current_url` / `$pathname` / `$referrer` and `$initial_current_url` on **every** `capture` / `identify` (including `sentry-error-correlated`) from `window.location`. Those URL-shaped properties are path-only via `sanitizeIdentifiedPostHogCapture` (`before_send`). That helper keeps sanitized `$set` / `$set_once` and `$groups` whose values are 64-hex. It lives on `@repo/observability/next` and still exports no identify / group / `setUser` APIs. `property_denylist` on web matches landing (`$ip`, `ip`, `email`, `$email`).

**Correction (2026-09-10):** `apps/mobile` PostHog RN has the same URL-shaped gap on capture/identify (current-route and deep-link query strings such as `/join?token=` and OAuth `state`). `posthog-react-native` inherits core `before_send` with the same CaptureEvent envelope as posthog-js; `buildMobilePostHogInitOptions` points it at the same `sanitizeIdentifiedPostHogCapture` helper (DOM-free: no `window` / `document`); since #3382 it runs behind an opt-out gate, `mobilePostHogBeforeSend` ([§ Route views](#route-views)). RN has no `property_denylist`; those keys are dropped in the sanitizer. Replay stays off. Landing still uses `sanitizeAnonymousPostHogCapture` (drops `$set`).

LLM telemetry is allowed only at a real consumed server AI adapter. The mobile Ask mock (`apps/mobile/lib/ask/corpus.ts`) must not emit LLM analytics.

### Route views

Since [#3382](https://github.com/pdcarlson/Frapp/issues/3382), web sends one `$pageview` and mobile one `$screen` per route, directly from the SDK. The rule is **templates only**: a route view records the route's template, never a raw id.

- **The template** is `analyticsRouteTemplate` (`@repo/observability`'s `analytics-path.ts`): the path-only reduction (`pathOnlyAnalyticsPath`: no query, fragment or host), then every segment that does not name a screen replaced by `[id]`. A screen segment is lowercase words joined by hyphens (`chat-thread`), a route group (`(tabs)`) or a templated param (`[id]`), at most 24 characters and not a hex run. `/events/3f2a…` is recorded as `/events/[id]`, and a malformed link such as `/members/jane@school.edu` as `/members/[id]`. No web, landing or mobile route carries an id in its path today (ids ride the query string), so today a real route's template is its pathname; the replacement keeps a future dynamic route, or a not-found path, from sending one.
- **Every URL-shaped property**, not only the route view's own, leaves as a template: the shared sanitizer (`sanitizeAnonymousPostHogProperties`, under both `sanitizeIdentifiedPostHogCapture` and landing's anonymous one) templates any string that starts with `/` or has a scheme. That covers what the SDKs add from the real location: `$current_url`, `$pathname`, `$referrer`, posthog-js's `$prev_pageview_pathname` (from `window.location.pathname`), RN's `$screen_name` and `Application Opened.url`.
- **Web** records it from `usePathname()` as `$pageview` with `$pathname` and `$current_url` both set to the template, the shape landing already sends. `capture_pageview` stays `false`: the SDK's own pageview would read `window.location` and would fire before the opt-out applies. `$pageview` is captured by hand instead.
- **Mobile** records it from expo-router's `usePathname()` (params and group segments dropped, so Chat home is `/`) as `screen(template)`. A push of the same screen with new params (a notification for another thread onto `/chat-thread`) is a new visit, so it records another `$screen`; the params tell the visits apart in memory and are never sent. On web a new visit is a new pathname: a query-only change (another channel on `/chat`) is the same page. `posthog-react-native` registers `$screen_name` for the session, so later events carry the template too.
- **App lifecycle** (mobile only): `captureAppLifecycleEvents` is on, so the SDK sends `Application Installed` / `Updated` / `Opened` / `Became Active` / `Backgrounded`. `Application Opened.url` is a deep link, reduced to its path by the sanitizer.
- **One per visit, inside the opt-out.** Both are sent from each app's `AnalyticsProvider` through a `createRouteViewRecorder` (`@repo/observability/identified-posthog`), which sends nothing while the chapter is opted out, records the route the member is on once the chapter read opts in, and records a visit once, so a gate that flips while the member stays put (a chapter switch reloads the chapter read) records nothing more. Mobile's `before_send` (`mobilePostHogBeforeSend`) also drops every SDK event while the app holds the chapter opted out, because the SDK sends `Installed` / `Updated` from its storage load, before its own queued opt-out runs. So the cold-start `Installed`, `Updated` and `Opened` usually go unrecorded: they fire before the chapter's answer. The first `$screen` after it marks the open.
- **Autocapture stays off** on both (`autocapture: false`; mobile uses no `PostHogProvider`).

## Correlation schema

These identifiers are distinct. Do not copy one into another.

| Identifier | Who mints it | Format | Where it travels | Must not |
| --- | --- | --- | --- | --- |
| `x-request-id` | Web/mobile `createFrappClient` and health probes (`withRequestIdInit`); API `requestIdMiddleware` honours inbound, else mints `req_<uuid>` | Opaque string | Request header, response header, internal logs, error JSON `requestId`, Sentry request headers (allowlisted), the `request_id` Sentry tag (the API's events, and web and mobile's failed-query reports, which read it from the error JSON), and from that tag or the request header the [`sentry-error-correlated`](#privacy-and-replay) marker. CORS `exposedHeaders` so browser JS can read the echo. | Be replaced by a Sentry/OTEL trace id; be a credential |
| Sentry trace id | Sentry SDK (its own tracing on the API, no OpenTelemetry provider) | Sentry/OTEL trace id | Sentry transactions/spans only | Be used as `x-request-id` |
| Sentry event id | Sentry, per error event | Sentry event id | Sentry; optional PostHog [`sentry-error-correlated`](#privacy-and-replay) marker | Be treated as a user id |
| PostHog `distinct_id` | API `hmac_sha256(salt, user_id)` | 64 lowercase hex | PostHog events; web and mobile Sentry `user.id` via identity | Be computed in a client bundle |
| PostHog chapter group | API `hmac_sha256(salt, chapter_id)` | 64 lowercase hex | PostHog groups (the client SDKs' `group('chapter', …)`, and `groups.chapter` on events the API sends, [below](#what-an-event-the-api-sends-carries)); activation-funnel `distinct_id` | Be a raw `chapter_id` |
| PostHog session id / replay id | PostHog, when a client SDK exists | Provider ids | Attached to Sentry as tags; never the other way around | Appear when the chapter has opted out, or in production replay before approval |

`GET /v1/analytics/identity` is the only client-visible source of the user pseudonym **and** the chapter-group pseudonym. The response is `{ distinct_id, enabled, chapter_group_id }`: both ids are 64 lowercase hex (or `null` when analytics is unconfigured); `chapter_group_id` is also `null` when no chapter is in context. Clients never hash. The salt is API-only. Web and mobile cache that response keyed by the **Supabase auth uid** (not `users.id` / `useViewerUserId`) and the active chapter. The query is **off** until that uid is known — a first paint must not cache a JWT identity under `"none"`, and a leftover `"none"` slot must not be applied after logout. A same-device magic-link account swap stays `authenticated` and can keep the same chapter; a chapter-only cache would keep the previous member's hex. The identity GET must use the **new** session's Bearer on the same turn as the uid change — mobile keeps an in-process token so a pending SecureStore write cannot send User A's JWT after User B is the session. While the next fetch is in flight — or if it fails (`retry: false`) — or if the settled payload has no valid hex (`enabled: false`, `null`, UUID, email) — PostHog identify/groups and Sentry `user.id` are cleared rather than left on the previous subject. Logout still goes through `resetObservabilityOnLogout`.

**Client product flags.** Web and mobile `isProductFlagEnabled` (via `@repo/observability/identified-posthog`) evaluates only the HMAC hex context. It returns `false` unless the bound adapter's `getDistinctId()` is 64-char lowercase hex (`isPseudonymHex`), in addition to chapter opt-out. A UUID, email, or missing distinct id never calls through as enabled, even if the vendor SDK would return true. After a successful identify (and chapter group when present) the adapter reloads flags against that hex context before the next evaluation is treated as settled. Landing stays flag-disabled (`advanced_disable_feature_flags`). Flags are not an authorization input — `can()` / guards still decide. The API evaluates no product flags: its server-side chain (`AnalyticsService.isProductFlagEnabled` over `PosthogRuntime.isFeatureEnabled`) had no caller and was removed (2026-10-07, #3222). The client helper above is unchanged, but no web or mobile code calls it yet, so no product behavior is flag-gated today (2026-10-07).

On the API, Sentry owns tracing, and under SDK v11 it registers no OpenTelemetry tracer provider (details under Request Tracing below). Create spans through the Sentry SDK, not `@opentelemetry/api`, whose spans would never reach Sentry; do not install a second global tracer.

### What an event the API sends carries

Named product events reach PostHog from the API (`PosthogRuntime.captureEvent`), keyed as above. Since [#3381](https://github.com/pdcarlson/Frapp/issues/3381) an event can also carry:

- **`app`**, the app that sent it: `web` or `mobile`, which the client reports in `POST /v1/analytics/events`'s `app` field and the API checks against that list; `api` for the activation funnel; or, on a [feature event](#feature-events), `web` or `mobile` as the API reads them from the request's `Origin` and `X-Client-Version` headers, and none when it can't place the request. So `app: api` marks the funnel, not every event the API sends. A client-reported value is the client's own word: the check stops a client from passing itself off as the API, not web from calling itself mobile. The API stamps it after checking the event's own properties, which may set neither `app` nor any `$`-prefixed key (PostHog's namespace: `$groups`, `$set`, `$process_person_profile`). A request that does gets a 400 whether or not analytics is configured, so properties a local run accepts are properties staging accepts. An event from a client that names no app (a build from before #3381) carries none. Events the client SDKs send directly (`$identify`, `$groupidentify`, their `sentry-error-correlated` marker, [route views](#route-views) and mobile lifecycle events) carry no `app`; PostHog's own `$lib` tells those apart.
- **`groups.chapter`**, the chapter group digest, on a user-keyed event whose chapter is known: the `chapter_id` the caller was verified a member of. An event with no `chapter_id` carries no group; the API does not pick one from the caller's memberships.
- **Person processing that follows the group.** PostHog links a group only on a person-processed event ("If `$process_person_profile` is set to `false`, the event won't link to the group", [group analytics](https://posthog.com/docs/product-analytics/group-analytics), read 2026-11-04), so an event with a chapter group is sent person-processed. Its distinct id is the user pseudonym the client `identify`s with, so it lands on that same person, and it sets no person properties (the API sends no `$set`, and its PostHog client has GeoIP off). Every other event the API sends is personless (`$process_person_profile: false`). PostHog still attributes a personless event to an identified person with the same distinct id; it only skips creating or updating one ([anonymous vs identified events](https://posthog.com/docs/data/anonymous-vs-identified-events), read 2026-11-04).

Activation-funnel events keep their chapter-keyed distinct id ([§ Identifiers](#identifiers)) and carry `app: api` but no chapter group: a group would need them person-processed, which would make each chapter a PostHog person.

## Privacy and replay

Identity, opt-out, and the forget path are owned by [`data-retention.md`](data-retention.md#analytics-events-pseudonymous). This section adds the replay and dual-capture rules that would otherwise be restated there.

- **PostHog exception autocapture is off** in every SDK and in the project. Errors are counted only in Sentry. A content-free PostHog **timeline marker** named **`sentry-error-correlated`** (kebab-case, same convention as `outbox-queued` / `task-created`) may attach `sentry_event_id`, Sentry `trace_id`, `request_id` (`x-request-id`), `route`, HTTP status *class* (`1xx`–`5xx`, from an integer status 100–599; any other status omits the property rather than guessing one), and `release` — never the body, query, exception type, stack, or message text.
- **Sentry Replay is not enabled** on any surface. Session replay and heatmaps are PostHog-only.
- **PostHog replay** is masked and blocklisted by default (`maskAllInputs` / React Native `maskAllTextInputs` is the floor, not the policy). It obeys `chapters.analytics_opt_out` immediately (`opt_out_capturing` / `optOut` + `stopSessionRecording`). It is **production-disabled until Paul approves** privacy disclosure, consent, and retention. **Correction (2026-09-09):** Workstream 5 keeps replay **off in every environment**, including staging. **Correction (2026-09-09):** Workstream 7 matches that posture on mobile. Mask/blocklist and the opt-out stop ship so a later flip is gated; chat/document capture is not proven masked. Production remains off until Paul approves (#2038). Expo Go is not native-crash or replay proof (#938 / #1361).
- Attach PostHog distinct/session/replay ids to Sentry events so an error can be traced into a replay without putting the exception in PostHog.

**Non-goals (do not ship to Sentry, PostHog, or any other external sink):** raw user or chapter ids, email, IP, tokens, query strings, request/response bodies, chat/document/upload content, AI prompts or outputs.

## Release naming

| Surface | `release` | `dist` / extra |
| --- | --- | --- |
| API, web, landing | git SHA + environment (`<sha>` tagged with Sentry `environment`) | environment from the platform (`NODE_ENV` / derived `VERCEL_ENV`), never a hand-copied twin |
| Mobile | bundle id + app version + native build number | git SHA as metadata only — not the release string |

Unset DSN still means `Sentry.init` is never called.

**Correction (2026-09-10):** API `Sentry.init` plus `sourceMap: true` is not TypeScript symbolication. Live `frapp-api` issues FRAPP-API-1 (`environment: staging`) and FRAPP-API-3 (`environment: production`) show compiled `/app/apps/api/dist/*.js` frames with ContextLines on-disk JS. The Node SDK reads the running `.js`; nothing in the image build invoked `sentry-cli`. Upload runs in `apps/api/Dockerfile` after `nest build` when `SENTRY_AUTH_TOKEN` is present (org `frapp-live`, project `frapp-api`, `--release` = `RENDER_GIT_COMMIT`). Without the token the build succeeds and skips upload — the same skip as Next.js `withSentryConfig`. ContextLines JS context is not a passing maps check. Human remaining: put `SENTRY_AUTH_TOKEN` in Infisical Staging + Production (path `/`) so the existing Render syncs pass it as a Docker ARG; live Render API env names on 2026-09-10 did not include it. That token work is the source-map half of #970 (same name as web), not a second issue. Which environments carry it now: [`ENV_REFERENCE.md` § apps/api](../../docs/internal/environment/ENV_REFERENCE.md#appsapi-nestjs--render), the `SENTRY_AUTH_TOKEN` row.

**Correction (2026-09-22):** The upload is best effort on every path, not only when the token is unset. With the token set, a `sentry-cli` inject or upload that cannot run, exits non-zero, is killed by a signal, or outlives its time bound (2 minutes for inject, 10 for upload) logs one `WARNING:` line per failed step (step, exit status, signal, spawn error), still strips `*.map`, and the image build succeeds: symbolication is telemetry and must not gate shipping the API. Nothing reads that `WARNING:` yet, for the API or for web and landing (whose Sentry plugin already continues past a failed upload), so a broken upload is found only when someone reads a minified stack trace (#2489). **Corrected 2026-09-30 (#2489):** the deploy now asks Sentry directly. Its last step checks that each project it built has an artifact bundle for the deployed commit, and `deploy-outcome` raises one P2 alert per project and environment when one doesn't; the upload itself stays best effort, and so does the check, which never fails a deploy ([`ci-cd.md` § Source maps](../../docs/ops/deployment/ci-cd.md#source-maps)). Inject rewrites each `*.js` and `*.js.map` in place (truncate, then write; no temp file and rename), so an inject killed or failing mid-write could leave a module cut short. The script therefore copies `dist` to a sibling snapshot before inject, and on any inject failure restores `dist` from it, byte for byte, before stripping; removal of the snapshot is attempted on every path (a leftover logs a `NOTE:`, never a `WARNING:`), and it never sits inside `dist` (from `apps/api/` the runner stage copies only `dist/` and `package.json` out of the builder), so it cannot ship. Upload only reads `dist` and needs no snapshot. Only a failure to strip `*.map`, or to restore `dist` after a failed inject, fails the build, because either would ship a wrong image. This was decided after the token reached the Render build and every `frapp-api-staging` build failed at `inject failed (null)`, because the script spawned a root `node_modules/.bin/sentry-cli` that the Docker deps stage never installs; it now resolves the `@sentry/cli` that `apps/api` declares and runs its native binary directly, since the package's JS wrapper reports a signal-killed CLI as exit 0, and a time-bound kill would stop only the wrapper and leave the native CLI still rewriting `dist` (#2431). The token reaching Infisical `staging` is what sent the staging build down the upload path; which environments carry it is recorded once, in [`ENV_REFERENCE.md` § apps/api](../../docs/internal/environment/ENV_REFERENCE.md#appsapi-nestjs--render). While `prod` is not confirmed to carry it, production API maps are unproven — the last production deploy, on 2026-09-17, may or may not have taken the upload path — and the `deploy-production.yml` warning that a web dry run can create a Sentry release whenever `prod` carries the token may already apply. **Corrected 2026-09-28:** since #2673 a production dry run withholds the token from the build and from the pulled env file, so it mints no release; that warning now applies only to a dry run of a commit from before #2673 ([`promotion.md`](../../docs/ops/database/promotion.md)). Merged PR #2107 added the upload step and did not add the token; its own description says the token was still missing.

## Logging sinks

Internal Render/stdout logs and PostHog logs are **independent transforms** of the same facts, not a pipe from one into the other.

- **Render stdout** (Nest console): the structured request log, `security_event`, and `push_delivery` records below. Raw `userId` / `chapterId` are allowed here because the stream is Frapp-internal. Email, IP, tokens, bodies, and query strings are not.
- **PostHog logs** (when enabled): the same operational facts after the external-reporting scrubber — pseudonyms instead of raw ids, `originHash` instead of addresses, path-only URLs, no tokens or bodies. Do not tail Render logs into PostHog.

## Sampling

Every rate is a number in `[0, 1]`. A missing, empty, non-numeric, or out-of-range env value falls back to the documented default and is logged at boot. `NaN` is not a legal rate (the SDK treats it as “tracing on”).

| Signal | Intended rate | Default / source |
| --- | --- | --- |
| Sentry error events | `1.0` | SDK default (do not set a lower `sampleRate`). Web and mobile rate-limit their query and mutation failure reports at the source instead ([§ Error Tracking](#error-tracking)) |
| Sentry traces | `0.1`; mobile `1.0` during the beta | `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` via `@repo/observability` `parseTracesSampleRate`, defaulting to `DEFAULT_TRACES_SAMPLE_RATE` (`0.1`). Mobile hardcodes `1` while one chapter is the only user (2026-11-06: at `0.1`, an afternoon of on-device testing left about nine spans), and goes back to `DEFAULT_TRACES_SAMPLE_RATE` before a second chapter joins ([#3580](https://github.com/pdcarlson/Frapp/issues/3580)). The API inherits a sampled parent: mobile sends `sentry-trace` and `baggage` to the first-party API (`tracePropagationTargets`), and the API sets only `tracesSampleRate`, so every API transaction a mobile request starts is kept too. Mobile at `1.0` therefore means the API's mobile-driven traffic at `1.0` as well, and lowering mobile lowers both |
| Sentry Replay | `0` | Not initialized |
| PostHog exception autocapture | `0` | Project + SDK: off |
| PostHog session replay (production) | `0` until approval | Then a documented rate in `[0, 1]`, still masked/blocklisted and opt-out-gated |
| PostHog product events | `1.0` of events that pass opt-out and content-free checks | No additional sample |
| PostHog route views and mobile lifecycle events | `1.0` of those sent while the chapter is opted in | No additional sample ([§ Route views](#route-views)) |
| PostHog logs | `1.0` of sanitized operational records (`request`, `security_event`, `push_delivery`, 5xx `error`) | `POSTHOG_LOGS_SAMPLE_RATE` via `@repo/observability` `parseSampleRate`; default `DEFAULT_POSTHOG_LOGS_SAMPLE_RATE` (`1.0`). Independent of Render stdout — not a pipe. |

## Verification and definition of done

A slice is done when **intended** behavior above is true in code **and** the matching provider setting is verified live, or the gap is an open GitHub issue. Do not tick a dashboard box from repo text.

| Claim | Authoritative evidence |
| --- | --- |
| Sentry owns exceptions | `Sentry.init` + both scrubber hooks; PostHog `autocapture_exceptions_opt_in` is false |
| PostHog owns product analytics | Staging/prod `POSTHOG_API_KEY` present; a real event visible; write-only `phc_` may ship in `apps/web` and `apps/landing`; salt and personal API keys stay out |
| No dual replay | No Sentry Replay integration; PostHog replay off in production until approval |
| Correlation | `x-request-id` ≠ Sentry trace id in a captured pair; identity returns hex-only pseudonyms |
| Pseudonyms | Salt API-only (bundle grep); identity HMAC matches server events |
| Landing anonymous | No identity call, no `alias` onto an authenticated id |
| Releases | Sentry event `release`/`dist` match the table above |
| API TypeScript stacks | A `frapp-api` issue after a Render deploy that uploaded maps shows `*.ts` frames. Compiled `dist/*.js` with ContextLines is not that. |
| Alerts | Live Sentry/PostHog/Render rules, dated, in [`alert-routing.md`](../../docs/ops/alert-routing.md) |
| Forget | #709's workflow live in the production PostHog project ([`posthog-deleted-users.md`](../../docs/ops/posthog-deleted-users.md)) and one deletion verified end to end |

Human-only until proven otherwise: #709 (PostHog deleted-users automation: live 2026-11-06, end-to-end check pending), #1173 (production PostHog project: `569878` renamed and keyed 2026-11-06, first production event pending), #863 (channel proof to the owner's phone; Sentry alert rules can be created through the Sentry MCP since 2026-11-05), #970 (web DSN actually capturing), #938/#1361 (EAS + mobile DSN capture), source-map `SENTRY_AUTH_TOKEN` in Infisical `prod`, network allowlists, production replay approval.

## Structured Logging

Every API request is logged as structured JSON with: request ID, user ID, chapter ID, endpoint, HTTP method, status code, response latency, the forwarded-chain shape (below), the calling mobile build (below), and timestamp. Matched routes emit that record from `LoggingInterceptor`. Unmatched routes never enter the interceptor (no handler), so `AllExceptionsFilter` emits the same sanitized `request` row for unmatched 4xx — path-only, sampled through `POSTHOG_LOGS_SAMPLE_RATE`, no exception message, query, email, or IP. Latency is omitted on that unmatched row (`latency_ms` / `latencyMs`): there is no interceptor start time, and inventing one would be a fabricated duration. 401 / 403 / 429 stay on the `security_event` row and are not also logged as `request` from the filter.

**Identifier handling (internal logs):** `user_id` and `chapter_id` are retained as raw values in internal structured logs because the logs are confined to Frapp-internal observability tooling and operate under the internal retention policy. They are **not** PII-scrubbed at the log boundary — scrubbing applies only at external-reporting boundaries (Sentry / external observability vendors). Email addresses, IPs, auth tokens, request bodies, and response bodies are never logged. The auth-token half of that rule is not only about the `Authorization` header: a query string is free text on a public surface and routinely carries credentials — the Discord connect callback's `state` **is** the CSRF token. Two rules follow ([#1260](https://github.com/pdcarlson/Frapp/issues/1260)):

1. **Every log site that writes a request path routes it through `pathOnly`** (`apps/api/src/interface/utils/path-only.ts`), which is what makes the `path` row below true rather than aspirational. It strips the query *and* the scheme/host/userinfo of an absolute-form request target, because `req.url` is the request line verbatim and a caller may send `http://user:pass@host/path`.
2. **`pathOnly` covers the path field only** — it says nothing about a credential a service interpolates into a message of its own. Those are the responsibility of each log site: no handshake, session or CSRF value may be logged in the clear, spent or not. The Discord callback is the worked example — it logs neither the state id nor unsanitized query values.

Caller-supplied text reaching a log message goes through `logSafe` (`apps/api/src/infrastructure/observability/log-safe.ts`) first. The API uses Nest's default console logger, so a record is a `[Nest] <pid> - <ts> <LEVEL> [<Context>]` prefix followed by the message. During a request the context also carries `x-request-id` (`[<SearchService req_…>]`) via `RequestContextLogger` (`apps/api/src/infrastructure/observability/request-context-logger.ts`), which reads AsyncLocalStorage bound in `requestIdMiddleware`. Records emitted outside a request (boot, cron, workers) keep the original prefix. This is not a JSON-mode switch and does not replace the HTTP interceptor's structured request log. The request log and `security_event` carry a JSON body and are one line each, so an unescaped newline in an attacker-chosen value splits the record and lets the caller write a line of their own choosing into the stream an incident investigation reads. **A record is not one line in general**, though: `logger.error(message, stack)` prints the message and then the stack across further lines, and this subsystem logs at `log`, `warn` and `error` alike — so neither line count nor level tells a forged line from a genuine one. The `[Nest]` prefix is the only marker a caller cannot supply, and a stream a caller can write arbitrary lines into is not one worth reasoning from.

**Forwarded-chain shape (`xffCount`, `xffSocketIsLast`).** The request log carries two facts about the `X-Forwarded-For` chain and **no address from it**: `xffCount`, the number of entries (`0` when the header is absent), and `xffSocketIsLast`, whether the socket peer *also* appears as the chain's final entry. Both are computed in `forwardedShape` (`apps/api/src/interface/utils/http-request-log.ts`); the addresses are compared in process and discarded.

They exist to settle one question the IP rule would otherwise make unanswerable, and they have now settled it. Express resolves `req.ip` from the forwarded chain only when `trust proxy` is set to a **hop count matching the real number of proxies** — setting it to `true` instead is *worse* than leaving it unset, because it trusts the whole chain and lets a client forge and rotate addresses. That count cannot be reasoned out from the outside: `api-staging.frapp.live` shows **two** branded proxy layers (Render's Cloudflare CDN in front of the Render origin), but the measured chain carries **three** appended entries — there is a hop inside Render's ingress that no header inspection reveals. Probing with 0, 1 and 2 forged entries returned `xffCount` 3, 4 and 5, exactly linear, so staging's infrastructure contribution is three ([#864](https://github.com/pdcarlson/Frapp/issues/864)). **The count is per service, not per platform:** production's request log shows `xffCount` 2 for callers that send no chain of their own (Stripe's webhook deliveries), so `TRUST_PROXY_HOPS` in `apps/api/src/bootstrap.ts` is 2 for the production deployment and 3 otherwise. Production used to run staging's three, which let one forged entry choose `req.ip` there, and it keeps doing so until a Deploy production run carries [#2972](https://github.com/pdcarlson/Frapp/issues/2972)'s fix. A deployed process reports the first external request whose chain is shorter than its count to Sentry (`trust proxy hop count exceeds the forwarded chain`), because that is what a stale count looks like from inside. The method generalises: probe with a known number of forged entries, then subtract — the remainder is what the proxies in front appended. `xffSocketIsLast` is a guard rather than a second signal; it is normally `false`, because each proxy appends the peer it received from and so the nearest proxy's own address is the one the chain never carries. A `true` would mean something is echoing its own address, and that the count needs checking before anything is set from it. **The addresses are not an input to that arithmetic**, which is why this is a cardinality and a comparison rather than the raw header — the IP rule above is not relaxed, or amended, by this field pair.

**Calling build (`clientVersion`).** The mobile app sends `X-Client-Version` on every request ([#2526](https://github.com/pdcarlson/Frapp/issues/2526)), and the request log carries it as `clientVersion` (`client_version` on the PostHog row), so a minimum supported version can be chosen from the builds actually calling. The value is the parsed header written back out (`ios/0.9.0+12`), never the raw text; a header that doesn't parse is logged as `invalid`, and the field is absent when none was sent, as from the web dashboard.

**Request origin (`originHash`).** The IP rule above is unconditional, but a security signal such as "this origin has failed auth twenty times in five minutes" needs a *stable key per origin* — which is not the same thing as needing the address. Where a record must group by origin it carries **`originHash` = `hmac_sha256(salt, ip)`** under the same per-environment salt as every other pseudonym here, and never an `ip` field. The field is named for what it holds so it is not later "fixed" by substituting the raw value. Unlike the user and chapter hashes this one is not reversible-resistant against an attacker holding the salt — the IPv4 space is small enough to enumerate — which is a property of the address space, not a reason to log the address instead.

## Request Tracing

A unique `x-request-id` header is generated for each incoming request (or preserved if the client sends one). Web and mobile mint one on every SDK call (`createFrappClient` in `@repo/api-sdk`); the API honours that inbound value and otherwise mints `req_<uuid>`. This ID is included in all log entries and all error responses, enabling end-to-end tracing. The request ID itself is non-PII and may be surfaced in client-facing error messages. CORS names `x-request-id` (and the Sentry `sentry-trace` / `baggage` headers, which are a **different** identifier space) in `exposedHeaders` so a cross-origin dashboard can read them (`apps/api/src/interface/http/cors.options.ts`, which also holds each deployment's exact allowed origins).

**"All" includes denials, which makes the placement load-bearing.** The id is assigned by `requestIdMiddleware` (`apps/api/src/interface/middleware/request-id.middleware.ts`), registered as Express middleware ahead of the Nest pipeline. It cannot be an interceptor: Nest runs middleware → guards → interceptors, so a request rejected by a guard never reaches one, and every 401/403/429 would carry `"requestId": "unknown"` — precisely the requests a tracing id is most useful for. The same middleware binds a request-scoped AsyncLocalStorage store (request id only) so Nest `Logger` calls from services see the id, and tags the Sentry isolation scope `request_id` so a trace can be joined to the correlation id without becoming it.

On the API, Sentry owns tracing (ADR-22). `Sentry.init` lives in `apps/api/src/instrument.ts`, imported first from `main.ts`. Under SDK v11 it registers no OpenTelemetry tracer provider (`enableOpenTelemetrySetup: false`): spans come from Sentry's own instrumentation. Do not install `@opentelemetry/sdk-node` (or any other global tracer). Traces use `traceLifecycle: 'static'`, because v11's default (`'stream'`) skips `beforeSendTransaction` and with it the transaction scrubber. HTTP spans do not collect request bodies (`maxRequestBodySize: 'none'`). Fetch spans do not copy headers onto attributes. Span attributes that leave the process still pass the scrubber allowlist (`http.request.method`, `http.response.status_code`, `db.system`, `sentry.source`, and the push worker's three fan-out counts `chat.push.recipients`, `chat.push.sent` and `chat.push.presence_channels`); `http.url`, `url.query`, and `db.statement` do not.

## Health Check

Two endpoints, both unauthenticated:

- **`GET /health`** — liveness. Always returns 2xx while the process is up, with `status: "ok" | "degraded"`, database connectivity, Supabase Storage connectivity, and uptime in the body. The database and Storage fields come from one probe each instance reuses for up to 60 seconds (`LIVENESS_PROBE_TTL_MS` in `health.controller.ts`), so they can trail an outage or a recovery by that long. No automated caller reads them: Render and the web and mobile connection monitors act on the status code alone, and probing on every call cost two fresh-TLS Supabase requests per Render check, every 5 seconds. A person or agent checking a dependency right now, after a migration, a rollback or a repair, uses `/health/ready`. When Render has set `RENDER_GIT_COMMIT` to a git SHA, the JSON also includes `commit`; the field is omitted when that env is unset or not a SHA, so local and CI do not invent one. This is Render's `healthCheckPath` (`render.yaml`); it must never itself flip to a non-2xx status, since that is a dashboard-level decision about restarting/rolling back the instance, not this endpoint's to make. It never calls Stripe. `commit` is not copied into the `/health/ready` 503 `message`.
- **`GET /health/ready`** — readiness. Runs the same dependency probes, fresh on every call and never from the `/health` cache, but returns **503** when any dependency is degraded. Its 2xx body is the same payload as `/health`, `commit` included, and both environments' deploys depend on that. The shared deploy job (`_deploy.yml`) passes only when `/health/ready` answers 2xx **and** its `commit` is the SHA it expects, since during a switchover the previous instance answers 2xx too. For staging that is the SHA its plan named: the one it deployed, or the one staging already served when nothing needed deploying ([#2505](https://github.com/pdcarlson/Frapp/issues/2505)). For production it is the deployed commit, or on a `migrations-only` run the commit production already served ([#2680](https://github.com/pdcarlson/Frapp/issues/2680)). Dropping `commit` from this body fails every deploy in both environments, and so ships no web or landing either, since they upload only after this check. After database and Storage are connected, it also retrieves the configured Stripe Price (`StripePriceConsistencyService`); a missing/inactive Price or a secret/account mismatch 503s with `billing:` in `message`, followed only by a fixed category: the mismatch's own code (`price_inactive`, `price_id_empty`), else the Stripe error's code or API type (`resource_missing`, `api_key_expired`, `authentication_error`), else `misconfigured`. The route is public, so the configured `STRIPE_PRICE_ID` and Stripe's error text (which for a revoked key names its type and last four characters) go only to the API's error log and the Sentry event's cause, which the response's request id leads to ([#2999](https://github.com/pdcarlson/Frapp/issues/2999)). That deploy check polls this path rather than `/health`, so a database or Storage outage — or that Price mismatch — actually fails the post-deploy gate instead of reading a `200` with a discarded `"degraded"` body. A Stripe network blip is not treated as degraded (boot and ready warn and continue) so it cannot cancel a deploy. The 503 goes through the API's global exception filter like every other error response, so the body is the standard error shape ([`architecture/README.md` § Error responses](../architecture/README.md#error-responses)), with `code: "DEGRADED"`, rather than the raw `{status, database, storage, uptime}` object — `message` names which dependency is degraded (e.g. `"database: error, storage: connected"`). It does not cover the chat workers' Realtime subscriptions, by decision ([#3365](https://github.com/pdcarlson/Frapp/issues/3365)): a Realtime outage would otherwise fail every deploy and read as the API being down while it serves requests. A worker whose subscription stays down reports to Sentry at error level instead ([`render.md` § 5.5](../../docs/ops/deployment/render.md#55-in-process-chat-workers-chunk-05)).

## Error Tracking

Sentry is the exception SoR ([§ Provider ownership](#provider-ownership)). All unhandled exceptions and 5xx responses are reported with: request ID, endpoint, HTTP method, status code, and stack trace.

The API also reports failures it handles rather than propagates: for example the auth-failure spike ([§ Auth-failure spikes](#auth-failure-spikes)), a paid checkout for a chapter this database doesn't have, and a Discord connect callback turned into a redirect. These and the 5xx report go through one seam, `reportSwallowed` (`apps/api/src/infrastructure/observability/report-swallowed.ts`), and so does any new capture in the API. Reporting is a side channel. The seam never throws, so an unreachable Sentry can't turn a webhook ack, a 401 or a redirect into an error, and every caller writes its own log line for the event, so a failed report loses the alert, not the record. The one capture outside it is `main.ts`'s boot-failure report, which has to `flush` before the process exits.

**A caught failure that drops work reports to Sentry** ([#3379](https://github.com/pdcarlson/Frapp/issues/3379), [#3364](https://github.com/pdcarlson/Frapp/issues/3364)). The SDK does not capture console output, and `AllExceptionsFilter` sees only what propagates, so a `catch` that only logs is invisible to every alert: the failure is in Render's logs and nowhere else. A catch that does not rethrow therefore calls `reportCaughtFailure` (`apps/api/src/infrastructure/observability/report-caught-failure.ts`). It writes the site's log line as `logThrowable` would, then reports through `reportSwallowed`, so it never throws either.

- **Level:** `error` when work was dropped or left inconsistent: a sweep that skipped its tick, a reminder that will not be retried, a claim that could not be released. `warning` for a per-row or best-effort step the caller absorbs, such as one row of a sweep or one recipient of a fan-out.
- **Grouping:** by the site that caught it, then by what was caught: fingerprint `['caught-failure', <site>, …]`, with one `kind[:code]` token per error in the cause chain, the same tokens as `errorFingerprint`. The site is a stable lowercase id, also sent as the `caught_at` tag, so one catch failing one way is one issue wherever the throw came from. A helper several callers share adds the caller after a `:`, as in `scheduled-sweep-candidate-read:invoice` or `scheduled-dispatch-claim-failed:invoice.due-soon`, so each sweep is its own issue. The dispatch helpers key on the reminder's entity type and threshold, so one sweep with two thresholds (an invoice due soon and overdue) is two.
- **Rate limit:** one event per fingerprint per 10 minutes in each API process (`CAUGHT_FAILURE_REPORT_INTERVAL_MS`). The log line is never throttled. So a database outage gives one event per sweep per window, not one per tick or per row, and a fault recurring at a site cannot hold back a different one there.
- **What the event carries:** the caught error, normalized by `toReportableError` and scrubbed like any exception, or for a failure with nothing thrown, the fixed text `caught failure: <site>`. The site's own log message is never sent, because it can interpolate ids or member-supplied values. Tags are low-cardinality identifiers only.
- **Cron sweeps catch their own failures.** `@nestjs/schedule` catches a rejected `@Cron` handler and hands the raw throwable to Nest's `logger.error`, which reaches no alert and can print a PostgREST `details`. So no sweep lets a failure reach it. The report-retention and chat-report-evidence handlers in `scheduled-jobs.service.ts`, and the Discord import worker's tick, catch at the top. The auto-absent, reminder, invoice, task, poll and palette sweeps read their candidates through the repository's `fetchAllPages`, which reports under `scheduled-sweep-candidate-read:<sweep>` and returns nothing, and catch each row on its own.
- **Enforced by** `caught-failure-coverage.spec.ts`. Outside the observability folder, it fails on any error-level log call (`logger.error(…)` or `logThrowable(…, 'error', …)`) unless the comment directly above it (up to six `//` lines, no blank line between), or the same line, reads `// caught-failure-exempt: <reason>`. Only calls on a `.error(` method and `logThrowable` are seen, and the standalone scripts that run outside the Nest app, where Sentry is never initialized (`export-openapi.ts`, `backfill-discord-mention-tokens.ts`, `backfill-discord-import-people.ts`), are skipped. A reason is a fact about that catch: the error is rethrown and the filter reports the 5xx, it is reported a few lines away, or it is a boot failure before Sentry is initialized. Warn-level calls are not checked: a warning is a degradation the caller absorbs, and most of those are not worth an alert.

**Web and mobile report failed queries and mutations** ([#3377](https://github.com/pdcarlson/Frapp/issues/3377)). Each app's `QueryClient` is built with a `QueryCache` and a `MutationCache` whose `onError` goes through one shared reporter, `createQueryErrorReporter` in `packages/observability/src/query-errors.ts`. Each app binds it once in `lib/sentry/query-errors.ts` with its own SDK's `captureException`, its online reading and TanStack's `isCancelledError`; mobile's `clientPolicyQueryClient` is wired the same way as its product client. Like `reportSwallowed`, it never throws: `MutationCache` awaits it before the mutation's own `onError`.

- **What is reported:** every final failure, after retries, at `warning` level. That covers an HTTP answer, a fetch that got no response while the app reads online (a timeout, an outage, a CORS fault), and an exception thrown inside a `queryFn`, which is how contract drift between a shipped build and the API shows up.
- **What is not:** a 401 or 403, which the auth flow answers; a cancelled query or an `AbortError`; and a failure with no status while the app reads offline. A failure that does carry a status is reported whatever the online reading says, since a response arrived. Web reads offline when `navigator.onLine` or TanStack's `onlineManager` says so, and `onlineManager` moves only on the window's `online`/`offline` events. Mobile reads `onlineManager`, which the connection monitor drives: it reads offline after a confirmed link drop, and also after three failed `/health` probes with the link up. So during an API outage, or in a build pointed at the wrong API, mobile reports the dead fetches from before the monitor flips (at launch, before the first probes answer) and then nothing until it reads online again; the API's uptime check reports the outage itself. Web chat dispatch, which reports its own failures, calls chat-core directly and sends through the outbox, never through either cache, so it can't be reported twice.
- **What the event carries:** identifiers only. Tags are `query_kind`, `query_key_root` (the query key's first element, or a mutation's `mutationKey` root, or `unkeyed`), `query_failure` (`http`, `network` or `exception`), and for an HTTP failure `http.status_code`, `status_class` and the API's machine `code` as `error_code`. `request_id` comes from the error body's `requestId`, the id the API logged the request under, so a client event joins the API's own. Later key elements, which hold ids and in `["search", chapterId, query]` a member's typed text, and `queryHash` are never sent. TanStack's own errors put the whole hash in their message (`<queryHash> data is undefined`), so one of those is sent as a copy with the hash replaced by `[query-key]`. An HTTP failure or a dead fetch is reported as an `Error` the reporter builds from those identifiers (`ApiError: query "members" answered 503`), never as the API's body, whose `message` is free text. An `Error` thrown inside a `queryFn` is reported as it is, the way the route boundaries report what they catch, and the free-text sweep below applies to its message.
- **Grouping:** fingerprint `['react-query', <kind>, <root>, <status class or 'network'>]`, plus the API `code` when there is one. An `exception` keeps Sentry's own grouping, `['{{ default }}', 'react-query', <kind>, <root>]`, so two bugs under one root stay two issues. Most mutations set no `mutationKey`, so their failures group under `unkeyed` per status class ([#3393](https://github.com/pdcarlson/Frapp/issues/3393)).
- **Rate limit:** one report per fingerprint per 10 minutes for each `QueryClient`, so a query failing on every focus, reconnect or retry can't flood the project. An `exception` leaves its split to Sentry, so it is limited per root, error type and message instead. The memory behind the limit is bounded (`MAX_REMEMBERED_RATE_KEYS` in `packages/observability/src/query-errors.ts`), and the oldest entry goes first, so a session that throws many different exceptions can report an older failure again early. This is the deliberate drop § Sampling refers to.

**Mobile reports the render errors its boundaries catch** ([#3378](https://github.com/pdcarlson/Frapp/issues/3378)). A caught render error never reaches the SDK's global handler, so a boundary that only drew a fallback would hide the failure from Sentry. `apps/mobile/components/route-error.tsx` reports each one with `captureException`, tagged `error_boundary` (`screen`, `tabs`, `root`, or `sheet` for a quick-actions sheet the tab bar hosts, which it then drops so the bar keeps working) and `route_path`, the route as expo-router's `usePathname` spells it (`/event-details`, `/sign-in`). No mobile route has a dynamic segment, so the path names a screen, never a record. Each tab screen has its own boundary through the tab navigator's `screenLayout`, and the root and tab-group layouts export expo-router's `ErrorBoundary` for what those can't catch. Each error object is reported once however many times its fallback remounts, through `createReportOnce` in `packages/observability/src/report-once.ts`, which web's degraded-segment boundary uses too. A retry that fails again (Retry, the screen opened with new params, or the member leaving the screen, which clears a screen's fallback) usually throws a new object, so it is a new report; each is a member's action, so the count stays bounded by what they do. The event carries no React component stack: `react` is not on the scrubber's context allowlist, so it would be dropped before sending. Copy: [`writing.md` § Mobile render errors](../ui/design-system/writing.md#mobile-render-errors).

External error reporting requires explicit PII handling:

- **Pseudonymized before sending:** `user_id` and `chapter_id` are sent as HMAC-SHA256 hashes using the same per-environment salt as the analytics pipeline (see [`data-retention.md`](data-retention.md#analytics-events-pseudonymous)). Reversing the hash requires access to the salt, which is held outside the error-reporting provider.
- **Redacted entirely:** email addresses, IP addresses, auth tokens (including any `Authorization` header value), request bodies, response bodies, message contents, document contents, and any free-text fields that may contain user-typed PII.
- **URLs are reduced before they leave.** `request.url`, the transaction name, and HTTP-shaped span descriptions (`span.description` and `contexts.trace.description`) are cut to a **path** — query, fragment, scheme, host and `userinfo` all gone. An HTTP method prefix may remain (`POST /i/v1/logs`). That is a parse, not a pattern: `stripAuthority` in `packages/observability/src/sentry-scrubbing.ts` reduces an absolute-form target, which RFC 9112 permits on any request and which Node hands to `req.url` verbatim, so `GET http://user:pass@host/path` cannot ship its credential. The **same parser** backs the API's internal request log (`apps/api/src/interface/utils/path-only.ts`), so the internal and external sinks cannot drift apart again — they had, and backwards, with the third-party boundary as the leaky half ([#1388](https://github.com/pdcarlson/Frapp/issues/1388)). A URL in **free text** (exception messages, breadcrumb messages) keeps its host and path, because those are diagnostic and an exception message is the payload worth having; its query string and its `userinfo` are still removed. Span descriptions are **not** free text — they are the same class as transaction names. One deliberate non-reduction: a `//`-leading target is preserved verbatim rather than being read as protocol-relative, since rewriting it would turn `//x/v1/chapters/join` into the real route `/v1/chapters/join` and forge the field.

- **A failed Supabase query is thrown as a real `Error`, from the method that ran it.** postgrest-js only builds a `PostgrestError` on the `.throwOnError()` path, so the `error` a query destructures out of `{ data, error }` is a plain `{ code, message, details, hint }` object. Thrown as it is, it has no stack, and `String()` on it is the literal text `[object Object]`, which is what [FRAPP-API-1](https://frapp-live.sentry.io/issues/FRAPP-API-1) recorded in place of a `PGRST205`. A query site therefore throws `new SupabaseQueryError(error)`, never the raw value (`apps/api/src/infrastructure/supabase/supabase-query-error.ts`, [#1264](https://github.com/pdcarlson/Frapp/issues/1264)), and a site that turns the failure into another exception passes it as that exception's `cause` (the auth, chapter and permission guards do, for their 503, #3143). Its message is `code: message: hint`, it keeps `code` and `hint` as fields so a caller can still branch on the SQLSTATE, and its stack starts at the failing method, so Sentry's frames point at the query rather than at the reporting code. `supabase-query-error-throws.spec.ts` fails when a query's destructured `error`, or a result's `.error`, is thrown raw anywhere under `apps/api/src`. It is a syntax scan, and its docblock lists the shapes it cannot see, among them a helper that throws an `error` passed into it and a site that drops the `error` instead of throwing it. Storage-js and auth-js errors are real `Error`s already and are thrown unchanged.
- **Any other throwable that is not an `Error` is normalized before it is reported.** Nothing guarantees what a `throw` carries: a Realtime `err`, a `Promise.allSettled` reason or a vendor SDK can still hand over a bare object. `toReportableError` in `apps/api/src/infrastructure/observability/reportable-error.ts` rebuilds such a value into an `Error` named `NonErrorThrowable` with the same `code: message: hint` message, falling back to a capped, throw-guarded JSON serialization of the remaining fields when the object carries none of those, and passes a real `Error` through untouched. **`details` is excluded on every path, from internal logs as well as from Sentry:** it is the field Postgres fills with the offending row values, so it is the most sensitive of the four and the least diagnostic — the constraint that failed is already named in `message`. `SupabaseQueryError` never carries it, and the opaque fallback strips that key before it serializes; a 1000-character cap bounds volume, not sensitivity.
- **A 5xx thrown from a `catch` carries what it caught as `cause`, and is grouped by it.** A catch that turns a provider failure into a generic `ServiceUnavailableException` (or any other Nest exception with a 5xx status, or an `HttpException` given one) passes `{ cause: toReportableError(error) }`. The call matters as much as the key: `LinkedErrors`, which the API keeps from the SDK's default set, follows only an `Error` cause, so a raw PostgREST object there would be dropped. The client still gets only the generic message, because `AllExceptionsFilter` serializes only the documented error body ([`architecture/README.md` § Error responses](../architecture/README.md#error-responses)), never the cause. Sentry gets the cause as a second exception value, with the value allowlist and free-text sweep below applied to each value. A cause alone does not split issues, though. Sentry groups an exception by its type and in-app stack and ignores the message once the stack counts. A Stripe error's `name` is `Error` (the SDK puts the class on `type`), and a normalized PostgREST object's stack is always the normalizer's. So the filter also sets a fingerprint, `{{ default }}` plus one `kind[:code]` token per error in the chain (`errorFingerprint` in `apps/api/src/infrastructure/observability/error-fingerprint.ts`), and so does every report of a caught throwable through the reporting seam above, such as a failure the Discord connect callback turns into a redirect instead of a 5xx. The same fingerprint goes on a bare object throw, whose `code` `toReportableError` keeps, and on a lone `SupabaseQueryError`: its stack tells one query from another, but not a statement timeout from a missing column at the same query. A thrown primitive has no token to key on, so it keeps Sentry's default grouping. The tokens are identifier-shaped only, never a message. With them, a bad price and a timeout at one call site are two issues, and one fault stays one ([FRAPP-API-4](https://frapp-live.sentry.io/issues/FRAPP-API-4), [#2131](https://github.com/pdcarlson/Frapp/issues/2131)). `rethrown-server-error-cause.spec.ts` fails when a `catch` clause, a `.catch(…)` handler or a `.then` rejection handler throws one of those exceptions without `cause: toReportableError(…)`. It does not see a throw built by a helper function.

Enforced in one place — `packages/observability/src/sentry-scrubbing.ts` — on these rules, and the rules cover **both classes of event Sentry emits** for **every app that reports**. The SDK routes the two classes to two different hooks, so `createSentryScrubber` returns an entry point for each, and each app's options module wires both: `scrubSentryEvent` as `beforeSend` for error events, and `scrubSentryTransaction` as `beforeSendTransaction` for transaction (tracing) events. Setting only one leaves the other class shipping unscrubbed, which is the gap [#896](https://github.com/pdcarlson/Frapp/issues/896) closed.

The browser SDK also sends one thing that is neither class: a **standalone span**, built straight from the span and sent past both hooks. INP is the one both Next apps emit. A third entry point, `scrubSentryEnvelope`, covers it. It runs in the client's `beforeEnvelope` hook, the last point before the transport, where the whole envelope (header included) is visible. `sentryEnvelopeScrubIntegration()` from `@repo/observability/next` registers it, and `apps/web` and `apps/landing` each add that integration to their browser `integrations`. It rebuilds every envelope's `trace` header from the same Dynamic Sampling Context allowlist the event hooks use. It rebuilds each span in a `span` item field by field: identity, timing, status, a reduced name, and allowlisted attributes. An attribute carrying a URL keeps only its path, and one outside the allowlist is dropped, `user_agent.original` included. A span item that isn't the expected shape, or that throws, is removed ([#2736](https://github.com/pdcarlson/Frapp/issues/2736)).

Both hooks also carry `sdkProcessingMetadata` field-by-field through `scrubSdkProcessingMetadata`, keeping only `dynamicSamplingContext` (swept) and `spanCountBeforeProcessing` — the two fields the SDK reads back *after* the hook returns, to build the envelope's `trace` header and to compute how many spans were dropped. The rest of that bag (`normalizedRequest`, a full request object) is dropped. This was symmetric only on the transaction path until [#966](https://github.com/pdcarlson/Frapp/issues/966); every error event shipped with no `trace` envelope header until then.

The scrubber is shared rather than per-app because a browser bundle holds strictly *more* PII than the server process does — member emails, chapter names, chat message bodies, document titles — so a second copy of these rules for the client would be a second copy to keep correct, and the failure mode is silent ([#865](https://github.com/pdcarlson/Frapp/issues/865)). Four bindings consume it:

| App | Options module | Pseudonyms | Runtimes initialized |
| --- | --- | --- | --- |
| `apps/api` | `src/infrastructure/observability/sentry-options.ts` | `ANALYTICS_HMAC_SALT` via `pseudonyms.ts` | Node |
| `apps/web` | `lib/sentry/options.ts` | none — `NO_PSEUDONYMS` | browser, Node server, edge |
| `apps/mobile` | `lib/sentry/options.ts` | none — `NO_PSEUDONYMS` | React Native (Expo) |
| `apps/landing` | `lib/sentry/options.ts` | none — `NO_PSEUDONYMS` | browser, Node server, edge |

**No client holds the salt, and that is deliberate.** `ANALYTICS_HMAC_SALT` is API-only; putting it in a client bundle would let the analytics dataset be rainbow-tabled back to raw user ids. A React Native bundle is as readable as a browser one, so this applies to `apps/mobile` exactly as it does to `apps/web`: both pass `NO_PSEUDONYMS`, and the free-text sweep *redacts* identifiers (`[redacted:id]`) where the API *hashes* them (`[id:<hmac>]`) — the same fail-closed branch the API takes when its own salt is unset. The single exception is the user pseudonym, which a client does not compute but reads already-hashed from `GET /v1/analytics/identity`; the scrubber's `/^[0-9a-f]{64}$/` gate re-checks it independently, so nothing upstream can put a raw id on an event. `apps/web` and `apps/mobile` both do this through `observability-identity-provider.tsx`. `apps/landing` sets no Sentry user at all (anonymous marketing visitor), so it has no identifier in play. Chapter ids get no client pseudonym and are dropped.

Each binding reports to its **own Sentry project** — `frapp-api`, `frapp-web`, `frapp-mobile`, and `frapp-landing` — so a server error, a browser error, a device crash, and a marketing-site error do not share a stream, a noise profile, or an alert threshold. A binding with no DSN configured never calls `Sentry.init` at all, so an unconfigured surface reports nowhere rather than reporting somewhere unexpected. `apps/landing` initializes Sentry when `NEXT_PUBLIC_LANDING_SENTRY_DSN` is set, and PostHog JS when `NEXT_PUBLIC_POSTHOG_KEY` is set; both stay anonymous ([§ Provider ownership](#provider-ownership)). Do not point landing at `NEXT_PUBLIC_SENTRY_DSN` (`frapp-web`).

The two hooks cannot share one function. A transaction carries its trace payload in `spans`, which is absent from the error-event key allowlist — so pointing `beforeSendTransaction` at `scrubSentryEvent` would still *deliver* every transaction, just with the span tree silently emptied. The transaction scrubber therefore keeps `spans` and rebuilds each span field-by-field: identity and timing survive, HTTP-shaped `description` is reduced with the same path-only parser as `request.url` / the transaction name (method may stay; scheme, host, userinfo, query, and fragment must not), `op` goes through the free-text sweep, and span attributes (`data`) are held to a small allowlist of non-PII OpenTelemetry keys because that bag routinely carries `http.url`, `url.query`, and `db.statement`.

- **Allowlist wherever the structure is enumerable.** Top-level event keys, request fields, headers, contexts, stack frames, exception values, and breadcrumbs are rebuilt from what is permitted rather than filtered for what is forbidden. A denylist starts leaking the day the SDK adds a field, and nobody reads their own error reports looking for PII. Stack frames keep `filename`, `function`, `module`, `lineno`, `colno`, `in_app`, `abs_path`, and source context (`pre_context`/`context_line`/`post_context`); source context is swept by `redactFreeText` so a key-shaped literal in source does not reach Sentry, and unknown frame fields (including `vars`) are dropped by omission. Exception values keep `type`, `value`, `module`, `thread_id`, a rebuilt `mechanism` (no `data`/`meta`), and the allowlisted stacktrace; `raw_stacktrace` and any other sibling are dropped by omission. `debug_meta` keeps only its source-map images, each `type: "sourcemap"`, a UUID `debug_id`, and a `code_file` swept exactly like the frame path it names, so the two still match: that pairing is how Sentry finds an uploaded map. Native images are dropped, because frames keep no `instruction_addr` to pair them with. Before the fix for [#3380](https://github.com/pdcarlson/Frapp/issues/3380) (2026-11-06) the key was missing from the allowlist, so every API, web, landing and mobile JS event arrived compiled while the deploy check found their bundles; each surface stays that way until it ships a build with the fix. The API's path is checked end to end: `sentry-integration.spec.ts` runs the real `sentry-cli sourcemaps inject` on a module, throws from it through production's hooks, and asserts the shipped event carries the injected ID for that file. Web, landing and mobile have only the scrubber's own unit tests, which build `debug_meta` by hand. Breadcrumbs keep `timestamp`, `type`, `category`, `level`, `event_id`, and a swept `message`; `data` and unknown fields are dropped by omission, not by `delete` after a spread. The one breadcrumb copy that keeps some `data` is the one a mobile device records for its native crash reports (below).
- **A DOM selector keeps its structure, never its attribute values.** The browser SDK names an element by tag, id and classes, then appends its `aria-label`, `type`, `name`, `title` and `alt` values, and in `apps/web` those hold member names, channel names and filenames. So wherever a selector leaves, each `[attr="value"]` becomes `[attr]`: a `ui.click`/`ui.input` breadcrumb's `message`, a span or transaction name, the INP span's `browser.web_vital.inp.target` and segment name, and the envelope's `trace.transaction`. The SDK doesn't escape a value, so a result that no longer reads as a selector is replaced whole with `[redacted:selector]`. The LCP and CLS selectors (`lcp.element`, `cls.source.N`) ride the pageload transaction as span attributes, which the attribute allowlist drops. The scrubber's docblock lists every place a selector surfaces ([#2736](https://github.com/pdcarlson/Frapp/issues/2736)).
- **A mobile touch names the element by code, never by its label.** `Sentry.wrap`'s touch boundary records a `touch` breadcrumb for every tap and a `ui.multiClick` breadcrumb for a rage tap. It names the touched element by its `sentry-label`, `accessibilityLabel`, `aria-label` or `testID`, or failing those by up to 64 characters of its visible text, and in `apps/mobile` those hold member names, task titles and message bodies. `reduceTouchBreadcrumb` rebuilds both crumbs. The message names the first element on the touch path that has a component name (`Pressable`, or `TaskRow (task-row.tsx)` under the component annotation plugin), or reads `[redacted:label]` when none has one. Mobile also runs the rule when the crumb is recorded (next bullet), and that native copy keeps a `data` of only the path's component, element and file names and a rage tap's `clickCount`. `scrubBreadcrumb` applies the rule again when a JS event is sent, and drops `data` there like any breadcrumb's. The iOS SDK's own `touch` crumbs, which name a UIControl action by its selector, get only the free-text sweep, and only when a JS event carries them; a native crash report carries them as recorded (two bullets down). `apps/mobile/lib/sentry/touch-breadcrumbs.spec.ts` drives the SDK's real touch boundary and native sync to show the record-time pass, and `packages/observability/src/sentry-scrubbing.spec.ts` covers the send-time one ([#2982](https://github.com/pdcarlson/Frapp/issues/2982)).
- **A mobile breadcrumb is scrubbed when it is recorded, because a native crash report never passes `beforeSend`.** `@sentry/react-native` copies every breadcrumb into the native SDK's scope as soon as `beforeBreadcrumb` returns, and sentry-cocoa and sentry-android build a native crash report from that copy. So mobile's `beforeBreadcrumb` is `scrubRecordedBreadcrumb`: the breadcrumb allowlist above, touch rule and swept `message` included, applied at record time. A few `data` fields survive, each one code or request metadata rather than anything a member typed. Some the SDK reads back after the hook; the rest place the crumb in a crash report:
  - **An `http` crumb** keeps `method`, `status_code`, and a `url` cut to scheme, host and swept path, with no query string, fragment or `userinfo`. That covers `xhr`, and `fetch`, which is what the app records, since Expo installs `expo/fetch` as the global `fetch`. The query string is where a typed search goes. The origin stays because React Native's `defaultBeforeBreadcrumb` and the native SDKs' own `beforeBreadcrumb` recognize Sentry's envelope requests and the dev server's by URL prefix.
  - **A touch crumb** keeps its code-only path.
  - **A `navigation` crumb** keeps `from` and `to`, reduced like a URL path. The native bridge reads `to` back to set the native scope's current screen. The SDK's Expo Router integration records one on every screen change, with the route's templated path (`/members/[id]`), never the concrete one.
  - **Every other crumb** keeps none, so a `console` crumb's raw `arguments` never reach native.

  A JS event still drops `data` at send time. `apps/mobile/lib/sentry/recorded-breadcrumbs.spec.ts` drives the SDK's real `fetch`, `XMLHttpRequest` and console handlers through `@sentry/core` and the native sync to show it ([#3104](https://github.com/pdcarlson/Frapp/issues/3104)).
- **Mobile turns off native breadcrumb data no JS hook can reach.** The native SDKs' own breadcrumbs never pass through JS. Read from sentry-cocoa 9.32.0 and sentry-android 8.62.0, the versions `@sentry/react-native` 8.33 pins (re-read 2026-11-07 against 9.29.0 and 8.57.0, which 8.28 pinned: the only new crumb is the hinge one below, and the React Native bridge's native code adds none, [#3342](https://github.com/pdcarlson/Frapp/issues/3342)). The pins live in the package's `RNSentry.podspec` (`sentry_cocoa_version`) and `android/build.gradle` (`sentryAndroidVersion`). Any `@sentry/react-native` bump fails `apps/mobile/lib/sentry/options.spec.ts`, which locks the package's own version and both pins, until this is re-read: the bridge's native code, and each SDK's crumb sources when its pin moves, diffed between the old version and the new. What the read found:
  - **iOS `http` crumbs:** sentry-cocoa keeps the request's query string as `http.query`, so `enableNetworkBreadcrumbs` is `false`. For a request made from JS the native crumb only duplicates the JS one. A request React Native makes natively, such as an `<Image>` loading a chat attachment, a profile photo or the chapter logo, has no JS crumb, so a native crash report no longer shows it. That is accepted: a chat attachment's URL is a signed storage URL whose query is the token.
  - **iOS `touch` crumbs:** a UIControl's would carry its `accessibilityIdentifier`, which is React Native's `testID`, so `reportAccessibilityIdentifier` is `false`.
  - **What the native SDKs still record** is device and code state: app and screen lifecycle, system events (battery, storage, memory, orientation, screen on and off, and since sentry-cocoa 9.32.0 a foldable iPhone's hinge opening or closing), connectivity, and a UIControl action's selector with a sanitized view description and a native `UIButton`'s title (iOS), or a tapped view's class and resource ID (Android).
  - **Android has no request crumbs of its own.** OkHttp is instrumented only by the Sentry Android Gradle Plugin, which the app doesn't apply, so re-check this rule before turning that plugin on.

  **One known limit:** iOS's `ui.lifecycle` crumb carries each screen's `navigationItem.title`. Every mobile route's title is a static string today, but a route titled from data (a member's or a channel's name) would put that name in native crash reports, and no option turns off that one field: `enableAutoBreadcrumbTracking: false` drops the app-lifecycle crumbs too.
- **Free text is swept, not dropped.** An exception message is the payload worth having, so emails, bearer tokens, JWTs, key-shaped strings, IPs, and UUIDs are rewritten in place. UUIDs become their HMAC rather than a placeholder, so a message stays correlatable with the event's own `user`/`chapter` values — the hashes are byte-identical.
- **Fail closed, twice.** With no salt configured the identifiers are removed rather than sent raw, and any throw inside the scrubber drops the event entirely. Losing an error report is preferable to emitting an uninspected payload.

What the SDK collects in the first place is set by `dataCollection`, and every category is named, because Sentry SDK v11 defaults each one to on. The API and both Next apps share one value, `sentryDataCollection()` in `@repo/observability`, which collects at the source only what the scrubber would keep. No cookies, bodies, response headers, stack-frame locals, database values, queue arguments, or user info are collected, and query strings are left off request data and span URLs. Two exceptions reach the scrubber regardless: the browser SDK sets an error's `request.url` from `location.href` whatever `dataCollection` says, and the SDK's URL filter keeps a `#fragment`; the scrubber's path-only rule removes both. Request headers use the scrubber's own allowlist (`content-type`, `x-request-id`) as the SDK's allow list; the SDK matches it by substring, so the scrubber's exact-name match is what decides which headers leave. The comment on `sentryDataCollection()` gives the reason for each value. It is a floor, not a substitute: the scrubber's allowlists and free-text sweep still decide what leaves. Mobile is still on `@sentry/react-native` 8 and still sets `sendDefaultPii: false`, the v10 key-name filter: `authorization` and `cookie` arrive as `[Filtered]`, but a value under an innocuously-named key passes through to the scrubber.

## Metrics

Key metrics exported for monitoring dashboards:

- Request rate (per endpoint, per status code).
- Error rate (4xx, 5xx).
- Response latency (p50, p95, p99).
- Active WebSocket / Realtime connections.
- Active study sessions.
- Push notification delivery success/failure rate.

### Push delivery

Push delivery success/failure rate is derived from a structured log record emitted once per push attempt by the Expo provider (`apps/api/src/infrastructure/notifications/expo-push.provider.ts`). It follows the Structured Logging convention above — one flat JSON object per record:

| Field | Meaning |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `event` | Always `push_delivery`. |
| `priority` | Resolved priority (`URGENT` / `NORMAL` / `SILENT`) — after any quiet-hours downgrade. |
| `category` | Notification category (`chat`, `events`, `announcements`, …); `default` when the caller sets none. |
| `attempted` | Push tokens the send was asked to reach. |
| `accepted` | Messages the push service accepted (`status: 'ok'` ticket). |
| `invalidTokens` | Tokens rejected as malformed before any send — a **count**, distinct from the `DeviceNotRegistered` token *values* `ExpoPushProvider.sendToUser` returns internally for pruning (`spec/behavior/notifications.md` delivery step 7). The two never overlap: a malformed token is never sent to Expo, so Expo can never report it `DeviceNotRegistered`. |
| `ticketErrors` | Messages the push service rejected (`status: 'error'` ticket). |
| `providerErrors` | Messages in a chunk whose transport call threw — no per-message outcome was returned. |
| `failures` | `invalidTokens + ticketErrors + providerErrors`. |
| `failureRate` | `failures / attempted`; `0` when nothing was attempted. |
| `errorCodes` | Count per push-service error code (`DeviceNotRegistered`, `MessageTooBig`, …). Transport throws are keyed `provider:<ErrorName>` so they stay distinguishable. |

Tickets are **not** receipts: an accepted ticket means the push service took the message, not that the device displayed it. `accepted` is therefore an upper bound on delivery, and a `status: 'error'` ticket is counted as a failure rather than a send.

Records with `failures > 0` are emitted at `warn` and clean ones at `log`, so a log-level filter is a usable coarse signal on top of the field-level rate.

**No token values are ever logged** — counts only. Push tokens are device credentials, and the push service echoes the offending token back in several of its error messages, so a token appearing in a provider error is redacted before the error is logged, consistent with the auth-token rule under Structured Logging. Redaction is by exact match against the tokens the send was given, not by token shape: a valid push token may be a bare UUID with no distinguishing form, and matching every UUID instead would destroy request ids. Provider errors log a length-capped message only — never the error object, whose stack would re-embed the raw message, and whose volume spikes precisely during an outage.

A send in which every token is invalid still emits a record: a push that reaches nobody must not be indistinguishable from having nothing to send.

### Security events

Three HTTP outcomes are security-relevant on their own, independent of any exception: a rejected credential, a denied authorization, and a tripped rate limit. Each emits one flat JSON record at **`warn`**, so a level filter alone isolates them from the per-request `log` stream.

They are emitted from `AllExceptionsFilter` (`apps/api/src/interface/filters/all-exceptions.filter.ts`) — the single point every denial passes through as an `HttpException`, whichever guard raised it. `LoggingInterceptor` is deliberately not the seam: it logs every request at one level and cannot distinguish a denial from a success.

| Field | Meaning |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `event` | Always `security_event`. |
| `kind` | `auth_failure` (401), `authorization_denied` (403), or `rate_limit_rejected` (429). |
| `statusCode` | The HTTP status that produced the record. |
| `method` | Request method. |
| `path` | Request path **without the query string** — a query is free text on a public surface and routinely carries tokens. Enforced by `pathOnly`; there is deliberately **no allowlist**, because a per-parameter exception list logs each newly added parameter by default until someone notices it should not be. |
| `requestId` | Ties the record to the request-tracing ID above. |
| `userId` | Raw user id, when the request resolved one. Raw per the internal-log rule above. |
| `chapterId` | Raw chapter id, when one was in context. |
| `originHash` | Pseudonymized origin (see § Structured Logging). Absent when no salt is configured. |
| `timestamp` | ISO-8601. |

#### Auth-failure spikes

A sliding-window counter (`auth-failure-spike.ts`) watches `auth_failure` records per origin and emits a `kind: auth_failure_spike` record — plus a `warning`-level Sentry event — when one origin crosses **20 failures in 5 minutes**, then stays silent for a 15-minute cooldown so one sustained attack reports once rather than thousands of times.

The counter is in-memory, which is a deliberate trade and bounds what it can be asked to do. It is **per-instance** (two API instances each count their own half), **reset by every deploy**, and **evadable by an attacker who rotates more origins than the bounded map holds**. Bounding the map is not optional — an unbounded one is itself a memory-exhaustion vector — so these are the cost of counting in process, not defects to fix in place. The signal is a *spike detector*, never an audit ledger; anything that must be complete belongs in a provider-side rule.

Origin attribution is only as good as the address Express resolves. `trust proxy` is set to the measured hop count (`TRUST_PROXY_HOPS` in `apps/api/src/bootstrap.ts`), so `req.ips[0]` is the real caller and each origin counts separately. A hop count trusts that many entries whether or not that many proxies appended them, so it is only sound where the real chain is at least that long. That is measured for staging's hostnames and for production's `api.frapp.live` (the count was one too high for production until [#2972](https://github.com/pdcarlson/Frapp/issues/2972)). Production's default `frapp-api-prod.onrender.com` hostname has not been measured, and neither has any new ingress that bypasses Render's edge; the trust-proxy tripwire reports a shorter chain if one arrives. The counter keys on the same tracker the rate limiter uses (authenticated subject first, origin second), so the two agree by construction rather than needing to be kept in step.

## Product Analytics — Activation Funnel

The metrics above describe whether the service is healthy. This section describes whether the *product* is working: where a chapter stalls on its way from signing up to paying. Free chat is the wedge and paid ops modules are the monetization path (see [`../product/positioning.md`](../product/positioning.md)), so the gap between any two steps below is the question module gating and pricing decisions are answered with.

Seven milestones are recorded **server-side**. Client-only analytics is not sufficient here: these events gate real product decisions, and a blocked SDK, a closed tab mid-checkout, or a Stripe webhook that arrives with no browser attached would each silently remove a step.

| # | Milestone / event name | Recorded when | Extra properties |
| --- | --- | --- | --- |
| 1 | `activation-onboarding-submitted` | The onboarding wizard creates the chapter | `archetype` |
| 2 | `activation-first-invite-created` | The chapter issues its first invite (link or batch) | `batch_size` |
| 3 | `activation-first-invite-redeemed` | Someone joins by redeeming an invite | — |
| 4 | `activation-first-chat-message` | The first **human** message is posted in any channel | `kind` |
| 5 | `activation-first-paid-module-enabled` | A `tier: "paid"` module is switched on for the first time | `module`, `modules_enabled` |
| 6 | `activation-checkout-started` | Stripe issues a checkout session | — |
| 7 | `activation-checkout-completed` | Stripe confirms the checkout and the subscription activates | — |

Every event also carries `step` (its number above), and each name is used **verbatim** as both the analytics event name and the stored `milestone` value — there is no mapping table between the two to drift.

### Once per chapter, decided by the database

Each milestone is stored at most once per chapter in `chapter_activation_milestones`, whose unique `(chapter_id, milestone)` key is what defines "first". The API attempts an insert on every candidate action; only a **winning** insert emits the analytics event. Three consequences worth stating:

- A Stripe webhook redelivery, a retried request, or two members posting the "first" message concurrently cannot double-count a step.
- Conversion stays queryable in plain SQL with no analytics provider configured — which matters because the provider-side automation is itself provisioned per environment.
- Steps are *not* a state machine. A chapter may enable a paid module before anyone redeems an invite; the ordering encodes the intended path, and measuring departures from it is the point.

Milestone 4 excludes server-originated posts. The onboarding welcome message travels the same path, and counting it would mark every chapter as having chatted the instant it was created.

### Identifiers

Funnel events are keyed by **`hmac_sha256(salt, chapter_id)`** as the `distinct_id` — not by a user pseudonym, and never by a raw id.

A chapter is what activates, and its steps are performed by different people: the founder submits onboarding, a second member redeems the first invite, a treasurer starts checkout, and Stripe's webhook completes it with no user in context at all. Keyed by user those are four unrelated pseudonyms, and a provider-side funnel would report a near-zero conversion that is purely an artifact of the keying.

The salt is the same per-environment secret used for user pseudonyms and for the Error Tracking hashes above, so a chapter is correlatable across boundaries without any provider holding the raw id. The per-chapter analytics opt-out ([`data-retention.md`](data-retention.md#analytics-events-pseudonymous)) applies to these events unchanged.

### Querying conversion

`chapter_activation_milestones` answers the funnel directly:

```sql
-- Chapters reaching each step, and conversion from the step before it.
with counts as (
  select milestone, count(distinct chapter_id) as chapters
  from chapter_activation_milestones
  where occurred_at >= now() - interval '90 days'
  group by milestone
)
select milestone, chapters,
       round(100.0 * chapters / max(chapters) over (), 1) as pct_of_signups
from counts;
```

```sql
-- Where a single chapter stopped.
select milestone, occurred_at
from chapter_activation_milestones
where chapter_id = '…'
order by occurred_at;
```

Recording is best-effort and never fails the action that triggered it: the call sites are a checkout, an invite, and a message send, and telemetry that can break a payment is worse than missing telemetry. A lost event costs one data point; the durable row is written first, so a provider outage does not cost the record.

## Outbox Telemetry

Chat queues every send in an outbox and flushes it on reconnect, distinguishing terminal 4xx rejections from transient network/5xx failures (`packages/chat-core/src/chat-client.ts`). Web's outbox is Dexie (`apps/web/lib/chat/offline-queue.ts`) and mobile's is AsyncStorage (`apps/mobile/lib/chat/outbox-store.ts`); both clients hand chat-core their `AnalyticsContext` `track` (web in `apps/web/lib/chat/use-chat-channel.ts`, mobile in `apps/mobile/lib/chat/use-chat-runtime.ts` since 2026-11-06, [#3164](https://github.com/pdcarlson/Frapp/issues/3164)), so the events below come from both. Mobile reads `track` when each event is sent (`apps/mobile/lib/use-latest-track.ts`), and its outbox rows are keyed on the member, not the chapter (`apps/mobile/lib/chat/chat-scope.ts`). So a row queued in one chapter and flushed after a switch reports its outcome under the chapter active at the flush, gated by that chapter's opt-out. Six client-side events cover the full lifecycle of one queued row, defined once in `packages/chat-core/src/outbox-analytics.ts` so a typo can't split one event into two names:

| Event name | Recorded when | Extra properties |
| --- | --- | --- |
| `outbox-queued` | A message is written to the outbox — first attempt or a retry | `channel_id`, `attempts` |
| `outbox-confirmed` | The server accepts the message and it leaves the outbox | `channel_id`, `attempts`, `elapsed_ms` |
| `outbox-failed-4xx` | A terminal rejection (bad request, forbidden, read-only channel) | `channel_id`, `attempts`, `elapsed_ms`, `status` |
| `outbox-failed-network` | A network error or 5xx — the row stays queued for the next reconnect flush | `channel_id`, `attempts`, `elapsed_ms` |
| `outbox-retried` | A member taps Retry on a failed row | `channel_id`, `attempts` |
| `outbox-discarded` | A member discards a failed row instead of retrying | `channel_id`, `attempts` |

`elapsed_ms` is measured from the row's current `queuedAt` (reset on every enqueue, including a retry's re-enqueue) to the point of confirmation or failure — so it reads as "how long did *this* attempt take," not cumulative time since the message was first composed.

`attempts` is the number of *prior* failed attempts before this event — `0` for a first-time send. It cannot be read back from `ctx.outbox.enqueue()`'s return value (every enqueue is a fresh row write, including a retry's, so the store's own `attempts` field always comes back `0`); a retry or reconnect-flush resend instead passes the outbox row's real count in explicitly, so `outbox-queued`/`outbox-confirmed`/`outbox-failed-*` report the true attempt number on a resend, not always `0`.

Unlike the activation funnel above, these events carry **no durable Frapp-owned table** — they are unconditional, unpaced client events routed through the same pseudonymous pipeline as every other client analytics call (`AnalyticsContext` → `POST /v1/analytics/events` → `hmac_sha256(salt, user_id)` distinct id, per [`data-retention.md`](data-retention.md#analytics-events-pseudonymous)), the general path this section's own "client-only analytics is not sufficient" warning is about — acceptable here because nothing downstream (billing, a gate, a promise to a member) depends on outbox telemetry landing.

### PII exclusion

No event property is ever the message body or anything content-derived. This is enforced generically, not per call site: `ctx.track` is the same `AnalyticsContext.track` every client event uses, and the API rejects forbidden keys (`content`, `body`, `message`, …) and non-scalar values via `assertContentFreeProperties` (`packages/validation/src/analytics.ts`) before anything reaches the provider. `chat-client.spec.ts`'s outbox-analytics suite runs every emitted event through that same assertion as a local regression guard.

### Computing p50 time-to-confirm and failure rate

Because these events have no dedicated table, the query lives in the provider (PostHog), not in Postgres — unlike the funnel's SQL above. The intended shape:

- **p50 time-to-confirm**: a PostHog Trends insight on `outbox-confirmed`, chart type "Median" (p50) of the `elapsed_ms` property, optionally broken down by `channel_id`.
- **Failure/discard rate after reconnect**: a ratio of `count(outbox-failed-4xx) + count(outbox-failed-network)` to `count(outbox-queued)` over the same window, or a Funnel insight from `outbox-queued` → `outbox-confirmed` to read conversion directly.

If either report needs to stay queryable without a PostHog provider configured — as the activation funnel deliberately is — that is a bigger change (a dedicated outbox-metrics table, mirroring `chapter_activation_milestones`), not an extension of this instrumentation.

## Search Telemetry

The web Find dialog (`apps/web/components/layout/find-dialog.tsx`, opened from the top bar's field) fires one client event, `search-completed` (defined in `packages/hooks/src/search-analytics.ts`), once per settled search — a query that clears the 3-character minimum ([`search.md`](search.md)) and finishes fetching, deduped on the query's `dataUpdatedAt` so a re-render never double-counts and a repeat search of the same text (`useSearch`'s `staleTime: 0` refetches it) still counts once per real fetch. Reopening the dialog on the query it kept refetches that query but is not counted, because the member did not search again; a search abandoned by closing the dialog before it settles is not counted either, because it never settled.

| Property | Meaning |
| --- | --- |
| `surface` | Where the search ran — `"find-bar"` today, kept when the results moved into a centered dialog (2026-11-05) so the series does not split. Rows before [#2141](https://github.com/pdcarlson/Frapp/issues/2141) carry `"command-menu"`, from the ⌘K palette the find field replaced; a query spanning that change has to union both values, and a future mobile entry point would use its own |
| `query_length` | Character count of the trimmed query |
| `query_word_count` | Word count of the trimmed query |
| `backwork_count`, `events_count`, `members_count`, `messages_count` | True per-domain result counts — not the Find dialog's display cap (5 per group under All, 10 with one group's chip selected) |
| `total_count` | Sum of the four counts above |
| `zero_result` | `total_count === 0` |
| `timed_out` | The server's per-source 500ms budget (the "Server-side timeout" bullet under [`search.md`](search.md)'s MVP defaults) was hit for at least one domain |
| `latency_ms` | Time from the debounce settling (200ms after the last keystroke) to the search resolving — the member-perceived wait, not raw fetch time |

### PII exclusion

**The raw query string is never sent, by construction — not merely because `assertContentFreeProperties` (`packages/validation/src/analytics.ts`) would catch it.** It would not: `"query"` is not in `FORBIDDEN_ANALYTICS_PROPERTY_KEYS`, and a query string is itself a scalar, so a property literally named `query` holding the raw text would pass the shared gate untouched. The design instead sends only `query_length`/`query_word_count` — shape, not content — and `apps/web/components/layout/find-bar.spec.tsx`'s search-telemetry suite asserts both that every emitted event still passes `assertContentFreeProperties` (the generic backstop) and that no emitted property value ever equals the typed query text (the specific guarantee the generic gate cannot provide).

### Building a zero-result taxonomy report

Like Outbox Telemetry above, `search-completed` carries no dedicated Frapp-owned table — the report is a PostHog query, not SQL:

- **Zero-result rate**: a Trends insight, ratio of events where `zero_result = true` to all `search-completed` events, broken down by `query_length` bucket (e.g. 3–5, 6–10, 11+) to separate "too-short/typo-shaped" queries from longer ones that plausibly named something the chapter simply doesn't have.
- **Actionable buckets for product/design review**: group zero-result events by `query_word_count` (single-word vs. multi-word misses read differently) and cross-reference against `timed_out = true` (a timeout-caused miss is an infrastructure problem, not a content or vocabulary gap, and must not be counted as the same kind of failure).

**This instrumentation enables but does not itself complete the acceptance criterion that findings inform the mobile search UI's scope** — no chapter has used this yet, so there is no data to analyze. That is a downstream product decision for whoever reviews the report once real usage accumulates, the same posture the Outbox Telemetry section takes toward its own p50/failure-rate report.

## Push Prompt Telemetry

Mobile asks for notification permission only after the member taps "Turn on", on onboarding's notifications step, the chat home's one reminder, or s16 Settings' push row ([`patterns.md` § Push notifications](../ui/mobile/patterns.md#push-notifications)). Whether members say yes decides whether chat pushes reach anyone, and the server can't see the answer: `POST /push-tokens` follows only an "allowed", and repeats on every launch. So mobile sends one client event, `push-prompt-answered` (defined in `apps/mobile/lib/notifications/push-analytics.ts`), through `AnalyticsContext` `track`, once per answer:

| Property | Meaning |
| --- | --- |
| `answer` | `allowed` or `denied`, what the OS prompt returned after "Turn on" (a prompt the OS didn't show, as on iOS after one answer, reads as `denied`); or `not_now`, onboarding's "Not now" or the reminder closed, where no OS prompt was shown. A tap that opened the phone's settings instead (no prompt could appear) sends no event, since the answer happens outside the app |
| `surface` | `primer` (onboarding's step, `use-push-primer.ts`), `reminder` (the chat home's reminder, same file) or `settings` (the push row, `app/(app)/preferences.tsx`) |

Neither property is content. The allow rate is a Trends insight: events with `answer = allowed` over all `push-prompt-answered` events, broken down by `surface`.

## Member Onboarding Funnel

The activation funnel follows a chapter. This one follows a member, from the
invite to their first message, so a drop between joining and talking shows up
per sign-in method and per app. Every step is an event recorded elsewhere in
this file; this section only names the steps and the two properties added for
it (2026-11-07).

| Step | Event | Recorded by |
| --- | --- | --- |
| 1 | `invite-redeemed` | API ([§ Feature Events](#feature-events)) |
| 2 | `onboarding-profile-answered` (mobile only, and only for a member s03 asked for a photo or name) | Mobile client |
| 3 | `push-prompt-answered` with `surface = primer` (mobile only, and only when the build can push and push was off) | Mobile client ([§ Push Prompt Telemetry](#push-prompt-telemetry)) |
| 4 | `member-onboarding-completed` | API |
| 5 | `message-sent` | API |

- **`sign_in_method`** on `invite-redeemed` and `chapter-onboarded`: `apple`,
  `google`, `email` (password or magic link) or `other`, read from the
  session user's `app_metadata.provider` (`signInMethodOf`,
  `apps/api/src/interface/http/sign-in-method.ts`); `null` when the request
  carried no Supabase user. A closed set the server derives, never the email.
- **`onboarding-profile-answered`** is sent once when the member leaves s03's
  profile beat (`apps/mobile/lib/onboarding/profile-step.ts`), through
  `AnalyticsContext` `track`. `photo` is `had` (a photo before the beat),
  `added` (chosen on it) or `none`; `name_step` is `added` (there was no real
  name, the `Member` stand-in or empty), `edited` (a real one was changed) or
  `kept`. Never the name itself. A save that fails sends nothing, since the
  member stays on the beat.
- **`onboarding-tour-finished`** is sent once when the first-run tour over chat
  ends (`apps/mobile/lib/onboarding/tour.ts`): `outcome` is `done` (the last
  stop) or `skipped`, `stop` is the 1-based stop it ended on, and `stops` how
  many this member was shown (a stop whose control wasn't on screen is left
  out). Not a funnel step: a tour that ran is read off it on its own.
- Steps 2 and 3 are optional, so the funnel in PostHog marks them optional.
  Break it down by `sign_in_method` (on step 1) and `app`.

## Feature Events

The activation funnel says where a chapter stalls on its way to paying. Feature events say which features members use and how often. Each feature's main action is recorded **by the API** when the request that performs it succeeds ([#593](https://github.com/pdcarlson/Frapp/issues/593)), so web and mobile are counted from one place, with no client code, and an ad blocker or a closed tab can't drop one.

### How one is recorded

- **A decorator on the route.** `@FeatureEvent(name, describe?)` sits on the controller handler (`apps/api/src/interface/decorators/feature-event.decorator.ts`). `describe` reads the request body, params and query, and the handler's result, and returns the event's properties, or `null` to send nothing (a deduplicated retry, or a chat send that isn't a poll). A handler can carry several: a chat send is always `message-sent`, and also `poll-created` when the message is a poll.
- **A catalog that is an allowlist.** `FEATURE_EVENTS` (`apps/api/src/domain/constants/feature-events.ts`) names each event's feature, a `MODULE_CATALOG` key, and the only property keys it may carry. A describer returning any other key is a compile error, and the interceptor drops one at runtime too. The shared denylist (`FORBIDDEN_ANALYTICS_PROPERTY_KEYS`) can't do this alone: it doesn't know that `title` or `details` hold content.
- **Sent after success, never in the way.** `FeatureEventInterceptor`, registered globally in `AnalyticsModule`, builds the event when the handler's result arrives. A failed request (any 4xx or 5xx) records nothing. A describer that throws is logged at error level and the response is unaffected, and the send is not awaited, so PostHog never delays a response.
- **Who and which chapter.** The distinct id is the acting user's pseudonym. The chapter is `ChapterGuard`'s verified chapter; the two routes without the guard (`POST /chapters/onboard`, `POST /invites/redeem`) take it from their result. An action with no chapter records nothing, since there would be no opt-out to check. Every feature event therefore carries the chapter group and is person-processed onto that user ([§ What an event the API sends carries](#what-an-event-the-api-sends-carries)).
- **Properties.** `feature` (the module key) is added to every event, beside the catalog's own properties, so one insight can break all usage down by module.
- **`app`, from what the clients already send.** `mobile` when `X-Client-Version` parses (store and dev builds; Expo Go sends none), `web` when `Origin` is one of the dashboard's origins (production, staging and its local dev server, not Expo web), otherwise none (`requestApp` in `apps/api/src/interface/http/request-app.ts`, which takes the origins from the CORS allowlist's own constants). Builds already in the stores send these headers, so this needs no client change. An explicit header would also have worked, since CORS reflects requested headers, but it would have needed new builds. It is a label, not an authority: a non-browser client can set either header.
- **The opt-out, read when the event is sent.** `track` reads `chapters.analytics_opt_out` for the event's chapter, as it does for every chapter-keyed event, and fails closed when the read fails. It runs after the handler, so a `PATCH /chapters/:id/config` that opts the chapter out is not recorded, and neither is a request that finishes after another one opted the chapter out. That is one read of the chapter row per event, off the response path.

### Catalog

Properties are listed without `feature`, which every event carries. "Counts requests" means a retried or repeated request that succeeds again is counted again; the other events can't succeed twice for one action, or return a flag the describer uses to skip the repeat.

**Events (`events`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `event-created` | An officer creates an event (a recurring series is one event). Read from the created row, with the server's defaults applied | `is_mandatory`, `is_recurring`, `has_check_in_zone`, `has_point_value`, `posted_to_chat` |
| `attendance-checked-in` | A member checks in. `method` is `qr` (a scanned token), `manual_code` (a typed code), `plain` (neither, as from the chat event card), or `qr_or_manual_code` when a request carries both, since either one admits it. A second check-in is a 409 | `method`, `has_location` |
| `attendance-marked` | An officer sets a member's attendance. `status` is the attendance enum; counts requests | `status`, `has_excuse` |

**Tasks (`tasks`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `task-created` | An officer creates a task | `assigned_to_self`, `has_point_reward`, `posted_to_chat` |
| `task-status-changed` | The assignee or an officer moves a task to a new status | `status` |
| `task-completion-confirmed` | The assigner confirms a completed task | — |
| `task-completion-rejected` | The assigner sends a completed task back | — |

**Polls (`polls`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `poll-created` | A poll card (`kind: 'poll'`) is sent in chat: web's `/poll` or mobile's New poll sheet (#3701). Neither sets a `choice_mode`, and both always set a close time, so `single` and `true` until one changes | `choice_mode`, `option_count`, `has_expiry` |
| `poll-voted` | A member votes, on the chat card (`surface: card`) or the `/polls` page (`page`). On the card a second vote replaces the first and sets `is_revote`, even for the same option; the page can't tell, so it counts requests. Clearing a multi-choice vote is not a vote | `surface`, `selected_count`, `is_revote` |

**Dues (`dues`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `invoice-created` | A treasurer creates an invoice | — |
| `invoice-status-changed` | A treasurer marks an invoice open, paid or void | `status` |
| `invoice-payment-started` | A member opens the payment sheet. Reopening it reuses the payment and counts again | — |

**Points (`points`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `points-adjusted` | An officer awards or deducts points. `direction` is `award` or `deduct`; the amount is never sent. A retry with the same `client_message_id` returns the original grant and counts again | `category`, `direction`, `posted_to_chat` |

**Service and study hours (`hours`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `service-hours-logged` | A member logs service hours | `duration_minutes`, `has_proof`, `posted_to_chat` |
| `service-hours-reviewed` | An officer approves or rejects an entry | `status`, `has_comment` |
| `study-session-started` | A member starts a study session. No location or geofence is sent | — |
| `study-session-stopped` | A member stops one. `outcome` is `completed`, `expired` or `paused_expired` | `outcome`, `duration_minutes` |

**Geofences (`geofences`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `geofence-created` | An officer draws a study geofence. No coordinates or name are sent | — |

**Chat (`chat`) and announcements (`announcements`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `message-sent` | Any message is sent, a retry on the same `client_message_id` excepted. `kind` is the stored message kind. This is the count of sends; the web outbox events measure delivery | `kind`, `is_reply`, `attachment_count` |
| `announcement-posted` | An `/announce` message is sent (feature `announcements`) | — |
| `message-reacted` | A member adds a reaction. The emoji is never sent; a repeat is deduplicated, and removing one doesn't reach the API | — |
| `dm-opened` | A member opens a 1-on-1 DM. Get-or-create, so reopening one counts again | — |
| `channel-created` | An officer creates a channel | `type`, `is_read_only`, `has_category` |
| `message-reported` | A member reports a message. `reason` is the report-reason enum, never the details; a repeat while the report is open counts again | `reason` |
| `discord-import-created` | An officer starts a Discord import | `source` |
| `discord-import-started` | The import is started; a restart counts again | `has_cutoff` |

**Documents (`documents`) and backwork (`backwork`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `document-uploaded` | A document upload is confirmed. Its category and folder are free text, so only whether they were set | `has_document_type`, `has_folder` |
| `document-viewed` | A document is fetched, to view or download. Each fetch counts, a refetch included | — |
| `backwork-uploaded` | Backwork is uploaded. `assignment_type` is the closed assignment list; title, course and professor are never sent | `assignment_type`, `is_redacted`, `tag_count` |
| `backwork-viewed` | A backwork item is fetched. Each fetch counts | — |

**Recruitment (`rush`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `rush-candidate-added` | A member adds a candidate. No name is sent | `is_existing_user`, `posted_to_chat` |
| `rush-candidate-voted` | A member votes for a candidate. A repeat vote succeeds again and is recorded again, though the tally doesn't move | — |
| `rush-candidate-bid` | A member extends a bid (any member may: there are no rush permissions). A repeat bid succeeds again and is recorded again | — |

**Reports (`reports`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `report-generated` | A report is generated. The dashboard previews through `format: json` and builds its CSV in the browser, so `json` includes previews and a web CSV download isn't seen | `report_kind`, `format` |

**Members (`members`), chapter setup (`chapter-settings`) and billing (`billing`)**

| Event | Recorded when | Properties |
| --- | --- | --- |
| `invite-created` | An officer creates invites. `invite_method` is `link`, `batch` or `email`; `count` is the invites created, never the addresses | `invite_method`, `count` |
| `invite-redeemed` | Someone joins by redeeming an invite. `sign_in_method` is how they signed in ([§ Member Onboarding Funnel](#member-onboarding-funnel)) | `sign_in_method` |
| `member-onboarding-completed` | A member finishes onboarding. Counts requests that set it, not first completions | — |
| `profile-photo-updated` | A member confirms a new profile photo upload (`POST /users/me/avatar`). Removing a photo records nothing, since that route has no chapter | — |
| `chapter-onboarded` | The onboarding wizard creates a chapter (feature `chapter-settings`). `archetype` is the stored archetype key; `sign_in_method` is how the founder signed in | `archetype`, `from_directory`, `sign_in_method` |
| `semester-rolled-over` | An officer rolls the chapter into a new semester (`chapter-settings`) | `promote_new_members` |
| `chapter-config-updated` | An officer saves a chapter setting (`chapter-settings`). `section` is the field the save changed (`enabled_modules`, `branding`, `dues`, and so on), or `multiple`; never the values. An empty save records nothing | `section` |
| `checkout-started` | Stripe issues a checkout session (`billing`) | — |

### Modules with no event

Every module in `MODULE_CATALOG` has an event above or a row here.

| Module | Why it has no event |
| --- | --- |
| `audit-log` | A read-only feed. How often officers open it is a page view ([#3382](https://github.com/pdcarlson/Frapp/issues/3382)), which a request count would overstate, since the dashboard refetches it |
| `onboarding` | No API routes: the pathway, big/little and quiz have no server side yet |
| `academics` | No API routes yet |
| `philanthropy` | No API routes yet |
| `risk` | No API routes yet |
| `lines` | No API routes yet |
| `networking` | No API routes yet |
| `standards` | No API routes yet |
| `serviceFirst` | No API routes yet; service hours are `hours` |

### Reading them

- **Funnels and conversion use the `activation-*` events**, which are keyed by chapter and recorded once per chapter ([§ Product Analytics — Activation Funnel](#product-analytics--activation-funnel)). Feature events are keyed by user and count every action, so `invite-created` and `activation-first-invite-created` answer different questions.
- **Server-side means successes only.** A tap that ends in an error, and an action the client never sends to the API (removing a reaction, building a CSV in the browser), records nothing.
- **No `app` is not an error.** Expo Go, server-side Next.js calls and anything else `requestApp` can't place carry none.
- **Writes from workers and schedules are not covered**: they aren't a member's action, and they have no request.

### PII exclusion

Properties describe an action's shape, never its content: no titles, bodies, descriptions, free-text reasons, details or comments, names, emails, coordinates, file or folder names, money amounts, emoji, or another member's id. A string value comes from a closed set, a DTO `@IsIn`/`@IsEnum` field or a value the server set. `feature-events.spec.ts` (`apps/api/src/interface/controllers/`) checks that every allowed key is snake_case and passes `assertContentFreeProperties`.

### Volume

An estimate, not a measurement: an active 60-member chapter sending about 400 messages and 200 reactions or votes a day makes roughly 18,000 chat events a month, and every other feature event together about 1,000 to 2,000, so about 20,000 feature events. Both clients also send two outbox events for every message (`outbox-queued` and `outbox-confirmed`, [§ Outbox Telemetry](#outbox-telemetry)), offline or not, about 24,000 more, so about 44,000 person-processed events per chapter per month. (Before mobile sent outbox events on 2026-11-06, this ranged from 20,000 to 44,000 with the share of chat on web.) PostHog's free allowance is 1 million events a month ([pricing](https://posthog.com/pricing), read 2026-11-04), about 23 chapters at that rate; identified (person-processed) events above the allowance are billed at a higher rate than anonymous ones ([anonymous vs identified events](https://posthog.com/event-comparison), read 2026-11-04). [Route views](#route-views) and mobile lifecycle events come on top, sent person-processed once a member is identified (`person_profiles: "identified_only"`): at four app opens per member a day, each with about eight route views and two lifecycle events, about 70,000 a month for the same chapter, so about 115,000 in all and about 9 chapters inside the allowance (an estimate, 2026-11-05; outbox share updated 2026-11-06).

### Adding one

Add the event to `FEATURE_EVENTS` with its feature and allowed properties, add its row to the tables above, and put `@FeatureEvent` on the handler. `feature-events.spec.ts` fails until the three agree: every catalog event is sent by a handler, the spec lists the same events with the same properties, an event on a route gated by `@RequireModule` names that module as its feature, and every module has an event or a row under [§ Modules with no event](#modules-with-no-event). Give the describer a case in `feature-event-describers.spec.ts`, which runs each handler's real describer. Type its result as the handler's own return type: the decorator refuses one the handler doesn't return, so a change to what the handler returns breaks the build rather than the event. A describer reads the request body as sent, before the `ValidationPipe` converts it, so test a text field with `hasText` rather than calling string methods on it.

## Alerting

Error **counts** used for paging live in Sentry, not PostHog. Thresholds and live rule observations: [`alert-routing.md`](../../docs/ops/alert-routing.md). Configurable alerts (via the monitoring provider) for:

- Error rate exceeds threshold (e.g. >5% 5xx in 5 minutes).
- API downtime (health check fails).
- Database connection pool exhaustion.
- Stripe webhook processing failures.
- Push notification delivery failure spike — thresholds in [`alert-routing.md`](../../docs/ops/alert-routing.md#push-notification-delivery).
- A chat worker's Realtime subscription down (no chat pushes, or no audit mirror): the error-level event in [`alert-routing.md`](../../docs/ops/alert-routing.md#chat-worker-subscriptions), since `/health/ready` leaves the workers out (§ Health Check).
