-- Deleting a chat message removes the in-app notifications it produced (#4418).
--
-- spec/behavior/chat/README.md § Edit and delete owns the rule. A chat push
-- writes each recipient an in-app row whose body is the first 200 characters
-- of the message (`chatPushPreview`), and until now nothing tied that row
-- back to the message: a delete, the sender's own or an officer's removal of
-- a reported message, left the words in every recipient's notification list.
-- Paul approved deleting the rows (2026-11-12, on #4418).
--
-- 1. `notifications.chat_message_id`: the message a chat row quotes. The chat
--    push worker sets it on a single-message row. A burst bundle ("5 new
--    messages") quotes nothing and leaves it null, as does every row that is
--    not about one chat message. `on delete cascade`, so a hard delete (a
--    channel delete, the Discord import purge) takes the rows with it too.
--    Rows written before this cannot be matched and keep their body: on
--    production at the time of writing, 576 single-message chat rows, none
--    of them about a message that had been deleted.
--
-- 2. A trigger on `chat_messages` deletes those rows in the same statement
--    that soft-deletes the message, so every delete path is covered without
--    the API having to remember, and the two cannot half-happen.
--
-- 3. A trigger on `notifications` drops the insert of a row about a message
--    already deleted (or gone), which closes the race where the push worker
--    is still fanning out a message its sender deletes a moment later. The
--    push itself may still go out; that is the only window left.
--
-- WHAT THIS DELETES, going forward and not now: `notifications` rows whose
-- `chat_message_id` names a message as it is deleted. Nothing is deleted when
-- this migration runs. Tested by scripts/pglite/tiers/notifications-forget-deleted-message.mjs.

alter table public.notifications
  add column if not exists chat_message_id uuid
    references public.chat_messages (id) on delete cascade;

create index if not exists idx_notifications_chat_message
  on public.notifications (chat_message_id)
  where chat_message_id is not null;

-- `security definer` for the reason `chat_messages_index_links` is: the API's
-- service role bypasses RLS, but a delete reached any other way must still
-- remove every recipient's row, not only the rows its caller could see.
create or replace function public.chat_messages_forget_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from notifications where chat_message_id = new.id;
  return null;
end
$$;

drop trigger if exists chat_messages_forget_notifications on public.chat_messages;
create trigger chat_messages_forget_notifications
  after update of is_deleted on public.chat_messages
  for each row
  when (new.is_deleted and not old.is_deleted)
  execute function public.chat_messages_forget_notifications();

create or replace function public.notifications_skip_deleted_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from chat_messages
     where id = new.chat_message_id
       and not is_deleted
  ) then
    return null;
  end if;
  return new;
end
$$;

drop trigger if exists notifications_skip_deleted_message on public.notifications;
create trigger notifications_skip_deleted_message
  before insert on public.notifications
  for each row
  when (new.chat_message_id is not null)
  execute function public.notifications_skip_deleted_message();

revoke execute on function public.chat_messages_forget_notifications() from public;
revoke execute on function public.notifications_skip_deleted_message() from public;

-- Supabase grants new functions to `anon` and `authenticated` directly, so
-- revoking from `public` alone leaves them callable. A trigger function has
-- no caller but the trigger.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.chat_messages_forget_notifications() from anon;
    revoke execute on function public.notifications_skip_deleted_message() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.chat_messages_forget_notifications() from authenticated;
    revoke execute on function public.notifications_skip_deleted_message() from authenticated;
  end if;
end
$$;
