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
