# 20261117164915_push_token_last_registered.sql

Adds `push_tokens.last_registered_at`, so the ten-device cap on a member's push tokens drops the devices registered longest ago rather than the ones created first: a phone re-registers its unchanged token on every launch, and ranking by `created_at` dropped the phone in longest daily use first.

## Promotion

- **Purpose**: `push_tokens.last_registered_at timestamptz not null default now()`, backfilled from `created_at`. The API stamps it on every re-register by the same member and ranks by it when a member passes `MAX_PUSH_TOKENS_PER_USER` (`notification.service.ts`).
- **Checks**: `select column_name, column_default, is_nullable from information_schema.columns where table_name = 'push_tokens' and column_name = 'last_registered_at';` shows `now()` and `NO`; `select count(*) from push_tokens where last_registered_at is distinct from created_at;` is 0 straight after the push (it grows as phones re-register).
- **Promoter notes**: ACCESS EXCLUSIVE on `push_tokens` for the column add (a catalog change, no rewrite), then one `update` of every row, one row per registered device. Deploy applies migrations before the API (`_deploy.yml`, "Run migrations (apply)"), which is the order this needs: this release's API writes the column. The API from before this release, served on the migrated schema, inserts without it and gets `now()` from the default, and never stamps a re-register, so its rows rank as they did before.

## Rollback

Worth reverting only together with the API that writes the column; the column on its own changes nothing an older API sees. Revert that API first, then a forward migration:

```sql
alter table public.push_tokens drop column if exists last_registered_at;
```
