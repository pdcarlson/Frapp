-- Always formal: a channel-level display lock (#3787, slice 2).
--
-- spec/behavior/chat/README.md § Chat density → Always formal owns the rule.
-- A member's chat display (cozy, compact or bubbles) is a per-device
-- preference with a per-channel override, both kept on the device. A channel
-- set to Always formal draws the formal (cozy) layout for every member,
-- whatever they picked, and members can't override it there.
--
-- Additive only:
--
-- 1. `chat_channels.display_locked` (boolean, not null, default false). Every
--    existing channel reads as unlocked, so nothing changes until someone
--    turns it on.
-- 2. `chat_channels.created_by` (nullable, FK to `users (id)`, on delete set
--    null). Winston's decision on #3787 lets the channel's creator set the
--    lock as well as anyone with `channels:manage`, and nothing recorded the
--    creator before. Existing channels, seeded defaults and Discord-imported
--    channels have none, so only `channels:manage` can lock them. Account
--    deletion tombstones the `users` row in place (`anonymize_user`), so the
--    `on delete set null` covers only a hard delete of the row, which no
--    product path does.
--
-- `chat_channels` has RLS on and no policies (API only, service role), so no
-- client can write either column directly.

alter table public.chat_channels
  add column if not exists display_locked boolean not null default false,
  add column if not exists created_by uuid;

-- `not valid`, then validated, the shape the other foreign keys added to
-- existing tables use. Every existing row is null, so validation scans
-- nothing it can reject, and `chat_channels` is small.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_channels_created_by_fk'
  ) then
    alter table public.chat_channels
      add constraint chat_channels_created_by_fk
      foreign key (created_by) references public.users (id)
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.chat_channels validate constraint chat_channels_created_by_fk;
