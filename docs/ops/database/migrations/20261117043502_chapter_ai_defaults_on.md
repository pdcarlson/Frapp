# 20261117043502_chapter_ai_defaults_on.sql

Turns the chapter's three AI switches on by default for every chapter whose president never set them, and for every new chapter (#5294).

## Promotion

- **Purpose**: every chapter has a `chapter_ai_settings` row. Rows a president wrote are unchanged; every other chapter gets a row with Ask, meeting notes and chat as a source on and `updated_at` null. New chapters get the same row from a trigger on `chapters`.
- **Checks**: `select count(*) from chapters c left join chapter_ai_settings s on s.chapter_id = c.id where s.chapter_id is null;` returns 0; `select count(*) from chapter_ai_settings where updated_at is null and not (ask_enabled and meeting_notes_enabled and chat_source_enabled);` returns 0.
- **Promoter notes**: writes data (one row per untouched chapter). Safe before or after the API deploy: the API reads a null `updated_at` as "never changed" from this release, and an older API only reads the switch columns. Ship with the privacy-policy line in the same release, since chapters' records start being indexed once Ask is on.

## Rollback

Worth reverting only if the default itself is withdrawn. A forward migration puts the defaults back to off and turns off the rows nobody changed; rows a president wrote keep their values.

```sql
drop trigger if exists trg_chapters_seed_ai_settings on public.chapters;
drop function if exists public.chapters_seed_ai_settings();
delete from public.chapter_ai_settings where updated_at is null;
alter table public.chapter_ai_settings
  alter column ask_enabled set default false,
  alter column meeting_notes_enabled set default false,
  alter column chat_source_enabled set default false,
  alter column updated_at set default now(),
  alter column updated_at set not null;
```
