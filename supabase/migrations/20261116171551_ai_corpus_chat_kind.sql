-- The chat corpus says what kind each message is (#4915, #5170).
--
-- Paul decided on 2026-11-16 (#4915) that a top-level announcement stays
-- ordinary chat for Frapp AI: indexed in its conversation window, ranked as
-- chat and read only under chat consent. What it lacked was context: the
-- window read returned no kind, so a passage line read "Name: text" and the
-- model could not tell an officer's announcement from banter about it.
--
-- `read_chat_corpus_window` now returns each message's `kind`, which the
-- indexer writes into the line ("Dana, posting an announcement: ..."). The
-- return type changes, so the function is dropped and created again, and
-- its grants are restored as `20261112170000_ai_corpus_chat.sql` set them.
-- `enrol_chat_corpus` is recreated unchanged apart from the comment on its
-- kind filter.

-- 1. Enrolment: unchanged, with the reason for its kind filter -------------

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
     -- Announcements are chat on purpose (Paul, #4915, 2026-11-16): they are
     -- indexed with the conversation around them, under chat consent, and
     -- the passage line names the kind so the model can weigh it. Not a
     -- source type of their own; don't file that again.
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

-- 2. Reading a window, with each message's kind -----------------------------

drop function if exists public.read_chat_corpus_window(uuid, uuid);

-- A window's messages as the indexer reads them, oldest conversation first,
-- each thread's replies after their root. One row with a null message_id when
-- the window holds nothing readable; no row at all when the window is gone,
-- is in another chapter, or its channel is a DM or group DM.
--
-- Read: text, announcements and imported Discord rows that are not deleted
-- and have words. Cards, polls and system rows are not members talking.
create function public.read_chat_corpus_window(
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
  conversation_at timestamptz,
  kind text
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
       -- A thread under a recruitment candidate's card is talk about a
       -- prospect: no rush data reaches a model (spec/behavior/ai.md).
       and t.kind <> 'rush'
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
       -- Announcements are chat on purpose (#4915): see enrol_chat_corpus.
       and m.kind in ('text', 'announcement', 'imported')
       and btrim(m.content) <> ''
  )
  select w.channel_id, w.name, w.day, r.id, r.sender_id,
         coalesce(u.display_name, ''), r.content, r.created_at,
         r.thread_root_id, r.conversation_at, r.kind
    from w
    left join readable r on true
    left join public.users u on u.id = r.sender_id
   order by r.conversation_at nulls first, r.created_at, r.id;
$$;

-- 3. Grants, as 20261112170000 set them: the service role only --------------

do $$
declare
  v_role text;
  v_fn text := 'public.read_chat_corpus_window(uuid, uuid)';
begin
  execute format('revoke execute on function %s from public', v_fn);
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke execute on function %s from %I', v_fn, v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute format('grant execute on function %s to service_role', v_fn);
  end if;
end
$$;
