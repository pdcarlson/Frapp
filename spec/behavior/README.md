# Behavior Specification: Frapp

This folder defines the rules, invariants, edge cases, and error behavior that the system must uphold. Implementation (API, database, clients) must conform to these behaviors.

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
| Settings shell, customization, audit (chunks 06–08)  | [`settings/`](settings/README.md)          |
| Ops integrations (chunk 10a–10h)                     | [`integrations.md`](integrations.md)       |
| Meetings (transcription + AI summary)                | [`meetings.md`](meetings.md)               |
| Vault (encrypted private storage)                    | [`vault.md`](vault.md)                     |
| AI features (corpus scope, citations, non-goals)     | [`ai.md`](ai.md)                           |
| Chapter config endpoints                             | [`chapter-config.md`](chapter-config.md)   |

Each topic file is canonical behavior. Delivery of the chat-rework chunks (which is shipped vs. queued) is tracked in **GitHub Issues** (see [`docs/internal/ci-cd/GITHUB_PM.md`](../../docs/internal/ci-cd/GITHUB_PM.md)), not in this spec.

---

## Dark Mode

- Full dark mode support across web and mobile.
- Respects the device/OS system preference by default.
- Manual override available in user settings (Light, Dark, System).
- The "Modern Ivy" color palette has dark-mode variants defined in the theme package.

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
- Rate limiting is applied per user per endpoint to prevent abuse. Default: 100 requests/minute for read endpoints, 30 requests/minute for write endpoints. Chapter-configurable overrides for specific endpoints (e.g. chat send message may have a higher limit). Exception: `POST /v1/webhooks/stripe` is exempt from rate limiting — Stripe delivers bursts from a small shared IP pool and the route is unauthenticated, so IP-keyed throttling would 429 real billing events; signature verification (invalid → 401) is the abuse control on that route.
- Passwords are never stored by Frapp. Authentication is delegated entirely to Supabase Auth.
- All secrets (Supabase keys, Stripe keys) are injected via environment variables. Never committed to version control. Never logged.
