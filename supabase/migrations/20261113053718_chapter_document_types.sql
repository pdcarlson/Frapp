-- Chapter document types (#3642, piece 4: typed document types).
--
-- WHAT CHANGES
--
-- `chapter_documents.document_type` has been free text since
-- 20260831220000_chapter_documents_metadata.sql, so a library fills with
-- near-duplicates ("Bylaws", "bylaws", "By-laws") and neither a filter nor a
-- suggestion has a fixed list to aim at. `chapter_document_types` is that
-- list: each chapter's own, ordered, editable by officers with
-- `chapter_docs:manage`.
--
-- `chapter_documents.document_type` stays a text name, as `folder` does
-- (20260809120000_chapter_document_folders.sql): rewriting a populated column
-- to a uuid would be destructive, and the name is the link.
--
-- ONE KEY FOR "THE SAME TYPE"
--
-- `document_type_key(name)` is a name lowercased with everything but letters
-- and digits removed, so "By-Laws", "bylaws" and " BYLAWS " are one type. The
-- web form's `typeKey` and the API's `documentTypeKey` (`@repo/validation`)
-- are the same rule. The unique index, the seeding, the backfill and the two
-- functions below all match on it, and nothing matches with LIKE, whose `*`
-- PostgREST reads as a wildcard. A name with no letter or digit has an empty
-- key and is refused.
--
-- SEEDED TYPES
--
-- Every chapter, existing and new, starts with Bylaws, Minutes, Agenda,
-- Budget, Policy, Form and Other: #3642's list plus Agenda, which the web
-- upload form already offered. A new chapter gets them from a trigger on
-- `chapters`, as event types do (20261111200000_event_types.sql). An existing
-- chapter first keeps every type its documents already use, once per key, in
-- the spelling most of them use; a default the chapter already spells its own
-- way ("By-Laws") is not added again.
--
-- RENAME AND DELETE
--
-- `rename_chapter_document_type` and `delete_chapter_document_type` change the
-- type row and every document of that type (by key) in one transaction, so a
-- rename that loses a race to another type of the same name changes nothing.
--
-- RLS on with no policies, as `chapter_documents` and
-- `chapter_document_folders`: the API reads and writes with the service role.

create or replace function public.document_type_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(coalesce(p_name, ''), '[^[:alnum:]]+', '', 'g'));
$$;

comment on function public.document_type_key(text) is
  'A document type name lowercased with all but letters and digits removed: the key two spellings of one type share. Same rule as documentTypeKey in @repo/validation. See 20261113053718_chapter_document_types.sql.';

create table if not exists public.chapter_document_types (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- 100 is the confirm-upload DTO's limit on `document_type`, so every value
  -- already stored fits. A name must hold a letter or digit.
  constraint chapter_document_types_name_len
    check (char_length(btrim(name)) between 1 and 100),
  constraint chapter_document_types_name_key
    check (public.document_type_key(name) <> ''),
  -- The API's DTO bounds it at POSITION_MAX, as it does folders'.
  constraint chapter_document_types_sort_order_nonneg
    check (sort_order >= 0)
);

-- One type per key in a chapter.
create unique index if not exists idx_chapter_document_types_key
  on public.chapter_document_types (chapter_id, public.document_type_key(name));

-- The list query is `where chapter_id = $1 order by sort_order, name`.
create index if not exists idx_chapter_document_types_chapter
  on public.chapter_document_types (chapter_id, sort_order, name);

-- What a rename or delete scans: one chapter's documents of one type.
create index if not exists idx_chapter_documents_type_key
  on public.chapter_documents (chapter_id, public.document_type_key(document_type))
  where document_type is not null;

alter table public.chapter_document_types enable row level security;

comment on table public.chapter_document_types is
  'A chapter''s own list of document types. chapter_documents.document_type holds a type''s name, matched by document_type_key. See 20261113053718_chapter_document_types.sql.';

-- ── Seeding ───────────────────────────────────────────────────────────────

create or replace function public.seed_default_document_types(p_chapter_id uuid)
returns void
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  insert into public.chapter_document_types (chapter_id, name, sort_order)
  select p_chapter_id, d.name, d.sort_order
    from (values
      ('Bylaws', 1),
      ('Minutes', 2),
      ('Agenda', 3),
      ('Budget', 4),
      ('Policy', 5),
      ('Form', 6),
      ('Other', 7)
    ) as d(name, sort_order)
  on conflict (chapter_id, public.document_type_key(name)) do nothing;
$$;

comment on function public.seed_default_document_types(uuid) is
  'Adds the seven default document types to one chapter, skipping any it already has under any spelling. Run by trg_chapters_seed_document_types on every new chapter. See 20261113053718_chapter_document_types.sql.';

create or replace function public.chapters_seed_document_types()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_document_types(new.id);
  return new;
end;
$$;

drop trigger if exists trg_chapters_seed_document_types on public.chapters;
create trigger trg_chapters_seed_document_types
  after insert on public.chapters
  for each row execute function public.chapters_seed_document_types();

-- Existing chapters: first every type their documents already use, once per
-- key, in the spelling most documents use (ties go to the alphabetically
-- first), with inner whitespace collapsed. They go first so a chapter that
-- spells a default its own way keeps its spelling. Reads `chapter_documents`
-- and writes nothing to it.
insert into public.chapter_document_types (chapter_id, name, sort_order)
select chapter_id, name, 100
  from (
    select distinct on (chapter_id, public.document_type_key(spelling))
           chapter_id, spelling as name
      from (
        select chapter_id,
               regexp_replace(btrim(document_type), '\s+', ' ', 'g') as spelling,
               count(*) as uses
          from public.chapter_documents
         where document_type is not null
           and public.document_type_key(document_type) <> ''
           and char_length(btrim(document_type)) between 1 and 100
         group by chapter_id, regexp_replace(btrim(document_type), '\s+', ' ', 'g')
      ) as spellings
     order by chapter_id, public.document_type_key(spelling), uses desc, spelling
  ) as used
on conflict (chapter_id, public.document_type_key(name)) do nothing;

-- ... then the defaults they don't already have.
select public.seed_default_document_types(id) from public.chapters;

-- ── Rename and delete ─────────────────────────────────────────────────────

-- Renames a type and every document of it (by key) in one transaction.
-- Returns the renamed row, or no row when the type isn't the chapter's. A
-- name another type already holds raises unique_violation (23505), and the
-- documents are left as they were.
create or replace function public.rename_chapter_document_type(
  p_chapter_id uuid,
  p_type_id uuid,
  p_name text
)
returns setof public.chapter_document_types
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  select name into v_old
    from public.chapter_document_types
   where id = p_type_id and chapter_id = p_chapter_id
   for update;
  if not found then
    return;
  end if;
  update public.chapter_documents
     set document_type = p_name
   where chapter_id = p_chapter_id
     and document_type is not null
     and public.document_type_key(document_type) = public.document_type_key(v_old);
  return query
    update public.chapter_document_types
       set name = p_name
     where id = p_type_id and chapter_id = p_chapter_id
    returning *;
end;
$$;

-- Clears a type from its documents (by key) and deletes it, in one
-- transaction. Returns whether the chapter had it.
create or replace function public.delete_chapter_document_type(
  p_chapter_id uuid,
  p_type_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  select name into v_old
    from public.chapter_document_types
   where id = p_type_id and chapter_id = p_chapter_id
   for update;
  if not found then
    return false;
  end if;
  update public.chapter_documents
     set document_type = null
   where chapter_id = p_chapter_id
     and document_type is not null
     and public.document_type_key(document_type) = public.document_type_key(v_old);
  delete from public.chapter_document_types
   where id = p_type_id and chapter_id = p_chapter_id;
  return true;
end;
$$;

-- Service role only: the seed runs from the trigger with the inserting
-- role's rights, and the API calls rename and delete with the service role.
-- `document_type_key` stays callable by everyone: it reads nothing.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.seed_default_document_types(uuid)',
    'public.chapters_seed_document_types()',
    'public.rename_chapter_document_type(uuid, uuid, text)',
    'public.delete_chapter_document_type(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;
