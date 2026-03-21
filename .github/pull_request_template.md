## Summary

-

## Changes

-

## Docs / Spec impact

- **Docs impact**: (None / Updated / Follow-up) — prefer [`docs/`](docs/) (e.g. [`docs/guides/`](docs/guides/)) or internal runbooks.
- **Spec impact**: (None / Updated / Follow-up)
- **Links**:
  - Doc path(s) (`docs/…`, `spec/…`):
  - Spec section(s):

## Test plan

- [ ] CI checks pass (all domain-specific jobs green)
- [ ] Vercel preview builds succeed (web, landing)
- [ ] API unit tests: `npm run test -w apps/api`
- [ ] `npm run check:api-contract` (if API source changes)
- [ ] `npm run check:migration-safety` (if schema/migration changes)
- [ ] Manual smoke test notes (if applicable)

## Checklist

- [ ] This PR keeps `spec/` and implementation in sync (divergence is a bug).
- [ ] If this PR changes non-doc files, it also updates related files in `docs/` and/or `spec/` (satisfies `check-docs-impact.mjs`).
- [ ] If I changed API/domain/workflows, I updated `docs/` and/or `spec/` in the same change set.
- [ ] If I changed API source, I regenerated `openapi.json` and `api-sdk/types.ts`.
- [ ] If targeting `production`, this PR source branch is `main`.
- [ ] If I changed `supabase/migrations/**`, I also updated rollback docs.
- [ ] No secrets committed (`.env*`, credentials, private keys).
- [ ] No placeholder secrets in CI/CD workflows.

## UI/UX quality gate (required for UI-touching PRs)

- [ ] Token-only styling for colors/spacing/radius/motion (no ad hoc visual values).
- [ ] One clear primary action per touched screen/section.
- [ ] Async states complete (loading, empty, error, success, and offline/degraded when network-dependent).
- [ ] Accessibility baseline verified (focus visibility, labels for icon-only controls, contrast checks, keyboard flow).
- [ ] Responsive/adaptive behavior checked for impacted surfaces.
- [ ] Microcopy uses production-grade language (no placeholder/vibe-coded copy).
- [ ] No dead-end controls: every actionable-looking control has behavior or explicit disabled rationale.
- [ ] If this PR changes UX patterns, `docs/internal/UI_UX_SYSTEM.md` and/or `docs/internal/UX_WRITING_GUIDE.md` were updated.

## Release label (main → production only)

- [ ] `release:patch` (default) / `release:minor` / `release:major`
