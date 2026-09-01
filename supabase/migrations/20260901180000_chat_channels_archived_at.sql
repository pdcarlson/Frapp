-- #348: Group DM leave, per spec/behavior/chat/README.md:47 — "A user can
-- leave a Group DM. If only one member remains, the Group DM is archived."
--
-- Nullable timestamp rather than a boolean, matching the existing soft-state
-- convention on this table's own rows (chat_messages.deleted_at,
-- chat_messages.pinned_at): archived-when the leave endpoint sets it (member
-- count dropped to <= 1), never archived while null. An archived channel is
-- excluded from the active channel list (ChannelAccessService), but stays
-- directly readable by id — leaving twice, or fetching history, still works.
--
-- Only meaningful for GROUP_DM rows; every other channel type never sets it.

alter table chat_channels
  add column if not exists archived_at timestamptz;

-- Atomic leave, in the shape `transfer_presidency` established (FRA-39): the
-- naive app-side read `member_ids`, filter, then `UPDATE ... SET member_ids =
-- $1` is a lost-update race. Two members of the same Group DM leaving at
-- nearly the same time would each compute their target array from the same
-- stale snapshot, and whichever UPDATE commits last silently overwrites the
-- other's removal — leaving a member who received a success response still
-- listed (or, at the 2-member boundary, both removals racing so the archived
-- row is permanently wrong). `/diff-review` caught this in the app-level
-- first pass.
--
-- `set member_ids = array_remove(member_ids, p_user_id)` referencing the
-- table's own column directly (not a value computed by a prior SELECT/CTE) is
-- what makes this safe: Postgres takes the row lock for the UPDATE, and a
-- concurrent caller blocked on that lock re-evaluates this expression against
-- the just-committed row once it acquires the lock (EvalPlanQual), giving
-- true read-modify-write serialization per row — the same property
-- `array_remove(role_ids, ...)` relies on in `transfer_presidency`.
--
-- `security invoker` matches the sibling atomic RPCs: the API always calls
-- this via the service-role SUPABASE_CLIENT, which bypasses RLS, and EXECUTE
-- is locked to service_role below.
create or replace function leave_group_dm(
  p_channel_id uuid,
  p_chapter_id uuid,
  p_user_id uuid
)
returns setof chat_channels
language sql
security invoker
as $$
  update chat_channels
     set member_ids = array_remove(member_ids, p_user_id),
         -- array_length() of an empty array is NULL, not 0 — coalesce it so
         -- the last member leaving (member_ids = '{}') still archives.
         archived_at = case
           when coalesce(array_length(array_remove(member_ids, p_user_id), 1), 0) <= 1
             then now()
           else archived_at
         end
   where id = p_channel_id
     and chapter_id = p_chapter_id
     and type = 'GROUP_DM'
  returning *;
$$;

revoke execute on function leave_group_dm(uuid, uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function leave_group_dm(uuid, uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function leave_group_dm(uuid, uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function leave_group_dm(uuid, uuid, uuid) to service_role;
  end if;
end
$$;
