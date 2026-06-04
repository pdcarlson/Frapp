-- FRA-242: record the Stripe `event.created` of the most recently *applied*
-- subscription webhook so BillingService can enforce timestamp-aware ordering
-- (spec/behavior/billing.md "Webhook Reliability"): an older or retried event
-- must not overwrite a newer subscription status. Subscription handlers skip any
-- event older than this high-water mark and advance it whenever they apply one.
--
-- Null = no subscription webhook has been applied yet (a chapter created before
-- this column existed, or one still `incomplete`). The first webhook then
-- applies unconditionally and stamps the mark, so no backfill is required.

alter table chapters
  add column if not exists last_stripe_webhook_at timestamptz;
