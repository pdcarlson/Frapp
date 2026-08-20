Run this in Cursor as a new background agent / goal, cut from latest `main`. Run alone in this scope — do not combine with other Wave 1 items. Check open PRs/branches first for anything touching `packages/hooks`, `apps/web/lib/hooks`, or the three named files, and stop if there's overlap.

---

**Context:** REFACTOR-PLAN.md item 8 originally listed 5 stranded web hooks to move into `@repo/hooks`. Re-audit found only 3 are cleanly portable: `use-org-config`, `use-custom-roles`, `use-custom-fields`. The other two (`use-chapter-theme`, `use-subscription-write-state`) are NOT portable as-is (DOM write, localStorage-backed store) — do not move those in this pass.

**Do this:**

1. Move `use-org-config`, `use-custom-roles`, `use-custom-fields` from their current web-only location into `@repo/hooks`, preserving behavior exactly.
2. Update all web call sites to import from `@repo/hooks`.
3. If mobile has equivalent one-off implementations of any of these three, point mobile at the shared version too. If mobile has no equivalent, do not build new mobile functionality — just make the hook available for future use.
4. Definition of done: a repo-wide search for the old import paths returns zero matches, typecheck passes, existing tests for these hooks pass unchanged (moved, not rewritten), and `check:dep-cruiser` shows 0 new violations.

**Explicitly out of scope — do not touch:**
- `use-chapter-theme`, `use-subscription-write-state` (not portable, separate call).
- Any change to which endpoint mobile calls for module-gating (`GET /v1/chapters/current` vs `GET /v1/chapters/{id}/config`) — that's a pending product decision, not something to resolve here. Leave mobile's current module-gating call exactly as it is.

**Test plan to report back:** full check-types, scoped tests for the 3 moved hooks (web + mobile if touched), `check:dep-cruiser`, `check-docs-impact.mjs` if `spec/architecture/README.md`'s package catalog needs updating.