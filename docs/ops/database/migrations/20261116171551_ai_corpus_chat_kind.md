# 20261116171551_ai_corpus_chat_kind.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

`read_chat_corpus_window` also returns each message's `kind`, so the chat index can say which line was an announcement, a thread reply or imported from Discord (#4915, #5170). `enrol_chat_corpus` is recreated unchanged, with a comment on its kind filter.

## Promotion

- **Purpose**: the window read returns one more column, `kind`. The API writes it into each indexed chat line. Which messages are read doesn't change: the same kinds, consent and channel rules apply.
- **Checks**:
  - `select pg_get_function_result('public.read_chat_corpus_window(uuid, uuid)'::regprocedure);` ends with `kind text`.
  - `select has_function_privilege('authenticated', 'public.read_chat_corpus_window(uuid, uuid)', 'execute');` returns false.
  - `select has_function_privilege('service_role', 'public.read_chat_corpus_window(uuid, uuid)', 'execute');` returns true.
- **Promoter notes**: no data is written. **Migrate before the API**, as the deploy workflows already do. An older API ignores the extra column. The API that ships with this migration raises `CORPUS_PIPELINE_VERSION`, so every indexed source is indexed again in the background over the following hours, within the spend caps. If that API ran against the old function, it would read every message as plain text and stamp the re-indexed windows with the new version, and nothing would index them again once the migration landed. If that happens out of band, raise `CORPUS_PIPELINE_VERSION` once more after migrating.

## Rollback

Rarely worth it: the column is only read. If needed, run as a forward migration after rolling back the API ([playbook](../../db-rollback-playbook.md#decision-matrix)). Re-create the function as `20261112170000_ai_corpus_chat.sql` § 6 defines it. That means dropping it first, because the return type differs, then restoring its grants as § 9 of that file does.

```sql
drop function if exists public.read_chat_corpus_window(uuid, uuid);
-- then the create function body from 20261112170000_ai_corpus_chat.sql § 6,
-- and the revoke/grant block from its § 9 for this one function
```
