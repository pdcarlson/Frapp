-- `GET /v1/invites/mine` (#3776) reads the live invites emailed to the
-- caller's verified address, across chapters (an `ilike` on `email`, then an
-- exact comparison in the API). Used and revoked invites are never pruned, so
-- without this the read scans every invite ever made; with it, only the live
-- ones (24h each). An `ilike` implies `email is not null`, so the planner can
-- use the partial index.
--
-- Partial on `used_at is null` (a revoke sets `used_at` too) and on an address
-- being present: share-link invites have none and are never matched.
-- Additive: no data change. Plain `create index`, as the other index
-- migrations here: Supabase applies each migration in a transaction, where
-- `concurrently` is refused, and `invites` is small.
create index if not exists idx_invites_pending_emailed
  on public.invites (expires_at)
  where used_at is null and email is not null;
