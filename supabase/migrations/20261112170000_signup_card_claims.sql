-- Sign-up sheet cards in chat (#3926, step 1).
--
-- A sign-up card is a `chat_messages` row with `kind = 'signup'` whose
-- `payload.slots` lists each slot's `id`, `label` and `capacity` (a whole
-- number, or null for no limit). A member's claim is their one
-- `chat_message_actions` row with `action_type = 'signup'`, whose
-- `payload.slot_ids` lists every slot they hold (ADR-07's one row per member,
-- changed in place). Nothing new is stored: `kind` carries no CHECK constraint
-- (20260823123000), and the action row reaches every open card through the
-- Realtime path and SELECT policy that poll votes already use.
--
-- What this adds is the one write that has to be atomic. A slot's limit is
-- checked against everyone else's claims, and two members taking the last
-- spot at the same moment must not both get it. `claim_signup_slots` locks
-- the card's message row, so claims on one card run one at a time, then
-- counts the other members' claims on each slot asked for and refuses a full
-- one before it writes. A slot the member already holds is never refused: the
-- count leaves out their own row.
--
-- Errors, read by the API repository by message:
--   signup_card_missing   the message is gone, deleted, or not a sign-up card
--   signup_slot_unknown   a slot id the card doesn't list
--   signup_slot_full      a slot asked for is at its limit (DETAIL names it)
--
-- Called only by the API on the service-role path, after it has checked the
-- member can read the channel; execute is revoked from everyone else.
--
-- Rollback: `drop function if exists public.claim_signup_slots(uuid, uuid, text[]);`
-- Claims already written stay ordinary action rows.

create or replace function public.claim_signup_slots(
  p_message_id uuid,
  p_user_id uuid,
  p_slot_ids text[]
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
  -- of slots updates it in place and bumps `created_at`, as a vote change
  -- does (ADR-07), so open cards see one UPDATE rather than a second row.
  insert into chat_message_actions (message_id, user_id, action_type, payload)
  values (
    p_message_id,
    p_user_id,
    'signup',
    jsonb_build_object('slot_ids', to_jsonb(coalesce(p_slot_ids, array[]::text[])))
  )
  on conflict (message_id, user_id, action_type)
  do update set payload = excluded.payload, created_at = now()
  returning * into v_row;

  return jsonb_build_object('action', to_jsonb(v_row), 'updated', v_updated);
end;
$$;

revoke execute on function public.claim_signup_slots(uuid, uuid, text[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.claim_signup_slots(uuid, uuid, text[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.claim_signup_slots(uuid, uuid, text[]) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_signup_slots(uuid, uuid, text[]) to service_role;
  end if;
end
$$;
