-- #2877: each member picks how the channels inside each sidebar section sort.
--
-- The last of the owner's approved set (2026-09-29) that #2903 left for later:
-- Recent activity, which waited on a per-channel latest-message read that
-- `get_channel_latest_messages` (#3774) now serves. The rule is
-- spec/behavior/chat/README.md § Sidebar arrangement.
--
--   chapter  the chapter's own order (officers drag it, #4178), then A to Z.
--            The default, and what every member saw before this column.
--   recent   newest latest message first; a channel with none after, A to Z.
--   alpha    A to Z by the name the row shows, ignoring the chapter's order.
--
-- Additive: a column with a default, so every existing row reads `chapter`
-- and an API that does not know the column yet is unaffected. Stored on the
-- member's existing preferences row, so it follows them across devices like
-- the two filters. The check keeps a scripted client from storing a value no
-- client can draw; the API validates against the same list
-- (`SIDEBAR_SORTS` in @repo/validation).
alter table public.chat_sidebar_preferences
  add column if not exists sort text not null default 'chapter';

alter table public.chat_sidebar_preferences
  drop constraint if exists chat_sidebar_preferences_sort_check;

alter table public.chat_sidebar_preferences
  add constraint chat_sidebar_preferences_sort_check
  check (sort in ('chapter', 'recent', 'alpha'));
