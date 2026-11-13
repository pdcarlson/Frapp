# 20261113164050_delete_role_and_tier_floor.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `delete_role`, which deletes a role and takes it off its holders in one transaction (#4547), and gives `reorder_role_tiers` a floor that keeps New members and Alumni at or below the Everyone tier (#4548), and repairs the role ids earlier deletes left on members.

## Promotion

- **Purpose**: `DELETE /v1/roles/:id` calls `delete_role`, so no `members.role_ids` entry points at a deleted role and a holder left with no member-access role gets Everyone. `PUT /v1/role-tiers/order` refuses (22023, the API answers 400) an order that lifts a tier with a `NEW_MEMBER` or `ALUMNI` keyed role above the Everyone role's tier; a tier already above it may stay, so no chapter is locked out of reordering.
- **Checks**: `select proname from pg_proc where proname in ('delete_role', 'reorder_role_tiers');` returns both rows. `select has_function_privilege('authenticated', 'public.delete_role(uuid, uuid)', 'execute');` is false.
- **Promoter notes**: Apply before the API that calls `delete_role`: the old API keeps deleting rows directly and works against this schema. Writes data once: strips from `members.role_ids` every id that names no role of the member's chapter (left by earlier deletes), and gives Everyone to a member that strip leaves with no member-access role. Before: `select count(*) from members m where exists (select 1 from unnest(m.role_ids) x where not exists (select 1 from roles r where r.id::text = lower(x) and r.chapter_id = m.chapter_id));` After: that count is 0.

## Rollback

The data repair is **not reversible**: the stripped ids and the Everyone grants are not recorded anywhere, so only a backup restores them ([playbook](../../db-rollback-playbook.md#decision-matrix)). It only removes ids that name no role, which grant nothing, so there is little to want back.

The functions are reversible, but not on their own: an API that calls `delete_role` needs it. If the API is rolled back too, a forward migration drops the new function and restores the previous reorder body from `20261112001000_reorder_role_tiers.sql`.

```sql
drop function if exists public.delete_role(uuid, uuid);
-- then re-run the create or replace function public.reorder_role_tiers(...) body from 20261112001000_reorder_role_tiers.sql
```
