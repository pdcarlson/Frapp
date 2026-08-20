# REFACTOR-PROGRESS.md

Scaffold only. One line per [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md) item. Each Wave 1 goal checks off
its own line with a one-line note and its test result.

**Execution state only — not a tracker.** Real work items, deferred findings, and blockers go to
GitHub Issues with the `triage` label, per `AGENTS.md` ("Never track work in a scratch file") and
[`.claude/skills/file-follow-up/SKILL.md`](.claude/skills/file-follow-up/SKILL.md). This file is
deleted when the project wraps, so nothing durable may live only here.

- [ ] 1. Date-formatting functions → `@repo/formatting`
- [ ] 2. MIME/content-type allowlists + `field-limits.ts` → `@repo/validation`
- [x] 3. Delete the dead unused shared UI workspace and its dependency entries — directory gone; live primitives are `apps/web/components/ui/`; landing is inline Tailwind
- [ ] 4. Chat shim imports → `@repo/chat-core`; delete the 6 shim files
- [ ] 5. Query-key call sites → `createChapterQueryKeys`
- [ ] 6. `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk`
- [ ] 7. `AnalyticsProvider` (web/mobile) → `@repo/hooks`
- [ ] 8. 5 stranded web hooks → `@repo/hooks`; wire mobile's module-gating
- [ ] 9. `apps/web/lib/subscription.ts` → `@repo/validation`

## Item 3 — file-level execution

Live primitives now live at `apps/web/components/ui/` (shadcn/Radix). Landing uses inline Tailwind.
This section avoids the deleted workspace's npm name so a repo-wide search for that token can go to
zero in live files. Historical mentions remain in [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md) (out of
scope to rewrite) and `.buildpad/` (never hand-edit).

### Code, config, and CI

- [x] `packages/ui/` — deleted (11 files: components, tests, package/tsconfig/eslint/vitest/README)
- [x] `apps/web/package.json` — removed unused shared UI workspace dependency
- [x] `apps/landing/package.json` — removed unused shared UI workspace dependency
- [x] `apps/web/next.config.js` — dropped unused workspace from `transpilePackages` (kept `@repo/theme`)
- [x] `apps/landing/next.config.js` — same
- [x] `apps/web/tailwind.config.ts` — removed `../../packages/ui/src/**` content glob
- [x] `apps/landing/tailwind.config.ts` — same
- [x] `.github/workflows/ci.yml` — removed the `npm run test -w packages/ui` step; hooks + chat-core remain
- [x] `.dockerignore` — removed the `packages/ui` exclusion
- [x] `package-lock.json` — dropped workspace dep, `node_modules` link, and `packages/ui` lock entry (npm install wanted to reshuffle unrelated `peer` flags; kept a surgical removal instead)
- [x] `scripts/configure-branch-protection.mjs` — comment only; `CI_CHECKS` already names `web-tests`, not a UI-package step
- [x] `apps/web/lib/providers/api-base-url.test.ts` — comment now lists hooks + chat-core (fence exception)

### Docs, spec, and skills (11 refs)

- [x] `spec/architecture/README.md` — deleted catalog row + tree `ui/` line; 13→12; ADR-15 2026-08-20 amendment (historical 2026-08-19 text left in place)
- [x] `spec/ui/design-system/README.md` — ownership matrix + promote-to rule now point at `apps/web/components/ui/`
- [x] `spec/environments/README.md` — `web-tests` row no longer names the deleted workspace
- [x] `docs/internal/ci-cd/AGENT_INFRA.md` — CI job description; ESLint-10 blocker now names React workspace lint
- [x] `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` — `web-tests` row updated
- [x] `docs/hooks/README.md` — CI alongside-note now `packages/chat-core`; also corrected stale "does not block" (ADR-15 made `web-tests` required)
- [x] `.claude/skills/ui-development/SKILL.md` — primitives section retargeted to `@/components/ui/button` (and Card)
- [x] `.claude/skills/testing/SKILL.md` — dropped deleted-package test command; CI parity names hooks + chat-core
- [x] `.claude/skills/signet-cutover/SKILL.md` — do-not-extend now names `apps/web/components/ui` + `@repo/theme`
- [x] `CONTRIBUTING.md` — `web-tests` required-check row updated
- [x] `AGENTS.md` — shared-package count 13 → 12

### Extra-but-necessary (not in the Item 3 tables; required for a correct tree)

- [x] `README.md` — removed `ui/` from the tree; 13→12 shared workspaces
- [x] `scripts/ci/__tests__/check-doc-paths.test.mjs` — fixtures now cite `packages/hooks` instead of the deleted tree
- [x] `scripts/ci/__tests__/check-api-contract-drift.test.mjs` — negative-path fixture now `packages/theme/src/globals.css`
