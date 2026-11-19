# 20261119173123_push_token_notifications_enabled.sql

Adds `push_tokens.notifications_enabled`, so officers can see which members' phones let Frapp's notifications show, which are turned off, and who has no phone signed in at all (Directory "Phone app" filter).

## Promotion

- **Purpose**: `push_tokens.notifications_enabled boolean`, nullable, no default. The phone sends it with every `POST /v1/push-tokens`; null means a phone that has not said yet (an older build). `GET /v1/members/phone-reach` reads it.
- **Checks**: `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = 'push_tokens' and column_name = 'notifications_enabled';` shows `boolean`, `YES`, no default. `select count(*) filter (where notifications_enabled is not null) from push_tokens;` is 0 straight after the push and grows as phones on the new update open the app.
- **Promoter notes**: ACCESS EXCLUSIVE on `push_tokens` for the column add only (a catalog change, no rewrite, no data written). Deploy applies migrations before the API (`_deploy.yml`, "Run migrations (apply)"), which this needs: this release's API reads and writes the column. An older API on the migrated schema never touches it.

## Rollback

Worth reverting only together with the API that reads and writes the column; on its own it changes nothing an older API sees. Revert that API first, then a forward migration:

```sql
alter table public.push_tokens drop column if exists notifications_enabled;
```
