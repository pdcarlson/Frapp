-- Chapter AI switches start on (#5294, Paul, 2026-11-17: "I would like more
-- AI stuff on by default").
--
-- Before this file a chapter with no `chapter_ai_settings` row had every
-- switch off, and got them on only when its president tapped Continue on
-- Meet Frapp AI or found the AI tab on web. From here every chapter has a
-- row, and a row nobody has changed has all three switches on. A member's
-- own yes on Meet Frapp AI is unchanged and still gates everything sent for
-- them (`spec/behavior/ai.md` § Consent).
--
-- - Rows that exist were written by a president (the API writes a row only
--   on a change), so they are left exactly as they are.
-- - `updated_at` is null on a row nobody has changed, so a settings page
--   doesn't claim "Last changed" for a default.

-- 1. A row nobody changed: all on, no changer, no change time.
alter table public.chapter_ai_settings
  alter column ask_enabled set default true,
  alter column meeting_notes_enabled set default true,
  alter column chat_source_enabled set default true,
  alter column updated_at drop not null,
  alter column updated_at drop default;

comment on table public.chapter_ai_settings is
  'The president''s AI switches, one per feature family. Every chapter has a row from creation, all on with updated_at null until a president changes one (#5294). API only. See 20261112165040_ai_consent.sql and 20261117043502_chapter_ai_defaults_on.sql.';

-- 2. Every new chapter gets its row, as event and document types do.
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

-- 3. Existing chapters a president never touched.
insert into public.chapter_ai_settings (chapter_id)
select id from public.chapters
on conflict (chapter_id) do nothing;
