-- Form cards in chat (#3926, step 3): a member's answers to a form.
--
-- A form card is a `chat_messages` row with `kind = 'form'` whose `payload`
-- holds the title, an optional description and `payload.questions` (each an
-- `id`, `type`, `title`, `required` and, for a choice question, `options`).
-- `kind` carries no CHECK constraint (20260823123000), so the card itself
-- needs no schema.
--
-- What it does need is somewhere private for answers. A sign-up claim and a
-- poll vote are `chat_message_actions` rows, which every member of the
-- channel reads (they show names and counts on the card). A form's answers
-- are seen only by the member who wrote them and, from step 4, the form's
-- creator, so they get their own table:
--
-- 1. `chat_form_responses`: one row per member per form, the member's latest
--    answers keyed by question id. RLS on and **no policies**: API only,
--    through the service role, like `chapter_document_stars` and
--    `activity_item_reads`. The table is **not** added to the
--    `supabase_realtime` publication, so no answer is ever broadcast; a
--    member's own card learns they answered from the API.
-- 2. `save_chat_form_response`: the one write. It locks the card's message
--    row (`FOR SHARE`, so saves on one form run side by side but wait for a
--    close, which updates the row) and refuses a card that is gone, deleted,
--    not a form, or closed (`closed_at` set, or `closes_at` passed), then
--    upserts the member's row. The API has already checked the answers
--    against the card's questions and that the member can read the channel.
-- 3. A trigger on `users.deleted_at`, which `anonymize_user` sets, deletes
--    the member's answers, as `users_disconnect_google_calendar` does for
--    that feature: `anonymize_user` is not redefined here.
--
-- Errors, read by the API repository by message:
--   form_card_missing   the message is gone, deleted, or not a form card
--   form_closed         the form takes no more answers

-- 1. ------------------------------------------------------------------------

create table if not exists public.chat_form_responses (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- The member's own row is the primary key. Step 4's responses view reads one
-- form's rows, which is the primary key's leading column.

alter table public.chat_form_responses enable row level security;

-- 2. ------------------------------------------------------------------------

create or replace function public.save_chat_form_response(
  p_message_id uuid,
  p_user_id uuid,
  p_answers jsonb
)
returns public.chat_form_responses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text;
  v_deleted boolean;
  v_payload jsonb;
  v_closes_at timestamptz;
  v_row public.chat_form_responses;
begin
  -- FOR SHARE: a close is an UPDATE of this row, so it waits for saves in
  -- flight and every save after it sees `closed_at`.
  select m.kind, m.is_deleted, m.payload
    into v_kind, v_deleted, v_payload
    from public.chat_messages m
   where m.id = p_message_id
     for share;

  if v_kind is distinct from 'form' or coalesce(v_deleted, false) then
    raise exception 'form_card_missing';
  end if;

  if coalesce(v_payload ->> 'closed_at', '') <> '' then
    raise exception 'form_closed';
  end if;
  begin
    v_closes_at := (v_payload ->> 'closes_at')::timestamptz;
  exception when others then
    v_closes_at := null;
  end;
  if v_closes_at is not null and v_closes_at <= now() then
    raise exception 'form_closed';
  end if;

  insert into public.chat_form_responses as r
    (message_id, user_id, answers)
  values (p_message_id, p_user_id, p_answers)
  on conflict (message_id, user_id) do update
    set answers = excluded.answers,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.save_chat_form_response(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_chat_form_response(uuid, uuid, jsonb)
  to service_role;

-- 3. ------------------------------------------------------------------------

create or replace function public.chat_form_responses_drop_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.chat_form_responses where user_id = new.id;
  return new;
end;
$$;

revoke execute on function public.chat_form_responses_drop_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_drop_chat_form_responses on public.users;
create trigger users_drop_chat_form_responses
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.chat_form_responses_drop_deleted_user();
