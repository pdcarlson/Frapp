-- When each push token was last registered.
--
-- A member keeps at most ten push tokens (`MAX_PUSH_TOKENS_PER_USER` in
-- `notification.service.ts`), and past that the API drops the ones registered
-- longest ago. A phone re-registers its unchanged token on every launch, which
-- left `created_at` untouched, so ranking by `created_at` dropped the phone in
-- longest daily use first. `last_registered_at` is set on insert and stamped
-- again on every re-register by the same member, and the cap ranks by it.
--
-- Existing rows start at their `created_at`: the best this table knows, and
-- the next launch of each phone stamps the real time.
--
-- The non-volatile default makes the add a catalog change with no rewrite;
-- the backfill rewrites each row once (one row per device, a small table).
alter table public.push_tokens
  add column if not exists last_registered_at timestamptz not null default now();

update public.push_tokens
set last_registered_at = created_at;
