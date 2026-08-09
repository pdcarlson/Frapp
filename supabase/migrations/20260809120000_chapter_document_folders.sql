-- Chapter document folders.
--
-- `chapter_documents.folder` has always been a free-text column: a document
-- carried a folder *name* and nothing else existed. That satisfies "group
-- documents" but not `spec/behavior/chapter-docs.md`, which says folders have
-- "a name and a sort order" — there was nowhere to persist an order, and no
-- way to name a folder before a document was filed into it. An empty folder
-- was not representable at all.
--
-- This table is the folder itself. `chapter_documents.folder` deliberately
-- stays a text name rather than becoming an FK: rewriting it to a uuid would
-- be a destructive change to a populated column, and the join it would save is
-- one this feature never performs. The name is the link, and the unique
-- constraint below is what keeps it unambiguous.
create table chapter_document_folders (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- Two folders with one name in a chapter would make `folder` ambiguous:
  -- deleting one would move the other's documents to root as collateral.
  -- Cross-chapter duplicates are expected and fine.
  unique (chapter_id, name)
);

-- The list query is always `where chapter_id = $1 order by sort_order, name`.
create index idx_chapter_document_folders_chapter
  on chapter_document_folders (chapter_id, sort_order, name);

-- Adopt the folder names already in use.
--
-- Without this, every folder on an already-uploaded document would be absent
-- from the new folder list — the documents would still be filed under it and
-- still be filterable by it, but officers could not rename, reorder, or delete
-- it, and it would look like the upload had lost its folder. This inserts into
-- a table created empty three statements ago; it reads `chapter_documents` and
-- writes nothing to it, so it is reversible by dropping this table.
--
-- `sort_order` 0 for every backfilled row means they order by name until an
-- officer arranges them, which is the same order the UI shows today.
insert into chapter_document_folders (chapter_id, name, sort_order)
select distinct chapter_id, folder, 0
from chapter_documents
where folder is not null
  and folder <> ''
on conflict (chapter_id, name) do nothing;

alter table chapter_document_folders enable row level security;

-- No client policies, matching `chapter_documents` itself: this table is
-- API-only (service role). Tenant isolation is enforced in the application
-- layer, where every query filters on the caller's active `chapter_id`.
