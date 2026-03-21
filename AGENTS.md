# AGENTS.md

Concise operating guide for AI agents and developers. **Deep detail:** [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md) (machines, Infisical, ports), [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md) (CI, deploys, PAT policy, Infisical sync map). **Task playbooks:** [`.cursor/skills/`](.cursor/skills/) (`api-development.md`, `ui-development.md`, `testing.md`, `audit.md`, `infrastructure-research.md`).

## Optional agent credentials (automation / cloud sessions)

These environment variables sometimes exist in hosted agent VMs. Omit on a normal laptop; use `npx infisical login` for local app secrets.

| Env var                                    | Purpose                                        |
| ------------------------------------------ | ---------------------------------------------- |
| `INFISICAL_API_KEY`                        | Infisical API (may not include `local` env)    |
| `RENDER_APIKEY` / `VERCEL_API_KEY`         | Provider APIs                                  |
| `SUPABASE_API_KEY`                         | Supabase Management API                        |
| `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`        | `gh` CLI, branch protection script             |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI                                   |
| `JULES_USER_API_KEY`                       | Jules automation (if used)                     |

**Research-first:** When these exist, gather runtime truth (CI, deploys, schema, secrets) before proposing changes. Never print secret values. Full policy and CI tables: [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md).

## Operating mindset

- Be direct and useful; skip filler. Have opinions; say when something is wrong and propose a better approach.
- Read context before asking; handle what you can without the user.
- Confirm before external/public actions; be proactive on internal/repo work.
- If agent operating files change, say so in the response.

## Project overview

Frapp is a Turborepo + npm workspaces monorepo (5 apps, 7 shared packages). Structure: `README.md`. Product/architecture: `spec/`.

## Branch model

`main` = staging, `production` = production. Feature branches from `main` → PR to `main`. Promotion: PR `main` → `production`. Direct pushes to `main` / `production` are blocked. PRs to `production` from branches other than `main` are rejected by CI. Details: `CONTRIBUTING.md`.

## Documentation sync mandate (non-optional)

For **every** non-doc code change (tests, refactors, tooling, CI, config), update at least one related file under `apps/docs/`, `docs/`, or `spec/` in the same change.

- Run or reason against `scripts/check-docs-impact.mjs` before finishing.
- If user-visible behavior is unchanged, add brief maintenance notes on what changed technically.

## Services and ports

| Service        | Port  | Command (Infisical-injected from repo root)   |
| -------------- | ----- | --------------------------------------------- |
| API            | 3001  | `npm run dev:api`                             |
| Web            | 3000  | `npm run dev:web`                             |
| Landing        | 3002  | `npm run dev:landing`                         |
| Docs           | 3005  | `npm run dev:docs`                            |
| All four       | —     | `npm run dev:stack`                           |
| Supabase Studio | 54323 | After `npx supabase start`                    |

Non-Infisical fallbacks and Turbo behavior (`npm run dev` does not start the API): [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md).

## Starting the dev environment

**Laptop / WSL / Linux:** With Docker reachable, run `bash scripts/local-dev-setup.sh` from the repo root (deps, Supabase, `db push --local`, optional checks). Flags: `--quick`, `--reset-supabase`, `--reset-supabase-data` — see script `--help`.

**Headless cloud VM (e.g. Jules):** `scripts/jules-setup.sh` may start Docker differently; do not copy that pattern to a normal laptop.

**Secrets:** Prefer `npx infisical login` and `npm run dev:*` / `dev:stack`. See [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md) and [`docs/internal/SECRETS_MANAGEMENT.md`](docs/internal/SECRETS_MANAGEMENT.md).

## Secrets and environment variables

Managed in **Infisical** (project ID in `.infisical.json`). Canonical lists: [`docs/internal/ENV_REFERENCE.md`](docs/internal/ENV_REFERENCE.md), [`docs/internal/SECRETS_MANAGEMENT.md`](docs/internal/SECRETS_MANAGEMENT.md).

- No `.env.example` in repo — use `ENV_REFERENCE.md`.
- No placeholder secrets in CI.
- No `_STAGING` / `_PRODUCTION` suffixes on names; values differ per Infisical environment.
- Local `local` env often uses real Stripe test keys and Sentry for realistic dev.

## CI/CD, GitHub, PAT rules, Infisical syncs

See [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md). Deploy architecture: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Lint, test, build, type-check

| Step            | Command                          |
| --------------- | -------------------------------- |
| Lint            | `npm run lint` / `npm run lint:api` |
| Tests           | `npm run test -w apps/api`       |
| Build           | `npm run build`                  |
| Types           | `npm run check-types`            |
| API contract    | `npm run check:api-contract`     |
| Migrations      | `npm run check:migration-safety` |

CI parity and testing detail: [`.cursor/skills/testing.md`](.cursor/skills/testing.md).

## Task skills (read the matching file before deep work)

| Area                    | File                                      |
| ----------------------- | ----------------------------------------- |
| NestJS API / contract   | `.cursor/skills/api-development.md`       |
| Web / landing / UI      | `.cursor/skills/ui-development.md`        |
| Tests / verification    | `.cursor/skills/testing.md`               |
| Audits / quality        | `.cursor/skills/audit.md`                 |
| Deploy / CI / providers | `.cursor/skills/infrastructure-research.md` |

Cursor rules under `.cursor/rules/` point at these same skill files.

## Gotchas

- API loads `.env.local` then `.env`; prefer `npm run dev:api` with Infisical.
- Local Supabase keys: `npx supabase status -o env`.
- `npx supabase db push --local` when using local CLI without a linked project ref.
- Regenerate API contract after controller/DTO changes: `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`.
- `INFISICAL_API_KEY` in some VMs may not read `local`; use `.env.local` + Supabase status there if needed.
- Mobile needs Expo Go; not for headless VMs.
- Branch protection uses `enforce_admins: true`.
- `npx supabase db push --local` is idempotent.

## Developer notes for agents

When the user supplies durable environment hints or tool workarounds not documented elsewhere, add a short bullet here.

_(None recorded.)_

## PR reviews

When fixing review feedback, resolve related GitHub review threads so merge is not blocked.
