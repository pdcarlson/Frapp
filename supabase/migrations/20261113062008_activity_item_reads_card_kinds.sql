-- Activity unread dots for sign-up and form cards (#3926, step 4).
--
-- Activity's Needs you now lists open sign-up sheets, headcounts and forms a
-- member hasn't answered. Opening one records a read, as opening a poll does,
-- so `activity_item_reads.kind` takes two more values:
--
--   signup   a sign-up sheet or headcount card, by its chat message id
--   form     a form card, by its chat message id
--
-- `ACTIVITY_ITEM_KINDS` in the API is the same list. The constraint was
-- declared inline (20261111220000), so Postgres named it
-- `activity_item_reads_kind_check`. Dropped and re-added in one statement, so
-- no write lands between them with no check in place; every existing row
-- holds an old value, which the new list keeps.

alter table public.activity_item_reads
  drop constraint if exists activity_item_reads_kind_check,
  add constraint activity_item_reads_kind_check
    check (kind in ('task', 'hours_entry', 'poll', 'event', 'link', 'signup', 'form'));
