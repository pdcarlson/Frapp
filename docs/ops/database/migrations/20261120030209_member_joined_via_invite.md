# 20261120030209_member_joined_via_invite.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `members.joined_via_invite_id`, so the "<name> joined" notices go out once the new member has given their name rather than at the join (Paul, 2026-11-19, #5627).

## Promotion

- **Renumbered** (2026-11-20): first merged as `20261120000243` in #5711, 17 seconds after #5714's `20261120004849_meeting_date_reminders` in the merge queue (the #4795 race). Staging applied `004849` first, so `db push` refused to insert the older version and every staging deploy after #5711 stopped at the migration step. Neither hosted database had applied it (checked on both), so it took a fresh version after everything on `main`.
  - **Don't deploy production from a `main` commit from #5711 (`d742e2b9`) up to this rename's merge.** Those commits still carry `20261120000243`; production, whose newest applied version predates it, would record it, and every later production `db push` would refuse the renamed file until a hand `migration repair` ([`drift-and-ordering.md`](../drift-and-ordering.md)). Dispatch with this rename's merge commit or later, and not with an empty `sha` until that commit is green.
  - **A local database that ran `db push --local` in that window** has `20261120000243` recorded, and its next push refuses. Repair it with `npm run supabase -- migration repair --status reverted 20261120000243 --local`, then push again.

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
