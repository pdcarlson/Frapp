-- Origin channel for chat-originated point adjustments (#1734)
--
-- `POST /v1/points/adjust` posts a `kind:"points"` card best-effort after the
-- ledger row commits. The card's chat-side dedupe is
-- `idx_chat_messages_dedupe` on `(channel_id, sender_id, client_message_id)`,
-- not by key alone. Until this column existed the ledger row recorded the key
-- but not the channel, so a replay could not prove it named the channel the
-- original card went to. Re-posting was therefore unsafe: a caller sending a
-- byte-identical body with a different `channel_id` would get a second audit
-- card for one ledger row (a FINE re-broadcast to a wider audience).
--
-- Recording the origin channel lets a replay (or a later repair) target the
-- stored channel rather than the one the request names. Do not "fix" this by
-- widening `idx_chat_messages_dedupe` — that index is load-bearing for
-- ordinary chat sends, where two messages from one author in different
-- channels legitimately share nothing.
--
-- Additive and safe to replay:
--   * the column is NULLABLE, so all existing rows stay valid and no backfill
--     is needed (a NULL origin cannot be healed; the card stays lost);
--   * dashboard adjustments send no channel and write NULL, same as they write
--     NULL `client_message_id`;
--   * ON DELETE SET NULL: deleting a channel must not delete ledger rows.
--
-- Contract: spec/behavior/points.md § Anti-Fraud.

alter table point_transactions
  add column if not exists channel_id uuid
    references chat_channels (id) on delete set null;

-- A channel without a key would be an origin we cannot match to a card.
-- The inverse (a key with no channel) is the pre-this-migration shape and
-- must stay legal.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'point_transactions_channel_id_requires_key'
  ) then
    alter table point_transactions
      add constraint point_transactions_channel_id_requires_key
      check (channel_id is null or client_message_id is not null);
  end if;
end $$;

comment on column point_transactions.channel_id is
  'Origin chat channel for a chat-originated adjustment; NULL on every non-chat award path. Contract: spec/behavior/points.md § Anti-Fraud.';
