# Analytics (pseudonymous events)

**Status:** queued
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
| Pseudonymous event pipeline (HMAC keying) | [#464](https://github.com/pdcarlson/Frapp/issues/464) | open | — | client + server both hash user_id before send |
| Salt management (per-env, out-of-provider) | [#465](https://github.com/pdcarlson/Frapp/issues/465) | open | — | one salt/env in the Stripe/Supabase secret store |
| Chapter opt-out toggle | [#466](https://github.com/pdcarlson/Frapp/issues/466) | open | #464 | gated by `chapter-config:manage`; defense in depth |

## Notes / decisions

- Related standalone duplicate to reconcile during triage: #480 (pseudonymous analytics / PostHog),
  #502 (analytics opt-out in Settings).
