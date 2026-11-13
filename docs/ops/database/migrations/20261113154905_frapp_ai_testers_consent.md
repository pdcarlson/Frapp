# 20261113154905_frapp_ai_testers_consent.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Records the four tester accounts in production as having turned Frapp AI on, so Meet Frapp AI doesn't ask them (#4790, Paul 2026-11-13: "assume that the 4 tester accounts have already given consent").

## Promotion

- **Purpose**: Inserts a yes on AI consent version 2 into `user_ai_consents` for four production user ids (the developers in the "Phi Gamma Delta" test chapter). An account that already answered version 2 keeps its own row. On every other database none of the ids exists and nothing is written.
- **Checks**: After `db push` on production, `select user_id, accepted from public.user_ai_consents where sheet_version = 2 and user_id in ('937a39e8-17c1-4b1f-8b6c-ce1f358f5af2','600a21dc-46dd-43b6-987e-fe6ef7d321fd','3e177a65-7e66-41bb-8b38-0f28f2227714','fe3877f1-44e3-40b6-b1b6-710cffea6ba9');` returns four rows, all `true` (on staging, zero).
- **Promoter notes**: Data only, no schema. Independent of the API's deploy order. Hosted projects are not applied from a cloud-agent session.

## Rollback

Not worth reverting. Any of the four can turn Frapp AI off in Settings, which records their own No. To remove the rows anyway, in a later forward migration ([playbook § 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)):

```sql
delete from public.user_ai_consents
where sheet_version = 2
  and user_id in (
    '3e177a65-7e66-41bb-8b38-0f28f2227714',
    'fe3877f1-44e3-40b6-b1b6-710cffea6ba9'
  );
```
