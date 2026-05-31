# Analytics (pseudonymous events)

**Status:** active
**Epic:** [#431 — Analytics (pseudonymous events)](https://github.com/pdcarlson/Frapp/issues/431)
**Spec:** [`spec/behavior/data-retention.md`](../../../spec/behavior/data-retention.md) #analytics-events-pseudonymous
**Updated:** 2026-05-31

> Pseudonymous product-analytics pipeline. Events are keyed by `hmac_sha256(per-environment-salt,
> user_id)`; the salt is held outside the analytics provider's environment. Chapter presidents can
> disable analytics for their chapter. The opt-out is enforced server-side for events that carry a
> `chapter_id` — today that's web; mobile has no active-chapter context yet (gated to a no-op until
> #253/#466 wire it). Payloads describe behavior, never content.

## Work units

| Unit | Issue | State | Depends on | Notes |
| ---- | ----- | ----- | ---------- | ----- |
| Pseudonymous event pipeline (HMAC keying) | [#464](https://github.com/pdcarlson/Frapp/issues/464) | shipped | — | shared keying util + server pipeline + web/mobile emitters + PostHog provider (shipped; issue closed) |
| Membership + opt-out enforcement on `POST /analytics/events` | [#551](https://github.com/pdcarlson/Frapp/issues/551) | open | #464 | enforce chapter membership + server-side opt-out on the events endpoint (tightens the #464 gate) |
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
- **Known limitations from #464 (carry into the dependent units):**
  - The server opt-out gate keys off the event's `chapter_id`. Web supplies the active chapter; the
    **mobile** client has no active-chapter context yet (preview shell — #253), so mobile events carry
    no `chapter_id` and the gate can't apply to them. Wire the active chapter into mobile analytics
    when mobile member flows land (#253) / under #466.
  - `forgetUser` → PostHog uses a sentinel `account-deleted` event; the provider-side "deleted users"
    automation that turns that into delete-all-events is **operational setup**, not code (configure
    when the PostHog project is provisioned under #465).
- Standalone duplicates reconciled (closed during 2026-05-31 triage): #480 (pseudonymous analytics /
  PostHog) → folded into #464/#431; #502 (analytics opt-out in Settings) → folded into #466.
