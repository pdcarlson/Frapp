# 20261121001050_everyone_floor_actives.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Makes Everyone the floor every member holds, with nothing private, and turns the old Member row (the hidden Everyone role since #4191) into the Actives base role, so a new joiner no longer lands as a full member (Paul, 2026-11-21, [#5802](https://github.com/frapplive/Frapp/issues/5802)).

## Promotion

- **Purpose**: in each chapter with a `MEMBER`-keyed role, that row is renamed Actives and made mentionable (id, tier, permissions and holders unchanged), a new `EVERYONE`-keyed role outside the tiers with `members:view` is added and appended to every member, a default invite role pointing at the old row is cleared, a `members` trigger keeps the Everyone role on every row, and `delete_role` stops handing out the old row.
- **Checks**: `select count(*) from roles where system_key = 'MEMBER';` equals `select count(*) from roles where system_key = 'EVERYONE';`, `select count(*) from members m join roles e on e.chapter_id = m.chapter_id and e.system_key = 'EVERYONE' where not (e.id::text = any (m.role_ids));` returns 0, and `select tgname from pg_trigger where tgname = 'trg_members_keep_everyone_role';` returns one row.
- **Promoter notes**: deploy the API from the same commit with or before this push. An older API reads the `MEMBER` row as Everyone: it hides Actives from every picker, and a redeem that grants no member-access role adds Actives, the very leak this closes. Writes data: the renames, the new rows, the appended ids, the cleared defaults. Phone builds pick up the new key with the next OTA update; until then an old build hides the Actives role in its pickers and shows the new Everyone row as a plain role.

## Rollback

Reverting is worth it only if the new floor breaks joining or chat access. A forward migration drops the trigger, takes the Everyone role off every member and deletes it, renames the `MEMBER` row back to Everyone with `mentionable = false`, and restores `delete_role` from `20261113164050`. Cleared default invite roles are not restored; they were "No role", which the fallback already means.

```sql
drop trigger if exists trg_members_keep_everyone_role on public.members;
drop function if exists public.members_keep_everyone_role();
update public.members m
   set role_ids = array_remove(m.role_ids, e.id::text)
  from public.roles e
 where e.chapter_id = m.chapter_id and e.system_key = 'EVERYONE';
delete from public.roles where system_key = 'EVERYONE';
update public.roles set name = 'Everyone', mentionable = false
 where system_key = 'MEMBER';
-- then: delete_role as 20261113164050_delete_role_and_tier_floor.sql defines it
```
