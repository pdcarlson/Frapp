-- #4957: "Remind me about this" on a chat message (spec/behavior/chat/README.md
-- § Reminders (personal)).
--
-- A table of its own rather than a due time on `chat_message_bookmarks`.
-- A bookmark is one idempotent row per (member, message) that Save toggles;
-- folding reminders into it would make un-Save cancel a reminder, and setting
-- a reminder would put the message in Saved. The two are different promises,
-- so they are different rows, shaped alike.
--
-- Like a bookmark, a reminder is a fact about a (member, message) pair and is
-- private to that member: nothing here writes to chat_messages and there is no
-- trigger, so a reminder never touches the message's lifecycle.

create table if not exists public.chat_message_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  message_id uuid not null references chat_messages(id) on delete cascade,
  -- The request's chapter, kept true by the service authorizing the message
  -- through a chapter-scoped channel lookup first (as for bookmarks).
  chapter_id uuid not null references chapters(id) on delete cascade,
  -- When the push goes out. Setting the reminder again (or snoozing it from
  -- Activity) moves this and clears fired_at.
  remind_at timestamptz not null,
  -- Set by the minute sweep when it claims the row and sends the push. A fired
  -- reminder stays on the member's Activity page until they mark it done,
  -- which deletes the row.
  fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One reminder per member per message, as in Slack: setting it again
  -- reschedules the one there is.
  unique (user_id, message_id)
);

-- Activity's read: "my reminders in this chapter, soonest first".
create index if not exists idx_chat_message_reminders_user_chapter
  on public.chat_message_reminders (user_id, chapter_id, remind_at);

-- The sweep's read: unfired reminders that are due, oldest first. Partial, so
-- fired rows waiting on Activity never weigh on it.
create index if not exists idx_chat_message_reminders_due
  on public.chat_message_reminders (remind_at)
  where fired_at is null;

-- Cascades from chat_messages probe by message.
create index if not exists idx_chat_message_reminders_message
  on public.chat_message_reminders (message_id);

-- RLS on with no policies, like chat_message_bookmarks: the API is the only
-- reader and writer, through the service-role client, and with no policy
-- there is no client-reachable read path that could ever widen to show who
-- set a reminder on what.
alter table public.chat_message_reminders enable row level security;

-- Account deletion -------------------------------------------------------------

-- `anonymize_user` is redefined in full from
-- `20261113185033_chat_message_forwarded_from.sql`; the only change is the
-- delete of the member's reminders beside their bookmarks. Same signature, so
-- its grants are kept.
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
         phone = null,
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
  -- Reminders (#4957): private to the member, like bookmarks.
  delete from chat_message_reminders where user_id = p_user_id;
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
  -- Member nudges (#4781): the member's cards and their own switch.
  delete from member_nudges where user_id = p_user_id;
  delete from member_nudge_settings where user_id = p_user_id;
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

    -- Forwarded copies (#4864): a forward keeps the name its author had at
    -- forward time, a display-name snapshot like the cards' above, so it is
    -- rewritten the same way (spec/behavior/data-retention.md). The words
    -- stay, as the member's own messages do.
    update chat_messages
       set forwarded_from = jsonb_set(
             forwarded_from, '{author_name}', to_jsonb('Deleted User'::text)
           )
     where forwarded_from is not null
       and forwarded_from ->> 'sender_id' = p_user_id::text
       and forwarded_from ->> 'author_name' is distinct from 'Deleted User';

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

