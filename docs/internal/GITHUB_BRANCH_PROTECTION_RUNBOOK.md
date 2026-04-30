# GitHub Branch Protection Runbook

## Purpose

Configure merge-blocking branch protections for `main` and `production`. This ensures:

- All required CI checks pass before merge
- The Claude Code Action reviews every PR to `main` and `production` (advisory)
- PRs to `production` must come from `main`
- No force pushes, no direct commits, no bypasses (even for admins)

## Prerequisites

1. A GitHub Personal Access Token (PAT) with repository administration permissions:
   - **Fine-grained PAT:** Repository administration: Read & write
   - **Classic PAT:** `repo` scope
2. Export the token in your shell:

```bash
export GITHUB_PAT=ghp_your_token_here
```

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

| Setting | Value |
| --- | --- |
| Required status checks | See table below |
| Require branches up to date | Yes |
| Enforce admins | Yes |
| Linear history | Yes |
| Force pushes | Blocked |
| Deletions | Blocked |
| Conversation resolution | Branch-specific (disabled on `main`, required on `production`) |

### Branch-specific PR review rules

| Branch | Required approving reviews | Dismiss stale reviews | Require conversation resolution |
| --- | --- | --- | --- |
| `main` | Disabled | N/A | Disabled |
| `production` | 1 | Enabled | Enabled |

### Required Status Checks

**CI checks (from `.github/workflows/ci.yml`):**

| Check name | What it validates |
| --- | --- |
| `packages-build` | Shared packages compile |
| `lint-and-typecheck` | ESLint + TypeScript (all workspaces); `npm run build -w apps/api` (`nest build`, Render parity) |
| `api-docker-build` | `docker build -f apps/api/Dockerfile .` (API image compile path) |
| `api-tests` | API Jest unit tests |
| `api-contract-check` | openapi.json + api-sdk freshness |
| `migration-safety` | Migration filename + docs validation |
| `mobile-validate` | Mobile lint + typecheck |
| `ci-scripts-tests` | `node --test` unit tests for deploy-gate scripts under `scripts/ci/` |

**Not required on branches (informational):** `web-visual-regression` from `.github/workflows/ci.yml` runs Playwright snapshots on `main` / `production` PRs and pushes but is intentionally omitted from [`scripts/configure-branch-protection.mjs`](../../scripts/configure-branch-protection.mjs) so merges are not blocked by visual flake; treat failures as a signal to investigate or update snapshots.

**Docs check (from `.github/workflows/docs.yml`):**

| Check name | What it validates |
| --- | --- |
| `docs-spec-sync` | Docs/spec sync on PRs (`check-docs-impact.mjs`; no `apps/docs` build) |

### Vercel policy (not a required check)

Vercel deployments are intentionally limited to `main` and `production` branches via `git.deploymentEnabled` in each app `vercel.json`. This keeps PR traffic from consuming Vercel build quota while CI remains the merge gate.

**production branch only:**

| Check name | What it validates |
| --- | --- |
| `branch-policy` | Source branch must be `main` |

### Future: require deploy verification on production

The `verify-deployments` workflow (`.github/workflows/verify-deployments.yml`) polls Render and Vercel after every push to `main` and `production` and emits three status contexts: `verify-render-api`, `verify-vercel-web`, `verify-vercel-landing`. These are **not** currently required on `production`, but they are designed to become so once the workflow has stabilized.

Recipe to mark them required on `production` (do not run until the workflow has succeeded on at least one production push so GitHub knows the check names):

1. Verify the checks have already reported against a production push:

   ```bash
   GITHUB_TOKEN="${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}" gh api \
     repos/pdcarlson/Frapp/commits/$(git rev-parse origin/production)/check-runs \
     | jq -r '.check_runs[].name'
   ```

2. Add the three context names to the production required-checks list in [`scripts/configure-branch-protection.mjs`](../../scripts/configure-branch-protection.mjs).

3. Dry-run and apply:

   ```bash
   GITHUB_PAT="${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}" npm run configure:branch-protection -- --dry-run
   GITHUB_PAT="${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}" npm run configure:branch-protection
   ```

Do **not** mark these required on `main` — staging deploys are allowed to fail without blocking `main` churn.

### AI review policy

The AI PR review (`anthropics/claude-code-action@v1`) is advisory on both branches. There is no `claude-review` required status check. See [`CLAUDE_REVIEW_RUNBOOK.md`](./CLAUDE_REVIEW_RUNBOOK.md) for how the action is configured and triggered.

## Troubleshooting: checks stuck on "Expected — Waiting for status to be reported"

Use this sequence:

1. Inspect what branch protection currently requires:

```bash
GITHUB_TOKEN="$GITHUB_PAT" gh api repos/pdcarlson/Frapp/branches/main/protection
```

2. Inspect what the PR actually reported:

```bash
GITHUB_TOKEN="$GITHUB_PAT" gh pr checks <PR_NUMBER>
```

3. Compare names exactly (including capitalization and punctuation):
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
4. `spec/environments.md` — CI job matrix
5. Re-run `npm run configure:branch-protection` to apply the new names
