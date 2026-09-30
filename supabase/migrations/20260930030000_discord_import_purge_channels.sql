-- Deleting a Discord import also deletes the channels it created, once they
-- hold nothing (#2905).
--
-- The purge removed an import's messages and archive objects but left every
-- channel the import had created, now empty. A re-import of the same server
-- then met each leftover again. A bot scan merged into a public one by default
-- (#2856). A channel that was private in Discord, or any channel from an
-- upload (which says nothing about privacy), came back as a name clash the
-- admin had to resolve by hand, or, when the leftover was hidden from the admin
-- (#2799), as a second, like-named channel. Staging's first full import
-- created 59 channels, 57 of them ROLE_GATED.
--
-- 1. `discord_import_created_channels` records each channel the worker
--    creates for an import. The mapping rows can't be that record. Remapping
--    or rescanning a failed import rewrites them (`replaceChannels`) with no
--    target, so a channel its first run made would be forgotten. And an
--    upload mapped before #2859 could carry a `create_new` row naming a
--    channel that already existed.
--
-- 2. `delete_empty_discord_import_channels` runs after the purge has deleted
--    the import's messages. Its candidates are the channels this import
--    created: the ones recorded in (1), plus, for an import that ran before
--    (1) existed, each `create_new` row's target that was created no earlier
--    than the import and still carries the description the worker gives a
--    channel it creates ("Imported from Discord #<name>"). Age alone isn't
--    enough: the import row is written before mapping, so a legacy row could
--    name a channel made in between. Both together keep an officer's own
--    channel out; a created channel whose description an officer has since
--    changed is kept, which errs the safe way. It deletes a candidate only
--    when all of these hold:
--
--      - it holds no message of any kind: no live message, no deleted one, no
--        other import's rows, and no `[message deleted]` tombstone;
--      - it holds no attachment row;
--      - no points-ledger row points at it. `point_transactions.channel_id` is
--        where a chat points card whose post failed is re-posted from, so a
--        channel with one is not empty;
--      - no `use_existing` mapping row of any import, this one included,
--        points at it. The `discord_import_channels_target_present` CHECK
--        keeps such a row's target non-null, so the `on delete set null` on
--        `target_channel_id` would fail the delete. #2922 tracks letting that
--        go. Until then a channel another import merged into stays, even once
--        that import is purged too, and so does one this import's own
--        remapped rows merged into (reachable only through the API: the web
--        wizard never remaps a failed import).
--
--    Each candidate is checked once without a lock, so a channel it keeps is
--    never locked, then locked and checked again before the delete. A message
--    being sent into it holds a key-share lock on the channel until that
--    insert commits, so the `for update` waits for it, and the second check,
--    a new statement in read committed, sees the message and keeps the
--    channel. A send that starts after the lock waits instead, then fails its
--    foreign key once the channel is gone, like a send into any channel an
--    officer deletes. The PGlite check runs on one connection and can't
--    exercise this; it was proved with two sessions against the local stack
--    when this shipped (PR #2926), and #2928 tracks an automated check.
--
--    Deleting the channel cascades what hangs off it as
--    `DELETE /v1/channels/:id` does: its read receipts, its sidebar pins and
--    its row in (1). The import's mapping rows keep their record with
--    `target_channel_id` set to null. The roles and read permissions the
--    import created stay, as spec/behavior/chat/README.md § Imported archive
--    messages says.
--
--    Returns the ids it deleted, so the worker can evict them from the channel
--    cache. Does nothing unless the import is being purged, so a running
--    import can never lose a channel it has just created and not yet written
--    to.
--
-- 3. Two partial indexes the checks and the delete's `on delete set null`
--    actions lean on, which nothing covered: `point_transactions
--    (channel_id)` and `discord_import_channels (target_channel_id)`. Both
--    tables are small today; without them one purge scans each once per
--    channel, and so does an officer's `DELETE /v1/channels/:id`.
--
-- Service role only, like the other Discord import functions. The table has
-- RLS on and no policies.

-- ---------------------------------------------------------------------------
-- 1. What each import created.
create table if not exists public.discord_import_created_channels (
  import_id  uuid not null references public.discord_imports(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (import_id, channel_id)
);

-- The primary key serves lookups by import; this serves the cascade when a
-- channel is deleted.
create index if not exists idx_discord_import_created_channels_channel
  on public.discord_import_created_channels (channel_id);

alter table public.discord_import_created_channels enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Indexes the checks and the `on delete set null` actions lean on.
create index if not exists idx_point_transactions_channel
  on public.point_transactions (channel_id)
  where channel_id is not null;

create index if not exists idx_discord_import_channels_target
  on public.discord_import_channels (target_channel_id)
  where target_channel_id is not null;

-- ---------------------------------------------------------------------------
-- 2a. Whether a channel holds anything the purge must keep. One definition
--     for the check before the lock and the check under it.
create or replace function public.discord_import_channel_holds_anything(
  p_channel_id uuid,
  p_chapter_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from chat_messages where channel_id = p_channel_id)
      or exists (select 1 from chat_message_attachments where channel_id = p_channel_id)
      or exists (
        select 1
          from point_transactions
         where chapter_id = p_chapter_id
           and channel_id = p_channel_id
      )
      or exists (
        select 1
          from discord_import_channels
         where target_channel_id = p_channel_id
           and mapping_action = 'use_existing'
      );
$$;

-- ---------------------------------------------------------------------------
-- 2. The purge's channel step.
create or replace function public.delete_empty_discord_import_channels(
  p_import_id uuid,
  p_chapter_id uuid
)
returns setof uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_channel uuid;
begin
  if not exists (
    select 1
      from discord_imports
     where id = p_import_id
       and chapter_id = p_chapter_id
       and status = 'purging'
  ) then
    return;
  end if;

  for v_channel in
    select c.id
      from chat_channels c
     where c.chapter_id = p_chapter_id
       and (
         exists (
           select 1
             from discord_import_created_channels r
            where r.import_id = p_import_id
              and r.channel_id = c.id
         )
         or exists (
           select 1
             from discord_import_channels m
             join discord_imports i on i.id = m.import_id
            where m.import_id = p_import_id
              and m.mapping_action = 'create_new'
              and m.target_channel_id = c.id
              and c.created_at >= i.created_at
              and c.description = 'Imported from Discord #' || m.discord_channel_name
         )
       )
     order by c.id
  loop
    -- Unlocked first, so a channel that is kept is never locked.
    if public.discord_import_channel_holds_anything(v_channel, p_chapter_id) then
      continue;
    end if;

    perform 1
       from chat_channels
      where id = v_channel
        and chapter_id = p_chapter_id
        for update;
    if not found then
      continue;
    end if;

    -- Again under the lock: a send that committed meanwhile is seen here.
    if public.discord_import_channel_holds_anything(v_channel, p_chapter_id) then
      continue;
    end if;

    delete from chat_channels where id = v_channel and chapter_id = p_chapter_id;
    return next v_channel;
  end loop;
end;
$$;

revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from public;
revoke execute on function public.discord_import_channel_holds_anything(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from anon;
    revoke execute on function public.discord_import_channel_holds_anything(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from authenticated;
    revoke execute on function public.discord_import_channel_holds_anything(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_empty_discord_import_channels(uuid, uuid) to service_role;
    grant execute on function public.discord_import_channel_holds_anything(uuid, uuid) to service_role;
  end if;
end
$$;
