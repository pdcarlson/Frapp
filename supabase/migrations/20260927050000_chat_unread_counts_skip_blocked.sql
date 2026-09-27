-- #2521: a blocked member's messages and @-mentions stop moving the blocker's
-- unread and mention badges.
--
-- spec/behavior/chat/README.md § What a block does and does not hide says that
-- nothing a blocked member sends reaches the blocker. The timeline, the push
-- path and a hidden DM's resurfacing already honour it. The badge did not:
-- `get_channel_unread_counts` counted a blocked member's messages and mentions
-- like anyone else's, so every DM or `@blocker` they sent raised the blocker's
-- channel-row badge, the `@ N` badge and the mobile app-icon badge, and opening
-- the thread showed only tombstones. That is the poke `maskMessage` strips
-- `mentions` to prevent (apps/api/src/application/services/chat-block-mask.ts).
--
-- The fix is one more predicate on the `chat_messages` join: a message whose
-- sender the caller has blocked in this chapter is not unread, so it is not a
-- mention either (mention_count is a subset of the same joined set).
--
-- - It reads only the caller's own block rows (`blocker_user_id = p_user_id`),
--   so it answers nothing the caller does not already know. The blocked
--   member's own counts do not change when someone blocks them: no oracle.
-- - It is scoped to `p_chapter_id`, because blocks are per chapter
--   (20260915210000). A block in another chapter the two share changes nothing
--   here.
-- - A null `sender_id` (an imported row, already excluded; a live null-sender
--   row, still counted) never equals a block row's non-null
--   `blocked_user_id`, so it is unaffected.
-- - It sits in the same statement, so a failed read of the block table fails
--   the whole count rather than degrading to "no blocks", as § The masking
--   contract requires of every block read.
-- - Unblocking restores the counts at once and loses nothing: the read cursor
--   did not move while the block stood, so the messages are still after it.
--
-- The lookup is served by chat_member_blocks' unique constraint, which leads
-- with `(chapter_id, blocker_user_id, blocked_user_id)`. `get_hidden_channel_ids`
-- (20260925200000) uses the same shape for the same rule.
--
-- Everything else about the function is unchanged from 20260823123000: still
-- `stable`, still `security definer` (chat_channels, channel_read_receipts and
-- chat_member_blocks are RLS-enabled with zero policies), still
-- `search_path = public, pg_temp` with pg_temp LAST (20260827190000, #985). Same
-- signature and return type, so no API, SDK or contract change.
--
-- Rollback: re-create the 20260823123000 body. DB_ROLLBACK_PLAYBOOK.md
-- § Rollback skipping blocked senders in unread counts.
create or replace function public.get_channel_unread_counts(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (channel_id uuid, unread_count bigint, mention_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    count(m.id) filter (where m.id is not null),
    count(m.id) filter (where p_user_id = any (m.mentions))
  from chat_channels c
  left join channel_read_receipts r
    on r.channel_id = c.id
   and r.user_id = p_user_id
  left join chat_messages m
    on m.channel_id = c.id
   -- A deleted message is not unread.
   and m.is_deleted = false
   -- An imported archive message is never unread: it is history the chapter is
   -- importing, not a message anyone sent them. Without this a chapter that
   -- imports its Discord history hands every member a five-figure badge they
   -- cannot clear by reading.
   and m.kind <> 'imported'
   -- Your own messages are never unread to you. Without this every send would
   -- light up your own badge until you reopened the channel you just posted in.
   -- `is distinct from` rather than `<>` because sender_id is nullable now; a
   -- null-sender message is nobody's own message, so it counts.
   and m.sender_id is distinct from p_user_id
   -- A message from a member you have blocked in this chapter is not unread,
   -- and so not a mention: nothing a blocked member sends reaches the blocker
   -- (#2521). Only the caller's own block rows are read.
   and not exists (
     select 1
       from chat_member_blocks b
      where b.chapter_id = p_chapter_id
        and b.blocker_user_id = p_user_id
        and b.blocked_user_id = m.sender_id
   )
   -- No receipt means never opened, so everything counts. `-infinity` is what
   -- makes the left join's null cursor behave that way rather than counting zero.
   and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where c.chapter_id = p_chapter_id
  group by c.id;
$$;

-- `create or replace` preserves grants, but re-issuing them keeps this file
-- self-contained if it is ever replayed onto a substrate where the function did
-- not exist. `public` always exists, so its revoke is unguarded; anon /
-- authenticated / service_role are Supabase-managed and absent in bare Postgres
-- (PGlite in CI), so guard each on role existence.
revoke execute on function public.get_channel_unread_counts(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_channel_unread_counts(uuid, uuid) to service_role;
  end if;
end
$$;
