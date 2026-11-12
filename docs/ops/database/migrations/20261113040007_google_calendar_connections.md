# 20261113040007_google_calendar_connections.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the tables, claim function and triggers behind connecting Google Calendar, where Frapp writes a member's events and tasks into a calendar of its own in their Google account (#3322, step 2). The rule is [`spec/behavior/events.md` § Google Calendar](../../../../spec/behavior/events.md#google-calendar).

## Promotion

- **Purpose**: `google_calendar_connections` (one row per member per chapter while live: the sealed Google refresh token, the calendar Frapp made, `status` `active` / `needs_reconnect` / `disconnecting`, and the sync schedule and lease) and `google_calendar_oauth_states` (single-use sign-ins, ten minutes). Both cascade with the user and the chapter, RLS on, no policies (API only, service role). `claim_google_calendar_syncs(p_now, p_limit, p_lease_seconds)` leases due and disconnecting connections to the API's minute worker; execute revoked from `public`, `anon` and `authenticated`. Row triggers `events_mark_google_calendar_due` and `tasks_mark_google_calendar_due` make a chapter's active connections due on any write to its events or tasks, and `users_disconnect_google_calendar` (after `deleted_at` is first set on `users`, which `anonymize_user` does) turns the account's connections `disconnecting` and drops its sign-ins. `anonymize_user` is not redefined. No existing row changes.
- **Checks**: After `db push`, `select count(*) from pg_class where relname in ('google_calendar_connections', 'google_calendar_oauth_states') and relrowsecurity;` returns `2`, `select count(*) from pg_policies where tablename like 'google_calendar_%';` returns `0`, `select count(*) from pg_trigger where tgname in ('events_mark_google_calendar_due', 'tasks_mark_google_calendar_due', 'users_disconnect_google_calendar');` returns `3`, and `select * from claim_google_calendar_syncs(now(), 1, 60);` returns no rows.
- **Promoter notes**: Ship it before, or with, the API from the same PR; a deploy applies migrations first. The older API never reads the tables, and the triggers only update rows in them, so an event or task write costs one indexed update that touches nothing until a member connects. The newer API against an unmigrated database fails the `/v1/google-calendar` routes (500) and its minute worker logs a failed claim each tick; the subscription link is unaffected. The foreign keys and the triggers take `SHARE ROW EXCLUSIVE` on `users`, `chapters`, `events` and `tasks` until commit, for a few catalog statements that touch no rows. `if not exists`, `create or replace` and `drop trigger if exists` make re-applying idempotent. No data written, nothing by hand. Nothing is offered to members until `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` and `GOOGLE_CALENDAR_TOKEN_KEY` are set ([`integrations.md` § Google Calendar](../../deployment/integrations.md#google-calendar)).

## Rollback

Revert the API forward and keep the migration file ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). The reverted API stops syncing: each connected member's Frapp calendar in Google keeps the events it last had, frozen, and nothing removes it. The triggers keep marking rows due, which is harmless. Rows written before the revert stay, so syncing picks up again once the API is back.

Keep the tables unless they are the problem. Dropping `google_calendar_connections` loses the only copy of each member's sealed token: their Frapp calendar stays in Google, frozen, and Frapp can no longer remove it or revoke access (the member can, from their Google account's third-party access page). To remove it all, after the code revert has shipped, in a later forward migration:

```sql
drop trigger if exists users_disconnect_google_calendar on public.users;
drop trigger if exists tasks_mark_google_calendar_due on public.tasks;
drop trigger if exists events_mark_google_calendar_due on public.events;
drop function if exists public.google_calendar_disconnect_deleted_user();
drop function if exists public.google_calendar_mark_chapter_due();
drop function if exists public.claim_google_calendar_syncs(timestamptz, integer, integer);
drop table if exists public.google_calendar_oauth_states;
drop table if exists public.google_calendar_connections;
```
