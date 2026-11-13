# 20261113040009_series_edit_carries_excuses.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `delete_replaced_occurrences`, which deletes the upcoming occurrences a series edit rebuilt and, in the same transaction, carries their excuses (and an approved excuse's `EXCUSED` attendance row) over to the meetings that replace them (#4620). The rule is [`spec/behavior/events.md` § Excuses](../../../../spec/behavior/events.md#excuses).

## Promotion

- **Purpose**: `delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[])` takes the chapter, the old occurrence ids, and the matched old-to-new pairs as two parallel arrays. It moves each pair's `EXCUSED` attendance rows (approved excuses only) and excuses to the new meeting, returns the pending and approved excuses left on old rows, then deletes the old rows. Service role only. No table or existing row changes.
- **Checks**: After `db push`, `select count(*) from pg_proc where proname = 'delete_replaced_occurrences';` returns `1`, and `select has_function_privilege('authenticated', 'public.delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[])', 'execute');` returns `false`.
- **Promoter notes**: Ship it before, or with, the API from the same PR; a deploy applies migrations first. The older API never calls it. The newer API against an unmigrated database fails a regenerating series edit (500) after inserting the new occurrences; its recovery deletes them again, so the series is left as it was. `create or replace` makes re-applying idempotent. No data written, nothing by hand.

## Rollback

Revert the API forward and keep the migration file ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). The reverted API deletes rebuilt occurrences with a plain delete again, so their excuses cascade away as before #4620. To remove the function, after the code revert has shipped, in a later forward migration:

```sql
drop function if exists public.delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[]);
```
