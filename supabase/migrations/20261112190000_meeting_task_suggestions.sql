-- Suggested tasks from posted minutes (#4313, spec/behavior/meetings.md
-- § Suggested tasks), on the suggestions table (#4309).
--
-- 1. `ai_suggestions.dedupe_key`: which thing in its source a suggestion was
--    made from (one action item of the minutes), so saving posted minutes
--    again never proposes the same item twice. It is a fingerprint of the
--    item, never its words, so a decided row keeps it without keeping text
--    (`ai_suggestions_decided_hold_no_text` is unchanged). Unique per source
--    and kind: two saves a moment apart can't both write the same item. Null
--    for a proposal with nothing to tell it apart by, which the index skips.
-- 2. The delete trigger the suggestions migration left for the meetings
--    table: a meeting's waiting suggestions go with its minutes.
--
-- Locks. `add column` with no default and a check takes ACCESS EXCLUSIVE on
-- `ai_suggestions` for a catalog change plus one scan to validate the check;
-- the index build takes SHARE. The table ships in the same release as this
-- file and is empty, so both are milliseconds. The trigger takes SHARE ROW
-- EXCLUSIVE on `meetings`, also new and empty.

-- 1. ------------------------------------------------------------------------

alter table public.ai_suggestions
  add column if not exists dedupe_key text
    check (dedupe_key is null or char_length(dedupe_key) between 1 and 200);

create unique index if not exists idx_ai_suggestions_source_dedupe
  on public.ai_suggestions (source_type, source_id, kind, dedupe_key)
  where dedupe_key is not null;

-- 2. ------------------------------------------------------------------------

drop trigger if exists meetings_drop_ai_suggestions on public.meetings;
create trigger meetings_drop_ai_suggestions
  after delete on public.meetings
  for each row execute function public.ai_suggestions_drop_for_source('meeting');
