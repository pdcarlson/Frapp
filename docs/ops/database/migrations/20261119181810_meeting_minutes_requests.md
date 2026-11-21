# 20261119181810_meeting_minutes_requests.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `meeting_minutes_requests` (one row per member who asked for a meeting's unposted minutes), `meeting_minutes_request_pings` (each meeting's last reminder), `request_meeting_minutes`, which records an ask and decides whether it sends a reminder, and `release_meeting_minutes_ping`, which undoes a reminder the API could not send (#5471).

## Promotion

- **Purpose**: a member of a meeting's audience can ask for its unposted minutes. Each member asks once per meeting, and the minutes taker gets at most one ping per meeting per day; the function locks the meeting's row so two asks at once can't both ping. Requests go when the minutes are posted or the member deletes their account.
- **Checks**: `select to_regclass('public.meeting_minutes_requests'), to_regclass('public.meeting_minutes_request_pings');` are both not null. `select tgname from pg_trigger where tgname in ('meetings_drop_minutes_requests_on_post', 'users_drop_meeting_minutes_requests');` returns two rows. `select has_function_privilege('authenticated', 'public.request_meeting_minutes(uuid, uuid, uuid, integer)', 'execute');` is false, and the same for `public.release_meeting_minutes_ping(uuid, uuid, uuid)`.
- **Promoter notes**: apply before the API that calls `request_meeting_minutes` deploys. The older API never reads the table, so applying it early is safe. It writes no data.

## Rollback

Reverting is worth it only if the table or its triggers cause trouble; the older API never reads them. Dropping the tables loses only who asked for unposted minutes. Run a forward migration ([playbook](../../db-rollback-playbook.md#decision-matrix)):

```sql
drop trigger if exists meetings_drop_minutes_requests_on_post on public.meetings;
drop trigger if exists users_drop_meeting_minutes_requests on public.users;
drop function if exists public.meeting_minutes_requests_drop_on_post();
drop function if exists public.meeting_minutes_requests_drop_for_deleted_user();
drop function if exists public.request_meeting_minutes(uuid, uuid, uuid, integer);
drop function if exists public.release_meeting_minutes_ping(uuid, uuid, uuid);
drop table if exists public.meeting_minutes_request_pings;
drop table if exists public.meeting_minutes_requests;
```
