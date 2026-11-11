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
-- 2. `activity_action_link(url)`: whether a URL is one of those sign-up
--    hosts. The one copy of the host list; the API reads only the index.
-- 3. `chat_message_links`: one row per action link per message. Filled by a
--    trigger on `chat_messages`, so every way a message is written (the API,
--    the Discord importer, the bridge) indexes the same way, and an edit or a
--    delete takes its links with it. `removed_at` / `removed_by` is an
--    officer's "remove for everyone".
-- 4. `chat_link_member_states`: a member's own Done or Hide on a link.
-- 5. A backfill of the last 30 days of messages, the window Activity reads;
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
      regexp_replace(
        lower(substring(cleaned from '^[a-zA-Z]+://([^/:?#]+)')),
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
    and (
      (u.host = 'docs.google.com'
        and (u.path like '/forms/%' or u.path like '/spreadsheets/%'
             or u.path like '/document/%'))
      or u.host = 'forms.gle'
      or u.host in ('forms.office.com', 'forms.microsoft.com')
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
      (chapter_id, channel_id, message_id, url, host, posted_by, posted_at)
    select c.chapter_id, new.channel_id, new.id, a.url, a.host,
           new.sender_id, new.created_at
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
-- function on insert, while an edit that removes a message's last link, or a
-- delete, still reaches it.
drop trigger if exists chat_messages_index_links on public.chat_messages;
create trigger chat_messages_index_links
  after insert on public.chat_messages
  for each row
  when (new.content ~* 'https?://')
  execute function public.chat_messages_index_links();

drop trigger if exists chat_messages_reindex_links on public.chat_messages;
create trigger chat_messages_reindex_links
  after update of content, is_deleted on public.chat_messages
  for each row
  when (old.content is distinct from new.content
        or old.is_deleted is distinct from new.is_deleted)
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

-- 6. Backfill ------------------------------------------------------------------

insert into public.chat_message_links
  (chapter_id, channel_id, message_id, url, host, posted_by, posted_at)
select c.chapter_id, m.channel_id, m.id, a.url, a.host, m.sender_id, m.created_at
  from public.chat_messages m
  join public.chat_channels c on c.id = m.channel_id
  cross join lateral public.activity_action_links(m.content) a
 where not m.is_deleted
   and m.created_at > now() - interval '30 days'
   and m.content ~* 'https?://'
on conflict (message_id, url) do nothing;
