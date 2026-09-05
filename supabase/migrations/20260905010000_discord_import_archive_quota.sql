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
-- This function registers manifest rows AND enforces the ceilings in ONE
-- statement. Both halves have to live here together — an earlier draft split
-- them (a read-only projection function, then a separate PostgREST upsert) and
-- that shape was wrong in two ways a review caught:
--
--   1. **Check-then-act.** Ten concurrent mint requests all read the same
--      pre-batch total and all passed it, so the ceiling multiplied by the
--      concurrency. `CustomThrottlerGuard` bounds rate, not in-flight
--      concurrency, so nothing else closed it. The advisory lock below plus a
--      single round trip is what makes the ceiling mean something.
--   2. **A rewritable ledger.** The upsert's `DO UPDATE SET byte_size` let a
--      caller re-mint paths it had already registered and uploaded, declaring
--      a smaller size — which both passed the check and overwrote the recorded
--      value, permanently erasing the accounting for objects still in the
--      bucket. `greatest(...)` below makes the recorded size monotonic: a
--      re-mint may raise a row's size, never lower it.
--
-- Why SQL rather than summing in the API. PostgREST's aggregate functions are
-- disabled on this stack — measured 2026-09-05 against the local stack
-- (`GET /rest/v1/discord_import_files?select=byte_size.sum()` → HTTP 400
-- `PGRST123 "Use of aggregate functions is not allowed"`). NOT measured against
-- the hosted project, and so not claimed for it. Independently of that, the
-- check and the write must share one transaction for reason 1 above, which a
-- client-side sum cannot give at all.
--
-- What this does NOT fix, stated so nobody reads more into it: the sum is over
-- `byte_size`, which on the upload path is **client-declared** (the browser
-- PUTs straight to storage and the API never sees the bytes), and which is NULL
-- on any row whose size was never known — the bot path writes NULL when Discord
-- omits `attachment.size`. `coalesce(..., 0)` prices those at zero, so the
-- ledger UNDER-counts real storage in exactly that case. Nothing available at
-- this seam fixes either: both need reconciliation against storage listings,
-- which is the retention-sweep shape in #1246.
create or replace function discord_import_register_files(
  p_chapter_id uuid,
  p_import_id uuid,
  p_rows jsonb,
  p_import_cap bigint,
  p_chapter_cap bigint
)
returns setof discord_import_files
language plpgsql
volatile
security invoker
as $$
declare
  v_import_bytes bigint;
  v_chapter_bytes bigint;
begin
  -- Serializes registration per chapter for the rest of the transaction, so the
  -- measure below and the upsert that follows cannot interleave with another
  -- request's pair. Keyed on the chapter because the chapter ceiling is the
  -- wider of the two: two different imports in one chapter still contend.
  perform pg_advisory_xact_lock(
    hashtext('discord_import_register_files'),
    hashtext(p_chapter_id::text)
  );

  -- The projected totals, with every row priced at what it will be worth AFTER
  -- this batch commits: an untouched row keeps its stored size, a row this
  -- batch re-registers takes `greatest(stored, declared)` (the monotonic rule),
  -- and a brand-new row takes its declared size.
  --
  -- `purged` and `purging` imports are both excluded. `purged` has had its
  -- objects swept but KEEPS its manifest rows — they survive as the record of
  -- what was imported — so counting them would make the quota ratchet one way
  -- and never release. `purging` is a committed intent to delete that the
  -- worker will complete; counting it would refuse the admin who just did what
  -- the over-quota message told them to do. The cost of excluding `purging` is
  -- that a stalled purge lets a chapter over-register by that import's size,
  -- once, until the sweep finishes — bounded, self-correcting, and far better
  -- than a chapter with no action left to take.
  with incoming as (
    -- Rows are read out of jsonb rather than parallel arrays. The array form
    -- paired paths to sizes by `unnest … with ordinality`, which is one
    -- refactor away from mis-pairing silently, and `= any(NULL)` — or a single
    -- NULL element — made the whole predicate NULL, which a `where not (…)`
    -- then filters out, dropping the very rows the exclusion exists to
    -- re-price and making the answer SMALLER than the truth. jsonb has no such
    -- edge, and `coalesce(p_rows, '[]')` makes a null payload an empty batch
    -- rather than an unpriced one.
    select
      x.relative_path,
      greatest(coalesce(x.byte_size, 0), 0) as byte_size
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
        as x(relative_path text, byte_size bigint)
     where x.relative_path is not null
  )
  select
    coalesce(sum(effective) filter (where import_id = p_import_id), 0),
    coalesce(sum(effective), 0)
    into v_import_bytes, v_chapter_bytes
  from (
    select
      f.import_id,
      greatest(
        coalesce(f.byte_size, 0),
        coalesce(i.byte_size, 0)
      )::bigint as effective
      from discord_import_files f
      join discord_imports d on d.id = f.import_id
      left join incoming i
        on f.import_id = p_import_id
       and i.relative_path = f.relative_path
     where f.chapter_id = p_chapter_id
       and d.status not in ('purged', 'purging')

    union all

    -- Rows this batch adds that do not exist yet.
    select p_import_id, i.byte_size
      from incoming i
     where not exists (
       select 1
         from discord_import_files f
        where f.import_id = p_import_id
          and f.relative_path = i.relative_path
     )
  ) priced;

  if v_import_bytes > p_import_cap then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'discord_import_archive_quota: import %s would hold %s bytes, past its %s byte ceiling',
        p_import_id, v_import_bytes, p_import_cap
      );
  end if;

  if v_chapter_bytes > p_chapter_cap then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'discord_import_archive_quota: chapter %s would hold %s bytes, past its %s byte ceiling',
        p_chapter_id, v_chapter_bytes, p_chapter_cap
      );
  end if;

  -- Same upsert the API used to issue directly, with one change: `byte_size`
  -- only ever moves up. Everything else about a re-registered row (storage
  -- path, content type) is server-derived and safe to refresh, and
  -- `uploaded_at` is deliberately untouched so a resumed upload keeps its
  -- confirmation.
  return query
  with incoming as (
    select
      x.relative_path,
      x.kind,
      x.part_index,
      x.bucket,
      x.storage_path,
      x.content_type,
      greatest(coalesce(x.byte_size, 0), 0) as byte_size
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
        as x(
          relative_path text,
          kind text,
          part_index integer,
          bucket text,
          storage_path text,
          content_type text,
          byte_size bigint
        )
     where x.relative_path is not null
  )
  insert into discord_import_files as t (
    import_id, chapter_id, kind, part_index, relative_path,
    bucket, storage_path, content_type, byte_size
  )
  select
    p_import_id, p_chapter_id, i.kind, i.part_index, i.relative_path,
    i.bucket, i.storage_path, i.content_type, i.byte_size
    from incoming i
  on conflict (import_id, relative_path) do update
    set kind         = excluded.kind,
        part_index   = excluded.part_index,
        bucket       = excluded.bucket,
        storage_path = excluded.storage_path,
        content_type = excluded.content_type,
        byte_size    = greatest(coalesce(t.byte_size, 0), excluded.byte_size)
  returning t.*;
end;
$$;

-- The repo's RPC lockdown convention (see 20260901173000): revoke the Postgres
-- EXECUTE-to-PUBLIC default, grant only to the role the API actually uses.
revoke execute on function
  discord_import_register_files(uuid, uuid, jsonb, bigint, bigint)
  from public;

-- anon/authenticated/service_role are Supabase-managed roles, absent in bare
-- Postgres substrates (e.g. PGlite in CI), so guard each on role existence to
-- keep the migration portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function
      discord_import_register_files(uuid, uuid, jsonb, bigint, bigint)
      from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function
      discord_import_register_files(uuid, uuid, jsonb, bigint, bigint)
      from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      discord_import_register_files(uuid, uuid, jsonb, bigint, bigint)
      to service_role;
  end if;
end
$$;

-- Covers the quota sum: `chapter_id` is the filter, `import_id` splits the two
-- totals, and `byte_size` rides along so the sum is answered from the index
-- instead of a heap fetch per row. That matters because the sum runs once per
-- 100-file batch, and a large media import is hundreds of batches over a table
-- that grows as it proceeds — the cost is O(batches × rows) either way, and
-- this is what keeps the constant small enough that the late batches of a big
-- import do not time out. (The existing index on this table leads with
-- `import_id`, so it cannot serve the chapter-wide half.)
create index if not exists idx_discord_import_files_chapter_bytes
  on public.discord_import_files (chapter_id, import_id) include (byte_size);
