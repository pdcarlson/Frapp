# 20261116143520_request_context_skips_deleted_users.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Redefines `get_request_context` so its `user` part skips a row with `deleted_at` set (#5043): a deleted account's tombstone answers as no user.

## Promotion

- **Purpose**: the API's chapter guard refuses a deleted account's token at once, even on a read it now verifies locally instead of asking Supabase Auth (#5043). This call is where that read gets the caller's `users` row; the guard's direct read, used only when the call fails, carries the same filter in the API code. The function's arguments, answer shape and grants are unchanged.
- **Checks**:
  - `select pg_get_functiondef('public.get_request_context(uuid, uuid)'::regprocedure) like '%deleted_at is null%';` returns true.
  - `select has_function_privilege('authenticated', 'public.get_request_context(uuid, uuid)', 'execute');` returns false.
- **Promoter notes**: writes no data. Promote before the API that verifies reads locally. The other order is still safe: a tombstoned user has no memberships (`anonymize_user` deletes them), so a deleted account is refused either way, as `chapter.context.invalid` instead of `User profile not found`.

## Rollback

Rarely worth it. Without the filter a deleted account's leftover token is still refused, by its missing memberships, as `chapter.context.invalid`, so reverting changes only which 403 it gets and drops one layer of that refusal. If needed, a forward migration restores the 20261112151000 definition ([playbook](../../db-rollback-playbook.md#decision-matrix)):

```sql
-- Re-run the `create or replace function public.get_request_context` block
-- from 20261112151000_request_context_lookup.sql unchanged (without the
-- `and u.deleted_at is null` line).
```
