# 20261114171856_self_assignable_roles.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `roles.self_assignable`, the rule for which roles may carry it, and `self_assign_role`, the locked write a member joins or leaves one through (#4958).

## Promotion

- **Purpose**: officers mark roles members may join and leave themselves. `role_self_assignable_safe` says which may be (no `system_key`, outside the tiers, no permission beyond `channels:read:<slug>`); the `roles_self_assignable_safe` check refuses any write that leaves a marked role unsafe; `self_assign_role` joins a marked role (never for an alum) or leaves any unkeyed role outside the tiers, under the role-then-member locks `delete_role` takes ([`rbac.md` § Self-assignable roles](../../../../spec/behavior/rbac.md#self-assignable-roles)).
- **Checks**: `select count(*) from roles where self_assignable;` is 0 right after the push. `select has_function_privilege('authenticated', 'public.self_assign_role(uuid, uuid, uuid, boolean)', 'execute');` is false. `select conname from pg_constraint where conname = 'roles_self_assignable_safe';` returns one row.
- **Promoter notes**: Apply before the API that reads the column and calls the RPC. The old API keeps working against it: the column defaults to false and nothing it writes sets it. Writes no data.

## Rollback

Reversible with a forward migration once no API calls `self_assign_role` or writes `self_assignable`. Members keep the roles they picked; only the flag goes.

```sql
drop function if exists public.self_assign_role(uuid, uuid, uuid, boolean);
alter table public.roles drop constraint if exists roles_self_assignable_safe;
drop function if exists public.role_self_assignable_safe(text, uuid, text[]);
alter table public.roles drop column if exists self_assignable;
```
