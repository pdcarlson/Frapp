-- Expose the pre-UPDATE subscription_status from apply_subscription_webhook
-- (GitHub #1979).
--
-- #731's CAS-win path still decided president-notify (and whether to stamp
-- `past_due_since`) from the handler's in-memory snapshot. Two concurrent
-- `past_due` events that both read `active` could both pass `isStaleWebhook`,
-- both win the time CAS, and both notify. This replaces the function so a
-- successful apply returns the row *and* the status that was live when the
-- UPDATE locked it. Notify is old ≠ new on that pair, not snapshot ≠ newStatus.
--
-- Return shape changes from `setof chapters` to a two-column composite
-- (`applied chapters`, `previous_subscription_status text`). The currently
-- deployed API reads the RPC as `setof chapters`, so this is not safe to apply
-- ahead of the API — ship with a full deploy (migrate then API in the same
-- run). CREATE OR REPLACE cannot change a return type; DROP then CREATE.
--
-- The UPDATE body is otherwise the #731 contract: mark CAS, `activate_if`
-- against the live row, non-null `past_due_since` ignored when the row is
-- already `past_due`. SELECT FOR UPDATE captures `previous_subscription_status`
-- atomically with that write.

drop function if exists apply_subscription_webhook(uuid, timestamptz, jsonb);

create function apply_subscription_webhook(
  p_chapter_id uuid,
  p_event_at timestamptz,
  p_patch jsonb
)
returns table (
  applied chapters,
  previous_subscription_status text
)
language plpgsql
security invoker
as $$
declare
  v_chapter chapters;
  v_previous text;
begin
  if p_event_at is null then
    raise exception 'apply_subscription_webhook: p_event_at is required';
  end if;

  -- Null patch is an empty patch: advance the mark, change no other columns.
  p_patch := coalesce(p_patch, '{}'::jsonb);

  select c.subscription_status
    into v_previous
    from chapters c
   where c.id = p_chapter_id
   for update;

  if not found then
    return;
  end if;

  update chapters
     set last_stripe_webhook_at = p_event_at,
         subscription_status = case
           when p_patch ? 'subscription_status'
             then p_patch->>'subscription_status'
           when jsonb_typeof(p_patch->'activate_if') = 'array'
            and subscription_status in (
              select jsonb_array_elements_text(p_patch->'activate_if')
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
           when jsonb_typeof(p_patch->'activate_if') = 'array'
            and subscription_status in (
              select jsonb_array_elements_text(p_patch->'activate_if')
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

  applied := v_chapter;
  previous_subscription_status := v_previous;
  return next;
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
