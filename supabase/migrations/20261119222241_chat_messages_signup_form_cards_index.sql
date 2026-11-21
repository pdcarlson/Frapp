-- `GET /v1/activity` reads a chapter's newest sign-up sheets and forms
-- (`findCardsByChapter` with kind 'signup' and 'form'), newest first across
-- every channel of the chapter. Polls got their partial index in
-- 20261110230000_chat_messages_poll_cards_index.sql; sign-ups and forms did
-- not, so each Activity load ran two sequential scans of the whole
-- `chat_messages` table, imported Discord archives included (about 45k rows
-- on production on 2026-11-19, 270 ms each when idle and many seconds when an
-- app open is queueing on the same database).
--
-- Partial on live sign-up and form cards, which are a tiny share of messages,
-- so the indexes stay small and cost an ordinary message insert nothing.
-- Additive: no data change. Plain `create index`, as the other index
-- migrations here: Supabase applies each migration in a transaction, where
-- `concurrently` is refused.
create index if not exists idx_chat_messages_signup_cards
  on public.chat_messages (created_at desc)
  where kind = 'signup' and is_deleted = false;

create index if not exists idx_chat_messages_form_cards
  on public.chat_messages (created_at desc)
  where kind = 'form' and is_deleted = false;
