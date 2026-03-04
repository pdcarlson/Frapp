# GitHub Branch Protection + Review Bot Setup

## Purpose

This runbook configures merge-blocking branch protections and review automation for:

- `preview` (staging integration branch)
- `main` (production branch)

It also enforces the promotion policy:

- Feature work merges into `preview`
- Only promotion PRs from `preview` should merge into `main`

## Prerequisites

1. A GitHub token with repository administration permissions:
   - Fine-grained PAT: **Repository administration: Read & write**
   - Classic PAT: `repo` scope (admin rights on repository still required)
2. Token exported in shell:

```bash
export GITHUB_PAT=<your_token>
```

Supported token env names:

- `GITHUB_PAT` (preferred)
- `GH_PAT`
- `GH_TOKEN`
- `GITHUB_TOKEN`
- or pass a custom env key via `--token-env <ENV_VAR_NAME>`

## Automation command

From repository root:

```bash
npm run configure:branch-protection -- --repo pdcarlson/Frapp
```

If your token is stored in a custom variable name:

```bash
npm run configure:branch-protection -- --repo pdcarlson/Frapp --token-env YOUR_CUSTOM_PAT_VAR
```

Optional dry-run:

```bash
npm run configure:branch-protection -- --repo pdcarlson/Frapp --dry-run
```

Optional custom required checks:

```bash
npm run configure:branch-protection -- --repo pdcarlson/Frapp --checks "CI / lint-typecheck-test,CI / build"
```

## What the script configures

For `preview` and `main`:

- Required status checks:
  - `CI / lint-typecheck-test`
  - `CI / build`
- Require PR reviews (1 approval)
- Dismiss stale reviews on new commits
- Require conversation resolution
- Enforce protections for admins
- Disallow force pushes and deletions

## Existing in-repo policy guards

- CI gate blocks PRs targeting `main` if source branch is not `preview`.
- `.coderabbit.yaml` includes auto-review on `preview` and `main`.

## Manual verification checklist

After running the script, verify in GitHub UI:

1. Branch protection exists for `preview` and `main`.
2. Required checks are listed and required.
3. Required PR review count is 1+.
4. "Include administrators" is enabled.
5. PR to `main` from non-`preview` branch fails CI policy gate.

## Notes for future agents

- If API/workflow job names change, update required check names passed via `--checks`.
- Keep this runbook and `AGENTS.md` in sync when branch policy changes.
