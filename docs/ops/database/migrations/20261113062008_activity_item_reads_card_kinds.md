# 20261113062008_activity_item_reads_card_kinds.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Widens `activity_item_reads.kind` to take `signup` and `form`, so Activity can record a member opening a sign-up or form card from Needs you (#3926, step 4).

## Promotion

- **Purpose**: `activity_item_reads_kind_check` allows `task`, `hours_entry`, `poll`, `event`, `link`, `signup` and `form`. Until it lands, `POST /v1/activity/reads` with a `signup` or `form` item fails its insert.
- **Checks**: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'activity_item_reads_kind_check';` lists all seven kinds.
- **Promoter notes**: Apply before the API that serves `needs_you.cards`. Writes no data. It takes a brief `ACCESS EXCLUSIVE` lock on `activity_item_reads` while the check validates its rows, a small table.

## Rollback

Not worth reverting on its own: the wider check accepts every row the old one did. If the feature is rolled back and the old check is wanted, delete the new kinds' rows first, since the old check would refuse them.

```sql
delete from public.activity_item_reads where kind in ('signup', 'form');
alter table public.activity_item_reads
  drop constraint if exists activity_item_reads_kind_check,
  add constraint activity_item_reads_kind_check
    check (kind in ('task', 'hours_entry', 'poll', 'event', 'link'));
```
