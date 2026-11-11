-- Pinned and starred documents and folders (#3934, Shawn's idea).
--
-- spec/behavior/chapter-docs.md § Pinned and starred owns the rule. Documents
-- lists in three tiers: what officers pinned for the whole chapter, then what
-- the member starred for themselves, then everything else. Folders and single
-- files can each be pinned and starred.
--
-- 1. `pinned_at` on `chapter_document_folders` and `chapter_documents`: a pin
--    is a chapter-wide property of the row itself, like
--    `chat_messages.pinned_at`, so it lives on the row. Null is unpinned.
-- 2. `chapter_document_stars`: a star is a fact about a (member, folder) or
--    (member, document) pair, so it cannot live on the shared row without
--    making one member's stars readable by everyone (the reasoning
--    20260902120000_chat_message_bookmarks.sql gives for bookmarks).
-- 3. `anonymize_user` also deletes the member's stars.
--
-- RLS on and no policies: API only (service role), like the two document
-- tables themselves.

-- 1. ------------------------------------------------------------------------

alter table public.chapter_document_folders
  add column if not exists pinned_at timestamptz;

alter table public.chapter_documents
  add column if not exists pinned_at timestamptz;

-- 2. ------------------------------------------------------------------------

create table if not exists public.chapter_document_stars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Written from the request's chapter after the service has read the folder
  -- or document through a chapter-scoped lookup, so a row from another
  -- chapter never reaches this table (the bookmarks table's arrangement).
  chapter_id uuid not null references chapters(id) on delete cascade,
  -- Exactly one of the two. Deleting the folder or the document takes its
  -- stars with it.
  folder_id uuid references chapter_document_folders(id) on delete cascade,
  document_id uuid references chapter_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chapter_document_stars_one_target
    check (num_nonnulls(folder_id, document_id) = 1),
  -- Starring is idempotent per member. Postgres treats nulls as distinct, so
  -- a folder star's null `document_id` never collides with another's.
  constraint chapter_document_stars_user_folder_key unique (user_id, folder_id),
  constraint chapter_document_stars_user_document_key unique (user_id, document_id)
);

-- The one read: "my stars in this chapter".
create index if not exists idx_chapter_document_stars_user_chapter
  on public.chapter_document_stars (user_id, chapter_id);

-- The cascades probe by target.
create index if not exists idx_chapter_document_stars_folder
  on public.chapter_document_stars (folder_id) where folder_id is not null;
create index if not exists idx_chapter_document_stars_document
  on public.chapter_document_stars (document_id) where document_id is not null;

alter table public.chapter_document_stars enable row level security;

-- 3. Account deletion purges stars -------------------------------------------

-- `anonymize_user` is redefined in full from
-- `20261111030000_activity_links.sql`; the one change is the
-- `chapter_document_stars` delete. Same signature, so its grants are kept.
-- Those rows' `user_id` cascade never fires, because the `users` row is
-- tombstoned in place, not deleted.
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
