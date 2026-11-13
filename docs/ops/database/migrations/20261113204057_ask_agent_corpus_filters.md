# 20261113204057_ask_agent_corpus_filters.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets the corpus search be narrowed in the database (by source type, channel, author and dates) and adds a guarded read of one indexed source's passages in order, for Ask's conversation tools (#4900).

## Promotion

- **Purpose**: `match_corpus_chunks` is dropped and made again with five more arguments (`p_source_types`, `p_channel_ids`, `p_author_id`, `p_since`, `p_until`), all defaulting to null, which is the search as it was. Each can only remove passages; none is an access rule. A new function, `read_corpus_source_chunks`, returns the passages of one indexed document or set of minutes in reading order, only to a member of the chapter, never for `chat_message`, and at most 20 a call. Both are granted to `service_role` only. No table, column, index or row changes.
- **Checks**: after `db push`, the new argument list is in place and the old one is gone:

  ```sql
  select proname, pronargs
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('match_corpus_chunks', 'read_corpus_source_chunks');
  -- match_corpus_chunks 11, read_corpus_source_chunks 6, one row each

  select has_function_privilege('authenticated',
    'public.read_corpus_source_chunks(uuid, uuid, text, uuid, integer, integer)',
    'execute');
  -- false
  ```

- **Promoter notes**: Writes no data. Safe in either order against the API: the deployed API calls `match_corpus_chunks` with its first six arguments by name and gets the same rows from the new function, and the new API sends the added arguments only when a search is narrowed, which nothing does until Ask's agent is wired to these tools. Promote it before that wiring ships. Nothing is done by hand.

## Rollback

Worth it only if the new `match_corpus_chunks` returns wrong rows for the un-narrowed search, which would show as Ask finding nothing. Revert with a forward migration that drops both functions and re-runs the `create or replace function public.match_corpus_chunks` statement, with its `revoke` and `grant` lines, from `20261112170000_ai_corpus_chat.sql`. Roll the API back first if it already narrows searches, because the old function refuses the added arguments.

```sql
drop function if exists public.read_corpus_source_chunks(uuid, uuid, text, uuid, integer, integer);
drop function if exists public.match_corpus_chunks(
  uuid, uuid, text, text, text, integer, text[], uuid[], uuid, timestamptz, timestamptz
);
-- then the six-argument match_corpus_chunks from 20261112170000_ai_corpus_chat.sql, unchanged
```
