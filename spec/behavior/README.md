# Behavior Specification: Frapp

This folder defines the rules, invariants, edge cases, and error behavior the system is **intended** to uphold.

**`spec/` is the source of truth for intended behavior. Code is the source of truth for current behavior.** Implementation should conform to these behaviors; when shipped code disagrees, that is a tracked bug to file — not a license to silently treat either side as automatically winning. See [`AGENTS.md`](../../AGENTS.md) § Spec vs code.

Each topic lives in its own file. Cross-cutting concerns (visual themeing, error shape, security invariants) live in this README.

## Topics

| Topic                                                | File                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| Multi-tenancy invariants                             | [`multi-tenancy.md`](multi-tenancy.md)     |
| RBAC, roles, presidency transfer                     | [`rbac.md`](rbac.md)                       |
| Backwork (academic library)                          | [`backwork.md`](backwork.md)               |
| Points ledger — security, audit, atomicity           | [`points.md`](points.md)                   |
| Chapter billing (Stripe), grace periods, dues        | [`billing.md`](billing.md)                 |
| Chat (channels, DMs, messages, slash commands)       | [`chat/`](chat/README.md)                  |
| Notifications and chat push                          | [`notifications.md`](notifications.md)     |
| Study sessions and geofences                         | [`study-sessions.md`](study-sessions.md)   |
| Events, attendance, recurring events, calendar       | [`events.md`](events.md)                   |
| Onboarding wizard + invites + walkthrough            | [`onboarding.md`](onboarding.md)           |
| Polls and voting                                     | [`polls.md`](polls.md)                     |
| Member directory and profiles                        | [`members.md`](members.md)                 |
| Activity feed                                        | [`activity-feed.md`](activity-feed.md)     |
| Global search                                        | [`search.md`](search.md)                   |
| Observability                                        | [`observability.md`](observability.md)     |
| Service hours (philanthropy)                         | [`service-hours.md`](service-hours.md)     |
| Tasks                                                | [`tasks.md`](tasks.md)                     |
| Chapter documents                                    | [`chapter-docs.md`](chapter-docs.md)       |
| Semester rollover                                    | [`semester-rollover.md`](semester-rollover.md) |
| Reports and export                                   | [`reports.md`](reports.md)                 |
| Legal (ToS, Privacy, FERPA)                          | [`legal.md`](legal.md)                     |
| Data retention                                       | [`data-retention.md`](data-retention.md)   |
| Alumni features                                      | [`alumni.md`](alumni.md)                   |
| Chapter branding                                     | [`branding.md`](branding.md)               |
| Settings shell, customization, audit                 | [`settings/`](settings/README.md)          |
| Ops integrations                                     | [`integrations.md`](integrations.md)       |
| Meetings (transcription + AI summary)                | [`meetings.md`](meetings.md)               |
| Vault (encrypted private storage)                    | [`vault.md`](vault.md)                     |
| AI features (corpus scope, citations, non-goals)     | [`ai.md`](ai.md)                           |
| Chapter config endpoints                             | [`chapter-config.md`](chapter-config.md)   |

Each topic file is canonical **intended** behavior. Delivery (which is shipped vs. queued) is tracked in **GitHub Issues** (see [`docs/internal/ci-cd/GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md)), not in this spec.

---

## Dark Mode

- Full dark mode support across web and mobile.
- Respects the device/OS system preference by default.
- Manual override available in user settings (Light, Dark, System).
- Palette, typeface, and dark-first Signet tokens live in [`spec/ui/brand-identity.md`](../ui/brand-identity.md) and [`spec/ui/design-system/`](../ui/design-system/README.md) — do not duplicate values here. Frozen web/landing still ship the legacy `@repo/theme` tokens until their reskin.

---

## Error Handling Standards

All API errors follow a consistent shape:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Event with id abc123 not found in this chapter.",
  "requestId": "req_abc123def456"
}
```

- Internal errors (500) never expose database details or stack traces. The `requestId` enables support to locate the full error in logs.
- All errors are logged with structured context: `[ServiceName] message | detail: {...} | requestId: ... | error: stack`.
- Validation errors (400) return the full list of field-level issues from the validation pipe.
- Rate limit errors (429) include a `Retry-After` header.

---

## Security Invariants

- All API endpoints (except `/health` and webhooks) require authentication.
- All data access is scoped by `chapter_id`. No cross-chapter data access is possible through any endpoint.
- Webhook endpoints (Stripe) verify signatures before processing. Invalid signatures return 401 and are logged as security events.
- File uploads are scanned for allowed MIME types. Disallowed types are rejected before storage.
- Rate limiting is applied per user per endpoint to prevent abuse. Default: 100 requests/minute for read endpoints, 30 requests/minute for write endpoints. Every handler holds its own counter per caller, so these are per-endpoint ceilings rather than one shared pool. Selected routes carry stricter static limits (table below); the limits are **not** chapter-configurable — no product surface exposes them. Exception: `POST /v1/webhooks/stripe` is exempt from rate limiting — Stripe delivers bursts from a small shared IP pool and the route is unauthenticated, so IP-keyed throttling would 429 real billing events; signature verification (invalid → 401) is the abuse control on that route.

### Per-route rate limits

Routes whose cost or blast radius is not proportional to the request. Everything not listed sits on the 100/30 default.

| Route | Limit | Why |
| --- | --- | --- |
| `POST /v1/reports/attendance`, `/points`, `/roster`, `/service` | 5/min | Full-chapter aggregation plus export rendering. |
| `POST /v1/invites/batch` | 5/min | Mints `count` invite tokens in one call. |
| `POST /v1/invites/redeem` | 10/min | Token-guessing surface. |
| `POST /v1/events`, `PATCH /v1/events/:id` | 10/min | Each one pushes a notification to every member of the chapter. |
| Every signed-upload-URL route — `POST /v1/documents/upload-url`, `/v1/backwork/upload-url`, `/v1/channels/:id/upload-url`, `/v1/chapters/current/logo-url`, `/v1/service-entries/proof-upload-url`, `/v1/users/me/avatar-url` | 10/min | Mints signed object-storage URLs. The rule is per-mechanism, not per-module: a new upload route inherits this limit. |
| `GET /v1/search` | 20/min | Four leading-wildcard `ILIKE` scans per call. |

`POST /v1/points/adjust` is deliberately absent: its abuse control is the 50-adjustments-per-hour anti-fraud rule in the points service (see [`points.md`](points.md)), not the throttler. `POST /v1/channels/:id/messages` also fans out push notifications but keeps the 30/min default — it is the chat send path, and a lower ceiling would degrade normal use.
- Passwords are never stored by Frapp. Authentication is delegated entirely to Supabase Auth.
- All secrets (Supabase keys, Stripe keys) are injected via environment variables. Never committed to version control. Never logged.
