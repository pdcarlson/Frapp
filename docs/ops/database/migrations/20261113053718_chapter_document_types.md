# 20261113053718_chapter_document_types.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `chapter_document_types`, each chapter's own editable list of document types, so `chapter_documents.document_type` stops being open free text (#3642, piece 4). The rule is [`spec/behavior/chapter-docs.md` § Document types](../../../../spec/behavior/chapter-docs.md#document-types).

## Promotion

- **Purpose**: Adds `document_type_key(text)` (immutable: lowercased, all but letters and digits removed) and `chapter_document_types` (`name`, 1 to 100 characters trimmed with a letter or digit, unique per chapter on `document_type_key(name)`; `sort_order`, lowest first). FK to `chapters` cascades. RLS on, no policies (API only, service role). Adds an expression index on `chapter_documents (chapter_id, document_type_key(document_type))`. Adds `seed_default_document_types(uuid)` and the trigger function `chapters_seed_document_types()`, with an `after insert` trigger on `chapters`, so every new chapter starts with seven types (Bylaws, Minutes, Agenda, Budget, Policy, Form, Other). Adds `rename_chapter_document_type(uuid, uuid, text)` and `delete_chapter_document_type(uuid, uuid)`, which change a type and its documents (by key) in one transaction. All four are security invoker with EXECUTE for `service_role` only. For every existing chapter it first inserts one row for each type its documents already use, once per key, in the spelling most of its documents use (inner whitespace collapsed), then the defaults it doesn't have under any spelling. It reads `chapter_documents` and writes no existing row.
- **Checks**: After `db push`, `select relrowsecurity from pg_class where relname = 'chapter_document_types';` returns `true`, `select count(*) from pg_policies where tablename = 'chapter_document_types';` returns `0`, `select count(*) from public.chapters c where not exists (select 1 from public.chapter_document_types t where t.chapter_id = c.id);` returns `0`, `select count(*) from public.chapter_documents d where d.document_type is not null and btrim(d.document_type) <> '' and not exists (select 1 from public.chapter_document_types t where t.chapter_id = d.chapter_id and public.document_type_key(t.name) = public.document_type_key(d.document_type));` returns `0`, and `select has_function_privilege('authenticated', 'public.rename_chapter_document_type(uuid, uuid, text)', 'execute');` returns `false`.
- **Promoter notes**: Ship it before, or with, the API from the same PR; a deploy applies migrations first. The older API never reads the table, and an upload through it with a new type leaves that type off the list until the next upload through the newer API names it (which adds it). A rename or delete through the newer API still matches such documents by key. The newer API against an unmigrated database fails the type routes and every upload that names a type (500). `if not exists`, `create or replace` and `on conflict do nothing` make re-applying idempotent. Nothing by hand.

## Rollback

Revert the API forward and keep the migration file ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). The reverted API ignores the table, and `document_type` keeps working as free text, since no document row was changed. To remove the table, after the code revert has shipped, in a later forward migration:

```sql
drop function if exists public.rename_chapter_document_type(uuid, uuid, text);
drop function if exists public.delete_chapter_document_type(uuid, uuid);
drop trigger if exists trg_chapters_seed_document_types on public.chapters;
drop function if exists public.chapters_seed_document_types();
drop function if exists public.seed_default_document_types(uuid);
drop index if exists public.idx_chapter_documents_type_key;
drop table if exists public.chapter_document_types;
drop function if exists public.document_type_key(text);
```
