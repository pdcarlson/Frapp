-- Atomic Stripe subscription-status application (GitHub #731 / FRA-287).
--
-- FRA-242 added `chapters.last_stripe_webhook_at` and an in-memory stale check
-- in BillingService (`isStaleWebhook`) so a *sequentially* late event cannot
-- overwrite a newer status. The check and the `chapterRepo.update` are still
-- two steps: concurrent deliveries for the same chapter can both pass the
-- read, then the later-committing writer wins — which can be the *older*
-- event. This function folds the ordering predicate into the UPDATE so that
-- race loses by returning empty, matching confirm_task_completion /
-- apply_invoice_payment.
--
-- `p_patch` is a sparse jsonb of columns to set. Absent keys are left
-- untouched; a JSON `null` value clears a nullable column (`past_due_since`
-- on leaving past_due). `last_stripe_webhook_at` is always stamped from
-- `p_event_at` when the row is taken, including a renewal `invoice.paid` that
-- sends only `activate_if` — that mark-advance is what drops a later-delivered
-- earlier-created dunning event (spec/behavior/billing.md Webhook Reliability).
-- Same-second events (`last_stripe_webhook_at = p_event_at`) are allowed
-- through, matching FRA-242: Stripe `event.created` is whole seconds.
--
-- `activate_if` (jsonb array of statuses) is evaluated against the pre-UPDATE
-- row: `invoice.paid` reactivates only while the chapter is still `past_due`
-- or `incomplete`, so a concurrent cancel cannot be overwritten by a patch
-- computed against a stale snapshot. A non-null `past_due_since` in the patch
-- is ignored when the row is already `past_due`, so two concurrent into-
-- past_due writers cannot reset the grace clock.
--
-- `security invoker` (matching apply_invoice_payment): the API always calls
-- this via the service-role SUPABASE_CLIENT, which bypasses RLS. Lock EXECUTE
-- to service_role so it cannot be invoked through PostgREST as anon/
-- authenticated.

create or replace function apply_subscription_webhook(
  p_chapter_id uuid,
  p_event_at timestamptz,
  p_patch jsonb
)
returns setof chapters
language plpgsql
security invoker
as $$
declare
  v_chapter chapters;
begin
  if p_event_at is null then
    raise exception 'apply_subscription_webhook: p_event_at is required';
  end if;

  -- Null patch is an empty patch: advance the mark, change no other columns.
  p_patch := coalesce(p_patch, '{}'::jsonb);

  update chapters
     set last_stripe_webhook_at = p_event_at,
         subscription_status = case
           when p_patch ? 'subscription_status'
             then p_patch->>'subscription_status'
           when p_patch ? 'activate_if'
            and subscription_status in (
              select jsonb_array_elements_text(
                coalesce(p_patch->'activate_if', '[]'::jsonb)
              )
            )
             then 'active'
           else subscription_status
         end,
         past_due_since = case
           when p_patch ? 'past_due_since'
             then case
               when p_patch->>'past_due_since' is null then null
               when subscription_status = 'past_due' then past_due_since
               else (p_patch->>'past_due_since')::timestamptz
             end
           when p_patch ? 'activate_if'
            and subscription_status in (
              select jsonb_array_elements_text(
                coalesce(p_patch->'activate_if', '[]'::jsonb)
              )
            )
             then null
           else past_due_since
         end,
         subscription_id = case
           when p_patch ? 'subscription_id'
             then p_patch->>'subscription_id'
           else subscription_id
         end,
         stripe_customer_id = case
           when p_patch ? 'stripe_customer_id'
             then p_patch->>'stripe_customer_id'
           else stripe_customer_id
         end
   where id = p_chapter_id
     and (
       last_stripe_webhook_at is null
       or last_stripe_webhook_at <= p_event_at
     )
  returning * into v_chapter;

  if not found then
    return;
  end if;

  return next v_chapter;
end;
$$;

revoke execute on function apply_subscription_webhook(uuid, timestamptz, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function apply_subscription_webhook(uuid, timestamptz, jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function apply_subscription_webhook(uuid, timestamptz, jsonb) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function apply_subscription_webhook(uuid, timestamptz, jsonb) to service_role;
  end if;
end
$$;
