# Alert Routing

## Primary channels

- **Critical production alerts:** on-call paging channel
- **Non-critical staging alerts:** engineering notifications channel
- **Error tracking:** Sentry project alerts — org `frapp-live`, project `frapp-api`

> **Sentry alert rules are dashboard-only.** Sentry's issue-alert-rule API answers `HTTP 410 {"message":"This API no longer exists."}`, so no agent or script can create, read, or verify a rule. Every rule below has to be created by a human in the Sentry UI, and its existence cannot be asserted in CI — treat the dashboard as the source of truth and re-check it by hand when routing changes.

## Critical alerts

- API health check down
- sustained 5xx error-rate threshold breaches
- webhook delivery failure spikes
- push notification delivery failure spikes
- database latency saturation impacting request SLAs

## Thresholds

### Push notification delivery

Source: the `push_delivery` structured log records the API emits once per push attempt. Field-by-field shape: [`spec/behavior/observability.md`](../../../spec/behavior/observability.md#push-delivery).

| Alert | Condition | Routing |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------ |
| Push delivery failure spike | `sum(failures) / sum(attempted)` over a 15-minute window exceeds **20%**, with at least **20** attempts in that window | critical |
| Push transport degraded | any `errorCodes` key matching `provider:*` within a 15-minute window | non-critical |

The minimum-attempt floor keeps one failed send in a quiet overnight period from paging. Elevated `DeviceNotRegistered` is expected background noise — it means members uninstalled the app, and stale tokens are not pruned yet (tracked separately in [#524](https://github.com/pdcarlson/Frapp/issues/524), formerly FRA-218) — so track its share rather than paging on it. `provider:*` codes are the opposite: they mean the push service itself was unreachable and nothing was delivered.

### Security events

Source: the `security_event` structured log records the API emits on every 401, 403, and 429. Field-by-field shape: [`spec/behavior/observability.md`](../../../spec/behavior/observability.md#security-events).

| Alert | Condition | Routing |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------ |
| Auth-failure spike | one `originHash` produces **20** `kind: auth_failure` records within **5 minutes** | critical |
| Authorization-denial spike | `kind: authorization_denied` rate over a 15-minute window exceeds its trailing weekly baseline by 10× | non-critical |
| Throttle saturation | `kind: rate_limit_rejected` exceeds **5%** of all requests over a 15-minute window | non-critical |

Only the first is currently **implemented**, as an in-process counter that emits a `warning`-level Sentry event tagged `security_event: auth_failure_spike`. The other two rows are the intended thresholds, not live rules — they need a provider-side query over the log stream.

The in-process counter is per-instance, reset by deploys, and evadable by origin rotation (reasoning in the spec section linked above). It is a first-alert mechanism, not a complete count, and a provider-side rule over the same records is the layer that closes those gaps.

**A denial spike is not automatically an attack.** A botched deploy that invalidates sessions, an expired signing key, or a client shipping a bad token all present as an auth-failure spike. Check whether the failures share one `originHash` (an attacker) or fan out across many (something of ours broke) before escalating.

## Escalation

1. On-call acknowledges within 5 minutes.
2. If unresolved in 15 minutes, escalate to backend lead.
3. If customer-impacting for 30+ minutes, involve product leadership and status communications.
