# Frapp — Claude Code operating guide

Concise operating guide for Claude Code (terminal, web, IDE) and human developers. **Deep detail:** [`docs/internal/LOCAL_DEV.md`](docs/internal/LOCAL_DEV.md) (machines, Infisical, ports), [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md) (CI, deploys, PAT policy, Infisical sync map). **Task playbooks:** [`.claude/skills/`](.claude/skills/) (see Skills table below).

## Repo-wide review rules

- Treat `docs/` and `spec/` as part of the source of truth. Flag any non-doc code, CI, tooling, or config change that does not update related documentation or spec files in the same PR.
- Protect the branch model: feature work targets `main`, and promotion PRs target `production` from `main` only.
- Be strict about deploy safety: if workflow names, required checks, or promotion gates change, the matching runbooks and branch-protection automation must change in the same PR.
- Flag any suggestion that would weaken secret handling, authentication, authorization, or migration safety.

Per-area review focus is in nested `CLAUDE.md` files (`apps/api/`, `apps/web/`, `apps/mobile/`, `packages/`, `.github/workflows/`, `supabase/migrations/`).

Full review runbook (how the GitHub Action is configured, how to trigger or disable it, how to fall back to a different reviewer): [`docs/internal/CLAUDE_REVIEW_RUNBOOK.md`](docs/internal/CLAUDE_REVIEW_RUNBOOK.md).

## Optional agent credentials (automation / cloud sessions)

These environment variables sometimes exist in hosted agent VMs. Omit on a normal laptop; use `npx infisical login` for local app secrets.

| Canonical env var       | Legacy alias (still tolerated)                                       | Purpose                                     |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `INFISICAL_API_KEY`     | —                                                                    | Infisical API (may not include `local` env) |
| `RENDER_API_KEY`        | `RENDER_APIKEY`                                                      | Render API                                  |
| `VERCEL_TOKEN`          | `VERCEL_API_KEY`                                                     | Vercel API                                  |
| `SUPABASE_API_KEY`      | —                                                                    | Supabase Management API                     |
| `GITHUB_PAT`            | `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`  | `gh` CLI, branch protection script          |
| `SUPABASE_ACCESS_TOKEN` | `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN`                           | Supabase CLI                                |
| `JULES_USER_API_KEY`    | —                                                                    | Jules automation (if used)                  |

When sourcing one of these in a script, prefer the canonical name with a fallback, e.g. `${GITHUB_PAT:-$GITHUB_PERSONAL_ACCESS_TOKEN}`. Full PAT policy and CI tables: [`docs/internal/AGENT_INFRA.md`](docs/internal/AGENT_INFRA.md).

**Research-first:** When these exist, gather runtime truth (CI, deploys, schema, secrets) before proposing changes. Never print secret values.

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

**Claude Code on the web (cloud sandbox):** the SessionStart hook at `.claude/hooks/session-start.sh` runs automatically when `CLAUDE_CODE_REMOTE=true` — it installs deps and builds shared packages. Docker and Supabase stay on-demand; the testing skill ([`.claude/skills/testing/SKILL.md`](.claude/skills/testing/SKILL.md)) has the exact recipe for starting them.

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

CI parity and testing detail: [`.claude/skills/testing/SKILL.md`](.claude/skills/testing/SKILL.md).

## Skills

| Area                    | File                                                          |
| ----------------------- | ------------------------------------------------------------- |
| NestJS API / contract   | [`.claude/skills/api-development/SKILL.md`](.claude/skills/api-development/SKILL.md) |
| Web / landing / UI      | [`.claude/skills/ui-development/SKILL.md`](.claude/skills/ui-development/SKILL.md) |
| Tests / verification    | [`.claude/skills/testing/SKILL.md`](.claude/skills/testing/SKILL.md) |
| Audits / quality        | [`.claude/skills/audit/SKILL.md`](.claude/skills/audit/SKILL.md) |
| Deploy / CI / providers | [`.claude/skills/infrastructure-research/SKILL.md`](.claude/skills/infrastructure-research/SKILL.md) |
| Local multi-pass review | [`.claude/skills/ultrareview-local/SKILL.md`](.claude/skills/ultrareview-local/SKILL.md) |

A read-only reviewer subagent lives at [`.claude/agents/reviewer.md`](.claude/agents/reviewer.md) and is used both directly (for one-shot reviews) and by `/ultrareview-local`.

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

- Cloud VMs may expose the Render key as `RENDER_API_KEY` and the GitHub PAT as `GITHUB_PERSONAL_ACCESS_TOKEN` (legacy) or `GITHUB_PAT` (canonical); prefer those names when present.

## PR reviews

Pull requests targeting `main` and `production` are reviewed by [`anthropics/claude-code-action@v1`](.github/workflows/claude-review.yml) on every push (events `opened`, `synchronize`, `reopened`, `ready_for_review`). Drafts are reviewed too. Add the `skip-claude-review` label to opt a PR out. Findings are advisory; promotion is gated by CI + branch protection, not the review.

When fixing review feedback, resolve related GitHub review threads so merge is not blocked. Full runbook: [`docs/internal/CLAUDE_REVIEW_RUNBOOK.md`](docs/internal/CLAUDE_REVIEW_RUNBOOK.md).
