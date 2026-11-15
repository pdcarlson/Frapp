-- Payment-attempt state on a member's invoice (#3460).
--
-- The pay endpoint stamps `last_payment_attempt_at` and clears the failure
-- columns each time it hands out a client secret (a new attempt). The
-- `payment_intent.payment_failed` webhook writes `last_payment_failed_at` and
-- `last_payment_failure_reason` on the OPEN invoice whose stored intent failed,
-- unless the failure predates the current attempt. The invoice reads return
-- the row, so a dues screen waiting on a payment can end its "confirmation
-- pending" hold with "Your payment didn't go through" instead of waiting on a
-- PAID that will never come. Status is untouched: a failed attempt leaves the
-- invoice OPEN and payable.

alter table public.financial_invoices
  add column if not exists last_payment_attempt_at timestamptz,
  add column if not exists last_payment_failed_at timestamptz,
  add column if not exists last_payment_failure_reason text;

comment on column public.financial_invoices.last_payment_attempt_at is
  'When the pay endpoint last handed out a client secret for this invoice (#3460).';
comment on column public.financial_invoices.last_payment_failed_at is
  'When the current payment attempt failed (payment_intent.payment_failed); null while none has (#3460).';
comment on column public.financial_invoices.last_payment_failure_reason is
  'Stripe''s member-facing decline message for the failed attempt, when it sent one (#3460).';
