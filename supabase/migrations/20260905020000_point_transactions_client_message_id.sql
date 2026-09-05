-- Ledger idempotency for POST /v1/points/adjust (#1719)
--
-- An officer running `/points grant …` whose response is lost — a 502/504 from
-- the gateway arriving *after* the row committed is the commonest case — cannot
-- know whether the ledger write landed. Nothing stopped a second row, so the
-- natural retry double-granted, silently corrupting the record officers use for
-- semester standings.
--
-- The request already carries a client-minted UUIDv4 (`client_message_id`), but
-- until now it only ever reached the chat card: `point_transactions` had no such
-- column, so the only dedupe in the whole path was the partial unique index on
-- `chat_messages`. This gives the ledger the same guarantee the chat hot path
-- has had since 20260523150000, using deliberately the same shape.
--
-- Additive and safe to replay:
--   * the column is NULLABLE, so all existing rows stay valid and no backfill
--     is needed;
--   * the index is PARTIAL (`where client_message_id is not null`), so the
--     dashboard adjustment path — which sends no id, and legitimately writes
--     many rows per chapter — is entirely unconstrained by it;
--   * both statements are `if not exists`.

alter table point_transactions
  add column if not exists client_message_id text;

-- Scope: (chapter_id, client_message_id).
--
-- `chat_messages` keys its equivalent index on (channel_id, sender_id, …), but
-- the ledger has neither column — the acting admin is recorded inside
-- `metadata->>'adjusted_by'`, and hanging a uniqueness guarantee off a jsonb
-- expression would be strictly more fragile than chapter-scoping a UUIDv4 that
-- the client already generates per dispatch. Chapter scoping keeps the
-- constraint tenant-local, so one chapter can never collide with another's key.
--
-- Postgres treats NULLs in a unique index as distinct, and the WHERE clause
-- keeps them out of the index altogether, so this constrains retried
-- chat-originated adjustments only.
create unique index if not exists idx_point_transactions_dedupe
  on point_transactions (chapter_id, client_message_id)
  where client_message_id is not null;

-- The comment points at the contract rather than restating it: this rule already
-- has a canonical home, and a copy in the catalog is one nobody updates.
comment on column point_transactions.client_message_id is
  'Client-minted idempotency key (UUIDv4); NULL on every non-chat award path. Contract: spec/behavior/points.md § Anti-Fraud.';
