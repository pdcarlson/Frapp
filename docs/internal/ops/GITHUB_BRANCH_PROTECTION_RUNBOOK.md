# GitHub Branch Protection Runbook

## Purpose

Configure merge-blocking branch protections for `main` and `production`. This ensures:

- All required CI checks pass before merge
- PRs to `production` must come from `main`
- No force pushes, no direct commits, no bypasses (even for admins)

## Prerequisites

1. A GitHub Personal Access Token (PAT) with repository administration permissions:
   - **Fine-grained PAT:** Repository administration: Read & write
   - **Classic PAT:** `repo` scope
2. Export the token in your shell using the canonical hosted-agent name. The token must have the permissions above; do not rely on the GitHub Actions runtime token unless it has equivalent administration scope.

```bash
export GITHUB_PAT=<token>
export GH_TOKEN="$GITHUB_PAT"   # gh/git read GH_TOKEN, not GITHUB_PAT
```

> **Which env var the script reads.** `scripts/configure-branch-protection.mjs` resolves the token from,
> in order: `GITHUB_PAT` → `GITHUB_TOKEN` → `GH_PAT` → `GH_TOKEN` (or `--token-env <NAME>` to name a
> custom var). `GITHUB_PAT` is the canonical name and is what the Claude Code hosted environment injects,
> so `npm run configure:branch-protection` works there without extra setup. The repo slug comes from
> `--repo owner/repo`, `GITHUB_REPOSITORY`, or the `origin` remote.

## Step 1: Dry Run (Review Before Applying)

```bash
npm run configure:branch-protection -- --dry-run
```

This prints the exact configuration that will be applied without making any changes. Review the output carefully.

## Step 2: Apply

```bash
npm run configure:branch-protection
```

Or with explicit repo:

```bash
npm run configure:branch-protection -- --repo pdcarlson/Frapp
```

## What Gets Configured

### Both branches (main and production)

| Setting                     | Value                                                          |
| --------------------------- | -------------------------------------------------------------- |
| Required status checks      | See table below                                                |
| Require branches up to date | Yes                                                            |
| Enforce admins              | Yes                                                            |
| Linear history              | Yes                                                            |
| Force pushes                | Blocked                                                        |
| Deletions                   | Blocked                                                        |
| Conversation resolution     | Branch-specific (disabled on `main`, required on `production`) |

### Branch-specific PR review rules

| Branch       | Required approving reviews | Dismiss stale reviews | Require conversation resolution |
| ------------ | -------------------------- | --------------------- | ------------------------------- |
| `main`       | Disabled                   | N/A                   | Disabled                        |
| `production` | 1                          | Enabled               | Enabled                         |

### Required Status Checks

**CI checks (from `.github/workflows/ci.yml`):**

| Check name           | What it validates                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `packages-build`     | Shared packages compile                                                                         |
| `lint-and-typecheck` | ESLint + TypeScript (all workspaces); `npm run build -w apps/api` (`nest build`, Render parity); landing plus `@repo/validation`, `@repo/color`, `@repo/chapter-theme`, and `@repo/api-sdk` unit tests |
| `api-docker-build`   | `docker build -f apps/api/Dockerfile .` (API image compile path)                                |
| `api-tests`          | API Jest unit tests                                                                             |
| `api-contract-check` | openapi.json + api-sdk freshness                                                                |
| `migration-safety`   | Migration filename + docs validation                                                            |
| `mobile-validate`    | Mobile lint + typecheck + Vitest unit tests                                                     |
| `ci-scripts-tests`   | `node --test` unit tests for deploy-gate scripts under `scripts/ci/`                            |
| `secret-scan`        | gitleaks over the PR/push commit range (ADR-13 push-protection replacement)                     |
| `clean-checkout-typecheck` | Bare `npm ci` + typecheck + lint with no prebuilt packages (guards `turbo.json` `^build`) |
| `dependency-audit`   | npm audit gate: any high/critical advisory not allowlisted in `scripts/npm-audit-allowlist.json` fails (issue #618) |
| `chapter-directory-seed` | `supabase/seed/chapter_directory.csv`: canonical `#RRGGBB` colors, real archetypes, no duplicate natural keys (issue #840) |
| `web-tests`          | `apps/web` + the shared packages only this suite covers (`packages/hooks`, `packages/chat-core`) |
| `changes`            | Path filter deciding whether `web-tests` runs; required only because `web-tests` needs it |
| `dependency-cruiser` | Architectural boundaries (API layer direction, package/app separation, cycles) against a committed baseline — [`QUALITY_GATES.md`](../ci-cd/QUALITY_GATES.md) |

**A path-gated job can still be required.** `web-tests` runs only when the `changes` filter matches (`apps/web/**`, `packages/**`, the lockfile, `turbo.json`), and that is compatible with being required: GitHub reports a job skipped by a **job-level** conditional as *Success*, and `success` / `skipped` / `neutral` all satisfy a required check. The blocking case is a whole **workflow** skipped by path or branch filtering, whose checks never report at all — `ci.yml` has no workflow-level `paths:` filter, so it cannot happen here. See [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).

**Not required on branches (informational):** `web-visual-regression` from `.github/workflows/ci.yml` runs Playwright snapshots on `main` / `production` PRs and pushes but is intentionally omitted from [`scripts/configure-branch-protection.mjs`](../../../scripts/configure-branch-protection.mjs) so merges are not blocked by visual flake; treat failures as a signal to investigate or update snapshots. `pglite-migrations` is likewise advisory, as is `duplicate-detection` — jscpd has no clone-level baseline, so its only lever is a repo-wide percentage, which is too coarse to block a merge on ([`QUALITY_GATES.md`](../ci-cd/QUALITY_GATES.md)).

> **Script vs live drift — check before you assume.** The arrays in the script are the *intended* state; the live config is whatever the last manual run applied. As of 2026-08-19 the live `main` protection carried 12 contexts and was missing `chapter-directory-seed`, which had been listed in the script since #840. Running `npm run configure:branch-protection` applies **everything** in the arrays, not just the entry you added — read the `--dry-run` output in full before applying.

**Docs check (from `.github/workflows/docs.yml`):**

| Check name       | What it validates                                                     |
| ---------------- | --------------------------------------------------------------------- |
| `docs-spec-sync` | Docs/spec sync on PRs (`check-docs-impact.mjs`; no `apps/docs` build) |

### Vercel policy (not a required check)

Vercel deployments are intentionally limited to `main` and `production` branches via `git.deploymentEnabled` in each app `vercel.json`. This keeps PR traffic from consuming Vercel build quota while CI remains the merge gate.

**production branch only:**

| Check name      | What it validates            |
| --------------- | ---------------------------- |
| `branch-policy` | Source branch must be `main` |

### Future: require deploy verification on production

The `verify-deployments` workflow (`.github/workflows/verify-deployments.yml`) polls Render and Vercel after every push to `main` and `production` and emits three status contexts: `verify-render-api`, `verify-vercel-web`, `verify-vercel-landing`. These are **not** currently required on `production`, but they are designed to become so once the workflow has stabilized.

Recipe to mark them required on `production` (do not run until the workflow has succeeded on at least one production push so GitHub knows the check names):

1. Verify the checks have already reported against a production push:

   ```bash
   gh api \
     repos/pdcarlson/Frapp/commits/$(git rev-parse origin/production)/check-runs \
     | jq -r '.check_runs[].name'
   ```

2. Add the three context names to the production required-checks list in [`scripts/configure-branch-protection.mjs`](../../../scripts/configure-branch-protection.mjs).

3. Dry-run and apply:

   ```bash
   npm run configure:branch-protection -- --dry-run
   npm run configure:branch-protection
   ```

Do **not** mark these required on `main` — staging deploys are allowed to fail without blocking `main` churn.

### AI review policy

There is **no AI-review required check.** Code review is a **local pre-push gate**
(`.claude/hooks/pre-push-review-gate.sh` requires `/diff-review` or `/code-review` before the branch is pushed) — the former
`claude-review-gate` CI check was removed (2026-06-04, ADR-14 amendment). See
[`AI_CODE_REVIEW_RUNBOOK.md`](../ci-cd/AI_CODE_REVIEW_RUNBOOK.md).

## Troubleshooting: checks stuck on "Expected — Waiting for status to be reported"

Use this sequence:

1. Inspect what branch protection currently requires:

```bash
gh api repos/pdcarlson/Frapp/branches/main/protection
```

1. Inspect what the PR actually reported:

```bash
gh pr checks <PR_NUMBER>
```

1. Compare names exactly (including capitalization and punctuation):
   - Required checks use emitted check-run names (`api-tests`, `docs-spec-sync`)

Common causes and fixes:

- **Workflow path filters + required checks:** if a required workflow is skipped by `paths`, GitHub waits forever for a check that never runs.  
  **Fix:** required workflows must run on every PR to protected branches.
- **Job/workflow renames:** required check name no longer matches emitted name.  
  **Fix:** update `scripts/configure-branch-protection.mjs` and re-run `npm run configure:branch-protection`.
- **Stale required check reference:** a required context name no longer exists because the underlying workflow was removed.  
  **Fix:** remove the orphan context from the production protection payload (`scripts/configure-branch-protection.mjs` plus `gh api -X DELETE repos/<owner>/<repo>/branches/production/protection/required_status_checks/contexts -f 'contexts[]=<orphan>'`) and re-run the branch-protection script.

## Verification Checklist

After running the script, verify in the GitHub UI (Settings → Branches):

- [ ] Branch protection rules exist for `main` and `production`
- [ ] All required status checks are listed
- [ ] "Include administrators" is checked
- [ ] "Require linear history" is checked
- [ ] "Require conversation resolution" is checked
- [ ] Test: create a PR with a deliberate lint failure → verify merge is blocked

## Emergency Override

If you need to merge urgently and a check is broken:

1. Go to GitHub → Settings → Branches → Edit protection rule
2. Temporarily remove the broken check from the required list
3. Merge the PR
4. **Immediately re-add the check** (run `npm run configure:branch-protection` again)
5. Document the override in the PR description

## Updating Check Names

If CI job names change (e.g., renaming a workflow job), update:

1. `scripts/configure-branch-protection.mjs` — `CI_CHECKS`, `DOCS_CHECKS` arrays
2. This runbook — required checks tables
3. `CONTRIBUTING.md` — required checks section
4. `spec/environments/README.md` — CI job matrix
5. Re-run `npm run configure:branch-protection` to apply the new names
