# AGENTS.md

Concise operating guide for AI agents and developers. **Deep detail:** [`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md) (machines, Infisical, ports), [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) (CI, deploys, PAT policy, Infisical sync map). **Task playbooks:** the skills under [`.claude/skills/`](.claude/skills/) — see [Skills](#skills-read-the-matching-one-before-deep-work).

## Optional agent credentials (automation / cloud sessions)

Hosted agent sessions may carry provider/research credentials and cloud-sandbox runtime vars. **Canonical list:** [`docs/internal/environment/AGENT_CREDENTIALS.md`](docs/internal/environment/AGENT_CREDENTIALS.md). Omit all on a normal laptop; use `npx infisical login` for local app secrets.

**Research-first:** when these exist, gather runtime truth (CI, deploys, schema, secret presence) before proposing changes. Never print secret values. GitHub PAT usage policy + CI tables: [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md).

## Operating mindset

- Be direct and useful; skip filler. Have opinions; say when something is wrong and propose a better approach.
- Read context before asking; handle what you can without the user.
- Confirm before external/public actions; be proactive on internal/repo work.
- If agent operating files change, say so in the response.
- **Use sub-agents liberally.** Delegate broad searches, independent research, and self-contained implementation chunks to sub-agents (Explore/Plan/general-purpose), launching independent ones in parallel in a single message. Keep heavy reading out of your own context and stay focused on integration and review. Sub-agents inherit the session model (so they run on Opus in a normal session) — there is no pinned sub-agent model.
- **Stop and report cloud-sandbox failures — don't work around them.** If the local stack fails to come up (`.cloud-sandbox-up.failed`, `host_not_allowed`/`403`, Docker Hub rate limit, missing env var), STOP and tell the user exactly what to add or change in the Claude Code web environment (network policy, env var, setup script), then wait. These are environment config you cannot fix from inside the session; env/network changes apply to new sessions only. Map of symptom → fix: [`docs/internal/environment/CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md) ("When bringup fails"). Trust the `.cloud-sandbox-up.failed` sentinel over the log: transient registry errors are retried automatically, so a **successful** bringup can still contain `503`s. Policy and credential failures stop immediately, and the sentinel names the remedy.

## Project overview

Frapp is a Turborepo + npm workspaces monorepo (4 apps, 7 shared packages). Structure: `README.md`. Product/architecture: `spec/`. Developer docs: markdown in [`docs/guides/`](docs/guides/README.md) (no separate docs web app in-repo).

- **Documentation map:** [`docs/README.md`](docs/README.md) — how `docs/` and `spec/` fit together. **Conventions:** [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).

## Branch model

`main` = staging, `production` = production. Feature branches from `main` → PR to `main`. Promotion: PR `main` → `production`. Direct pushes to `main` / `production` are blocked. PRs to `production` from branches other than `main` are rejected by CI. Details: `CONTRIBUTING.md`.

## Documentation sync mandate (non-optional)

For **every** non-doc code change (tests, refactors, tooling, CI, config), update at least one related file under **`docs/`** or **`spec/`** in the same PR. Satisfy the gate by updating the **relevant** existing doc/spec per the placement map in [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md) — never by dropping a new stray file. **Canonical developer guides** live under [`docs/guides/`](docs/guides/README.md).

- Run or reason against `scripts/check-docs-impact.mjs` before finishing.
- If user-visible behavior is unchanged, add brief maintenance notes on what changed technically.

## Work tracking

Work lives in **Linear** (team **Frapp Live**, prefix **FRA-**, identifiers like `FRA-123`) — the **single source of truth** for what to work on and its status.

> **Hard rule (non-negotiable):** **All issues are opened in Linear** (the **Triage** inbox). **Never open a GitHub issue** — not by hand, not from an automation.
> **Closing** is most often done by the **PR that does the work** (`Fixes FRA-N`, plus `Closes #N` for a GitHub twin) — that's the common path. But agents may also **close an issue directly** when it's a duplicate, stale, or obsolete (update it or close it). Prefer closing on the **GitHub** side for any issue that has a GitHub presence so the integration syncs it back cleanly; close Linear-native issues (no GitHub twin) in Linear (Done/Canceled). Either way the two stay in sync.

How each actor reaches Linear: **Claude Code (web)** uses the **native Linear MCP** injected by the web environment (the path `/next` uses), and the **scheduled Claude Code Routines** (backlog curator + triage) use the same injected MCP (see [`docs/internal/ci-cd/ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). Epics are Linear **Projects**; new work lands in **Triage** before it's accepted into the Backlog. To start work, run `/next` — it pulls the top-priority unblocked Backlog issue, completes it, and keeps Linear in sync. Canonical product/behavior/architecture spec lives in [`spec/`](spec/README.md); Linear issues link out to it and never duplicate it. Design + policy: [`docs/internal/ci-cd/LINEAR_PM.md`](docs/internal/ci-cd/LINEAR_PM.md); the decision is ADR-16 in [`spec/architecture/README.md`](spec/architecture/README.md).

## Filing follow-up work (in Linear)

Cloud-agent VMs are ephemeral and a single PR shouldn't balloon, so when work surfaces that doesn't belong in the current PR, **file it as a Linear issue** (`save_issue` into **Triage**, team Frapp Live). Issues are completed by AI agents, so write each one to be executed cold by a fresh agent.

**When to file:**

- Deferred / out-of-scope work discovered mid-task (data backfills, follow-up refactors).
- **Blocked verification** — when the sandbox can't run something (Docker/Supabase won't start, missing external creds), file an issue so the gap is tracked. **Never check a verification box you couldn't actually run** — say it's blocked and link the issue.
- Review findings you're not fixing in the current PR (with a reason).
- A bug or security hole found outside the current scope.
- Cross-cutting prerequisites or blockers.

**Don't file** for trivial nits you can fix in the current PR (just fix them), or duplicates — search Linear first (`list_issues` / search) before creating.

**How to write one (so an agent can execute it):**

- **Meta block:** Linear **Priority** (Urgent/High/Medium/Low), what it blocks, originating PR, suggested `area:<x>` label / Project, and an **Agent brief** (`depth:` / `model:` / `ultracode:` — err on `depth:deep`; policy in [`LINEAR_PM.md`](docs/internal/ci-cd/LINEAR_PM.md#agent-briefs-depth--model--ultracode)).
- **Problem/context:** what's wrong and why it matters, with exact file paths + line refs.
- **Acceptance criteria:** an objectively verifiable checkbox list.
- **Implementation notes:** constraints, helpers to reuse, gotchas.
- **Definition of done:** "PR linked with `Fixes FRA-N`, criteria met, CI green."

**Labels & priority.** Severity is the native Linear **Priority** (Urgent/High/Medium/Low). `area:<x>` labels group by surface (`api`/`web`/`db`/`ci`/`security`/`ux`/`product`/`research`/`docs`/`deps`). Express dependencies as blocked-by **relations**, not a label. Two scheduled Claude Code Routines maintain the backlog: a **curator** files **and** maintains issues labeled `suggestion`, and a **triage** pass prioritizes/buckets/promotes — both **only ever modify `suggestion`-labeled issues they own** for destructive actions; human-filed and planning issues are off-limits. See [`docs/internal/ci-cd/ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md) and [`docs/internal/ci-cd/LINEAR_PM.md`](docs/internal/ci-cd/LINEAR_PM.md).

**Lifecycle.** File in Linear → **Triage** → accepted to **Backlog** → an agent picks it up via `/next` → branch (`claude/<slug>`) → push (the local **pre-push review-gate hook** requires one review pass on the diff — the single pre-PR review gate. Agents run **`/diff-review`**, which is always invocable and writes the gate marker. The bundled `/code-review` is richer but only *conditionally* model-invocable — `Skill(skill: "code-review")` is waived only when the current turn's prompt carries `/code-review` **whitespace-delimited on both sides** (backticks, quotes, and trailing punctuation all defeat it, so expect refusal by default), never inside a sub-agent, and never under `/next`; see [`docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md). Review sub-agents inherit the session model) → PR with `Fixes FRA-N` (add `Closes #<github>` for a GitHub twin) → merge transitions FRA-N to **Done**. Express blockers as blocked-by relations so an issue isn't started until they're resolved.

## Services and ports

| What            | Port  | Notes                                     |
| --------------- | ----- | ----------------------------------------- |
| **Default run** | —     | `npm run dev:stack` (API + web + landing) |
| Web             | 3000  |                                           |
| API / Swagger   | 3001  | `/docs` for Swagger                       |
| Landing         | 3002  |                                           |
| Supabase Studio | 54323 | After `npx supabase start`                |

Per-app `dev:*` commands, fallbacks, mobile, Turbo: [`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md).

## Starting the dev environment

**Primary — Claude Code web sandbox:** the local stack (Docker + Supabase + API) auto-starts in the background at session start. Wait for `.cloud-sandbox-up.done`, then `npm run start:dev -w apps/api`. Config, env vars, and failure troubleshooting: [`docs/internal/environment/CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md).

**Secondary — laptop / WSL / Linux:** with Docker reachable, run `bash scripts/local-dev-setup.sh` (deps, Supabase, `db push --local`, optional checks; flags `--quick`, `--reset-supabase`, `--reset-supabase-data`). Then `npx infisical login` once and **`npm run dev:stack`**. See [`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md) and [`docs/internal/environment/SECRETS_MANAGEMENT.md`](docs/internal/environment/SECRETS_MANAGEMENT.md).

## Secrets and environment variables

Managed in **Infisical** (project ID in `.infisical.json`). Canonical lists: [`docs/internal/environment/ENV_REFERENCE.md`](docs/internal/environment/ENV_REFERENCE.md), [`docs/internal/environment/SECRETS_MANAGEMENT.md`](docs/internal/environment/SECRETS_MANAGEMENT.md).

- No `.env.example` in repo — use `ENV_REFERENCE.md`.
- No placeholder secrets in CI.
- No `_STAGING` / `_PRODUCTION` suffixes on names; values differ per Infisical environment.
- Local `local` env often uses real Stripe test keys and Sentry for realistic dev.

## CI/CD, GitHub, PAT rules, Infisical syncs

See [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md). Deploy architecture: [`docs/internal/ops/DEPLOYMENT.md`](docs/internal/ops/DEPLOYMENT.md).

## Lint, test, build, type-check

| Step         | Command                             |
| ------------ | ----------------------------------- |
| Lint         | `npm run lint` / `npm run lint:api` (read-only) |
| Lint autofix | `npm run lint:api:fix` — the only lint script that writes; see [contributing.md §5](docs/guides/contributing.md#5-linting-types-and-tests) |
| Tests        | `npm run test -w apps/api`          |
| Build        | `npm run build`                     |
| Types        | `npm run check-types` (includes API via `tsconfig.build.json`, same program as `nest build`) |
| API compile  | `npm run build -w apps/api` (matches Render `Dockerfile` builder) |
| API image    | `docker build -f apps/api/Dockerfile .` (also runs in CI as `api-docker-build`) |
| API contract | `npm run check:api-contract`        |
| Migrations   | `npm run check:migration-safety`    |

CI parity and testing detail: [`.claude/skills/testing/SKILL.md`](.claude/skills/testing/SKILL.md).

## Skills (read the matching one before deep work)

All skills live under [`.claude/skills/`](.claude/skills/) and are invocable by an agent:

| Skill | Use |
| ----- | --- |
| [`/api-development`](.claude/skills/api-development/SKILL.md) | NestJS API, layered architecture, contract regeneration. |
| [`/ui-development`](.claude/skills/ui-development/SKILL.md) | Web / landing / UI: component layers, theming, data layer. |
| [`/testing`](.claude/skills/testing/SKILL.md) | Tests, verification, CI parity. |
| [`/audit`](.claude/skills/audit/SKILL.md) | Audits / quality reviews (RLS coverage, deps, contract, CI). |
| [`/infrastructure-research`](.claude/skills/infrastructure-research/SKILL.md) | Deploy / CI / provider runtime-truth gathering. |
| [`/linear-curator`](.claude/skills/linear-curator/SKILL.md) | The scheduled backlog-curator routine's behavior contract ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). |
| [`/linear-triage`](.claude/skills/linear-triage/SKILL.md) | The scheduled triage routine's behavior contract ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). |
| [`/diff-review`](.claude/skills/diff-review/SKILL.md) | The pre-push review gate (see the lifecycle above). Mechanics: [`AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md). |
| [`/handoff`](.claude/skills/handoff/SKILL.md) | Draft a copy-pasteable prompt handing work to a fresh session — when context is filling up, a task is finishing, or a parallel track should run in its own chat. Offer it proactively. |

**Long sessions degrade.** Context fills with dead ends and superseded plans, and a fresh session on
the same task is often more capable because its read of the codebase is uncontaminated. Treat
`/handoff` as a normal part of the workflow rather than a last resort, and write orientation for the
next session — not instructions, which would just transplant a stale plan.

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

- Cloud VMs expose the Render key as `RENDER_API_KEY` and the GitHub PAT as `GITHUB_PAT` (distinct from `GITHUB_TOKEN`, the Actions runtime token); prefer those names when present. For `gh`/git, `export GH_TOKEN="$GITHUB_PAT"`.

## PR reviews

When fixing review feedback, resolve related GitHub review threads so merge is not blocked.

## Autonomous PR lifecycle (cloud sessions)

A task is not "done" when the code is pushed — it's done when the PR is ready to merge. After completing the requested work:

1. **Open a PR** against the appropriate base branch (feature → `main`; promotion → `production`). Don't wait to be asked.
2. **Subscribe to PR activity** (`subscribe_pr_activity`) — knowing its limits: the webhook fires on **CI failure, comments, and reviews only**. It never fires on success, cancelled, timed-out, or merge-conflict, so subscription alone can strand a PR silently (it did for ~2h on #659 during the 2026-08-06 Actions outage).
3. **Arm a durable self-wake** (`send_later`, ~30–60 min out) and re-arm it on every wake until the PR merges or closes. This is load-bearing, not a nicety: the sandbox shell cannot reach `api.github.com` (GitHub is MCP-only, and only while the session is awake), so a scheduled check-in is the only guaranteed wake for the states the webhook misses. If `send_later` fails with `MCP error -32003 … requires approval`, Routines are disabled account-side — no repo or settings change fixes that; say so to the user explicitly and fall back to the `CI wake` comments (below) plus the user.
4. **Triage CI failures before "fixing" them.** A job that died before its first repo step (only step is "Set up job"; "Failed to resolve action download info"; sibling jobs cancelled without ever getting a runner) is **GitHub Actions infra, not code** — re-run it (MCP `actions_run_trigger`, auto-approved by the project allowlist; if it prompts anyway that's server-naming drift, see AGENT_INFRA § "Applied permission allows" — say so instead of going silent), don't patch. The `CI wake` watchdog (`.github/workflows/ci-wake.yml`) auto-requeues infra-shaped failures (≤3 total attempts) and upserts one wake comment per workflow per outcome — read that comment before diagnosing; if it says infra, stand down until the next wake, but verify the claim yourself if the failure repeats.
5. **Babysit until green:** on each real CI failure, diagnose and push a fix; on each actionable review comment, address it and resolve the thread. Don't go quiet between rounds — the PR diff is the record.
6. **Stop conditions:** the PR is green and review-clean, OR a failure is genuinely out of scope (file an issue, report and stop), OR the user says to stop (`unsubscribe_pr_activity`, and cancel any armed check-in).

This is enforced by `doneMeansMerged: true` in `.claude/settings.json`; the AGENTS.md text is the human-readable contract. Wake-path mechanics and the watchdog: [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) § "PR babysitting: wake signals and CI-failure triage".

## Claude Code web sandbox

`.claude/hooks/session-start.sh` launches `scripts/cloud-sandbox-up.sh` in the **background** at session start (gated on the `/etc/frapp-cloud-sandbox` marker the setup script writes, or `FRAPP_CLOUD_SANDBOX=1`) — it starts Docker + local Supabase and writes `apps/api/.env.local`.

- **Wait before using the DB/API:** poll for `.cloud-sandbox-up.done` (success) or `.cloud-sandbox-up.failed` (error); live log at `/tmp/cloud-sandbox-up.log`.
- **Boot the API** with `npm run start:dev -w apps/api` (the generated `.env.local` means no Infisical is needed).
- **On failure, STOP and report** what to fix in the web environment (see Operating mindset). Don't paper over it.
- Manual/fallback bringup, the full config, and the symptom→fix table all live in [`docs/internal/environment/CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md). Local-only `.env.local` and SWC notes: [`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md).
