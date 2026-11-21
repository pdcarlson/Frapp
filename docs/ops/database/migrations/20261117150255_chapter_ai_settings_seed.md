# 20261117150255_chapter_ai_settings_seed.sql

Gives every chapter its AI switches row: a trigger on `chapters` for new ones, and a backfill for every chapter a president never touched, all on with `updated_at` null (#5294).

## Promotion

- **Purpose**: every chapter has a `chapter_ai_settings` row. Rows a president wrote are unchanged. That includes no row for a president who tapped Not now on the old "for you and your chapter" screen (#4790), since Not now wrote no switches, so those chapters turn on too: Paul's 2026-11-17 decision, confirmed for exactly this case the same day.
- **Checks**: `select count(*) from chapters c left join chapter_ai_settings s on s.chapter_id = c.id where s.chapter_id is null;` returns 0; `select count(*) from chapter_ai_settings where updated_at is null and not (ask_enabled and meeting_notes_enabled and chat_source_enabled);` returns 0; `select count(*) from corpus_sources where source_type = 'chat_message' and status = 'pending';` shows the enrolled backlog, which the indexer drains over the following runs.
- **Promoter notes**: needs [20261117150254_chapter_ai_defaults_on](20261117150254_chapter_ai_defaults_on.md) first (the numbering does that). Writes one row per untouched chapter, and each row fires `trg_chapter_ai_settings_chat_corpus`, which enrols that chapter's chat history as pending corpus sources (`enrol_chat_corpus`). The indexer claims them in batches with chat last and embeds only messages from members who said yes, the same work as a president turning chat on, so expect a backlog and embedding spend over the next indexer runs, not a spike. Locks: SHARE ROW EXCLUSIVE on `chapters` (chapter inserts and updates wait) and row locks on the new rows, until commit; nothing table-wide on `chapter_ai_settings`. Ship the privacy-policy line in the same release, since chapters' records start being indexed once Ask is on.

## Rollback

Worth reverting only if the default itself is withdrawn. Revert the API first: this release reads a missing row as on, while the database's corpus triggers read it as off. Then a forward migration purges the chat it enrolled (the chat trigger's off branch runs only on an update, never on a delete) and removes the rows nobody changed:

```sql
drop trigger if exists trg_chapters_seed_ai_settings on public.chapters;
drop function if exists public.chapters_seed_ai_settings();
update public.chapter_ai_settings set chat_source_enabled = false
 where updated_at is null and chat_source_enabled;
delete from public.chapter_ai_settings where updated_at is null;
```
