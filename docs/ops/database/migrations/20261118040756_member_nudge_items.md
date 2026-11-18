# 20261118040756_member_nudge_items.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets `member_nudges` hold cards about more than the member's own tasks, and cards with no generated words, for the widened Activity card (#5464).

## Promotion

- **Purpose**: `member_nudges.subject_key` (not null, backfilled from `task_id`) names what each card is about; `task_id` becomes nullable except on task kinds; `kind` takes `event_soon`, `mention_unread`, `announcement_unread`, `signup_open`, `officer_queue`, `minutes_new` and `study_behind`; `written_by` takes `plain`; and a showing card may have a null `body`. A card is raised once per `(chapter_id, user_id, kind, subject_key)`, replacing once per `(user_id, task_id, kind)`.
- **Checks**: `select count(*) from member_nudges where subject_key is null;` returns 0. `select count(*) from member_nudges where kind like 'task\_%' and subject_key <> task_id::text;` returns 0. `select conname from pg_constraint where conrelid = 'public.member_nudges'::regclass;` lists `member_nudges_once_per_subject_kind` and `member_nudges_task_kinds_name_a_task`, and not `member_nudges_once_per_task_kind`.
- **Promoter notes**: Apply before the API that reads `subject_key`. The API from before this keeps working against it: it writes task cards only, without `subject_key`, and the `member_nudges_default_subject` trigger fills it from `task_id` on insert, so the deploy window and an API rollback both hold. It writes data only in the backfill (one `update` over a table that holds at most a few rows per member). `select tgname from pg_trigger where tgrelid = 'public.member_nudges'::regclass and not tgisinternal;` lists `member_nudges_default_subject`.

## Rollback

Worth reverting only with the API that writes the new kinds also reverted. Delete the rows the old shape can't hold, then restore the old constraints and drop the column.

```sql
delete from public.member_nudges where task_id is null or written_by = 'plain' or (status = 'showing' and body is null);
alter table public.member_nudges drop constraint if exists member_nudges_once_per_subject_kind;
alter table public.member_nudges drop constraint if exists member_nudges_task_kinds_name_a_task;
alter table public.member_nudges add constraint member_nudges_once_per_task_kind unique (user_id, task_id, kind);
alter table public.member_nudges drop constraint if exists member_nudges_kind_check;
alter table public.member_nudges add constraint member_nudges_kind_check check (kind in ('task_due_soon', 'task_overdue', 'task_sent_back', 'task_praise'));
alter table public.member_nudges drop constraint if exists member_nudges_written_by_check;
alter table public.member_nudges add constraint member_nudges_written_by_check check (written_by in ('ai', 'fixed'));
alter table public.member_nudges drop constraint if exists member_nudges_words_only_while_showing;
alter table public.member_nudges add constraint member_nudges_words_only_while_showing check ((status = 'showing' and title is not null and body is not null and closed_at is null) or (status <> 'showing' and title is null and body is null and start_here is null and closed_at is not null));
alter table public.member_nudges alter column task_id set not null;
drop trigger if exists member_nudges_default_subject on public.member_nudges;
drop function if exists public.member_nudges_default_subject();
alter table public.member_nudges drop column if exists subject_key;
```
