-- Raise the `backwork` bucket's per-object ceiling from 25MB to 50MB (#3487).
--
-- 52428800 = 50MB = MAX_BACKWORK_UPLOAD_BYTES in @repo/validation
-- (packages/validation/src/upload-allowlists.ts). Backwork is the one
-- member-upload surface above the shared 25MB MAX_UPLOAD_BYTES: scanned exams
-- run large, and the owner asked for 50MB per file. Every other member-upload
-- bucket keeps 26214400. supabase/config.toml's global [storage]
-- file_size_limit (100MB) already sits above this, so the local stack enforces
-- the column as written.
--
-- Only file_size_limit changes. public and allowed_mime_types stay as
-- 20260808204500_declare_dashboard_created_buckets.sql declared them.
--
-- Guarded on storage.buckets existing for the same reason as that migration:
-- the PGlite harness (scripts/check-pglite-migrations.mjs) replays migrations
-- into bare Postgres, which has no storage schema.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  update storage.buckets
     set file_size_limit = 52428800
   where id = 'backwork';
end $$;
