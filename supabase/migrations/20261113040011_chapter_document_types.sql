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
-- to a uuid would be destructive, and the name is the link. The API keeps the
-- two in step: an upload's type is matched to the list ignoring case and
-- outer whitespace and stored in the list's spelling, renaming a type renames
-- it on its documents, and deleting one clears it from them.
--
-- SEEDED TYPES
--
-- Every chapter, existing and new, starts with the six types the web upload
-- form already offered (Bylaws, Minutes, Agenda, Budget, Policy, Form). A new
-- chapter gets them from a trigger on `chapters`, as event types do
-- (20261111200000_event_types.sql). An existing chapter also keeps every type
-- its documents already use, once per spelling family, in the spelling most
-- of them use, after the six.
--
-- RLS on with no policies, as `chapter_documents` and
-- `chapter_document_folders`: the API reads and writes with the service role.

create table if not exists public.chapter_document_types (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- 100 is the confirm-upload DTO's limit on `document_type`, so every value
  -- already stored fits.
  constraint chapter_document_types_name_len
    check (char_length(btrim(name)) between 1 and 100),
  -- The API's DTO bounds it at POSITION_MAX, as it does folders'.
  constraint chapter_document_types_sort_order_nonneg
    check (sort_order >= 0)
);

-- One type per name in a chapter, ignoring case and outer whitespace.
create unique index if not exists idx_chapter_document_types_name
  on public.chapter_document_types (chapter_id, lower(btrim(name)));

-- The list query is `where chapter_id = $1 order by sort_order, name`.
create index if not exists idx_chapter_document_types_chapter
  on public.chapter_document_types (chapter_id, sort_order, name);

alter table public.chapter_document_types enable row level security;

comment on table public.chapter_document_types is
  'A chapter''s own list of document types. chapter_documents.document_type holds a type''s name, matched ignoring case. See 20261113040011_chapter_document_types.sql.';

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
      ('Form', 6)
    ) as d(name, sort_order)
  on conflict (chapter_id, lower(btrim(name))) do nothing;
$$;

comment on function public.seed_default_document_types(uuid) is
  'Adds the six default document types to one chapter, skipping names it already has. Run by trg_chapters_seed_document_types on every new chapter. See 20261113040011_chapter_document_types.sql.';

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

-- Existing chapters: the six defaults ...
select public.seed_default_document_types(id) from public.chapters;

-- ... then every type their documents already use, once per spelling family
-- (case and outer whitespace), in the spelling most documents use (ties go
-- to the alphabetically first), ordered by name after the defaults. Reads
-- `chapter_documents` and writes nothing to it.
insert into public.chapter_document_types (chapter_id, name, sort_order)
select chapter_id, name, 100
  from (
    select distinct on (chapter_id, lower(btrim(document_type)))
           chapter_id, btrim(document_type) as name
      from public.chapter_documents
     where document_type is not null
       and char_length(btrim(document_type)) between 1 and 100
     group by chapter_id, btrim(document_type), lower(btrim(document_type))
     order by chapter_id, lower(btrim(document_type)), count(*) desc,
              btrim(document_type)
  ) as used
on conflict (chapter_id, lower(btrim(name))) do nothing;

-- Neither function is an RPC: the trigger calls them with the inserting
-- role's rights (the API's service role).
revoke all on function public.seed_default_document_types(uuid) from public;
revoke all on function public.chapters_seed_document_types() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.seed_default_document_types(uuid) from anon;
    revoke all on function public.chapters_seed_document_types() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.seed_default_document_types(uuid) from authenticated;
    revoke all on function public.chapters_seed_document_types() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.seed_default_document_types(uuid) to service_role;
    grant execute on function public.chapters_seed_document_types() to service_role;
  end if;
end
$$;
