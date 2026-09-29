-- Linking imported Discord authors to Frapp members (#2878).
--
-- An imported message names its author with `author_name` and the author's
-- Discord snowflake in `author_external_id`, and carries `sender_id = null`
-- (`20260823120000_chat_message_authors.sql`). After a chapter moves off
-- Discord, that makes a member's own years of history read like a stranger's.
--
-- OWNER DECISIONS (Paul, 2026-09-29), recorded in spec/behavior/chat/README.md
-- § Imported archive messages:
--
--  1. **A member links themselves.** They sign in to Discord (OAuth `identify`,
--     nothing else) from their profile, which proves the account is theirs.
--     No officer can attach somebody else's words to a member. The callback
--     parks what Discord said and the member's own chapter-scoped session
--     confirms it, exactly as the bot connect flow does
--     (`20260824150000_discord_connect_confirm.sql`), because the callback is
--     an unauthenticated redirect and whoever completes the Discord screen need
--     not be whoever started it.
--  2. **Linking rewrites `sender_id`** on that author's imported rows in the
--     chapter, rather than resolving a second "effective sender" at read time.
--     Block masking, the shared client classifier, reply quotes, reports and
--     "own message" all key on `sender_id` in about ten places, server and
--     client; a second identity column would have to be threaded through every
--     one, and missing one leaks a block. `author_name`, `author_external_id`
--     and `author_avatar_path` are left on the row, so an unlink can put the
--     row back exactly as it was imported.
--  3. The linked member may delete those messages but not edit them. That is
--     enforced in `ChatService.editMessage`, not here.
--
-- Every statement is guarded, so the file is re-runnable (`db push --local` is
-- treated as idempotent -- AGENTS.md § Gotchas).

-- ---------------------------------------------------------------------------
-- 1. The link.
--
-- Scoped to one chapter, never global. A member of two chapters links in each
-- separately, and a Discord id linked in one chapter says nothing to another:
-- there is no `users.discord_user_id`, on purpose, because a global column
-- would let a link made in chapter A attach chapter B's history without anyone
-- in B consenting, and would put a Discord identity on a row every chapter the
-- user joins can reach.
--
-- Unique both ways within a chapter:
--   (chapter_id, discord_user_id) -- one Discord author is one member. The
--       tenant-safety constraint: without it two members could each claim the
--       same history.
--   (chapter_id, user_id) -- one member links one Discord account. Linking a
--       different account replaces the first (`link_discord_author` below).
create table if not exists public.discord_author_links (
  id               uuid primary key default gen_random_uuid(),
  chapter_id       uuid not null references public.chapters(id) on delete cascade,
  -- Text, like every snowflake in this schema: they exceed 2^53.
  discord_user_id  text not null,
  -- The member it attaches to. CASCADE is belt-and-braces: `users` rows are
  -- tombstoned rather than deleted, and `anonymize_user` deletes the link
  -- itself (section 5).
  user_id          uuid not null references public.users(id) on delete cascade,
  -- What Discord called the account when it was linked, so the profile can say
  -- "Linked as jkslayer". Display only; nothing authorizes on it.
  discord_username text,
  linked_at        timestamptz not null default now(),
  constraint discord_author_links_chapter_discord_unique unique (chapter_id, discord_user_id),
  constraint discord_author_links_chapter_user_unique unique (chapter_id, user_id)
);

-- Default-deny, like every table in this feature. The API reaches it with the
-- service-role key. A client-readable policy would publish every member's
-- Discord id to anyone who can craft a PostgREST query.
alter table public.discord_author_links enable row level security;

-- ---------------------------------------------------------------------------
-- 2. One OAuth state table, two purposes.
--
-- The link flow reuses `discord_oauth_states` and the one callback URL
-- (`/v1/discord/connect/callback`), because Discord only redirects to URIs
-- registered by hand in its Developer Portal; a second callback path would be
-- a manual portal change per environment, and `DiscordApplicationCheck`
-- withdraws the whole integration while one is missing. `purpose` is what the
-- callback dispatches on, and each confirm route consumes only its own
-- purpose, so a link handshake can never activate a guild connection or the
-- other way round.
alter table public.discord_oauth_states
  add column if not exists purpose text not null default 'connect';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'discord_oauth_states_purpose_check'
  ) then
    alter table public.discord_oauth_states
      add constraint discord_oauth_states_purpose_check
      check (purpose in ('connect', 'author_link'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. One lock per chapter's links.
--
-- Linking attaches the rows that exist when it runs, and the importer may be
-- writing more of the same author's rows at that moment. Without a lock, a row
-- inserted after the trigger in section 4 read "no link" but before the link's
-- UPDATE took its snapshot would stay unattached forever. The link and unlink
-- functions take this key exclusively; the insert trigger takes it shared, so
-- concurrent import batches never wait on each other, only on a link change in
-- the same chapter. Transaction-scoped, so nothing can leak it.
create or replace function public.discord_author_link_lock_key(p_chapter_id uuid)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select hashtextextended('discord_author_links:' || p_chapter_id::text, 0);
$$;

-- ---------------------------------------------------------------------------
-- 4. Imported rows are born attached.
--
-- A link made before (or during) an import must apply to what the import
-- writes, whichever path wrote it: the upload worker and the bot worker share
-- one insert (`SupabaseDiscordImportRepository.insertMessages`), and a
-- database trigger covers both without either having to remember. The WHEN
-- clause keeps it off the live hot path entirely: an ordinary send never
-- enters the function.
create or replace function public.chat_messages_attach_linked_author()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_chapter_id uuid;
  v_user_id uuid;
begin
  if new.sender_id is not null or new.author_external_id is null then
    return new;
  end if;

  select c.chapter_id into v_chapter_id
    from chat_channels c
   where c.id = new.channel_id;
  if v_chapter_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock_shared(discord_author_link_lock_key(v_chapter_id));

  select l.user_id into v_user_id
    from discord_author_links l
   where l.chapter_id = v_chapter_id
     and l.discord_user_id = new.author_external_id;

  if v_user_id is not null then
    new.sender_id := v_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_attach_linked_author on public.chat_messages;
create trigger trg_chat_messages_attach_linked_author
  before insert on public.chat_messages
  for each row
  when (new.kind = 'imported')
  execute function public.chat_messages_attach_linked_author();

-- ---------------------------------------------------------------------------
-- 5. Link and unlink.
--
-- One function each, so the link row and the rows it attaches change in one
-- transaction: a link that exists with its history unattached, or history
-- attached to a link that was rolled back, is never visible.
--
-- Every UPDATE is scoped three ways, and all three are load-bearing:
--   * `channel_id in (this chapter's channels)` -- the tenant boundary.
--     `chat_messages` has no chapter_id; the chapter is reached through the
--     channel, and a Discord id linked in one chapter must not touch another
--     chapter's archive, even one imported from the same Discord server.
--   * `kind = 'imported'` -- only archive rows. A live row never carries
--     `author_external_id`, but this is the statement that would rewrite
--     authorship if one ever did.
--   * the author's Discord id (and, to detach, the member's own id).
--
-- `idx_chat_messages_author_external` (`20260823120000`) serves the author
-- predicate; this is its first reader.

-- Returns the link as stored plus how many messages it attached.
-- Raises 23505 (unique_violation) when the Discord account is already linked
-- to a different member of this chapter, and 42501 (insufficient_privilege)
-- when the user is not a member of the chapter. The API maps both.
create or replace function public.link_discord_author(
  p_chapter_id uuid,
  p_user_id uuid,
  p_discord_user_id text,
  p_discord_username text
)
returns table (
  discord_user_id text,
  discord_username text,
  linked_at timestamptz,
  messages_linked integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing discord_author_links;
  v_link discord_author_links;
  v_count integer;
begin
  if p_discord_user_id is null or length(p_discord_user_id) = 0 then
    raise exception 'link_discord_author: a Discord user id is required'
      using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(discord_author_link_lock_key(p_chapter_id));

  -- Defence in depth: the API only calls this for a member of the chapter
  -- whose request is scoped to it, but a link for a non-member would attach a
  -- chapter's history to someone outside it.
  if not exists (
    select 1 from members m
     where m.chapter_id = p_chapter_id and m.user_id = p_user_id
  ) then
    raise exception 'link_discord_author: user is not a member of this chapter'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from discord_author_links l
     where l.chapter_id = p_chapter_id
       and l.discord_user_id = p_discord_user_id
       and l.user_id <> p_user_id
  ) then
    raise exception 'link_discord_author: this Discord account is linked to another member'
      using errcode = 'unique_violation';
  end if;

  -- Linking a different account replaces the first: detach what it attached.
  select * into v_existing
    from discord_author_links l
   where l.chapter_id = p_chapter_id and l.user_id = p_user_id;
  if found and v_existing.discord_user_id <> p_discord_user_id then
    update chat_messages m
       set sender_id = null
     where m.kind = 'imported'
       and m.sender_id = p_user_id
       and m.author_external_id = v_existing.discord_user_id
       and m.channel_id in (
         select c.id from chat_channels c where c.chapter_id = p_chapter_id
       );
    delete from discord_author_links l where l.id = v_existing.id;
  end if;

  insert into discord_author_links as l
    (chapter_id, user_id, discord_user_id, discord_username)
  values (p_chapter_id, p_user_id, p_discord_user_id, p_discord_username)
  on conflict on constraint discord_author_links_chapter_user_unique do update
    set discord_username = excluded.discord_username
  returning * into v_link;

  -- `sender_id is null` makes a re-link of the same account idempotent and
  -- never takes a row from anyone: the only way an imported row has a sender
  -- is this function, and the unique constraint above means that sender is
  -- this member.
  update chat_messages m
     set sender_id = p_user_id
   where m.kind = 'imported'
     and m.sender_id is null
     and m.author_external_id = p_discord_user_id
     and m.channel_id in (
       select c.id from chat_channels c where c.chapter_id = p_chapter_id
     );
  get diagnostics v_count = row_count;

  return query select v_link.discord_user_id, v_link.discord_username, v_link.linked_at, v_count;
end;
$$;

-- Returns how many messages went back to their Discord name, or null when the
-- member had no link in this chapter. Rows the member deleted stay deleted:
-- a soft delete blanks the content, and unlinking does not bring it back.
create or replace function public.unlink_discord_author(
  p_chapter_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_link discord_author_links;
  v_count integer;
begin
  perform pg_advisory_xact_lock(discord_author_link_lock_key(p_chapter_id));

  select * into v_link
    from discord_author_links l
   where l.chapter_id = p_chapter_id and l.user_id = p_user_id;
  if not found then
    return null;
  end if;

  -- `chat_messages_author_present` needs `author_name` on a row with no
  -- sender. The importer always writes one ('Unknown Discord user' at worst),
  -- and only account deletion clears it, which deletes the link first.
  update chat_messages m
     set sender_id = null
   where m.kind = 'imported'
     and m.sender_id = p_user_id
     and m.author_external_id = v_link.discord_user_id
     and m.channel_id in (
       select c.id from chat_channels c where c.chapter_id = p_chapter_id
     );
  get diagnostics v_count = row_count;

  delete from discord_author_links l where l.id = v_link.id;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Account deletion.
--
-- `anonymize_user` tombstones the `users` row so history renders as "Deleted
-- User". A linked member's imported rows would defeat that: every client falls
-- back to `author_name` when the roster misses (`resolveAuthorName` in
-- `packages/hooks/src/display-names.ts`), and a deleted member is not on the
-- roster, so their Discord handle -- and their Discord avatar and id -- would
-- come straight back, re-identifying them. So deletion clears the Discord
-- snapshot on the rows it attributes to them, and deletes their links.
--
-- The rows stay (their sender is the tombstone, exactly like their live
-- messages), which is why the snapshot can go: nothing needs it to satisfy
-- `chat_messages_author_present` once `sender_id` is set. Moderation reports
-- keep their own snapshot, per data-retention.md.
--
-- Redefined in full from `20260915210100_anonymize_user_purge_chat_blocks.sql`;
-- the only change is the block marked #2878.
create or replace function anonymize_user(
  p_user_id uuid,
  p_rescan_cards boolean default false
)
returns setof users
language plpgsql
security invoker
as $$
declare
  v_user users;
  v_was_tombstoned boolean;
begin
  if p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'anonymize_user: refusing to anonymize the system user'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_user from users where id = p_user_id for update;
  if not found then
    return; -- unknown user: empty result, the API maps this to 404
  end if;

  v_was_tombstoned := v_user.deleted_at is not null;

  update users
     set email = 'deleted+' || p_user_id::text || '@anonymized.invalid',
         display_name = 'Deleted User',
         avatar_url = null,
         bio = null,
         graduation_year = null,
         current_city = null,
         current_company = null,
         active_chapter_id = null,
         deleted_at = coalesce(v_user.deleted_at, now())
   where id = p_user_id
   returning * into v_user;

  delete from members where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
  delete from push_tokens where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from notification_preferences where user_id = p_user_id;
  delete from chat_notification_preferences where user_id = p_user_id;
  delete from channel_read_receipts where user_id = p_user_id;
  delete from chat_message_bookmarks where user_id = p_user_id;
  delete from chat_member_blocks where blocker_user_id = p_user_id;
  delete from rush_candidate_votes where voter_id = p_user_id;
  delete from study_sessions where user_id = p_user_id;

  -- #2878: the Discord identity on imported rows attributed to this member.
  -- Unconditional (not under the rescan gate below): it is idempotent, and a
  -- retry after a link made before this migration must still reach it.
  update chat_messages
     set author_name = null,
         author_avatar_path = null,
         author_external_id = null,
         payload = case
           when payload ? 'author_username' then payload - 'author_username'
           else payload
         end
   where kind = 'imported'
     and sender_id = p_user_id
     and (author_name is not null
       or author_avatar_path is not null
       or author_external_id is not null
       or payload ? 'author_username');
  delete from discord_author_links where user_id = p_user_id;

  if not v_was_tombstoned or p_rescan_cards then
    update chat_messages
       set payload = case
             when payload is null then payload
             else payload
               || case when kind = 'task' and payload->>'assigner_user_id' = p_user_id::text
                       then jsonb_build_object('assigner_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
                       then jsonb_build_object('assignee_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'actor_user_id' = p_user_id::text
                       then jsonb_build_object('actor_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
                       then jsonb_build_object('recipient_name', 'Deleted User')
                       else '{}'::jsonb end
           end,
           content = case
             when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'assignee_name')
             when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'recipient_name')
             when kind = 'event' and sender_id = p_user_id
               then regexp_replace(content, '^(.*?)( scheduled ")', 'Deleted User\2')
             else content
           end
     where (kind = 'task' and (payload->>'assigner_user_id' = p_user_id::text
                            or payload->>'assignee_user_id' = p_user_id::text))
        or (kind = 'points' and (payload->>'actor_user_id' = p_user_id::text
                              or payload->>'recipient_user_id' = p_user_id::text))
        or (kind = 'event' and sender_id = p_user_id);

    update chat_message_reports r
       set reported_content = m.content
      from chat_messages m
     where r.message_id = m.id
       and ((m.kind = 'task' and (m.payload->>'assigner_user_id' = p_user_id::text
                               or m.payload->>'assignee_user_id' = p_user_id::text))
         or (m.kind = 'points' and (m.payload->>'actor_user_id' = p_user_id::text
                                 or m.payload->>'recipient_user_id' = p_user_id::text))
         or (m.kind = 'event' and m.sender_id = p_user_id));
  end if;

  return next v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants: service role only, like `anonymize_user`.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so each is revoked
-- explicitly; otherwise any signed-in client could call `link_discord_author`
-- over PostgREST with an arbitrary user id and Discord id, which is the whole
-- attack the OAuth proof exists to stop.
revoke execute on function public.link_discord_author(uuid, uuid, text, text) from public;
revoke execute on function public.unlink_discord_author(uuid, uuid) from public;
revoke execute on function public.chat_messages_attach_linked_author() from public;
revoke execute on function public.discord_author_link_lock_key(uuid) from public;
revoke execute on function anonymize_user(uuid, boolean) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.link_discord_author(uuid, uuid, text, text) from anon;
    revoke execute on function public.unlink_discord_author(uuid, uuid) from anon;
    revoke execute on function public.discord_author_link_lock_key(uuid) from anon;
    revoke execute on function anonymize_user(uuid, boolean) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.link_discord_author(uuid, uuid, text, text) from authenticated;
    revoke execute on function public.unlink_discord_author(uuid, uuid) from authenticated;
    revoke execute on function public.discord_author_link_lock_key(uuid) from authenticated;
    revoke execute on function anonymize_user(uuid, boolean) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.link_discord_author(uuid, uuid, text, text) to service_role;
    grant execute on function public.unlink_discord_author(uuid, uuid) to service_role;
    grant execute on function public.discord_author_link_lock_key(uuid) to service_role;
    grant execute on function anonymize_user(uuid, boolean) to service_role;
  end if;
end
$$;
