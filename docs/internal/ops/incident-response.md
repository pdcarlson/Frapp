# Incident response

Detection, triage and recovery for the three failure modes that have runbooks. Where an alert is
routed, who it pages, and the thresholds that fire it are in [`ALERT_ROUTING.md`](ALERT_ROUTING.md) —
this file starts once someone is already looking.

Database rollback and restore are their own procedures:
[`DB_ROLLBACK_PLAYBOOK.md`](DB_ROLLBACK_PLAYBOOK.md). Deploy and promotion are in
[`DEPLOYMENT.md`](DEPLOYMENT.md) and [`DB_PROMOTION_RUNBOOK.md`](DB_PROMOTION_RUNBOOK.md).

## API down

### Detection signals

- Uptime monitor fails `/health/ready` — **not `/health`**, which is Render's own `healthCheckPath` and is specified to always return 2xx while the process is up, so an HTTP-status monitor on it only ever catches a process that is down. Of the four root causes below it sees the two that kill the process (missing env vars, crash loop) and neither of the other two: an upstream Supabase outage returns `200` with `status: "degraded"` in the **body**, and a migration/schema mismatch typically returns `200 "ok"` outright, because `probeDatabase` is a single-row read of `chapters` rather than a schema check. Watch `/health/ready`, which 503s on a degraded dependency — or read the body, not the status
- Render service marked unhealthy
- Elevated 5xx alerts

### Triage steps

1. Confirm outage scope (`staging` vs `production`).
2. Check Render deploy/activity timeline.
3. Hit `/health` directly and inspect response body.
4. Inspect Render logs for startup/env errors.
5. Inspect Sentry for first error spike and root exception.

### Common root causes

- missing env vars after deploy
- migration/schema mismatch
- upstream Supabase outage/network issue
- crash loop from new runtime code path

### Recovery checklist

- [ ] Roll back Render deploy if latest release caused outage
- [ ] Validate required env vars are present
- [ ] Verify DB connectivity from API
- [ ] Re-run post-deploy smoke checks
- [ ] Confirm the uptime monitor is green on `/health/ready` for 10+ minutes — green on `/health` alone does not clear a degraded dependency

### Communication

- announce status page/internal channel updates every 15 minutes
- include mitigation ETA and current customer impact

## Database latency

### Detection signals

- elevated API latency (p95/p99)
- slow query log spikes in Supabase
- timeout-related 5xx errors

### Triage steps

1. Identify impacted endpoints from structured logs.
2. Correlate slow endpoints with recent migration/index changes.
3. Inspect Supabase query performance dashboard for top offenders.
4. Check connection saturation/pool pressure.

### Mitigation options

- add/reinstate missing indexes via forward-fix migration
- reduce expensive query scope temporarily (feature flag or guardrail)
- scale database tier if resource saturation is persistent

### Recovery checklist

- [ ] latency returns to baseline ranges
- [ ] timeout/5xx rate normalizes
- [ ] no sustained backlog on webhook/event processing

### Follow-up

- capture query plans for top slow queries
- add performance regression tests or alerts for recurring paths

## Webhook failures

### Detection signals

- Stripe dashboard shows repeated failed deliveries
- Sentry errors in webhook controller/billing service
- subscription status not updating in chapter records

### Triage steps

1. Check latest failing webhook event IDs in Stripe dashboard.
2. Verify endpoint URL: `/v1/webhooks/stripe`.
3. Confirm `STRIPE_WEBHOOK_SECRET` matches current endpoint secret.
4. Inspect API logs by request ID for signature failures vs handler failures.
5. Verify idempotency behavior (duplicate events should be safely skipped).

### Recovery checklist

- [ ] fix secret mismatch and redeploy if needed
- [ ] replay failed Stripe events from dashboard
- [ ] verify chapter subscription state consistency
- [ ] confirm no new webhook failures for 30 minutes

### Post-incident follow-up

- document failing event types and root cause
- add regression test case for the failing payload scenario
