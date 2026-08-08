-- Declare the five dashboard-created storage buckets in IaC (#690).
--
-- Seven buckets exist in the hosted projects; only two were ever declared in
-- version control -- `service` (20260803231500_service_proof_bucket.sql) and
-- `reports` (20260805133000_reports_bucket.sql). The other five -- branding,
-- profiles, documents, backwork, chat -- were created by hand in the Supabase
-- dashboard, so nothing pinned them private, nothing constrained what could be
-- stored in them, and nothing recreated them in a fresh project, a preview
-- branch, or after a restore. Verified: a clean local project brought up from
-- migrations alone has exactly two rows in storage.buckets.
--
-- `public = false` is not a choice made here -- spec/architecture/README.md
-- section 7 already states it: "All buckets are private. All access goes
-- through API-generated signed URLs (upload and download). No public access."
-- This migration makes the declared intent enforceable rather than assumed.
-- The API can only express that design: IStorageProvider
-- (apps/api/src/domain/adapters/storage.interface.ts) has no getPublicUrl
-- method at all, so no code path reads an object without a signed URL.
--
-- allowed_mime_types and file_size_limit are load-bearing, not decoration: a
-- signed upload URL cannot pin a content type (the uploader sets its own
-- header on the PUT), so the API's allowlist gates only URL *issuance* while
-- these bucket columns are what storage-api enforces on the upload itself.
-- Without them a member with upload permission can store text/html under an
-- otherwise valid key and be served attacker-controlled markup from the
-- storage origin -- the same reasoning already written into the `service`
-- bucket migration. Each list below is copied from that bucket's own API-side
-- allowlist so bucket and application agree:
--
--   branding   ALLOWED_LOGO_CONTENT_TYPES  chapter.service.ts
--   profiles   ALLOWED_CONTENT_TYPES       user.service.ts
--   documents  ALLOWED_CONTENT_TYPES       chapter-document.service.ts
--   backwork   ALLOWED_CONTENT_TYPES       backwork.service.ts
--   chat       ALLOWED_CONTENT_TYPES       chat.service.ts
--
-- 26214400 = 25MB, matching supabase/config.toml and the two existing buckets.
--
-- Guarded on storage.buckets existing: the PGlite harness
-- (scripts/check-pglite-migrations.mjs) replays every migration into bare
-- Postgres, which has no Supabase storage schema -- there these buckets are
-- simply not provisioned, same as every dashboard-created bucket. The
-- on-conflict UPDATE (not DO NOTHING) backfills the constraint columns onto
-- the existing dashboard-created rows rather than failing on them; that is
-- what makes this migration a fix and not just a declaration.
--
-- Purely additive config -- no object is touched. Applying a MIME allowlist to
-- a bucket that already holds objects does not retroactively delete anything;
-- it only constrains future uploads.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
  values
    (
      'branding',
      'branding',
      false,
      array['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      26214400
    ),
    (
      'profiles',
      'profiles',
      false,
      array['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      26214400
    ),
    (
      'documents',
      'documents',
      false,
      array[
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/msword',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'text/plain',
        'text/csv'
      ],
      26214400
    ),
    (
      'backwork',
      'backwork',
      false,
      array[
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/msword',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'text/plain',
        'text/csv'
      ],
      26214400
    ),
    (
      'chat',
      'chat',
      false,
      array[
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/msword',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'text/plain',
        'text/csv'
      ],
      26214400
    )
  on conflict (id) do update set
    public = excluded.public,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;
end $$;
