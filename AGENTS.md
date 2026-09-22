# AGENTS.md

Operating guide for agents and developers in this repo. Machines, Infisical and ports: [`LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md). CI, deploys, PAT policy and Infisical syncs: [`AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md). Task playbooks: [Skills and subagents](#skills-and-subagents).

## Operating mindset

- Be proactive on internal repo work. Confirm before external or public actions.
- Instructions Paul will execute go one step at a time, waiting for each outcome: the exact command, the exact setting or secret name (never its value), and what he'll see when it worked. A wall of nine steps gets half-done. Analysis (findings, trade-offs, the reasoning behind a recommendation) is still stated in full. A one-shot delivery with no next turn (an end-of-run report, a `[human]` issue body) carries every step; [`file-follow-up`](.claude/skills/file-follow-up/SKILL.md) governs that case.
- Verify a command against the tool (its `--help`, or the installed version's manifest), not against this repo's docs: nothing in CI runs a documented command, so a stale one stays stale. Say which claims you verified and which you derived.
- A question for Paul goes last, after any status and after the "debt spotted" note.
- Delegate sizeable, independent, reading-heavy work (a broad search, a separate research thread, a self-contained chunk) to parallel subagents, which keeps it out of your context. Do small lookups, and checks of your own work, yourself. The exception is an independent role from `.claude/agents/` where a procedure calls for one (see [Skills and subagents](#skills-and-subagents)).
- If the cloud-sandbox stack fails to come up (`.cloud-sandbox-up.failed`, `host_not_allowed`/`403`, a Docker Hub rate limit, a missing env var), stop and tell the user exactly what to change in this session's Claude Code web environment settings. That config can't be fixed from inside the session, and a workaround hides it. Trust the sentinel over the log; symptom-to-fix map: [`CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md) ("When bringup fails"). The exception: a sentinel reading `(dependencies)` means only `node_modules` is unusable and the stack is up, so run `npm ci` yourself, and report only if it can't reach the registry.

## Credentials and secrets

Hosted sessions may carry provider credentials and sandbox vars ([`AGENT_CREDENTIALS.md`](docs/internal/environment/AGENT_CREDENTIALS.md)); a laptop needs none. When they exist, gather runtime truth (CI, deploys, schema, secret presence) before proposing a change. Never print a secret value. The names are `GITHUB_PAT` (not `GITHUB_TOKEN`, the Actions token; for `gh`/git, `export GH_TOKEN="$GITHUB_PAT"`), `RENDER_API_KEY`, and `INFISICAL_SERVICE_TOKEN` / `INFISICAL_PROJECT_ID` (not `INFISICAL_API_KEY`). A sandbox reaches Infisical only with `app.infisical.com` on its allowlist; without it, use the generated `.env.local` and `npx supabase status -o env`.

App secrets live in Infisical (project ID in `.infisical.json`), listed in [`ENV_REFERENCE.md`](docs/internal/environment/ENV_REFERENCE.md) (there is no `.env.example`) and [`SECRETS_MANAGEMENT.md`](docs/internal/environment/SECRETS_MANAGEMENT.md). Names carry no `_STAGING` / `_PRODUCTION` suffix; values differ per environment. No placeholder secrets in CI. Local runs use the `dev` environment, with real Stripe test-mode keys and the real Sentry DSN.

## Spec vs code

`spec/` owns intended behavior; code owns current behavior. A disagreement between them is a tracked bug, not a tie to break by whichever you read first: file it, or fix the stale side in the same PR when it's in scope. Don't change a spec to match a bug, or working code to match a superseded spec, without an explicit decision. Before acting on what a doc says, check it against what owns the fact, and fix the doc in the same pass. How: [`DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).

## ADR discipline

ADRs in [`spec/architecture/adr/`](spec/architecture/adr/README.md) are ordinary docs: fix a statement that's no longer true in place, and date the correction so it reads apart from the original. Keep the decision and its reasons, including rejected alternatives and refuted arguments, because the code can't reconstruct them ([§ What a doc owes a reader](docs/internal/DOCUMENTATION_CONVENTIONS.md#what-a-doc-owes-a-reader)). ADR numbers and headings are cited from CI, product code, tests and migrations with nothing validating them, so sweep for citations before renaming one ([§ When a doc turns out to be wrong](docs/internal/DOCUMENTATION_CONVENTIONS.md#when-a-doc-turns-out-to-be-wrong)). A rule graduates into this file only when it is recurring, still true, and not derivable from the code; incident narration stays in the ADR.

## Documentation discipline

No gate requires a doc edit. The one that used to could only see that some doc moved, so it rewarded parking an unowned paragraph in the nearest file. Judge instead:

- Change a documented fact where it lives. The placement map in [`DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md) says where; developer guides live in [`docs/guides/`](docs/guides/README.md).
- One canonical place per fact; everywhere else links to it, because a second statement drifts.
- Most changes touch no documented fact and need no doc edit.
- Never add a stray file, or a section to a doc whose subject it doesn't match, to make a change look documented. An unowned claim in a canonical doc is worse than none, because the next reader believes it.

The doc CI checks, `Links` (markdown links and anchors) and `env-slugs` (Infisical slugs within its scan roots), block no merge, and nothing checks that a claim is true: [`DOCS_CI.md`](docs/internal/ci-cd/DOCS_CI.md).

## Work tracking

Work lives in GitHub Issues on this repo, never in a scratch file. Linear is retired (ADR-16 amendment 5): don't write to it or restore `LINEAR_API_KEY`. Open every issue with the `triage` label. `routine-state` issues are infrastructure, not work, and `/next` and the routines skip them.

- The GitHub MCP is the only sanctioned tracker path in cloud sandboxes, for reads and writes. If it's unavailable, stop tracker work and report; don't fall back to `gh` or raw REST. `issue_write` replaces the whole label set, so read-modify-write it.
- Close through the PR that does the work (`Fixes #N`), or directly when an issue is done, obsolete, or a duplicate (`issue_write` with `state_reason`).
- Board: `triage` → Backlog (no state label; priority expected) → `in-progress` → `in-review` → closed. Epics are parent issues with native sub-issues. Start work with `/next` ([`.claude/commands/next.md`](.claude/commands/next.md)). Policy: [`GITHUB_PM.md`](docs/internal/ci-cd/GITHUB_PM.md).
- Follow-up outside the current PR is filed per [`file-follow-up`](.claude/skills/file-follow-up/SKILL.md). A human-only blocker is filed and also asked ([§ Filing is necessary but not sufficient](.claude/skills/file-follow-up/SKILL.md#filing-is-necessary-but-not-sufficient--end-the-run-by-asking)), because an issue alone reaches no one.

## Tech debt protocol

The repo is mid-rebuild (Frapp → Signet), so treat existing code as possibly dead until checked, not as precedent. Standard: [`spec/engineering.md` § Changing existing code](spec/engineering.md#changing-existing-code).

- Before extending code, confirm it has real consumers. A definition or an `index.ts` re-export is not a caller, and building on an orphan doubles the debt.
- Never silently work around orphaned, superseded, or contradictory code. Fix it inline when it's inside your change's blast radius, otherwise file it per `file-follow-up`; either way, flag it in the response and PR body. Blast radius decides, not diff radius: "out of scope" and "pre-existing" are not verdicts on a defect.
- When the existing shape is wrong, rebuild rather than patch around it. A much larger diff is an acceptable price for a more correct, consistent system, and the typecheck, test, CI and review gates exist so a change that size can be trusted. Age is not evidence of correctness. A rebuild too large for one reviewable change becomes an ordered series, each step independently valuable and revertable, scoped before you start.
- A cutover deletes what it replaces in the same change, unless there's an explicit reason to keep both (a flag, a documented migration window); "we might need it later" is not one. Checklist: [`signet-cutover`](.claude/skills/signet-cutover/SKILL.md).
- The tracker is the only debt list. No `TECH-DEBT.md`: issues already carry status, owner, priority, and close-on-merge.
- End every audit or implementation with a short "debt spotted" note, one line per item with its issue number, even if it's "none found".

## Project overview

Turborepo + npm workspaces: 4 apps, 14 shared packages. Product and architecture: `spec/`. Developer guides: [`docs/guides/`](docs/guides/README.md). Documentation map: [`docs/README.md`](docs/README.md).

## Branch model

`main` is the only long-lived branch and the only legal PR base. Every merge deploys to staging; direct pushes are blocked. Production deploys by dispatching the **Deploy production** workflow with a commit SHA, which refuses any commit that isn't an ancestor of `main` with green CI. There is no `production` branch. Details: `CONTRIBUTING.md`; deploy architecture: [`docs/internal/ops/deployment/`](docs/internal/ops/deployment/).

## Starting the dev environment

- **Cloud (Claude Code web):** `.claude/hooks/session-start.sh` launches `scripts/cloud-sandbox-up.sh` in the background at session start, gated on `/etc/frapp-cloud-sandbox` or `FRAPP_CLOUD_SANDBOX=1`. It starts Docker and local Supabase and writes `apps/api/.env.local` and `apps/web/.env.local`, so the API boots and `npm run build -w apps/web` works without Infisical. Before using the database or API, wait for `.cloud-sandbox-up.done`, or stop on `.cloud-sandbox-up.failed` (log: `/tmp/cloud-sandbox-up.log`); then boot the API with `npm run start:dev -w apps/api`. Troubleshooting: [`CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md).
- **Laptop / WSL / Linux:** with Docker reachable, `bash scripts/local-dev-setup.sh`, then `npx infisical login` once and `npm run dev:stack` (API + web + landing). Ports and per-app `dev:*` commands: [`LOCAL_DEV.md` § Ports and URLs](docs/internal/environment/LOCAL_DEV.md#ports-and-urls).

## Lint, test, build, type-check

| Step | Command |
| ---- | ------- |
| Lint | `npm run lint` / `npm run lint:api` (read-only) |
| Lint autofix | `npm run lint:api:fix`, the only lint script that writes; see [contributing.md §5](docs/guides/contributing.md#5-linting-types-and-tests) |
| Tests | `npm run test -w apps/api` |
| Build | `npm run build` |
| Types | `npm run check-types` (includes the API via `tsconfig.build.json`, the same program as `nest build`) |
| API compile | `npm run build -w apps/api` (matches the Render `Dockerfile` builder) |
| API image | `docker build -f apps/api/Dockerfile .` (CI job `api-docker-build`) |
| API contract | `npm run check:api-contract` |
| Doc links | `npm run check:links` (links and heading anchors); run `npm run install:lychee` first |
| Migrations | `npm run check:migration-safety` |
| Boundaries | `npm run check:dep-cruiser`, a required gate. `scripts/dependency-cruiser-known-violations.json` grandfathers pre-existing violations and only shrinks: read it to tell whether a violation is yours, and don't re-record it to pass ([why](docs/internal/ci-cd/QUALITY_GATES.md#the-baseline)) |
| Duplication | `npm run check:duplication`, advisory; the threshold only ratchets down |
| API breaking changes | `npm run check:api-breaking -- --base origin/main`, advisory; run `bash scripts/install-oasdiff.sh` first |
| Coverage | `npm run test:cov`, a measurement, not a gate |

Gate postures: [`QUALITY_GATES.md`](docs/internal/ci-cd/QUALITY_GATES.md). Testing detail: the `testing` skill.

## Skills and subagents

Read the matching skill before deep work. Skills live in [`.claude/skills/`](.claude/skills/), each at `<name>/SKILL.md` with its own trigger description.

- Building: `api-development`, `ui-development`, `signet-cutover`, `realtime-resilience`, `testing`.
- Reviewing and verifying: `diff-review` (the pre-push gate; [runbook](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md)), `audit`, `infrastructure-research`, `live-verification` (deployed staging only, never production).
- Tracker and sessions: `file-follow-up`, `needs-me`, `handoff`.
- The five scheduled routines, 1 to 5: `issue-curator`, `issue-triage`, `pr-followups`, `docs-upkeep`, `hygiene-scan` ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)).

Long sessions degrade. Offer `/handoff` when context is filling or a task is ending, written as orientation for the next session, not instructions.

Subagent roles in [`.claude/agents/`](.claude/agents/), both read-only. Where the agent type isn't available, run a general-purpose agent with the agent file's body as its prompt.

- [`diff-finder`](.claude/agents/diff-finder.md): reviews a diff from one assigned angle and returns candidate findings with failure scenarios. Launch one per angle, in parallel.
- [`claim-verifier`](.claude/agents/claim-verifier.md): tries to disprove one claim (a review finding, an issue's "already done" or "still blocked", a doc statement, a close-on-proof call) and returns CONFIRMED, PLAUSIBLE, or REFUTED with evidence. Use it where a verdict should come from someone other than the claim's author.

## Gotchas

When the user gives you a durable environment hint or tool workaround not documented elsewhere, add a bullet here.

- The API loads `.env.local`, then `.env`. Prefer `npm run dev:api`, which injects Infisical.
- Local Supabase keys: `npx supabase status -o env`. Without a linked project ref, `npx supabase db push --local` (idempotent).
- After a controller or DTO change, regenerate the contract: `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`.
- Mobile runs in Expo Go, which a headless VM can't host.
- React is pinned to exactly `19.2.3` at five sites: `apps/landing`, `apps/mobile`, `apps/web`, `packages/hooks`, and the root `overrides`. Never widen it to a caret. React Native 0.86.2 bundles `react-native-renderer` 19.2.3, which requires exact equality with `react` at runtime, but its caret peer range lets npm hoist a newer React silently; `apps/mobile` then dies on first render ("Invalid hook call" / "Incompatible React versions"), and CI doesn't catch it. Move the pin in lockstep across all five sites with each Expo SDK bump (target in `expo/bundledNativeModules.json`).
- TypeScript 7 is two packages. `@typescript/native` is `npm:typescript@7.0.2` and provides `tsc`. `typescript` is `npm:@typescript/typescript6@6.0.2`, a wrapper whose compiler API (`tsc6`, `createProgram`) reports 6.0.3 via `@typescript/old`, pinned in root `overrides`. Flattening `typescript` to 7 breaks `nest build`, `typescript-eslint` (peer `<6.1.0`), and `ts-jest` (peer `<7`). Details: [`AGENT_INFRA.md`](docs/internal/ci-cd/AGENT_INFRA.md) § TypeScript 7.
- An Expo SDK bump needs the lockfile re-resolved narrowly. Peer-only deps like `@expo/vector-icons` (`expo-font: ">=14.0.4"`) stay satisfied by the old versions, so a plain `npm install` leaves the previous SDK chain hoisted beside the new one. Prune and re-resolve just the Expo, React and Metro entries, then confirm `node_modules/expo` is the only copy and is the new version. Never `rm -rf node_modules package-lock.json && npm install`: npm records only the optional platform binaries for the host that ran it, so a Linux rebuild drops the darwin/ARM SWC and `sharp` variants (CI stays green, a Mac checkout breaks) and floats unrelated packages. Mechanism: [`SECURITY_FIXES.md`](docs/internal/security/SECURITY_FIXES.md) § Do not "fix" this with a full lockfile rebuild, and § Expo SDK 57 upgrade.
- `jsdom` lives in the root `devDependencies`. Vitest resolves its `jsdom` environment from its own hoisted root install, so a workspace-level `jsdom` is invisible to it, and vitest marks the peer optional, so npm never installs it for you. Without the root copy, every `environment: "jsdom"` config and `@vitest-environment jsdom` spec fails with `Cannot find package 'jsdom' imported from .../node_modules/vitest/...`. Likewise, a workspace declares what it imports (renderers declare `@testing-library/react` and `react-dom`), because a package found only through hoisting gets nested by the next re-resolution.
- `Skill(skill: "code-review")` is invocable only when this turn's prompt carries `/code-review` as a whitespace-delimited token; backticks, quotes and trailing punctuation defeat it. `/diff-review` is always invocable and is the pre-push gate. Mechanics: [`AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).
- Branch protection sets `enforce_admins: true`, so admin credentials don't bypass it.

## Claude Code web sandbox

Claude Code (web and CLI) is the only agent harness. Bringup is under [Starting the dev environment](#starting-the-dev-environment); sandbox detail: [`CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md); local-only `.env.local` and SWC notes: [`LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md).

- **Review gate:** `/diff-review`. [`.githooks/pre-push`](.githooks/pre-push), installed by the root `prepare` script, requires `.cache/diff-review/<PUSHED_COMMIT_SHA>` for every pushed commit, whoever pushes it; retrying doesn't release it. Never push with `--no-verify`: the hook is local, so nothing server-side catches the bypass.
- **Tracker and PRs:** GitHub Issues through the GitHub MCP, `mcp__github__*` ([Work tracking](#work-tracking)). PRs go against `main` with `create_pull_request` / `update_pull_request`, never `gh`. `.claude/settings.json` sets `doneMeansMerged: true`.
- **Scheduled agents:** Claude Code Routines ([`ROUTINES.md`](docs/internal/ci-cd/ROUTINES.md)).
- **Branch protection:** agent sessions run only `npm run configure:branch-protection:verify`, never a live apply.

## Autonomous PR lifecycle (cloud sessions)

A task is done when its PR is green and review-clean, not when the code is pushed. Wake-path facts: [`pr-babysitting.md`](docs/internal/ci-cd/pr-babysitting.md).

1. Open a PR against `main`, the only legal base, without being asked.
2. Subscribe with `subscribe_pr_activity`. Don't call `send_later` or add it to `permissions.allow`: it prompts the owner, so it can't run unattended. The PR-activity webhook plus the repo's `CI wake` and `PR base sync` comments cover wakes ([wake coverage](docs/internal/ci-cd/pr-babysitting.md#wake-coverage)).
3. Triage a CI failure before fixing it. A job that died before its first repo step is Actions infra: re-run it, don't patch. `CI wake` comments only on a deliberate cancellation or an infra failure its auto-requeue couldn't absorb, so its silence doesn't mean green; an ordinary red run arrives through the webhook for you to diagnose.
4. Babysit until green: fix real CI failures, and address and resolve review threads. A `PR base sync` comment (`<!-- frapp-base-sync -->`) means merge `origin/main`, or do what it says. When the base-sync App token is available, a clean behind-PR is updated silently, so judge by the PR's mergeability, never by the absence of a comment ([base-branch sync](docs/internal/ci-cd/pr-babysitting.md#base-branch-sync-scriptscipr-base-syncmjs)).
5. Stop when the PR is green and review-clean, when what's left is out of scope (file an issue, report, stop), or when the user says to stop.

A `/next` session may hold up to two open PRs ([`next.md`](.claude/commands/next.md) Phase 4 pipelining); every obligation above applies to each.
