-- `#chapter-audit` entries stop moving unread badges (owner decision
-- 2026-11-06: audit entries are delivered silently).
--
-- spec/behavior/chat/README.md § Read Receipts lists what never counts as
-- unread. The audit mirror (`ChatBridgeWorkerService`, ADR-08) posts every
-- member-visible `chapter_audit_log` row into `#chapter-audit` as a
-- `system_audit` message from the system sender. Push refuses a mirror row
-- (`decidePush` in `push-rules.ts`), but `get_channel_unread_counts` counted it like any other
-- message, so each settings save lit a badge on the channel row, its section
-- header and the mobile app-icon badge.
--
-- The fix is one more predicate on the `chat_messages` join. A mirror entry is
-- recognised by its idempotency key, `client_message_id = 'audit:<id>'`
-- (`auditMirrorClientId` in chat-bridge-worker.service.ts), which no member
-- send can carry (a client id is a bare UUID, and `system_audit` is a
-- server-only kind). The server's other `system_audit` notices, which are
-- addressed to members, keep counting. `coalesce` because the column is
-- nullable: a null key is not a mirror entry, and `null like ...` would drop
-- the row from the count by accident.
--
-- Everything else is unchanged from 20260927050000: same signature and return
-- type, still `stable`, `security definer`, `search_path = public, pg_temp`,
-- and the same grants, so no API, SDK or contract change.
--
-- Rollback: re-create the 20260927050000 body. db-rollback-playbook.md
-- § Rollback silent audit entries in unread counts.
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
   -- A `#chapter-audit` entry is not unread (2026-11-06): it is a log line the
   -- audit mirror writes, not a message to anyone, so it arrives silently, as
   -- it does for push. The mirror keys every entry
   -- `client_message_id = 'audit:<audit id>'` (`auditMirrorClientId`); the
   -- server's other `system_audit` notices (a poll closing, an invite
   -- accepted, the welcome) carry no such key and still count.
   and not (
     m.kind = 'system_audit'
     and coalesce(m.client_message_id, '') like 'audit:%'
   )
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
