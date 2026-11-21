-- Message threads: the thread card's latest-reply preview (#4297, slice 2).
--
-- spec/behavior/chat/README.md § Message threads owns the rule. The parent's
-- thread card shows "Devin: grill is in my garage…" under its count, so the
-- parent row carries its newest reply that isn't deleted, beside the summary
-- columns `20261110220000_chat_message_threads.sql` added, for the same
-- reason: a `postgres_changes` echo cannot carry a join, so the parent's own
-- UPDATE echo is how every open client learns what the latest reply says.
--
-- Additive only:
--
-- 1. `chat_messages.thread_last_reply` (jsonb, null): `id`, `sender_id`,
--    `content` cut to 500 characters (what a one-line preview flattens, as
--    `get_channel_latest_messages` cuts it), `kind`, `attachment_count`
--    (the reply's `metadata` number, else 0; a client still reads it
--    defensively, as it does the reply's own) and `created_at`.
-- 2. `chat_messages_bump_thread_summary` (the insert trigger) also sets it,
--    when the new reply is at least as new as the one it holds.
-- 3. A new update trigger, `chat_messages_thread_last_reply`, keeps it when
--    the reply it holds is edited, deleted (it falls back to the newest reply
--    left), re-attributed (a Discord author link) or loses its attachments.
-- 4. Backfills every parent that already has replies.
--
-- The column is author content of the REPLIER, not of the parent's author:
-- the API's reads that mask (`chat-block-mask.ts`) null it for a viewer who
-- blocked that replier, and each client applies its own list to the echo.

-- 1. The column --------------------------------------------------------------

alter table public.chat_messages
  add column if not exists thread_last_reply jsonb;

-- What the parent holds of one reply. A helper so the insert trigger, the
-- update trigger and the backfill can't disagree on the shape.
create or replace function public.chat_thread_reply_preview(
  m public.chat_messages
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', m.id,
    'sender_id', m.sender_id,
    'content', left(coalesce(m.content, ''), 500),
    'kind', m.kind,
    'attachment_count', case
      when jsonb_typeof(m.metadata -> 'attachment_count') = 'number'
        then m.metadata -> 'attachment_count'
      else '0'::jsonb
    end,
    'created_at', m.created_at
  )
$$;

revoke execute on function public.chat_thread_reply_preview(public.chat_messages) from public;

-- 2. The insert trigger, redefined from `20261110220000` with one more column -

create or replace function public.chat_messages_bump_thread_summary()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update chat_messages p
     set thread_reply_count = p.thread_reply_count + 1,
         thread_last_reply_at = greatest(
           coalesce(p.thread_last_reply_at, '-infinity'::timestamptz),
           new.created_at
         ),
         -- Newest sender first, each once, at most three: the chip's avatars.
         -- A null sender (an imported row) has no avatar to show.
         thread_recent_sender_ids = case
           when new.sender_id is null then p.thread_recent_sender_ids
           else (
             array_prepend(
               new.sender_id,
               array_remove(p.thread_recent_sender_ids, new.sender_id)
             )
           )[1:3]
         end,
         -- The card's preview: the newest reply not deleted (#4297). Compared
         -- with the reply it holds, not `thread_last_reply_at`, which still
         -- dates a deleted newest reply. Every SET reads the row as it was,
         -- and a concurrent reply's update re-reads it first, so the later
         -- of two replies wins whichever commits first.
         thread_last_reply = case
           when new.is_deleted then p.thread_last_reply
           when new.created_at >= coalesce(
             (p.thread_last_reply ->> 'created_at')::timestamptz,
             '-infinity'::timestamptz
           ) then chat_thread_reply_preview(new)
           else p.thread_last_reply
         end
   where p.id = new.thread_root_id;
  return null;
end
$$;

-- 3. Keeping it when the reply it holds changes ------------------------------

-- `security definer` for the reason `chat_messages_bump_thread_summary` is.
-- Touches the parent only when it holds this very reply, so editing an older
-- reply writes nothing. The parent's own update sets none of the watched
-- columns and has no `thread_root_id`, so it never re-enters this trigger.
create or replace function public.chat_messages_keep_thread_last_reply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update chat_messages p
     set thread_last_reply = case
           when not new.is_deleted then chat_thread_reply_preview(new)
           else (
             select chat_thread_reply_preview(r)
               from chat_messages r
              where r.thread_root_id = new.thread_root_id
                and not r.is_deleted
              order by r.created_at desc
              limit 1
           )
         end
   where p.id = new.thread_root_id
     and p.thread_last_reply ->> 'id' = new.id::text;
  return null;
end
$$;

drop trigger if exists chat_messages_thread_last_reply on public.chat_messages;
create trigger chat_messages_thread_last_reply
  after update of content, is_deleted, sender_id, metadata, kind
  on public.chat_messages
  for each row
  when (new.thread_root_id is not null
        and (old.content is distinct from new.content
             or old.is_deleted is distinct from new.is_deleted
             or old.sender_id is distinct from new.sender_id
             or old.metadata -> 'attachment_count'
                is distinct from new.metadata -> 'attachment_count'
             or old.kind is distinct from new.kind))
  execute function public.chat_messages_keep_thread_last_reply();

revoke execute on function public.chat_messages_keep_thread_last_reply() from public;

-- Supabase grants new functions to `anon` and `authenticated` directly, so
-- revoking from `public` alone leaves them callable. A trigger function has
-- no caller but the trigger, and the preview helper none but these.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.chat_messages_keep_thread_last_reply() from anon;
    revoke execute on function public.chat_thread_reply_preview(public.chat_messages) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.chat_messages_keep_thread_last_reply() from authenticated;
    revoke execute on function public.chat_thread_reply_preview(public.chat_messages) from authenticated;
  end if;
end
$$;

-- 4. Backfill ------------------------------------------------------------------

-- Every parent with replies, from its newest reply not deleted. Threads
-- shipped on 2026-11-10, so this is a handful of rows; each one's update
-- echoes to the channel's open clients like any summary change.
update public.chat_messages p
   set thread_last_reply = (
         select public.chat_thread_reply_preview(r)
           from public.chat_messages r
          where r.thread_root_id = p.id
            and not r.is_deleted
          order by r.created_at desc
          limit 1
       )
 where p.thread_reply_count > 0
   and p.thread_root_id is null
   and p.thread_last_reply is null;
