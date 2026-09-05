# AGENTS.md

Concise operating guide for AI agents and developers. **Deep detail:** [`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md) (machines, Infisical, ports), [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) (CI, deploys, PAT policy). **Task playbooks:** the skills under [`.claude/skills/`](.claude/skills/) — see [Skills](#skills-read-the-matching-one-before-deep-work).

## Optional agent credentials (automation / cloud sessions)

Hosted agent sessions may carry provider/research credentials and cloud-sandbox runtime vars. **Canonical list:** [`docs/internal/environment/AGENT_CREDENTIALS.md`](docs/internal/environment/AGENT_CREDENTIALS.md). Omit all on a normal laptop; use `npx infisical login` for local app secrets.

**Research-first:** when these exist, gather runtime truth (CI, deploys, schema, secret presence) before proposing changes. Never print secret values. GitHub PAT usage policy + CI tables: [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md).

## Operating mindset

- Confirm before external/public actions; be proactive on internal/repo work.
- **Use sub-agents liberally.** Delegate broad searches, independent research, and self-contained chunks to Explore/Plan/general-purpose sub-agents in parallel. Keep heavy reading out of your own context. Sub-agents inherit the session model — there is no pinned sub-agent model.
- **Stop and report cloud-sandbox failures — don't work around them.** If the local stack fails to come up (`.cloud-sandbox-up.failed`, `host_not_allowed`/`403`, Docker Hub rate limit, missing env var), STOP and tell the user exactly what to add or change in the Claude Code web environment (network policy, env var, setup script). These are environment config you cannot fix from inside the session. Map of symptom → fix: [`docs/internal/environment/CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md) ("When bringup fails"). Trust the `.cloud-sandbox-up.failed` sentinel over the log. **One exception, and the sentinel names it: a sentinel reading `(dependencies)` is yours to fix in this session — run `npm ci`.** It means only that `node_modules` is unusable; the stack itself is already up, because that check runs last. Report it only if `npm ci` cannot reach the registry, which is a network-policy problem like the rest.

## Spec vs code

**`spec/` is the source of truth for intended behavior. Code is the source of truth for current behavior.** Disagreement between them is a tracked bug — file it, do not silently pick whichever loaded first. Fix the stale side in the same PR when it's in scope. Do not "correct" a spec to match a bug, and do not "correct" working code to match a superseded spec, without an explicit decision. Mid-task habit: before you act on what a doc told you, verify the claim against whatever owns it, and fix the doc in the same pass. How: [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).

## ADR discipline

One-off incidents and decisions are logged as ADRs in [`spec/architecture/README.md`](spec/architecture/README.md). **They are ordinary documentation:** when an ADR says something no longer true, fix it in place as you would any other doc, and date the correction so a reader can tell it from the original. Keep what the log is *for* — the decision and why, including alternatives rejected and arguments later refuted, the part nobody can reconstruct from the code. No special ADR rule governs that; the documentation standard does ([§ What a doc owes a reader](docs/internal/DOCUMENTATION_CONVENTIONS.md#what-a-doc-owes-a-reader)). ADR numbers and headings are cited from CI, product code, tests and migrations, and nothing validates those citations, so changing one is a rename like any other: sweep for what points at it first ([§ When a doc turns out to be wrong](docs/internal/DOCUMENTATION_CONVENTIONS.md#when-a-doc-turns-out-to-be-wrong)). A rule graduates into **this file** only when it is (1) recurring, (2) still true, and (3) something an agent would not derive by reading the code. Incident narration stays in the ADR.

## Project overview

Frapp is a Turborepo + npm workspaces monorepo (**4 apps, 13 shared packages**). Structure: `README.md`. Product/architecture: `spec/`. Developer docs: markdown in [`docs/guides/`](docs/guides/README.md) (no separate docs web app in-repo).

- **Documentation map:** [`docs/README.md`](docs/README.md). **Conventions:** [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).

## Branch model

`main` is the only long-lived branch and deploys to staging on every merge. Feature branches from `main` → PR to `main`; `main` is the only legal PR base. Direct pushes to `main` are blocked. Production is deployed by dispatching the **Deploy production** workflow with a commit SHA — it refuses any commit that is not an ancestor of `main` with green CI. There is no `production` branch (retired #1340). Details: `CONTRIBUTING.md`.

## Documentation discipline

There is no gate that requires you to touch a doc. There used to be, and it is
gone (#1597): it could only see that *some* file under `docs/` or `spec/` moved,
never whether it was the right one, so the cheapest way to satisfy it was an
unowned paragraph parked in whatever doc was nearest. That is where most of this
corpus's duplication came from.

What replaces it is a judgement you make, not a check you satisfy:

- **Change a documented fact, and update it where it lives** — the placement map
  in [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md)
  says where that is. **Canonical developer guides** live under
  [`docs/guides/`](docs/guides/README.md).
- **One canonical place per fact.** Everywhere else links to it. If two docs must
  both mention it, one paragraph then a link — never a second statement that can
  drift from the first.
- **Most changes touch no documented fact, and need no doc edit.** That is the
  normal case, not an exception to excuse.
- **Never add a stray file, or a section to a doc whose subject it does not
  match, to make a change look documented.** An unowned claim in a canonical
  doc is worse than no claim: the next reader believes it.

What *is* enforced is narrow, and **neither check blocks a merge.** `Links`
(lychee, `--offline`) checks that markdown links and heading anchors resolve in
`docs/`, `spec/`, `.claude/`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`,
`apps/web/AGENTS.md` and `.github/pull_request_template.md`.
`env-slugs` checks Infisical environment slugs, but only where it looks and only
in the syntaxes it matches — `SCAN_ROOTS` and the patterns in
[`scripts/check-env-slugs.mjs`](scripts/check-env-slugs.mjs), read there rather
than restated here. A slug in `.claude/`, in `scripts/`, or in a root-level
README is outside its roots; a slug carried by a syntax it does not match is
invisible to it even inside one. Neither job — `link-check`
nor `env-slugs` — appears in any roster in
[`scripts/ci/lib/required-checks.mjs`](scripts/ci/lib/required-checks.mjs), so
neither blocks a merge: a broken link or anchor turns a check red and the PR
merges anyway. It is caught, and nothing stops on it. Beyond that slug case nothing checks whether a doc's
claims are true, or whether a path it cites still exists. Contract:
[`DOCS_CI.md`](docs/internal/ci-cd/DOCS_CI.md).

## Work tracking

Work lives in **GitHub Issues** on this repository. Linear is retired (ADR-16 amendment 5). **All issues are opened on GitHub with the `triage` label.** Never track work in a scratch file. Carve-out: `routine-state` infrastructure issues — not work; skipped by `/next` and the routines.

Closing is usually the PR that does the work (`Fixes #N`). Agents may also close directly when done, obsolete, or duplicate (`issue_write` + `state_reason`). The **GitHub MCP** is the only sanctioned tracker path in cloud sandboxes — never `gh` or raw REST. Board: `triage` → Backlog (no state label; priority expected) → `in-progress` → `in-review` → closed. Epics are parent issues with native sub-issues. Start work with `/next`. Policy: [`GITHUB_PM.md`](docs/internal/ci-cd/GITHUB_PM.md). Procedure: [`.claude/commands/next.md`](.claude/commands/next.md).

Follow-up that does not belong in the current PR: [`.claude/skills/file-follow-up/SKILL.md`](.claude/skills/file-follow-up/SKILL.md). Human-only blockers: file per that skill **and** ask in the end-of-run report — an issue is durable, not an interruption.

## Tech debt protocol (non-optional)

This repo is **mid-rebuild (Frapp → Signet)**. Treat existing code as *possibly dead* until you've checked, not as precedent.

**Before extending existing code, confirm it has real consumers.** A definition or `index.ts` re-export is not evidence of a caller. Building on an orphan doubles the debt.

**Never silently work around orphaned, superseded, or contradictory code.** Flag it in the response and the PR body, and file a GitHub issue per [`file-follow-up`](.claude/skills/file-follow-up/SKILL.md) — or fix it inline when it falls inside your change's blast radius. **"Out of scope" is not a verdict on a defect**, and neither is "pre-existing": what decides is blast radius, not diff radius. Standard: [`spec/engineering.md`](spec/engineering.md#changing-existing-code) § Changing existing code.

**The tracker is the only debt list.** Do not start a running debt file (`TECH-DEBT.md` or similar). GitHub Issues already have status, ownership, priority, and close-on-merge.

**When the existing shape is wrong, rebuild it rather than patch around it.** A much larger diff is an acceptable price for a system that is more correct and more consistent — and the typecheck, test, CI and review gates exist precisely so that a change of that size can be trusted. Age is not evidence of correctness. A rebuild too large for one reviewable change becomes an ordered series of them, each independently valuable and revertable, scoped before you start — never one unreviewable PR. Standard: [`spec/engineering.md`](spec/engineering.md#changing-existing-code) § Changing existing code.

**A cutover deletes what it replaces** in the same change, unless there is an explicit reason to keep both live (a flag, a documented migration window). "We might need it later" is not a reason. Checklist: [`.claude/skills/signet-cutover/SKILL.md`](.claude/skills/signet-cutover/SKILL.md).

**End every audit or implementation with a short "debt spotted" note** — even when the answer is "none found". One line per item plus the issue number.

## Services and ports

Default local run: `npm run dev:stack` (API + web + landing). Ports, URLs, per-app `dev:*` commands, fallbacks, mobile, Turbo: [`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md) § Ports and URLs.

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
| Doc links    | `npm run check:links` — markdown links and heading anchors; needs `npm run install:lychee` first |
| Migrations   | `npm run check:migration-safety`    |
| Boundaries   | `npm run check:dep-cruiser` — required gate; existing violations grandfathered in `.dependency-cruiser-known-violations.json`, which exists to shrink |
| Duplication  | `npm run check:duplication` — advisory; repo-wide threshold that only ratchets down |
| API breaking changes | `npm run check:api-breaking -- --base origin/main` — advisory; needs `bash scripts/install-oasdiff.sh` first |
| Coverage     | `npm run test:cov` — no threshold; a measurement, not a gate |

Gate postures: [`docs/internal/ci-cd/QUALITY_GATES.md`](docs/internal/ci-cd/QUALITY_GATES.md). Testing detail: [`.claude/skills/testing/SKILL.md`](.claude/skills/testing/SKILL.md).

## Skills (read the matching one before deep work)

All skills live under [`.claude/skills/`](.claude/skills/) and are invocable by an agent:

| Skill | Use |
| ----- | --- |
| [`/api-development`](.claude/skills/api-development/SKILL.md) | NestJS API, layered architecture, contract regeneration. |
| [`/ui-development`](.claude/skills/ui-development/SKILL.md) | Web / landing / UI: component layers, theming, data layer. |
| [`/signet-cutover`](.claude/skills/signet-cutover/SKILL.md) | Signet vs legacy Frapp surfaces: tokens, visual truth, delete-what-you-replace. |
| [`/realtime-resilience`](.claude/skills/realtime-resilience/SKILL.md) | Chat realtime, connection state, topic teardown, message delivery. |
| [`/testing`](.claude/skills/testing/SKILL.md) | Tests, verification, CI parity. |
| [`/audit`](.claude/skills/audit/SKILL.md) | Audits / quality reviews (RLS coverage, deps, contract, CI). |
| [`/file-follow-up`](.claude/skills/file-follow-up/SKILL.md) | File out-of-scope work and proven human-only blockers as GitHub issues. |
| [`/infrastructure-research`](.claude/skills/infrastructure-research/SKILL.md) | Deploy / CI / provider runtime-truth gathering. |
| [`/live-verification`](.claude/skills/live-verification/SKILL.md) | Verifying against **deployed staging** (live Realtime, RLS-as-GoTrue, deployed UI). Staging only, never prod. |
| [`/issue-curator`](.claude/skills/issue-curator/SKILL.md) | Scheduled backlog-curator routine ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). |
| [`/issue-triage`](.claude/skills/issue-triage/SKILL.md) | Scheduled triage routine ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). |
| [`/pr-followups`](.claude/skills/pr-followups/SKILL.md) | Weekly PR follow-ups harvester ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). |
| [`/docs-upkeep`](.claude/skills/docs-upkeep/SKILL.md) | Weekly docs sweep — verifies a rotating slice and **fixes** it ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). |
| [`/hygiene-scan`](.claude/skills/hygiene-scan/SKILL.md) | Daily code-hygiene routine — grounds first, scans a rotating slice whole, **fixes** one verified theme in a product-code PR ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)). |
| [`/diff-review`](.claude/skills/diff-review/SKILL.md) | Pre-push review gate. Mechanics: [`AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md). |
| [`/handoff`](.claude/skills/handoff/SKILL.md) | Copy-pasteable prompt handing work to a fresh session. Offer it proactively. |
| [`/needs-me`](.claude/skills/needs-me/SKILL.md) | Owner-facing: sweep what's waiting on Paul, pick one, walk it to done. Reads only. |

**Long sessions degrade.** Treat `/handoff` as a normal part of the workflow. Write orientation for the next session — not instructions.

## Gotchas

- API loads `.env.local` then `.env`; prefer `npm run dev:api` with Infisical.
- Local Supabase keys: `npx supabase status -o env`.
- `npx supabase db push --local` when using local CLI without a linked project ref. It is idempotent.
- Regenerate API contract after controller/DTO changes: `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`.
- Agent VMs expose `INFISICAL_SERVICE_TOKEN` / `INFISICAL_PROJECT_ID` (not `INFISICAL_API_KEY`); sandbox reach to Infisical needs `app.infisical.com` on the environment allowlist ([#1279](https://github.com/pdcarlson/Frapp/issues/1279)) — without it, use `.env.local` + `npx supabase status -o env` instead.
- Mobile needs Expo Go; not for headless VMs.
- **React is pinned to an exact `19.2.3` in every workspace, plus a root `overrides` entry. Do not widen it to a caret range.** React Native 0.86.2 bundles `react-native-renderer` 19.2.3, which asserts *exact* version equality with `react` at runtime. Its peer range is a caret and does not express that, so npm accepts a newer React without warning, hoists it to the root, and `apps/mobile` dies on first render with "Invalid hook call" / "Incompatible React versions". The pin *moves* with each Expo SDK bump (read the target from `expo/bundledNativeModules.json`) — moving it in lockstep across all five pin sites (`apps/landing`, `apps/mobile`, `apps/web`, `packages/hooks`, and the root `overrides`) is correct; widening it never is.
- **TypeScript 7 is two packages, not one.** `@typescript/native` is `npm:typescript@7.0.2` and provides `tsc`. The `typescript` package is `npm:@typescript/typescript6@6.0.2` (wrapper; `tsc6` / `createProgram` report 6.0.3 via `@typescript/old`, pinned in root `overrides`). Flattening that back to `typescript@7` takes down `nest build`, `typescript-eslint` (peer `<6.1.0`), and `ts-jest` (peer `<7`). Details: [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) § TypeScript 7.
- **Bumping an Expo SDK needs the lockfile re-resolved, not just a `npm install` — but re-resolved narrowly, never rebuilt from scratch.** Peer-only deps like `@expo/vector-icons` (`expo-font: ">=14.0.4"`) stay satisfied by the *old* pinned versions, so npm leaves the entire previous SDK chain hoisted at the root alongside the new one. **Prune and re-resolve just the Expo/React/Metro entries — never `rm -rf node_modules package-lock.json && npm install`.** A blanket rebuild does clear it, but npm records only the optional platform binaries matching the host that ran it, so a rebuild on Linux x64 silently drops the darwin/ARM SWC and `sharp` variants: `npm ci` still passes on Linux and CI stays green while a Mac checkout fails to load them. It also floats a large number of unrelated packages, and the next bullet is a second instance of the same hazard. The dropped-platform-binary mechanism, with a worked package list, is [`SECURITY_FIXES.md`](docs/internal/security/SECURITY_FIXES.md) § Do not "fix" this with a full lockfile rebuild — recorded there against the Next.js cleanup, but the mechanism is npm's, not Next's, so it applies to any full rebuild. The Expo-specific account is § Expo SDK 57 upgrade in the same file. Afterwards confirm `node_modules/expo` is the only copy and is the new version.
- **`jsdom` lives in the *root* `devDependencies`, and the workspaces that render must declare `@testing-library/react` + `react-dom` themselves.** Vitest resolves the `jsdom` environment from its own install location — the hoisted root `node_modules/vitest` — so a workspace-level `jsdom` is invisible to it, and vitest marks the peer `optional`, which means npm never auto-installs it. A lockfile regeneration that drops a stale hoisted copy therefore breaks every `environment: "jsdom"` config and every `/** @vitest-environment jsdom */` spec with `Cannot find package 'jsdom' imported from .../node_modules/vitest/...` ([#1395](https://github.com/pdcarlson/Frapp/pull/1395)). The same hoisting luck hid an undeclared `@testing-library/react` in `apps/mobile` and an undeclared `react-dom` peer in `packages/hooks`: declare what a workspace imports, or the next re-resolution nests it and the suite goes red.
- **`Skill(skill: "code-review")` is only invocable when this turn's prompt carries `/code-review` as a whitespace-delimited token.** Backticks, quotes, and trailing punctuation all defeat it. `/diff-review` is always invocable and is the pre-push gate. Mechanics: [`AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).
- Branch protection uses `enforce_admins: true`.

## Developer notes for agents

When the user supplies durable environment hints or tool workarounds not documented elsewhere, add a short bullet here.

- Cloud VMs expose the Render key as `RENDER_API_KEY` and the GitHub PAT as `GITHUB_PAT` (distinct from `GITHUB_TOKEN`, the Actions runtime token); prefer those names when present. For `gh`/git, `export GH_TOKEN="$GITHUB_PAT"`.

## Autonomous PR lifecycle (cloud sessions)

A task is not "done" when the code is pushed — it's done when the PR is ready to merge (`doneMeansMerged: true` in `.claude/settings.json`). After completing the requested work:

1. **Open a PR** against `main` — the only legal base. Don't wait to be asked.
2. **Subscribe to PR activity** (`subscribe_pr_activity`). The webhook fires on CI **failure**, **successful check-suite rollups**, comments, and reviews — not cancelled, timed-out, or merge-conflict. (The success half was observed on 2026-08-21 — four `check_suite.completed` envelopes with `"conclusion":"success"`; see [`AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) § Wake coverage.)
3. **Do not call `send_later`, and do not add it to `permissions.allow`.** It still prompts the owner. Wake coverage is the PR-activity webhook, `CI wake` comments, and `PR base sync` comments. Anything that needs a schedule is a Routine in the UI.
4. **Triage CI failures before "fixing" them.** A job that died before its first repo step is GitHub Actions infra, not code — re-run it (`actions_run_trigger`), don't patch. **No `CI wake` comment does not mean no failure:** that watchdog now comments only on a cancelled or timed-out run, or an infra failure its auto-requeue could not absorb. An ordinary red CI reaches you through the webhook and is yours to diagnose from the run itself.
5. **Babysit until green:** real CI failure → diagnose and push a fix; review comment → address and resolve the thread. A `Base-branch sync` comment (`<!-- frapp-base-sync -->`) means merge `origin/main` (or follow the comment). Once the base-sync App is configured a clean behind-PR is updated for you silently and no comment arrives; **until then it is not** — you get the comment and you do the merge. Never read the absence of a comment as "it was updated for me": check the PR's own mergeability. Details: [`AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) § Base-branch sync.
6. **Stop conditions:** green and review-clean, OR out of scope (file an issue, report, stop), OR the user says to stop (`unsubscribe_pr_activity`).

A `/next` session may hold **up to two open PRs** (pipelining in [`.claude/commands/next.md`](.claude/commands/next.md) Phase 4). Every obligation above then reads **plural**. The pipelined unit runs on a fresh from-`main` branch suffixed `-p2`.

Wake-path mechanics: [`docs/internal/ci-cd/AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) § "PR babysitting: wake signals and CI-failure triage".

## Claude Code web sandbox

`.claude/hooks/session-start.sh` launches `scripts/cloud-sandbox-up.sh` in the **background** at session start (gated on the `/etc/frapp-cloud-sandbox` marker, or `FRAPP_CLOUD_SANDBOX=1`) — it starts Docker + local Supabase and writes `apps/api/.env.local` and `apps/web/.env.local`, so the API boots and `npm run build -w apps/web` succeeds without Infisical.

- **Wait before using the DB/API:** poll for `.cloud-sandbox-up.done` (success) or `.cloud-sandbox-up.failed` (error); live log at `/tmp/cloud-sandbox-up.log`.
- **Boot the API** with `npm run start:dev -w apps/api` (the generated `.env.local` means no Infisical is needed).
- **On failure, STOP and report** what to fix in the web environment. Don't paper over it.
- Full config: [`docs/internal/environment/CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md). Local-only `.env.local` and SWC notes: [`docs/internal/environment/LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md).
