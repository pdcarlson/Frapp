# Alert Routing

## Primary channels

- **Critical production alerts:** on-call paging channel
- **Non-critical staging alerts:** engineering notifications channel
- **Error tracking:** Sentry project alerts

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

## Escalation

1. On-call acknowledges within 5 minutes.
2. If unresolved in 15 minutes, escalate to backend lead.
3. If customer-impacting for 30+ minutes, involve product leadership and status communications.
