# AGENTS.md

Operating guide for agents and developers in this repo. Machines, Infisical and ports: [`LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md). CI, deploys, PAT policy and Infisical syncs: [`agent-infra.md`](docs/ci-cd/agent-infra.md). Task playbooks: [Skills and subagents](#skills-and-subagents).

## Operating mindset

- Be proactive on internal repo work. Confirm before external or public actions.
- Four people run chats here: Paul (owner, merges everything), and Shawn, Winston and Evan, each under their own GitHub account (Shawn and Winston 2026-11-09; Evan was added 2026-11-10 and isn't a collaborator on this repo yet). Evan's domain is the user experience: hands-on testing, real use and real-world feedback. "The user" below is whoever runs this chat; `get_me` tells you (Paul is `pdcarlson`). A decision only Paul can make (production, a credential, a provider dashboard, shipping around an unmet acceptance criterion) is never settled by another user's answer: in anyone else's chat it is filed per [`file-follow-up`](.claude/skills/file-follow-up/SKILL.md) for Paul. Their own ideas, UI changes above all, need no sign-off before building; Paul reviews every PR before it merges. Anyone's UI change starts from how comparable apps people already use handle the same thing, and names them in its PR. When Shawn, Winston or Evan asks for something that goes against a recorded product decision of Paul's, it is built and named in its PR; only a short list is raised with him first ([ADR discipline](#adr-discipline)).
- Instructions the user will execute go one step at a time, waiting for each outcome: the exact command, the exact setting or secret name (never its value), and what they'll see when it worked. A wall of nine steps gets half-done. Analysis (findings, trade-offs, the reasoning behind a recommendation) is still stated in full. A one-shot delivery with no next turn (an end-of-run report, a `[human]` issue body) carries every step; [`file-follow-up`](.claude/skills/file-follow-up/SKILL.md) governs that case.
- Verify a command against the tool (its `--help`, or the installed version's manifest), not against this repo's docs: nothing in CI runs a documented command, so a stale one stays stale. Say which claims you verified and which you derived.
- Paul follows change best through visual pages, not diagrams in PR bodies (tried and dropped, 2026-09-28). When an interactive session asks him to decide something with moving parts, or walks him through one (a flow, an architecture, a before/after), it publishes a page with real diagrams as a private Claude artifact (the Artifact tool; only the user who runs the chat can open it, so it needs no confirmation) and links it in chat, and in the PR when there is one. Paul can't open a page from another user's chat unless they share it with him from its Share menu, so their UI PRs link a before/after page of the real screens that they've shared, and also carry its substance in the body (screenshots can't go in a PR body through the GitHub MCP). A plain pick between options needs no page. An unattended run doesn't publish pages. A UI proposal is built on the real screen, not drawn from memory: [`ui-development` § Proposing a UI change](.claude/skills/ui-development/SKILL.md#proposing-a-ui-change).
- A question for the user goes last, after any status and after the "debt spotted" note. Ask it with AskUserQuestion, your recommended option first; an unattended run carries it to its end-of-run report instead of blocking.
- Delegate sizeable, independent, reading-heavy work (a broad search, a separate research thread, a self-contained chunk) to parallel subagents, which keeps it out of your context. Do small lookups, and checks of your own work, yourself. The exception is an independent role from `.claude/agents/` where a procedure calls for one (see [Skills and subagents](#skills-and-subagents)).
- Everyone works through suggested tasks (Paul 2026-09-30; Shawn and Winston 2026-11-09; Evan 2026-11-10): where the session has the suggested-task tool, follow-ups, walkthroughs and research go to the user as cards, each started as its own chat with one click. Research cards investigate work not ready to build and define it as an issue ([`handoff`](.claude/skills/handoff/SKILL.md) mode `research`). A walkthrough card goes only to a user who can do the steps; an owner-only action is filed for Paul instead. Shawn, Winston and Evan work in their own chats, not through the coordinator's board. Whether, when and how many to queue is your call. Weigh what this chat is for (one supervising a track spends its context coordinating and delegates the doing as cards; one building a change stays on it and cards what surfaces outside it), how much context it has left (a walkthrough's step-by-step back-and-forth, or a side investigation, can crowd out its own job), whether the work is separable from this branch and actionable yet, and whether it's small enough to just do here. A card never replaces filing: follow-up work is filed per [Work tracking](#work-tracking) whether or not a card points at it, except that a research card files its own issue once the work is defined. How to write, time and withdraw one: [`handoff`](.claude/skills/handoff/SKILL.md). Without the tool, offer `/handoff`; an unattended run queues none.
- Size every fan-out and set every subagent's effort by the [`multi-agent`](.claude/skills/multi-agent/SKILL.md) skill, ultracode included: `/diff-review` is the only review allowed to be big, and nothing else is allowed to inherit an `xhigh` session's effort.
- If the cloud-sandbox stack fails to come up (`.cloud-sandbox-up.failed`, `host_not_allowed`/`403`, a Docker Hub rate limit, a missing env var), stop and tell the user exactly what to change in this session's Claude Code web environment settings. That config can't be fixed from inside the session, and a workaround hides it. Trust the sentinel over the log; symptom-to-fix map: [`CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md) ("When bringup fails"). The exception: a sentinel reading `(dependencies)` means only `node_modules` is unusable and the stack is up, so run `npm ci` yourself, then `npx turbo run build --filter='./packages/*'` (bringup skips the package build when turbo does not run), and report only if `npm ci` can't reach the registry.

## Credentials and secrets

Hosted sessions may carry provider credentials and sandbox vars ([`AGENT_CREDENTIALS.md`](docs/internal/environment/AGENT_CREDENTIALS.md)); a laptop needs none. When they exist, gather runtime truth (CI, deploys, schema, secret presence) before proposing a change. Never print a secret value. The names are `GITHUB_PAT` (not `GITHUB_TOKEN`, the Actions token; for `gh`/git, `export GH_TOKEN="$GITHUB_PAT"`) and `INFISICAL_SERVICE_TOKEN` / `INFISICAL_PROJECT_ID` (not `INFISICAL_API_KEY`). Render, Vercel and Supabase are read through their MCP connectors, not a key. A sandbox reaches Infisical only with `app.infisical.com` on its allowlist; without it, use the generated `.env.local` and `npm run -s supabase -- status -o env`.

App secrets live in Infisical (project ID in `.infisical.json`), listed in [`ENV_REFERENCE.md`](docs/internal/environment/ENV_REFERENCE.md) (there is no `.env.example`) and [`SECRETS_MANAGEMENT.md`](docs/internal/environment/SECRETS_MANAGEMENT.md). Names carry no `_STAGING` / `_PRODUCTION` suffix; values differ per environment. **An app secret that reaches Render or Vercel is changed in Infisical, never on the platform:** Infisical's syncs push it there ([`SECRETS_MANAGEMENT.md` § 5](docs/internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs) owns which environment reaches which platform), so never tell anyone to edit such a value in Render or Vercel. A wrong or rejected value there means Infisical holds a wrong value, the provider revoked the credential (a rotation starts at the provider, then Infisical), or the sync failed. Fix it at that source, check the sync, then redeploy: a running service, and any inlined `NEXT_PUBLIC_*` value, keeps the old value until the next deploy. `SECRETS_MANAGEMENT.md`'s own exceptions stand: deleting Vercel rows a deleted sync left behind (§ 5, #834), and [§ Infisical Down](docs/internal/environment/SECRETS_MANAGEMENT.md#infisical-down). GitHub environment secrets and mobile EAS values don't live in Infisical at all ([`ENV_REFERENCE.md`](docs/internal/environment/ENV_REFERENCE.md)). No placeholder secrets in CI. Local runs use the `dev` environment, with real Stripe test-mode keys and the real Sentry DSN.

## Spec vs code

`spec/` owns intended behavior; code owns current behavior. A disagreement between them is a tracked bug, not a tie to break by whichever you read first: file it, or fix the stale side in the same PR when it's in scope. Don't change a spec to match a bug, or working code to match a superseded spec, without an explicit decision. Before acting on what a doc says, check it against what owns the fact, and fix the doc in the same pass. How: [`DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).

## ADR discipline

ADRs, and decisions Paul has recorded elsewhere (an issue comment, a dated note in this file or a doc), are Paul's, and Shawn, Winston and Evan may build against most of the product ones (how the app looks, reads and behaves; not this file's process rules, such as the review gate, who merges, or secrets). How an existing feature looks and reads has been open to them since 2026-11-09. Since 2026-11-10 so is trying something new, such as reversing a recorded look, layout or interaction decision, or adding a small feature (Paul: "we're just trying new things, and if it's something new then generally speaking it's going to be okay"). They build it, and the issue and PR body name the decision it changes; Paul's review of the PR is the check. The PR changes the spec and leaves Paul's dated note in place, adding a dated line under it ("Changed in #N by <login>, <date>"; on an ADR, "Overridden in #N by <login>, <date>; pending Paul"), so the record and the code don't silently disagree. Paul's merge accepts it; only Paul rewrites an ADR's decision.

Raise it with Paul first (a comment on the issue, or a new one, naming the conflict: "Paul decided X in ADR-N because Y") only for what he wouldn't want to discover in a diff: pricing and billing; legal or App Store copy; the product name and emblem (ADR-25); security and data deletion; production changes; removing a feature. Raising means asking and waiting: file it per [`file-follow-up`](.claude/skills/file-follow-up/SKILL.md), where it holds in `triage`, ask the user to pass it to Paul, and build once he says go. Anyone may still fix a statement in an ADR that is no longer true, as below, but never one an override note marks.

ADRs in [`spec/architecture/adr/`](spec/architecture/adr/README.md) are ordinary docs: fix a statement that's no longer true in place, and date the correction so it reads apart from the original. Keep the decision and its reasons, including rejected alternatives and refuted arguments, because the code can't reconstruct them ([§ What a doc owes a reader](docs/internal/DOCUMENTATION_CONVENTIONS.md#what-a-doc-owes-a-reader)). ADR numbers and headings are cited from CI, product code, tests and migrations with nothing validating them, so sweep for citations before renaming one ([§ When a doc turns out to be wrong](docs/internal/DOCUMENTATION_CONVENTIONS.md#when-a-doc-turns-out-to-be-wrong)). A rule graduates into this file only when it is recurring, still true, and not derivable from the code; incident narration stays in the ADR.

## Documentation discipline

No gate requires a doc edit. The one that used to could only see that some doc moved, so it rewarded parking an unowned paragraph in the nearest file. Judge instead:

- Change a documented fact where it lives. The placement map in [`DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md) says where; developer guides live in [`docs/guides/`](docs/guides/README.md).
- One canonical place per fact; everywhere else links to it, because a second statement drifts.
- Most changes touch no documented fact and need no doc edit.
- Never add a stray file, or a section to a doc whose subject it doesn't match, to make a change look documented. An unowned claim in a canonical doc is worse than none, because the next reader believes it.

The doc CI checks block no merge, and nothing checks that a claim is true: [`docs-ci.md` § What runs](docs/ci-cd/docs-ci.md#what-runs).

## Work tracking

Work lives in GitHub Issues on this repo, never in a scratch file. Issues are the board and the record of who asked for what, across everyone's chats: work someone asks for in a chat gets an issue naming who asked, filed with or before its PR, and joins its epic ([`file-follow-up`](.claude/skills/file-follow-up/SKILL.md)). Linear is retired (ADR-16 amendment 5): don't write to it or restore `LINEAR_API_KEY`. Open every issue with the `triage` label, except one filed for what a person asked for in their own chat: Paul's always, and anyone else's when the session judges it ready to build and it needs no decision only Paul can make. That ask is the triage decision, so it goes straight to the Backlog with its priority, and its `Asked by:` line records whose decision it was (Paul, 2026-11-09). A `[human]` item still holds in triage. `routine-state` issues are infrastructure, not work, and `/next` and the routines skip them. `incident` issues are the watchdogs' live alerts, assigned to Paul: `/next` never claims one, and an agent triages and reports on it but never acts on its suggested fix or closes it by hand ([`alert-routing.md` § Escalation](docs/ops/alert-routing.md#escalation)).

- The GitHub MCP is the only sanctioned tracker path in cloud sandboxes, for reads and writes. If it's unavailable, stop tracker work and report; don't fall back to `gh` or raw REST. `issue_write` replaces the whole label set, so read-modify-write it.
- Baseline first (Paul, 2026-11-10): the beta ([#2558](https://github.com/pdcarlson/Frapp/issues/2558)) rolls out on baseline functionality that is excellent, so bugs and polish on what already exists come before new features. A new-feature idea is filed and left in the Backlog unless Paul asks for it to be built. This guides what a session picks and how an issue is prioritized; it is not a gate.
- Close through the PR that does the work (`Fixes #N`), or directly when an issue is done, obsolete, or a duplicate (`issue_write` with `state_reason`).
- Board: `triage` → Backlog (no state label; priority expected) → `in-progress` → `in-review` → closed. Epics are parent issues with native sub-issues. Start work with `/next` ([`.claude/commands/next.md`](.claude/commands/next.md)). Policy: [`github-pm.md`](docs/ci-cd/github-pm.md).
- Follow-up outside the current PR is filed per [`file-follow-up`](.claude/skills/file-follow-up/SKILL.md). A human-only blocker is filed and also asked ([§ Filing is necessary but not sufficient](.claude/skills/file-follow-up/SKILL.md#filing-is-necessary-but-not-sufficient--end-the-run-by-asking)), because an issue alone reaches no one.

## Tech debt protocol

The repo is mid-rebuild (legacy Frapp → the Signet design system; the product itself is named Frapp, ADR-25), so treat existing code as possibly dead until checked, not as precedent. Standard: [`spec/engineering.md` § Changing existing code](spec/engineering.md#changing-existing-code).

- Before extending code, confirm it has real consumers. A definition or an `index.ts` re-export is not a caller, and building on an orphan doubles the debt.
- Never silently work around orphaned, superseded, or contradictory code. Fix it inline when it's inside your change's blast radius, otherwise file it per `file-follow-up`; either way, flag it in the response and PR body. Blast radius decides, not diff radius: "out of scope" and "pre-existing" are not verdicts on a defect.
- When the existing shape is wrong, rebuild rather than patch around it. A much larger diff is an acceptable price for a more correct, consistent system, and the typecheck, test, CI and review gates exist so a change that size can be trusted. Age is not evidence of correctness. A rebuild too large for one reviewable change becomes an ordered series, each step independently valuable and revertable, scoped before you start.
- A cutover deletes what it replaces in the same change, unless there's an explicit reason to keep both (a flag, a documented migration window); "we might need it later" is not one. Checklist: [`signet-cutover`](.claude/skills/signet-cutover/SKILL.md).
- The tracker is the only debt list. No `TECH-DEBT.md`: issues already carry status, owner, priority, and close-on-merge.
- End every audit or implementation with a short "debt spotted" note, one line per item with its issue number, even if it's "none found".

## Project overview

Turborepo + npm workspaces: 4 apps, 13 shared packages. Product and architecture: `spec/`. Developer guides: [`docs/guides/`](docs/guides/README.md). Documentation map: [`docs/README.md`](docs/README.md).

## Branch model

`main` is the only long-lived branch and the only legal PR base. Every merge deploys to staging; direct pushes are blocked. Production deploys by dispatching the **Deploy production** workflow with a commit SHA, which refuses any commit that isn't an ancestor of `main` with green CI. There is no `production` branch. Details: `CONTRIBUTING.md`; deploy architecture: [`docs/ops/deployment/`](docs/ops/deployment/).

## Starting the dev environment

- **Cloud (Claude Code web):** `.claude/hooks/session-start.sh` launches `scripts/cloud-sandbox-up.sh` in the background at session start, gated on `/etc/frapp-cloud-sandbox` or `FRAPP_CLOUD_SANDBOX=1`. It starts Docker and local Supabase, writes `apps/api/.env.local` and `apps/web/.env.local`, and builds the workspace packages, so the API boots and `npm run build -w apps/web` works without Infisical. Before using the database or API, wait for `.cloud-sandbox-up.done`, or stop on `.cloud-sandbox-up.failed` (log: `/tmp/cloud-sandbox-up.log`); then boot the API with `npm run start:dev -w apps/api`. Troubleshooting: [`CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md).
- **Laptop / WSL / Linux:** with Docker reachable, `bash scripts/local-dev-setup.sh`, then `npx infisical login` once and `npm run dev:stack` (API + web + landing). Ports and per-app `dev:*` commands: [`LOCAL_DEV.md` § Ports and URLs](docs/internal/environment/LOCAL_DEV.md#ports-and-urls).

## Lint, test, build, type-check

| Step | Command |
| ---- | ------- |
| Lint | `npm run lint` / `npm run lint:api` (read-only) |
| Lint autofix | `npm run lint:api:fix`, the only lint script that writes; see [`CONTRIBUTING.md` § Linting, types, and tests](CONTRIBUTING.md#linting-types-and-tests) |
| Tests | `npm run test -w apps/api` |
| Build | `npm run build` |
| Types | `npm run check-types` (for the API, specs included: [what it runs](docs/ci-cd/agent-infra.md#typescript-7-is-native-tsc-plus-a-typescript-6-compiler-api)) |
| API compile | `npm run build -w apps/api` (matches the Render `Dockerfile` builder) |
| API image | `docker build -f apps/api/Dockerfile .` (CI job `api-docker-build`) |
| API contract | `npm run check:api-contract` |
| Doc links | `npm run check:links` (links and heading anchors); run `npm run install:lychee` first |
| Migrations | `npm run check:migration-safety` |
| Boundaries | `npm run check:dep-cruiser`, a required gate; `npm run check:dep-cruiser:rules` proves its rules still fire. `scripts/dependency-cruiser-known-violations.json` grandfathers pre-existing violations and only shrinks: read it to tell whether a violation is yours, and don't re-record it to pass ([why](docs/ci-cd/quality-gates.md#the-baseline)) |
| Duplication | `npm run check:duplication`, advisory; the threshold only ratchets down |
| API breaking changes | `npm run check:api-breaking:shipped` blocks against every shipped mobile build; `npm run check:api-breaking -- --base origin/main` is advisory. Run `bash scripts/install-oasdiff.sh` first |
| Coverage | `npm run test:cov`, a measurement, not a gate |

Gate postures: [`quality-gates.md`](docs/ci-cd/quality-gates.md). Testing detail: the `testing` skill.

## Skills and subagents

Read the matching skill before deep work. Skills live in [`.claude/skills/`](.claude/skills/), each at `<name>/SKILL.md` with its own trigger description.

- Building: `api-development`, `ui-development`, `signet-cutover`, `realtime-resilience`, `testing`.
- Reviewing and verifying: `diff-review` (the pre-push gate; [runbook](docs/ci-cd/ai-code-review-runbook.md)), `audit`, `infrastructure-research`, `live-verification` (deployed staging only, never production).
- Tracker and sessions: `file-follow-up`, `needs-me`, `handoff`, `coordinator` (a standing chat that routes Paul's input to worker sessions and keeps the shared board).
- Multi-agent work: `multi-agent` (budget, effort and mechanics for any Workflow or subagent fan-out).
- The three scheduled routines, 1 to 3: `beta-watch`, `board-sweep` (runs `pr-followups`, `issue-curator`, `issue-triage` as phases), `weekly-upkeep` (`hygiene-scan` weekly, `docs-upkeep` on the month's first Wednesday) ([`routines.md`](docs/ci-cd/routines.md)).

Long sessions degrade. Offer `/handoff` when context is filling or a task is ending, written as orientation for the next session, not instructions. Where the session has the suggested-task tool, the offer can be a card ([Operating mindset](#operating-mindset)).

Subagent roles in [`.claude/agents/`](.claude/agents/), both read-only, each with its effort pinned in frontmatter. Where the agent type isn't available, run a general-purpose agent with the agent file's body as its prompt.

- [`diff-finder`](.claude/agents/diff-finder.md): reviews a diff from its assigned angles (usually a bundle of two or more) and returns candidate findings with failure scenarios. `/diff-review` launches them through the `frapp-review` workflow, which owns the bundles.
- [`claim-verifier`](.claude/agents/claim-verifier.md): tries to disprove a claim, or a small batch with one verdict each (a review finding, an issue's "already done" or "still blocked", a doc statement, a close-on-proof call) and returns CONFIRMED, PLAUSIBLE, or REFUTED with evidence. Use it where a verdict should come from someone other than the claim's author.

## Gotchas

When the user gives you a durable environment hint or tool workaround not documented elsewhere, add a bullet here.

- The API loads `.env.local`, then `.env`. Prefer `npm run dev:api`, which injects Infisical.
- Local Supabase keys: `npm run -s supabase -- status -o env`. Without a linked project ref, `npm run supabase -- db push --local` (idempotent). `npm run supabase --` is the repo's pinned CLI; bare `npx supabase` is whatever `latest` is that day.
- After a controller or DTO change, regenerate the contract: `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`.
- Mobile runs in Expo Go, which a headless VM can't host.
- React is pinned to exactly `19.2.3` at five sites: `apps/landing`, `apps/mobile`, `apps/web`, `packages/hooks`, and the root `overrides`. Never widen it to a caret. React Native 0.86.2 bundles `react-native-renderer` 19.2.3, which requires exact equality with `react` at runtime, but its caret peer range lets npm hoist a newer React silently; `apps/mobile` then dies on first render ("Invalid hook call" / "Incompatible React versions"), and CI doesn't catch it. Move the pin in lockstep across all five sites with each Expo SDK bump (target in `expo/bundledNativeModules.json`).
- TypeScript 7 is two packages. `@typescript/native` is `npm:typescript@7.0.2` and provides `tsc`. `typescript` is `npm:@typescript/typescript6@6.0.2`, a wrapper whose compiler API (`tsc6`, `createProgram`) reports 6.0.3 via `@typescript/old`, pinned in root `overrides`. Flattening `typescript` to 7 breaks `nest build`, `typescript-eslint` (peer `<6.1.0`), and `ts-jest` (peer `<7`). Details: [`agent-infra.md`](docs/ci-cd/agent-infra.md) § TypeScript 7.
- An Expo SDK bump needs the lockfile re-resolved narrowly. Peer-only deps like `@expo/vector-icons` (`expo-font: ">=14.0.4"`) stay satisfied by the old versions, so a plain `npm install` leaves the previous SDK chain hoisted beside the new one. Prune and re-resolve just the Expo, React and Metro entries, then confirm `node_modules/expo` is the only copy and is the new version. Never `rm -rf node_modules package-lock.json && npm install`: it breaks every other platform's install while CI stays green. Mechanism: [`security-fixes.md` § Do not "fix" this with a full lockfile rebuild](docs/security/security-fixes.md#do-not-fix-this-with-a-full-lockfile-rebuild), and [§ Expo SDK 57 upgrade](docs/security/security-fixes.md#expo-sdk-57-upgrade-289).
- `jsdom` lives in the root `devDependencies`. Vitest resolves its `jsdom` environment from its own hoisted root install, so a workspace-level `jsdom` is invisible to it, and vitest marks the peer optional, so npm never installs it for you. Without the root copy, every `environment: "jsdom"` config and `@vitest-environment jsdom` spec fails with `Cannot find package 'jsdom' imported from .../node_modules/vitest/...`. Likewise, a workspace declares what it imports (renderers declare `@testing-library/react` and `react-dom`), because a package found only through hoisting gets nested by the next re-resolution.
- `Skill(skill: "code-review")` is invocable only when this turn's prompt carries `/code-review` as a whitespace-delimited token; backticks, quotes and trailing punctuation defeat it. `/diff-review` is always invocable and is the pre-push gate. Mechanics: [`ai-code-review-runbook.md`](docs/ci-cd/ai-code-review-runbook.md).
- Branch protection sets `enforce_admins: true`, so admin credentials don't bypass it.
- Never `pkill -f` or `pgrep -f` a pattern from Bash: it also matches the calling shell's own command line, so the kill takes out the shell running it. Kill by explicit PID.

## Claude Code web sandbox

Claude Code (web and CLI) is the agent harness this repo configures. Bringup is under [Starting the dev environment](#starting-the-dev-environment); sandbox detail: [`CLOUD_SANDBOX.md`](docs/internal/environment/CLOUD_SANDBOX.md); local-only `.env.local` and SWC notes: [`LOCAL_DEV.md`](docs/internal/environment/LOCAL_DEV.md).

- **Review gate:** `/diff-review`. [`.githooks/pre-push`](.githooks/pre-push), installed by the root `prepare` script, requires `.cache/diff-review/<PUSHED_COMMIT_SHA>` on the tip of a branch's **first** push, whoever pushes it; retrying doesn't release it. The review runs once, before the PR is opened (Paul, 2026-11-10): a later push to a branch the remote already has (a fix, a merge of `main`, a resolved conflict) needs no review and no marker, so don't run `/diff-review` for one. The gate exists so work gets one review before its PR opens. `git push --no-verify` is its bypass, and using it is a judgment call (Paul, 2026-11-10): use it when a review would buy nothing, such as a WIP or parking push with no PR, a first push that carries only a merge of `main` or of an already-reviewed branch, or a docs-only or trivial change Paul asked to skip. It doesn't fit the first push of real work that is about to become a PR. Say in chat, and in the PR if there is one, that the gate was bypassed and why, because the hook is local and nothing else records it. A branch whose first push bypassed the gate still owes its one review before its PR opens: the hook won't ask again once the remote has the branch, so run `/diff-review` on it then, whatever the sentence above says about pushed branches. An unattended routine never bypasses: nobody is there to make the call or read the reason.
- **Tracker and PRs:** GitHub Issues through the GitHub MCP, `mcp__github__*` ([Work tracking](#work-tracking)). PRs go against `main` with `create_pull_request` / `update_pull_request`, never `gh`. `.claude/settings.json` sets `doneMeansMerged: true`.
- **Scheduled agents:** Claude scheduled tasks bound to the *Frapp scheduled tasks* session ([`routines.md`](docs/ci-cd/routines.md)).
- **Branch protection:** agent sessions run only `npm run configure:branch-protection:verify`, never a live apply.

## Autonomous PR lifecycle (cloud sessions)

A task is done when its PR is green and review-clean, not when the code is pushed. Wake-path facts: [`pr-babysitting.md`](docs/ci-cd/pr-babysitting.md).

Scheduled routines are exempt and follow their own skill's PR rules ([`routines.md`](docs/ci-cd/routines.md)): they don't subscribe, because a run ends when its report is written and a human merges every routine PR. Before ending, a routine waits for its PR's checks to finish and fixes a failure its own change caused; steps 3–4 below still describe how to handle a PR it services.

1. Open a PR against `main`, the only legal base, without being asked. A PR that changes what members see or can do carries its What's new line as its own file in [`packages/validation/release-notes/`](packages/validation/release-notes/README.md), never an edit to the notes list; a bot folds the lines in after merge, so nobody writes them at deploy time (Shawn, 2026-11-11).
2. Subscribe with `subscribe_pr_activity`. Don't call `send_later` or add it to `permissions.allow`: it prompts the owner, so it can't run unattended. The PR-activity webhook plus the repo's `CI wake` and `PR base sync` comments cover wakes ([wake coverage](docs/ci-cd/pr-babysitting.md#wake-coverage)).
3. Triage a CI failure before fixing it. A job that died before its first repo step is Actions infra: re-run it, don't patch. `CI wake` comments only on a deliberate cancellation, a job that ran to its `timeout-minutes`, or an infra failure its auto-requeue couldn't absorb, so its silence doesn't mean green; an ordinary red run arrives through the webhook for you to diagnose.
4. Babysit until green: fix real CI failures, and address and resolve review threads. A `PR base sync` comment (`<!-- frapp-base-sync -->`) means merge `origin/main`, or do what it says. A PR need not be up to date with `main` to merge (Paul, 2026-11-11), so a clean behind-PR gets no comment and is left as it is: don't merge `main` into it only because it is behind, which restarts its CI for nothing. Judge by the PR's mergeability ([base-branch sync](docs/ci-cd/pr-babysitting.md#base-branch-sync-scriptscipr-base-syncmjs)).
5. Stop when the PR is green and review-clean, when what's left is out of scope (file an issue, report, stop), or when the user says to stop. Once it is green and review-clean with auto-merge on, call `unsubscribe_pr_activity` and end there (Paul, 2026-11-09): each later wake re-reads the whole session, which cost more than the work itself, and a PR that goes red after that gets a fresh session.

Merge conflicts are what slow development most (Paul, 2026-11-10), so as guidance, not a gate: finish and merge a screen's open PR before starting another on the same screen; keep each PR small enough that Paul can merge it the day it goes green (he merges; a session never does); and run one session per screen or shared file at a time.

A `/next` session may hold up to two open PRs ([`next.md`](.claude/commands/next.md) Phase 4 pipelining); every obligation above applies to each.
