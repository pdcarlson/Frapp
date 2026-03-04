## Summary

-

## Changes

-

## Docs / Spec impact

- **Docs impact**: (None / Updated / Follow-up)
- **Spec impact**: (None / Updated / Follow-up)
- **Links**:
  - Docs page(s):
  - Spec section(s):

## Test plan

- [ ] `npm run build -w docs`
- [ ] `npm run lint -w docs`
- [ ] `npm run check:migration-safety` (if schema/migration changes)
- [ ] `npm run check:api-contract` (if API contract changes)
- [ ] API unit tests (if applicable): `npm test -w apps/api`
- [ ] Manual smoke test notes (if applicable)

## Checklist

- [ ] This PR keeps `spec/` and implementation in sync (divergence is a bug).
- [ ] If I changed API/domain/workflows, I updated docs/spec in the same change set.
- [ ] If targeting `main`, this PR source branch is `preview` (policy gate).
- [ ] If I changed `supabase/migrations/**`, I also updated promotion/rollback docs.
- [ ] Schema indexes/policies impacted by this PR are explicitly versioned in migrations.
- [ ] No secrets committed (`.env*`, credentials, private keys).
