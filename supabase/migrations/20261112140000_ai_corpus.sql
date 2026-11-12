-- The AI corpus: what Ask and the later AI features retrieve from (#720,
-- ADR-28 decision 3, spec/architecture/README.md § 13).
--
-- WHAT THIS ADDS
--
-- 1. `corpus_sources`, one row per thing that can be indexed: a chapter
--    document or a meeting's posted minutes. The row is the index's state for
--    that source. `revision` goes up each time the source changes, and
--    `indexed_revision` is the revision the index last caught up to, so
--    "needs indexing" is a comparison, never a message that can be lost.
--    Triggers on the source tables keep these rows (3), so nothing in the API
--    has to remember to say a source changed.
-- 2. `corpus_chunks`, the index itself: a passage of a source, its embedding
--    (pgvector, 1,536 dimensions, Gemini Embedding per ADR-28) and a
--    generated `tsvector` for exact words. Both halves are read one chapter at
--    a time.
-- 3. Triggers on `chapter_documents` and `meetings`. A new or changed source
--    drops its passages at once and waits to be indexed again; a deleted
--    document, deleted minutes, or minutes that are no longer posted lose
--    their row and, by the foreign key, every passage. Deleting is therefore
--    the database's job and happens in the same transaction as the change.
-- 4. Functions the API calls: `claim_corpus_sources` (which sources to index
--    next), `write_corpus_chunks` and `finish_corpus_source` (write one
--    source's passages, only while the source is still at the revision that
--    was read), and `match_corpus_chunks` (retrieval).
--
-- ISOLATION (ADR-28 "What this record does not decide", settled here)
--
-- `match_corpus_chunks` takes one chapter and the member the retrieval acts
-- for, and returns nothing unless that member belongs to that chapter. The
-- chapter filter is in the function, not left to the caller, and a passage's
-- `chapter_id` cannot differ from its source's (a composite foreign key). The
-- API still calls with the service role: it has no client that carries a
-- member's own token, and a background run has no token at all. So the rule
-- the research asked row-level security to back ("the chapter comes from the
-- member, not from the request") is enforced inside the function for both
-- cases. If the function is ever called with a member's token, it also
-- requires that token to be the acting member's. RLS stays on with no
-- policies, and only the service role may execute the functions.
--
-- INDEX TYPE (also settled here)
--
-- No approximate index (HNSW or IVFFlat) on the embedding. A chapter holds a
-- few thousand passages, and an exact scan of one chapter's rows is a few
-- milliseconds and always correct. An approximate index over every chapter's
-- rows, filtered by chapter afterwards, returns mostly other chapters'
-- neighbours and silently loses recall as chapters are added. HNSW with
-- pgvector's iterative scan is the later, additive step once a single chapter
-- passes about 20,000 passages; it needs no change to the column.
--
-- SOURCES
--
-- `source_type` is a closed list: `chapter_document` and `meeting_minutes`.
-- Channel messages arrive with #4314, which widens the check. Vault, rush and
-- backwork content have no type and so cannot be written.
--
-- A Standards meeting cannot reach this table: `meetings` itself refuses the
-- type (`meetings_type_allowed`).
--
-- EXISTING ROWS
--
-- Every existing document and every posted set of minutes gets a waiting
-- `corpus_sources` row below, so a chapter that turns AI on later is indexed
-- without anyone re-uploading. A waiting row costs nothing and sends nothing:
-- indexing only runs where the server has `AI_ENABLED=true`, a provider is
-- configured and the chapter's own switch is on.
--
-- RLS on with no policies, as every chapter-owned table: API only.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.corpus_sources (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  revision bigint not null default 1,
  indexed_revision bigint not null default 0,
  status text not null default 'pending',
  skip_reason text,
  -- The member whose upload, post or edit last changed the source. Indexing
  -- acts for them while they are still in the chapter.
  changed_by uuid references public.users(id) on delete set null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Model, dimensions and pipeline version the passages were made with. A
  -- row whose fingerprint is not the API's current one is indexed again.
  index_fingerprint text,
  title text,
  source_at timestamptz,
  decays boolean not null default false,
  chunk_count integer not null default 0,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corpus_sources_type_allowed
    check (source_type in ('chapter_document', 'meeting_minutes')),
  constraint corpus_sources_status_allowed
    check (status in ('pending', 'indexed', 'skipped')),
  constraint corpus_sources_skip_reason_allowed
    check (
      (status = 'skipped') = (skip_reason is not null)
      and (skip_reason is null or skip_reason in
        ('unsupported_type', 'too_large', 'no_text', 'unreadable'))
    ),
  constraint corpus_sources_revisions
    check (revision >= 1 and indexed_revision >= 0 and indexed_revision <= revision),
  constraint corpus_sources_one_per_source
    unique (chapter_id, source_type, source_id),
  -- The target of `corpus_chunks`' composite foreign key.
  constraint corpus_sources_id_chapter unique (id, chapter_id)
);

-- What the indexer claims next.
create index if not exists idx_corpus_sources_due
  on public.corpus_sources (next_attempt_at)
  where status = 'pending';

alter table public.corpus_sources enable row level security;

drop trigger if exists trg_corpus_sources_updated_at on public.corpus_sources;
create trigger trg_corpus_sources_updated_at
  before update on public.corpus_sources
  for each row execute function update_updated_at();

comment on table public.corpus_sources is
  'One row per source the AI corpus can index (a chapter document, posted minutes): its revision and how far the index has caught up. Kept by triggers on the source tables. See 20261112140000_ai_corpus.sql.';

create table if not exists public.corpus_chunks (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null,
  corpus_source_id uuid not null,
  chunk_index integer not null,
  heading text,
  content text not null,
  page_start integer,
  page_end integer,
  embedding_model text not null,
  embedding extensions.vector(1536) not null,
  content_search tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(heading, '')), 'B')
    || to_tsvector('english'::regconfig, content)
  ) stored,
  created_at timestamptz not null default now(),
  -- A passage's chapter is its source's chapter, checked by the database.
  constraint corpus_chunks_source_fk
    foreign key (corpus_source_id, chapter_id)
    references public.corpus_sources (id, chapter_id) on delete cascade,
  constraint corpus_chunks_one_per_index unique (corpus_source_id, chunk_index),
  constraint corpus_chunks_content_len
    check (char_length(content) between 1 and 8000),
  constraint corpus_chunks_pages
    check (
      (page_start is null and page_end is null)
      or (page_start >= 1 and page_end >= page_start)
    )
);

-- Both halves of retrieval start from one chapter's rows.
create index if not exists idx_corpus_chunks_chapter
  on public.corpus_chunks (chapter_id);
create index if not exists idx_corpus_chunks_search
  on public.corpus_chunks using gin (content_search);

alter table public.corpus_chunks enable row level security;

comment on table public.corpus_chunks is
  'The AI corpus index: a passage of a source, its 1,536-dimension embedding and a tsvector. Read one chapter at a time through match_corpus_chunks. See 20261112140000_ai_corpus.sql.';

-- ─── Keeping corpus_sources in step with the sources ───────────────────────

create or replace function public.note_corpus_source(
  p_chapter_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_changed_by uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.corpus_sources as s
    (chapter_id, source_type, source_id, changed_by)
  values (p_chapter_id, p_source_type, p_source_id, p_changed_by)
  on conflict (chapter_id, source_type, source_id) do update
    set revision = s.revision + 1,
        status = 'pending',
        skip_reason = null,
        attempts = 0,
        next_attempt_at = now(),
        chunk_count = 0,
        changed_by = coalesce(excluded.changed_by, s.changed_by)
  returning s.id into v_id;

  -- What was indexed describes the source as it was. It goes now, in the
  -- same transaction as the change, and comes back when the source is read
  -- again.
  delete from public.corpus_chunks where corpus_source_id = v_id;
end;
$$;

create or replace function public.drop_corpus_source(
  p_chapter_id uuid,
  p_source_type text,
  p_source_id uuid
)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  delete from public.corpus_sources
   where chapter_id = p_chapter_id
     and source_type = p_source_type
     and source_id = p_source_id;
$$;

create or replace function public.corpus_follow_chapter_document()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.drop_corpus_source(old.chapter_id, 'chapter_document', old.id);
    return old;
  end if;
  if tg_op = 'INSERT'
     or new.title is distinct from old.title
     or new.storage_path is distinct from old.storage_path
     or new.content_type is distinct from old.content_type
     or new.document_type is distinct from old.document_type
     or new.effective_date is distinct from old.effective_date
  then
    perform public.note_corpus_source(
      new.chapter_id, 'chapter_document', new.id, new.uploaded_by);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chapter_documents_corpus on public.chapter_documents;
create trigger trg_chapter_documents_corpus
  after insert or update or delete on public.chapter_documents
  for each row execute function public.corpus_follow_chapter_document();

create or replace function public.corpus_follow_meeting()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.drop_corpus_source(old.chapter_id, 'meeting_minutes', old.id);
    return old;
  end if;
  -- Only posted minutes are indexed. A draft is its author's.
  if new.status <> 'posted' then
    if tg_op = 'UPDATE' and old.status = 'posted' then
      perform public.drop_corpus_source(new.chapter_id, 'meeting_minutes', new.id);
    end if;
    return new;
  end if;
  if tg_op = 'INSERT'
     or old.status <> 'posted'
     or new.content is distinct from old.content
     or new.meeting_type is distinct from old.meeting_type
     or new.other_label is distinct from old.other_label
     or new.event_name is distinct from old.event_name
     or new.event_start_time is distinct from old.event_start_time
  then
    perform public.note_corpus_source(
      new.chapter_id, 'meeting_minutes', new.id,
      coalesce(new.updated_by, new.posted_by, new.created_by));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meetings_corpus on public.meetings;
create trigger trg_meetings_corpus
  after insert or update or delete on public.meetings
  for each row execute function public.corpus_follow_meeting();

-- ─── Indexing ──────────────────────────────────────────────────────────────

-- Hands out up to p_limit sources that need indexing and pushes each one's
-- next attempt out (ten minutes, doubling, a day at most), so a source that
-- keeps failing is retried ever more rarely and two API replicas do not both
-- take the same row. A source needs indexing when it is pending, or when its
-- passages were made with another fingerprint (a model or pipeline change).
create or replace function public.claim_corpus_sources(
  p_fingerprint text,
  p_now timestamptz,
  p_limit integer
)
returns setof public.corpus_sources
language sql
security invoker
set search_path = public, pg_temp
as $$
  with due as (
    select s.id
      from public.corpus_sources s
     where s.next_attempt_at <= p_now
       and (s.status = 'pending'
            or s.index_fingerprint is distinct from p_fingerprint)
     order by s.next_attempt_at
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
$$;

-- Writes one batch of a source's passages, only while the source is still at
-- p_revision. The first batch clears what was there. Returns false, writing
-- nothing, when the source changed or went away in the meantime: the newer
-- revision is indexed by its own run.
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
    -- A source being indexed again at the same revision (a new embedding
    -- model or pipeline) stops being read here, in the same transaction as
    -- its old passages go, and is read again when finish_corpus_source runs.
    -- Otherwise a run that died after its first batch would leave a source
    -- that reads as indexed with a fraction of its passages.
    update public.corpus_sources
       set status = 'pending',
           skip_reason = null,
           indexed_revision = 0,
           chunk_count = 0
     where id = p_source_id;
  end if;

  insert into public.corpus_chunks
    (chapter_id, corpus_source_id, chunk_index, heading, content,
     page_start, page_end, embedding_model, embedding)
  select v_source.chapter_id, p_source_id, c.chunk_index, c.heading, c.content,
         c.page_start, c.page_end, p_embedding_model,
         c.embedding::extensions.vector(1536)
    from jsonb_to_recordset(p_chunks) as c(
      chunk_index integer, heading text, content text,
      page_start integer, page_end integer, embedding text)
  on conflict (corpus_source_id, chunk_index) do update
    set heading = excluded.heading,
        content = excluded.content,
        page_start = excluded.page_start,
        page_end = excluded.page_end,
        embedding_model = excluded.embedding_model,
        embedding = excluded.embedding;
  return true;
end;
$$;

-- Marks a source indexed at p_revision with p_chunk_count passages, or
-- skipped when p_skip_reason is given (its passages then go). Same guard and
-- return as write_corpus_chunks. Retrieval reads a source's passages only
-- once this has run for its current revision.
create or replace function public.finish_corpus_source(
  p_source_id uuid,
  p_revision bigint,
  p_fingerprint text,
  p_title text,
  p_source_at timestamptz,
  p_decays boolean,
  p_chunk_count integer,
  p_skip_reason text
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
         indexed_at = now()
   where id = p_source_id;
  return true;
end;
$$;

-- ─── Retrieval ─────────────────────────────────────────────────────────────

-- The candidates for one question in one chapter: the p_limit nearest
-- passages by embedding and the p_limit best by words, each with its rank in
-- its own list (null when it is not in that list). The API merges the two
-- lists by reciprocal rank fusion and then checks the acting member's read
-- access to each passage's source.
--
-- Returns nothing unless p_user_id is a member of p_chapter_id. Words are
-- matched as "any of these", ranked by how many match and how close together:
-- a question is a sentence, and requiring every word of it in one passage
-- would leave the word half empty for most questions.
--
-- Only passages embedded with p_embedding_model enter the nearest list:
-- distances between two models' vectors mean nothing.
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
  distance double precision
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
  -- Not materialized, so each half below plans against the tables and the
  -- word half can use the GIN index.
  scoped as not materialized (
    select c.id, c.corpus_source_id, c.heading, c.content, c.page_start,
           c.page_end, c.embedding, c.embedding_model, c.content_search,
           s.source_type, s.source_id, s.title, s.source_at, s.decays
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
         sc.page_end, sc.source_at, sc.decays, d.rn, sp.rn, d.dist
    from scoped sc
    left join dense d on d.id = sc.id
    left join sparse sp on sp.id = sc.id
   where d.id is not null or sp.id is not null;
$$;

comment on function public.match_corpus_chunks(uuid, uuid, text, text, text, integer) is
  'AI corpus candidates for one question in one chapter, for a member of that chapter only: nearest passages by embedding and best by words, each with its rank. See 20261112140000_ai_corpus.sql.';

-- ─── Grants: service role only, as every RPC the API alone calls ───────────

revoke execute on function public.note_corpus_source(uuid, text, uuid, uuid) from public;
revoke execute on function public.drop_corpus_source(uuid, text, uuid) from public;
revoke execute on function public.corpus_follow_chapter_document() from public;
revoke execute on function public.corpus_follow_meeting() from public;
revoke execute on function public.claim_corpus_sources(text, timestamptz, integer) from public;
revoke execute on function public.write_corpus_chunks(uuid, bigint, boolean, text, jsonb) from public;
revoke execute on function public.finish_corpus_source(uuid, bigint, text, text, timestamptz, boolean, integer, text) from public;
revoke execute on function public.match_corpus_chunks(uuid, uuid, text, text, text, integer) from public;

do $$
declare
  v_role text;
  v_fn text;
  v_fns text[] := array[
    'public.note_corpus_source(uuid, text, uuid, uuid)',
    'public.drop_corpus_source(uuid, text, uuid)',
    'public.corpus_follow_chapter_document()',
    'public.corpus_follow_meeting()',
    'public.claim_corpus_sources(text, timestamptz, integer)',
    'public.write_corpus_chunks(uuid, bigint, boolean, text, jsonb)',
    'public.finish_corpus_source(uuid, bigint, text, text, timestamptz, boolean, integer, text)',
    'public.match_corpus_chunks(uuid, uuid, text, text, text, integer)'
  ];
begin
  foreach v_fn in array v_fns loop
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

-- ─── Existing documents and posted minutes wait to be indexed ──────────────

insert into public.corpus_sources (chapter_id, source_type, source_id, changed_by)
select d.chapter_id, 'chapter_document', d.id, d.uploaded_by
  from public.chapter_documents d
on conflict (chapter_id, source_type, source_id) do nothing;

insert into public.corpus_sources (chapter_id, source_type, source_id, changed_by)
select m.chapter_id, 'meeting_minutes', m.id,
       coalesce(m.updated_by, m.posted_by, m.created_by)
  from public.meetings m
 where m.status = 'posted'
on conflict (chapter_id, source_type, source_id) do nothing;
