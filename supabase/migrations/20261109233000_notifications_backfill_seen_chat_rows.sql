-- One-off backfill (#3929): clear chat notifications the member has already
-- seen.
--
-- Since #3788 a channel read (`POST /v1/channels/{id}/read`) marks the
-- reader's chat notifications for that channel read. Rows written before the
-- API that does that was live were never cleared: in production on
-- 2026-11-09 the owner had 17 unread chat rows, 16 of them created before his
-- own read receipt for the same channel, and one naming a channel that had
-- since been deleted and so could never be read at all.
--
-- 1. A chat row its member's read receipt already covers is read, stamped
--    with the receipt's instant (what the API would have written).
-- 2. A chat row whose channel no longer exists is read: there is nothing left
--    to open.
--
-- Rows created after the receipt, and every non-chat row, are untouched.
-- Idempotent: both statements match only `read_at is null`, so a re-run
-- changes nothing. Data only; no schema change. Each statement fires the
-- `notif:<users.id>` change ping once per affected member, which an open
-- client answers with a refetch.

update public.notifications n
set read_at = r.last_read_at
from public.channel_read_receipts r
where n.read_at is null
  and n.data -> 'target' ->> 'screen' = 'chat'
  and r.user_id = n.user_id
  and r.channel_id::text = n.data -> 'target' ->> 'channelId'
  and n.created_at <= r.last_read_at;

update public.notifications n
set read_at = now()
where n.read_at is null
  and n.data -> 'target' ->> 'screen' = 'chat'
  and not exists (
    select 1
    from public.chat_channels c
    where c.id::text = n.data -> 'target' ->> 'channelId'
  );
