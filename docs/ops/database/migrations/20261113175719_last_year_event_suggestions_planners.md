# 20261113175719_last_year_event_suggestions_planners.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Moves the "this time last year" event suggestions already written from `events:create` to `events:update`, so they reach the officers who plan the calendar and not every member (#4549, Paul 2026-11-13: "probably not").

## Promotion

- **Purpose**: Every `ai_suggestions` row of kind `event` asks for `events:update`, the permission the API's `EventSuggestionKind` now writes on new rows. Without it, suggestions written before the deploy stay visible to, and dismissable by, any member until they expire (14 days).
- **Checks**: After `db push`, `select count(*) from public.ai_suggestions where kind = 'event' and required_permission <> 'events:update';` returns 0.
- **Promoter notes**: Data only, no schema. Apply with or after the API deploy: an older API writing a new row after the apply would put `events:create` back on that one row until it expires. Hosted projects are not applied from a cloud-agent session.

## Rollback

Not worth reverting on its own: reverting the API change is what reopens the list to members, and an old API reads the row's own permission. To put the rows back anyway, in a later forward migration ([playbook § 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)):

```sql
update public.ai_suggestions
set required_permission = 'events:create'
where kind = 'event'
  and required_permission = 'events:update';
```
