-- Link titles on Activity (#4187).
--
-- spec/behavior/activity.md § Links owns the rule. A row on Activity's Links
-- group used to be titled only by its kind ("Google Form", "Google Sheet"),
-- so a page of them all looked the same. The API now reads each link's page
-- title in the background and stores it here; the Activity read only serves
-- what is stored and never fetches.
--
-- 1. `title text`: the page's own name ("5K volunteer shifts"), or null when
--    it has none worth showing (a private file's sign-in page, a page that
--    names only the product, "Microsoft Forms"), or has not been read yet.
--    Null keeps today's row, titled by its kind.
-- 2. `title_attempts smallint`: how many times the API has tried to read the
--    page. The sweep claims a link by raising it with a compare-and-set
--    (`where title_attempts = <what it read>`), so two API replicas never read
--    the same link at once. A definite answer (a name, or a page that has
--    none) ends it by setting the count to 3; a read that failed on the way
--    (a timeout, a 5xx, a rate limit, a restart mid-read) leaves it below 3,
--    so the link is tried again later, three times at most.
-- 3. `title_checked_at timestamptz`: when the last try began. A failed read
--    waits an hour from it before the next.
-- 4. A partial index on the links still waiting for a read, which is all the
--    sweep reads.
--
-- No existing row changes: every link starts unread, so the sweep reads the
-- titles of the links already indexed that are still inside Activity's
-- 30-day window over its first ticks. A not-null column with a constant
-- default is metadata-only. The trigger that writes rows
-- (`chat_messages_index_links`) is not touched: a new row takes the columns'
-- defaults, and an edit that keeps a URL keeps its row, title and all.

alter table public.chat_message_links
  add column if not exists title text,
  add column if not exists title_attempts smallint not null default 0,
  add column if not exists title_checked_at timestamptz;

-- The sweep's read: links still waiting for a name, newest first.
create index if not exists idx_chat_message_links_title_pending
  on public.chat_message_links (posted_at desc)
  where title is null and title_attempts < 3;
