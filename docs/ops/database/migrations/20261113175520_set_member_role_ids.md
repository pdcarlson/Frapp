# 20261113175520_set_member_role_ids.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `set_member_role_ids`, a locked compare-and-set write of a member's `role_ids`, so a member-roles save racing a role delete can't write the deleted role back (#4830).

## Promotion

- **Purpose**: `PATCH /v1/members/:id/roles` writes through `set_member_role_ids`, which writes nothing (the API answers 409) when the member row moved since the save read it, or when a newly given role no longer exists. Its role locks are ordered as `delete_role` takes them, so a delete either waits and then strips the id, or has committed and the save is refused.
- **Checks**: `select proname from pg_proc where proname = 'set_member_role_ids';` returns one row. `select has_function_privilege('authenticated', 'public.set_member_role_ids(uuid, uuid, text[], text[])', 'execute');` is false.
- **Promoter notes**: Apply before the API that calls it: the old API keeps writing with a plain update and works against this schema. Writes no data.

## Rollback

Reversible, but only together with the API: an API that calls `set_member_role_ids` needs it. If the API is rolled back too, a forward migration drops the function.

```sql
drop function if exists public.set_member_role_ids(uuid, uuid, text[], text[]);
```
