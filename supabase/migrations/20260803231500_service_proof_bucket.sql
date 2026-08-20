-- Service-hour proof storage bucket (FRA-49).
--
-- spec/behavior/service-hours.md stores proof uploads under
-- chapters/{chapter_id}/service/... . Proof objects get their own private
-- bucket (matching the one-bucket-per-domain layout: chat, backwork,
-- branding, documents, profiles) so the API can mint signed upload/download
-- URLs against a chapter-scoped prefix. The bucket is private with no
-- storage RLS policies: every client interaction goes through API-issued
-- signed URLs, which do not consult RLS, and direct client access stays
-- denied by default.
--
-- allowed_mime_types and file_size_limit are load-bearing, not decoration:
-- the API's images+PDF allowlist gates only signed-URL *issuance* (a signed
-- upload URL cannot pin a content type — the uploader sets its own on the
-- PUT), while storage-api enforces these bucket columns on the upload
-- request itself. Without them a member could store text/html under a valid
-- proof key and reviewers would be served attacker-controlled HTML from the
-- storage origin. MIME types must stay in lockstep with kind "proof" in
-- `@repo/validation` (`packages/validation/src/upload-allowlists.ts`).
-- 26214400 = 25MB = MAX_UPLOAD_BYTES, matching the local config.toml cap and
-- the chat attachment limit.
--
-- Guarded on storage.buckets existing: the PGlite harness
-- (scripts/check-pglite-migrations.mjs) replays every migration into bare
-- Postgres, which has no Supabase storage schema — there the bucket is
-- simply not provisioned, same as every dashboard-created bucket. The
-- on-conflict UPDATE (not DO NOTHING) backfills the constraint columns onto
-- any pre-existing bucket row.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
  values (
    'service',
    'service',
    false,
    array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
    26214400
  )
  on conflict (id) do update set
    public = excluded.public,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;
end $$;
