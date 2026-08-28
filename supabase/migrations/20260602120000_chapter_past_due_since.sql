-- FRA-109: track when a chapter entered `past_due` so ChapterGuard can enforce
-- the 3-day grace window (spec/behavior/billing.md, spec/product/onboarding.md).
--
-- During grace (<= 3 days): reads + non-invite free-tier writes continue, but
-- invite/create and paid-ops writes are blocked. After grace: hard read-only
-- lock (like `canceled`, but recoverable on payment). The billing webhook sets
-- this on the into-past_due transition and clears it on recovery.
--
-- Null = not currently past_due (or a legacy row that became past_due before
-- this column existed; the guard treats null-while-past_due as "within grace").

alter table chapters
  add column if not exists past_due_since timestamptz;

-- Backfill: start the grace clock now for any chapter already past_due, so an
-- existing past_due chapter is not instantly hard-locked when this ships.
update chapters
  set past_due_since = now()
  where subscription_status = 'past_due'
    and past_due_since is null;
