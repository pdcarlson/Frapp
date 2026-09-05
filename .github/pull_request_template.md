## Summary

-

## Changes

-

## Docs / Spec impact

- **Docs impact**: (None / Updated / Follow-up) — prefer `docs/` (e.g. `docs/guides/`) or internal runbooks.
  - Answering **None** is fine and common — most changes alter no documented fact, and nothing
    requires a doc edit. Never append a note to an unrelated doc to make a change look documented.
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

- [ ] This PR keeps intended behavior (`spec/`) and current behavior (code) aligned — disagreement is a tracked bug, not silent discretion (see `AGENTS.md` § Spec vs code).
- [ ] If this PR changes a fact a doc asserts, it updates **that** doc — not the nearest one, and not a new stray file. An unrelated doc edited to make the change look documented is a review finding. See `docs/internal/ci-cd/DOCS_CI.md`.
- [ ] If I changed API/domain/workflows, I updated `docs/` and/or `spec/` in the same change set.
- [ ] If I changed API source, I regenerated `openapi.json` and `packages/api-sdk/src/types.ts`.
- [ ] If I moved a heading other docs deep-link into, `npm run check:links` still passes (`npm run install:lychee` first).
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
- [ ] Fail fast on entitlements: if a route this UI calls carries a permission, subscription, or module gate, the control that starts the flow mirrors that gate (disabled + reason + recovery path) rather than letting the user complete a form the server will reject. See the fail-fast entitlement gating standard in `spec/ui/design-system/README.md`.
- [ ] If this PR changes UX patterns, `spec/ui/design-system/README.md` and/or `spec/ui/design-system/writing.md` were updated.

## Release label

Every PR carries one. The next production deploy reads the `release:*` labels on
every PR merged since the last `v*` tag and takes the highest — so a missing
label is read as `release:patch`, and a `release:major` change that forgets its
label ships as a patch.

(Before #1340 this section applied only to the `main` → `production` promotion
PR, because that single PR's labels decided the version. There is no promotion
PR any more: `deploy-production.yml` tags the commit it deployed.)

- [ ] `release:patch` (default) / `release:minor` / `release:major`
