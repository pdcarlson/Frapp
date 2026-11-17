-- The daily ceiling on emailed invites per inviter (`daily-send-limits.ts` in
-- the API, spec/behavior/README.md § Daily limits) reads, on every emailed
-- invite, when each of the sender's emailed invites in the last 24 hours was
-- made, across every chapter. `invites` is never pruned, and nothing indexed
-- `created_by`, so without this that read scans the whole table. The
-- per-chapter ceiling's read is served by `idx_invites_chapter_id`.
--
-- Partial on an address being present: share-link invites have none and are
-- never counted. Additive: no data change. Plain `create index`, as the other
-- index migrations here: Supabase applies each migration in a transaction,
-- where `concurrently` is refused, and `invites` is small.
create index if not exists idx_invites_emailed_by_creator
  on public.invites (created_by, created_at)
  where email is not null;
