# Analytics (pseudonymous events)

**Status:** active
**Epic:** [#431 — Analytics (pseudonymous events)](https://github.com/pdcarlson/Frapp/issues/431)
**Spec:** [`spec/behavior/data-retention.md`](../../../spec/behavior/data-retention.md) #analytics-events-pseudonymous
**Updated:** 2026-05-30

> Pseudonymous product-analytics pipeline. Events are keyed by `hmac_sha256(per-environment-salt,
> user_id)`; the salt is held outside the analytics provider's environment. Chapter presidents can
> disable analytics for their chapter (enforced client- and server-side). Payloads describe behavior,
> never content.

## Work units

| Unit | Issue | State | Depends on | Notes |
| ---- | ----- | ----- | ---------- | ----- |
| Pseudonymous event pipeline (HMAC keying) | [#464](https://github.com/pdcarlson/Frapp/issues/464) | open | — | shared keying util + server pipeline + web/mobile emitters + PostHog provider (PR in flight) |
| Salt management (per-env, out-of-provider) | [#465](https://github.com/pdcarlson/Frapp/issues/465) | open | — | one salt/env in the Stripe/Supabase secret store; consumes `ANALYTICS_HMAC_SALT` (#464) |
| Chapter opt-out toggle | [#466](https://github.com/pdcarlson/Frapp/issues/466) | open | #464 | gated by `chapter-config:manage`; writes `chapters.analytics_opt_out` (column + server check added by #464) |

## Notes / decisions

- **Keying is server-side** (not in the client SDK as the issue's literal wording implied): a
  `NEXT_PUBLIC_`/`EXPO_PUBLIC_` salt would ship to clients and defeat pseudonymity. The spec wins —
  clients post behavioral events to `POST /v1/analytics/events` and the API keys them. Recorded in
  `spec/behavior/data-retention.md` (#analytics-events-pseudonymous → "Keying happens server-side").
- #464 lays groundwork the dependent units consume: the `ANALYTICS_HMAC_SALT` env var (#465 owns
  provisioning/rotation) and the `chapters.analytics_opt_out` column + server-side gate (#466 owns the
  Settings toggle UI + `chapter-config:manage` permission). Account-deletion propagation exposes
  `AnalyticsService.forgetUser`; wiring it into the deletion flow belongs to #281.
- Related standalone duplicate to reconcile during triage: #480 (pseudonymous analytics / PostHog),
  #502 (analytics opt-out in Settings).
