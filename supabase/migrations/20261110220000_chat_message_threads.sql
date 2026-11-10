-- Message threads: a side conversation off one message (#3785, slice 1).
--
-- spec/behavior/chat/README.md § Reply threads → Message threads owns the
-- rules. A thread reply is an ordinary `chat_messages` row in the parent's
-- channel that carries `thread_root_id`, so access, report, block, retention
-- and edit/delete all inherit, and it rides the channel's existing
-- `chat:channel:<id>` Realtime topic (no new topic, no new presence).
--
-- Additive only:
--
-- 1. `chat_messages.thread_root_id` (nullable, FK to the parent row) and three
--    summary columns on the PARENT: `thread_reply_count`,
--    `thread_last_reply_at`, `thread_recent_sender_ids`. They are
--    denormalised for the same reason `metadata.attachment_count` is: a
--    `postgres_changes` echo cannot carry a join, so the parent's own UPDATE
--    echo is how every open client learns "N replies · last reply 5m ago".
--    A trigger keeps them, so no write path can forget.
-- 2. `chat_thread_follows`: who follows or muted a thread, and how far they
--    have read it. Push and per-thread unread read it.
-- 3. `get_channel_unread_counts` and `get_channel_latest_messages` skip
--    thread replies (a busy thread adds nothing to its channel's badge or
--    preview, 2026-11-07 rule), and a thread reply that @mentions you counts
--    toward the channel's mention tally until you read the thread.
-- 4. `get_followed_thread_unread`: per followed thread in a channel, how many
--    replies are new to the caller.

-- 1. The thread link and the parent's summary ------------------------------

alter table public.chat_messages
  add column if not exists thread_root_id uuid,
  add column if not exists thread_reply_count integer not null default 0,
  add column if not exists thread_last_reply_at timestamptz,
  add column if not exists thread_recent_sender_ids uuid[] not null default '{}';

-- The foreign key is added `not valid` and validated separately, so the
-- validating scan of `chat_messages` holds SHARE UPDATE EXCLUSIVE (reads and
-- writes continue) rather than the ACCESS EXCLUSIVE an inline `references`
-- would hold for the whole scan. Every existing row is null, so it passes.
--
-- `on delete cascade` is deliberate and safe because a hard delete of a
-- timeline message happens only with its channel (which cascades everything
-- anyway) or through the Discord import purge, and `ChatService` refuses an
-- imported row as a thread root, so no member reply ever hangs under a row
-- the purge removes. A soft delete keeps the parent as a tombstone and its
-- replies reachable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_messages_thread_root_fk'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_thread_root_fk
      foreign key (thread_root_id) references public.chat_messages (id)
      on delete cascade
      not valid;
  end if;
end
$$;

alter table public.chat_messages validate constraint chat_messages_thread_root_fk;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_messages_thread_not_self'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_thread_not_self
      check (thread_root_id is null or thread_root_id <> id);
  end if;
end
$$;

-- The thread panel's read: one thread's replies in order.
create index if not exists idx_chat_messages_thread
  on public.chat_messages (thread_root_id, created_at)
  where thread_root_id is not null;

-- The unread RPC's thread-mention probe walks one channel's thread replies
-- only, never the whole channel.
create index if not exists idx_chat_messages_channel_thread_replies
  on public.chat_messages (channel_id, created_at)
  where thread_root_id is not null;

-- Keeps the parent's summary. `security definer` because the inserting role
-- (the API's service role) already bypasses RLS, but an importer or a future
-- caller may not; the update touches only the parent row.
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
         end
   where p.id = new.thread_root_id;
  return null;
end
$$;

drop trigger if exists chat_messages_thread_summary on public.chat_messages;
create trigger chat_messages_thread_summary
  after insert on public.chat_messages
  for each row
  when (new.thread_root_id is not null)
  execute function public.chat_messages_bump_thread_summary();

revoke execute on function public.chat_messages_bump_thread_summary() from public;

-- 2. Follows ---------------------------------------------------------------

create table if not exists public.chat_thread_follows (
  thread_root_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- Denormalised from the root so the per-channel reads are one indexed probe.
  -- Written from the root's own row by the API, never from a client payload.
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  -- `following` pushes replies (within the channel's level). `muted` never
  -- pushes, and nothing turns it back on but the member. `unfollowed` is a
  -- member who unfollowed, or who only read the thread: it keeps the read
  -- cursor, is never pushed, and only the member's own reply re-follows it.
  -- No row at all means the member never touched the thread.
  state text not null default 'following'
    check (state in ('following', 'muted', 'unfollowed')),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (thread_root_id, user_id)
);

create index if not exists idx_chat_thread_follows_user_channel
  on public.chat_thread_follows (user_id, channel_id);

alter table public.chat_thread_follows enable row level security;

-- 3. Unread and previews skip thread replies -------------------------------

-- The 20261106193000 body, with `m.thread_root_id is null` on the channel
-- join, plus thread mentions read against the thread's own cursor.
create or replace function public.get_channel_unread_counts(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (channel_id uuid, unread_count bigint, mention_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    count(m.id) filter (where m.id is not null),
    count(m.id) filter (where p_user_id = any (m.mentions))
      + (
        -- A thread reply that @mentions you counts until you read the thread
        -- or the channel, whichever is later. Reading the channel clears it
        -- too, so a client without thread UI can never strand a badge, and
        -- the channel receipt bounds the scan to recent replies (the partial
        -- index on (channel_id, created_at)). Same skips as the channel join.
        select count(*)
          from chat_messages t
          left join chat_thread_follows f
            on f.thread_root_id = t.thread_root_id
           and f.user_id = p_user_id
         where t.channel_id = c.id
           and t.thread_root_id is not null
           and p_user_id = any (t.mentions)
           and t.is_deleted = false
           and t.kind <> 'imported'
           and t.sender_id is distinct from p_user_id
           and not exists (
             select 1
               from chat_member_blocks b
              where b.chapter_id = p_chapter_id
                and b.blocker_user_id = p_user_id
                and b.blocked_user_id = t.sender_id
           )
           and t.created_at > coalesce(
             greatest(r.last_read_at, f.last_read_at),
             '-infinity'::timestamptz
           )
      )
  from chat_channels c
  left join channel_read_receipts r
    on r.channel_id = c.id
   and r.user_id = p_user_id
  left join chat_messages m
    on m.channel_id = c.id
   -- A thread reply is not unread in its channel (#3785): it lives in the
   -- thread, and a followed thread shows its own count.
   and m.thread_root_id is null
   -- A deleted message is not unread.
   and m.is_deleted = false
   -- An imported archive message is never unread: it is history the chapter is
   -- importing, not a message anyone sent them.
   and m.kind <> 'imported'
   -- Your own messages are never unread to you. `is distinct from` because
   -- sender_id is nullable; a null-sender message is nobody's own.
   and m.sender_id is distinct from p_user_id
   -- A `#chapter-audit` entry is not unread (2026-11-06).
   and not (
     m.kind = 'system_audit'
     and coalesce(m.client_message_id, '') like 'audit:%'
   )
   -- A message from a member you have blocked in this chapter is not unread,
   -- and so not a mention (#2521).
   and not exists (
     select 1
       from chat_member_blocks b
      where b.chapter_id = p_chapter_id
        and b.blocker_user_id = p_user_id
        and b.blocked_user_id = m.sender_id
   )
   and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where c.chapter_id = p_chapter_id
  -- One receipt per (channel, member), so grouping by it changes nothing; it
  -- lets the thread-mention probe read the receipt's cursor.
  group by c.id, r.last_read_at;
$$;

revoke execute on function public.get_channel_unread_counts(uuid, uuid) from public;

-- The 20261106210000 body, with `msg.thread_root_id is null`: Chat home's
-- preview is the channel's timeline, which a thread reply is not part of.
create or replace function public.get_channel_latest_messages(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (
  channel_id       uuid,
  message_id       uuid,
  sender_id        uuid,
  author_name      text,
  content          text,
  kind             text,
  payload          jsonb,
  attachment_count integer,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    m.id,
    m.sender_id,
    m.author_name,
    left(m.content, 500),
    m.kind,
    case when m.kind = 'system_audit' then m.payload end,
    case
      when jsonb_typeof(m.metadata -> 'attachment_count') = 'number'
       and (m.metadata ->> 'attachment_count') ~ '^[0-9]{1,6}$'
      then (m.metadata ->> 'attachment_count')::integer
      else 0
    end,
    m.created_at
  from chat_channels c
  cross join lateral (
    select
      msg.id,
      msg.sender_id,
      msg.author_name,
      msg.content,
      msg.kind,
      msg.payload,
      msg.metadata,
      msg.created_at
    from chat_messages msg
    where msg.channel_id = c.id
      and msg.thread_root_id is null
      and msg.is_deleted = false
      and not exists (
        select 1
          from chat_member_blocks b
         where b.chapter_id = p_chapter_id
           and b.blocker_user_id = p_user_id
           and b.blocked_user_id = msg.sender_id
      )
    order by msg.created_at desc, msg.id desc
    limit 1
  ) m
  where c.chapter_id = p_chapter_id;
$$;

revoke execute on function public.get_channel_latest_messages(uuid, uuid) from public;

-- 4. Per-thread unread for the caller's followed threads in one channel ------

-- The API authorizes the channel before calling this. Followed and muted
-- threads only (an `unfollowed` row is a cursor, not a follow). A muted
-- thread's count is zero: it asks for nothing.
create or replace function public.get_followed_thread_unread(
  p_channel_id uuid,
  p_user_id    uuid
)
returns table (
  thread_root_id uuid,
  state          text,
  last_read_at   timestamptz,
  unread_count   bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    f.thread_root_id,
    f.state,
    f.last_read_at,
    case when f.state <> 'following' then 0 else (
      select count(*)
        from chat_messages t
       where t.thread_root_id = f.thread_root_id
         and t.is_deleted = false
         and t.kind <> 'imported'
         and t.sender_id is distinct from p_user_id
         and not exists (
           select 1
             from chat_member_blocks b
            where b.chapter_id = (
                    select ch.chapter_id from chat_channels ch where ch.id = p_channel_id
                  )
              and b.blocker_user_id = p_user_id
              and b.blocked_user_id = t.sender_id
         )
         and t.created_at > coalesce(f.last_read_at, '-infinity'::timestamptz)
    ) end
  from chat_thread_follows f
  where f.channel_id = p_channel_id
    and f.user_id = p_user_id
    and f.state in ('following', 'muted');
$$;

revoke execute on function public.get_followed_thread_unread(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from anon;
    revoke execute on function public.get_channel_latest_messages(uuid, uuid) from anon;
    revoke execute on function public.get_followed_thread_unread(uuid, uuid) from anon;
    revoke execute on function public.chat_messages_bump_thread_summary() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from authenticated;
    revoke execute on function public.get_channel_latest_messages(uuid, uuid) from authenticated;
    revoke execute on function public.get_followed_thread_unread(uuid, uuid) from authenticated;
    revoke execute on function public.chat_messages_bump_thread_summary() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_channel_unread_counts(uuid, uuid) to service_role;
    grant execute on function public.get_channel_latest_messages(uuid, uuid) to service_role;
    grant execute on function public.get_followed_thread_unread(uuid, uuid) to service_role;
  end if;
end
$$;

-- 5. Account deletion purges follows ------------------------------------------

-- `anonymize_user` is redefined in full from `20261106200000_users_major.sql`;
-- the changes are the `chat_thread_follows` delete and an explicit
-- `search_path` pin. Same signature, so its grants are kept.
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
