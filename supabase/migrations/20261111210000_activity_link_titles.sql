-- Link titles on Activity (#4187).
--
-- spec/behavior/activity.md § Links owns the rule. A row on Activity's Links
-- group used to be titled only by its kind ("Google Form", "Google Sheet"),
-- so a page of them all looked the same. The API now reads each link's page
-- title once, in the background, and stores it here; the Activity read only
-- serves what is stored and never fetches.
--
-- 1. `title text`: the page's own name ("5K volunteer shifts"), or null when
--    the page had none worth showing: a private file's sign-in page, a page
--    that names only the product ("Microsoft Forms"), or a fetch that was
--    refused or failed. Null keeps today's row, titled by its kind.
-- 2. `title_checked_at timestamptz`: when the API claimed the link for its one
--    fetch. Null means not tried yet. The sweep claims a link by setting it
--    with a compare-and-set (`where title_checked_at is null`), so two API
--    replicas never fetch the same link, and a claimed link is never fetched
--    again, whatever the result.
-- 3. A partial index on the unchecked rows, which is all the sweep reads.
--
-- No existing row changes: every link starts unchecked, so the sweep reads
-- the titles of the links already indexed (the last 30 days) over its first
-- ticks. The trigger that writes rows (`chat_messages_index_links`) is not
-- touched: a new row takes both columns' null defaults, and an edit that keeps
-- a URL keeps its row, title and all.

alter table public.chat_message_links
  add column if not exists title text,
  add column if not exists title_checked_at timestamptz;

-- The sweep's read: unchecked links, newest first.
create index if not exists idx_chat_message_links_title_unchecked
  on public.chat_message_links (posted_at desc)
  where title_checked_at is null;
