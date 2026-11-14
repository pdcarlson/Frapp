-- The channel a chapter's happy-birthday posts go to (#4959, 2026-11-14).
--
-- Shawn asked for "an automatic message that gets sent" on a member's
-- birthday. Like a Discord birthday bot, it posts in a channel an officer
-- picks, and it is off until one is picked: null here means no posts.
--
-- A deleted channel clears the choice (`on delete set null`), so the sweep
-- never posts into a channel that is gone; an archived one is skipped by the
-- API. The API checks the channel belongs to the chapter before saving it, as
-- it does `default_invite_role_id`.
alter table public.chapters
  add column if not exists birthday_channel_id uuid
    references public.chat_channels (id) on delete set null;

-- The sweep reads only chapters that picked a channel.
create index if not exists idx_chapters_birthday_channel
  on public.chapters (birthday_channel_id)
  where birthday_channel_id is not null;

-- One row per birthday post a chapter made: the claim that makes it once.
-- The sweep runs on every API replica, every 30 minutes, and inserts here
-- before it posts; only the insert that lands posts. Keyed by chapter, not
-- channel, so an officer switching the channel on the day doesn't post the
-- same birthday again. A post that fails gives its claim back.
create table if not exists public.birthday_posts (
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- The member's own date, in their time zone, that the post was for.
  local_date date not null,
  created_at timestamptz not null default now(),
  primary key (chapter_id, user_id, local_date)
);

-- Read and written only by the API's service role: no member policies.
alter table public.birthday_posts enable row level security;

-- Account deletion: a claim names a member and their birthday's date, so the
-- scrub that tombstones the users row drops them, as the birthday columns'
-- own trigger (20261114144355) clears those.
create or replace function public.users_clear_birthday_posts_on_tombstone()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is not null then
    delete from public.birthday_posts where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists users_clear_birthday_posts_on_tombstone on public.users;
create trigger users_clear_birthday_posts_on_tombstone
  after update on public.users
  for each row
  when (new.deleted_at is not null)
  execute function public.users_clear_birthday_posts_on_tombstone();

-- A trigger needs no grant, and must not be callable as an RPC (#830).
revoke execute on function public.users_clear_birthday_posts_on_tombstone()
  from public, anon, authenticated;
