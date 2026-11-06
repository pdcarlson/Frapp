-- Raise the `backwork` bucket's per-object ceiling from 50MB to 100MB (#3487).
--
-- 104857600 = 100MB = MAX_BACKWORK_UPLOAD_BYTES in @repo/validation
-- (packages/validation/src/upload-allowlists.ts). The owner set backwork to the
-- hosted projects' global storage limit, which is 100MB and caps every bucket.
-- supabase/config.toml's global [storage] file_size_limit is also 100MB, so the
-- local stack enforces the column as written. Every other member-upload bucket
-- keeps 26214400.
--
-- Only file_size_limit changes, as in 20261105230000_backwork_bucket_50mb.sql,
-- which this supersedes and leaves in place (shipped migrations are immutable).
--
-- Guarded on storage.buckets existing for the same reason: the PGlite harness
-- (scripts/check-pglite-migrations.mjs) replays migrations into bare Postgres,
-- which has no storage schema.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  update storage.buckets
     set file_size_limit = 104857600
   where id = 'backwork';
end $$;
