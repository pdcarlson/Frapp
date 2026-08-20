-- Generated report artifact storage bucket (FRA-19).
--
-- spec/behavior/reports.md ("Export Flow") requires the export path to return a
-- signed download URL valid for one hour rather than a permanent public file.
-- Rendered PDFs land under chapters/{chapter_id}/reports/... in their own
-- private bucket, matching the one-bucket-per-domain layout (chat, backwork,
-- branding, documents, profiles, service).
--
-- The bucket is private with no storage RLS policies: the API writes objects
-- with the service-role client and hands clients only API-issued signed URLs,
-- which do not consult RLS. Direct client access stays denied by default, so a
-- member cannot enumerate another chapter's exports.
--
-- allowed_mime_types is pinned to application/pdf because this bucket is
-- written *only* by the server-side renderer — unlike the upload buckets, no
-- signed upload URL is ever minted for it, so nothing user-controlled should
-- ever be storable here. file_size_limit 26214400 = 25MB matches
-- MAX_UPLOAD_BYTES in `@repo/validation` and the repo-wide storage cap in
-- config.toml; a report that large means a pathological export, not a
-- legitimate one. This bucket is not a member-upload surface — it is not
-- one of the `image` / `proof` / `document` kinds.
--
-- Guarded on storage.buckets existing: the PGlite harness
-- (scripts/check-pglite-migrations.mjs) replays every migration into bare
-- Postgres, which has no Supabase storage schema — there the bucket is simply
-- not provisioned, same as every dashboard-created bucket. The on-conflict
-- UPDATE (not DO NOTHING) backfills the constraint columns onto any
-- pre-existing bucket row.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
  values (
    'reports',
    'reports',
    false,
    array['application/pdf'],
    26214400
  )
  on conflict (id) do update set
    public = excluded.public,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;
end $$;
