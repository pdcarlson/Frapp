# Agent infrastructure and CI reference

Operational detail for AI agents and maintainers working on deploys, CI, secrets, and provider APIs. Day-to-day local setup lives in [`LOCAL_DEV.md`](../environment/LOCAL_DEV.md).

## Research-first workflow

When relevant credentials exist in the environment, prefer gathering **runtime truth** (CI, deploy health, schema, secret presence) via provider APIs/CLIs before changing code or docs.

1. Gather state from providers (GitHub, Supabase, Vercel, Render, Infisical as applicable).
2. Use those checks when validating infra or release-impacting work.
3. Align proposals to observed reality; avoid stale assumptions.
4. **Never print secret values** — only names and presence/absence.

**CLI recipes** (GitHub `gh`, Supabase, curl examples for Render/Vercel/Infisical): see [`.claude/skills/infrastructure-research/SKILL.md`](../../../.claude/skills/infrastructure-research/SKILL.md).

## Optional environment credentials

Provider/research credentials and cloud-sandbox runtime vars that may appear in cloud agent / automation sessions are listed canonically in [`../environment/AGENT_CREDENTIALS.md`](../environment/AGENT_CREDENTIALS.md) (including the canonical-name/alias discussion). Local development omits most of them; use Infisical login for app secrets instead. The GitHub PAT usage policy below stays here.

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

There is **no GitHub Projects board** in this workflow. Work status lives in **GitHub Issues** on
`pdcarlson/Frapp` — the single source of truth (Linear was retired 2026-08-08; record in
[#680](https://github.com/pdcarlson/Frapp/issues/680)). Board states are label conventions
(`triage` / priority `P1`–`P4` / `in-progress` / `in-review`); PRs close linked issues natively
with `Fixes #N` on merge. In cloud sandboxes the GitHub MCP is the only *sanctioned* tracker path — the PAT/`gh` recipes
above are for Actions and laptops; sandbox shell access to `api.github.com` is session-dependent
(observed both proxy-blocked and working, 2026-08-08), so tracker workflows must not depend on
it. Design + policy: [`GITHUB_PM.md`](GITHUB_PM.md).


## CI/CD summary

| Item                | Location / notes                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                  | `.github/workflows/ci.yml` — parallel jobs (`lint-and-typecheck` includes `nest build` for `apps/api` + landing unit tests; `api-tests` runs `apps/api` Jest unit + E2E suites (`test` then `test:e2e`); `web-tests` runs `apps/web` Vitest; `api-docker-build` runs `apps/api/Dockerfile`) |
| API deploy          | `.github/workflows/deploy-api.yml` — after CI (`workflow_run`)                                                                                        |
| Deploy verification | `.github/workflows/verify-deployments.yml` — post-push Render + Vercel state polling                                                                  |
| Release tags        | `.github/workflows/release.yml` — main → production merge                                                                                             |
| Docs                | `.github/workflows/docs.yml` — PR docs/spec sync (`check-docs-impact.mjs`)                                                                            |
| CI wake             | `.github/workflows/ci-wake.yml` — `workflow_run` on CI / Docs spec sync / Links completion (PR runs only): classifies infra-vs-code failure, auto-requeues infra failures (≤3 total attempts), upserts one PR wake comment. Logic in `scripts/ci/ci-wake.mjs` (tests: `scripts/ci/__tests__/ci-wake.test.mjs`). **Not** a required check. See "PR babysitting" below. |
| PR base sync        | `.github/workflows/pr-base-sync.yml` — `push` to `main`: sweeps open PRs targeting it (cap 20, logged); behind + clean PRs are auto-updated via the update-branch API **only when the `PR_BASE_SYNC_TOKEN` PAT secret exists** (default-token pushes trigger no CI), otherwise — and always for conflicts — upserts one `<!-- frapp-base-sync -->` wake comment telling the watching agent to merge `main` itself. Logic in `scripts/ci/pr-base-sync.mjs` (tests: `scripts/ci/__tests__/pr-base-sync.test.mjs`). **Not** a required check. See "Base-branch sync" below. |
| Branch protection   | `npm run configure:branch-protection` (prefers `GITHUB_PAT`); see `CONTRIBUTING.md`                                                                   |
| AI code review      | **Local pre-push gate**, not CI — `.claude/hooks/pre-push-review-gate.sh` blocks pushing a HEAD until that HEAD has been reviewed (keyed on a `.cache/diff-review/<SHA>` marker, not on attempt count) — `/diff-review` (always agent-invocable; writes the marker) or `/code-review` (richer, but model-invocable only when the turn's prompt carries `/code-review` whitespace-delimited on both sides, which backticks and trailing punctuation defeat; does not write the marker) (ADR-14 2026-06-04 amendment; the `claude-review.yml` CI workflow was removed). See `AI_CODE_REVIEW_RUNBOOK.md` |
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
| `production` | Promotion-PR gate | Production deploys + migrations |

> **Private-repo note:** GitHub *environment* required-reviewer protection rules are GitHub Enterprise-only on private repos, so they do **not** gate this (private, Pro) repo. The production gate is the `main` → `production` promotion PR (branch protection: CI + an approving review + conversation resolution); the `production` environment still exists for job scoping.

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

- `npm run lint` — turbo lint (read-only)
- `npm run lint:api` — API only (read-only)
- `npm run lint:api:fix` — applies ESLint auto-fixes; the only lint script that writes; see [contributing.md §5](../../guides/contributing.md#5-linting-types-and-tests)
- `npm run test -w apps/api` — Jest
- `npm run build` — turbo build
- `npm run check-types` — turbo TypeScript
- `npm run check:api-contract` — OpenAPI / SDK drift
- `npm run check:migration-safety` — migrations + promotion docs

`lint` and `check-types` both depend on `^build` in root `turbo.json`, so they build the shared
packages themselves and need no `npx turbo run build --filter='./packages/*'` beforehand — a bare
`npm install && npm run check-types` works on a cold clone. The CI job **`clean-checkout-typecheck`**
exists solely to keep that true: it runs `npm ci`, `npm run check-types` and `npm run lint` with no
`needs:`, no turbo cache restore, and no prebuild step. Every other Node job prebuilds the packages
(ADR Lever A), which makes them all blind to this regression — so do not "optimize" a build or cache
step into that job.

Testing workflows and CI parity: [`.claude/skills/testing/SKILL.md`](../../../.claude/skills/testing/SKILL.md).

## Claude Code project settings

`.claude/settings.json` ships repo-wide config for Claude Code sessions (cloud and local). Current contents:

| Key               | Value  | Effect                                                                                                                                                                                                                                                           |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doneMeansMerged` | `true` | The session is not "done" when code is pushed — it's done when the PR is green and review-clean. Drives the babysit-until-merge loop — the six-step contract in AGENTS.md § "Autonomous PR lifecycle": open PR → subscribe → **arm a durable self-wake** → **triage infra-vs-code** → fix until merge-ready (or a self-contained next step). |
| `permissions.allow` | `Workflow` + claude-code-remote scheduling/PR-watch rules | Auto-approves launches of the multi-agent **Workflow** tool (bare tool name = allow all invocations), so `/next ultracode` and other opted-in turns orchestrate fan-outs without a permission prompt breaking autonomy. Also auto-approves the claude-code-remote scheduling and PR-watch tools (`send_later`, `create/update/delete/list_triggers`, `subscribe/unsubscribe_pr_activity`) so unattended sessions can arm check-ins and wait on GitHub/CI without stalling on a prompt — `subscribe_pr_activity` is step 2 of the AGENTS.md babysit loop, so leaving it out would stall the exact path these rules exist for. Each tool is listed under **every observed server naming** (`mcp__Claude_Code_Remote__*` and the connector-UUID prefix `mcp__bf7c680d-…__*`; the PR-watch pair additionally surfaces via the GitHub MCP server as `mcp__github__subscribe/unsubscribe_pr_activity`, so it carries a third spelling): permission rules are exact string matches against the surfaced tool name, an unmatched rule is silently inert, and each listed spelling has been seen live in cloud sessions — re-verify if a connector is ever re-registered. The list also carries a **curated GitHub MCP set** for the babysit loop — reads plus `actions_run_trigger`, comment/thread, and PR create/update writes. `merge_pull_request`, `enable_pr_auto_merge`, `push_files`, `create_or_update_file`, and `delete_file` stay unlisted, so merging and direct content writes still prompt. (`issue_write` is deliberately not listed either — on cloud sandboxes the harness's own `--allowed-tools` carries the `mcp__github__*` wildcard (agent-observed), and a fresh-sandbox write ran prompt-free per the owner's report in #680; prompt behavior on other surfaces is unverified — only the owner can observe prompts.) The Linear entries #667/#669 added were removed when Linear was retired — see "Applied permission allows" below and [#680](https://github.com/pdcarlson/Frapp/issues/680). |
| `skipWorkflowUsageWarning` | `true` | Marks the multi-agent workflow usage warning as accepted. Per the settings schema (an `@internal` key, read out of the 2.1.220 build — re-verify on newer builds): "Until set, auto permission mode prompts before running a workflow." Set so unattended sessions don't stall on that prompt; a launch that prompts anyway on some build falls back to inline checks (see `/next`). |
| `hooks` | PreToolUse + SessionStart | Wires [`pre-push-review-gate.sh`](../../../.claude/hooks/pre-push-review-gate.sh) (Bash matcher — the single pre-PR review gate) and [`session-start.sh`](../../../.claude/hooks/session-start.sh) (cloud-sandbox bringup). A second PreToolUse hook (`linear-autoallow.sh`, PR #676) auto-approved Linear's write tools; it was deleted with the Linear retirement — see "Applied permission allows" below. Details: [`AI_CODE_REVIEW_RUNBOOK.md`](AI_CODE_REVIEW_RUNBOOK.md) and the "Claude Code web sandbox" section of [`AGENTS.md`](../../../AGENTS.md). |

Authoring contract for the loop (what an agent must do) lives in [`AGENTS.md`](../../../AGENTS.md) under "Autonomous PR lifecycle". Keep the two in sync when changing either.

## PR babysitting: wake signals and CI-failure triage

Why the babysit loop needs more than `subscribe_pr_activity`, and what each layer covers. Root
cause on record: during the 2026-08-06 GitHub Actions outage, PR #659's `secret-scan` job died in
runner setup ("Failed to resolve action download info. Error: Service Unavailable" — the job's only
step was "Set up job"), six sibling jobs were cancelled without ever getting a runner, and the
watching session was never woken — the PR sat silent for ~2h until a human noticed.

### Wake coverage

| Signal | Fires on | Misses |
| ------ | -------- | ------ |
| PR-activity webhook (`subscribe_pr_activity`) | CI **failure**, comments, reviews | success, cancelled, timed-out, merge-conflict — all silent |
| `CI wake` watchdog comment (`ci-wake.yml`) | success / failure / cancelled / timed-out (and startup_failure/stale) of CI / Docs spec sync / Links on PR runs — comments are webhook events, so they wake subscribed sessions | outages that kill the watchdog run itself; merge-conflict; review-state changes; `skipped`/`neutral`/`action_required` conclusions and superseded runs (deliberately silent) |
| `PR base sync` wake comment (`pr-base-sync.yml`) | `main` moving while this PR is conflicted with it, or behind it and not auto-updateable — the comment says which and what to do | base moves while the sweep run itself dies; PRs past the sweep's 20-PR cap this round (logged; the sweep processes least-recently-updated first, so deferred PRs rotate to the front of a later sweep); unknown mergeability (skipped fail-safe, deliberately silent) |
| Scheduled self-wake (`send_later`, re-armed each wake) | anything — the session re-checks PR state via MCP | nothing, **if** Routines are enabled account-side |

Layered conclusion: the self-wake is the only complete net, the watchdog comment is the fast path
for CI outcomes, the base-sync comment is the fast path for base moves and merge conflicts, and the
webhook is the fast path for failures and human comments. Arm them all.
Sandbox shell access to `api.github.com` is session-dependent (the org-connect 403 was observed
2026-08-08; a 200 was observed the same day in another session), so background polling of GitHub
cannot be relied on — treat GitHub as reachable only through MCP tools, only while awake.
If `send_later` returns `MCP error -32003 … requires approval`, Routines are disabled account-side;
that is not a permissions-file problem (the allow rules below are honored for other tools) and no
repo change fixes it — the session must say so to the user and rely on the other two layers.

### What the watchdog does (`scripts/ci/ci-wake.mjs`)

- **Classifies** the completed run. *Infra failure*: every failed job died before its first
  repo-defined step (runner-phase steps only — the outage signature); a `cancelled` run counts
  only when **no job ever started a step** (never got a runner), so a deliberate human/agent
  cancellation of a running job is commented but never resurrected; `timed_out` /
  `startup_failure` / `stale` count too. *Code failure*: any job failed in a real step.
  *Superseded*: a newer run of the same workflow exists for the branch (repush; `ci.yml`'s
  `cancel-in-progress` cancels the old run on every push) — stays fully silent, no re-run, no
  comment. Classification **fails closed**: if the jobs or runs API errors mid-classification,
  the run is reported as unclassified and never called "infra", never requeued — an API blip
  must not relabel a real code failure as infrastructure.
- **Auto-requeues infra failures** via `rerun-failed-jobs` (falling back to plain `rerun` for
  cancelled-only runs), capped at **3 total attempts** per run id. The cap is mandatory: per
  GitHub's documented `workflow_run` semantics, a re-run creates a new attempt of the same run
  and fires `workflow_run: completed` again when it finishes, and GITHUB_TOKEN's recursion guard
  does **not** stop this loop (it only blocks *creating* new runs) — so an uncapped loop would
  retry to GitHub's 50-attempt ceiling. Prior art: vercel/next.js `retry_test.yml` uses exactly
  this trigger + `run_attempt` guard. These are docs-verified claims (2026-08-06), not yet
  observed in this repo — confirm on the first post-merge firing.
- **Upserts one wake comment per workflow** on the open PR: deletes that workflow's previous
  marker comments (`<!-- frapp-ci-wake:<workflow name> -->`) and posts a fresh one, so a green
  `Links` wake can never erase a red `CI` wake. Open-state is checked via the pulls API (a
  merged/closed PR gets no wake), and the head-owner comes from the run's head repo so fork PRs
  resolve. Delete-then-create, never edit-in-place — comment edits deliver webhook
  `action=edited`, which created-only listeners (the agent wake path) never see. At most one
  live comment per watched workflow (≤3) keeps threads readable.
- Runs with minimal action surface (checkout only, preinstalled runner Node, no `npm ci`) so the
  watchdog itself has the least possible exposure to the action-download infra failures it absorbs.
  It is best-effort by design; the self-wake layer covers the case where the watchdog run dies too.
- Scope note vs. ADR-14: the "no inline GitHub comments" trade-off recorded for AI *review*
  (see `AI_CODE_REVIEW_RUNBOOK.md`) is unchanged — the wake comment is machine signaling about CI
  state, not review commentary, and there is exactly one live comment per PR.

Because `workflow_run` executes the **default branch's** copy of the workflow and script, changes
to either take effect only after merging to `main` — they cannot be exercised from the PR that
introduces them (unit tests + this doc are the pre-merge verification).

### Base-branch sync (`scripts/ci/pr-base-sync.mjs`)

Branch protection on `main` sets `strict: true`, so every merge to `main` outdates every other
open PR. `pr-base-sync.yml` fires on each push to `main` and sweeps open PRs targeting it —
sequentially, capped at 20 per sweep with the remainder logged (never silently truncated), and
listed **least-recently-updated first**: acting on a PR bumps its `updated_at` to the back of the
next sweep's order, so a deferred PR rotates to the front instead of being starved behind the same
busy twenty. Per PR, after bounded polling of GitHub's lazily-computed `mergeable` flag:

- **Conflicted** → one `<!-- frapp-base-sync -->` wake comment telling the watching agent session
  to `git fetch origin main && git merge origin/main`, resolve, and push. Conflicts always go to
  an agent — no API call can resolve them.
- **Behind and clean** (measured with the compare API's `behind_by`, not `mergeable_state`, which
  reports `blocked` over `behind`) → auto-updated via `PUT …/update-branch` with
  `expected_head_sha`, **only when the `PR_BASE_SYNC_TOKEN` secret is configured**. This must be a
  fine-grained PAT (contents + pull-requests write): pushes made with the default `GITHUB_TOKEN`
  do not create workflow runs (GitHub's recursion guard), so an update through it would strand
  required checks at "Expected" with no CI ever running — strictly worse than not updating. With
  no PAT, on a fork head, or when the update call fails, the wake comment asks the agent to merge
  `main` itself — the agent's own push triggers CI normally. GitHub invalidates `mergeable`
  lazily, so a sweep racing the base push can read a stale `true` for a freshly-conflicted PR;
  when the update-branch call then fails with a conflict message, the sweep posts the **conflict**
  wake (not the behind one), so the agent always gets resolution guidance when it will need it.
- **Already in sync** → any stale base-sync wake comment is deleted and the sweep stays silent.
  Unknown mergeability (API error, `mergeable` never resolves) is skipped fail-safe: never
  blind-updated, never falsely accused of conflicts; the next base move re-sweeps.

Comment mechanics match `ci-wake.mjs` (shared helpers): delete-then-create so created-only webhook
listeners fire on every base move, one live comment per PR. Like the CI wake watchdog it is
best-effort, minimal-action-surface, and **not** a required check; a successful auto-update posts
no comment at all — CI runs on the updated head and the CI wake announces its outcome. The
GITHUB_TOKEN-pushes-trigger-no-CI constraint is GitHub's documented recursion guard
(docs-verified knowledge, 2026-08-07; not yet observed in this repo — confirm on the first
post-merge firing with the PAT configured).

### Applied permission allows

Originally applied by a human paste in PR #667 (2026-08-07): at the time, the Claude Code
auto-mode classifier was observed to hard-block an agent editing `.claude/settings.json`
(2026-08-06/07; later sessions' edits went through, so treat that behavior as build-dependent, not
settled). Self-granting permissions is a boundary user intent does not clear — permission-prompt
fatigue is fixed by a human merging the allowlist, never by the agent mid-session. What the list
carries and why:

- **The Linear era ended here (2026-08-08).** Three shipped attempts to stop Linear MCP permission
  prompts in cloud sessions — server-level allows (`mcp__Linear`/`mcp__linear`, PR #667),
  connector-UUID allows (PR #669), and a `PreToolUse` auto-allow hook (`linear-autoallow.sh`,
  PR #676) — all failed to verifiably stop the prompts, and each shipped with a verification claim
  an agent cannot actually make: **an agent cannot observe permission prompts** (an auto-approved
  call and a manually-approved call return identical results — only the human watching the session
  knows whether it prompted). Root cause was never established; the cloud harness's own
  `--allowed-tools` launch snapshot (readable live from `/proc/<pid>/cmdline`) omitted Linear's
  eight write tools while carrying the `mcp__github__*` wildcard, which is why GitHub Issues was
  viable as the replacement tracker. Rather than keep guessing, Linear was retired and work
  tracking moved to GitHub Issues — full decision record, probe table, and evidence policy in
  [#680](https://github.com/pdcarlson/Frapp/issues/680). The four Linear allow entries and the
  hook (plus its `mcp__.*__(save_.*|get_workspace)` PreToolUse wiring) were removed in the
  migration PR. Lesson that outlives the code: **never write a permission-behavior claim that
  isn't backed by the owner reporting what they saw.**
- GitHub MCP reads: `get_me`, `pull_request_read`, `list_pull_requests`, `search_pull_requests`,
  `actions_get`, `actions_list`, `get_job_logs`, `get_check_run`, `get_commit`, `list_commits`,
  `list_branches`, `get_file_contents`, `issue_read`, `list_issues` (each as `mcp__github__<tool>`).
- GitHub MCP writes the babysit loop needs: `actions_run_trigger` (re-run infra-failed CI),
  `add_issue_comment`, `add_reply_to_pull_request_comment`, `resolve_review_thread`,
  `create_pull_request`, `update_pull_request`, `update_pull_request_branch`.
- Deliberately **excluded** so they keep prompting: `merge_pull_request`, `enable_pr_auto_merge`,
  `push_files`, `create_or_update_file`, `delete_file` — merging and direct content writes stay
  behind a human, per the PAT policy above. `issue_write` is also unlisted here, but on cloud
  sandboxes it is auto-approved anyway by the harness's `mcp__github__*` wildcard — that
  harness-level grant is what the GitHub Issues tracker rides on (see #680; owner-verified
  prompt-free from a fresh sandbox, 2026-08-08).
- The claude-code-remote scheduling/PR-watch tools are listed under **three** observed server
  namings — `mcp__Claude_Code_Remote__*`, `mcp__claude-code-remote__*`, and the connector-UUID
  prefix. The hyphenated-lowercase spelling was observed live 2026-08-07, when `delete_trigger`
  prompted despite the other two spellings being allowlisted; add any newly observed spelling the
  same way rather than replacing existing ones.

Also verified: an "always allow" click in one session/surface does not propagate to fresh cloud
containers — only rules committed to `.claude/settings.json` travel with the repo — and a
`send_later` / `create_trigger` failure shaped `MCP error -32003 … requires approval` is an
account-side Routines gate, not a permissions-file miss (allow rules for those tools are already
present and honored when the gate is open).

## Agent dev stack (cloud sessions)

Decision is recorded in [**ADR-12** (`spec/architecture/README.md`)](../../../spec/architecture/README.md) (extending ADR-11): PGlite-backed NestJS tests are the **default substrate** (Paths C+D), a per-session Supabase branch is the **opt-in escape hatch** (Path A), and a rootless in-sandbox stack (Path B) is rejected. Track program-level state in **GitHub Issues** (the agent-infrastructure epic and its sub-issues). This section is the operating doc — what's in the stack today, how to bring it up, what's still blocked.

### What the stack is

Two layers, both runnable from a sandbox with no Docker and no privileged tooling:

1. **Hot-path code is testable in NestJS.** Per ADR-11, chat hot-path writes (`chat-send`, `chat-react`) live in the existing `apps/api` NestJS service alongside cold reads and the in-process push worker (ADR-09). Standard Jest + supertest covers integration; the `SupabaseAuthGuard` and `SUPABASE_CLIENT` provider that the push worker already uses are reused for auth and Realtime emit. Since #416 shipped, `supabase/functions/chat-*` is retired and chat-adjacent chunks no longer carry the "Runtime checks BLOCKED" disclaimer.
2. **Migration validation + RLS smoke run on PGlite.** `scripts/check-pglite-migrations.mjs` applies every `supabase/migrations/*.sql` to a fresh in-process Postgres-in-WASM and asserts the schema landmarks reviewers care about, plus an **RLS smoke tier** (ADR-12): every `public` table enables RLS (Frapp's default-deny invariant, #360), the chat hot-path tables hold their posture (`chat_channels`/`chat_messages` default-deny with no policies; `chat_message_actions` reaction policies stay scoped to `auth.uid()`), and `chapter_audit_log` stays append-only. It verifies policy *presence and shape*, not enforcement as the `authenticated` role — that (`SET ROLE` + real JWT) is tracked in #423 and the NestJS Jest tier. Always-on, runs in CI as `pglite-migrations`, and runs identically from any cloud-agent sandbox. No real DB required.

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

For end-to-end verification that touches Realtime, Presence, push fanout, or RLS as GoTrue enforces it, the agent still depends on the hosted `frapp-staging` project. **This requires the Supabase MCP write tools (`create_branch`, `apply_migration`) to be allowed in the session's `.claude/settings.json` permissions.** They are not allowlisted by default — the committed file has never carried a deny rule; the enforcement is the permission prompt, which unattended sessions cannot approve. See the [#411 spike comment](https://github.com/pdcarlson/Frapp/issues/411#issuecomment-4559934654) for the failure mode if you call them without that change.

Per **ADR-12** this is the **sanctioned opt-in escape hatch** (not a hypothetical). It is off by default: a session must explicitly opt in and acknowledge cost. When opted in, a SessionStart hook would:

1. Confirm cost via `mcp__f9f5eb7a-…__get_cost` / `confirm_cost`.
2. `create_branch` against the staging project (one branch per session, never shared).
3. Apply every migration in chronological order via `apply_migration`.
4. Write `SUPABASE_URL` / `SUPABASE_ANON_KEY` / a scoped, short-lived service-role JWT to `apps/*/.env.local` (gitignored). Never commit. Pre-commit grep for `*.supabase.co` and `eyJ` JWT prefixes hard-fails staged diffs that contain them.
5. SessionEnd hook calls `delete_branch` (idempotent) and confirms via `list_branches`.

This hook does not exist yet — the SessionEnd teardown + scoped MCP write allowlist are tracked as **#532**. Until it lands, the MCP write tools stay un-allowlisted in `.claude/settings.json` (they prompt, so headless sessions can't use them) and the branch path is unavailable; do not work around it in a chunk PR. (Note: post-#416 there are no Edge Functions in this repo, so `deploy_edge_function` is not part of the bring-up.)

### "Runtime checks BLOCKED" protocol

The disclaimer ADR-11 was written against (chat-adjacent chunks gated on a live Supabase Edge Functions runtime) **retired with #416**. The hot path is now NestJS code that runs in the same Jest tier as the rest of the API, and migrations validate via PGlite — both run in any sandbox.

If a future chunk crosses a boundary the sandbox still can't reach (live Realtime / Presence as the hosted stack negotiates it, push fanout against real APNS/FCM, RLS-as-enforced-by-GoTrue with a real JWT):

- **Do not check the verification box.** Mark it blocked.
- File or link a tracking issue (`#401` is the agent infra parent; #235 closed-as-subsumed by ADR-11 and should not be reopened — file a fresh issue scoped to the new gap).
- In the chunk PR body, list each blocked step + the linked issue + which class of verification is missing.
- In `STATUS.md`, set the chunk's notes column accordingly.

### Sandbox-blocked tooling — known list

- **Docker / `supabase start` / `supabase db reset`:** the daemon is not started by default. In a **Claude Code web sandbox configured per [`CLOUD_SANDBOX.md`](../environment/CLOUD_SANDBOX.md)** (setup script + Full/Custom network), `scripts/cloud-sandbox-up.sh` brings up Docker + local Supabase and writes `apps/api/.env.local`, so the full stack and `npm run start:dev -w apps/api` work and the API boots with no Infisical. Where that wiring is absent (unconfigured env, plain CI), there is still no daemon: use the PGlite harness for migration validation.
- **Supabase MCP write tools (`create_branch`, `apply_migration`, `delete_branch`) and most read tools (`list_branches`, `get_project`, `get_cost`):** not granted by `.claude/settings.json` (its allow rules cover only the Workflow tool and the claude-code-remote scheduling and PR-watch tools — no Supabase entries), so they prompt — and unattended sandboxes cannot approve the prompt. `list_projects` has been observed to go through. Do not assume any MCP tool works until you've tried it.
- **Outbound HTTP to arbitrary hosts:** governed by the sandbox's network policy. `host_not_allowed` is the failure shape. Note `supabase start` pulls images from **AWS ECR Public** (`public.ecr.aws`) + **CloudFront** (`*.cloudfront.net`), which the **Trusted** policy does not reliably allow — use **Full** (or a Custom allowlist adding those hosts). See [`CLOUD_SANDBOX.md`](../environment/CLOUD_SANDBOX.md).
- **System packages requiring `apt-get` / root:** unavailable. The PGlite WASM bundle is npm-installable and needs none.

When you hit a new block, add it here in the same PR you discovered it in.
