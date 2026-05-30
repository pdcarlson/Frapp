# Incident Response: Webhook Failures

## Detection signals

- Stripe dashboard shows repeated failed deliveries
- Sentry errors in webhook controller/billing service
- subscription status not updating in chapter records

## Triage steps

1. Check latest failing webhook event IDs in Stripe dashboard.
2. Verify endpoint URL: `/v1/webhooks/stripe`.
3. Confirm `STRIPE_WEBHOOK_SECRET` matches current endpoint secret.
4. Inspect API logs by request ID for signature failures vs handler failures.
5. Verify idempotency behavior (duplicate events should be safely skipped).

## Recovery checklist

- [ ] fix secret mismatch and redeploy if needed
- [ ] replay failed Stripe events from dashboard
- [ ] verify chapter subscription state consistency
- [ ] confirm no new webhook failures for 30 minutes

## Post-incident follow-up

- document failing event types and root cause
- add regression test case for the failing payload scenario
