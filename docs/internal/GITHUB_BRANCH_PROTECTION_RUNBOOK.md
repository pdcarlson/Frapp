# GitHub Branch Protection Runbook

## Purpose

Configure merge-blocking branch protections for `main` and `production`. This ensures:

- All required CI checks pass before merge
- CodeRabbit review is addressed before merge
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
| `lint-and-typecheck` | ESLint + TypeScript (all workspaces) |
| `api-tests` | API Jest unit tests |
| `api-contract-check` | openapi.json + api-sdk freshness |
| `migration-safety` | Migration filename + docs validation |
| `mobile-validate` | Mobile lint + typecheck |

**Docs check (from `.github/workflows/docs.yml`):**

| Check name | What it validates |
| --- | --- |
| `build-and-lint` | Docs build + lint + spec sync |

### Vercel policy (not a required check)

Vercel deployments are intentionally limited to `main` and `production` branches via `git.deploymentEnabled` in each app `vercel.json`. This keeps PR traffic from consuming Vercel build quota while CI remains the merge gate.

**production branch only:**

| Check name | What it validates |
| --- | --- |
| `branch-policy` | Source branch must be `main` |

### CodeRabbit (Review-Based Blocker)

CodeRabbit is configured with `request_changes_workflow: true`. When it finds issues, it posts a "Request Changes" review.

- On `main`, this feedback is advisory (no required approving review gate).
- On `production`, branch protection requires one approval and stale reviews are dismissed on push, so CodeRabbit/human review remains a merge-control gate.

`CodeRabbit` is intentionally **not** a required status check. It is enforced through PR reviews only.

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
   - Required checks use emitted check-run names (`api-tests`, `build-and-lint`)

Common causes and fixes:

- **Workflow path filters + required checks:** if a required workflow is skipped by `paths`, GitHub waits forever for a check that never runs.  
  **Fix:** required workflows must run on every PR to protected branches.
- **Job/workflow renames:** required check name no longer matches emitted name.  
  **Fix:** update `scripts/configure-branch-protection.mjs` and re-run `npm run configure:branch-protection`.
- **External app outage/stuck status (CodeRabbit):** review gate does not finalize.  
  **Fix:** rerun provider check or temporarily dismiss stale review per review policy.

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
