# 20261117053850_event_reminder_rearm_on_reschedule.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds a trigger on `events` that deletes an event's `EVENT_REMINDER` claims in
`scheduled_notification_dispatches` when its `start_time` changes, so a
same-day reschedule is reminded about again (#1550).

## Promotion

- **Purpose**: one function, `public.events_release_reminder_claims()`, and one
  constraint trigger, `events_release_reminder_claims` (`after update of
  start_time`, deferred to commit, `when old.start_time is distinct from
  new.start_time`). No column, key or data change.
- **Checks**:
  `select tgname from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'events_release_reminder_claims';`
  returns one row.
- **Promoter notes**: order against the API doesn't matter. The trigger works
  with the API before and after this release, because claims are written the
  same way by both, so the gap between `db push` and the API deploy, and an
  API-only rollback, are both safe. It writes no data when applied.

## Rollback

Worth reverting only if the trigger itself misbehaves. Reverting brings back
the old limit (a same-day reschedule isn't reminded again) and loses nothing:
claims it already deleted were for times that no longer apply. A forward
migration:

```sql
drop trigger if exists events_release_reminder_claims on public.events;
drop function if exists public.events_release_reminder_claims();
```
