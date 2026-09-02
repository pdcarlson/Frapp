# Observability

## Structured Logging

Every API request is logged as structured JSON with: request ID, user ID, chapter ID, endpoint, HTTP method, status code, response latency, the forwarded-chain shape (below), and timestamp.

**Identifier handling (internal logs):** `user_id` and `chapter_id` are retained as raw values in internal structured logs because the logs are confined to Frapp-internal observability tooling and operate under the internal retention policy. They are **not** PII-scrubbed at the log boundary — scrubbing applies only at external-reporting boundaries (Sentry / external observability vendors). Email addresses, IPs, auth tokens, request bodies, and response bodies are never logged. The auth-token half of that rule is not only about the `Authorization` header: a query string is free text on a public surface and routinely carries credentials — the Discord connect callback's `state` **is** the CSRF token. Two rules follow ([#1260](https://github.com/pdcarlson/Frapp/issues/1260)):

1. **Every log site that writes a request path routes it through `pathOnly`** (`apps/api/src/interface/utils/path-only.ts`), which is what makes the `path` row below true rather than aspirational. It strips the query *and* the scheme/host/userinfo of an absolute-form request target, because `req.url` is the request line verbatim and a caller may send `http://user:pass@host/path`.
2. **`pathOnly` covers the path field only** — it says nothing about a credential a service interpolates into a message of its own. Those are the responsibility of each log site: no handshake, session or CSRF value may be logged in the clear, spent or not. The Discord callback is the worked example — it logs neither the state id nor unsanitized query values.

Caller-supplied text reaching a log message goes through `logSafe` (`apps/api/src/infrastructure/observability/log-safe.ts`) first. The API uses Nest's default console logger, so a record is a `[Nest] <pid> - <ts> <LEVEL> [<Context>]` prefix followed by the message. The request log and `security_event` carry a JSON body and are one line each, so an unescaped newline in an attacker-chosen value splits the record and lets the caller write a line of their own choosing into the stream an incident investigation reads. **A record is not one line in general**, though: `logger.error(message, stack)` prints the message and then the stack across further lines, and this subsystem logs at `log`, `warn` and `error` alike — so neither line count nor level tells a forged line from a genuine one. The `[Nest]` prefix is the only marker a caller cannot supply, and a stream a caller can write arbitrary lines into is not one worth reasoning from.

**Forwarded-chain shape (`xffCount`, `xffSocketIsLast`).** The request log carries two facts about the `X-Forwarded-For` chain and **no address from it**: `xffCount`, the number of entries (`0` when the header is absent), and `xffSocketIsLast`, whether the socket peer *also* appears as the chain's final entry. Both are computed in `LoggingInterceptor` (`apps/api/src/interface/interceptors/logging.interceptor.ts`); the addresses are compared in process and discarded.

They exist to settle one question the IP rule would otherwise make unanswerable, and they have now settled it. Express resolves `req.ip` from the forwarded chain only when `trust proxy` is set to a **hop count matching the real number of proxies** — setting it to `true` instead is *worse* than leaving it unset, because it trusts the whole chain and lets a client forge and rotate addresses. That count cannot be reasoned out from the outside: `api-staging.frapp.live` shows **two** branded proxy layers (Render's Cloudflare CDN in front of the Render origin), but the measured chain carries **three** appended entries — there is a hop inside Render's ingress that no header inspection reveals. Probing with 0, 1 and 2 forged entries returned `xffCount` 3, 4 and 5, exactly linear, so the infrastructure contribution is the constant now recorded as `TRUST_PROXY_HOPS = 3` ([#864](https://github.com/pdcarlson/Frapp/issues/864)). The method generalises: probe with a known number of forged entries, then subtract — the remainder is what the proxies in front appended. `xffSocketIsLast` is a guard rather than a second signal; it is normally `false`, because each proxy appends the peer it received from and so the nearest proxy's own address is the one the chain never carries. A `true` would mean something is echoing its own address, and that the count needs checking before anything is set from it. **The addresses are not an input to that arithmetic**, which is why this is a cardinality and a comparison rather than the raw header — the IP rule above is not relaxed, or amended, by this field pair.

**Request origin (`originHash`).** The IP rule above is unconditional, but a security signal such as "this origin has failed auth twenty times in five minutes" needs a *stable key per origin* — which is not the same thing as needing the address. Where a record must group by origin it carries **`originHash` = `hmac_sha256(salt, ip)`** under the same per-environment salt as every other pseudonym here, and never an `ip` field. The field is named for what it holds so it is not later "fixed" by substituting the raw value. Unlike the user and chapter hashes this one is not reversible-resistant against an attacker holding the salt — the IPv4 space is small enough to enumerate — which is a property of the address space, not a reason to log the address instead.

## Request Tracing

A unique `x-request-id` header is generated for each incoming request (or preserved if the client sends one). This ID is included in all log entries and all error responses, enabling end-to-end tracing. The request ID itself is non-PII and may be surfaced in client-facing error messages.

**"All" includes denials, which makes the placement load-bearing.** The id is assigned by `requestIdMiddleware` (`apps/api/src/interface/middleware/request-id.middleware.ts`), registered as Express middleware ahead of the Nest pipeline. It cannot be an interceptor: Nest runs middleware → guards → interceptors, so a request rejected by a guard never reaches one, and every 401/403/429 would carry `"requestId": "unknown"` — precisely the requests a tracing id is most useful for.

## Health Check

Two endpoints, both unauthenticated:

- **`GET /health`** — liveness. Always returns 2xx while the process is up, with `status: "ok" | "degraded"`, database connectivity, Supabase Storage connectivity, and uptime in the body. This is Render's `healthCheckPath` (`render.yaml`); it must never itself flip to a non-2xx status, since that is a dashboard-level decision about restarting/rolling back the instance, not this endpoint's to make.
- **`GET /health/ready`** — readiness. Runs the same dependency probes but returns **503** when any dependency is degraded. Deploy smoke checks (`deploy-api.yml`, `deploy-production.yml`) poll this path rather than `/health`, so a database or Storage outage actually fails the post-deploy gate instead of reading a `200` with a discarded `"degraded"` body. The 503 goes through the API's global exception filter like every other error response, so the body is the standard `{statusCode, error, message, requestId}` shape (see "Error Tracking" below) rather than the raw `{status, database, storage, uptime}` object — `message` names which dependency is degraded (e.g. `"database: error, storage: connected"`).

## Error Tracking

Integrate with Sentry (or equivalent). All unhandled exceptions and 5xx responses are reported with: request ID, endpoint, HTTP method, status code, and stack trace. External error reporting requires explicit PII handling:

- **Pseudonymized before sending:** `user_id` and `chapter_id` are sent as HMAC-SHA256 hashes using the same per-environment salt as the analytics pipeline (see [`data-retention.md`](data-retention.md) #analytics-events-pseudonymous). Reversing the hash requires access to the salt, which is held outside the error-reporting provider.
- **Redacted entirely:** email addresses, IP addresses, auth tokens (including any `Authorization` header value), request bodies, response bodies, message contents, document contents, and any free-text fields that may contain user-typed PII.
- **URLs are reduced before they leave.** `request.url` and the transaction name are cut to a **path** — query, fragment, scheme, host and `userinfo` all gone. That is a parse, not a pattern: `stripAuthority` in `packages/validation/src/sentry-scrubbing.ts` reduces an absolute-form target, which RFC 9112 permits on any request and which Node hands to `req.url` verbatim, so `GET http://user:pass@host/path` cannot ship its credential. The **same parser** backs the API's internal request log (`apps/api/src/interface/utils/path-only.ts`), so the internal and external sinks cannot drift apart again — they had, and backwards, with the third-party boundary as the leaky half ([#1388](https://github.com/pdcarlson/Frapp/issues/1388)). A URL in **free text** keeps its host and path, because those are diagnostic and an exception message is the payload worth having; its query string and its `userinfo` are still removed. One deliberate non-reduction: a `//`-leading target is preserved verbatim rather than being read as protocol-relative, since rewriting it would turn `//x/v1/chapters/join` into the real route `/v1/chapters/join` and forge the field.

- **A throwable that is not an `Error` is normalized before it is reported.** Nothing guarantees what a `throw` carries, and the Supabase repositories throw plain objects by construction: postgrest-js only builds a `PostgrestError` on the `.throwOnError()` path, so a method that destructures `{ data, error }` and ends `if (error) throw error` throws `{ code, message, details, hint }`. Reporting `String(exception)` on one of those produces the literal text `[object Object]`, which is what [FRAPP-API-1](https://frapp-live.sentry.io/issues/FRAPP-API-1) recorded in place of a `PGRST205`. `toReportableError` in `apps/api/src/infrastructure/observability/reportable-error.ts` rebuilds such a value into an `Error` named `NonErrorThrowable` whose message is `code: message: hint`, falling back to a capped, throw-guarded JSON serialization when the object carries none of those. **`details` is excluded on purpose, from internal logs as well as from Sentry:** it is the field Postgres fills with the offending row values, so it is the most sensitive of the four and the least diagnostic — the constraint that failed is already named in `message`.

Enforced in one place — `packages/validation/src/sentry-scrubbing.ts` — on these rules, and the rules cover **both classes of event Sentry emits** for **every app that reports**. The SDK routes the two classes to two different hooks, so `createSentryScrubber` returns two entry points and each app's options module wires both: `scrubSentryEvent` as `beforeSend` for error events, and `scrubSentryTransaction` as `beforeSendTransaction` for transaction (tracing) events. Setting only one leaves the other class shipping unscrubbed, which is the gap [#896](https://github.com/pdcarlson/Frapp/issues/896) closed.

Both hooks also carry `sdkProcessingMetadata` field-by-field through `scrubSdkProcessingMetadata`, keeping only `dynamicSamplingContext` (swept) and `spanCountBeforeProcessing` — the two fields the SDK reads back *after* the hook returns, to build the envelope's `trace` header and to compute how many spans were dropped. The rest of that bag (`normalizedRequest`, a full request object) is dropped. This was symmetric only on the transaction path until [#966](https://github.com/pdcarlson/Frapp/issues/966); every error event shipped with no `trace` envelope header until then.

The scrubber is shared rather than per-app because a browser bundle holds strictly *more* PII than the server process does — member emails, chapter names, chat message bodies, document titles — so a second copy of these rules for the client would be a second copy to keep correct, and the failure mode is silent ([#865](https://github.com/pdcarlson/Frapp/issues/865)). Three bindings consume it:

| App | Options module | Pseudonyms | Runtimes initialized |
| --- | --- | --- | --- |
| `apps/api` | `src/infrastructure/observability/sentry-options.ts` | `ANALYTICS_HMAC_SALT` via `pseudonyms.ts` | Node |
| `apps/web` | `lib/sentry/options.ts` | none — `NO_PSEUDONYMS` | browser, Node server, edge |
| `apps/mobile` | `lib/sentry/options.ts` | none — `NO_PSEUDONYMS` | React Native (Expo) |

**No client holds the salt, and that is deliberate.** `ANALYTICS_HMAC_SALT` is API-only; putting it in a client bundle would let the analytics dataset be rainbow-tabled back to raw user ids. A React Native bundle is as readable as a browser one, so this applies to `apps/mobile` exactly as it does to `apps/web`: both pass `NO_PSEUDONYMS`, and the free-text sweep *redacts* identifiers (`[redacted:id]`) where the API *hashes* them (`[id:<hmac>]`) — the same fail-closed branch the API takes when its own salt is unset. The single exception is the user pseudonym, which a client does not compute but reads already-hashed from `GET /v1/analytics/identity`; the scrubber's `/^[0-9a-f]{64}$/` gate re-checks it independently, so nothing upstream can put a raw id on an event. `apps/web` does this through `sentry-identity-provider.tsx`; `apps/mobile` sets no Sentry user at all today, so it has no identifier in play. Chapter ids get no client pseudonym and are dropped.

Each binding reports to its **own Sentry project** — `frapp-api`, `frapp-web`, `frapp-mobile` — so a server error, a browser error and a device crash do not share a stream, a noise profile, or an alert threshold. A binding with no DSN configured never calls `Sentry.init` at all, so an unconfigured surface reports nowhere rather than reporting somewhere unexpected.

The two hooks cannot share one function. A transaction carries its trace payload in `spans`, which is absent from the error-event key allowlist — so pointing `beforeSendTransaction` at `scrubSentryEvent` would still *deliver* every transaction, just with the span tree silently emptied. The transaction scrubber therefore keeps `spans` and rebuilds each span field-by-field: identity and timing survive, `description` and `op` go through the free-text sweep, and span attributes (`data`) are held to a small allowlist of non-PII OpenTelemetry keys because that bag routinely carries `http.url`, `url.query`, and `db.statement`.

- **Allowlist wherever the structure is enumerable.** Top-level event keys, request fields, headers, and contexts are rebuilt from what is permitted rather than filtered for what is forbidden. A denylist starts leaking the day the SDK adds a field, and nobody reads their own error reports looking for PII. One known exception: stack frames are rebuilt by **spread**, not allowlist — only `vars` is deleted and `filename` swept, so every other frame field is forwarded as-is, including source context (`pre_context`/`context_line`/`post_context`) and any field a future SDK version adds — [#889](https://github.com/pdcarlson/Frapp/issues/889).
- **Free text is swept, not dropped.** An exception message is the payload worth having, so emails, bearer tokens, JWTs, key-shaped strings, IPs, and UUIDs are rewritten in place. UUIDs become their HMAC rather than a placeholder, so a message stays correlatable with the event's own `user`/`chapter` values — the hashes are byte-identical.
- **Fail closed, twice.** With no salt configured the identifiers are removed rather than sent raw, and any throw inside the scrubber drops the event entirely. Losing an error report is preferable to emitting an uninspected payload.

`sendDefaultPii` is `false`. Under the Sentry v10 SDK that means the client IP is not inferred and request bodies are not collected at all, while cookies, headers, and query params *are* collected and then filtered **by key name** — `authorization` and `cookie` arrive as `[Filtered]`, but a value under an innocuously-named key (`x-custom-note`, `?email=`) passes through untouched. It is a floor, not a substitute: the scrubber's free-text sweep is what catches the rest.

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

Origin attribution is only as good as the address Express resolves. `trust proxy` is set to the measured hop count (`TRUST_PROXY_HOPS` in `apps/api/src/bootstrap.ts`), so `req.ips[0]` is the real caller and each origin counts separately. A hop count trusts that many entries whether or not that many proxies appended them, so it is only sound where the real chain is at least that long — true of every deployed path today, and the reason a new ingress that bypasses Render's edge would need the count re-measured rather than inherited. The counter keys on the same tracker the rate limiter uses (authenticated subject first, origin second), so the two agree by construction rather than needing to be kept in step.

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

Web chat queues offline sends in Dexie (`apps/web/lib/chat/offline-queue.ts`) and flushes them on reconnect, distinguishing terminal 4xx rejections from transient network/5xx failures (`packages/chat-core/src/chat-client.ts`). Six client-side events cover the full lifecycle of one queued row, defined once in `packages/chat-core/src/outbox-analytics.ts` so a typo can't split one event into two names:

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

No event property is ever the message body or anything content-derived. This is enforced generically, not per call site: `ctx.track` is the same `AnalyticsContext.track` every client event uses, and the API rejects forbidden keys (`content`, `body`, `message`, …) and non-scalar values via `assertContentFreeProperties` (`packages/validation/src/analytics.ts`) before anything reaches the provider. `chat-client.test.ts`'s outbox-analytics suite runs every emitted event through that same assertion as a local regression guard.

### Computing p50 time-to-confirm and failure rate

Because these events have no dedicated table, the query lives in the provider (PostHog), not in Postgres — unlike the funnel's SQL above. The intended shape:

- **p50 time-to-confirm**: a PostHog Trends insight on `outbox-confirmed`, chart type "Median" (p50) of the `elapsed_ms` property, optionally broken down by `channel_id`.
- **Failure/discard rate after reconnect**: a ratio of `count(outbox-failed-4xx) + count(outbox-failed-network)` to `count(outbox-queued)` over the same window, or a Funnel insight from `outbox-queued` → `outbox-confirmed` to read conversion directly.

If either report needs to stay queryable without a PostHog provider configured — as the activation funnel deliberately is — that is a bigger change (a dedicated outbox-metrics table, mirroring `chapter_activation_milestones`), not an extension of this instrumentation.

## Search Telemetry

The web command palette (`apps/web/components/layout/dashboard-command-menu.tsx`) fires one client event, `search-completed` (defined in `packages/hooks/src/search-analytics.ts`), once per settled search — a query that clears the 3-character minimum ([`search.md`](search.md)) and finishes fetching, deduped on the query's `dataUpdatedAt` so a re-render never double-counts and a repeat search of the same text (`useSearch`'s `staleTime: 0` refetches it) still counts once per real fetch.

| Property | Meaning |
| --- | --- |
| `surface` | Where the search ran — `"command-menu"` today; a future mobile entry point would use its own value |
| `query_length` | Character count of the trimmed query |
| `query_word_count` | Word count of the trimmed query |
| `backwork_count`, `events_count`, `members_count`, `messages_count` | True per-domain result counts — not the palette's own 5-per-domain display cap |
| `total_count` | Sum of the four counts above |
| `zero_result` | `total_count === 0` |
| `timed_out` | The server's per-source 500ms budget (the "Server-side timeout" bullet under [`search.md`](search.md)'s MVP defaults) was hit for at least one domain |
| `latency_ms` | Time from the debounce settling (200ms after the last keystroke) to the search resolving — the member-perceived wait, not raw fetch time |

### PII exclusion

**The raw query string is never sent, by construction — not merely because `assertContentFreeProperties` (`packages/validation/src/analytics.ts`) would catch it.** It would not: `"query"` is not in `FORBIDDEN_ANALYTICS_PROPERTY_KEYS`, and a query string is itself a scalar, so a property literally named `query` holding the raw text would pass the shared gate untouched. The design instead sends only `query_length`/`query_word_count` — shape, not content — and `dashboard-command-menu.test.tsx`'s search-telemetry suite asserts both that every emitted event still passes `assertContentFreeProperties` (the generic backstop) and that no emitted property value ever equals the typed query text (the specific guarantee the generic gate cannot provide).

### Building a zero-result taxonomy report

Like Outbox Telemetry above, `search-completed` carries no dedicated Frapp-owned table — the report is a PostHog query, not SQL:

- **Zero-result rate**: a Trends insight, ratio of events where `zero_result = true` to all `search-completed` events, broken down by `query_length` bucket (e.g. 3–5, 6–10, 11+) to separate "too-short/typo-shaped" queries from longer ones that plausibly named something the chapter simply doesn't have.
- **Actionable buckets for product/design review**: group zero-result events by `query_word_count` (single-word vs. multi-word misses read differently) and cross-reference against `timed_out = true` (a timeout-caused miss is an infrastructure problem, not a content or vocabulary gap, and must not be counted as the same kind of failure).

**This instrumentation enables but does not itself complete the acceptance criterion that findings inform the mobile search UI's scope** — no chapter has used this yet, so there is no data to analyze. That is a downstream product decision for whoever reviews the report once real usage accumulates, the same posture the Outbox Telemetry section takes toward its own p50/failure-rate report.

## Alerting

Configurable alerts (via the monitoring provider) for:

- Error rate exceeds threshold (e.g. >5% 5xx in 5 minutes).
- API downtime (health check fails).
- Database connection pool exhaustion.
- Stripe webhook processing failures.
- Push notification delivery failure spike — thresholds in [`ALERT_ROUTING.md`](../../docs/internal/ops/ALERT_ROUTING.md#push-notification-delivery).
