-- One chapter_documents row per stored object, enforced by the database (#3399).
--
-- `POST /v1/documents` files the object a signed upload already put in the
-- bucket. Mobile's upload sheet retries a failed confirm with the same
-- storage_path rather than uploading a second copy, and a confirm whose
-- response was lost after it committed would then insert a second row for the
-- one object. Two rows sharing an object break delete:
-- `ChapterDocumentService.delete` removes the object, so deleting either row
-- leaves the other pointing at nothing.
--
--   chapter_documents_storage_path_key  unique on storage_path. Every path is
--     minted by `requestUploadUrl` under a fresh document id, so two rows have
--     never had a reason to share one.
--
-- The API reads the path before it files, and returns a filed row to the
-- uploader who filed it. Two confirms that race past that read meet this
-- index, and on its 23505 the API re-reads the row that won.
--
-- No row is rewritten or removed. On 2026-11-04 frapp-staging held one row and
-- frapp-prod none, with no shared paths. If a duplicate exists when this runs,
-- it stops with a message instead of choosing which row survives.

do $$
declare
  duplicate_paths bigint;
begin
  select count(*) into duplicate_paths
    from (
      select 1
        from public.chapter_documents
       group by storage_path
      having count(*) > 1
    ) paths;

  if duplicate_paths > 0 then
    raise exception
      'chapter_documents holds % storage_path(s) filed more than once',
      duplicate_paths
      using hint = 'Choosing which document row survives is the owner''s decision (#3399). Nothing was changed.';
  end if;
end
$$;

create unique index if not exists chapter_documents_storage_path_key
  on public.chapter_documents (storage_path);
