-- Atomic member-invoice payment application (FRA-15).
--
-- Stripe's payment_intent.succeeded webhook is the source of truth for member
-- dues payments. Applying it as separate status-update and ledger writes would
-- leave two gaps: a crash between the writes loses the ledger row, and a
-- duplicate delivery (or a webhook racing an admin's manual PAID transition)
-- double-inserts the PAYMENT transaction.
--
-- This function performs both writes inside its single implicit transaction.
-- The conditional UPDATE (`status = 'OPEN'`) is a compare-and-set: only one of
-- N concurrent callers moves the invoice to PAID and inserts the ledger row;
-- the rest update zero rows (`not found`) and return empty. The succeeded
-- PaymentIntent id is stamped onto the invoice so the row always ends
-- consistent with the money that actually moved, even if a different intent
-- was stored at initiation time.
--
-- `security invoker` (matching confirm_task_completion): the API always calls
-- this via the service-role SUPABASE_CLIENT, which bypasses RLS. If a caller
-- is ever routed through a user/anon client, the writes to the RLS-protected
-- financial tables would be denied — switch to `security definer` +
-- `set search_path = public` before doing so.

-- Idempotency floor (ADR-03 precedent: DB constraints, not app memory).
-- Both columns are unpopulated before this migration, so the indexes cannot
-- conflict with existing data.
create unique index if not exists idx_financial_invoices_payment_intent
  on financial_invoices (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- The `type` predicate leaves room for a future REFUND row referencing the
-- same charge.
create unique index if not exists idx_financial_transactions_payment_charge
  on financial_transactions (stripe_charge_id)
  where stripe_charge_id is not null and type = 'PAYMENT';

create or replace function apply_invoice_payment(
  p_invoice_id uuid,
  p_chapter_id uuid,
  p_payment_intent_id text,
  p_charge_id text
)
returns setof financial_invoices
language plpgsql
security invoker
as $$
declare
  v_invoice financial_invoices;
begin
  -- Compare-and-set: pay only an invoice that is still OPEN in this chapter.
  update financial_invoices
     set status = 'PAID',
         paid_at = now(),
         stripe_payment_intent_id = p_payment_intent_id
   where id = p_invoice_id
     and chapter_id = p_chapter_id
     and status = 'OPEN'
  returning * into v_invoice;

  -- No row updated => invoice missing, already PAID (duplicate delivery or
  -- admin race), or VOID. Caller decides how loudly to log.
  if not found then
    return;
  end if;

  insert into financial_transactions (
    chapter_id, invoice_id, amount, type, stripe_charge_id
  )
  values (
    v_invoice.chapter_id,
    v_invoice.id,
    v_invoice.amount,
    'PAYMENT',
    p_charge_id
  );

  return next v_invoice;
end;
$$;

-- This RPC writes financial state and its authorization (Stripe signature
-- verification) lives in the NestJS webhook path, not in table RLS. Lock
-- EXECUTE to the service role the API uses so it can't be called directly via
-- PostgREST by an `anon`/`authenticated` user. Postgres grants EXECUTE to
-- PUBLIC by default, and Supabase's default privileges additionally grant it
-- straight to anon/authenticated — so all three must be revoked, not just
-- PUBLIC.
revoke execute on function apply_invoice_payment(uuid, uuid, text, text) from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function apply_invoice_payment(uuid, uuid, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function apply_invoice_payment(uuid, uuid, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function apply_invoice_payment(uuid, uuid, text, text) to service_role;
  end if;
end
$$;
