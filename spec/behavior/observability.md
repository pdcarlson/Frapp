# Observability

## Structured Logging

Every API request is logged as structured JSON with: request ID, user ID, chapter ID, endpoint, HTTP method, status code, response latency, and timestamp.

**Identifier handling (internal logs):** `user_id` and `chapter_id` are retained as raw values in internal structured logs because the logs are confined to Frapp-internal observability tooling and operate under the internal retention policy. They are **not** PII-scrubbed at the log boundary — scrubbing applies only at external-reporting boundaries (Sentry / external observability vendors). Email addresses, IPs, auth tokens, request bodies, and response bodies are never logged.

## Request Tracing

A unique `x-request-id` header is generated for each incoming request (or preserved if the client sends one). This ID is included in all log entries and all error responses, enabling end-to-end tracing. The request ID itself is non-PII and may be surfaced in client-facing error messages.

## Health Check

`GET /health` returns service status, database connectivity, Supabase connectivity, and uptime. Used by monitoring tools and load balancers. No authentication required.

## Error Tracking

Integrate with Sentry (or equivalent). All unhandled exceptions and 5xx responses are reported with: request ID, endpoint, HTTP method, status code, and stack trace. External error reporting requires explicit PII handling:

- **Pseudonymized before sending:** `user_id` and `chapter_id` are sent as HMAC-SHA256 hashes using the same per-environment salt as the analytics pipeline (see [`data-retention.md`](data-retention.md) #analytics-events-pseudonymous). Reversing the hash requires access to the salt, which is held outside the error-reporting provider.
- **Redacted entirely:** email addresses, IP addresses, auth tokens (including any `Authorization` header value), request bodies, response bodies, message contents, document contents, and any free-text fields that may contain user-typed PII.

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

**No token values are ever logged** — counts only. A push token echoed back inside a provider error message is redacted to `ExponentPushToken[REDACTED]` before the error is logged, consistent with the auth-token rule under Structured Logging.

A send in which every token is invalid still emits a record: a push that reaches nobody must not be indistinguishable from having nothing to send.

## Alerting

Configurable alerts (via the monitoring provider) for:

- Error rate exceeds threshold (e.g. >5% 5xx in 5 minutes).
- API downtime (health check fails).
- Database connection pool exhaustion.
- Stripe webhook processing failures.
- Push notification delivery failure spike — thresholds in [`ALERT_ROUTING.md`](../../docs/internal/ops/ALERT_ROUTING.md#push-notification-delivery).
