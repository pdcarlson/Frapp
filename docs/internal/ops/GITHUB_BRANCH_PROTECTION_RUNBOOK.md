# GitHub Branch Protection Runbook

## Purpose

Configure merge-blocking branch protections for `main`, the repository's only long-lived
branch. This ensures:

- All required CI checks pass before merge
- No force pushes, no direct commits, no bypasses (even for admins)

> **`production` was retired in #1340.** This runbook used to configure two branches with
> asymmetric policy. Production is now deployed from a named commit on `main` by
> `.github/workflows/deploy-production.yml`, and the two things `production`'s protection
> bought have moved:
>
> - the `branch-policy` required check (PR into `production` must come from `main`) is now
>   `git merge-base --is-ancestor` inside `scripts/ci/validate-deploy-sha.mjs`, which also
>   asserts CI was green on the exact commit being deployed;
> - the 1 required approving review is now the `production` **GitHub Environment**'s
>   Required reviewers, which pauses the deploy itself.
>
> `configure-branch-protection.mjs` no longer writes a `production` payload, but it does
> **not delete** one that already exists. Removing the orphaned rule is a manual step in
> Settings → Branches.

## Prerequisites

1. A GitHub Personal Access Token (PAT) with repository administration permissions:
   - **Fine-grained PAT:** Repository administration: Read & write
   - **Classic PAT:** `repo` scope
2. Provide the token using the canonical hosted-agent name, either by exporting it or by putting it in an env file at the repo root. The token must have the permissions above; do not rely on the GitHub Actions runtime token unless it has equivalent administration scope.

```bash
export GITHUB_PAT=<token>
export GH_TOKEN="$GITHUB_PAT"   # gh/git read GH_TOKEN, not GITHUB_PAT
```

Or, to avoid re-exporting every shell — both files are gitignored:

```bash
echo 'GITHUB_PAT=<token>' >> .env
```

> **Which env var the script reads.** `scripts/configure-branch-protection.mjs` resolves the token from,
> in order: `GITHUB_PAT` → `GITHUB_TOKEN` → `GH_PAT` → `GH_TOKEN` (or `--token-env <NAME>` to name a
> custom var). `GITHUB_PAT` is the canonical name. The repo slug comes from `--repo owner/repo`,
> `GITHUB_REPOSITORY`, or the `origin` remote.
>
> **The value may come from `.env.local` or `.env` at the repo root**, not just from an exported
> variable — the script loads them through `scripts/lib/env-file.mjs`. Precedence is the one
> `apps/api/src/app.module.ts` already uses for the API: an **exported variable beats both files**,
> and `.env.local` beats `.env`. So a stale `.env` left in a checkout can never shadow a token you
> exported deliberately. Before this loading existed, a token sitting in `.env` failed with
> "Missing GitHub token" and only worked once exported by hand.
>
> The same files also supply `GITHUB_REPOSITORY`, since they are loaded before the slug is
> resolved — `--repo` still overrides both.

> **This script cannot be run from a Claude Code hosted session — it is a human step.** The hosted
> environment does inject `GITHUB_PAT`, which is why this runbook used to claim the script "works there
> without extra setup". It does not. That token authenticates (`GET /user` → 200) but **every
> repo-scoped REST path is refused by the session gateway with 403** — the body reads
> `GitHub access is not enabled for this session` — and the script talks to `api.github.com` directly
> via `fetch` rather than through the GitHub MCP server that agent sessions use. Verified 2026-08-27 against
> `GET /repos/pdcarlson/Frapp/branches/main/protection` → 403.
>
> **The refusal happens at the session's egress gateway, not at GitHub — so do not go regenerate the PAT
> with broader scopes.** The 403 carries no `Server: github.com` and no `X-Github-Request-Id`, while
> `GET /user` from the same session returns both; the repo-scoped request never reaches GitHub at all.
> The GitHub MCP server does hold repo write access — it is how agent sessions push branches, open PRs
> and comment — but it exposes no branch-protection tool, so there is no sanctioned agent path to this
> setting at all.
>
> What this leaves an agent is the preparation: confirm every intended context has reported green on the
> target branch, and confirm the job names match the array strings exactly. Both are the preconditions
> that make an apply safe, and both are checkable through the MCP server. But **applying it requires a
> human running the script locally with an admin PAT**. That is why
> promoting a check to required is filed as a `[human]` issue rather than picked up by `/next`.

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

### `main`

| Setting                     | Value           |
| --------------------------- | --------------- |
| Required status checks      | See table below |
| Require branches up to date | Yes             |
| Enforce admins              | Yes             |
| Linear history              | Yes             |
| Force pushes                | Blocked         |
| Deletions                   | Blocked         |
| Conversation resolution     | Disabled        |
| Required approving reviews  | Disabled        |

No required human approval on merge is deliberate and unchanged: review is the local
pre-push gate, and the human gate on what reaches users is the production deploy
approval, not the merge.

### Required Status Checks

**CI checks (from `.github/workflows/ci.yml`):**

| Check name           | What it validates                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `packages-build`     | Shared packages compile                                                                         |
| `lint-and-typecheck` | ESLint + TypeScript (all workspaces); `npm run build -w apps/api` (`nest build`, Render parity); landing plus `@repo/validation`, `@repo/color`, `@repo/formatting`, `@repo/chapter-theme`, `@repo/theme`, and `@repo/api-sdk` unit tests |
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
| `web-tests`          | `apps/web` + the shared packages only this suite covers (`packages/hooks`, `packages/chat-core`, `packages/chat-integrations`) |
| `changes`            | Path filter deciding whether `web-tests` and `web-responsive-floor` run; required only because they need it |
| `dependency-cruiser` | Architectural boundaries (API layer direction, package/app separation, cycles) against a committed baseline — [`QUALITY_GATES.md`](../ci-cd/QUALITY_GATES.md) |
| `web-production-build` | Builds web and landing on a devDependency-pruned tree, matching the Vercel production install — [`AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md) |
| `web-responsive-floor` | Every dashboard route renders without horizontal scroll at 375px ([`responsive-floor.spec.ts`](../../../apps/web/tests/visual/responsive-floor.spec.ts)). Playwright, but no baseline and no pixel comparison |

**A path-gated job can still be required.** `web-tests` and `web-responsive-floor` run only when the `changes` filter matches (`apps/web/**`, `packages/**`, the lockfile, `turbo.json`), and that is compatible with being required: GitHub reports a job skipped by a **job-level** conditional as *Success*, and `success` / `skipped` / `neutral` all satisfy a required check. The blocking case is a whole **workflow** skipped by path or branch filtering, whose checks never report at all — `ci.yml` has no workflow-level `paths:` filter, so it cannot happen here. See [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).

**Not required on branches (informational):** `pglite-migrations` is advisory, as is `duplicate-detection` — jscpd has no clone-level baseline, so its only lever is a repo-wide percentage, which is too coarse to block a merge on ([`QUALITY_GATES.md`](../ci-cd/QUALITY_GATES.md)). Both are intentionally omitted from [`scripts/configure-branch-protection.mjs`](../../../scripts/configure-branch-protection.mjs).

> **`web-visual-regression` is gone — don't re-add it to any roster.** It ran Playwright **snapshots** and was advisory, because baselines pinned to CI's Chromium build drift with it. Until #1152 the 375px floor gate ran inside it and inherited that posture by sharing a directory, so a breached floor was a red mark a PR could merge past; #1152 split the floor into its own **required** `web-responsive-floor` job, and the snapshot job has since been deleted outright along with its spec and baselines ([`QUALITY_GATES.md`](../ci-cd/QUALITY_GATES.md)). If a stale live branch-protection config still lists it, a `npm run configure:branch-protection` run clears it — the script's arrays are the intent.

> **Script vs live drift — check before you assume.** The arrays in the script are the *intended* state; the live config is whatever the last manual run applied, and the two drift apart silently because only a human re-run closes the gap. It has happened before: `main` sat at 12 contexts against 17 intended until a run on **2026-08-21** closed the gap. Verified **2026-08-27**: `main` carried all **19** intended contexts with nothing extra — script and live agreed, `web-responsive-floor` and `migration-drift` included. **They no longer do:** #1374 raised the intent to **21** by adding `web-production-build`, and the migration-correctness pass then swapped `migration-drift` out for `migration-order` — still **21**, but two entries different. No run has happened since either change, so live still carries `migration-drift` and lacks both new checks until `npm run configure:branch-protection` is run. Until then those checks report but do not block **merges** — the inverse of the usual hazard, and just as bad, since `web-production-build` exists to stop a `next build`-breaking change reaching production.
>
> **"Not applied yet" does NOT mean "not enforced anywhere".** `scripts/ci/validate-deploy-sha.mjs` imports `ALL_REQUIRED_CHECKS` from the script directly rather than reading GitHub's live config, so a check is **blocking on the production deploy path from the moment it is added to the array** — before any `configure:branch-protection` run, and whether or not branch protection has ever heard of it. The asymmetry is deliberate (a `workflow_dispatch` has no PR and therefore no required checks, so the deploy gate has to ask the checks API against some list) but it is easy to be surprised by: a PR can merge with `migration-order` red and then be undeployable. Read the array as the deploy gate's live config and branch protection's *intended* one. Any count written here is a dated observation, not a source of truth — the arrays are the intent, and only a re-run makes it live. Read live state from the API:
>
> ```sh
> gh api repos/pdcarlson/Frapp/branches/main/protection/required_status_checks --jq '.contexts'
> ```
>
> Running `npm run configure:branch-protection` applies **everything** in the arrays, not just the entry you added, and PUTs the whole payload — anything set by hand outside the arrays is overwritten. Read the `--dry-run` output in full before applying.

**Docs check (from `.github/workflows/docs.yml`):**

| Check name       | What it validates                                                     |
| ---------------- | --------------------------------------------------------------------- |
| `docs-spec-sync` | Docs/spec sync **and** structure on PRs (`check-docs-impact.mjs` + `check-docs-structure.mjs`) |
| `doc-paths`      | Backticked repo-path citations resolve to real files (`check-doc-paths.mjs`, whole-tree) |
| `doc-tables`     | Hand-copied required-check rosters and per-job suite lists match `CI_CHECKS` / `DOCS_CHECKS` and `ci.yml` (`check-doc-tables.mjs`) — **not required yet**, see [`DOCS_CI.md`](../ci-cd/DOCS_CI.md) |

**Migration checks (from `.github/workflows/migration-drift-gate.yml`):**

| Check name         | What it validates                                                     |
| ------------------ | --------------------------------------------------------------------- |
| `migration-order`  | No migration this change **introduces** sorts before a version staging or production has already applied (`check-migration-order.mjs`). The Supabase CLI refuses that outright — measured against the pinned 2.77.0: exit 1, nothing applied, "Found local migration files to be inserted before the last migration on remote database". That is #1373, which halted staging's migration deploy |
| `migration-drift`  | Staging holds every migration on `main` (`check-migration-drift-gate.mjs`). **Reports only — deliberately NOT required**, see the note below. Still runs on every PR and every push to `main` |
| `migration-replay` | Pending migrations apply cleanly to a disposable Supabase stack rebuilt at **production's** currently-applied state (`check-migration-replay.mjs`). Rehearses the incremental apply that `deploy-production.yml` is about to perform for real; production itself is only read, never written. The deploy workflow runs the same gate again at deploy time, against production's state as of that moment |

> **`migration-drift` was demoted from the required set — don't put it back without reading this.** It compares `origin/main` against staging, so it asserts something about two things the PR in front of it neither contains nor can change. As a required check that makes it a repo-wide merge-freeze switch rather than a gate, and #1373 used it as one: one back-dated migration filename halted staging's apply and every open PR in the repository became unmergeable until a human intervened. Its own escape hatch — dropping the context by hand for the duration — is an admin edit to branch protection made under outage pressure, which is the worst moment to be making one. Detection is not lost: the scheduled [`check-migration-drift.yml`](../../../.github/workflows/check-migration-drift.yml) runs the same comparison daily across staging **and** production and files a self-closing P1 issue, and the PR job still reports. `migration-order` replaced it as the gate, asking the same failure class scoped to what the change introduces — which a PR can answer, and which a PR that *fixes* an ordering fault turns green.

**`migration-drift` (reporting only).** It compares `origin/main` against staging's applied migration history, **not** the PR head, and tolerates a migration for 30 minutes from the moment it landed on `main` — the window `migrate-staging` needs to apply it. It is the check that would have caught two migrations merging to `main` and never reaching staging, and it still detects exactly that; it simply no longer blocks the merge. A red `migration-drift` on your PR means staging is out of sync for everyone and the schema your tests ran against is not the schema on staging. Worth fixing, no longer worth freezing the repository over.

**`migration-order` (required).** It reads only the migrations the change *introduces* (head minus base), so a PR touching no migrations makes zero network calls and cannot be blocked by unrelated state or by the Supabase Management API being unreachable — the two properties that make it requirable where `migration-drift` was not. It has two rules: nothing introduced may sort before a migration already on the base branch (no database consulted, so it holds on forks and during an outage), and nothing introduced may sort before the newest version staging or production has already applied. A PR that *fixes* an ordering fault turns its own check green, because the renamed file is the introduced one.

Because it does reach the Management API on migration-bearing changes, a sustained Supabase outage blocks *those* merges — transient blips are absorbed by bounded retries, and a real outage is meant to be loud rather than silently green. If such a merge genuinely cannot wait, drop the `migration-order` context deliberately for the duration; the blast radius of doing so is one class of PR, not the whole repository.

### Vercel policy (not a required check)

Vercel deployments are intentionally limited to the `main` branch via
`git.deploymentEnabled` in each app `vercel.json`. This keeps PR traffic from consuming
Vercel build quota while CI remains the merge gate. Production Vercel deployments are not
branch-driven at all — `deploy-production.yml` creates them through the API for a named
commit.

### Deploy verification is no longer a branch-protection question

`verify-deployments.yml` polls Render and Vercel after a push to `main` and emits
`verify-render-api`, `verify-vercel-web`, `verify-vercel-landing`. This runbook used to
carry a recipe for promoting those three to required checks **on `production`**, once the
workflow had stabilised.

That recipe is gone, and not because it was abandoned: the thing it wanted is now
structural. Production deploy verification happens *inside* `deploy-production.yml`,
synchronously, polling the deployment IDs it was handed — so a failed production deploy
fails the release rather than reporting after the fact on a branch. A required check on a
branch could never have done that.

Do **not** mark these required on `main` — staging deploys are allowed to fail without
blocking `main` churn.

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
  **Fix:** remove the orphan context from `ALL_REQUIRED_CHECKS` in `scripts/configure-branch-protection.mjs`, then `gh api -X DELETE repos/<owner>/<repo>/branches/main/protection/required_status_checks/contexts -f 'contexts[]=<orphan>'`, and re-run the branch-protection script.

## Verification Checklist

After running the script, verify in the GitHub UI (Settings → Branches):

- [ ] A branch protection rule exists for `main`
- [ ] All required status checks are listed
- [ ] "Include administrators" is checked
- [ ] "Require linear history" is checked
- [ ] No leftover rule for `production` (the script stopped writing one in #1340 but cannot delete an existing rule — remove it by hand)
- [ ] Test: create a PR with a deliberate lint failure → verify merge is blocked

Separately, in Settings → **Environments** → `production`:

- [ ] **Required reviewers** is enabled. This is the only human gate on a production
      deploy since #1340. To confirm it is actually active, dispatch **Deploy production**
      with *Stop after the dry run* checked and watch the job: an environment-gated job
      parks on "Waiting for approval", while an ungated one starts in about two seconds.

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
5. `docs/internal/ci-cd/DOCS_CI.md` — the docs-gate table and its **Required?** column
6. Re-run `npm run configure:branch-protection` to apply the new names

This list is the drift engine, not a safety net — one source and four hand-kept copies is why
`@repo/theme` and `packages/chat-integrations` went missing from every table at once. Steps 2–4 are
now asserted by `npm run check:doc-tables`; step 5 is not, and is the copy to watch. Prefer
deleting a copy and linking to the script over adding a seventh step, and state posture as *intended*
(what the arrays say) rather than *live* (what an admin last applied), which no doc can keep true.
