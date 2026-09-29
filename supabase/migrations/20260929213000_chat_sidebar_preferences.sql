-- #2877: each member arranges their own chat sidebar.
--
-- The owner's decision (2026-09-29) gives every member four controls over the
-- channel list: a Pinned section at the top, collapsible groups remembered
-- across devices, and two filters (Unread only, Hide muted). The rule is in
-- spec/behavior/chat/README.md § Sidebar arrangement. The choices are stored
-- on the server so they follow the member between phone and web, the same way
-- notification levels and hidden DMs already do.
--
-- ---------------------------------------------------------------------------
-- 1. Why not `channel_read_receipts`.
--
-- That table already holds one row per (channel, member), and #2303 put
-- `hidden_at` there. A pin does not fit it: `last_read_at` is
-- `not null default now()`, so pinning a channel the member has never opened
-- would create a read cursor at "now" and silently mark the whole channel
-- read. `get_channel_unread_counts` treats a missing cursor as "entirely
-- unread", and a pin must not change that. So pins get their own table.
--
-- ---------------------------------------------------------------------------
-- 2. Per-member view settings: one row per (member, chapter).
--
-- Absent row = every default: filters off, nothing collapsed. The API writes a
-- row only when the member first changes something.
--
-- `collapsed_sections` holds section keys, not ids, because four of the
-- sections are fixed groups with no row of their own: `pinned`, `channels`
-- (the uncategorized default group), `direct` and `system`, plus
-- `category:<uuid>` for a chapter category. The grammar is
-- `isSidebarSectionKey` in @repo/validation, shared by the API and both
-- clients; the API validates every key before it reaches this table, and a
-- `category:` key must name a category in the member's chapter, so the array
-- is bounded by the chapter's own categories. A deleted category leaves its key
-- behind, which matches nothing and costs one short string.
create table if not exists public.chat_sidebar_preferences (
  user_id uuid not null references users(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  unread_only boolean not null default false,
  hide_muted boolean not null default false,
  collapsed_sections text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

-- RLS enabled with ZERO policies, as on channel_read_receipts,
-- chat_message_bookmarks and chat_member_blocks: the API reaches it only with
-- the service-role client, and no client reads it directly. (Not every
-- per-member chat table is shaped this way: chat_notification_preferences
-- carries an own-row SELECT policy. No client reads this table, so it needs
-- none, and adding one would only widen access.)
alter table public.chat_sidebar_preferences enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Pins: one row per (member, channel).
--
-- A table rather than a `uuid[]` on the preferences row, for the foreign key:
-- deleting a channel removes every pin on it through the cascade, where an
-- array would keep the dead id forever. `chapter_id` is denormalized so the
-- one read ("my pins in this chapter") is a single indexed lookup; it is
-- written from the request's chapter after the service has authorized the
-- channel through a chapter-scoped lookup, so a channel from another chapter
-- never reaches this table (the same arrangement as chat_message_bookmarks).
--
-- Pins carry no order of their own. The owner's decision sorts the Pinned
-- section by the member's chosen sort, like every other section.
create table if not exists public.chat_sidebar_pins (
  user_id uuid not null references users(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  channel_id uuid not null references chat_channels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create index if not exists idx_chat_sidebar_pins_user_chapter
  on public.chat_sidebar_pins (user_id, chapter_id);

-- The cascade from chat_channels probes by channel.
create index if not exists idx_chat_sidebar_pins_channel
  on public.chat_sidebar_pins (channel_id);

alter table public.chat_sidebar_pins enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Collapse or expand one section, atomically.
--
-- One statement over the row's own array, so two devices folding different
-- sections at the same moment both land: the upsert's conflict arm locks the
-- row and reads the array as it stands, rather than the API reading it, editing
-- it and writing the whole array back. The same shape as
-- `add_private_channel_member` (20260928170000). Idempotent both ways:
-- collapsing a collapsed key or expanding an expanded one changes nothing.
--
-- `security invoker`, like its siblings: the API calls it with the service-role
-- client, and EXECUTE is locked to service_role below.
create or replace function public.set_chat_sidebar_section_collapsed(
  p_user_id uuid,
  p_chapter_id uuid,
  p_section_key text,
  p_collapsed boolean
)
returns setof public.chat_sidebar_preferences
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.chat_sidebar_preferences as prefs
    (user_id, chapter_id, collapsed_sections)
  values (
    p_user_id,
    p_chapter_id,
    case when p_collapsed then array[p_section_key] else '{}'::text[] end
  )
  on conflict (user_id, chapter_id) do update
    set collapsed_sections = case
          when not p_collapsed
            then array_remove(prefs.collapsed_sections, p_section_key)
          when p_section_key = any(prefs.collapsed_sections)
            then prefs.collapsed_sections
          else array_append(prefs.collapsed_sections, p_section_key)
        end,
        updated_at = now()
  returning *;
$$;

revoke execute on function public.set_chat_sidebar_section_collapsed(uuid, uuid, text, boolean) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.set_chat_sidebar_section_collapsed(uuid, uuid, text, boolean) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.set_chat_sidebar_section_collapsed(uuid, uuid, text, boolean) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_chat_sidebar_section_collapsed(uuid, uuid, text, boolean) to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Teach `anonymize_user` about both tables.
--
-- Both are per-user current state, like chat_notification_preferences and
-- chat_message_bookmarks, which the function already purges. Their own
-- `on delete cascade` from users(id) never fires: account deletion turns the
-- users row into an anonymized tombstone instead of deleting it (FRA-40), so
-- every per-user table needs an explicit line here. Left out, a deleted
-- member's pinned channels (which conversations they kept at the top) would
-- outlive the account.
--
-- Whole function replaced rather than patched, per this repo's convention for
-- `create or replace` RPCs: the body below is 20260915210100's, unchanged apart
-- from the two added deletes. Idempotent and safe to re-run.
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
  -- The seeded "Frapp System" actor (chapter_directory_requests migration) is
  -- not a real account and must never be tombstoned. The API only ever passes
  -- the authenticated caller's own id, so this is defense in depth.
  if p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'anonymize_user: refusing to anonymize the system user'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Lock the row so a concurrent duplicate call serializes behind this one.
  -- No tombstone early-return (see header): a retry re-runs the whole scrub
  -- so PII written onto the tombstone during the retry window is re-scrubbed.
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

  -- Current-state purge (see header). members cascades
  -- member_custom_field_values via its composite FK.
  delete from members where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
  delete from push_tokens where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from notification_preferences where user_id = p_user_id;
  delete from chat_notification_preferences where user_id = p_user_id;
  delete from channel_read_receipts where user_id = p_user_id;
  -- #462: personal chat bookmarks. Added here rather than relying on the
  -- FK's `on delete cascade`, which never fires: this function TOMBSTONES
  -- the users row (see header) instead of deleting it, so a cascade from
  -- users(id) is unreachable by construction. Left out, the tuple set
  -- (user_id, message_id, chapter_id, created_at) -- which is exactly the
  -- "who saved what" that spec/behavior/chat/README.md promises nobody can
  -- see -- would survive account deletion indefinitely.
  delete from chat_message_bookmarks where user_id = p_user_id;
  -- #2257: the member's own block list. Blocker side ONLY -- see the header for
  -- why purging the blocked side would hand the abuser an un-block button.
  delete from chat_member_blocks where blocker_user_id = p_user_id;
  -- #2877: the member's own sidebar arrangement (pins, filters, folds).
  delete from chat_sidebar_preferences where user_id = p_user_id;
  delete from chat_sidebar_pins where user_id = p_user_id;
  -- #494, fixed here (see header): ballots the departing member cast.
  delete from rush_candidate_votes where voter_id = p_user_id;
  delete from study_sessions where user_id = p_user_id;

  -- Display-name snapshots in system-generated cards, both copies at once
  -- (see header). FIRST SUCCESSFUL SCRUB ONLY: the payload predicates are
  -- unindexable, so this is a full scan of chat_messages — and it only ever
  -- needs to run once, because snapshots are historical (with the memberships
  -- gone, no writer can ever attribute a new card to this user, and nothing
  -- rewrites card names back). Re-running it on every retry would let a
  -- client retrying through an auth outage re-scan the table in a loop.
  --
  -- Payload rewrites are keyed on the *_user_id fields the card writers embed
  -- next to each name, so only this user's snapshots change; `payload ||`
  -- preserves every other key, and the CASE arms are no-ops for rows the key
  -- doesn't match.
  --
  -- The `content` rewrite is keyed on each row's OWN payload name snapshot —
  -- not the live display name — so it survives renames (the snapshot is the
  -- exact string the writer embedded in `content`). Only the arms whose
  -- template actually prints the name rewrite content: task content prints
  -- the assignee, points content prints the recipient (assigner/actor names
  -- never appear in content, so those arms leave it alone). The name is
  -- regex-escaped and matched on word boundaries, so a deleted "Ann" cannot
  -- corrupt "Anna", and a whitespace-only name matches nothing. Event cards
  -- carry no payload name at all — their content template is
  -- '<creator> scheduled "<name>" …', written only by EventService as the
  -- sender, so the creator prefix is rewritten structurally (non-greedy:
  -- first ' scheduled "' wins). One statement, one scan.
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

    -- #2257: the report evidence snapshot is a second copy of
    -- chat_messages.content, and the rewrite above does not reach it -- so a
    -- display name this function is scrubbing would survive verbatim in a table
    -- nothing ever purges. Note the exposed party need not be the reporter or
    -- the reported member: a points card names its recipient, so any third
    -- party named in a reported card is affected. Re-sync from the row that was
    -- just rewritten, which is exact rather than a second regex pass.
    --
    -- Scoped to the same rows the statement above touched, so this is not a
    -- table-wide rewrite. RESIDUE, stated rather than hidden: a report whose
    -- message was HARD-deleted has message_id NULL and cannot be re-synced --
    -- its snapshot keeps the pre-scrub name. That is a narrow, deliberate gap
    -- (the chapter erased the message; the moderation record is what is left),
    -- not an oversight. Ordinary message prose is out of scope in both copies:
    -- this scrub only ever rewrote card templates built from payload snapshots,
    -- never member free text, so nothing here widens or narrows that promise.
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

-- Lock EXECUTE to the service role the API uses; AccountDeletionService (via
-- the service-role SUPABASE_CLIENT) is the only legitimate caller. Postgres
-- grants EXECUTE to PUBLIC by default and Supabase additionally grants
-- anon/authenticated, so all three must be revoked. Roles are guarded on
-- existence to keep the migration portable to bare Postgres substrates
-- (e.g. PGlite in CI).
revoke execute on function anonymize_user(uuid, boolean) from public;
revoke execute on function anonymize_card_content(text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function anonymize_user(uuid, boolean) from anon;
    revoke execute on function anonymize_card_content(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function anonymize_user(uuid, boolean) from authenticated;
    revoke execute on function anonymize_card_content(text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function anonymize_user(uuid, boolean) to service_role;
    grant execute on function anonymize_card_content(text, text) to service_role;
  end if;
end
$$;
