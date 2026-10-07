#!/usr/bin/env node

/**
 * The required-check rosters: data only, with no side effects, network calls or
 * entry point.
 *
 * `scripts/configure-branch-protection.mjs` asks "must these pass before a PR
 * merges?"; `scripts/ci/validate-deploy-sha.mjs` and
 * `scripts/ci/resolve-deploy-sha.mjs` ask "did these pass on the commit being
 * deployed?". Keeping the list here keeps a governance writer off the production
 * deploy path, and one roster read both ways stands in for the deploy-specific
 * roster #1375 considered and rejected (ADR-20 amendment 2026-09-01, #1383).
 *
 * This file is the one home for these names and for what each check validates:
 * keep each description beside its entry and point docs here.
 */

// ── Required status checks ──────────────────────────────────────────────────
// These must match check-run names exactly as reported on PRs.

export const CI_CHECKS = [
  // Shared packages compile.
  "packages-build",
  // ESLint + TypeScript (all workspaces); `npm run build -w apps/api`
  // (`nest build`, Render parity); landing plus `@repo/validation`,
  // `@repo/color`, `@repo/formatting`, `@repo/observability`,
  // `@repo/chapter-theme`, `@repo/theme` and `@repo/api-sdk` unit tests;
  // plus `npm run check:brand-assets` and `npm run check:edge-functions`
  // (Deno fmt, lint, check and test over `supabase/functions/`).
  "lint-and-typecheck",
  // `docker build -f apps/api/Dockerfile .` — the API image compile path.
  "api-docker-build",
  // API Jest suites: `test`, `test:e2e` and `test:ai-evals`, all three
  // unconditional (`.github/workflows/ci.yml`). Not unit tests alone.
  "api-tests",
  // openapi.json + api-sdk freshness, and oasdiff compatibility with every
  // shipped mobile build in apps/mobile/store/shipped-builds.json.
  "api-contract-check",
  // Migration filename + promotion/rollback doc validation.
  "migration-safety",
  // Mobile iOS production bundle (`expo export`, before any package build) +
  // lint + typecheck + Vitest unit tests + `expo prebuild`.
  "mobile-validate",
  // `node --test` over `scripts/ci/__tests__/` (`npm run test:ci-scripts`),
  // covering the gate and deploy scripts under both `scripts/` and
  // `scripts/ci/`, plus every `*.test.sh` shell suite (#802).
  "ci-scripts-tests",
  // Secret scanning (gitleaks; ADR-17).
  // ROLLOUT: list a check in the PR that adds its job; listing writes nothing to
  // GitHub. Apply branch protection only after that PR merges and the job has run
  // green, or every open PR blocks on a context nobody reports. Applying is a
  // human step with an admin PAT, and a live PUT of the whole roster; an agent
  // session runs only `npm run configure:branch-protection:verify`, which writes
  // nothing (docs/ops/github-branch-protection-runbook.md § Prerequisites, which
  // also covers the `--dry-run` separator trap). The notes below that say "same
  // caveat as secret-scan" inherit this one.
  "secret-scan",
  // `npm ci && check-types && lint` with no prebuilt packages, so a regression
  // in turbo.json's `^build` dependency fails here. ROLLOUT: same caveat as
  // secret-scan.
  "clean-checkout-typecheck",
  // npm audit gate (#618): any high/critical advisory not allowlisted in
  // scripts/npm-audit-allowlist.json fails. ROLLOUT: same caveat as secret-scan.
  "dependency-audit",
  // supabase/seed/chapter_directory.csv: canonical #RRGGBB colors, real
  // archetypes, no duplicate natural keys (#840). Blocking because the accent
  // engine turns a malformed hex into a plausible wrong color, not an error.
  // ROLLOUT: same caveat as secret-scan.
  "chapter-directory-seed",
  // apps/web + packages/hooks and chat-core, the only suite covering
  // packages/hooks. Path-gated by a job-level `if:`, which reports
  // Success when skipped, so it can still be required (ADR-15 amendment
  // 2026-08-19). ROLLOUT: same caveat as secret-scan.
  "web-tests",
  // Required only because the path-gated jobs need it: a job skipped for a
  // failed `needs:` parent reports `skipped`, which satisfies a required check,
  // so every parent of a required check must be required too (ADR-15 amendment
  // 2026-08-19). It always runs: its condition is on the filter step, not the job.
  "changes",
  // Every dashboard route renders without horizontal scroll at 375px (#1152,
  // spec/ui/web-dashboard/README.md). No baseline and no pixels, so nothing to
  // flake on (docs/ci-cd/quality-gates.md). ROLLOUT: same caveat as secret-scan.
  "web-responsive-floor",
  // The landing fold holds the reskin boards' geometry and reveal behaviour
  // (#2368), measured against a production build because `next dev` never arms
  // the reveals (apps/landing/playwright.config.ts). Same no-baseline lane as
  // web-responsive-floor. ROLLOUT: same caveat as secret-scan.
  "landing-fold",
  // Architectural boundaries (dependency-cruiser) against the shrink-only
  // baseline in scripts/dependency-cruiser-known-violations.json
  // (docs/ci-cd/quality-gates.md § dependency-cruiser). ROLLOUT: same caveat as
  // secret-scan.
  "dependency-cruiser",
  // Builds apps/web and apps/landing on a `npm ci --omit=dev` tree, the shape of
  // Vercel's production install; #1331 and #1372 reached production through
  // that gap (#1371). Unfiltered by path, because `changes.web` does not cover
  // apps/landing. ROLLOUT: same caveat as secret-scan. Applying is a human step
  // with an admin PAT; an agent session runs
  // `npm run configure:branch-protection:verify`.
  "web-production-build",
  // Every migration applied from empty to PGlite, asserting RLS on every
  // `public` table, the chat hot-path policies, an append-only
  // `chapter_audit_log` and `pg_temp` pinned last in `SECURITY DEFINER`
  // functions (`scripts/check-pglite-migrations.mjs`). Required since #2538.
  // Its `changes.pglite` filter must list every file the check reads, or a
  // missed input merges green. ROLLOUT: same caveat as secret-scan.
  "pglite-migrations",
  // NOT here on purpose: `duplicate-detection` (jscpd) is advisory, because a
  // repo-wide percentage is too coarse to block on (docs/ci-cd/quality-gates.md
  // § jscpd).
];

// Empty on purpose: no docs check is required, and a gate that only demands a
// doc write must not come back (docs/ci-cd/docs-ci.md, #1597). Kept exported
// because it feeds `ALL_REQUIRED_CHECKS`.
export const DOCS_CHECKS = [];

// Checks emitted by .github/workflows/migration-drift-gate.yml. `migration-drift`
// is NOT here on purpose: it judges staging against `main`, which a PR cannot
// change, so requiring it froze the repo in #1373
// (docs/ops/github-branch-protection-runbook.md § Required Status Checks).
export const DRIFT_CHECKS = [
  // No migration this change introduces sorts before a version staging or
  // production has already applied; the Supabase CLI refuses that outright
  // (#1373). It reads only introduced migrations, so a PR can always answer it
  // (docs/ops/database/drift-and-ordering.md). ROLLOUT: same caveat as
  // secret-scan; a green run on a migration-free change proves only that the job
  // starts, and the evidence both projects are readable is the
  // `migration-snapshot.yml` publish summary (#2518).
  "migration-order",
  // The migrations a PR adds apply to a disposable stack rebuilt at production's
  // applied state, through the same CLI path as `run-migration.mjs`; production
  // is never contacted (#2518). Does real work only when the PR touches
  // `supabase/migrations/**`. ROLLOUT: same caveat as secret-scan.
  "migration-replay",
];

export const ALL_REQUIRED_CHECKS = [...CI_CHECKS, ...DOCS_CHECKS, ...DRIFT_CHECKS];
