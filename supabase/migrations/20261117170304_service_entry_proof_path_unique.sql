-- One service entry per proof file in a chapter, enforced by the database
-- (spec/behavior/service-hours.md § Logging).
--
-- `POST /v1/service-entries` attaches the file a signed upload already put in
-- the bucket. The web create retries a failed request, and the phone's Log
-- service hours sheet resends a failed create with the same proof path rather
-- than uploading the photo again. A create whose response was lost after it
-- committed would then insert a second entry for one receipt. Two entries
-- sharing a file double-count the hours, and deleting either one could take
-- the other's receipt with it.
--
--   service_entries_chapter_proof_path_key  unique on (chapter_id, proof_path)
--     where proof_path is not null. Every path is minted by the proof
--     upload-url step under a fresh proof id, so two entries have no reason
--     to share one. Entries without proof are untouched.
--
-- The API looks the path up before it inserts, and answers a resend by the
-- same member with the entry already saved. Two creates that race past that
-- read meet this index, and on its 23505 the API re-reads the entry that won.
--
-- No row is rewritten or removed. On 2026-11-17 frapp-staging held no service
-- entries, and frapp-prod held 17, two with proof, none sharing a path. If a
-- duplicate exists when this runs (one written by the API before this change
-- between that check and the push), it stops with a message instead of
-- choosing which entry keeps the file.

do $$
declare
  duplicate_paths bigint;
begin
  select count(*) into duplicate_paths
    from (
      select 1
        from public.service_entries
       where proof_path is not null
       group by chapter_id, proof_path
      having count(*) > 1
    ) paths;

  if duplicate_paths > 0 then
    raise exception
      'service_entries holds % proof_path(s) on more than one entry in a chapter',
      duplicate_paths
      using hint = 'Which entry keeps the file is the owner''s decision; see docs/ops/database/migrations/20261117170304_service_entry_proof_path_unique.md. Nothing was changed.';
  end if;
end
$$;

create unique index if not exists service_entries_chapter_proof_path_key
  on public.service_entries (chapter_id, proof_path)
  where proof_path is not null;
