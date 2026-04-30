# Agent infrastructure and CI reference

Operational detail for AI agents and maintainers working on deploys, CI, secrets, and provider APIs. Day-to-day local setup lives in [`LOCAL_DEV.md`](./LOCAL_DEV.md).

## Research-first workflow

When relevant credentials exist in the environment, prefer gathering **runtime truth** (CI, deploy health, schema, secret presence) via provider APIs/CLIs before changing code or docs.

1. Gather state from providers (GitHub, Supabase, Vercel, Render, Infisical as applicable).
2. Use those checks when validating infra or release-impacting work.
3. Align proposals to observed reality; avoid stale assumptions.
4. **Never print secret values** — only names and presence/absence.

**CLI recipes** (GitHub `gh`, Supabase, curl examples for Render/Vercel/Infisical): see [`.claude/skills/infrastructure-research/SKILL.md`](../../.claude/skills/infrastructure-research/SKILL.md).

## Optional environment credentials

These may appear in **cloud agent** or automation sessions. Local laptop development often omits most of them; use Infisical login for app secrets instead.

| Canonical env var       | Legacy alias (still tolerated)                                       | Typical use                          |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| `GITHUB_PAT`            | `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`  | `gh` CLI, branch protection script   |
| `SUPABASE_ACCESS_TOKEN` | `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN`                           | Supabase CLI / management            |
| `INFISICAL_API_KEY`     | —                                                                    | Infisical API (may lack `local` env) |
| `RENDER_API_KEY`        | `RENDER_APIKEY`                                                      | Render API                           |
| `VERCEL_TOKEN`          | `VERCEL_API_KEY`                                                     | Vercel API                           |
| `SUPABASE_API_KEY`      | —                                                                    | Supabase Management API              |
| `JULES_USER_API_KEY`    | —                                                                    | Jules automation (if used)           |

> **Legacy aliases.** Older cloud VM images and existing scripts may still expose the legacy names. Scripts continue to tolerate them but new snippets should use the canonical names — typically with a fallback like `${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}`.

## GitHub PAT usage policy

The agent **may** use the GitHub PAT (`GITHUB_PAT`, falling back to `GITHUB_PERSONAL_ACCESS_TOKEN`) for: creating/closing agent-owned PRs, labels, branch protection script, GitHub environments/protection rules, reading PR/CI/branch state.

The agent **must not** use it to: merge without explicit approval, delete branches without approval, broaden repo settings beyond branch protection/environments, create/modify GitHub Secrets, force-push, or create releases/tags outside the automated release workflow.

Use the canonical env var name for `gh` CLI commands, with a fallback to the legacy name:

```bash
export GITHUB_TOKEN="${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}"
```

If only `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` is exposed in an older VM, fall back to it; otherwise prefer the canonical name.

## CI/CD summary

| Item                 | Location / notes                                                                      |
| -------------------- | ------------------------------------------------------------------------------------- |
| CI                   | `.github/workflows/ci.yml` — parallel jobs (`lint-and-typecheck` includes `nest build` for `apps/api`; `api-docker-build` runs `apps/api/Dockerfile`) |
| API deploy           | `.github/workflows/deploy-api.yml` — after CI (`workflow_run`)                        |
| Deploy verification  | `.github/workflows/verify-deployments.yml` — post-push Render + Vercel state polling  |
| Release tags         | `.github/workflows/release.yml` — main → production merge                             |
| Docs                 | `.github/workflows/docs.yml` — PR docs/spec sync (`check-docs-impact.mjs`)            |
| Branch protection    | `npm run configure:branch-protection` (requires `GITHUB_PAT`); see `CONTRIBUTING.md`  |
| AI PR review         | `.github/workflows/claude-review.yml` — `anthropics/claude-code-action@v1` on PRs to `main` / `production`; advisory, not a required check. Runbook: [`CLAUDE_REVIEW_RUNBOOK.md`](./CLAUDE_REVIEW_RUNBOOK.md). |
| Vercel               | Deploys from `main` / `production` only (PR previews disabled via repo config)        |

**PR review policy:** `main` — no required human approval; `production` — required approval + resolved conversations.

**Branch protection script (dry run / apply):**

```bash
GITHUB_PAT="${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}" npm run configure:branch-protection -- --dry-run
GITHUB_PAT="${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}" npm run configure:branch-protection
```

Deeper deploy architecture: [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

## Infisical sync map

| # | Infisical env | Destination                         |
| - | ------------- | ----------------------------------- |
| 1 | staging       | Render → frapp-api-staging          |
| 2 | production    | Render → frapp-api-prod             |
| 3 | staging       | Vercel → frapp-web (Preview)        |
| 4 | production    | Vercel → frapp-web (Production)     |
| 5 | staging       | Vercel → frapp-landing (Preview)    |
| 6 | production    | Vercel → frapp-landing (Production) |
| 7 | per-env       | GitHub Actions (OIDC)               |

Project ID is documented in [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md) and root `.infisical.json`.

## GitHub environments and bootstrap secrets

| Environment  | Protection              | Purpose                                |
| ------------ | ----------------------- | -------------------------------------- |
| `staging`    | None                    | Staging deploys (`main`)               |
| `production` | Required reviewer       | Production deploys + migration gate    |

Repository secrets for Infisical bootstrap: `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`.

Additional repo-level secrets used by other workflows: `CLAUDE_CODE_OAUTH_TOKEN` (used by `.github/workflows/claude-review.yml` for the AI PR review action) and `RENDER_API_KEY`, `VERCEL_API_KEY` (used by `.github/workflows/verify-deployments.yml` to poll deploy state — read-only, never runtime values). The Vercel API key is the GitHub Actions secret name; the canonical local env var is `VERCEL_TOKEN`.

Deploy workflow resolves all runtime secrets (including `SUPABASE_ACCESS_TOKEN`) from Infisical at workflow time via `Infisical/secrets-action`. No GitHub environment-scoped runtime secrets are required beyond the Infisical bootstrap listed above.

## Release labels

| Label           | Effect on version bump     |
| --------------- | -------------------------- |
| `release:major` | Major                      |
| `release:minor` | Minor                      |
| `release:patch` | Patch (default)            |

## Lint, test, build (repo root)

- `npm run lint` — turbo lint
- `npm run lint:api` — API only
- `npm run test -w apps/api` — Jest
- `npm run build` — turbo build
- `npm run check-types` — turbo TypeScript
- `npm run check:api-contract` — OpenAPI / SDK drift
- `npm run check:migration-safety` — migrations + promotion docs

Testing workflows and CI parity: [`.claude/skills/testing/SKILL.md`](../../.claude/skills/testing/SKILL.md).
