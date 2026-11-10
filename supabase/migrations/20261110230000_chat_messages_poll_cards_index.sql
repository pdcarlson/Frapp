-- `GET /v1/activity` (#3897) lists a chapter's newest poll cards: the open
-- ones a member hasn't voted on, and the ones they posted. Both reads filter
-- `chat_messages` on `kind = 'poll'` across every channel of the chapter,
-- newest first. The only indexes on the table lead with `channel_id` or
-- `sender_id`, so without this each Activity load scans the chapter's whole
-- message history, imported archives included, to find a handful of rows.
--
-- Partial on live poll cards, which are a tiny share of messages, so the
-- index stays small and costs an ordinary message insert nothing.
-- Additive: no data change. Plain `create index`, as the other index
-- migrations here: Supabase applies each migration in a transaction, where
-- `concurrently` is refused.
create index if not exists idx_chat_messages_poll_cards
  on public.chat_messages (created_at desc)
  where kind = 'poll' and is_deleted = false;
