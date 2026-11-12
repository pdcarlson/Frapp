# 20261112293700_event_check_in_screens.sql

Adds `event_check_in_screens`, where each officer's screen showing an event's check-in QR is, so members check in only near it (#4532).

## Promotion

- **Purpose**: Adds `event_check_in_screens`, one row per event and officer (`reported_by`, the primary key with `event_id`) recording where that officer's phone showing the check-in code is (`lat`, `lng`, `accuracy_m`, `located_at`, all set or all null), when it last reported (`shown_at`), and `expires_at`, the close of the event's check-in window. Foreign keys to `events`, `users` and `chapters` cascade on delete. Row-level security on with no policies (API only). Indexes on `expires_at` (the sweep), `chapter_id` and `reported_by`. Nothing is written on apply.
- **Checks**: After `db push`, `select count(*) from information_schema.tables where table_name = 'event_check_in_screens';` returns 1 and `select relrowsecurity from pg_class where relname = 'event_check_in_screens';` returns `true`.
- **Promoter notes**: Must land before the API that reads it, which reads the table on every check-in (an API deployed first fails check-in with a missing-relation error until it lands). Deploy applies migrations before it deploys the API (`_deploy.yml`), so the order holds by itself. The mobile half rides an OTA, which Deploy production sends after the API. Hosted projects are not applied from a cloud-agent session.

## Rollback

One table, `event_check_in_screens` (#4532): where each officer's screen showing an event's check-in QR is, kept only until check-in closes. **Roll the API back first.** The API reads the table on every check-in, so dropping it under a running API fails every check-in. With the API reverted, check-in is checked against drawn zones alone and the code is optional again; the rows hold nothing worth keeping (each expires with its check-in window).

Keep the migration file ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)) and, in a later forward migration:

```sql
drop table if exists public.event_check_in_screens;
```
