-- Clear the card data deleted chat messages still hold (#1575).
--
-- spec/behavior/chat/README.md § Edit and delete owns the rule: a delete
-- removes a card's `payload` (an event's name, times and place; a poll's
-- question and options; a task's fields). Until #1575 the delete cleared
-- `content` and `metadata` but left `payload`, so every card deleted before
-- then still holds its data in the row, readable by any member of the
-- channel straight from `chat_messages` under its read policy, which does not
-- filter `is_deleted`. This removes it from the database: an officer's removal
-- of a reported card should remove the reported text, not only hide it.
--
-- ORDER: merge only with or after #4421, the API change that makes every
-- delete clear `payload` and stops the API serving it. This runs once; merged
-- first, every card deleted before #4421 deploys would keep its data.
--
-- WHAT THIS DELETES, and it cannot be undone: the `payload` jsonb of every
-- `chat_messages` row with `is_deleted = true`, the shape a delete writes
-- since #4421 (`tombstonePayload` in apps/api/src/application/services/
-- chat-block-mask.ts; the two must stay in step):
--
-- - every card and other non-imported kind: set to null;
-- - an imported Discord row (`kind = 'imported'`), whose payload is the
--   archive sidecar rather than a card: cut down to `source` and
--   `author_username`, the handle the operator import backfills read
--   (`backfill-discord-mention-tokens.ts`). Its reactions, sticker names and
--   the rest go.
--
-- Nothing else: no row is removed, and `content`, `metadata`, `kind`, ids,
-- times, pins, thread counts, reactions and card responses
-- (`chat_message_actions`) and report snapshots (`chat_message_reports`) are
-- untouched. A live message is never touched. Tested against seeded rows by
-- scripts/pglite/tiers/clear-deleted-message-payloads.mjs.
--
-- No trigger fires: the only update trigger on `chat_messages`
-- (`chat_messages_reindex_links`) is `after update of content, is_deleted,
-- sender_id`. Realtime emits an UPDATE per row to subscribed members, which a
-- client merges into a row it already draws as a tombstone. Idempotent: a
-- second run matches nothing.

update public.chat_messages
set payload = null
where is_deleted
  and kind <> 'imported'
  and payload is not null;

update public.chat_messages
set payload = jsonb_strip_nulls(jsonb_build_object(
  'source', 'discord',
  'author_username', payload->'author_username'
))
where is_deleted
  and kind = 'imported'
  and payload is not null
  and payload - array['source', 'author_username'] <> '{}'::jsonb;
