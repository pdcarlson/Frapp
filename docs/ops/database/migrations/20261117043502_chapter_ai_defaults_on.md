# 20261117043502_chapter_ai_defaults_on.sql

Turns the chapter's three AI switches on by default: the columns default to true and `updated_at` becomes nullable, so a row nobody changed reads as never changed (#5294). The rows come in [20261117050803_chapter_ai_settings_seed](20261117050803_chapter_ai_settings_seed.md).

## Promotion

- **Purpose**: `chapter_ai_settings.ask_enabled`, `meeting_notes_enabled` and `chat_source_enabled` default to true; `updated_at` is nullable with no default. Writes no data.
- **Checks**: `select column_name, column_default, is_nullable from information_schema.columns where table_name = 'chapter_ai_settings' and column_name in ('ask_enabled','meeting_notes_enabled','chat_source_enabled','updated_at');` shows `true` for the three switches and `YES` with no default for `updated_at`.
- **Promoter notes**: ACCESS EXCLUSIVE on `chapter_ai_settings` for the length of three column changes, released at this file's commit. Deploy applies migrations before the API (`_deploy.yml`, "Run migrations (apply)"), which is the order this needs: this release's API writes a null `updated_at` when an audit failure puts a never-changed row back. The API from before this release, served on the migrated schema (the minutes between apply and rollout, or a Render rollback), mishandles one narrow path: if a president's change to a never-changed chapter fails its audit write, the old restore writes `updated_at` as 1970-01-01 and the president as `updated_by`. The switches themselves are right either way.

## Rollback

Worth reverting only if the default itself is withdrawn, and only after the seed migration is rolled back ([its page](20261117050803_chapter_ai_settings_seed.md)) and the API that reads a missing row as on is reverted. A forward migration:

```sql
update public.chapter_ai_settings set updated_at = now() where updated_at is null;
alter table public.chapter_ai_settings
  alter column ask_enabled set default false,
  alter column meeting_notes_enabled set default false,
  alter column chat_source_enabled set default false,
  alter column updated_at set default now(),
  alter column updated_at set not null;
```
