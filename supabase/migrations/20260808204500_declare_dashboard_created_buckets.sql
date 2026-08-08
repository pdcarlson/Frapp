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
declare
  -- The bucket set this migration owns, named once. The guard below reads it,
  -- and the row count after the upsert is checked against it, so this list and
  -- the `values` list cannot silently drift apart -- adding a bucket to one
  -- without the other fails loudly on the next apply instead of quietly
  -- leaving the new bucket unguarded.
  managed_ids constant text[] := array['branding', 'profiles', 'documents', 'backwork', 'chat'];
  colliding text;
  declared_count integer;
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  -- storage.buckets has a second unique index on `name` (`bname`) beyond the
  -- primary key on `id`, and the upsert below can only name one conflict
  -- target. Supabase keeps id = name for every bucket it creates, so the two
  -- never diverge in practice -- but if some row ever held one of these names
  -- under a different id, `on conflict (id)` would not catch it and the whole
  -- five-row insert would abort on a bare "duplicate key value violates unique
  -- constraint bname". Since a failing migration halts the entire deploy
  -- pipeline, fail with something an operator can act on instead. Reassigning
  -- the row is deliberately not attempted: which bucket the objects actually
  -- live in is ambiguous, and guessing wrong is worse than stopping.
  select string_agg(format('%s (id: %s)', name, id), ', ' order by name)
    into colliding
    from storage.buckets
   where name = any(managed_ids)
     and id <> name;

  if colliding is not null then
    raise exception
      'Cannot declare storage buckets: % already use(s) a managed bucket name under a different id. Resolve the bucket naming by hand before re-running this migration.',
      colliding;
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

  -- Drift check, not paranoia: the guard above and the `values` list are two
  -- enumerations of the same bucket set, and nothing in SQL couples them. If a
  -- later edit adds a bucket to one and forgets the other, this fails on the
  -- next apply rather than leaving the new bucket silently unguarded.
  get diagnostics declared_count = row_count;
  if declared_count <> array_length(managed_ids, 1) then
    raise exception
      'Bucket declaration drift: upserted % row(s) but managed_ids lists %. Keep managed_ids and the values list in sync.',
      declared_count, array_length(managed_ids, 1);
  end if;
end $$;
