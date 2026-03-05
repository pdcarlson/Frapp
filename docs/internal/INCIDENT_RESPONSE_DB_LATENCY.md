# Incident Response: Database Latency

## Detection signals

- elevated API latency (p95/p99)
- slow query log spikes in Supabase
- timeout-related 5xx errors

## Triage steps

1. Identify impacted endpoints from structured logs.
2. Correlate slow endpoints with recent migration/index changes.
3. Inspect Supabase query performance dashboard for top offenders.
4. Check connection saturation/pool pressure.

## Mitigation options

- add/reinstate missing indexes via forward-fix migration
- reduce expensive query scope temporarily (feature flag or guardrail)
- scale database tier if resource saturation is persistent

## Recovery checklist

- [ ] latency returns to baseline ranges
- [ ] timeout/5xx rate normalizes
- [ ] no sustained backlog on webhook/event processing

## Follow-up

- capture query plans for top slow queries
- add performance regression tests or alerts for recurring paths
