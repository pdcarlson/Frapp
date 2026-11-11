-- Links on Activity (#3897, step 5 of the Activity series).
--
-- spec/behavior/activity.md § Links owns the rule. Sign-up forms and sheets
-- posted in chat (Google Forms, Sheets and Docs, Microsoft Forms, Typeform,
-- SignUpGenius, Calendly) are gathered onto each member's Activity page, so a
-- member stops scrolling channels for them. Nothing indexed links before this.
--
-- 1. `chat_channels.activity_excluded` (boolean, not null, default false):
--    "Leave out of Activity". Officers set it on channels like #advertising;
--    links posted there never reach anyone's Activity. Every existing channel
--    feeds Activity, as the default does.
-- 2. `activity_action_links(body)`: the sign-up links in a message body, as
--    (url, host) rows. The one copy of the host list; the API reads only the
--    index. A later migration widening the list redefines this function.
-- 3. `chat_message_links`: one row per action link per message, with the
--    message's thread root so a reply's link can open its thread. `removed_at`
--    / `removed_by` is an officer's "remove for everyone".
-- 4. `chat_link_member_states`: a member's own Done or Hide on a link.
-- 5. The index trigger on `chat_messages`, so every way a message is written
--    (the API, the Discord importer, the bridge) indexes the same way: an edit
--    or a delete takes its links with it, and a Discord author link or detach
--    (which rewrites `sender_id`) moves the links' poster with it.
-- 6. `anonymize_user` also deletes the member's Done and Hide states.
-- 7. A backfill of the last 30 days of messages, the window Activity reads;
--    an older link would never be shown, so older history is not indexed.
--
-- Both tables have RLS on and no policies: API only (service role), like
-- every chat table the API serves through `ChannelAccessService`.

-- 1. ------------------------------------------------------------------------

alter table public.chat_channels
  add column if not exists activity_excluded boolean not null default false;

-- 2. ------------------------------------------------------------------------

-- Every http(s) URL in a message body that points at a sign-up host, each
-- once. A URL ends at whitespace or a bracket or quote (so `[text](url)` and
-- `<url>` both read), and trailing sentence punctuation is not part of it.
-- A URL with userinfo (`https://calendly.com:1@evil.example/`) is never one:
-- a browser opens the host after the `@`, so the host before it would be a
-- trusted label on somewhere else.
create or replace function public.activity_action_links(body text)
returns table (url text, host text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select distinct u.url, u.host
  from (
    select
      cleaned as url,
      substring(cleaned from '^[a-zA-Z]+://([^/?#]*)') as authority,
      regexp_replace(
        lower(substring(cleaned from '^[a-zA-Z]+://([^/:?#@]+)(?::[0-9]*)?(?:[/?#]|$)')),
        '^www\.',
        ''
      ) as host,
      lower(coalesce(substring(cleaned from '^[a-zA-Z]+://[^/?#]+(/[^?#]*)'), '/'))
        as path
    from (
      select regexp_replace(m[1], '[.,;:!?''"*_~]+$', '') as cleaned
      from regexp_matches(
        coalesce(body, ''),
        '(https?://[^\s<>()\[\]{}"''`]+)',
        'gi'
      ) as m
    ) raw
  ) u
  where u.host is not null
    and position('@' in u.authority) = 0
    and (
      -- `/a/<domain>/` is a Google Workspace account's prefix.
      (u.host = 'docs.google.com'
        and u.path ~ '^(/a/[^/]+)?/(forms|spreadsheets|document)/')
      or u.host = 'forms.gle'
      or u.host in ('forms.office.com', 'forms.microsoft.com',
                    'forms.cloud.microsoft')
      or u.host = 'typeform.com' or u.host like '%.typeform.com'
      or u.host = 'signupgenius.com' or u.host like '%.signupgenius.com'
      or u.host = 'calendly.com'
    )
$$;

-- 3. ------------------------------------------------------------------------

create table if not exists public.chat_message_links (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  -- The message's thread root when it is a thread reply, which the channel's
  -- timeline doesn't show, so "Open in chat" opens the thread instead.
  thread_root_id uuid,
  url text not null,
  host text not null,
  -- The message's sender and time, copied so the read needs no join. A
  -- sender is a tombstoned `users` row after account deletion, never deleted.
  posted_by uuid references public.users (id) on delete set null,
  posted_at timestamptz not null,
  -- An officer's "remove for everyone" (`channels:manage`).
  removed_at timestamptz,
  removed_by uuid references public.users (id) on delete set null,
  constraint chat_message_links_message_url_key unique (message_id, url)
);

alter table public.chat_message_links enable row level security;

-- Activity's read: one chapter's links still showing, newest first.
create index if not exists idx_chat_message_links_chapter_posted
  on public.chat_message_links (chapter_id, posted_at desc)
  where removed_at is null;

-- 4. ------------------------------------------------------------------------

create table if not exists public.chat_link_member_states (
  link_id uuid not null references public.chat_message_links (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  -- `done`: the member filled it in. `hidden`: not chapter business for them.
  -- No row means the link still shows. Clearing a state deletes the row.
  state text not null check (state in ('done', 'hidden')),
  updated_at timestamptz not null default now(),
  primary key (link_id, user_id)
);

alter table public.chat_link_member_states enable row level security;

create index if not exists idx_chat_link_member_states_user
  on public.chat_link_member_states (chapter_id, user_id);

-- 5. The index trigger --------------------------------------------------------

-- `security definer` for the reason `chat_messages_bump_thread_summary` is:
-- the API's service role bypasses RLS, an importer or a later caller may not.
-- A failure is swallowed with a warning: a link that is not indexed is a gap
-- on Activity, and a chat message that fails to send over it is far worse.
create or replace function public.chat_messages_index_links()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.is_deleted then
      delete from chat_message_links where message_id = new.id;
      return null;
    end if;

    if tg_op = 'UPDATE' then
      -- A Discord author link or detach rewrites `sender_id`; the poster
      -- moves with it, so "not your own" and the block list stay right.
      update chat_message_links
         set posted_by = new.sender_id
       where message_id = new.id
         and posted_by is distinct from new.sender_id;

      -- An edit drops the links it removed, with their states, and keeps the
      -- rest as they were (an officer's removal included).
      delete from chat_message_links l
       where l.message_id = new.id
         and not exists (
           select 1 from activity_action_links(new.content) a
            where a.url = l.url
         );
    end if;

    insert into chat_message_links
      (chapter_id, channel_id, message_id, thread_root_id, url, host,
       posted_by, posted_at)
    select c.chapter_id, new.channel_id, new.id, new.thread_root_id, a.url,
           a.host, new.sender_id, new.created_at
      from activity_action_links(new.content) a
      join chat_channels c on c.id = new.channel_id
    on conflict (message_id, url) do nothing;
  exception when others then
    raise warning 'chat_messages_index_links failed for message %: %',
      new.id, sqlerrm;
  end;
  return null;
end
$$;

-- Two triggers, so the common message with no link at all never calls the
-- function on insert, while an edit that removes a message's last link, a
-- delete, or a change of sender still reaches it.
drop trigger if exists chat_messages_index_links on public.chat_messages;
create trigger chat_messages_index_links
  after insert on public.chat_messages
  for each row
  when (new.content ~* 'https?://')
  execute function public.chat_messages_index_links();

drop trigger if exists chat_messages_reindex_links on public.chat_messages;
create trigger chat_messages_reindex_links
  after update of content, is_deleted, sender_id on public.chat_messages
  for each row
  when (old.content is distinct from new.content
        or old.is_deleted is distinct from new.is_deleted
        or old.sender_id is distinct from new.sender_id)
  execute function public.chat_messages_index_links();

revoke execute on function public.chat_messages_index_links() from public;

-- Supabase grants new functions to `anon` and `authenticated` directly, so
-- revoking from `public` alone leaves them callable. A trigger function has
-- no caller but the trigger.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.chat_messages_index_links() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.chat_messages_index_links() from authenticated;
  end if;
end
$$;

-- 6. Account deletion purges link states ---------------------------------------

-- `anonymize_user` is redefined in full from
-- `20261110220000_chat_message_threads.sql`; the one change is the
-- `chat_link_member_states` delete. Same signature, so its grants are kept.
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

-- 7. Backfill ------------------------------------------------------------------

insert into public.chat_message_links
  (chapter_id, channel_id, message_id, thread_root_id, url, host, posted_by,
   posted_at)
select c.chapter_id, m.channel_id, m.id, m.thread_root_id, a.url, a.host,
       m.sender_id, m.created_at
  from public.chat_messages m
  join public.chat_channels c on c.id = m.channel_id
  cross join lateral public.activity_action_links(m.content) a
 where not m.is_deleted
   and m.created_at > now() - interval '30 days'
   and m.content ~* 'https?://'
on conflict (message_id, url) do nothing;
