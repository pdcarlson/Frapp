-- Sign-up sheets: headcount answers and closing (#3926, step 2).
--
-- Replaces `claim_signup_slots(uuid, uuid, text[])` (20261112250000) with a
-- version that takes the note a member may add to a headcount answer
-- (`p_note`, stored as the claim's `payload.note`; null or blank is none) and
-- refuses every claim once the card is closed:
--   signup_closed   `payload.closed_at` is set (closed early by its creator
--                   or a `channels:manage` holder, through the API), or
--                   `payload.closes_at` has passed.
-- The close is checked under the card's row lock, so a claim racing a close
-- either lands before it or is refused.
--
-- `p_note` has a default, so the older API's three-argument call (named
-- parameters through PostgREST) resolves to this function once the old one
-- is dropped: a deploy applies migrations before the API, and the API from
-- step 1 keeps working against it.
--
-- Everything else is step 1's function unchanged; its comments there hold.
--
-- Rollback: recreate the step 1 function from 20261112250000 in a later
-- forward migration and drop this one:
--   `drop function if exists public.claim_signup_slots(uuid, uuid, text[], text);`
-- Claims already written stay ordinary action rows; a `note` in one is
-- ignored by the older clients.

drop function if exists public.claim_signup_slots(uuid, uuid, text[]);

create or replace function public.claim_signup_slots(
  p_message_id uuid,
  p_user_id uuid,
  p_slot_ids text[],
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text;
  v_deleted boolean;
  v_payload jsonb;
  v_slot_id text;
  v_slot jsonb;
  v_capacity integer;
  v_taken integer;
  v_row chat_message_actions;
  v_updated boolean;
  v_closes_at timestamptz;
begin
  -- The row lock is what serializes claims on one card. `FOR UPDATE` on the
  -- message, not the action rows: the action row this claim will write may
  -- not exist yet, and a lock on nothing serializes nothing.
  select m.kind, m.is_deleted, m.payload
    into v_kind, v_deleted, v_payload
    from chat_messages m
   where m.id = p_message_id
     for update;

  if not found or v_kind is distinct from 'signup' or v_deleted then
    raise exception 'signup_card_missing';
  end if;

  -- Closed early (`closed_at`, written by the API's close route) or past its
  -- end time (`closes_at`). Read under the lock, so a claim that waited on a
  -- close sees it. An end time that doesn't parse is no end time: the API
  -- refuses one on send, and an odd row must not refuse every claim.
  if coalesce(v_payload ->> 'closed_at', '') <> '' then
    raise exception 'signup_closed';
  end if;
  begin
    v_closes_at := nullif(v_payload ->> 'closes_at', '')::timestamptz;
  exception when others then
    v_closes_at := null;
  end;
  if v_closes_at is not null and v_closes_at <= now() then
    raise exception 'signup_closed';
  end if;

  foreach v_slot_id in array coalesce(p_slot_ids, array[]::text[]) loop
    select s into v_slot
      from jsonb_array_elements(coalesce(v_payload -> 'slots', '[]'::jsonb)) s
     where s ->> 'id' = v_slot_id
     limit 1;

    if v_slot is null then
      raise exception 'signup_slot_unknown' using detail = v_slot_id;
    end if;

    -- A capacity that isn't a positive whole number is no limit. The API
    -- refuses such a card on send; this keeps an odd row from refusing
    -- every claim.
    v_capacity := case
      when jsonb_typeof(v_slot -> 'capacity') = 'number'
       and (v_slot ->> 'capacity') ~ '^[0-9]+$'
       and (v_slot ->> 'capacity')::integer > 0
      then (v_slot ->> 'capacity')::integer
    end;

    if v_capacity is not null then
      select count(*) into v_taken
        from chat_message_actions a
       where a.message_id = p_message_id
         and a.action_type = 'signup'
         and a.user_id <> p_user_id
         and jsonb_typeof(a.payload -> 'slot_ids') = 'array'
         and a.payload -> 'slot_ids' ? v_slot_id;

      if v_taken >= v_capacity then
        raise exception 'signup_slot_full' using detail = v_slot_id;
      end if;
    end if;

    v_slot := null;
  end loop;

  -- Read under the lock, so a second claim by the same member waits for the
  -- first and then sees its row.
  select exists (
    select 1 from chat_message_actions a
     where a.message_id = p_message_id
       and a.user_id = p_user_id
       and a.action_type = 'signup'
  ) into v_updated;

  -- One row per member per card (idx_chat_message_actions_dedupe). A change
  -- of slots updates it in place, so open cards see one UPDATE rather than a
  -- second row (ADR-07). Unlike a vote change it keeps `created_at`: the
  -- cards list each slot's holders by it, in the order they first signed up,
  -- and bumping it would move a member who adds a slot to the end of the one
  -- they already hold.
  insert into chat_message_actions (message_id, user_id, action_type, payload)
  values (
    p_message_id,
    p_user_id,
    'signup',
    jsonb_build_object('slot_ids', to_jsonb(coalesce(p_slot_ids, array[]::text[])))
      || case
           when nullif(btrim(p_note), '') is null then '{}'::jsonb
           else jsonb_build_object('note', btrim(p_note))
         end
  )
  on conflict (message_id, user_id, action_type)
  do update set payload = excluded.payload
  returning * into v_row;

  return jsonb_build_object('action', to_jsonb(v_row), 'updated', v_updated);
end;
$$;

revoke execute on function public.claim_signup_slots(uuid, uuid, text[], text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.claim_signup_slots(uuid, uuid, text[], text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.claim_signup_slots(uuid, uuid, text[], text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_signup_slots(uuid, uuid, text[], text) to service_role;
  end if;
end
$$;
