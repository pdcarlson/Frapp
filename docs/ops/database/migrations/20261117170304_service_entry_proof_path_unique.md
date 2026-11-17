# 20261117170304_service_entry_proof_path_unique.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Makes one proof file belong to one service entry in a chapter, so a create resent after a lost response can't save the same receipt twice (`spec/behavior/service-hours.md` § Logging).

## Promotion

- **Purpose**: adds `service_entries_chapter_proof_path_key`, a unique index on `service_entries (chapter_id, proof_path) where proof_path is not null`. Entries without proof are untouched. The API already looks a proof path up before it inserts and answers the same member's resend with the entry it saved; the index closes the gap where two creates race past that read, and the API maps its unique violation (23505) to the same answer.
- **Why a plain index and not one limited to newer entries**: the old API never refused a shared proof path, so existing data could in principle hold duplicates. Checked 2026-11-17: frapp-staging held no service entries, and frapp-prod held 17, two with proof, none sharing a path. An index limited to entries created after a fixed date would only leave out rows already known to be clean, while the rows that could still collide are ones the old API writes after that date and before this is pushed, which such an index would cover anyway. So the migration keeps the index whole and, instead of choosing which entry keeps a shared file (nulling a `proof_path` would cut an entry off from its receipt), stops with a message if it finds one. It rewrites and removes nothing.
- **Checks**: before `db push`, this returns no rows:

  ```sql
  select chapter_id, proof_path, count(*)
    from public.service_entries
   where proof_path is not null
   group by 1, 2
  having count(*) > 1;
  ```

  After it, `select indexdef from pg_indexes where indexname = 'service_entries_chapter_proof_path_key';` returns one row ending in `WHERE (proof_path IS NOT NULL)`.

- **Promoter notes**: Push it before or with the API that maps the violation; an older API meeting the index answers a racing duplicate with a 500 instead of the saved entry, which still saves only one entry. The build takes a short write lock on `service_entries`, a small table. If the check above finds rows, the migration stops without changing anything: bring the rows to Paul, since which entry keeps the file (and whether the other's hours stand) is his call. No manual steps otherwise.

## Rollback

Worth reverting only if the index blocks a create it shouldn't. The API keeps its own lookup without it, so dropping it reopens only the race. Run as a forward migration ([playbook](../../db-rollback-playbook.md#decision-matrix)):

```sql
drop index if exists public.service_entries_chapter_proof_path_key;
```
