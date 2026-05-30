# Agent infrastructure and CI reference

Operational detail for AI agents and maintainers working on deploys, CI, secrets, and provider APIs. Day-to-day local setup lives in [`LOCAL_DEV.md`](../environment/LOCAL_DEV.md).

## Research-first workflow

When relevant credentials exist in the environment, prefer gathering **runtime truth** (CI, deploy health, schema, secret presence) via provider APIs/CLIs before changing code or docs.

1. Gather state from providers (GitHub, Supabase, Vercel, Render, Infisical as applicable).
2. Use those checks when validating infra or release-impacting work.
3. Align proposals to observed reality; avoid stale assumptions.
4. **Never print secret values** — only names and presence/absence.

**CLI recipes** (GitHub `gh`, Supabase, curl examples for Render/Vercel/Infisical): see [`.cursor/skills/infrastructure-research.md`](../../../.cursor/skills/infrastructure-research.md).

## Optional environment credentials

These may appear in **cloud agent** or automation sessions. Local Cursor development often omits most of them; use Infisical login for app secrets instead.

| Env var                                    | Typical use                                                          |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `GITHUB_PAT`                               | GitHub PAT — branch-protection script; export as `GH_TOKEN` for `gh` |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI / management                                            |
| `INFISICAL_API_KEY`                        | Infisical API (may lack `local` env)                                 |
| `RENDER_API_KEY`                           | Render API                                                           |
| `VERCEL_API_KEY`                           | Vercel API                                                           |
| `SUPABASE_API_KEY`                         | Supabase Management API                                              |
| `JULES_USER_API_KEY`                       | Jules automation (if used)                                           |

> **Canonical name & aliases.** The hosted-agent GitHub PAT is `GITHUB_PAT`. Do **not** confuse it with `GITHUB_TOKEN`, which is the GitHub Actions runtime token (a different credential that lacks branch-administration scope). Scripts still tolerate the aliases `GITHUB_TOKEN`, `GH_PAT`, `GH_TOKEN`, and older images may expose `GITHUB_PERSONAL_ACCESS_TOKEN` / `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` / `RENDER_APIKEY` — but new code and docs use the canonical names only.

## GitHub PAT usage policy

The agent **may** use `GITHUB_PAT` for: creating/closing agent-owned PRs, labels, issues, branch protection script, GitHub environments/protection rules, reading PR/CI/branch state.

The agent **must not** use it to: merge without explicit approval, delete branches without approval, broaden repo settings beyond branch protection/environments, create/modify GitHub Secrets, force-push, or create releases/tags outside the automated release workflow.

Node scripts (e.g. `configure-branch-protection.mjs`) read `GITHUB_PAT` directly. For `gh`/git, export it as `GH_TOKEN` first — `gh` only auto-reads `GH_TOKEN`/`GITHUB_TOKEN`, not `GITHUB_PAT`. The value must be a PAT with the required repository permissions; do not assume the GitHub Actions runtime token has branch-administration scope.

```bash
export GITHUB_PAT=<token>
export GH_TOKEN="$GITHUB_PAT"   # required for gh / git
```

If only a legacy GitHub token alias is exposed in an older VM, copy it into `GITHUB_PAT` for the session; otherwise prefer the canonical name.

### Work status

There is **no GitHub Projects board** in this workflow. Work status lives in the in-repo backlog at
[`docs/backlog/`](../../backlog/README.md) (the single source of truth); GitHub issues mirror it via
their open/closed state, closed on completion by `Closes #N` in the PR body. Reconcile drift with
`/triage`.


## CI/CD summary

| Item                | Location / notes                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                  | `.github/workflows/ci.yml` — parallel jobs (`lint-and-typecheck` includes `nest build` for `apps/api`; `api-docker-build` runs `apps/api/Dockerfile`) |
| API deploy          | `.github/workflows/deploy-api.yml` — after CI (`workflow_run`)                                                                                        |
| Deploy verification | `.github/workflows/verify-deployments.yml` — post-push Render + Vercel state polling                                                                  |
| Release tags        | `.github/workflows/release.yml` — main → production merge                                                                                             |
| Docs                | `.github/workflows/docs.yml` — PR docs/spec sync (`check-docs-impact.mjs`)                                                                            |
| Branch protection   | `npm run configure:branch-protection` (prefers `GITHUB_PAT`); see `CONTRIBUTING.md`                                                                   |
| CodeRabbit          | `.coderabbit.yaml` — native advisory PR review; no GitHub Actions gate                                                                                |
| Vercel              | Deploys from `main` / `production` only (PR previews disabled via repo config)                                                                        |

**PR review policy:** `main` — no required human approval; `production` — required approval + resolved conversations.

**Branch protection script (dry run / apply):**

```bash
npm run configure:branch-protection -- --dry-run
npm run configure:branch-protection
```

Deeper deploy architecture: [`../ops/DEPLOYMENT.md`](../ops/DEPLOYMENT.md).

## Infisical sync map

| #   | Infisical env | Destination                         |
| --- | ------------- | ----------------------------------- |
| 1   | staging       | Render → frapp-api-staging          |
| 2   | production    | Render → frapp-api-prod             |
| 3   | staging       | Vercel → frapp-web (Preview)        |
| 4   | production    | Vercel → frapp-web (Production)     |
| 5   | staging       | Vercel → frapp-landing (Preview)    |
| 6   | production    | Vercel → frapp-landing (Production) |
| 7   | per-env       | GitHub Actions (OIDC)               |

Project ID is documented in [`SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md) and root `.infisical.json`.

## GitHub environments and bootstrap secrets

| Environment  | Protection        | Purpose                             |
| ------------ | ----------------- | ----------------------------------- |
| `staging`    | None              | Staging deploys (`main`)            |
| `production` | Required reviewer | Production deploys + migration gate |

Repository secrets for Infisical bootstrap: `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`.

Additional repo-level secrets used by the deploy-verification workflow: `RENDER_API_KEY`, `VERCEL_API_KEY`. These are read-only API keys used only by `.github/workflows/verify-deployments.yml` to poll deploy state — they never carry runtime values.

Deploy workflow resolves all runtime secrets (including `SUPABASE_ACCESS_TOKEN`) from Infisical at workflow time via `Infisical/secrets-action`. No GitHub environment-scoped runtime secrets are required beyond the Infisical bootstrap listed above.

## Release labels

| Label           | Effect on version bump |
| --------------- | ---------------------- |
| `release:major` | Major                  |
| `release:minor` | Minor                  |
| `release:patch` | Patch (default)        |

## Lint, test, build (repo root)

- `npm run lint` — turbo lint
- `npm run lint:api` — API only
- `npm run test -w apps/api` — Jest
- `npm run build` — turbo build
- `npm run check-types` — turbo TypeScript
- `npm run check:api-contract` — OpenAPI / SDK drift
- `npm run check:migration-safety` — migrations + promotion docs

Testing workflows and CI parity: [`.cursor/skills/testing.md`](../../../.cursor/skills/testing.md).

## Claude Code project settings

`.claude/settings.json` ships repo-wide config for Claude Code sessions (cloud and local). Current contents:

| Key               | Value  | Effect                                                                                                                                                                                                                                                           |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doneMeansMerged` | `true` | The session is not "done" when code is pushed — it's done when the PR is green and review-clean. Drives the babysit-until-merge loop (open PR → `subscribe_pr_activity` → fix CI failures and review comments until merge-ready, or a self-contained next step). |

Authoring contract for the loop (what an agent must do) lives in [`AGENTS.md`](../../../AGENTS.md) under "Autonomous PR lifecycle". Keep the two in sync when changing either.

## Agent dev stack (cloud sessions)

Decision context lives in [ADR-11 (`spec/architecture/README.md`)](../../../spec/architecture/README.md); track program-level state in the backlog ([`docs/backlog/projects/agent-infra.md`](../../backlog/projects/agent-infra.md)). This section is the operating doc — what's in the stack today, how to bring it up, what's still blocked.

### What the stack is

Two layers, both runnable from a sandbox with no Docker and no privileged tooling:

1. **Hot-path code is testable in NestJS.** Per ADR-11, chat hot-path writes (`chat-send`, `chat-react`) live in the existing `apps/api` NestJS service alongside cold reads and the in-process push worker (ADR-09). Standard Jest + supertest covers integration; the `SupabaseAuthGuard` and `SUPABASE_CLIENT` provider that the push worker already uses are reused for auth and Realtime emit. Since #416 shipped, `supabase/functions/chat-*` is retired and chat-adjacent chunks no longer carry the "Runtime checks BLOCKED" disclaimer.
2. **Migration validation runs on PGlite.** `scripts/check-pglite-migrations.mjs` applies every `supabase/migrations/*.sql` to a fresh in-process Postgres-in-WASM and asserts the schema landmarks reviewers care about. Always-on, runs in CI as `pglite-migrations`, and runs identically from any cloud-agent sandbox. No real DB required.

### How to bring it up at session start

Nothing to provision. Both layers run from the repo as plain `npm` scripts:

```bash
# Run the API test suite, including chat-related tests
npm run test -w apps/api

# Run the PGlite migration validator
npm run check:pglite-migrations
```

The agent does not need `SUPABASE_URL` / `SUPABASE_ANON_KEY` / service-role keys to run any of these. The PGlite harness instantiates Postgres directly in-process; the NestJS tests use the existing Jest mocks.

### When you need a real Supabase

For end-to-end verification that touches Realtime, Presence, push fanout, or RLS as GoTrue enforces it, the agent still depends on the hosted `frapp-staging` project. **This requires the Supabase MCP write tools (`create_branch`, `apply_migration`) to be allowed in the session's `.claude/settings.json` permissions.** They are denylisted by default — see the [#411 spike comment](https://github.com/pdcarlson/Frapp/issues/411#issuecomment-4559934654) for the failure mode if you call them without that change.

If a future spike re-evaluates Path A and the allowlist lands, the SessionStart hook would:

1. Confirm cost via `mcp__f9f5eb7a-…__get_cost` / `confirm_cost`.
2. `create_branch` against the staging project (one branch per session, never shared).
3. Apply every migration in chronological order via `apply_migration`.
4. Write `SUPABASE_URL` / `SUPABASE_ANON_KEY` / a scoped, short-lived service-role JWT to `apps/*/.env.local` (gitignored). Never commit. Pre-commit grep for `*.supabase.co` and `eyJ` JWT prefixes hard-fails staged diffs that contain them.
5. SessionEnd hook calls `delete_branch` (idempotent) and confirms via `list_branches`.

Today this hook does not exist. If a chunk needs it, file a follow-up issue rather than working around it in the chunk PR. (Note: post-#416 there are no Edge Functions in this repo, so `deploy_edge_function` is not part of the bring-up.)

### "Runtime checks BLOCKED" protocol

The disclaimer ADR-11 was written against (chat-adjacent chunks gated on a live Supabase Edge Functions runtime) **retired with #416**. The hot path is now NestJS code that runs in the same Jest tier as the rest of the API, and migrations validate via PGlite — both run in any sandbox.

If a future chunk crosses a boundary the sandbox still can't reach (live Realtime / Presence as the hosted stack negotiates it, push fanout against real APNS/FCM, RLS-as-enforced-by-GoTrue with a real JWT):

- **Do not check the verification box.** Mark it blocked.
- File or link a tracking issue (`#401` is the agent infra parent; #235 closed-as-subsumed by ADR-11 and should not be reopened — file a fresh issue scoped to the new gap).
- In the chunk PR body, list each blocked step + the linked issue + which class of verification is missing.
- In `STATUS.md`, set the chunk's notes column accordingly.

### Sandbox-blocked tooling — known list

- **Docker / `supabase start` / `supabase db reset`:** no Docker daemon. Cannot start the local stack. Use the PGlite harness for migration validation.
- **Supabase MCP write tools (`create_branch`, `apply_migration`, `delete_branch`) and most read tools (`list_branches`, `get_project`, `get_cost`):** denied by `.claude/settings.json` by default. `list_projects` happens to be allowed. Do not assume any MCP tool works until you've tried it.
- **Outbound HTTP to arbitrary hosts:** governed by the sandbox's network policy. `host_not_allowed` is the failure shape.
- **System packages requiring `apt-get` / root:** unavailable. The PGlite WASM bundle is npm-installable and needs none.

When you hit a new block, add it here in the same PR you discovered it in.
