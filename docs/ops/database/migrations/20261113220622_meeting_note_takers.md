# 20261113220622_meeting_note_takers.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `meeting_notes`, where each note-taker keeps their own notes on one meeting's unposted minutes, and two columns on `meeting_drafts`: `source_user_ids`, which records whose notes a draft was written from, and `sources`, which holds what it was written from (#4935).

## Promotion

- **Purpose**: several members can take notes on one meeting, and the draft reads all of them. The notes follow the existing notes rule: they are deleted when the minutes are posted, when the member deletes their account (along with any draft written from their notes), and after 30 days at most. Existing drafts' notes are copied in as their author's notes.
- **Checks**: `select count(*) from meeting_notes;` returns at least the number of unposted drafts with a requester. `select tgname from pg_trigger where tgname = 'meetings_drop_notes_on_post';` returns one row.
- **Promoter notes**: apply before the API that reads `meeting_notes` deploys. The older API ignores the table and the new column, so applying it early is safe. It writes data once (the copy in step 3) and is idempotent.

## Rollback

Reverting is worth it only if the table itself causes trouble. The older API never reads it. Run a forward migration that removes it, and put back the account trigger function from `20261112180000_meeting_drafts.sql` ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
drop trigger if exists meetings_drop_notes_on_post on public.meetings;
drop function if exists public.meeting_notes_drop_on_post();
create or replace function public.meeting_drafts_drop_for_deleted_user()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  delete from public.meeting_drafts where requested_by = new.id;
  return new;
end;
$$;
drop table if exists public.meeting_notes;
alter table public.meeting_drafts drop column if exists source_user_ids, drop column if exists sources;
```
