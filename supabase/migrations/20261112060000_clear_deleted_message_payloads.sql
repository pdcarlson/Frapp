-- Clear the card data deleted chat messages still hold (#1575).
--
-- spec/behavior/chat/README.md § Edit and delete owns the rule: a delete
-- removes a card's `payload` (an event's name, times and place; a poll's
-- question and options; a task's fields). Until #1575 the delete cleared
-- `content` and `metadata` but left `payload`, so every card deleted before
-- then still holds its data in the row. The API no longer serves it
-- (`redactDeletedMessage`), so this removes it from the database too: an
-- officer's removal of a reported card should remove the reported text, not
-- only hide it.
--
-- WHAT THIS DELETES, and it cannot be undone: the `payload` jsonb of every
-- `chat_messages` row with `is_deleted = true` and a payload, set to null.
-- Nothing else: no row is removed, and `content`, `metadata`, `kind`, ids,
-- times, pins, thread counts, reactions and card responses
-- (`chat_message_actions`) and report snapshots (`chat_message_reports`) are
-- untouched. A live message is never touched.
--
-- No trigger fires: the only update trigger on `chat_messages`
-- (`chat_messages_reindex_links`) is `after update of content, is_deleted,
-- sender_id`. Realtime emits an UPDATE per row to subscribed members, which a
-- client merges into a row it already draws as a tombstone. Idempotent: a
-- second run matches nothing.

update public.chat_messages
set payload = null
where is_deleted
  and payload is not null;
