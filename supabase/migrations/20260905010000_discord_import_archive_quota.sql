-- Per-import and per-chapter byte ceilings for the `chat-archive` bucket (#1243).
--
-- Nothing bounded how much one chapter could register into `chat-archive`.
-- `MAX_UPLOAD_URL_BATCH` caps a single mint request at 100 tickets and
-- `CustomThrottlerGuard` bounds request *rate*, not bytes, so a
-- `channels:manage` holder could loop create-import → mint 100 signed URLs →
-- repeat, each URL good for an object up to the bucket's 100 MB. The bucket has
-- no reaper other than the admin's own per-import purge, so consumed storage
-- stays consumed on a shared project.
--
-- This function is the read half of the fix: it answers "what would this
-- chapter and this import weigh if the batch in front of me were registered?"
-- in one round trip. `DiscordImportService.requestUploadUrls` refuses past the
-- ceilings in `@repo/validation` (`MAX_ARCHIVE_IMPORT_BYTES`,
-- `MAX_ARCHIVE_CHAPTER_BYTES`).
--
-- Why an RPC rather than a select. PostgREST's aggregate functions are disabled
-- on this stack (`?select=byte_size.sum()` answers PGRST123 "Use of aggregate
-- functions is not allowed"), so the alternative is paging every manifest row
-- into the API and summing there — and `discord_import_files` holds a row per
-- attachment, which is exactly the table that runs to tens of thousands of
-- rows. That read would then repeat on every 100-file batch, making the whole
-- registration path quadratic in the size of the import.
--
-- Two things this deliberately gets right, both of which a plain
-- `sum(byte_size) where chapter_id = ...` gets wrong:
--
-- 1. **Purged imports are excluded.** `runPurgeSlice` deletes the imported
--    messages and sweeps the storage prefix, then sets `status = 'purged'` — it
--    does NOT delete the `discord_import_files` rows, which survive as the
--    record of what was imported. Counting them would make the quota ratchet
--    one way: a chapter that purged every import would still be at its ceiling
--    forever. Every other status (`draft`, `cancelled`, `failed`, …) IS counted,
--    because those objects are still in the bucket — that is #1246's point.
--
-- 2. **Rows the incoming batch will replace are not double-counted.**
--    `createFiles` upserts on `(import_id, relative_path)`, and re-minting a URL
--    for an already-registered file is the normal resume path after an
--    interrupted upload. Counting the stored row AND the incoming one would
--    make a resumed upload fail against a ceiling it is not actually crossing.
--
-- `security invoker`, like `claim_presidency` and the rest: the API calls it
-- through its service_role client, and it reads nothing RLS would not already
-- decide for the caller it runs as.
create or replace function discord_import_projected_archive_bytes(
  p_chapter_id uuid,
  p_import_id uuid,
  p_relative_paths text[],
  p_byte_sizes bigint[]
)
returns table (import_bytes bigint, chapter_bytes bigint)
language sql
stable
security invoker
as $$
  with incoming as (
    -- `with ordinality` pairs the two parallel arrays positionally. A path with
    -- no matching size counts as 0 rather than dropping the row, so a
    -- malformed pair can never make the projection look SMALLER than reality.
    select coalesce(s.size, 0)::bigint as byte_size
      from unnest(p_relative_paths) with ordinality as p(path, ord)
      left join unnest(p_byte_sizes) with ordinality as s(size, ord)
        on s.ord = p.ord
  ),
  retained as (
    select f.import_id, coalesce(f.byte_size, 0)::bigint as byte_size
      from discord_import_files f
      join discord_imports i on i.id = f.import_id
     where f.chapter_id = p_chapter_id
       and i.status <> 'purged'
       and not (
         f.import_id = p_import_id
         and f.relative_path = any(p_relative_paths)
       )
  )
  select
    (
      (select coalesce(sum(byte_size), 0) from retained where import_id = p_import_id)
      + (select coalesce(sum(byte_size), 0) from incoming)
    )::bigint,
    (
      (select coalesce(sum(byte_size), 0) from retained)
      + (select coalesce(sum(byte_size), 0) from incoming)
    )::bigint;
$$;

-- The repo's RPC lockdown convention (see 20260901173000): revoke the Postgres
-- EXECUTE-to-PUBLIC default, grant only to the role the API actually uses.
revoke execute on function
  discord_import_projected_archive_bytes(uuid, uuid, text[], bigint[])
  from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function
      discord_import_projected_archive_bytes(uuid, uuid, text[], bigint[])
      from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function
      discord_import_projected_archive_bytes(uuid, uuid, text[], bigint[])
      from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      discord_import_projected_archive_bytes(uuid, uuid, text[], bigint[])
      to service_role;
  end if;
end
$$;

-- The quota read filters `discord_import_files` by `chapter_id` and joins
-- `discord_imports` on its primary key, so the chapter-wide sum is the half
-- that needs an index. Without it every mint request seq-scans the manifest of
-- every chapter in the product.
create index if not exists idx_discord_import_files_chapter
  on public.discord_import_files (chapter_id);
