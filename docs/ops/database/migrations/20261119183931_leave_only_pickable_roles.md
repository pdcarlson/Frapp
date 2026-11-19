# 20261119183931_leave_only_pickable_roles.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Members can leave only roles marked self-assignable, as they can join only those, so a role an officer gave stays until an officer takes it off (asked by Paul, 2026-11-19, #5650).

## Promotion

- **Purpose**: `self_assign_role` answers `not_assignable` to a leave of a role that isn't marked `self_assignable`; before, it let a member leave any role with no `system_key` outside the tiers. Nothing else changes: the locks, the outcomes, the alumni rule for joining, and the grants (re-stated).
- **Checks**: after `db push`, this returns one row holding `true`:

  ```sql
  select prosrc like '%not v_role.self_assignable then%'
    from pg_proc where proname = 'self_assign_role';
  ```

  On staging, as a member holding a role an officer gave that isn't offered in Pick your roles, the role no longer shows a Leave button there; a role the member picked still does.
- **Promoter notes**: schema only, no data written. Order against the API doesn't matter to the data. Leave on an unmarked role is drawn by the client (`selectPickableRoles` in `@repo/hooks`), so a client from before this change keeps offering it: against the old API the tap gets a 409 ("This role changed while you were saving"), because the old API's check lets the leave through and the function refuses it; against the new API it gets a 403. Web clears this with its deploy; a phone build from before #5650 keeps offering Leave on those roles, refused every time, until it updates. Nothing is written in either case.

## Rollback

Worth reverting only if the product decision is reversed. Re-create the function from `20261114171856_self_assignable_roles.sql` in a forward migration, whose condition lets a leave through for any role outside the tiers with no `system_key`:

```sql
-- In a forward migration: copy the `create or replace function public.self_assign_role`
-- block, its comment and its grants from 20261114171856_self_assignable_roles.sql
-- unchanged. Its refusal condition is:
--   if not found
--      or v_role.system_key is not null
--      or v_role.tier_id is not null
--      or (p_join and not v_role.self_assignable) then
```
