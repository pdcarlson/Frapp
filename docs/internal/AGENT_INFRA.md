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
| `GITHUB_PERSONAL_ACCESS_TOKEN`             | `gh` CLI, branch protection script   |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI / management            |
| `INFISICAL_API_KEY`                        | Infisical API (may lack `local` env) |
| `RENDER_API_KEY`                           | Render API                           |
| `VERCEL_API_KEY`                           | Vercel API                           |
| `SUPABASE_API_KEY`                         | Supabase Management API              |
| `JULES_USER_API_KEY`                       | Jules automation (if used)           |

> **Legacy aliases.** Older cloud VM images may still expose `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` and `RENDER_APIKEY`. Scripts continue to tolerate them but docs reference the canonical names only. If you're writing new snippets, use the canonical names.

## GitHub PAT usage policy

The agent **may** use `GITHUB_PERSONAL_ACCESS_TOKEN` for: creating/closing agent-owned PRs, labels, branch protection script, GitHub environments/protection rules, reading PR/CI/branch state.

The agent **must not** use it to: merge without explicit approval, delete branches without approval, broaden repo settings beyond branch protection/environments, create/modify GitHub Secrets, force-push, or create releases/tags outside the automated release workflow.

Use the canonical env var name for `gh` CLI commands:

```bash
export GITHUB_TOKEN="$GITHUB_PERSONAL_ACCESS_TOKEN"
```

If only the legacy `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` is exposed in an older VM, fall back to it; otherwise prefer the canonical name.

## CI/CD summary

| Item                 | Location / notes                                                                      |
| -------------------- | ------------------------------------------------------------------------------------- |
| CI                   | `.github/workflows/ci.yml` — parallel jobs (includes `api-docker-build`: same `apps/api/Dockerfile` as Render) |
| API deploy           | `.github/workflows/deploy-api.yml` — after CI (`workflow_run`)                        |
| Deploy verification  | `.github/workflows/verify-deployments.yml` — post-push Render + Vercel state polling  |
| Release tags         | `.github/workflows/release.yml` — main → production merge                             |
| Docs                 | `.github/workflows/docs.yml` — PR docs/spec sync (`check-docs-impact.mjs`)            |
| Branch protection    | `npm run configure:branch-protection` (requires `GITHUB_PAT`); see `CONTRIBUTING.md`  |
| Bugbot               | `.cursor/BUGBOT.md` — Cursor's native auto-review handles PRs; no GitHub Actions gate  |
| Vercel               | Deploys from `main` / `production` only (PR previews disabled via repo config)        |

**PR review policy:** `main` — no required human approval; `production` — required approval + resolved conversations.

**Branch protection script (dry run / apply):**

```bash
GITHUB_PAT="$GITHUB_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection -- --dry-run
GITHUB_PAT="$GITHUB_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection
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

Additional repo-level secrets used by the deploy-verification workflow: `RENDER_API_KEY`, `VERCEL_API_KEY`. These are read-only API keys used only by `.github/workflows/verify-deployments.yml` to poll deploy state — they never carry runtime values.

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

Testing workflows and CI parity: [`.cursor/skills/testing.md`](../../.cursor/skills/testing.md).

## Render build parity (API)

Render builds the API with `docker build -f apps/api/Dockerfile` and runs `nest build` inside the image. That path uses `tsconfig.build.json` and can surface TypeScript errors that **`npm run check-types` previously skipped** for `apps/api` because the API workspace had no `check-types` script. The API package now runs `tsc -p tsconfig.build.json --noEmit` under Turbo, and CI runs **`api-docker-build`** so a broken production image fails the PR before merge.

Optional hardening: turn off Render auto-deploy and trigger deploys from GitHub Actions only after CI passes via a [Render deploy hook](https://render.com/docs/deploy-hooks) (see Render docs “Using with GitHub Actions”). That prevents a direct push from deploying when branch protection is bypassed or checks are not required.
