# Agent infrastructure and CI reference

Operational detail for AI agents and maintainers working on deploys, CI, secrets, and provider APIs. Day-to-day local setup lives in [`LOCAL_DEV.md`](./LOCAL_DEV.md).

## Research-first workflow

When relevant credentials exist in the environment, prefer gathering **runtime truth** (CI, deploy health, schema, secret presence) via provider APIs/CLIs before changing code or docs.

1. Gather state from providers (GitHub, Supabase, Vercel, Render, Infisical as applicable).
2. Use those checks when validating infra or release-impacting work.
3. Align proposals to observed reality; avoid stale assumptions.
4. **Never print secret values** — only names and presence/absence.

**CLI recipes** (GitHub `gh`, Supabase, curl examples for Render/Vercel/Infisical): see [`.cursor/skills/infrastructure-research.md`](../../.cursor/skills/infrastructure-research.md).

## Optional environment credentials

These may appear in **cloud agent** or automation sessions. Local Cursor development often omits most of them; use Infisical login for app secrets instead.

| Env var                                    | Typical use                          |
| ------------------------------------------ | ------------------------------------ |
| `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`        | `gh` CLI, branch protection script   |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI / management            |
| `INFISICAL_API_KEY`                        | Infisical API (may lack `local` env) |
| `RENDER_APIKEY`                            | Render API                           |
| `VERCEL_API_KEY`                           | Vercel API                           |
| `SUPABASE_API_KEY`                         | Supabase Management API              |
| `JULES_USER_API_KEY`                       | Jules automation (if used)           |

## GitHub PAT usage policy

The agent **may** use `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` for: creating/closing agent-owned PRs, labels, branch protection script, GitHub environments/protection rules, reading PR/CI/branch state.

The agent **must not** use it to: merge without explicit approval, delete branches without approval, broaden repo settings beyond branch protection/environments, create/modify GitHub Secrets, force-push, or create releases/tags outside the automated release workflow.

Use `GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN"` for `gh` CLI commands.

## CI/CD summary

| Item              | Location / notes                                                                 |
| ----------------- | -------------------------------------------------------------------------------- |
| CI                | `.github/workflows/ci.yml` — parallel jobs                                       |
| API deploy        | `.github/workflows/deploy-api.yml` — after CI (`workflow_run`)                   |
| Release tags      | `.github/workflows/release.yml` — main → production merge                        |
| Docs              | `.github/workflows/docs.yml` — PR docs/spec sync (`check-docs-impact.mjs`)       |
| Branch protection | `npm run configure:branch-protection` (requires `GITHUB_PAT`); see `CONTRIBUTING.md` |
| CodeRabbit        | `.coderabbit.yaml` — review workflow                                             |
| Vercel            | Deploys from `main` / `production` only (PR previews disabled via repo config)     |

**PR review policy:** `main` — no required human approval; `production` — required approval + resolved conversations.

**Branch protection script (dry run / apply):**

```bash
GITHUB_PAT="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection -- --dry-run
GITHUB_PAT="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection
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

Deploy workflow may still reference transitional GitHub secrets (`SUPABASE_ACCESS_TOKEN`, etc.) until fully moved to Infisical OIDC — see [`DEPLOYMENT.md`](../DEPLOYMENT.md) and [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md).

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

Testing workflows and CI parity: [`.cursor/skills/testing.md`](../../.cursor/skills/testing.md).
