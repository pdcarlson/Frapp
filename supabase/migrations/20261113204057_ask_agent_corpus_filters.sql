-- Ask's agent tools search the corpus narrowed (#4900, epic #4898): only
-- messages, only one channel, only passages holding one member's words, only
-- a stretch of dates. `match_corpus_chunks` took the question and nothing
-- else, so a narrowed search could only filter the 40 nearest passages of
-- the whole chapter after the fact, and on a chapter with thousands of
-- passages the ones asked for were rarely among them.
--
-- The five new arguments all default to null, which is the search as it
-- was: the API that is deployed today calls with the first six by name and
-- gets the same rows. Each one can only remove passages. None of them is an
-- access rule: the chapter, the membership check and the caller's own
-- per-source checks (`CorpusRetrievalService`) are unchanged.
--
--   p_source_types  only these source types
--   p_channel_ids   a chat passage must sit in one of these channels (other
--                   source types are not narrowed by it)
--   p_author_id     only passages that hold a message by this member, so
--                   chat only
--   p_since/p_until only passages from this stretch: a chat passage by its
--                   first message, anything else by its source's date
--
-- The argument list changes, so the function is dropped and made again, as
-- 20261112170000 did.

drop function if exists public.match_corpus_chunks(uuid, uuid, text, text, text, integer);

create or replace function public.match_corpus_chunks(
  p_chapter_id uuid,
  p_user_id uuid,
  p_query text,
  p_embedding text,
  p_embedding_model text,
  p_limit integer default 40,
  p_source_types text[] default null,
  p_channel_ids uuid[] default null,
  p_author_id uuid default null,
  p_since timestamptz default null,
  p_until timestamptz default null
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
       and (p_source_types is null or s.source_type = any (p_source_types))
       and (p_channel_ids is null
            or s.source_type <> 'chat_message'
            or exists (select 1
                         from public.corpus_chat_windows w
                        where w.id = s.source_id
                          and w.chapter_id = p_chapter_id
                          and w.channel_id = any (p_channel_ids)))
       and (p_author_id is null or c.author_ids @> array[p_author_id])
       and (p_since is null or coalesce(c.anchor_at, s.source_at) >= p_since)
       and (p_until is null or coalesce(c.anchor_at, s.source_at) < p_until)
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

comment on function public.match_corpus_chunks(uuid, uuid, text, text, text, integer, text[], uuid[], uuid, timestamptz, timestamptz) is
  'AI corpus candidates for one question in one chapter, for a member of that chapter only: nearest passages by embedding and best by words, each with its rank, authors and (for chat) channel. Optionally narrowed by source type, channel, author and date; a null argument narrows nothing. See 20261112165050_ai_corpus.sql, 20261112170000_ai_corpus_chat.sql and 20261113204057_ask_agent_corpus_filters.sql.';

-- One source's passages in the order they sit in it: a document read page by
-- page (#4900). The same guards as the search: one chapter, a member of it,
-- and only a source the index holds at its current revision. A chat window is
-- never read this way, because whose words a chat passage holds is checked
-- passage by passage and this read has no such check. Who may open the source
-- is the caller's check, as it is for the search.
create or replace function public.read_corpus_source_chunks(
  p_chapter_id uuid,
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_offset integer default 0,
  p_limit integer default 5
)
returns table (
  chunk_id uuid,
  chunk_index integer,
  heading text,
  content text,
  page_start integer,
  page_end integer,
  title text,
  source_at timestamptz,
  chunk_count integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
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
  )
  select c.id, c.chunk_index, c.heading, c.content, c.page_start, c.page_end,
         coalesce(s.title, ''), s.source_at, s.chunk_count
    from public.corpus_sources s
    join public.corpus_chunks c on c.corpus_source_id = s.id
   where s.chapter_id = p_chapter_id
     and c.chapter_id = p_chapter_id
     and s.source_type = p_source_type
     and s.source_type <> 'chat_message'
     and s.source_id = p_source_id
     and s.status = 'indexed'
     and s.indexed_revision = s.revision
     and exists (select 1 from allowed)
   order by c.chunk_index
  offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(least(coalesce(p_limit, 5), 20), 0);
$$;

comment on function public.read_corpus_source_chunks(uuid, uuid, text, uuid, integer, integer) is
  'One indexed source''s passages in order, for a member of the chapter: a document or minutes read page by page. Never a chat window. See 20261113204057_ask_agent_corpus_filters.sql.';

-- Service role only, as before.
do $$
declare
  v_role text;
  v_fn text;
  v_fns text[] := array[
    'public.match_corpus_chunks(uuid, uuid, text, text, text, integer, text[], uuid[], uuid, timestamptz, timestamptz)',
    'public.read_corpus_source_chunks(uuid, uuid, text, uuid, integer, integer)'
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
end;
$$;
