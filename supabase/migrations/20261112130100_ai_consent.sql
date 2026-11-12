-- AI consent (#4308; ADR-28 decision 5, spec/behavior/ai.md § Consent).
--
-- Two of the three gates between Frapp's data and a model. The API checks
-- both on every AI call, in the gateway's consent seam
-- (`AiConsentService.check`), so nothing here is read by a client.
--
-- 1. `chapter_ai_settings`: the president's switches, one per feature family
--    (Ask, meeting notes, chat as a source). One row per chapter, written the
--    first time the president changes a switch. No row, or a false column,
--    is off, so every chapter starts with every family off and this file
--    writes no row.
-- 2. `user_ai_consents`: each person's answer on the AI sheet, one
--    current-state row per person per sheet version, with a real No
--    (`accepted = false`). The sheet's version and contents live in the API
--    (`AI_CONSENT_SHEET`), as the Terms version does, so a store binary never
--    disagrees with the server about which sheet is current. Only a row for
--    the current version counts: a person with no row for it has not
--    answered, which counts as No, so a new version makes every earlier Yes
--    stale and asks everyone again. Rows for older versions are kept as the
--    record of what the person agreed to then. The answer is the person's,
--    not the chapter's: one Yes covers every chapter they belong to, as it
--    names the same providers and the same kinds of data.
-- 3. `anonymize_user` deletes the person's consent rows. Deleting an account
--    counts as turning AI off.
--
-- Both tables have RLS on and no policies: the API reads and writes them
-- with the service role.
--
-- Locks. The foreign keys add triggers to `chapters` and `users`, taking a
-- SHARE ROW EXCLUSIVE lock on each until commit: from there, writes to
-- `users` (a sign-up, a profile edit) and to `chapters` wait for the file to
-- commit. The tables are new and empty and the function redefinition locks
-- the function only, so that is milliseconds.

-- 1. ------------------------------------------------------------------------

create table if not exists public.chapter_ai_settings (
  chapter_id uuid primary key references chapters(id) on delete cascade,
  -- Ask Frapp: questions answered from the chapter's sources.
  ask_enabled boolean not null default false,
  -- Meeting notes: drafting minutes, and the tasks suggested from them.
  meeting_notes_enabled boolean not null default false,
  -- Chat as a source: messages in chapter channels, from members who said
  -- yes, read by the features above.
  chat_source_enabled boolean not null default false,
  -- The member who last changed a switch. Users are tombstoned in place, so
  -- `set null` rarely fires.
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.chapter_ai_settings enable row level security;

comment on table public.chapter_ai_settings is
  'The president''s AI switches, one per feature family; no row is all off. API only. See 20261112130100_ai_consent.sql.';

-- 2. ------------------------------------------------------------------------

create table if not exists public.user_ai_consents (
  user_id uuid not null references users(id) on delete cascade,
  sheet_version integer not null check (sheet_version >= 1),
  -- true is Yes, false is No. No row for the current version is also No.
  accepted boolean not null,
  answered_at timestamptz not null default now(),
  primary key (user_id, sheet_version)
);

alter table public.user_ai_consents enable row level security;

comment on table public.user_ai_consents is
  'Each person''s answer on the AI sheet, per sheet version; no row for the current version counts as No. API only. See 20261112130100_ai_consent.sql.';

-- 3. Account deletion purges consent rows and quotes -----------------------

-- `anonymize_user` is redefined in full from
-- `20261111235900_chat_important_seen.sql`; the changes are the
-- `user_ai_consents` delete and clearing the member's quotes from
-- `ai_suggestions` (`20261112130001_ai_suggestions.sql`, which this file
-- must sort after). Same signature, so its grants are kept.
create or replace function anonymize_user(
  p_user_id uuid,
  p_rescan_cards boolean default false
)
returns setof users
language plpgsql
security invoker
-- Pinned explicitly: the PGlite search_path guard (#830) fails this
-- redefinition without it.
set search_path = public, pg_temp
as $$
declare
  v_user users;
  v_was_tombstoned boolean;
begin
  if p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'anonymize_user: refusing to anonymize the system user'
      using errcode = 'invalid_parameter_value';
  end if;

  -- #2878: the link lock of every chapter the member linked in, taken BEFORE
  -- the user row below, in the order the import trigger and the link
  -- functions take them (link lock, then a key-share on `users` through the
  -- sender foreign key). Taken after, the two would deadlock. Holding it, an
  -- import batch whose trigger already attached a row to the member commits
  -- before the scrub reads, and one that has not yet read the link finds it
  -- gone. A link made in a chapter not listed here waits on the user row and
  -- then refuses the tombstone (`link_discord_author`). The one window left,
  -- an import in such a chapter attaching a row between that link committing
  -- and this scrub, is closed by the deletion flow's second, converging call
  -- (`AccountDeletionService`, `p_rescan_cards`), which runs this scrub again.
  perform pg_advisory_xact_lock(discord_author_link_lock_key(l.chapter_id))
     from (
       select distinct chapter_id from discord_author_links
        where user_id = p_user_id
        order by chapter_id
     ) l;

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
         major = null,
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
  delete from chat_sidebar_preferences where user_id = p_user_id;
  delete from chat_sidebar_pins where user_id = p_user_id;
  -- Message threads (#3785): which threads the member follows or muted, and
  -- how far they read each. Per-user current state, like the sidebar rows.
  delete from chat_thread_follows where user_id = p_user_id;
  -- Activity links (#3897): the member's own Done and Hide states.
  delete from chat_link_member_states where user_id = p_user_id;
  -- Documents (#3934): the member's own starred folders and files.
  delete from chapter_document_stars where user_id = p_user_id;
  -- Activity unread dots (#4173): which Activity items the member opened.
  delete from activity_item_reads where user_id = p_user_id;
  delete from activity_unread_starts where user_id = p_user_id;
  -- Important strip (#4186): which Important messages the member has seen.
  delete from chat_message_important_seen where user_id = p_user_id;
  -- AI consent (#4308): the member's answers on the AI sheet. Deleting an
  -- account counts as turning AI off (spec/behavior/ai.md § Consent).
  delete from user_ai_consents where user_id = p_user_id;
  -- AI suggestions (#4309): the member's words leave every suggestion that
  -- quotes them, as a No on the sheet does. Decided rows hold no quote.
  update ai_suggestions set quote = null, quote_author_id = null
   where quote_author_id = p_user_id;
  delete from rush_candidate_votes where voter_id = p_user_id;
  delete from study_sessions where user_id = p_user_id;

  -- #2878: the Discord identity on imported rows attributed to this member.
  -- Unconditional (not under the rescan gate below): it is idempotent, and a
  -- retry after a link made before this migration must still reach it.

  -- Reports on those rows keep the reported words (data-retention.md), but
  -- not the Discord name: the officer queue falls back to it when the sender
  -- is off the roster, and a deleted member always is.
  update chat_message_reports r
     set reported_author_name = null
   where r.reported_author_name is not null
     and (r.reported_sender_id = p_user_id
       or exists (
         select 1 from chat_messages m
          where m.id = r.message_id
            and m.kind = 'imported'
            and m.sender_id = p_user_id
       ));

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
