-- Chat in chapter channels as an AI corpus source (#4314, ADR-28 decision 5,
-- spec/behavior/ai.md § Chat as a source, docs/security/ai-prompt-injection.md C8).
--
-- WHAT THIS ADDS
--
-- 1. A third source type, `chat_message`. Its unit is a conversation window,
--    not a message: one channel's messages on one day, with each thread's
--    replies kept under the message they answer (`corpus_chat_windows`). A
--    passage is a run of messages close in time, so "who has the keys" and
--    "I do" land in the same passage. The day turns at 09:00 UTC (4 or 5 in
--    the morning on the US East Coast, 1 or 2 on the West), so a late-night
--    conversation is one window, not two.
-- 2. Which member wrote what. A passage carries its authors
--    (`corpus_chunks.author_ids`), its first message (`anchor_id`, the link a
--    citation opens) and how many messages it holds. A window carries how
--    many messages were left out because their authors had not said yes, and
--    who they were (`left_out_count`, `left_out_author_ids`). The ids never
--    leave the API: retrieval uses them to drop a passage whose author has
--    since said No, and to put a member's messages back once they say yes.
-- 3. Triggers that follow the chat. A new, edited or deleted message, or a
--    Discord author being linked to a member (which sets `sender_id` on the
--    imported rows), drops its window's passages at once and puts the window
--    back in line to be read again within ten minutes. While a channel is
--    busy the window is read at most every ten minutes, not once per message.
--    The triggers are statement-level, so a Discord import of a hundred
--    thousand rows costs one grouped write, not a hundred thousand.
-- 4. The chapter's "chat as a source" switch decides whether any of it
--    exists. Turning it on enrols every window of the chapter's history;
--    turning it off deletes every chat window and passage of the chapter at
--    once. With the switch off no trigger here writes anything.
-- 5. `requeue_chat_corpus_by_authors`, which the API calls when a member says
--    No (at once) and from an hourly reconcile (sheet changes, deleted
--    accounts, a member who said yes): every window that holds or left out
--    one of those members is read again, rebuilt with or without them.
-- 6. `claim_corpus_sources` hands out documents and minutes before chat, so a
--    chapter's years of imported history never hold back a new document.
-- 7. `match_corpus_chunks` returns the new columns and each chat passage's
--    channel.
--
-- WHAT IS NEVER READ
--
-- Direct messages and group DMs. The triggers, the enrolment and the window
-- read all take only PUBLIC, PRIVATE and ROLE_GATED channels, and the window
-- read (`read_chat_corpus_window`) refuses any other channel, so no caller of
-- it can read a DM whatever it asks for. The audit-log channel is skipped
-- too: it is system text, not members talking.
--
-- WHOSE MESSAGES
--
-- The database does not decide consent. The API reads a window, keeps only
-- messages whose author said yes on the current sheet while the chapter's
-- chat switch is on (`AiConsentService.chatAuthorsWhoSaidYes`), and writes
-- the rest down as left out. An imported message with no linked member has
-- no author to have said yes, so it is always left out.
--
-- RLS on with no policies on the new table, as every chapter-owned table:
-- API only. Every function is service-role only.

-- 1. The window table -------------------------------------------------------

create table if not exists public.corpus_chat_windows (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  constraint corpus_chat_windows_one_per_day unique (channel_id, day)
);

create index if not exists idx_corpus_chat_windows_chapter
  on public.corpus_chat_windows (chapter_id);

alter table public.corpus_chat_windows enable row level security;

comment on table public.corpus_chat_windows is
  'One conversation window of a chapter channel (a channel and a day, thread replies under their root): the unit the AI corpus indexes chat by. Exists only while the chapter''s chat-as-a-source switch is on. See 20261112170000_ai_corpus_chat.sql.';

-- The day a message's conversation belongs to: the day turns at 09:00 UTC.
create or replace function public.corpus_chat_day(p_at timestamptz)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select ((p_at at time zone 'UTC') - interval '9 hours')::date;
$$;

-- 2. Wider sources and passages ---------------------------------------------

alter table public.corpus_sources
  drop constraint if exists corpus_sources_type_allowed;
alter table public.corpus_sources
  add constraint corpus_sources_type_allowed
  check (source_type in ('chapter_document', 'meeting_minutes', 'chat_message'));

alter table public.corpus_sources
  add column if not exists left_out_count integer not null default 0,
  add column if not exists left_out_author_ids uuid[];

alter table public.corpus_sources
  drop constraint if exists corpus_sources_left_out;
alter table public.corpus_sources
  add constraint corpus_sources_left_out check (left_out_count >= 0);

alter table public.corpus_chunks
  add column if not exists author_ids uuid[],
  add column if not exists anchor_id uuid,
  add column if not exists anchor_at timestamptz,
  add column if not exists message_count integer;

-- "Every window that holds this member" for a No, without a scan.
create index if not exists idx_corpus_chunks_authors
  on public.corpus_chunks using gin (author_ids)
  where author_ids is not null;
create index if not exists idx_corpus_sources_left_out_authors
  on public.corpus_sources using gin (left_out_author_ids)
  where left_out_author_ids is not null;

-- When a window goes (its channel was deleted, or the switch turned off), its
-- source and, by the foreign key, its passages go with it.
create or replace function public.corpus_drop_chat_windows()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.corpus_sources s
   using old_windows o
   where s.source_type = 'chat_message'
     and s.chapter_id = o.chapter_id
     and s.source_id = o.id;
  return null;
end;
$$;

drop trigger if exists trg_corpus_chat_windows_drop on public.corpus_chat_windows;
create trigger trg_corpus_chat_windows_drop
  after delete on public.corpus_chat_windows
  referencing old table as old_windows
  for each statement execute function public.corpus_drop_chat_windows();

-- 3. Following the chat ------------------------------------------------------

-- Marks the windows of the given messages changed: their passages go now and
-- each window waits to be read again. Parallel arrays, one entry per message:
-- its channel, the time its conversation started (its thread root's time for
-- a reply) and its author. `p_create` makes a window that does not exist yet
-- (a new message); a delete only touches windows that exist.
--
-- Throttled: a window that is already waiting keeps its turn (or moves it
-- nearer), and one that was indexed waits ten minutes, so a busy channel is
-- read at most every ten minutes and a quiet one ten minutes after its last
-- message.
create or replace function public.note_chat_corpus_windows(
  p_channel_ids uuid[],
  p_conversation_ats timestamptz[],
  p_sender_ids uuid[],
  p_create boolean
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  with changed as (
    select c.channel_id, c.at, c.sender_id
      from unnest(p_channel_ids, p_conversation_ats, p_sender_ids)
           as c(channel_id, at, sender_id)
  ),
  eligible as (
    select ch.chapter_id, ch.id as channel_id,
           public.corpus_chat_day(c.at) as day,
           (array_agg(c.sender_id) filter (where c.sender_id is not null))[1]
             as changed_by
      from changed c
      join public.chat_channels ch on ch.id = c.channel_id
      join public.chapter_ai_settings st
        on st.chapter_id = ch.chapter_id and st.chat_source_enabled
     where ch.type in ('PUBLIC', 'PRIVATE', 'ROLE_GATED')
       and not ch.is_audit_log
       and c.at is not null
     group by ch.chapter_id, ch.id, public.corpus_chat_day(c.at)
  ),
  created as (
    insert into public.corpus_chat_windows (chapter_id, channel_id, day)
    select e.chapter_id, e.channel_id, e.day
      from eligible e
     where p_create
    on conflict (channel_id, day) do nothing
    returning id, channel_id, day
  ),
  touched as (
    select e.chapter_id, coalesce(w.id, n.id) as window_id, e.changed_by
      from eligible e
      left join public.corpus_chat_windows w
        on w.channel_id = e.channel_id and w.day = e.day
      left join created n
        on n.channel_id = e.channel_id and n.day = e.day
     where coalesce(w.id, n.id) is not null
  ),
  noted as (
    insert into public.corpus_sources as s
      (chapter_id, source_type, source_id, changed_by, decays, next_attempt_at)
    select t.chapter_id, 'chat_message', t.window_id, t.changed_by, true,
           now() + interval '10 minutes'
      from touched t
    on conflict (chapter_id, source_type, source_id) do update
      set revision = s.revision + 1,
          status = 'pending',
          skip_reason = null,
          attempts = 0,
          chunk_count = 0,
          next_attempt_at = case
            when s.status = 'pending'
              then least(s.next_attempt_at, now() + interval '10 minutes')
            else now() + interval '10 minutes'
          end,
          changed_by = coalesce(excluded.changed_by, s.changed_by)
    returning s.id
  )
  -- What was indexed describes the window as it was. It goes now, in the
  -- same transaction as the change.
  delete from public.corpus_chunks c
   using noted
   where c.corpus_source_id = noted.id;
end;
$$;

create or replace function public.corpus_follow_chat_messages()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_channels uuid[];
  v_ats timestamptz[];
  v_senders uuid[];
begin
  -- Skip the work entirely while no chapter has chat as a source.
  if not exists (
    select 1 from public.chapter_ai_settings where chat_source_enabled
  ) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select array_agg(m.channel_id),
           array_agg(coalesce(r.created_at, m.created_at)),
           array_agg(m.sender_id)
      into v_channels, v_ats, v_senders
      from new_messages m
      left join public.chat_messages r on r.id = m.thread_root_id;
    if v_channels is not null then
      perform public.note_chat_corpus_windows(v_channels, v_ats, v_senders, true);
    end if;
  elsif tg_op = 'UPDATE' then
    -- Only what changes the text a window is made of: an edit, a delete, the
    -- author (linking a Discord account), the kind, or the thread. Pins,
    -- flags and a parent's reply count leave the index alone.
    select array_agg(n.channel_id),
           array_agg(coalesce(r.created_at, n.created_at)),
           array_agg(n.sender_id)
      into v_channels, v_ats, v_senders
      from new_messages n
      join old_messages o on o.id = n.id
      left join public.chat_messages r on r.id = n.thread_root_id
     where n.content is distinct from o.content
        or n.is_deleted is distinct from o.is_deleted
        or n.sender_id is distinct from o.sender_id
        or n.kind is distinct from o.kind
        or n.thread_root_id is distinct from o.thread_root_id
        or n.channel_id is distinct from o.channel_id
        or n.created_at is distinct from o.created_at;
    if v_channels is not null then
      perform public.note_chat_corpus_windows(v_channels, v_ats, v_senders, true);
    end if;
    -- A message moved to another channel, thread or day also leaves the
    -- window it was in: that window is rebuilt without it.
    select array_agg(o.channel_id),
           array_agg(coalesce(r.created_at, o.created_at)),
           array_agg(o.sender_id)
      into v_channels, v_ats, v_senders
      from old_messages o
      join new_messages n on n.id = o.id
      left join public.chat_messages r on r.id = o.thread_root_id
     where n.thread_root_id is distinct from o.thread_root_id
        or n.channel_id is distinct from o.channel_id
        or n.created_at is distinct from o.created_at;
    if v_channels is not null then
      perform public.note_chat_corpus_windows(v_channels, v_ats, v_senders, false);
    end if;
  else
    select array_agg(o.channel_id),
           array_agg(coalesce(r.created_at, o.created_at)),
           array_agg(o.sender_id)
      into v_channels, v_ats, v_senders
      from old_messages o
      left join public.chat_messages r on r.id = o.thread_root_id;
    if v_channels is not null then
      perform public.note_chat_corpus_windows(v_channels, v_ats, v_senders, false);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_chat_messages_corpus_insert on public.chat_messages;
create trigger trg_chat_messages_corpus_insert
  after insert on public.chat_messages
  referencing new table as new_messages
  for each statement execute function public.corpus_follow_chat_messages();

drop trigger if exists trg_chat_messages_corpus_update on public.chat_messages;
create trigger trg_chat_messages_corpus_update
  after update on public.chat_messages
  referencing old table as old_messages new table as new_messages
  for each statement execute function public.corpus_follow_chat_messages();

drop trigger if exists trg_chat_messages_corpus_delete on public.chat_messages;
create trigger trg_chat_messages_corpus_delete
  after delete on public.chat_messages
  referencing old table as old_messages
  for each statement execute function public.corpus_follow_chat_messages();

-- 4. The chapter's switch ----------------------------------------------------

-- Every window of the chapter's history waits to be read: one per channel
-- and day that holds a message, thread replies counted on their root's day.
-- Idempotent.
create or replace function public.enrol_chat_corpus(p_chapter_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.corpus_chat_windows (chapter_id, channel_id, day)
  select distinct ch.chapter_id, ch.id,
         public.corpus_chat_day(coalesce(r.created_at, m.created_at))
    from public.chat_channels ch
    join public.chat_messages m on m.channel_id = ch.id
    left join public.chat_messages r on r.id = m.thread_root_id
   where ch.chapter_id = p_chapter_id
     and ch.type in ('PUBLIC', 'PRIVATE', 'ROLE_GATED')
     and not ch.is_audit_log
     and not m.is_deleted
     and m.kind in ('text', 'announcement', 'imported')
     and btrim(m.content) <> ''
  on conflict (channel_id, day) do nothing;

  insert into public.corpus_sources (chapter_id, source_type, source_id, decays)
  select w.chapter_id, 'chat_message', w.id, true
    from public.corpus_chat_windows w
   where w.chapter_id = p_chapter_id
  on conflict (chapter_id, source_type, source_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.corpus_follow_chat_switch()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.chat_source_enabled
     and (tg_op = 'INSERT' or not coalesce(old.chat_source_enabled, false)) then
    perform public.enrol_chat_corpus(new.chapter_id);
  elsif not new.chat_source_enabled
     and tg_op = 'UPDATE' and old.chat_source_enabled then
    -- Off means no member's messages are read: the windows go, and with them
    -- (by the trigger above) every chat source and passage of the chapter.
    delete from public.corpus_chat_windows where chapter_id = new.chapter_id;
    delete from public.corpus_sources
     where chapter_id = new.chapter_id and source_type = 'chat_message';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chapter_ai_settings_chat_corpus on public.chapter_ai_settings;
create trigger trg_chapter_ai_settings_chat_corpus
  after insert or update of chat_source_enabled on public.chapter_ai_settings
  for each row execute function public.corpus_follow_chat_switch();

-- 5. Changes of mind ---------------------------------------------------------

-- Every chat window that holds a passage by one of p_user_ids, or left one of
-- them out, is read again from scratch: its passages go now, in this
-- transaction, and the indexer rebuilds it with or without them. Within one
-- chapter, or every chapter when p_chapter_id is null (a member's answer is
-- theirs everywhere). Returns how many windows.
create or replace function public.requeue_chat_corpus_by_authors(
  p_user_ids uuid[],
  p_chapter_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if coalesce(cardinality(p_user_ids), 0) = 0 then
    return 0;
  end if;

  select array_agg(distinct id) into v_ids
    from (
      select c.corpus_source_id as id
        from public.corpus_chunks c
       where c.author_ids && p_user_ids
         and (p_chapter_id is null or c.chapter_id = p_chapter_id)
      union
      select s.id
        from public.corpus_sources s
       where s.left_out_author_ids && p_user_ids
         and (p_chapter_id is null or s.chapter_id = p_chapter_id)
      union
      -- A window waiting for, or in the middle of, an index run holds no
      -- passage yet, but a run may already have read the member's words
      -- under their old answer. Its revision goes up, so that run's write
      -- fails its revision check and nothing it embedded is kept.
      select s.id
        from public.corpus_sources s
        join public.corpus_chat_windows w on w.id = s.source_id
       where s.source_type = 'chat_message'
         and s.indexed_revision < s.revision
         and (p_chapter_id is null or s.chapter_id = p_chapter_id)
         and exists (
           select 1
             from public.chat_messages m
             left join public.chat_messages r on r.id = m.thread_root_id
            where m.channel_id = w.channel_id
              and m.sender_id = any (p_user_ids)
              and public.corpus_chat_day(coalesce(r.created_at, m.created_at)) = w.day
         )
    ) hit;
  if v_ids is null then
    return 0;
  end if;

  delete from public.corpus_chunks where corpus_source_id = any (v_ids);
  update public.corpus_sources
     set revision = revision + 1,
         status = 'pending',
         skip_reason = null,
         attempts = 0,
         chunk_count = 0,
         next_attempt_at = now()
   where id = any (v_ids)
     and source_type = 'chat_message';
  return cardinality(v_ids);
end;
$$;

-- The chapters that hold chat windows, for the hourly reconcile.
create or replace function public.chat_corpus_chapters()
returns setof uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select distinct chapter_id from public.corpus_chat_windows;
$$;

-- Every member the chapter's chat index holds a passage by (`indexed`), and
-- every member it left out (`not indexed`). The reconcile compares both with
-- who says yes now.
create or replace function public.chat_corpus_authors(p_chapter_id uuid)
returns table (user_id uuid, indexed boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select distinct a.user_id, true
    from public.corpus_chunks c
    cross join lateral unnest(c.author_ids) as a(user_id)
   where c.chapter_id = p_chapter_id
     and c.author_ids is not null
  union
  select distinct a.user_id, false
    from public.corpus_sources s
    cross join lateral unnest(s.left_out_author_ids) as a(user_id)
   where s.chapter_id = p_chapter_id
     and s.source_type = 'chat_message'
     and s.left_out_author_ids is not null;
$$;

-- 6. Reading a window --------------------------------------------------------

-- A window's messages as the indexer reads them, oldest conversation first,
-- each thread's replies after their root. One row with a null message_id when
-- the window holds nothing readable; no row at all when the window is gone,
-- is in another chapter, or its channel is a DM or group DM.
--
-- Read: text, announcements and imported Discord rows that are not deleted
-- and have words. Cards, polls and system rows are not members talking.
create or replace function public.read_chat_corpus_window(
  p_chapter_id uuid,
  p_window_id uuid
)
returns table (
  channel_id uuid,
  channel_name text,
  day date,
  message_id uuid,
  sender_id uuid,
  sender_name text,
  content text,
  created_at timestamptz,
  thread_root_id uuid,
  conversation_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with w as (
    select cw.id, cw.channel_id, cw.day, ch.name
      from public.corpus_chat_windows cw
      join public.chat_channels ch on ch.id = cw.channel_id
     where cw.id = p_window_id
       and cw.chapter_id = p_chapter_id
       and ch.chapter_id = p_chapter_id
       and ch.type in ('PUBLIC', 'PRIVATE', 'ROLE_GATED')
       and not ch.is_audit_log
  ),
  timeline as (
    select m.*
      from w
      join public.chat_messages m on m.channel_id = w.channel_id
     where m.thread_root_id is null
       and m.created_at >= (w.day::timestamp + interval '9 hours') at time zone 'UTC'
       and m.created_at < (w.day::timestamp + interval '33 hours') at time zone 'UTC'
  ),
  replies as (
    select r.*, t.created_at as root_at
      from timeline t
      join public.chat_messages r on r.thread_root_id = t.id
     where r.channel_id = t.channel_id
  ),
  msgs as (
    select t.id, t.sender_id, t.content, t.created_at, t.thread_root_id,
           t.created_at as conversation_at, t.is_deleted, t.kind
      from timeline t
    union all
    select r.id, r.sender_id, r.content, r.created_at, r.thread_root_id,
           r.root_at, r.is_deleted, r.kind
      from replies r
  ),
  readable as (
    select m.*
      from msgs m
     where not m.is_deleted
       and m.kind in ('text', 'announcement', 'imported')
       and btrim(m.content) <> ''
  )
  select w.channel_id, w.name, w.day, r.id, r.sender_id,
         coalesce(u.display_name, ''), r.content, r.created_at,
         r.thread_root_id, r.conversation_at
    from w
    left join readable r on true
    left join public.users u on u.id = r.sender_id
   order by r.conversation_at nulls first, r.created_at, r.id;
$$;

-- The channel of each window, for the asker's channel check at retrieval.
-- Windows of another chapter, or of a DM, are not returned.
create or replace function public.chat_corpus_window_channels(
  p_chapter_id uuid,
  p_window_ids uuid[]
)
returns table (window_id uuid, channel_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select cw.id, cw.channel_id
    from public.corpus_chat_windows cw
    join public.chat_channels ch on ch.id = cw.channel_id
   where cw.id = any (p_window_ids)
     and cw.chapter_id = p_chapter_id
     and ch.chapter_id = p_chapter_id
     and ch.type in ('PUBLIC', 'PRIVATE', 'ROLE_GATED');
$$;

-- 7. Indexing, redefined for the new columns ----------------------------------

-- Documents and minutes before chat, then the longest waiting; then, with
-- what room is left, sources made by another model or pipeline. Two passes,
-- each on its own partial index: chat adds a row per channel per day of
-- history, so one filter over every source (as in 20261112165050) would scan
-- the whole index every minute once it is large.
create index if not exists idx_corpus_sources_due_official_first
  on public.corpus_sources ((source_type = 'chat_message'), next_attempt_at)
  where status = 'pending';

create index if not exists idx_corpus_sources_fingerprint
  on public.corpus_sources (index_fingerprint)
  where status <> 'pending';

create or replace function public.claim_corpus_sources(
  p_fingerprint text,
  p_now timestamptz,
  p_limit integer
)
returns setof public.corpus_sources
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claimed integer;
begin
  return query
  with due as (
    select s.id
      from public.corpus_sources s
     where s.status = 'pending'
       and s.next_attempt_at <= p_now
     order by (s.source_type = 'chat_message'), s.next_attempt_at
     limit greatest(p_limit, 0)
       for update skip locked
  )
  update public.corpus_sources s
     set attempts = s.attempts + 1,
         next_attempt_at = p_now + least(
           interval '10 minutes' * power(2, least(s.attempts, 10)),
           interval '1 day')
    from due
   where s.id = due.id
  returning s.*;
  get diagnostics v_claimed = row_count;

  if v_claimed < p_limit then
    return query
    with stale as (
      select s.id
        from public.corpus_sources s
       where s.status <> 'pending'
         and (s.index_fingerprint < p_fingerprint
              or s.index_fingerprint > p_fingerprint
              or s.index_fingerprint is null)
         and s.next_attempt_at <= p_now
       order by (s.source_type = 'chat_message'), s.next_attempt_at
       limit p_limit - v_claimed
         for update skip locked
    )
    update public.corpus_sources s
       set attempts = s.attempts + 1,
           next_attempt_at = p_now + least(
             interval '10 minutes' * power(2, least(s.attempts, 10)),
             interval '1 day')
      from stale
     where s.id = stale.id
    returning s.*;
  end if;
end;
$$;

-- As in 20261112165050, and writes a chat passage's authors, first message
-- and message count (null on documents and minutes).
create or replace function public.write_corpus_chunks(
  p_source_id uuid,
  p_revision bigint,
  p_first boolean,
  p_embedding_model text,
  p_chunks jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_source public.corpus_sources%rowtype;
begin
  select * into v_source
    from public.corpus_sources
   where id = p_source_id
     for update;
  if not found or v_source.revision <> p_revision then
    return false;
  end if;

  if p_first then
    delete from public.corpus_chunks where corpus_source_id = p_source_id;
    update public.corpus_sources
       set status = 'pending',
           skip_reason = null,
           indexed_revision = 0,
           chunk_count = 0
     where id = p_source_id;
  end if;

  insert into public.corpus_chunks
    (chapter_id, corpus_source_id, chunk_index, heading, content,
     page_start, page_end, embedding_model, embedding,
     author_ids, anchor_id, anchor_at, message_count)
  select v_source.chapter_id, p_source_id, c.chunk_index, c.heading, c.content,
         c.page_start, c.page_end, p_embedding_model,
         c.embedding::extensions.vector(1536),
         case when c.author_ids is null then null
              else array(select jsonb_array_elements_text(c.author_ids)::uuid)
         end,
         c.anchor_id, c.anchor_at, c.message_count
    from jsonb_to_recordset(p_chunks) as c(
      chunk_index integer, heading text, content text,
      page_start integer, page_end integer, embedding text,
      author_ids jsonb, anchor_id uuid, anchor_at timestamptz,
      message_count integer)
  on conflict (corpus_source_id, chunk_index) do update
    set heading = excluded.heading,
        content = excluded.content,
        page_start = excluded.page_start,
        page_end = excluded.page_end,
        embedding_model = excluded.embedding_model,
        embedding = excluded.embedding,
        author_ids = excluded.author_ids,
        anchor_id = excluded.anchor_id,
        anchor_at = excluded.anchor_at,
        message_count = excluded.message_count;
  return true;
end;
$$;

-- As in 20261112165050, plus what was left out of the source and whose.
-- Recorded on a skipped window too, so a member who later says yes brings it
-- back.
drop function if exists public.finish_corpus_source(
  uuid, bigint, text, text, timestamptz, boolean, integer, text);

create or replace function public.finish_corpus_source(
  p_source_id uuid,
  p_revision bigint,
  p_fingerprint text,
  p_title text,
  p_source_at timestamptz,
  p_decays boolean,
  p_chunk_count integer,
  p_skip_reason text,
  p_left_out_count integer default 0,
  p_left_out_author_ids uuid[] default null
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
  v_count integer := case when p_skip_reason is null then greatest(p_chunk_count, 0) else 0 end;
begin
  select revision into v_revision
    from public.corpus_sources
   where id = p_source_id
     for update;
  if not found or v_revision <> p_revision then
    return false;
  end if;

  delete from public.corpus_chunks
   where corpus_source_id = p_source_id
     and chunk_index >= v_count;

  update public.corpus_sources
     set status = case when p_skip_reason is null then 'indexed' else 'skipped' end,
         skip_reason = p_skip_reason,
         indexed_revision = p_revision,
         index_fingerprint = p_fingerprint,
         title = p_title,
         source_at = p_source_at,
         decays = coalesce(p_decays, false),
         chunk_count = v_count,
         attempts = 0,
         indexed_at = now(),
         left_out_count = greatest(coalesce(p_left_out_count, 0), 0),
         left_out_author_ids = case
           when coalesce(cardinality(p_left_out_author_ids), 0) = 0 then null
           else p_left_out_author_ids
         end
   where id = p_source_id;
  return true;
end;
$$;

-- 8. Retrieval, redefined for the new columns --------------------------------

drop function if exists public.match_corpus_chunks(uuid, uuid, text, text, text, integer);

-- As in 20261112165050, and returns each passage's authors, first message,
-- message count, its source's left-out count and, for chat, its channel.
create or replace function public.match_corpus_chunks(
  p_chapter_id uuid,
  p_user_id uuid,
  p_query text,
  p_embedding text,
  p_embedding_model text,
  p_limit integer default 40
)
returns table (
  chunk_id uuid,
  corpus_source_id uuid,
  source_type text,
  source_id uuid,
  title text,
  heading text,
  content text,
  page_start integer,
  page_end integer,
  source_at timestamptz,
  decays boolean,
  dense_rank integer,
  sparse_rank integer,
  distance double precision,
  author_ids uuid[],
  anchor_id uuid,
  anchor_at timestamptz,
  message_count integer,
  left_out_count integer,
  channel_id uuid
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with allowed as (
    select 1
      from public.members m
     where m.chapter_id = p_chapter_id
       and m.user_id = p_user_id
       and (auth.uid() is null
            or exists (select 1 from public.users u
                        where u.id = p_user_id
                          and u.supabase_auth_id = auth.uid()))
  ),
  scoped as not materialized (
    select c.id, c.corpus_source_id, c.heading, c.content, c.page_start,
           c.page_end, c.embedding, c.embedding_model, c.content_search,
           c.author_ids, c.anchor_id, c.anchor_at, c.message_count,
           s.source_type, s.source_id, s.title, s.source_at, s.decays,
           s.left_out_count
      from public.corpus_chunks c
      join public.corpus_sources s on s.id = c.corpus_source_id
     where c.chapter_id = p_chapter_id
       and s.chapter_id = p_chapter_id
       and s.status = 'indexed'
       and s.indexed_revision = s.revision
       and exists (select 1 from allowed)
  ),
  dense as (
    select d.id, d.dist,
           (row_number() over (order by d.dist, d.id))::integer as rn
      from (
        select sc.id,
               (sc.embedding <=> p_embedding::extensions.vector(1536))::double precision as dist
          from scoped sc
         where sc.embedding_model = p_embedding_model
         order by sc.embedding <=> p_embedding::extensions.vector(1536), sc.id
         limit greatest(least(p_limit, 200), 0)
      ) d
  ),
  words as (
    select nullif(replace(plainto_tsquery('english'::regconfig, coalesce(p_query, ''))::text, '&', '|'), '')::tsquery as q
  ),
  sparse as (
    select t.id,
           (row_number() over (order by t.score desc, t.id))::integer as rn
      from (
        select sc.id, ts_rank_cd(sc.content_search, w.q, 32) as score
          from scoped sc, words w
         where w.q is not null
           and sc.content_search @@ w.q
         order by score desc, sc.id
         limit greatest(least(p_limit, 200), 0)
      ) t
  )
  select sc.id, sc.corpus_source_id, sc.source_type, sc.source_id,
         coalesce(sc.title, ''), sc.heading, sc.content, sc.page_start,
         sc.page_end, sc.source_at, sc.decays, d.rn, sp.rn, d.dist,
         sc.author_ids, sc.anchor_id, sc.anchor_at, sc.message_count,
         sc.left_out_count, cw.channel_id
    from scoped sc
    left join dense d on d.id = sc.id
    left join sparse sp on sp.id = sc.id
    left join public.corpus_chat_windows cw
      on sc.source_type = 'chat_message'
     and cw.id = sc.source_id
     and cw.chapter_id = p_chapter_id
   where d.id is not null or sp.id is not null;
$$;

comment on function public.match_corpus_chunks(uuid, uuid, text, text, text, integer) is
  'AI corpus candidates for one question in one chapter, for a member of that chapter only: nearest passages by embedding and best by words, each with its rank, authors and (for chat) channel. See 20261112165050_ai_corpus.sql and 20261112170000_ai_corpus_chat.sql.';

-- 9. Grants: service role only ----------------------------------------------

do $$
declare
  v_role text;
  v_fn text;
  v_fns text[] := array[
    'public.corpus_chat_day(timestamptz)',
    'public.corpus_drop_chat_windows()',
    'public.note_chat_corpus_windows(uuid[], timestamptz[], uuid[], boolean)',
    'public.corpus_follow_chat_messages()',
    'public.enrol_chat_corpus(uuid)',
    'public.corpus_follow_chat_switch()',
    'public.requeue_chat_corpus_by_authors(uuid[], uuid)',
    'public.chat_corpus_chapters()',
    'public.chat_corpus_authors(uuid)',
    'public.read_chat_corpus_window(uuid, uuid)',
    'public.chat_corpus_window_channels(uuid, uuid[])',
    'public.claim_corpus_sources(text, timestamptz, integer)',
    'public.write_corpus_chunks(uuid, bigint, boolean, text, jsonb)',
    'public.finish_corpus_source(uuid, bigint, text, text, timestamptz, boolean, integer, text, integer, uuid[])',
    'public.match_corpus_chunks(uuid, uuid, text, text, text, integer)'
  ];
begin
  foreach v_fn in array v_fns loop
    execute format('revoke execute on function %s from public', v_fn);
    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke execute on function %s from %I', v_fn, v_role);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end
$$;

-- 10. Chapters that already turned chat on -----------------------------------

-- B2's switches shipped on the same branch, so a chapter may already hold the
-- switch on: enrol its history now, as turning it on would have.
select public.enrol_chat_corpus(chapter_id)
  from public.chapter_ai_settings
 where chat_source_enabled;
