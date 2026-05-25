# AGENTS.md

Concise operating guide for AI agents and developers. **Deep detail:** [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md) (machines, Infisical, ports), [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md) (CI, deploys, PAT policy, Infisical sync map). **Task playbooks:** [`.cursor/skills/`](.cursor/skills/) (`api-development.md`, `ui-development.md`, `testing.md`, `audit.md`, `infrastructure-research.md`, `suggestion-triage.md`).

## Optional agent credentials (automation / cloud sessions)

These environment variables sometimes exist in hosted agent VMs. Omit on a normal laptop; use `npx infisical login` for local app secrets.

| Env var                                    | Purpose                                     |
| ------------------------------------------ | ------------------------------------------- |
| `INFISICAL_API_KEY`                        | Infisical API (may not include `local` env) |
| `RENDER_API_KEY` / `VERCEL_API_KEY`        | Provider APIs                               |
| `SUPABASE_API_KEY`                         | Supabase Management API                     |
| `GITHUB_TOKEN`                             | `gh` CLI, branch protection script          |
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

## Active multi-session work: chat-first redesign

A multi-chunk redesign of `apps/web` (with downstream `apps/mobile`, `apps/landing`) is in flight. **Before starting any redesign work, read [`docs/internal/redesign/README.md`](docs/internal/redesign/README.md)** and the specific chunk brief under `docs/internal/redesign/chunks/`. The master plan (product positioning, hot-path architecture, theming, chunk dependency graph) is at [`docs/internal/redesign/master-plan.md`](docs/internal/redesign/master-plan.md). Status of each chunk is in [`docs/internal/redesign/STATUS.md`](docs/internal/redesign/STATUS.md). If you're a fresh cloud-agent session asked to "continue the redesign," start by checking STATUS.md for the next unblocked chunk. Before opening a chunk PR, run the reviewer checklist at [`docs/internal/redesign/REVIEW_CHECKLIST.md`](docs/internal/redesign/REVIEW_CHECKLIST.md) against your own work.

## GitHub issues (the durable backlog between sessions)

Cloud-agent VMs are ephemeral and a single PR shouldn't balloon, so when work surfaces that doesn't belong in the current PR, **file an issue** rather than dropping it or stuffing it in. Issues are completed by AI agents, so write each one to be executed cold by a fresh agent — same philosophy as the chunk briefs.

**When to file:**

- Deferred / out-of-scope work discovered mid-task (data backfills, follow-up refactors).
- **Blocked verification** — when the sandbox can't run something (Docker/Supabase won't start, missing external creds), file an issue so the gap is tracked. **Never check a verification box you couldn't actually run** — say it's blocked and link the issue.
- Review findings you're not fixing in the current PR (with a reason).
- A bug or security hole found outside the current scope.
- Cross-chunk prerequisites or blockers.

**Don't file** for trivial nits you can fix in the current PR (just fix them), or duplicates — search open issues first (`list_issues` / search) before creating.

**How to write one (so an agent can execute it):**

- **Meta block:** priority (P0–P2), what it blocks, originating PR/chunk, suggested labels.
- **Problem/context:** what's wrong and why it matters, with exact file paths + line refs.
- **Acceptance criteria:** an objectively verifiable checkbox list.
- **Implementation notes:** constraints, helpers to reuse, gotchas.
- **Definition of done:** "PR linked with `Closes #N`, criteria met, CI green."

**Labels.** Existing: `bug`, `enhancement`, `data`, `good first issue`. Create and use as the project grows: `security` (P0 cross-tenant / auth), `ci`, `blocked`, `chunk-NN` (ties an issue to a redesign chunk), `agent-ready` (fully specified, safe to hand to an agent). A security issue that gates a chunk gets `security` + `blocked` + `chunk-NN`. The Cursor "Suggestion Triage" automation files issues with `suggestion` + one `area:<x>` + one `severity:<x>` (deduped by a hidden fingerprint) — see [`docs/internal/CURSOR_AUTOMATIONS.md`](docs/internal/CURSOR_AUTOMATIONS.md).

**Lifecycle.** File → an agent picks it up → branch (`claude/issue-NN-<slug>`) → PR with `Closes #NN` → merge closes the issue. **List any chunk's blocking issues at the top of its brief** so the chunk can't be started until they're resolved.

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
| Types        | `npm run check-types` (includes API via `tsconfig.build.json`, same program as `nest build`) |
| API compile  | `npm run build -w apps/api` (matches Render `Dockerfile` builder) |
| API image    | `docker build -f apps/api/Dockerfile .` (also runs in CI as `api-docker-build`) |
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
| Suggestion triage       | `.cursor/skills/suggestion-triage.md`       |
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

- Cloud VMs expose the Render key as `RENDER_API_KEY` and the GitHub PAT-compatible credential as `GITHUB_TOKEN`; prefer those names when present.

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

### API dev server (optional SWC)

`nest start --watch` uses the same TypeScript program as `nest build` by default. For faster rebuilds in large trees you can use `nest start --watch --builder swc` (requires `@swc/cli` / `@swc/core` in `apps/api`). CI and Render use **`nest build`**; keep `npm run build -w apps/api` green before merging API changes.

### Key commands (standard, documented in root `package.json`)

| Task | Command |
|------|---------|
| Lint | `npm run lint` |
| API tests | `npm run test -w apps/api` |
| Type-check | `npm run check-types` |
