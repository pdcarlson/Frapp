-- Every chapter gets its AI switches row (#5294): new chapters from a
-- trigger, as event and document types do, and existing chapters a president
-- never touched from the backfill below. The row takes the column defaults
-- set by 20261117043502_chapter_ai_defaults_on.sql: all on, updated_at null.
--
-- Rows a president wrote are left as they are (`on conflict do nothing`). A
-- chapter has no row only if nobody ever changed a switch, which includes a
-- president who answered Not now on the old "for you and your chapter" Meet
-- Frapp AI screen (#4790): Not now wrote no switches, so that chapter is
-- turned on here like any other. That is Paul's call on 2026-11-17 ("I would
-- like more AI stuff on by default"); the president can turn any switch off.
--
-- Each backfilled row fires trg_chapter_ai_settings_chat_corpus
-- (20261112170000_ai_corpus_chat.sql), which enrols the chapter's chat
-- history as pending corpus sources. The indexer drains them in batches
-- (claim_corpus_sources, chat last) and reads only members who said yes, the
-- same work a president turning chat on already caused. Locks: SHARE ROW
-- EXCLUSIVE on `chapters` for the trigger, and row locks on the new
-- `chapter_ai_settings` rows, until commit; no table-wide lock on
-- `chapter_ai_settings`, so chat sends and consent reads don't wait on it.

-- 1. Every new chapter gets its row.
create or replace function public.chapters_seed_ai_settings()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.chapter_ai_settings (chapter_id)
  values (new.id)
  on conflict (chapter_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_chapters_seed_ai_settings on public.chapters;
create trigger trg_chapters_seed_ai_settings
  after insert on public.chapters
  for each row execute function public.chapters_seed_ai_settings();

-- Not an RPC: the trigger runs it with the inserting role's rights, and a
-- trigger needs no grant, so no client role may call it.
revoke all on function public.chapters_seed_ai_settings() from public, anon, authenticated;

-- 2. Existing chapters a president never touched.
insert into public.chapter_ai_settings (chapter_id)
select id from public.chapters
on conflict (chapter_id) do nothing;
