-- Chunk 02: chapter directory
--
-- Global (not chapter-scoped) reference table of Greek-life chapters,
-- seeded from a curated CSV. Used by the onboarding wizard to autofill
-- chapter identity. Linked back to chapters via chapters.directory_id.
--
-- Seed: supabase/seed/chapter_directory.csv (50-row placeholder;
-- full ~2000-row data tracked in GitHub issue #231).

create table chapter_directory (
  id                   uuid         primary key default gen_random_uuid(),
  org_letters          text         not null,
  org_name             text         not null,
  archetype            text         not null default 'ifc',
  chapter_designation  text,
  university           text         not null,
  university_short     text         not null,
  founded_year         int,
  default_colors       jsonb        not null default '{}',
  website              text,
  source               text         not null default 'seed',
  created_at           timestamptz  not null default now()
);

-- Lookup by school + org letters (onboarding autocomplete)
create index idx_chapter_directory_university_letters
  on chapter_directory (university_short, org_letters);

-- Full-text search on combined identity string
alter table chapter_directory
  add column if not exists search_vector tsvector
    generated always as (
      to_tsvector('english',
        coalesce(org_name, '') || ' ' ||
        coalesce(org_letters, '') || ' ' ||
        coalesce(chapter_designation, '') || ' ' ||
        coalesce(university, '') || ' ' ||
        coalesce(university_short, '')
      )
    ) stored;

create index idx_chapter_directory_search on chapter_directory using gin(search_vector);

-- FK from chapters back to directory (added in chapter_customization migration)
alter table chapters
  add constraint fk_chapters_directory
    foreign key (directory_id) references chapter_directory(id) on delete set null;

alter table chapter_directory enable row level security;
