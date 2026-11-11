-- Unread dots on Activity (#4173, step 4; Shawn's pick, 2026-11-11).
--
-- spec/behavior/activity.md § Unread owns the rule. A row on Activity stays
-- unread until the member opens that item; opening it elsewhere (voting on a
-- poll in chat) doesn't count, though acting on it usually takes it off the
-- list anyway.
--
-- 1. `activity_item_reads`: one row per member per item they opened from
--    Activity, with when. An item is unread when it appeared after the
--    member last opened it, so a task they opened before it was completed
--    shows unread again in an officer's confirmations. The items come from
--    several modules (tasks, service entries, poll messages, events, links),
--    so `item_id` has no foreign key; a row whose item is gone is inert.
-- 2. `activity_unread_starts`: when each member's unread dots began, set
--    the first time a client that draws dots opens Activity. Nothing that
--    appeared before it is unread, so the first visit isn't a page of dots
--    for things the member already saw before any client could record an
--    open. No row means no dots yet.
-- 3. `tasks.sent_back_at`: when an officer last sent a completed task back to
--    its assignee. It waits on them again from then, so it is unread again.
--    The assignee taking back their own completion doesn't set it.
-- 4. `anonymize_user` also deletes the member's reads and start.
--
-- RLS on and no policies on both new tables: API only (service role), like
-- `chat_link_member_states`, the other per-member Activity state.

-- 1. ------------------------------------------------------------------------

create table if not exists public.activity_item_reads (
  user_id uuid not null references public.users (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  -- Which module's id `item_id` is: a task, a service entry, a poll card's
  -- chat message, an event or a sign-up link. `ACTIVITY_ITEM_KINDS` in the
  -- API is the same list.
  kind text not null
    check (kind in ('task', 'hours_entry', 'poll', 'event', 'link')),
  item_id uuid not null,
  -- The last time the member opened it. Opening it again moves it.
  read_at timestamptz not null default now(),
  primary key (user_id, chapter_id, kind, item_id)
);

-- The one read, "this member's reads of these items in this chapter", is
-- served by the primary key's leading columns.

alter table public.activity_item_reads enable row level security;

-- 2. ------------------------------------------------------------------------

create table if not exists public.activity_unread_starts (
  user_id uuid not null references public.users (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  -- Set once; a later client load leaves it alone.
  started_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

alter table public.activity_unread_starts enable row level security;

-- 3. ------------------------------------------------------------------------

alter table public.tasks
  add column if not exists sent_back_at timestamptz;

-- 4. Account deletion purges reads and the start -----------------------------

-- `anonymize_user` is redefined in full from
-- `20261111180000_document_pins_and_stars.sql`; the only changes are the
-- `activity_item_reads` and `activity_unread_starts` deletes. Same signature, so its grants are kept.
-- Those rows' `user_id` cascade never fires, because the `users` row is
-- tombstoned in place, not deleted.
create or replace function anonymize_user(
  p_user_id uuid,
  p_rescan_cards boolean default false
)
returns setof users
language plpgsql
security invoker
-- Pinned explicitly: the PGlite search_path guard (#830) fails this
-- redefinition without it.
set search_path = public, pg_temp
as $$
declare
  v_user users;
  v_was_tombstoned boolean;
begin
  if p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'anonymize_user: refusing to anonymize the system user'
      using errcode = 'invalid_parameter_value';
  end if;

  -- #2878: the link lock of every chapter the member linked in, taken BEFORE
  -- the user row below, in the order the import trigger and the link
  -- functions take them (link lock, then a key-share on `users` through the
  -- sender foreign key). Taken after, the two would deadlock. Holding it, an
  -- import batch whose trigger already attached a row to the member commits
  -- before the scrub reads, and one that has not yet read the link finds it
  -- gone. A link made in a chapter not listed here waits on the user row and
  -- then refuses the tombstone (`link_discord_author`). The one window left,
  -- an import in such a chapter attaching a row between that link committing
  -- and this scrub, is closed by the deletion flow's second, converging call
  -- (`AccountDeletionService`, `p_rescan_cards`), which runs this scrub again.
  perform pg_advisory_xact_lock(discord_author_link_lock_key(l.chapter_id))
     from (
       select distinct chapter_id from discord_author_links
        where user_id = p_user_id
        order by chapter_id
     ) l;

  select * into v_user from users where id = p_user_id for update;
  if not found then
    return; -- unknown user: empty result, the API maps this to 404
  end if;

  v_was_tombstoned := v_user.deleted_at is not null;

  update users
     set email = 'deleted+' || p_user_id::text || '@anonymized.invalid',
         display_name = 'Deleted User',
         avatar_url = null,
         bio = null,
         graduation_year = null,
         current_city = null,
         current_company = null,
         major = null,
         active_chapter_id = null,
         deleted_at = coalesce(v_user.deleted_at, now())
   where id = p_user_id
   returning * into v_user;

  delete from members where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
  delete from push_tokens where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from notification_preferences where user_id = p_user_id;
  delete from chat_notification_preferences where user_id = p_user_id;
  delete from channel_read_receipts where user_id = p_user_id;
  delete from chat_message_bookmarks where user_id = p_user_id;
  delete from chat_member_blocks where blocker_user_id = p_user_id;
  delete from chat_sidebar_preferences where user_id = p_user_id;
  delete from chat_sidebar_pins where user_id = p_user_id;
  -- Message threads (#3785): which threads the member follows or muted, and
  -- how far they read each. Per-user current state, like the sidebar rows.
  delete from chat_thread_follows where user_id = p_user_id;
  -- Activity links (#3897): the member's own Done and Hide states.
  delete from chat_link_member_states where user_id = p_user_id;
  -- Documents (#3934): the member's own starred folders and files.
  delete from chapter_document_stars where user_id = p_user_id;
  -- Activity unread dots (#4173): which Activity items the member opened.
  delete from activity_item_reads where user_id = p_user_id;
  delete from activity_unread_starts where user_id = p_user_id;
  delete from rush_candidate_votes where voter_id = p_user_id;
  delete from study_sessions where user_id = p_user_id;

  -- #2878: the Discord identity on imported rows attributed to this member.
  -- Unconditional (not under the rescan gate below): it is idempotent, and a
  -- retry after a link made before this migration must still reach it.

  -- Reports on those rows keep the reported words (data-retention.md), but
  -- not the Discord name: the officer queue falls back to it when the sender
  -- is off the roster, and a deleted member always is.
  update chat_message_reports r
     set reported_author_name = null
   where r.reported_author_name is not null
     and (r.reported_sender_id = p_user_id
       or exists (
         select 1 from chat_messages m
          where m.id = r.message_id
            and m.kind = 'imported'
            and m.sender_id = p_user_id
       ));

  update chat_messages
     set author_name = null,
         author_avatar_path = null,
         author_external_id = null,
         payload = case
           when payload ? 'author_username' then payload - 'author_username'
           else payload
         end
   where kind = 'imported'
     and sender_id = p_user_id
     and (author_name is not null
       or author_avatar_path is not null
       or author_external_id is not null
       or payload ? 'author_username');
  delete from discord_author_links where user_id = p_user_id;

  if not v_was_tombstoned or p_rescan_cards then
    update chat_messages
       set payload = case
             when payload is null then payload
             else payload
               || case when kind = 'task' and payload->>'assigner_user_id' = p_user_id::text
                       then jsonb_build_object('assigner_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
                       then jsonb_build_object('assignee_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'actor_user_id' = p_user_id::text
                       then jsonb_build_object('actor_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
                       then jsonb_build_object('recipient_name', 'Deleted User')
                       else '{}'::jsonb end
           end,
           content = case
             when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'assignee_name')
             when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'recipient_name')
             when kind = 'event' and sender_id = p_user_id
               then regexp_replace(content, '^(.*?)( scheduled ")', 'Deleted User\2')
             else content
           end
     where (kind = 'task' and (payload->>'assigner_user_id' = p_user_id::text
                            or payload->>'assignee_user_id' = p_user_id::text))
        or (kind = 'points' and (payload->>'actor_user_id' = p_user_id::text
                              or payload->>'recipient_user_id' = p_user_id::text))
        or (kind = 'event' and sender_id = p_user_id);

    update chat_message_reports r
       set reported_content = m.content
      from chat_messages m
     where r.message_id = m.id
       and ((m.kind = 'task' and (m.payload->>'assigner_user_id' = p_user_id::text
                               or m.payload->>'assignee_user_id' = p_user_id::text))
         or (m.kind = 'points' and (m.payload->>'actor_user_id' = p_user_id::text
                                 or m.payload->>'recipient_user_id' = p_user_id::text))
         or (m.kind = 'event' and m.sender_id = p_user_id));
  end if;

  return next v_user;
end;
$$;
