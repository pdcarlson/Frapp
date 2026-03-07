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

- [ ] CI checks pass (all domain-specific jobs green)
- [ ] Vercel preview builds succeed (web, landing, docs)
- [ ] API unit tests: `npm run test -w apps/api`
- [ ] `npm run check:api-contract` (if API source changes)
- [ ] `npm run check:migration-safety` (if schema/migration changes)
- [ ] Manual smoke test notes (if applicable)

## Checklist

- [ ] This PR keeps `spec/` and implementation in sync (divergence is a bug).
- [ ] If I changed API/domain/workflows, I updated docs/spec in the same change set.
- [ ] If I changed API source, I regenerated `openapi.json` and `api-sdk/types.ts`.
- [ ] If targeting `main`, this PR source branch is `preview`.
- [ ] If I changed `supabase/migrations/**`, I also updated rollback docs.
- [ ] No secrets committed (`.env*`, credentials, private keys).
- [ ] No placeholder secrets in CI/CD workflows.

## Release label (preview → main only)

- [ ] `release:patch` (default) / `release:minor` / `release:major`
