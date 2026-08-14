# Observability

## Structured Logging

Every API request is logged as structured JSON with: request ID, user ID, chapter ID, endpoint, HTTP method, status code, response latency, and timestamp.

**Identifier handling (internal logs):** `user_id` and `chapter_id` are retained as raw values in internal structured logs because the logs are confined to Frapp-internal observability tooling and operate under the internal retention policy. They are **not** PII-scrubbed at the log boundary — scrubbing applies only at external-reporting boundaries (Sentry / external observability vendors). Email addresses, IPs, auth tokens, request bodies, and response bodies are never logged.

**Request origin (`originHash`).** The IP rule above is unconditional, but a security signal such as "this origin has failed auth twenty times in five minutes" needs a *stable key per origin* — which is not the same thing as needing the address. Where a record must group by origin it carries **`originHash` = `hmac_sha256(salt, ip)`** under the same per-environment salt as every other pseudonym here, and never an `ip` field. The field is named for what it holds so it is not later "fixed" by substituting the raw value. Unlike the user and chapter hashes this one is not reversible-resistant against an attacker holding the salt — the IPv4 space is small enough to enumerate — which is a property of the address space, not a reason to log the address instead.

## Request Tracing

A unique `x-request-id` header is generated for each incoming request (or preserved if the client sends one). This ID is included in all log entries and all error responses, enabling end-to-end tracing. The request ID itself is non-PII and may be surfaced in client-facing error messages.

## Health Check

`GET /health` returns service status, database connectivity, Supabase connectivity, and uptime. Used by monitoring tools and load balancers. No authentication required.

## Error Tracking

Integrate with Sentry (or equivalent). All unhandled exceptions and 5xx responses are reported with: request ID, endpoint, HTTP method, status code, and stack trace. External error reporting requires explicit PII handling:

- **Pseudonymized before sending:** `user_id` and `chapter_id` are sent as HMAC-SHA256 hashes using the same per-environment salt as the analytics pipeline (see [`data-retention.md`](data-retention.md) #analytics-events-pseudonymous). Reversing the hash requires access to the salt, which is held outside the error-reporting provider.
- **Redacted entirely:** email addresses, IP addresses, auth tokens (including any `Authorization` header value), request bodies, response bodies, message contents, document contents, and any free-text fields that may contain user-typed PII.

Enforced in one place — `apps/api/src/infrastructure/observability/sentry-scrubbing.ts`, wired as Sentry's `beforeSend` — on these rules:

- **Allowlist wherever the structure is enumerable.** Top-level event keys, request fields, headers, and contexts are rebuilt from what is permitted rather than filtered for what is forbidden. A denylist starts leaking the day the SDK adds a field, and nobody reads their own error reports looking for PII.
- **Free text is swept, not dropped.** An exception message is the payload worth having, so emails, bearer tokens, JWTs, key-shaped strings, IPs, and UUIDs are rewritten in place. UUIDs become their HMAC rather than a placeholder, so a message stays correlatable with the event's own `user`/`chapter` values — the hashes are byte-identical.
- **Fail closed, twice.** With no salt configured the identifiers are removed rather than sent raw, and any throw inside the scrubber drops the event entirely. Losing an error report is preferable to emitting an uninspected payload.

`sendDefaultPii` is `false` so the SDK does not collect IPs, cookies, or bodies in the first place; the scrubber is the second line, not the only one.

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
| `invalidTokens` | Tokens rejected as malformed before any send. |
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
| `path` | Request path **without the query string** — a query is free text on a public surface and routinely carries tokens. |
| `requestId` | Ties the record to the request-tracing ID above. |
| `userId` | Raw user id, when the request resolved one. Raw per the internal-log rule above. |
| `chapterId` | Raw chapter id, when one was in context. |
| `originHash` | Pseudonymized origin (see § Structured Logging). Absent when no salt is configured. |
| `timestamp` | ISO-8601. |

#### Auth-failure spikes

A sliding-window counter (`auth-failure-spike.ts`) watches `auth_failure` records per origin and emits a `kind: auth_failure_spike` record — plus a `warning`-level Sentry event — when one origin crosses **20 failures in 5 minutes**, then stays silent for a 15-minute cooldown so one sustained attack reports once rather than thousands of times.

The counter is in-memory, which is a deliberate trade and bounds what it can be asked to do. It is **per-instance** (two API instances each count their own half), **reset by every deploy**, and **evadable by an attacker who rotates more origins than the bounded map holds**. Bounding the map is not optional — an unbounded one is itself a memory-exhaustion vector — so these are the cost of counting in process, not defects to fix in place. The signal is a *spike detector*, never an audit ledger; anything that must be complete belongs in a provider-side rule.

Origin attribution is only as good as the address Express resolves. `trust proxy` is not currently set, so behind a hosting proxy every unauthenticated caller collapses into one bucket — the counter keys on the same tracker the rate limiter uses (authenticated subject first, origin second) so the two degrade together rather than disagreeing.

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

## Alerting

Configurable alerts (via the monitoring provider) for:

- Error rate exceeds threshold (e.g. >5% 5xx in 5 minutes).
- API downtime (health check fails).
- Database connection pool exhaustion.
- Stripe webhook processing failures.
- Push notification delivery failure spike — thresholds in [`ALERT_ROUTING.md`](../../docs/internal/ops/ALERT_ROUTING.md#push-notification-delivery).
