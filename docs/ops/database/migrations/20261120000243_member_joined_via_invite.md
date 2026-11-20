# 20261120000243_member_joined_via_invite.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `members.joined_via_invite_id`, so the "<name> joined" notices go out once the new member has given their name rather than at the join (Paul, 2026-11-19, #5627).

## Promotion

- **Purpose**: a nullable `uuid` on `members`, a foreign key to `invites (id)` with `on delete set null`. Redeeming an invite fills it; finishing onboarding (`PATCH /v1/members/me/onboarding` turning `has_completed_onboarding` true) reads it to send the inviter's and the officers' notices. Existing rows stay null.
- **Checks**: after `db push`, this returns one row, `uuid` and `YES`:

  ```sql
  select data_type, is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'members' and column_name = 'joined_via_invite_id';
  ```
- **Promoter notes**: schema only, no data written. Push it before the API that writes the column, as the deploy workflow already does; an API running ahead of it would fail every invite redeem.

## Rollback

Revert only if the column causes a problem, after rolling the API back to a build that doesn't write it, with a forward migration. Without it the joined notices for members who redeemed but haven't finished onboarding are not sent:

```sql
alter table public.members drop column if exists joined_via_invite_id;
```
