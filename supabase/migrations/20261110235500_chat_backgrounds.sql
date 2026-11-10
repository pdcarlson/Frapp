-- Chat backgrounds (#3973). A chapter has a default background for its
-- channels, set by whoever edits the chapter profile, and each channel can
-- override it, set by `channels:manage`. Design picks: the #3973 thread
-- (2026-11-10); behavior: spec/behavior/chat/README.md § Chat backgrounds.
--
--   chapters.chat_background                 the chapter default: a built-in
--                                            key, or 'photo'. Not null; every
--                                            chapter starts on 'plain'.
--   chapters.chat_background_photo_path      the default's photo in the
--                                            private `branding` bucket, set
--                                            exactly when the key is 'photo'.
--   chapters.chat_background_message_id      the chat line announcing that
--                                            photo. A photo whose line has been
--                                            deleted (a removed report) is not
--                                            shown.
--   chat_channels.background                 the channel's override, or null to
--                                            follow the chapter default. Never
--                                            set on a DM or group DM.
--   chat_channels.background_photo_path      as on chapters.
--   chat_channels.background_message_id      as on chapters.
--
-- The keys mirror CHAT_BACKGROUND_KEYS in @repo/validation. Every new column
-- is nullable or has a constant default, so adding them rewrites no row.

alter table public.chapters
  add column if not exists chat_background text not null default 'plain',
  add column if not exists chat_background_photo_path text,
  add column if not exists chat_background_message_id uuid
    references public.chat_messages (id) on delete set null;

alter table public.chapters
  drop constraint if exists chapters_chat_background_key,
  add constraint chapters_chat_background_key check (
    chat_background in ('plain', 'gold-glow', 'midnight', 'game-day', 'letters', 'photo')
  ),
  drop constraint if exists chapters_chat_background_photo,
  add constraint chapters_chat_background_photo check (
    (chat_background = 'photo') = (chat_background_photo_path is not null)
  );

alter table public.chat_channels
  add column if not exists background text,
  add column if not exists background_photo_path text,
  add column if not exists background_message_id uuid
    references public.chat_messages (id) on delete set null;

alter table public.chat_channels
  drop constraint if exists chat_channels_background_key,
  add constraint chat_channels_background_key check (
    background is null
    or background in ('plain', 'gold-glow', 'midnight', 'game-day', 'letters', 'photo')
  ),
  drop constraint if exists chat_channels_background_photo,
  add constraint chat_channels_background_photo check (
    (background is not distinct from 'photo') = (background_photo_path is not null)
  ),
  drop constraint if exists chat_channels_background_not_direct,
  add constraint chat_channels_background_not_direct check (
    background is null or type not in ('DM', 'GROUP_DM')
  );
