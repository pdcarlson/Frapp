# 20261117172019_daily_limits_counted_under_lock.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Counts the daily ceilings on emailed invites and on starting chapters in the same step as the write, one request per chapter, sender or starter at a time, and stops counting invites whose email failed ([`spec/behavior/README.md` § Daily limits](../../../../spec/behavior/README.md#daily-limits)).

## Promotion

- **Purpose**: `invites.email_failed_at` (nullable), set by the API when the provider refuses an invite's email; `create_emailed_invites`, which counts both emailed-invite ceilings under advisory locks and inserts the batch only when it fits; and `trg_chapters_daily_start_ceiling`, which refuses (`FR429`) a fourth chapter started by one account in 24 hours.
- **Checks**: `select column_name from information_schema.columns where table_name = 'invites' and column_name = 'email_failed_at';` returns one row; `select proname from pg_proc where proname in ('create_emailed_invites', 'chapters_daily_start_ceiling');` returns two; `select tgname from pg_trigger where tgname = 'trg_chapters_daily_start_ceiling';` returns one.
- **Promoter notes**: apply before the API that calls `create_emailed_invites`: an API without it can't send emailed invites. An older API keeps working against it, since it doesn't call the function; only a fourth chapter one account starts in 24 hours is refused, which an API from before the daily ceilings answers as a plain error rather than its 429. No data is written; the new column is null on every row.

## Rollback

Revert the API first, then a forward migration drops the three objects. The column holds only which sends failed; dropping it loses nothing else
([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
drop trigger if exists trg_chapters_daily_start_ceiling on public.chapters;
drop function if exists public.chapters_daily_start_ceiling();
drop function if exists public.create_emailed_invites(uuid, uuid, jsonb, timestamptz, integer, integer);
alter table public.invites drop column if exists email_failed_at;
```
