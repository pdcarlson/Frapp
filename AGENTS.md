# AGENTS.md

Concise operating guide for AI agents and developers. **Deep detail:** [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md) (machines, Infisical, ports), [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md) (CI, deploys, PAT policy, Infisical sync map). **Task playbooks:** [`.cursor/skills/`](.cursor/skills/) (`api-development.md`, `ui-development.md`, `testing.md`, `audit.md`, `infrastructure-research.md`).

## Optional agent credentials (automation / cloud sessions)

These environment variables sometimes exist in hosted agent VMs. Omit on a normal laptop; use `npx infisical login` for local app secrets.

| Env var                                    | Purpose                                     |
| ------------------------------------------ | ------------------------------------------- |
| `INFISICAL_API_KEY`                        | Infisical API (may not include `local` env) |
| `RENDER_API_KEY` / `VERCEL_API_KEY`        | Provider APIs                               |
| `SUPABASE_API_KEY`                         | Supabase Management API                     |
| `GITHUB_PERSONAL_ACCESS_TOKEN`             | `gh` CLI, branch protection script          |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI                                |
| `JULES_USER_API_KEY`                       | Jules automation (if used)                  |

**Research-first:** When these exist, gather runtime truth (CI, deploys, schema, secrets) before proposing changes. Never print secret values. Full policy and CI tables: [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md).

## Operating mindset

- Be direct and useful; skip filler. Have opinions; say when something is wrong and propose a better approach.
- Read context before asking; handle what you can without the user.
- Confirm before external/public actions; be proactive on internal/repo work.
- If agent operating files change, say so in the response.

## Project overview

Frapp is a Turborepo + npm workspaces monorepo (4 apps, 7 shared packages). Structure: `README.md`. Product/architecture: `spec/`. Developer docs: markdown in [`docs/guides/`](docs/guides/README.md) (no separate docs web app in-repo).

- **Documentation map:** [`docs/README.md`](docs/README.md) — how `docs/` and `spec/` fit together. **Conventions:** [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).

## Branch model

`main` = staging, `production` = production. Feature branches from `main` → PR to `main`. Promotion: PR `main` → `production`. Direct pushes to `main` / `production` are blocked. PRs to `production` from branches other than `main` are rejected by CI. Details: `CONTRIBUTING.md`.

## Documentation sync mandate (non-optional)

For **every** non-doc code change (tests, refactors, tooling, CI, config), update at least one related file under **`docs/`** or **`spec/`** in the same PR. **Canonical developer guides** live under [`docs/guides/`](docs/guides/README.md).

- Run or reason against `scripts/check-docs-impact.mjs` before finishing.
- If user-visible behavior is unchanged, add brief maintenance notes on what changed technically.

## Services and ports

| What            | Port  | Notes                                     |
| --------------- | ----- | ----------------------------------------- |
| **Default run** | —     | `npm run dev:stack` (API + web + landing) |
| Web             | 3000  |                                           |
| API / Swagger   | 3001  | `/docs` for Swagger                       |
| Landing         | 3002  |                                           |
| Supabase Studio | 54323 | After `npx supabase start`                |

Per-app `dev:*` commands, fallbacks, mobile, Turbo: [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md).

## Starting the dev environment

**Laptop / WSL / Linux:** With Docker reachable, run `bash scripts/local-dev-setup.sh` from the repo root (deps, Supabase, `db push --local`, optional checks). Flags: `--quick`, `--reset-supabase`, `--reset-supabase-data` — see script `--help`.

**Headless cloud VM (e.g. Jules):** `scripts/jules-setup.sh` may start Docker differently; do not copy that pattern to a normal laptop.

**Secrets:** `npx infisical login` once, then **`npm run dev:stack`** from repo root. See [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md) and [`docs/internal/SECRETS_MANAGEMENT.md`](docs/internal/SECRETS_MANAGEMENT.md).

## Secrets and environment variables

Managed in **Infisical** (project ID in `.infisical.json`). Canonical lists: [`docs/internal/ENV_REFERENCE.md`](docs/internal/ENV_REFERENCE.md), [`docs/internal/SECRETS_MANAGEMENT.md`](docs/internal/SECRETS_MANAGEMENT.md).

- No `.env.example` in repo — use `ENV_REFERENCE.md`.
- No placeholder secrets in CI.
- No `_STAGING` / `_PRODUCTION` suffixes on names; values differ per Infisical environment.
- Local `local` env often uses real Stripe test keys and Sentry for realistic dev.

## CI/CD, GitHub, PAT rules, Infisical syncs

See [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md). Deploy architecture: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Lint, test, build, type-check

| Step         | Command                             |
| ------------ | ----------------------------------- |
| Lint         | `npm run lint` / `npm run lint:api` |
| Tests        | `npm run test -w apps/api`          |
| Build        | `npm run build`                     |
| Types        | `npm run check-types`               |
| API contract | `npm run check:api-contract`        |
| Migrations   | `npm run check:migration-safety`    |

CI parity and testing detail: [`.cursor/skills/testing.md`](.cursor/skills/testing.md).

## Task skills (read the matching file before deep work)

| Area                    | File                                        |
| ----------------------- | ------------------------------------------- |
| NestJS API / contract   | `.cursor/skills/api-development.md`         |
| Web / landing / UI      | `.cursor/skills/ui-development.md`          |
| Tests / verification    | `.cursor/skills/testing.md`                 |
| Audits / quality        | `.cursor/skills/audit.md`                   |
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

- Cloud VMs may expose the Render key as `RENDER_API_KEY` and the GitHub PAT as `GITHUB_PERSONAL_ACCESS_TOKEN`; prefer those names when present.

## PR reviews

When fixing review feedback, resolve related GitHub review threads so merge is not blocked.

## Cursor Cloud-specific instructions

These notes are for cloud agents running after the update script has already installed dependencies.

### Docker and Supabase

- Docker must be started before Supabase. Run `sudo dockerd &>/tmp/dockerd.log &`, wait for the socket (`while [ ! -e /var/run/docker.sock ]; do sleep 1; done`), then add the current user to the docker group (`sudo usermod -aG docker $USER` and open a new shell) so Docker commands work without `sudo`. In ephemeral cloud/CI containers where group changes cannot take effect, prefix Docker and Supabase commands with `sudo` instead. Never print secret values or credentials in docs or logs.
- Start Supabase with `npx supabase start` and apply migrations with `npx supabase db push --local`.
- If Supabase containers are stuck: `bash scripts/local-dev-setup.sh --reset-supabase`.

### Running apps without Infisical

The cloud VM does not have Infisical CLI session access. Use the fallback `.env.local` approach instead of `npm run dev:stack`:

1. Create `.env.local` in each app directory with values from `docs/internal/ENV_REFERENCE.md` and `npx supabase status -o env`. **These files are gitignored (root `.gitignore`) — never commit them. Never print secret values or credentials to logs, terminal output, or docs.**
2. Start apps individually (no Infisical wrapper):
   - API: `npx -w apps/api nest start --watch --builder swc` (uses SWC to skip type-checking; see note below)
   - Web: `npm run dev -w apps/web`
   - Landing: `npm run dev -w apps/landing`

### Pre-existing build issue (as of 2026-04-16 — re-verify before relying on this)

`npm run build` and `nest start --watch` (default tsc builder) fail due to a TS2352 error in `apps/api/src/application/services/report.service.ts`. The error is triggered by `tsconfig.build.json` (used by `nest build` / `nest start --watch`), while the `check-types` turbo task passes because the API's `tsconfig.json` uses individual strict flags rather than `strict: true`. **Temporary workaround:** use `--builder swc` flag when running the API dev server (e.g., `npx -w apps/api nest start --watch --builder swc`). This requires `@swc/cli` and `@swc/core` as devDependencies in `apps/api`. Once the upstream type error in `report.service.ts` is fixed, this workaround and the SWC devDependencies can be removed — check whether `npm run build` passes before relying on this note.
<!-- TODO: track fix for TS2352 in report.service.ts, then remove --builder swc workaround and @swc/cli/@swc/core devDeps -->

### Key commands (standard, documented in root `package.json`)

| Task | Command |
|------|---------|
| Lint | `npm run lint` |
| API tests | `npm run test -w apps/api` |
| Type-check | `npm run check-types` |
