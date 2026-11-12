-- "This time last year" suggestions (#3930, spec/behavior/ai.md § This time
-- last year), on the suggestions table (#4309). No new table.
--
-- 1. `ai_suggestions.kind` gains `event`: a suggested event. Accepting one
--    records the event an officer added through the ordinary event route; it
--    makes nothing itself.
-- 2. `ai_suggestions.source_type` gains `task`: a suggestion drawn from an
--    earlier task (last year's). Last year's events use the existing `event`.
-- 3. A delete trigger on `tasks`, as `events`, `chat_channels` and `meetings`
--    have: a waiting suggestion goes with the task it was drawn from.
-- 4. An index for "has this chapter been asked about this thing this year":
--    the weekly check raises a thing once across the chapter, whatever
--    record it was drawn from, so it looks a fingerprint up by chapter
--    (`idx_ai_suggestions_source_dedupe` leads with the source).
--
-- Both checks were written inline in `20261112130001_ai_suggestions.sql`, so
-- Postgres named them `ai_suggestions_kind_check` and
-- `ai_suggestions_source_type_check`.
--
-- Locks. Dropping and adding a check takes ACCESS EXCLUSIVE on
-- `ai_suggestions` and scans it once to validate. The table ships in the same
-- release as this file and is empty, so that is milliseconds. The trigger
-- takes SHARE ROW EXCLUSIVE on `tasks` for a catalog change only: writes to
-- `tasks` wait for this file to commit, and nothing is scanned. The index
-- build takes SHARE on the same empty table.

-- 1. ------------------------------------------------------------------------

alter table public.ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;
alter table public.ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in ('task', 'event'));

-- 2. ------------------------------------------------------------------------

alter table public.ai_suggestions
  drop constraint if exists ai_suggestions_source_type_check;
alter table public.ai_suggestions
  add constraint ai_suggestions_source_type_check
  check (source_type in ('meeting', 'event', 'channel', 'task'));

-- 3. ------------------------------------------------------------------------

drop trigger if exists tasks_drop_ai_suggestions on public.tasks;
create trigger tasks_drop_ai_suggestions
  after delete on public.tasks
  for each row execute function public.ai_suggestions_drop_for_source('task');

-- 4. ------------------------------------------------------------------------

create index if not exists idx_ai_suggestions_chapter_dedupe
  on public.ai_suggestions (chapter_id, dedupe_key)
  where dedupe_key is not null;
