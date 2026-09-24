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

The agent **may** use `GITHUB_PAT` for: creating/closing agent-owned PRs, labels, issues, the branch protection script in read-only mode — from an agent session that means `npm run configure:branch-protection:verify`, that exact command and nothing else (**Branch protection script** below names the two spellings that silently *apply* instead) — reading GitHub environments/protection rules, reading PR/CI/branch state. *Applying* branch protection or environment protection rules is a human step with an admin PAT — by policy, not for lack of capability; the canonical statement is in [`../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

The agent **must not** use it to: merge without explicit approval, delete branches without approval, broaden repo settings — branch protection and environment protection rules included, since applying those is a human step (see above) — create/modify GitHub Secrets, force-push, or create releases/tags outside the automated release workflow.

Node scripts (e.g. `configure-branch-protection.mjs`) read `GITHUB_PAT` directly — that script also accepts it from `.env.local` or `.env` at the repo root, with an exported variable still winning over both (details: [`../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)). For `gh`/git, export it as `GH_TOKEN` first — `gh` only auto-reads `GH_TOKEN`/`GITHUB_TOKEN`, not `GITHUB_PAT`. The value must be a PAT with the required repository permissions; do not assume the GitHub Actions runtime token has branch-administration scope.

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
above are for Actions and laptops. Design + policy: [`GITHUB_PM.md`](GITHUB_PM.md).

**The `api.github.com` route rule (measured 2026-09-02).** Reachability of `api.github.com` from a
cloud sandbox is **route-dependent**: the direct route works, and what the proxy route passes
varies by session and path (corrected 2026-09-22, below). This file used to say
"session-dependent (observed both proxy-blocked and working, 2026-08-08)"; that framing missed the
route. Measured on one host, with one `GITHUB_PAT`, inside one minute:

- A request that honours `HTTPS_PROXY` (measured with `curl`; `gh` reads the same proxy env and is
  expected to behave identically, not separately measured) reaches the agent proxy's
  GitHub-credential layer, which answers **403** `{"message":"GitHub access is not enabled for this
  session"}` on **every repo-scoped path**, whatever `Authorization` header is attached. `GET /user`
  through that same proxy returns **200** — the proxy allows non-repo paths.
- The same call sent direct — `curl --noproxy '*'`, or node's built-in `fetch`, which does **not**
  read `HTTPS_PROXY` (documented in `/root/.ccr/README.md`) — returns **200 from GitHub itself**,
  carrying `server: github.com` and `x-github-request-id`.

**Corrected 2026-09-22:** "every repo-scoped path" held for that session, not in general, and not
every proxy-route 403 is the proxy's. Through the proxy in a later session:

- `/repos/{r}`, `/rulesets` and `/issues/1` returned **200** from GitHub.
- `/environments` returned the proxy's own **403**, with no GitHub headers:
  `{"message":"Access to this GitHub API path is not permitted through this proxy."}`.
- `/branches/main/protection` returned **GitHub's** 403 (`server: github.com`,
  `x-accepted-github-permissions: administration=read`, `"Resource not accessible by
  integration"`). The proxy substitutes its own integration credential, which lacks
  `administration:read`, whatever `Authorization` header you send.

Sent direct with `GITHUB_PAT`, `/environments` and `/branches/main/protection` both returned 200.

So which paths pass the proxy route varies by session and path, and a 403 there comes either from
the proxy's path policy or from GitHub rejecting the proxy's credential. **Neither says anything
about the PAT**: don't treat a proxy-route result, 200 or 403, as evidence about permissions.
Direct egress is bounded only by the environment network allowlist, which carries `api.github.com`.
Two rules follow: never regenerate the PAT with broader scopes to chase a proxy-route 403 — the
token was never what failed — and never set `NODE_USE_ENV_PROXY=1` for these scripts, which would
push node onto the proxy route.

What this does **not** change: the GitHub MCP stays the sanctioned **write** path for issues, PRs
and comments, and tracker workflows still go through it. Direct REST is a **read** channel for
ground truth the MCP exposes no tool for — branch protection, environments, rulesets, repo security
toggles — not a write fallback and not an MCP replacement. `npm run
configure:branch-protection:verify` — that exact script name, and nothing else, from an agent
session — exits 0 from this sandbox over that route. *Applying* branch protection remains a human
step with an admin PAT **by policy**, not because it is unreachable; the bare `npm run
configure:branch-protection` **applies**, so read **Branch protection script** under the CI/CD
summary before running anything from this family.


## CI/CD summary

| Item                | Location / notes                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                  | `.github/workflows/ci.yml` — parallel jobs. Per-job suite lists are **not restated here**: they live in [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md) § Required Status Checks. Nothing asserts that copy any more — the docs gate that compared it against `ci.yml` was deleted along with the rest of them — so read `ci.yml` itself whenever the two could disagree. This copy was unasserted and had already lost `@repo/theme` — the same package whose disappearance (#1153) the gate exists to catch |
| Composite actions   | `.github/actions/<name>/action.yml` — shared step sequences called as `uses: ./.github/actions/<name>`. Requires an `actions/checkout` earlier in the job. The inventory, what each action owns, and the rules enforced over them all live in [`.github/actions/README.md`](../../../.github/actions/README.md) — that directory's own README is the one home, and none of it is restated here. Two things an agent should know before opening it: every rule there is enforced by a test (`scripts/ci/__tests__/turbo-packages-build-action.test.mjs`, `…/infisical-secrets-action.test.mjs`), so a hand-written copy of anything an action owns fails `npm run test:ci-scripts` rather than review; and a local `uses: ./…` resolves from the runner **workspace at step-execution time**, which constrains both where in a job it may appear and which `dorny/paths-filter` lists must include `.github/actions/**`. The README gives the exact rules and why each exists. |
| API deploy (staging) | `.github/workflows/deploy-api.yml` — after CI (`workflow_run`) on `main`. Staging only since #1340. |
| Production deploy   | `.github/workflows/deploy-production.yml` — `workflow_dispatch` ONLY, takes a `sha`. Validates the commit is an ancestor of `main` with green CI (`scripts/ci/validate-deploy-sha.mjs`) — the required-check roster intersected with the jobs that commit's own workflows define, so a check it predates reads *not applicable* instead of making an older commit undeployable (see the **Deploying an OLDER commit** callout in `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`) — preflights the provider guardrails, replays the migration against production's live applied state, builds both Vercel production bundles on the runner (a build failure ships nothing), applies, deploys that commit to Render by `commitId`, uploads the prebuilt bundles to Vercel (`--prebuilt --prod`), then calls `release.yml`. SHA confirmation/trim/validate run in an unscoped `validate` job so a bad paste cannot consume the reviewer gate (run 34234768094). The shipping path (`deploy`) is still one job under `environment: production`, so one approval click. A `scope: migrations-only` input applies the migrations and stops — no Render deploy, no Vercel build, no tag — which is what the deleted `Migrate production` workflow used to do, minus that workflow's habit of skipping every gate in this sentence. |
| Production guardrails | `.github/workflows/production-guardrails.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`, and re-run as a preflight inside the production deploy. Asserts Render `frapp-api-prod` has auto-deploy **off** and tracks `main`, that `serviceDetails.healthCheckPath` is `/health` (empty is a TCP socket check on the open port; `/health/ready` would cancel a deploy when a dependency is degraded), and that neither Vercel project is **linked to Git**. The auto-deploy and Vercel-link settings fail OPEN, so they can only be asserted, never enforced. The Vercel half was **inverted on 2026-09-02** ([#1579](https://github.com/pdcarlson/Frapp/issues/1579)): it used to assert that neither project's Production Branch was `main`, which ADR-21's unlink turned into a permanent self-inflicted failure — with `link: null` the branch is absent, and absent was coded as a violation, so the daily run AND the production-deploy preflight both failed. It now asserts the condition that actually keeps production safe post-ADR-21, that no Git link exists; a *present* link is the violation. Inverted rather than deleted, because staying unlinked is unversioned dashboard state a single click could undo. Because absent now means pass, the script first checks the response really is a project (`looksLikeVercelProject`) so an error envelope cannot read as "unlinked, therefore green". The Render auto-deploy assertion is unaffected by that inversion. See the Vercel note under this table. Logic in `scripts/ci/production-guardrails.mjs`. **Not** a required check. |
| Production uptime | `.github/workflows/production-uptime.yml` — **scheduled** every 15 minutes, though it runs [far less often](../../../spec/architecture/adr/adr-24.md) + `workflow_dispatch`. GETs `https://api.frapp.live/health/ready` (never `/health` — [why](../../../spec/behavior/observability.md#health-check)). Raises one `incident` alert on failure and closes it on recovery. Does **not** name `environment: production` — a `schedule:` job that did would suspend on the required-reviewer gate ([#1435](https://github.com/[REDACTED]/Frapp/issues/1435)). Not a substitute for a Sentry 60 s monitor, which #2505 plans and the owner creates (quota; the script header says agent sessions don't). Logic in `scripts/ci/production-uptime.mjs`. **Not** a required check. |
| Production release pin | `.github/workflows/production-release-pin.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. Asserts Render `frapp-api-prod`'s live deploy commit, Vercel `frapp-web` and `frapp-landing` READY production `githubCommitSha`, and at least one peeled `vX.Y.Z` tag all name the same SHA. Matching `main` is not required — live is allowed to lag until the next Deploy. An unreadable matching-refs list or annotated-tag peel is FAIL, not a missing tag. `/health` `commit` is corroboration only (absent is ignored; the GET is timed out so a stall cannot hold the job). Does **not** name `environment: production` ([#1435](https://github.com/[REDACTED]/Frapp/issues/1435)). Logic in `scripts/ci/production-release-pin.mjs`. **Not** a required check. |
| Production backup environment | `.github/workflows/production-backup-env.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. GETs GitHub environment `production-backup` and fails if `protection_rules` contains `required_reviewers` or `wait_timer`. Unreadable or missing is FAIL. `deployment_branch_policy: null` is not a failure — locking branches to `main` stays on #1827. Does **not** name `environment: production` or `environment: production-backup` (#1435): a schedule job that named the env it watches would hang on the same trap. Never PUTs the environment. Logic in `scripts/ci/production-backup-env.mjs`. **Not** a required check. |
| Production backup freshness | `.github/workflows/production-backup-freshness.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. GETs recent `db-backup.yml` runs on `main` and fails if `backup-production` is missing, not success, hung more than 3h, or last success older than 36h. In-flight under 3h is pass (the job stays green; an open alert stays open). Unreadable Actions responses are FAIL. Does **not** name `environment: production` or `environment: production-backup` (#1435). Never PUTs. Reads with `GITHUB_TOKEN`. The script retries with `GITHUB_PAT` on 401/403 only when one is in its environment, which means a local run: the workflow passes none, because a PAT there could only be a repository secret (#2518). The hosted restore leftover stays on its own issue (1861); the reviewer watch stays on its own issue (1956). Logic in `scripts/ci/production-backup-freshness.mjs`. **Not** a required check. |
| Production backup storage freshness | `.github/workflows/production-backup-storage-freshness.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. GETs recent `db-backup.yml` runs on `main` and fails if `backup-production-storage` is missing, not success, hung more than 3h, or last success older than 36h. In-flight under 3h is pass (the job stays green; an open alert stays open). Unreadable Actions responses are FAIL. Does **not** name `environment: production` or `environment: production-backup` (#1435). Never PUTs. Reads with `GITHUB_TOKEN`. The script retries with `GITHUB_PAT` on 401/403 only when one is in its environment, which means a local run: the workflow passes none, because a PAT there could only be a repository secret (#2518). The Postgres dump watch stays on its own issue (1963); the hosted restore leftover stays on its own issue (1861). Logic in `scripts/ci/production-backup-storage-freshness.mjs`. **Not** a required check. |
| Deploy outcome      | Terminal `deploy-outcome` job in **both** `.github/workflows/deploy-api.yml` and `.github/workflows/deploy-vercel-staging.yml` — in each, the only job with a write scope (job-scoped `issues: write`; the workflow-level grant stays `contents: read`). Writes a step summary + annotation saying whether the run **deployed** or **declined to deploy**, and upserts one `incident` alert issue on failure, closing it on the next successful deploy. Shared logic in `scripts/ci/deploy-alert.mjs`, selected per workflow by the required `ALERT_CONFIG` env var (tests: `scripts/ci/__tests__/deploy-alert.test.mjs`, `…/deploy-vercel-staging-workflow.test.mjs`). **Not** a required check. See "Deploy visibility" below. |
| Deploy verification | `.github/workflows/verify-deployments.yml` — post-push Render state polling, **staging only**. Its two Vercel jobs (`verify-vercel-web`, `verify-vercel-landing`) were **removed on 2026-09-02** ([#1579](https://github.com/pdcarlson/Frapp/issues/1579)): ADR-21's unlink means no push produces a Vercel deployment, so polling for one was guaranteed to fail rather than able to detect anything, and both had been red on every push (landing since run #428, 2026-09-01T20:28Z; web since run #437, 2026-09-02T03:04Z — roughly six and a half hours apart, not together). [#1578](https://github.com/pdcarlson/Frapp/issues/1578) (2026-09-04) built the CI-driven deploys: `deploy-vercel-staging.yml` creates the staging deployments after green CI and verifies them **by deployment id**, so the Vercel jobs were not re-added here — an observer keyed on a pushed SHA is strictly worse than the workflow that holds the id, and it could not stay CI-gated. `ensure-vercel-staging-alias.mjs` is referenced again, from that workflow; `verify-vercel-deploy.mjs` is called by no workflow, but is **not** dead code — `deploy-vercel.mjs` imports its terminal-state sets, so it is on the production deploy path and must not be deleted or narrowed as unused. The Render half still polls. Production verifies itself inline inside `deploy-production.yml`, polling the deploy/deployment IDs it created, with stricter semantics: a `CANCELED` Vercel deployment is a failure there, never neutral. |
| Migration drift     | `.github/workflows/check-migration-drift.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. Compares each deployed database's `schema_migrations` against `supabase/migrations/` and upserts one `incident` alert issue, closing it when every environment is back in sync. Job-scoped `issues: write`; workflow-level grant stays `contents: read`. Logic in `scripts/ci/check-migration-drift.mjs` (tests: `scripts/ci/__tests__/check-migration-drift.test.mjs`). **Not** a required check. See "Schema drift detection" below. |
| Staging conformance | `.github/workflows/staging-conformance.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. Asserts live `frapp-staging` state rather than a push: project `ACTIVE_HEALTHY`, `custom_access_token_hook` enabled *and* pointed at the right function, the auth redirect allow list carrying `<site_url>/**` and `frapp://**` (a bare origin matches only itself, so without the wildcard GoTrue drops every web `emailRedirectTo` path — and any invite token in it — onto the Site URL; both projects were in that state until 2026-09-06), custom Auth SMTP on Resend at `Signet <no-reply@mail.staging.frapp.live>` (`smtp_sender_name=Signet`) with `rate_limit_email_sent` at least 300/hour (the hosted mailer is 2/hour; a revert is the first-user cap on the only host that can prove mail before production), the Magic Link template subject `Sign in to Signet` and body carrying `token_hash` + `type=magiclink` (a revert to `{{ .ConfirmationURL }}` puts the href back on `*.supabase.co`), Render `frapp-api-staging` `serviceDetails.healthCheckPath` `/health` (empty is TCP-only) and `autoDeploy: "yes"` tracking `main` (the inverse of production-guardrails; a dashboard click that turns auto-deploy off freezes staging while this job stays green on a stale host), every Infisical secret sync succeeded, and an end-to-end sign-in whose JWT carries `active_chapter_id`. **Migration parity is deliberately NOT checked here** — `check-migration-drift.yml` above owns it end to end; see "Scheduled conformance" below. Upserts its own `incident` alert issue on drift and closes it on recovery. Logic in `scripts/ci/staging-conformance.mjs` (tests: `scripts/ci/__tests__/staging-conformance.test.mjs`). **Not** a required check — it verifies an environment, not a diff. |
| Production Auth conformance | `.github/workflows/production-auth-conformance.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. The production sibling of staging-conformance for the Auth settings first users hit on `frapp-prod`: project `ACTIVE_HEALTHY`, `custom_access_token_hook` enabled and pointed at the right function, and the redirect allow list carrying `https://app.frapp.live/**` plus `frapp://**` (Site URL is pinned, so a production project pointed at the staging origin cannot pass on matching staging wildcards). **Auth SMTP is skip-until-on**: empty host (hosted 2/hour cap) is SKIPPED until [#1824](https://github.com/[REDACTED]/Frapp/issues/1824); SMTP on with a From other than `Signet <no-reply@mail.frapp.live>`, or a send cap under 300/hour, fails the run. **Magic Link is skip-until-SMTP-on**: ConfirmationURL is SKIPPED while SMTP is unset; SMTP on without `token_hash` + `type=magiclink` fails. Project ref comes from `.github/environments.json`, not injected `SUPABASE_PROJECT_REF`. Own alert title, so a recovered staging cannot close a live production incident. Does **not** name `environment: production` ([#1435](https://github.com/[REDACTED]/Frapp/issues/1435)). Logic in `scripts/ci/production-auth-conformance.mjs`. **Not** a required check. |
| Release tags        | `.github/workflows/release.yml` — `workflow_call` from `deploy-production.yml` (plus `workflow_dispatch` for retry). Tags the deployed commit AFTER Render and Vercel report healthy, so a `v*` tag names something live. Bump is the highest `release:*` label across every PR merged since the last tag (`scripts/ci/resolve-release-bump.mjs`), overridable by a dispatch input. The live SHA is checked out for history and the tag; the classifier itself is overlaid from the running workflow revision (`github.sha`), so a retry of an older live SHA does not re-run that SHA's pre-fix script (run 34155737950 died that way on issue #1340). A squash trailer that names an issue rather than a PR is skipped (loud warning); a 404 on a real PR still fails closed — re-dispatch Release with an explicit bump. The tag object is created through the Git Contents API (`POST /git/tags` + `POST /git/refs`), not receive-pack of a `v*` ref: GITHUB_TOKEN is a GitHub App and receive-pack refuses a tag whose tree's `.github/workflows` differs from default-branch HEAD (run 34247752847 shipped Packet B then died on `v1.0.0`; production was already on `0ca478e9`). That is not enough. `POST /git/tags` succeeded on run 34254679932 (dangling object `bca315f9`) and `POST /git/refs` still returned 403 `Resource not accessible by integration` — same App restriction, now at the ref. Do not widen the Actions App to cover workflow files. Create tag and Create GitHub Release use `RELEASE_GITHUB_TOKEN` (a *user* PAT, `contents:write`; an `automation` environment secret, which the release job names, never a `production` one) when set, else `GITHUB_TOKEN`. `deploy-production.yml` also passes it into the reusable workflow, which matters only while it is still a repository secret: GitHub gives the called job its own environment's copy first (#2518). Until the secret exists, mint both the `v1.0.0` ref (object `bca315f9` / SHA `0ca478e9`) **and** the GitHub Release from a laptop; do not re-run Deploy production, and do not re-run Release to attach a GitHub Release to a laptop-minted tag — that run would see `v1.0.0` as current and bump. |
| Docs                | `.github/workflows/docs.yml`. Despite the workflow's name it is **not** a documentation gate, and it is **not** a required check; the four docs gates that used to run here were deleted, and nothing replaced them in CI. Its job, and the separate `links.yml`, are described in [`DOCS_CI.md` § What runs](DOCS_CI.md#what-runs); neither is required. |
| CI wake             | `.github/workflows/ci-wake.yml` — `workflow_run` on CI / Docs checks / Links completion (PR runs only): classifies infra-vs-code failure, auto-requeues infra failures (≤3 total attempts), and upserts one PR wake comment **only for an outcome the PR-activity webhook does not already carry** — a cancelled or timed-out run, or an infra failure the re-queue could not absorb. Success and real failures clear the stale wake and say nothing. Logic in `scripts/ci/ci-wake.mjs` (tests: `scripts/ci/__tests__/ci-wake.test.mjs`). **Not** a required check. See [`pr-babysitting.md`](pr-babysitting.md). |
| PR base sync        | `.github/workflows/pr-base-sync.yml` — `push` to `main`: sweeps open PRs targeting it (cap 20, logged); behind + clean PRs are auto-updated via the update-branch API **only when the base-sync GitHub App token mints** (default-token pushes trigger no CI). Conflicts and per-PR update failures upsert one `<!-- frapp-base-sync -->` wake comment telling the watching agent to merge `main` itself; a missing or rejected token is repo-wide, so it raises **one** `incident` alert issue instead of the same comment on every PR. Logic in `scripts/ci/pr-base-sync.mjs` (tests: `scripts/ci/__tests__/pr-base-sync.test.mjs`). **Not** a required check. See [`pr-babysitting.md` → Base-branch sync](pr-babysitting.md#base-branch-sync-scriptscipr-base-syncmjs). |
| PR base guard       | `.github/workflows/pr-base-guard.yml` — the **only** workflow with no `on.pull_request.branches` filter, so it runs on every PR whatever the base. Fails when the base is not `main`, which is the one check a stacked PR would otherwise never get. No checkout, no npm, no third-party action; reads `pull_request.base.ref` off the event payload. Fires on `edited` too, so retargeting a base cannot leave a stale green. **Not** yet a required check — see [`pr-babysitting.md` → CI branch filters](pr-babysitting.md#ci-branch-filters-never-target-a-feature-branch). |
| PR CI branch filter | `ci.yml` / `docs.yml` / `links.yml` set `on.pull_request.branches: [main]`. GitHub matches that list against the PR **base**. A PR whose base is anything else skips every required check. See [`pr-babysitting.md` → CI branch filters](pr-babysitting.md#ci-branch-filters-never-target-a-feature-branch). |
| Branch protection   | `npm run configure:branch-protection` (prefers `GITHUB_PAT`) — **that bare form is a LIVE apply and a human step**; from an agent session run only `npm run configure:branch-protection:verify`. See **Branch protection script** below and `CONTRIBUTING.md`. |
| AI code review      | **Repository-managed Git pre-push gate**, not CI — [`.githooks/pre-push`](../../../.githooks/pre-push) is installed through the root `prepare` script for agents and humans. A push is blocked until `.cache/diff-review/<SHA>` exists — `/diff-review` writes the marker; `/code-review` adds coverage but replaces nothing: it is only conditionally model-invocable and does not write the marker (the `claude-review.yml` CI workflow was removed 2026-06-04; the advisory `codex-review.yml` was removed 2026-09-21). See `AI_CODE_REVIEW_RUNBOOK.md` |
| Dependency updates  | `.github/dependabot.yml` — one root `npm` entry (the workspaces share the root lockfile), **weekly** on Monday 09:00 UTC. Minor+patch collapse into a single grouped PR; majors stay individual. The React/React Native/Expo families are ignored — they move only via a planned SDK upgrade. **Not** a required check (it opens PRs, it doesn't gate them). See "Dependency updates (Dependabot)" below. |
| Vercel              | Auto-deploys from `main` only (PR previews disabled via repo config). Production deployments are created by `deploy-production.yml` through the API, not by a push. **Auto-deploy from `main` ended per project — `frapp-landing` 2026-09-01, `frapp-web` 2026-09-02**: both projects are unlinked from Git, so no push deploys anything and staging web and landing are frozen at their last Git builds — landing `2bf143b` (2026-09-01T20:19Z), web `0372c6d` (2026-09-02T02:41:42Z). See the note directly below. |

> **Vercel Git integration retired — `frapp-landing` 2026-09-01, `frapp-web` 2026-09-02; canonical
> record is ADR-21.** The owner disconnected **both** Vercel projects from Git, deliberately and
> **not as one event**: `frapp-landing` on 2026-09-01 and `frapp-web` roughly six and a half hours
> later on 2026-09-02 (`list_projects` reports `link: null` for both, read 2026-09-02). The red
> guardrail, the failing verify steps and the frozen staging hosts that followed from those two
> unlinks are why the two projects' freeze points and their verify jobs' first red runs carry
> different dates. **The first two are repaired** ([#1579](https://github.com/pdcarlson/Frapp/issues/1579),
> 2026-09-02): the guardrail assertion was inverted, and the two Vercel verify jobs were removed
> outright — so **no Vercel job in `verify-deployments.yml` can produce a red `main` any more**, and
> a red check there is something new. While those jobs existed the failure was the **verify** step
> only: `scripts/ci/ensure-vercel-staging-alias.mjs` ran after it as a plain sequential step with no
> `if:` guard, so a failed verify ended the job and the alias step was *skipped* — that script never
> failed and emitted nothing to grep for. The full
> breakage list, the evidence and the rationale live in **ADR-21** in
> [`spec/architecture/adr/adr-21.md`](../../../spec/architecture/adr/adr-21.md), with its 2026-09-02
> amendment — read it there rather than
> re-deriving it here. The replacement model (`vercel build`
> plus `vercel deploy --prebuilt` driven from GitHub Actions) was **built** by
> CI/CD stage 7, [#1578](https://github.com/pdcarlson/Frapp/issues/1578) under the
> [#1381](https://github.com/pdcarlson/Frapp/issues/1381) epic:
> `.github/workflows/deploy-vercel-staging.yml` deploys staging after green CI on `main`, and
> `deploy-production.yml` deploys production from a dispatched SHA. Both run
> `scripts/ci/deploy-vercel.mjs`. Live exercise of the production upload, and the
> Actions-list trap when tagging fails afterward:
> [`ci-cd.md`](../ops/deployment/ci-cd.md#how-deployments-are-gated) (2026-09-07, run 34155737950).
>
> This does **not** retire the "dashboard-only, fail-open settings" framing the guardrail row sits
> inside. While the projects stay unlinked there is no Production Branch left to point at `main` —
> but the unlink is itself unversioned dashboard state that a click could undo, so #1579
> **inverted** the assertion (a *present* Git link is now the violation) rather than deleting it,
> and "the projects are still unlinked" stays an auditable Vercel item. The Render half of the framing
> (auto-deploy off, tracking `main`) is untouched and still asserted.

**PR review policy:** [`CONTRIBUTING.md` § PR review requirement policy](../../../CONTRIBUTING.md#pr-review-requirement-policy).

**Branch protection script (verify / dry run / apply):**

```bash
# Agent session: this one, and nothing else. Read-only; exits non-zero on drift.
npm run configure:branch-protection:verify

# Human step, admin PAT, on a laptop. The `--` separator is load-bearing.
npm run configure:branch-protection -- --dry-run
npm run configure:branch-protection            # LIVE — PUTs the whole protection payload
```

**From an agent session run `npm run configure:branch-protection:verify` and nothing else.** Never
the bare `npm run configure:branch-protection`: with no flags the script prints `Mode: LIVE` and
`PUT`s the entire protection payload. And never `--dry-run` without the `--` separator — `npm run
configure:branch-protection --dry-run` has the flag swallowed by npm itself (reproduced on npm
10.9.7), so the script sees zero arguments, `hasFlag` is false for both `--dry-run` and `--verify`,
`assertKnownArgs` has nothing to reject, and it **applies**. Applying branch protection is a human
step with an admin PAT — by policy (canonical statement:
[`../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)) — and
the two footguns above are why that policy is not merely etiquette.

Deeper deploy architecture: [`../ops/deployment/`](../ops/deployment/).

## Infisical sync map

The live syncs — source environment, secret path, destination scope, git branch filter, and the
date the dashboard was last read — are inventoried in exactly one place: [`SECRETS_MANAGEMENT.md` §5 "Configure Secret Syncs"](../environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs). GitHub Actions is not one of them; which workflows pull at job time instead: [`SECRETS_MANAGEMENT.md` § GitHub Actions is not a sync](../environment/SECRETS_MANAGEMENT.md#github-actions-is-not-a-sync). Do not restate the table here.

Project ID is documented in [`SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md) and root `.infisical.json`.

## GitHub environments and bootstrap secrets

| Environment  | Protection        | Purpose                             |
| ------------ | ----------------- | ----------------------------------- |
| `staging`    | None; deployment branches `main` only (target, [#2583](https://github.com/pdcarlson/Frapp/issues/2583)) | Staging deploys (`main`), plus the two staging checks (`staging-conformance.yml`, `verify-deployments.yml`) |
| `production` | **A required reviewer that actually pauses jobs** (see the note below) — since #1340 this is the ONLY human gate on production | Production deploys + migrations |
| `production-backup` | **No required reviewers, on purpose.** Referenced by `db-backup.yml` since 2026-09-06 (#1435). GitHub's documented behaviour is to create an environment the first time a job *runs* against a name that does not exist, with no protection rules — so it appears after the first scheduled run, not on merge, and had not been observed via `GET /repos/…/environments` when this row was written (reconfirmed 2026-09-07 with the same `GET`: the name is still absent). **Corrected 2026-09-23: it exists now.** The `production-backup-env.yml` watchdog, which fails on a missing or unreadable environment, passed on each of its last five scheduled runs (2026-09-18 → 2026-09-22; latest [run 35722904165](https://github.com/pdcarlson/Frapp/actions/runs/35722904165)). If it is ever created by hand, it must be created **without** reviewers; a required-reviewer rule here silently suspends every nightly production dump. It **should** also get Deployment branches → Selected → `main` (the [`db-backup.yml`](../../../.github/workflows/db-backup.yml) header), a branch filter rather than a reviewer gate; that lock is still unset and is tracked on #1827 | The nightly **read-only** production dump and Storage mirror. A `schedule:` job naming `production` would suspend on the reviewer gate every night; this environment exists so the backup needs no human at 02:30 while keeping the deploy gate untouched. Its only GitHub secrets are the Infisical pair (roster below; until [#2583](https://github.com/pdcarlson/Frapp/issues/2583) moves them they are still repository secrets) — the job injects Infisical `prod` (source) and `staging` (offsite bucket), and each backup action asserts the injected project ref against `.github/environments.json` before linking |
| `automation` | **No required reviewers, on purpose**, the same trap as `production-backup`. Deployment branches `main` only (target, [#2583](https://github.com/pdcarlson/Frapp/issues/2583)). Named with `deployment: false`, so its runs create no deployment records | Every unattended job on `main` that needs a secret and is not a staging or production deploy: `check-migration-drift`, `migration-snapshot`, `production-auth-conformance`, `production-guardrails`, `production-release-pin`, `pr-base-sync`, `release`. Added by #2518 |

> **Environment-protection note — premise corrected 2026-08-21.** This note used to read "GitHub *environment* required-reviewer protection rules are Enterprise-only on private repos, so they do **not** gate this (private, Pro) repo." **The repo is public**, verified 2026-08-21 by fetching the README over raw.githubusercontent.com with no credentials: HTTP 200, against a 404 control for a nonexistent repo. So the private-repo exemption that sentence rested on does not apply, and the conclusion no longer follows from its stated reason.
>
> Nothing was changed on the strength of that at the time, and the gate then was the `main` → `production` promotion PR (branch protection: CI + an approving review + conversation resolution), with the `production` environment existing for job scoping. Whether environment required reviewers were available on this plan was left as an **open question for the owner**. Found while reviewing the base-sync App credential, which needed to know the repo's visibility for a different reason.
>
> **Open question ANSWERED 2026-08-28: they are available, they are configured, and they pause production jobs today.** This is the canonical statement; every other doc that describes production's approval posture should defer to this paragraph rather than restate it.
>
> Production-scoped jobs sit between being created and being started, while jobs with no environment — and jobs scoped to `staging` — start in about two seconds:
>
> | Run | Job | Environment | Created → started |
> | --- | --- | --- | --- |
> | [33184010470](https://github.com/pdcarlson/Frapp/actions/runs/33184010470) | `check-changes` | none | 2s |
> | [33184010470](https://github.com/pdcarlson/Frapp/actions/runs/33184010470) | **`migrate-production`** | **production** | **29m 52s** |
> | [33184010470](https://github.com/pdcarlson/Frapp/actions/runs/33184010470) | `deploy-outcome` | none | 3s |
> | [33188671688](https://github.com/pdcarlson/Frapp/actions/runs/33188671688) | `migrate-staging` | staging | 2s |
> | [32789194139](https://github.com/pdcarlson/Frapp/actions/runs/32789194139) | `migrate-production` (dispatch) | production | 15m 19s |
> | [32790550501](https://github.com/pdcarlson/Frapp/actions/runs/32790550501) | `migrate-production` (dispatch) | production | 3m 13s |
>
> What that rules out: runner queueing (siblings in the same run got runners in seconds), `needs:` (the parent job had already finished), the `db-migrate-production` concurrency lock (nothing else held it), `environment:` as a mechanism (staging is environment-scoped and does not wait), and a `wait_timer` (a fixed timer cannot produce 3m13s, 15m19s and 29m52s). Variable multi-minute delays on exactly the production-scoped jobs is a person clicking **Approve**.
>
> **Verified directly 2026-09-02; the timing evidence above is now corroboration, not the basis.** This paragraph used to read "the environment's protection rules themselves were not read. `GET /repos/{owner}/{repo}/environments/production` is not reachable from an agent sandbox — the proxy answers `403`." The 403 was the proxy route, not the endpoint — see **The `api.github.com` route rule** under Work status. Read direct with node `fetch`, `GET /repos/pdcarlson/Frapp/environments/production` returns **200** and reports `protection_rules: ["required_reviewers"]`, and `GET /repos/pdcarlson/Frapp/environments` returns 200 listing nine environments (`Preview`, `Preview – frapp-docs`, `Preview – frapp-landing`, `Preview – frapp-web`, `production`, `Production – frapp-docs`, `Production – frapp-landing`, `Production – frapp-web`, `staging`). So a required-reviewer rule on `production` is a fact read off the API, and the created→started delays above are consistent with it rather than the only evidence for it. That read establishes the rule is **present**, not *who* the reviewers are — that still takes one look at **Settings → Environments → production**.
>
> **Consequence, and what #1340 did with it.** Production migrations used to be gated by a human twice: once at the promotion PR, and again after merge, on an approval click nobody was paged for. The second gate is the one that parked a one-migration apply for 29m52s on 2026-08-28.
>
> The resolution was not to remove the second gate but to remove the **first**. The promotion PR was the weaker of the two: it approved a branch merge, before anyone knew whether the migration applied, and it did not name the commit that would ship (Render auto-deployed the branch tip on commit, without waiting for CI). The environment approval happens on a run that names the SHA, after the replay has rehearsed the apply against production's live state, with a person watching. So `production` still has Required reviewers **on purpose**, and `deploy-production.yml` is unusable without them.
>
> One consequence worth stating plainly: the **shipping** path in `deploy-production.yml` is a **single `environment: production` job** precisely because each environment-scoped job costs its own Approve click. Splitting migrate / Render / Vercel / verify would silently turn one approval into four. SHA confirmation, trim, and `validate-deploy-sha.mjs` are a prior **unscoped** job so a bad paste or confirmation cannot open that gate (run 34234768094 sat 20 minutes on Approve, then died at Validate; production was not touched). Do not put `environment: production` on `validate`.

### No repository secrets (#2518)

**The rule: every secret is an environment secret, and no repository secret exists.** That is the target; on 2026-09-23 the settings do not follow it yet (**State**, below). For a same-repository pull request, and for a push or a dispatch on any branch, GitHub runs the workflow definitions from that branch. So a repository secret is readable by anyone who can push a branch: they edit a workflow, or add one. Agent sessions push branches, and they read public issue text. The boundary that holds is an environment whose **deployment branches** rule admits `main` only:

- GitHub matches the rule against the run's `GITHUB_REF`. A `pull_request` run is `refs/pull/N/merge`, a push or dispatch carries its own branch, and `schedule` and `workflow_run` run as the default branch.
- A job cannot read an environment's secrets until its rules pass.
- An environment secret also wins over a repository secret of the same name, which is what lets the move go one secret at a time.

Two rules follow. Both are pinned by [`workflow-secrets-scope.test.mjs`](../../../scripts/ci/__tests__/workflow-secrets-scope.test.mjs):

1. **Nothing a pull request triggers references a secret.** The migration gates read a published snapshot instead (below).
2. **Every job that references a secret names one of the four environments below, as a literal.** A computed name could select an unprotected environment, and naming one that does not exist makes GitHub create it with no rules. A new environment gets its `main` rule before its first secret, and then joins `CREDENTIAL_ENVIRONMENTS` in that test.

| Environment | Secrets | Consumers |
| --- | --- | --- |
| `automation` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `RENDER_API_KEY`, `VERCEL_API_KEY`, `RELEASE_GITHUB_TOKEN`, `PR_BASE_SYNC_APP_CLIENT_ID`, `PR_BASE_SYNC_APP_PRIVATE_KEY` | the table above |
| `staging` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `RENDER_API_KEY`, `VERCEL_API_KEY`; optional `STAGING_SMOKE_USER_EMAIL`, `STAGING_SMOKE_USER_PASSWORD` | `deploy-api.yml`, `deploy-vercel-staging.yml`, `db-backup.yml` (staging jobs), `staging-conformance.yml`, `verify-deployments.yml` |
| `production` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `RENDER_API_KEY`, `VERCEL_API_KEY` | `deploy-production.yml` (`deploy`) |
| `production-backup` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET` | `db-backup.yml` (production jobs) |

**State on 2026-09-23: the workflows follow both rules, and the settings do not yet.** All nine secrets are still repository secrets, and no environment has a branch rule. Until the owner's [#2583](https://github.com/pdcarlson/Frapp/issues/2583) is done, any branch can read every secret, and the table above is the target. To read the live state, use the direct REST route under Work status: `GET /repos/pdcarlson/Frapp/actions/secrets` (names only; the target is `total_count: 0`) and `GET /repos/pdcarlson/Frapp/environments` (each `deployment_branch_policy` set). [#2585](https://github.com/pdcarlson/Frapp/issues/2585) makes that a daily watchdog.

Read-only consumers of the provider keys: `production-guardrails.yml` (`RENDER_API_KEY` and `VERCEL_API_KEY`), `verify-deployments.yml` and `staging-conformance.yml` (`RENDER_API_KEY`). `deploy-production.yml` uses the same two keys to **create** deploys: a Render deploy by `commitId`, and a Vercel deployment with `target: production`. They never carry runtime values. Those runtime values (including `SUPABASE_ACCESS_TOKEN`) come from Infisical at job time ([`SECRETS_MANAGEMENT.md` § GitHub Actions is not a sync](../environment/SECRETS_MANAGEMENT.md#github-actions-is-not-a-sync)), and the Infisical pair above is the only way in. `INFISICAL_PROJECT_ID` and `OPENROUTER_API_KEY` have no consumer; deleting them is [#1587](https://github.com/pdcarlson/Frapp/issues/1587) and [#2447](https://github.com/pdcarlson/Frapp/issues/2447).

**The migration snapshot.** `migration-drift-gate.yml`'s three jobs need each project's applied-migration history, and only a credential can read that. So [`migration-snapshot.yml`](../../../.github/workflows/migration-snapshot.yml) reads it from `main`, in `automation`, after every `Deploy API` and `Deploy production` run and every 4 hours. It uploads the result as the `migration-snapshot` artifact, and [`download-migration-snapshot`](../../../.github/actions/download-migration-snapshot/action.yml) fetches the newest one from a successful `main` run with `GITHUB_TOKEN`. The download action accepts only a run whose commit is on `main` (a tag named `main` would otherwise pass for it). Off `main` (a pull request, or a dispatch on a PR's branch), the required `migration-order` and `migration-replay` also need the snapshot to have been read after the latest finished `Deploy API` or `Deploy production` run on `main`, with no `Deploy API` run still in flight. While that isn't yet true they wait, up to 15 minutes, for the deploy to finish and its publish to land. That budget is not yet measured end to end. If the snapshot is still stale after that, they fail on every PR that touches a migration, naming the publisher. Runs on `main` take the newest trusted snapshot as it is (`on-stale: use`). There the migration has already merged, and failing would leave a red required check on a `main` commit, one `validate-deploy-sha.mjs` refuses to deploy. The report-only `migration-drift` never waits either. It turns red as `stale` when a migration has been on `main` longer than its grace window and the snapshot cannot show whether staging has it: a `Deploy API` run may have changed staging since, or whether one did could not be read. The job summary says which case applies and what to do; the cases are in [`DB_PROMOTION_RUNBOOK.md` § `migration-drift`](../ops/DB_PROMOTION_RUNBOOK.md#migration-drift--reports-does-not-block). The action's header has the reasoning, and the one residual: a `Deploy production` run still in flight. Behind all of it sits a 24-hour age limit on every snapshot. The fix is to repair the publisher, then Actions → **Migration snapshot** → Run workflow on `main`. The same run is the step after any manual change to a migration ledger (a `migration repair`, an `--include-all` apply), which triggers no publish ([`DB_PROMOTION_RUNBOOK.md` § What catches drift, and what catches bad ordering](../ops/DB_PROMOTION_RUNBOOK.md#what-catches-drift-and-what-catches-bad-ordering)).

## Release labels

| Label           | Effect on version bump |
| --------------- | ---------------------- |
| `release:major` | Major                  |
| `release:minor` | Minor                  |
| `release:patch` | Patch (default)        |

Put the label on **every** PR. Before #1340 it went on the single `main` → `production`
promotion PR, whose labels decided the version on their own. There is no promotion PR now:
`deploy-production.yml` scans the `release:*` labels on every PR merged since the last `v*`
tag and takes the highest, so an unlabelled `release:major` change ships as a patch.

## Lint, test, build (repo root)

- `npm run lint` — turbo lint (read-only)
- `npm run lint:api` — API only (read-only)
- `npm run lint:api:fix` — applies ESLint auto-fixes; the only lint script that writes; see [contributing.md §5](../../guides/contributing.md#5-linting-types-and-tests)
- `npm run test -w apps/api` — Jest
- `npm run build` — turbo build
- `npm run check-types` — turbo TypeScript
- `npm run check:api-contract` — OpenAPI / SDK drift
- `npm run check:migration-safety` — migrations + promotion docs
- `npm run check:npm-audit` — npm audit gate: non-allowlisted high/critical advisories fail (CI `dependency-audit`; `-- --soft-network` for offline dev)

`lint` and `check-types` both depend on `^build` in root `turbo.json`, so they build the shared
packages themselves and need no `npx turbo run build --filter='./packages/*'` beforehand — a bare
`npm install && npm run check-types` works on a cold clone. The CI job **`clean-checkout-typecheck`**
exists solely to keep that true: it runs `npm ci`, `npm run check-types` and `npm run lint` with no
`needs:` and no `uses: ./.github/actions/turbo-packages-build` — the composite action that restores
the turbo cache and prebuilds the packages. Every job that *does* use it (ADR-15 Lever A — eight of
them) is blind to this regression, which is why this one must not — so do not "optimize" that
one-line `uses:` into this job. `web-production-build` carries the same prohibition for a
**different** reason: it guards the pruned `npm ci --omit=dev` production install shape, where
`clean-checkout-typecheck` guards unbuilt package types on a dev tree. `scripts/ci/__tests__/turbo-packages-build-action.test.mjs`
fails if either acquires the action.

**That guarantee stops at the turbo tasks.** `^build` applies to `build`, `lint` and `check-types`
only; the root `check:*` scripts above are plain node scripts turbo never schedules, so they cannot
inherit it. `check:api-contract` is cold-clone-safe for a *different* reason — it builds
`./packages/*` itself before regenerating (`scripts/check-api-contract-drift.mjs`), because its
OpenAPI export type-checks `apps/api` against those packages and fails with `TS2307` on `@repo/*`
without them. Do not remove that build on the grounds that turbo or CI already covers it: CI's
prebuild step is what would mask the regression, exactly as above. `npm audit` and
`check:migration-safety` need no build at all. Conflating these three cases is what caused #683.

Testing workflows and CI parity: [`.claude/skills/testing/SKILL.md`](../../../.claude/skills/testing/SKILL.md).

## Dependency updates (Dependabot)

Config: [`.github/dependabot.yml`](../../../.github/dependabot.yml). This is the automated half of
the supply-chain story; the blocking half is `npm run check:npm-audit` (above), which fails CI on any
non-allowlisted high/critical advisory.

**One ecosystem entry, at the root.** `apps/*` and `packages/*` are npm workspaces resolving through
a single root `package-lock.json`, so one `npm` entry covers all eighteen. Per-workspace entries would
open duplicate PRs against the same lockfile — don't add them.

**Schedule and noise floor.** Weekly, Monday 09:00 UTC, `open-pull-requests-limit: 6`. Minor and
patch updates are grouped into **one** PR (`npm-minor-and-patch`); majors are deliberately left
ungrouped so each arrives as its own reviewable diff. Every Dependabot PR costs a babysit cycle under
the [Autonomous PR lifecycle](../../../AGENTS.md), which is why grouping is aggressive.

**The one exception to "majors arrive alone": the `vitest` group.** `vitest` and
`@vitest/coverage-v8` are grouped at *every* update type, because they peer-require each other at an
exact version. Moving one half alone does not fail — npm silently lands a **second** vitest and
leaves half the tree on the old version, *which* half depending on which package moved — so a patch
splits the tree just as badly as a major does. Grouping by update type is the normal noise-floor
lever; this group exists for correctness instead, and it costs +1 PR on the weeks vitest ships. A
second group entry carries `applies-to: security-updates`, because groups default to the
version-update lane only. See
[The vitest 5 major is held on jest-dom's matcher types](#the-vitest-5-major-is-held-on-jest-doms-matcher-types)
below for the measured trees and why one of the two PRs went green anyway.

The limit went 5 → 6 with that group, and the 6th slot is *its*, not new headroom: the group fires
on every week vitest ships, and Dependabot drops overflow past the cap **silently** — no error, no
comment, nothing saying a PR was withheld. Security PRs are exempt from the limit and never counted
against it, so a full queue cannot suppress one. Add another always-on group and this needs raising
again by one.

**Who babysits.** Nobody special — Dependabot PRs flow through the normal lifecycle: CI runs (`npm
ci`, lint, type-check, `api-tests`, `web-tests`, `api-docker-build`) plus the audit gate, and an
agent triages red checks infra-vs-code exactly as for a human-authored PR. Commits land as
`chore(deps): …` / `chore(deps-dev): …`; PRs are labelled `area:deps` and carry no release label, so
they take the default `release:patch` bump.

### A grouped bump of a peer-depended package can land a second copy, not an upgrade

Dependabot [#2369](https://github.com/pdcarlson/Frapp/pull/2369) moved `apps/api` from
`@nestjs/*@^11.2.1` to `^11.2.4` and reddened five jobs at once — `lint-and-typecheck`,
`clean-checkout-typecheck`, `api-contract-check`, `api-tests` and `api-docker-build` — on type
errors naming the *same* type on both sides (`Argument of type 'INestApplication<any>' is not
assignable to parameter of type 'INestApplication<any>'`): one import path under
`apps/api/node_modules/@nestjs/common`, the other under the root `node_modules/@nestjs/common`.
When nothing in a Dependabot diff but `package-lock.json` explains a wall of red, that is the shape
to recognise.

It is the duplicate-hoisted-copy trap of
[`SECURITY_FIXES.md`](../security/SECURITY_FIXES.md#why-the-pin-bump-alone-was-not-enough) — its
§ *Prevention* rule "Check for a duplicate hoisted copy afterward", and the `next`/`geist` case
under § *Why the pin bump alone was not enough* — arriving through the Dependabot lane instead of an
advisory sweep. Six packages outside the bumped set peer-depend on the root `@nestjs/common` node
(`@nestjs/config`, `@nestjs/swagger`, `@nestjs/schedule`, `@sentry/nestjs`, …) on ranges as loose as
`^11.0.0`, so when the only *direct* dependant moves, the old node still satisfies every one of
them: npm keeps it, re-marked `"peer": true`, and nests the new version under
`apps/api/node_modules/` instead. TypeScript is structural, so two copies are not incompatible by
themselves — what breaks is the declarations inside them that structural typing cannot relate.
`VersionValue` is `string | typeof VERSION_NEUTRAL | Array<…>` and `VERSION_NEUTRAL` is declared
`unique symbol`, so two copies declare two distinct symbol types. That is where *this* error bottoms
out — `Type 'unique symbol' is not assignable to type 'VersionValue | undefined'` — and it is what
`tsc` names first on the way back up through `VersioningOptions` to the `INestApplication` mismatch
the jobs report. Do not read it as the only break: `tsc` stops at the first incompatible property,
and neutralising that symbol in both copies leaves the two `INestApplication` types unrelated
anyway, through the generic `on` signature reached via `connectMicroservice` (checked by compiling
two copies against each other, 2026-09-18). This is npm's tree builder, not Dependabot — a plain
`npm install --package-lock-only` on the same manifest change reproduces the nesting exactly
(2026-09-18, npm 11.19.1).

**Read the remedy in that document, not here**, `npm update <pkg>`-before-entry-deletion order
included. What this lane adds to that record is that for a *grouped* bump the cheaper lever is
enough, provided the siblings move together: with all four `apps/api` ranges at `^11.2.5`,
`npm update @nestjs/common @nestjs/core @nestjs/platform-express @nestjs/testing
--package-lock-only` off `origin/main` resolved one hoisted 11.2.5 apiece and no nested copy —
byte-identical to deleting those four lockfile entries by hand and re-resolving (2026-09-18,
Node 24.20.0 / npm 11.19.0). Mind the versions there: the fix shipped **11.2.5**, one patch past
what #2369 proposed, because that release landed while the PR sat red.

`npm dedupe` is not a lever for this — neither it nor a root `overrides` entry moves an existing
peer resolution, as that same record states. In this repo it never gets that far anyway: it
re-resolves the whole tree and exits `ERESOLVE` on the `openapi-typescript` peer conflict under
[TypeScript 7 is native `tsc` plus a TypeScript 6 compiler
API](#typescript-7-is-native-tsc-plus-a-typescript-6-compiler-api) below.

### The ignore list is a runtime constraint, not a preference

`react`, `react-dom`, `react-test-renderer`, the `react-native*` family and the Expo client packages
are ignored. React is pinned to an **exact** version in every workspace plus a root `overrides`
entry: React Native bundles a `react-native-renderer` that asserts exact version equality with
`react` at runtime, while its peer range does not express that. npm will
therefore accept a newer React silently, hoist it, and kill `apps/mobile` on first render with
"Invalid hook call" — a failure **only booting the app on a device catches**, never CI. See
[`AGENTS.md` § Gotchas](../../../AGENTS.md) and PR #842. These packages move as a version-locked set
through a planned Expo SDK upgrade (#2329), never as isolated bumps. (#289 was the SDK 54 → 57
upgrade, closed `completed` by PR #927; #2329 is the open tracker for the next one.)

**The membership rule**, since the list is not simply "everything RN-shaped": a package belongs in it
if it is either (a) exact-version-locked to React (`react`, `react-dom`, `react-test-renderer`) or
(b) a native module whose binary must match the Expo SDK's prebuilt set (`react-native*`, the
`expo-*` client packages, `@expo/*`, `@react-native-async-storage/*`). JS-only libraries on caret
ranges stay updatable even when they look RN-adjacent — `@react-navigation/native` and
`@gorhom/bottom-sheet` are deliberately **not** ignored, because a bad bump there fails
`check-types` or a test rather than dying silently on a device.

That `check-types` safety net is the reason JS-only libraries stay updatable, and it **does not
cover a package that ships native code**: `@sentry/react-native` and `@stripe/stripe-react-native`
both ship Swift and Kotlin, both appear in the SDK's own `bundledNativeModules.json`, and both are
outside the ignore list — so a bad bump on either fails as a native compile with no CI signal, not
as a type error. They are also deliberately held *ahead* of the versions the SDK specifies. Whether
that exemption is right, and on what grounds, is #2336; it is an open question, not a decision this
rule has made.

**For the `expo-*` client packages, apply (b) mechanically, not as a judgement:** *every* `expo-*`
entry in `apps/mobile/package.json` belongs in the list, whatever the package looks like from the
JS side. An Expo client package's major version **is** its SDK line — the `58.x` release of any of
them is built against `expo-modules-core@58` and freely calls native API that `expo-modules-core@57`
does not have — so "is this really a native module?" is the wrong question to ask of one, and
answering it per package is what let ten of them sit outside the list until PR #2338. Read the rule
this way and the list is mechanically checkable against the manifest; read it as a per-package
judgement and the gap reopens the next time a client package is added. Nothing checks it
mechanically today — adding that gate is #2330.

That gap cost a production build. Dependabot moved `expo-apple-authentication` (#2218) and
`expo-localization` (#2217) to `58.0.0` as ordinary semver majors, and the first iOS production EAS
build failed in the Xcode native compile with `type 'Utilities' has no member 'keyWindow'`:
`expo-apple-authentication@58.0.0`'s `ios/AppleAuthenticationRequest.swift` calls
`Utilities.keyWindow()`, and `expo-modules-core@57.0.11` declares `Utilities` with only
`urlFrom(string:)` and `currentViewController()` — in the 57 line that window lookup lives on a
different type, `SceneGeometry.keyWindow(for:)`. **Nothing in CI catches this class of break:** the
`expo prebuild` job runs with `--no-install`, which generates the native project without compiling
it, so no Swift is built anywhere in CI and the failure first appears at `eas build -p ios`. The
list is the only gate.

Pinning back to the SDK line is the supported configuration, not a workaround — `~57.0.x` is what
Expo ships for SDK 57 — but it is **not free, and the PR that did it did not verify the runtime
path.** `58.0.0` also carried two iOS fixes on the Sign in with Apple path that the 57 line does not
have: an uncatchable `fatalError` when no key window is found (replaced upstream by a catchable
exception), and a missing `.runOnQueue(.main)` on `requestAsync`, which leaves
`ASAuthorizationController.performRequests()` on `expo-modules-core`'s background async queue. Both
are tracked in #2334, and both arrive for free with #2329. Do not read the pin as evidence that
native SIWA was exercised — the mobile unit suite mocks the module and never loads it.

Two traps for whoever edits that list next:

- **Do not collapse the Expo entries into `expo-*`.** That glob also matches `expo-server-sdk`, an
  `apps/api` dependency (the push-delivery client) with no relationship to the mobile SDK lock.
  Globbing it would freeze the API's push library silently and indefinitely. The client packages are
  listed individually for exactly this reason; if an SDK upgrade adds a new one, append it.
- **Ignore conditions also suppress Dependabot _security_ updates.** A CVE in React, React Native or
  an Expo client package will **not** open a PR automatically. This is an accepted trade — an
  isolated security bump in that set breaks the runtime — but it is a real gap, so it is written down
  rather than left implicit. `check:npm-audit` still fails CI on such an advisory, so it surfaces
  loudly; carrying the fix means doing an SDK-aligned upgrade, not a one-package bump.

  **That gap got wider when the Expo client list was completed to all 21 packages.** It now also
  covers `expo-camera`, `expo-image-picker`, `expo-document-picker`, `expo-location` and
  `expo-notifications` — the media, file, location and push surfaces, which had been receiving
  automatic patch and security PRs while they sat outside the list. None of the entries carry
  `update-types`, so in-SDK `57.0.x` patches are frozen alongside the SDK-line majors that actually
  caused the break; scoping them to `version-update:semver-major` (the shape `eslint` already uses
  in the same file) would block the break and let patches flow. Whether to do that is #2331 — an
  open question, not a decision this section has made.

`@types/react` is deliberately **not** ignored: it is types-only, carries no runtime equality
assertion, and a bad bump fails `npm run check-types` in CI — which is precisely the safety net that
makes auto-updates tolerable.

**Dependabot does not manage the root `overrides` block.** Those entries (`handlebars`, `undici`,
`path-to-regexp`, … — added by #861 to force patched versions of *transitive* dependencies) are
invisible to it, so they neither get bumped nor get cleaned up as the direct dependencies that pulled
them in move on. Reviewing that block is a manual job; `npm run check:npm-audit` is what tells you an
override is no longer doing its work.

### Dependabot PRs need no docs exemption

They used to. `docs-spec-sync` was a required check under `enforce_admins: true` that failed any PR
touching non-`docs/` files without touching `docs/` — and a Dependabot PR changes `package.json` /
`package-lock.json` and nothing else, so without a step-level exemption keyed on the PR author every
one of them was permanently unmergeable, not merely red. The gate was deleted in #1597 and the
exemption went with it.

The lesson worth keeping is why the exemption existed at all: a required check that a whole category
of legitimate PR **cannot** satisfy is not a gate, it is a block. That was the argument for deleting
the gate, and it is the test to apply before adding any check to `DOCS_CHECKS`.

### `colorjs.io` is ignored: it is a vendored-generator pin, not a dependency

`packages/chapter-theme/src/vendor/generate-radix-colors.ts` is upstream Radix source held
byte-for-byte, and its runtime deps are pinned to match upstream's own `package.json`. `colorjs.io`
sits at an exact `0.5.2`, so Dependabot read `0.7.1` as a *minor* under 0.x semver and swept it into
the grouped PR — where its new `Coords` type (`[number | null, …]`, for CSS Color 4 `none`
components) produced 24 type errors in a file that must not be hand-edited, taking `packages-build`,
`clean-checkout-typecheck` and `api-docker-build` down with it (#1003).

That is the gate doing its job: the `noUncheckedIndexedAccess: false` note in that package's
`tsconfig.json` says outright that typechecking the vendored file is what surfaces "a breaking change
in `colorjs.io`'s API, found on resync". Moving the pin means re-vendoring the generator from an
upstream commit that also moved and re-running `signet.spec.ts` — a resync, not a bump. The ignore
entry keeps that a human decision instead of a weekly red PR. The generator's other two pins stay
under Dependabot; the reasoning for each is in
[`packages/chapter-theme/src/vendor/README.md`](../../../packages/chapter-theme/src/vendor/README.md).

### The ESLint 10 major is held on a plugin, not on our code

`eslint` and `@eslint/js` ignore **major** updates only; 9.x minors and patches still flow. The
blocker is `eslint-plugin-react`: 7.37.5 is its newest published release and its peer range still
ends at `^9.7`. ESLint 10 removed the deprecated `context` methods the plugin calls, so it throws
`contextOrFilename.getFilename is not a function` out of its React-version detection path and takes
React workspace lint (`apps/web`, `apps/landing`) down with it.

The two packages move as a set — `@eslint/js@10` peer-requires `eslint@^10`, so bumping either alone
fails `npm ci` with `ERESOLVE`. That is why both carry the ignore rather than just one.

What makes this a *hold* rather than an open question: it was measured. Pinning
`settings.react.version` in `packages/eslint-config/{next,react-internal}.js` skips the detection
path entirely, and the whole monorepo then lints clean under ESLint 10 — the plugin has no other
v10 incompatibility we trip. That workaround was rejected for now because it runs a core plugin
outside its declared peer range and hardcodes a React version that has to be hand-synced with the
real pin. When `eslint-plugin-react` declares v10 support, drop these two ignore entries and the
upgrade should be close to a no-op. Original PRs: #943 (`eslint`), #944 (`@eslint/js`).

### The vitest 5 major is held on jest-dom's matcher types

`vitest` and `@vitest/coverage-v8` ignore **major** updates only; 4.x minors and patches still flow.
They are named rather than globbed as `@vitest/*` on purpose — `@vitest/eslint-plugin` (the renamed
`eslint-plugin-vitest`) sits in that scope but peers `vitest: "*"` and versions on its own line, so
a glob would freeze its majors forever and drag it into a group premised on the exact peer pin. Same
rule as `expo-*` vs `expo-server-sdk` above. Two independent things break under vitest 5, and only
the first is a hold.

**Upstream, and the reason this is a hold.** vitest 5 widened its assertion interface to two type
parameters (`interface Assertion<R extends void | Promise<void> = void, T = unknown>`).
`@testing-library/jest-dom` still augments the one-parameter shape (`interface Assertion<T = any>`).
TypeScript merges a generic interface's declarations only when the type parameter lists are
*identical*, so the augmentation quietly fails to merge and **every jest-dom matcher stops
existing**. `tsc` emits one error per matcher call site, and `apps/web` has **1,637 of them across
82 spec files** (2026-09-21; counted by matching the jest-dom matcher names against
`apps/web/**/*.spec.tsx`, and spot-checked against #2439's `lint-and-typecheck` log, whose per-file
error lines match site for site). So `check-types` fails in the four figures, not the dozens, all of
it reading `Property 'toBeInTheDocument' does not exist on type 'Assertion<void, HTMLElement>'`, and
it takes `lint-and-typecheck` and `clean-checkout-typecheck` down wholesale.
`@testing-library/jest-dom@7.0.1` is the newest published release (2026-09-21,
`npm view @testing-library/jest-dom version`) — there is nothing to upgrade to.

When a wall of `TS2339: Property 'toBeX' does not exist on type 'Assertion<…>'` appears after a test
runner bump and nothing in the diff touched the specs, this arity mismatch is the shape to
recognise. The matchers did not break; the augmentation stopped merging.

What makes this a *hold* rather than an open question: it was measured, like the ESLint 10 hold. The
only in-repo fix is a hand-written augmentation re-declaring jest-dom's matcher surface against the
two-parameter interface — **50 matchers**, hand-synced with every jest-dom release, for a package
whose own types are meant to be the source of truth. Rejected for the same reason the ESLint 10
`settings.react.version` workaround was.

**Ours, and not covered by the hold lifting.** `apps/mobile/lib/theme.spec.tsx:104` fails under
vitest 5 with `AssertionError: expected undefined to be defined` (1 failed / 1000 passed). It finds a
`Platform.select` call made at *module load* by scanning `vi.mocked(Platform.select).mock.calls`, and
under vitest 5 the call is not there. Not root-caused to a named vitest 5 change. Note
`apps/mobile/vitest.config.ts` *leaves `clearMocks` at its default of off* — deliberately, per the
NOTE at its line 12 — specifically to keep that record alive. There is **no `clearMocks` key**: the
constraint is real but nothing pins it, so a vitest release that flips the default breaks
`theme.spec.tsx` with nothing in the config to stop it. The rewrite should retire that dependency
rather than deepen it. So when jest-dom ships, this is still not a pure version bump.

**Why neither Dependabot PR was the upgrade it claimed to be.** Worth recording in detail, because
CI said so in only one of the two cases. `@vitest/coverage-v8` peer-requires `vitest` at an *exact*
version and vitest returns the favour, so moving one half never fails the install — **npm duplicates
instead**. `vitest` is declared by 12 workspaces and `@vitest/coverage-v8` once at the root, which
today resolves to a single hoisted `node_modules/vitest`. That node has **13** consumers, not 12:
`@repo/api-sdk` runs `vitest run` while declaring no `vitest` devDependency of its own, so it binds
to the hoisted copy — `ci.yml` says so in as many words ("The package uses the hoisted workspace
vitest; this step does not add a lockfile entry"). Move one half and that node splits in two
(counted 2026-09-21 from each branch's `package-lock.json`, npm 10.9.7):

| branch | root `vitest` | root `coverage-v8` | nested workspace copies | CI |
| --- | --- | --- | --- | --- |
| `main` | 4.1.11 | 4.1.11 | none | green |
| [#2437](https://github.com/pdcarlson/Frapp/pull/2437) (`coverage-v8` alone) | **5.0.1** | 5.0.1 | **12 × 4.1.11** | **green** |
| [#2439](https://github.com/pdcarlson/Frapp/pull/2439) (`vitest` alone) | 4.1.11 | 4.1.11 | **12 × 5.0.1** | red |

One install becomes thirteen either way — the duplicate-hoisted-copy trap of
[A grouped bump of a peer-depended package can land a second copy, not an upgrade](#a-grouped-bump-of-a-peer-depended-package-can-land-a-second-copy-not-an-upgrade)
above, reached through the ungrouped-**major** lane rather than the grouped one. Nested copies are
not merely wasteful here:
[A group regeneration can drop `jsdom`, and vitest resolves it from the root](#a-group-regeneration-can-drop-jsdom-and-vitest-resolves-it-from-the-root)
below records what a relocated vitest actually breaks, because vitest loads its environment from its
own install location.

The asymmetry is the part to internalise. #2439 moved the copy the **tests** load, so it went red and
argued for itself. #2437 moved only the copy **coverage** loads — and **nothing in CI runs
`test:cov`** — so it went fully green, with coverage bound to vitest 5.0.1 while every suite except
`@repo/api-sdk`'s ran on 4.1.11. (`@repo/api-sdk` is the 13th consumer above: its suite ran on
5.0.1, in `lint-and-typecheck`, and passed — the only vitest 5 runtime evidence this repo has.) That
PR would have merged. A green Dependabot PR touching a package CI never exercises is worth one look
at the lockfile before trusting the checkmark.

The `vitest` **group** is the permanent half of the fix and is *not* part of the hold: it keeps the
family together at every update type, so the split cannot recur when the hold lifts. It is two
entries — groups default to `applies-to: version-updates`, and security updates ignore groups
unless one opts in, so a security bump of either package alone would rebuild the same split tree
(dormant while Dependabot alerts stay disabled, #921).

Lifting the hold needs **both** blockers cleared, not just jest-dom: drop the two `ignore` entries
once jest-dom ships vitest 5 types **and** `apps/mobile/lib/theme.spec.tsx` no longer depends on an
import-time mock call. Dropping them on jest-dom alone lands a PR that is red on `mobile-validate` —
the failure this section predicts. **Keep the group** either way. Tracking:
[#2445](https://github.com/pdcarlson/Frapp/issues/2445).

### jsdom is held at 30.0.x: Radix overlays open only once per test file on 30.1

`jsdom` ignores **minor and major** updates; 30.0.x patches still flow. Under jsdom 30.1.0 a Radix
overlay cannot be opened a *second* time in the same test file. The first opens normally; every one
after it leaves its trigger at `aria-expanded="false"`, and nothing rescues it — `keyDown` Enter,
`ArrowDown`, `pointerDown` and `click` were each measured and each fails. Since most `apps/web`
component specs open more than one menu or select, `web-tests` goes red broadly.

**It is not cross-test state leakage, which is exactly what it looks like.** Worth stating plainly,
because the obvious diagnosis is wrong and costs an afternoon:

- Each failing test **passes in isolation** on the same jsdom.
- The DOM is *clean* when the failing test starts — zero body children, no leftover
  `[data-radix-popper-content-wrapper]`, no `pointer-events` on `body`, no stray `aria-hidden`.
- A thirty-line spec with a vanilla `DropdownMenu` and no product code reproduces it exactly.
- Dismissing a stale layer first (an `Escape` before each test) changes nothing.

So there is no leak to find. Do not go looking for one.

Measured 2026-09-21 (npm 10.9.7), via `npm install jsdom@<version> --no-save` on an otherwise
untouched `main`, reverting cleanly in both directions:

| jsdom | `apps/web/components/layout/chapter-nav-header.spec.tsx` |
| --- | --- |
| 30.0.1 | 11 passed |
| 30.1.0 | **4 failed**, 7 passed |

Held at the **minor**, not just the major, because 30.1.0 is itself a minor — a major-only ignore
would not have caught it. That makes this hold wider than the vitest and ESLint ones above, and it
is the reason to revisit it rather than leave it standing indefinitely.

What it cost: [#2436](https://github.com/pdcarlson/Frapp/pull/2436), the weekly grouped PR, carried
seventeen updates and went red on this one — holding the other sixteen hostage. That is the case
the `vitest` group above cannot help with, because here the group is working correctly and one
member of it is genuinely broken. With this entry the group regenerates without `jsdom`.

`jsdom` is declared four times — the root plus `apps/web`, `packages/hooks` and
`packages/chat-core` — every one of them a devDependency, and the root copy is the one vitest
actually loads (see the section cross-referenced above). The `ignore` entry matches by dependency
name, so it covers all four. Nothing here ships, so the suppressed-security-PR consequence the
React/Expo block describes is bounded to test tooling, with `check:npm-audit` still gating it.
Re-evaluate by dropping the entry and running `web-tests`; the repro in
[#2451](https://github.com/pdcarlson/Frapp/issues/2451) is faster.

This is the second way jsdom has broken this repo's tests from outside the diff — see
[A group regeneration can drop `jsdom`, and vitest resolves it from the root](#a-group-regeneration-can-drop-jsdom-and-vitest-resolves-it-from-the-root)
below for the other, which is about *where* it resolves rather than *which version*. Both come back
to the same fact: it is a root devDependency that every rendering workspace relies on implicitly.

### eslint-plugin-react-hooks 7 compiler rules

`eslint-plugin-react-hooks` 7.x enables React Compiler rules on top of the two classic
Rules of Hooks. We do not run `babel-plugin-react-compiler`. Shared presets
([`packages/eslint-config/react-hooks.js`](../../../packages/eslint-config/react-hooks.js))
**opt in** to a named allowlist at upstream severity; any rule the plugin ships that is
missing from that allowlist is forced `"off"`, so a later plugin bump cannot re-open
`--max-warnings 0`. The allowlist is the gate — not the upstream config it derives
severities from, which is `recommended-latest` (as of 7.1.1 a strict superset of
`recommended`: the same 16 rules at identical severities, plus `void-use-memo`).

**Enabled at upstream severity** (re-measured 2026-08-20 on `117e0c5`: 0 findings on
`apps/web`, `apps/mobile`, `apps/landing`, `packages/hooks` and every other preset
consumer, after the area cleanups — chat #1122, auth #1123, realtime #1124, forms
follow-up): **every rule v7 ships** — all 16 in `recommended`, including
`set-state-in-effect`, `refs`, `preserve-manual-memoization` and `use-memo`, plus the one
`recommended-latest` extra, `void-use-memo` (#1134). No v7 rule is held off. Intentional
effect-synced drafts (dialog/form reset, invite-token seed, network-banner slide-out) use
scoped `eslint-disable-next-line` / tight block disables with a reason, never
a rule-level `"off"`.

#1108 is the bump that introduced the original hold; #1134 closed the last gap in that
rollout. Adopting a *new* compiler rule that appears in a later plugin bump is still a
dedicated cleanup (fix or scoped disable each finding, then add the rule to the
allowlist), not a Dependabot follow-through.

### TypeScript 7 is native `tsc` plus a TypeScript 6 compiler API

TypeScript 7.0 is a native Go compiler. The npm `typescript@7` package ships `tsc` and a
version stub — `require('typescript').createProgram` is `undefined`. Tools that import the
JavaScript compiler API therefore cannot use it as the `typescript` package:

| Tool | Constraint |
| --- | --- |
| Nest CLI (`nest build`) | Needs `createProgram`; errors telling you to install TypeScript 6 until 7.1 |
| `typescript-eslint` 8.67 | Peer `typescript: >=4.8.4 <6.1.0` |
| `ts-jest` 29 | Peer `typescript: >=4.3 <7` |
| `openapi-typescript` 7.13 | Peer `typescript: ^5.x` — **invalid** against the 6.x alias; regen still uses the compiler API. Do not flatten to 5.x to silence `npm ls`. Revisit when upstream ships a 6.x peer ([openapi-ts#2774](https://github.com/openapi-ts/openapi-typescript/pull/2774)). |

Microsoft's layout, which this repo follows, is two aliases in the root manifest (and the
same `typescript` alias in every workspace that lists it):

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.2"
  }
}
```

`npx tsc` is TypeScript 7.0.2. The `typescript` package is the 6.0.2 wrapper
(`@typescript/typescript6`); it re-exports `@typescript/old` (`npm:typescript@^6`), which is
what `require('typescript').version` and `npx tsc6 --version` report (currently 6.0.3). Root
`overrides` pin `@typescript/old` to `npm:typescript@6.0.3` so a `^6` float cannot land 6.1
while the wrapper still looks like 6.0.2 (`typescript-eslint`'s peer is `<6.1.0`). `@nestjs/cli`
still nests its own `typescript@5.9.3`; ESLint, ts-jest, and Next's API mode load the project
alias. TypeScript 7 also stopped inferring `rootDir` from the common source directory — emitting
packages set `"rootDir": "src"` in their own `tsconfig.json` (not in
`@repo/typescript-config/base.json`: TypeScript resolves `rootDir` relative to the file that
declares it, so a shared `./src` would point at `packages/typescript-config/src`). The emitting
set is `@repo/validation`, `@repo/hooks`, `@repo/color`, `@repo/formatting`, `@repo/observability`, `@repo/chapter-theme`,
`@repo/org-archetypes`, `@repo/chat-integrations` (each `"build": "tsc"`, except `@repo/hooks`,
which builds via `tsc -p tsconfig.build.json` so its `*.spec.ts` / `*.spec.tsx` files stay out of
the build — they import `vitest` and `@testing-library/react`, which Vercel's production install
omits; `tsconfig.json` still includes them so `check-types` keeps covering them), and `@repo/api-sdk`
(`outDir` is set even though `check-types` passes `--noEmit` and there is no `build` script —
do not add a build as a side effect of this pin). Non-emitting packages (`@repo/theme`,
`@repo/chat-core`) and the Next / Expo apps stay `noEmit`. `apps/api` sets `"rootDir": "./src"`
on `tsconfig.build.json` only, so `nest build` emits the API entry at dist/main.js. Do not set
`rootDir` on `apps/api/tsconfig.json`: `"."` would let a stray `tsc -p tsconfig.json` emit
dist/src/main.js instead of failing TS5011, and `"./src"` would hide `test/` from ESLint's
project service.
`baseUrl` is a hard error under native tsc, and it is gone from every in-repo tsconfig
(`apps/api`, `apps/web` `paths` without `baseUrl`, `apps/mobile` `paths` without `baseUrl`).
Expo's `tsconfig.base` also does not set it. `apps/api` also sets `"strict": false` explicitly:
TypeScript 6/7 default `strict` to true, and this app had only opted into `strictNullChecks` /
`noImplicitAny` / `strictBindCallApply` — Nest DTO class fields would otherwise be hundreds of
`TS2564`s. Do not flip it to `true` as cleanup. TypeScript 6 also treats many mock `as never` /
`as Member` assertions as unnecessary, which `@typescript-eslint/no-unnecessary-type-assertion`
now flags as errors. Remaining `as never` / `as unknown as` in specs are load-bearing (smuggled
DTO keys, incomplete Express/Sentry/Stripe mocks) — do not strip them as a TS-version leftover.

Next.js 16 defaults `experimental.useTypeScriptCli` to `true`, then looks for
`typescript/bin/tsc`. That file does not exist on `@typescript/typescript6` (it ships `tsc6`).
`apps/web` and `apps/landing` therefore set `useTypeScriptCli: false` so `next typegen` /
`next build` use the TypeScript 6 compiler API instead. Do not flip it back while `typescript`
is the 6.x alias — Next will try to `npm install typescript` (which resolves to 7) and fail.

Both apps also set `typescript.tsconfigPath` to their own `tsconfig.build.json`, which extends
the app's `tsconfig.json` and excludes test directories, the four test suffixes, and the
`vitest` / `playwright` configs. Same reason as `@repo/hooks` above, one layer up: the app
`tsconfig.json` includes every `.ts` / `.tsx` file under the app, so those files land in the
program `next build` type-checks and import packages Vercel's production install omits. Next's
checker already drops diagnostics from files *named* `*.test.*`, `*.spec.*`, `__tests__/` or
`__mocks__/`, so the only ones that ever reached an error report were the non-suffixed ones —
`apps/web/tests/chapter-subscription.ts` and each app's `vitest.config.ts` — which is why
#1331's suffix-only exclude did not transfer. Previews stayed green throughout because a preview
does not run the same install: the failing production builds installed 1126 packages cold, while
the `main` preview of the same tree restored a build cache and audited 1958. Reproduce with
`npm install --omit=dev` at the root; a green preview or a green dev-tree build is not evidence.
Since #1371 this is no longer only a manual reproduction: the required **`web-production-build`**
job installs with `npm ci --omit=dev` (measured at 1128 packages / 1146 audited, against the
production build log's 1126 / 1144) and builds both apps through turbo, so the class fails in
CI instead of in a production deploy. It carries no `needs:`, no cache restore and no path
filter on purpose — prebuilt package `dist/` from a dev tree would mask a package that cannot
build under the prune, and the `changes.web` filter does not cover `apps/landing/**`, which is
the half of #1372 that went unrecorded.
Two constraints when editing: Next reads `tsconfigPath` for path-alias resolution as well as the
type check, so the build config must *extend* the app config rather than replace it; and
`exclude` overrides rather than merges, so an exclusion added to `tsconfig.json` never reaches
the build. `tsconfig.json` still includes the excluded files, so `check-types` and the editor
keep covering them — and `check-types` is now the only thing that does.

Every ts-jest project overlays `"rootDir": "."` and `"ignoreDeprecations": "6.0"`: the unit
suite in `apps/api/package.json`, plus `apps/api/test/jest-e2e.json`,
`apps/api/test/integration/jest-integration.json`, and
`apps/api/test/ai-evals/jest-ai-evals.json` (those three also keep the CommonJS `module` /
`moduleResolution` / `resolvePackageJsonExports` overlay that needs `ignoreDeprecations` for
`TS5107`; see [`docs/guides/testing.md`](../../guides/testing.md) §6). The unit overlay does
not set `moduleResolution: "node"`; it still carries `ignoreDeprecations` so the four configs
share the same two keys if a later overlay adds a 6.0-deprecated option.

**Do not flatten this back to `typescript@7`.** That is what Dependabot's first 5.9.2 → 7.0.2
bump did (#1031), and it failed `packages-build` / `clean-checkout-typecheck` / `api-docker-build`
on `packages/validation` (`TS5011` missing `rootDir`) before Nest, ESLint, and Jest could even
run. Re-evaluate when TypeScript 7.1 ships a stable programmatic API *and* those three peers
widen; until then the aliases move independently — native 7.x patches on `@typescript/native`,
6.0.x patches on the `typescript` alias (stay below 6.1 for `typescript-eslint`).

### A group regeneration can drop `jsdom`, and vitest resolves it from the root

`vitest` declares `jsdom` as an **optional** peer (`peerDependenciesMeta.jsdom.optional`), and npm
never auto-installs optional peers. It also loads the environment from *its own* install location —
the hoisted root `node_modules/vitest` — so the workspace-level `jsdom` devDependencies in
`apps/web`, `packages/hooks` and `packages/chat-core` are invisible to it. The jsdom suites passed
only because a stale root `jsdom@29.1.1` node lingered in the lockfile as an auto-installed peer of
an older vitest, which nothing declared and nothing guaranteed.

#1395 — the weekly `npm-minor-and-patch` group — regenerated the lockfile, that root node went away,
and every `environment: "jsdom"` config plus every `/** @vitest-environment jsdom */` spec failed
with `Cannot find package 'jsdom' imported from …/node_modules/vitest/dist/chunks/…`. `web-tests`
and `mobile-validate` went red with nothing in the diff that looked like a cause: the group touched
no test file, and the jsdom line in each workspace manifest was unchanged.

`jsdom` is now an explicit **root** devDependency, so the hoisted copy is intentional and `npm ci`
reproduces it. Two neighbouring declarations were missing for the same reason — hoisting luck rather
than intent — and are now explicit: `@testing-library/react` in `apps/mobile` (eight specs import
it), and the `react-dom` peer that `@testing-library/react` needs in `packages/hooks`. Without that
second one npm re-resolves the peer to the newest `^19` on any bump of the testing-library edge,
which collides with the exact `react@19.2.3` pin and fails the install outright with `ERESOLVE`.

The general rule: **declare what a workspace imports.** A package that resolves only because npm
happened to hoist it is a red suite waiting for the next regeneration — and the failure surfaces in
a PR that never touched it.

### Alerts and security updates are a repo Settings toggle

Dependabot **alerts** and **security updates** live in repo Settings → Advanced Security, not in this
file. **The read half is answered as of 2026-09-02: alerts are DISABLED on this repo.**
`GET /repos/pdcarlson/Frapp/vulnerability-alerts` returns **404 `"disabled"`** when called direct
(node `fetch`) — not the `403` this paragraph used to record, which was the agent proxy's
GitHub-credential layer answering rather than GitHub, and therefore said nothing about the toggle
either way (see **The `api.github.com` route rule** under Work status). A session can now read this
setting; it still cannot flip it — the GitHub MCP exposes no repo-security-settings tool and the
REST route above is a read channel. So #921 stays open as `[human]`, now scoped to the write half:
turning alerts (and security updates) on in repo Settings. The alerts toggle is the half that was
read directly; the security-updates toggle follows from it (alerts are a prerequisite) but was not
itself read. Read that alongside § *The ignore list is a runtime constraint, not a preference*
above: security PRs for the React/RN/Expo set are suppressed there deliberately, and with the
repo-level toggle off no alert is being raised for anything else either — so `npm run
check:npm-audit` in CI is the only vulnerability signal this repo actually has today, and unlike a
Dependabot alert it is a **blocking** CI gate (see the `check:npm-audit` rows above).

## Claude Code project settings

`.claude/settings.json` ships repo-wide config for Claude Code sessions (cloud and local). Current contents:

| Key               | Value  | Effect                                                                                                                                                                                                                                                           |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doneMeansMerged` | `true` | The session is not "done" when code is pushed — it's done when the PR is green and review-clean. Drives the babysit-until-green loop, whose steps and stop conditions are in [`AGENTS.md` § Autonomous PR lifecycle](../../../AGENTS.md#autonomous-pr-lifecycle-cloud-sessions); wake-path facts are in [`pr-babysitting.md` → Wake coverage](pr-babysitting.md#wake-coverage). `send_later` (self-wake) was retired 2026-08-08: it prompts and can't be allowlisted. |
| `permissions.allow` | `Workflow` + GitHub MCP babysit/tracker tools | Auto-approves the multi-agent **Workflow** tool so `/next ultracode` fan-outs don't stall on a prompt. Lists the **GitHub MCP** tools the babysit loop and tracker need (`subscribe`/`unsubscribe_pr_activity`, issue/PR reads and writes, `actions_run_trigger`). The 21 `Claude_Code_Remote` / kebab-case / connector-UUID entries for `send_later` and the trigger family were **removed** — they were inert on the cloud surface (ceiling rule) and were being misread as permission. Do not re-add them to "allowlist" `send_later`; it still prompts. `merge_pull_request`, `enable_pr_auto_merge`, `push_files`, `create_or_update_file`, and `delete_file` stay unlisted — merging and direct repo-content writes are not repo-sanctioned (the harness `mcp__github__*` wildcard may still auto-approve them on cloud; the merge gate is policy — see "Applied permission allows"). Linear allows were removed with the retirement (#680). |
| `workflowSizeGuideline` | `medium` | Appends "keep workflows under 10 agents" to the Workflow tool's description for everyone who opens the repo (`small` <5, `medium` <10, `large` <50, `unrestricted` sends nothing). Read out of the 2.1.280 bundle and its settings docs: the guideline is advisory, ultracode doesn't change it, and a value in any settings file overrides `/config`'s "Dynamic workflow size" and hides that row. `/diff-review`'s `frapp-review` workflow is the one sanctioned exception ([ADR-23](../../../spec/architecture/adr/adr-23.md); procedure: [`multi-agent`](../../../.claude/skills/multi-agent/SKILL.md)). |
| `hooks` | SessionStart | Wires [`session-start.sh`](../../../.claude/hooks/session-start.sh) for cloud-sandbox bringup. Review enforcement is provider-neutral in [`.githooks/pre-push`](../../../.githooks/pre-push). A second PreToolUse hook (`linear-autoallow.sh`, PR #676) auto-approved Linear's write tools; it was deleted with the Linear retirement — see "Applied permission allows" below. Details: [`AI_CODE_REVIEW_RUNBOOK.md`](AI_CODE_REVIEW_RUNBOOK.md) and [`AGENTS.md`](../../../AGENTS.md) § Claude Code web sandbox. |

*Removed 2026-09-23:* `skipWorkflowUsageWarning: true`. It was listed here, read out of the 2.1.220 build, as marking the multi-agent workflow usage warning accepted "so unattended sessions don't stall". The 2.1.280 bundle reads the key only from user, local, flag and policy settings, never from this project file, so the value here did nothing. The warning it suppresses is a one-time consent prompt in auto permission mode; non-interactive and background sessions never show it, and approving any Workflow dialog writes the key to the approver's own user settings.

Authoring contract for the loop (what an agent must do) lives in [`AGENTS.md`](../../../AGENTS.md) under "Autonomous PR lifecycle". That is canonical; the `doneMeansMerged` row above links to it rather than restating the steps.

## Shared CI script library (`scripts/ci/lib/`)

The scripts below are written against a small shared layer rather than each carrying its own copy.
Reach for these before writing a new helper; adding a fifteenth private `requireEnv` is the shape of
drift this layer exists to stop (stage 4 of the CI/CD redesign, [#1382](https://github.com/pdcarlson/Frapp/issues/1382)).

| Module | Exports | Use it for |
| --- | --- | --- |
| `scripts/ci/lib/env.mjs` | `requireEnv`, `SECRETS_RUNBOOK` | Reading a required environment variable. Exits 1 naming the variable; emits a GitHub Actions `::error::` annotation under Actions and a plain `Error:` line locally. `hint` appends a pointer — pass `SECRETS_RUNBOOK` where the fix is provisioning a secret. |
| `scripts/ci/lib/http.mjs` | `fetchWithRetry`, `resilientFetch`, `isRetriableStatus`, `IDEMPOTENT_METHODS` | Any outbound call. `resilientFetch` is a drop-in `fetch` carrying a 15s timeout and a bounded 3-attempt retry. |
| `scripts/ci/lib/github.mjs` | `ghRequest`, `githubHeaders`, `GITHUB_API` | Every GitHub REST call. Never throws — a network rejection returns `{ ok: false, status: 0, data: <message> }`, where the message folds in the error's `cause` (undici leaves `message` as the bare "fetch failed" and hangs the real diagnosis there). `data` is `null` only when a real HTTP response carried an empty body, so a truthy `data` is **not** evidence a response was received — check `status !== 0` for that. |
| `scripts/ci/lib/providers.mjs` | `fetchJson`, `fetchRenderDeploys`, `fetchVercelDeployments`, `findRenderDeployBySha`, `findVercelDeploymentBySha`, `vercelDeploymentCreatedAt` | `fetchJson` is the shared ok-check-throw-json wrapper (was three near-identical copies, #1351); `fetchRenderDeploys` / `fetchVercelDeployments` list one page through it. `findRenderDeployBySha` / `findVercelDeploymentBySha` page back through that listing, bounded, looking for a SHA — use these rather than the single-page fetchers when matching against a specific commit, since a page holds only the newest slice and an older SHA can fall off it (#1377). |
| `scripts/ci/lib/polling.mjs` | `createClock`, `pollUntilTerminal` | `createClock` is an injectable clock, so a poll loop's tests run without sleeping. `pollUntilTerminal` is the shared "fetch, classify, sleep, repeat until terminal or timeout" loop behind all four provider pollers (`verify-render-deploy.mjs`, `verify-vercel-deploy.mjs`, `deploy-render-production.mjs`, `deploy-vercel.mjs`, #1351) — it owns only the loop mechanics; each caller's `classify` closure keeps its own terminal-state judgment (the production-path pollers treat a cancel as failure where the observers treat it as neutral, deliberately not unified). |
| `scripts/ci/lib/alert-issue.mjs` | `ALERT_LOOKUP_LABEL`, `ALERT_ASSIGNEE`, `findAlertIssuesDetailed`, `raiseAlert`, `resolveAlert` | The create/reopen/comment/close upsert contract for `incident` alert issues, and the one place their label and assignee are set. |

Every one of these takes an injectable `fetchImpl` (or clock), which is what keeps the suites offline.

### Retry is scoped to idempotent methods, deliberately

`fetchWithRetry` retries `GET`, `HEAD` and `OPTIONS`. It does **not** retry `POST`, `PATCH`, `PUT` or
`DELETE`, and that restriction is load-bearing rather than conservative habit: `deploy-render-production.mjs`
**POSTs to create a deployment**. If the first POST reaches the
provider and only its response is lost — a gateway 502, or the timeout firing on a slow but successful
call — then re-sending it starts a **second production deploy**.

The Vercel deployer reaches this module with `GET`s only — a deployment lookup and a poll — because it
creates deployments through the Vercel CLI, not through this client. That is why it is not a second example
here; the rule is unchanged for anything that does POST a create.

Non-idempotent calls are still bounded, but on a **much longer** deadline (`NON_IDEMPOTENT_TIMEOUT_MS`,
120s, against 15s for a retriable call). Aborting a create is not free: if the short deadline fired on
a slow-but-successful deploy POST, the deploy would still run on the provider while the script threw —
CI reporting failure for a deploy that is actually happening — and because the call is not idempotent
we could not re-send it to find out. A caller that knows its POST is idempotent (a search, a dry-run)
opts in to retry explicitly with `retryMethods`, and an explicit `timeoutMs` always wins over both
defaults.

**What is retried:** `429`, any `5xx`, a network-level rejection (undici throws on DNS failure and
`ECONNRESET` rather than returning a response), and our own timeout while the response is awaited. A
body that stalls after the response arrives is not ([#2601](https://github.com/pdcarlson/Frapp/issues/2601)).
`http.mjs`'s header has the exact rules. **What is not:** every other `4xx`. A `401`, `403` or
`404` on a deploy path is a dead token or a wrong id, and re-sending it three times converts a clear
failure into a slow one.

### `ghRequest` does not retry by default

The watchdogs (`ci-wake`, `pr-base-sync`) treat `ok: false` as a fail-safe skip, and their suites
assert exact call counts against `5xx` fixtures — *"exactly one API call: the freshness check"*.
A default retry would silently change those counts, so callers opt in with `retry: true`. The
production deploy path uses `resilientFetch` directly instead.

## PR babysitting: wake signals and CI-failure triage

Wake coverage, CI-failure triage, CI branch filters, the CI-wake watchdog, and base-branch sync live in [`pr-babysitting.md`](pr-babysitting.md). Cite that file and a heading, never `§N`. This file keeps PAT policy, environments, TypeScript 7, scheduled conformance, the CI summary table, and the agent dev stack.

## Deploy visibility (`scripts/ci/deploy-alert.mjs`)

`Deploy API` failed **44 of 44 executing runs** between 2026-05-30 and 2026-08-08 and nobody
noticed for 71 days ([#763](https://github.com/pdcarlson/Frapp/issues/763); the credential defect
itself is [#696](https://github.com/pdcarlson/Frapp/issues/696)). Three things compounded, and the
first and third are what the `deploy-outcome` job fixes:

1. **A skipped run is a green run.** The `check-changes` path gate skips the migrate/deploy
   jobs when a push touches neither `apps/api/`, `packages/validation/`,
   `packages/observability/`, `packages/typescript-config/` nor `supabase/migrations/`. 46 of the last 90 runs were
   green-because-empty, so the Actions list read "mostly healthy" while the deploy path was
   100% dead.
2. **`workflow_run` failures land on no commit and no PR** the way `CI` does — nothing turns red
   anywhere a human normally looks. (Unfixed by design: this is how `workflow_run` works.)
3. **No notification of any kind.** A failed staging migration was indistinguishable from a quiet
   afternoon.

The terminal `deploy-outcome` job `needs` every prior job and runs `if: always()`, so it sees the
whole run's shape. Per run it does two things:

- **Says what happened.** A step summary and a `::notice::`/`::error::` annotation state plainly
  whether the run **deployed** something, **failed**, or **declined to deploy**, with a per-job
  result table — so a green run no longer requires opening four skipped jobs to learn it deployed
  nothing. `cancelled` and `timed_out` count as failures, not as benign.
- **Raises or clears one alert issue.** On failure it upserts a single tracking issue titled
  *"Deploy API is failing — pushes are not reaching the environment"* (`incident`, `area:ci`,
  `P1`, assigned to the owner): created if absent, reopened if closed, otherwise commented — never a fresh issue per
  failure, because alert spam is how alerting gets muted. A later **successful** deploy closes it
  as `completed`. So an open alert issue means "the deploy path is broken right now".

A **no-op run never closes an open alert** — skipping every job proves nothing about whether
deploys work, and no-op runs are the majority. `incident` is what keeps `/next` from claiming
the alert as backlog work (§0.2 treats that label as never-claimable).

### Two workflows, one script (#1674)

`deploy-alert.mjs` is **not** specific to `deploy-api.yml`. Since #1674 it also serves
`deploy-vercel-staging.yml`, which shipped in #1578 with no alerting at all. Which workflow a run is
reporting on is chosen by the **`ALERT_CONFIG`** env var, set explicitly in each workflow's
`deploy-outcome` step and resolved against the `ALERT_CONFIGS` table in the script. There is **no
default**: an absent or unknown value throws, because resolving to the wrong config would report one
workflow's job results into the other's alert issue — or reopen the live P1 Deploy API alert from an
unrelated failure.

Consequences worth knowing before editing the script:

- **Each config owns its alert title, and the two must never match.** The title is the lookup key, so
  a shared one would let a recovered Deploy API run close a live Vercel outage's alert. A test pins
  their uniqueness; renaming either orphans whatever alert is open under the old title, which can
  then never be found or self-closed.
- **`gateJob` may be null.** `deploy-vercel-staging.yml` has one job and no changed-path gate, so any
  code assuming a gate exists is wrong for that config.
- **A no-op means different things per config.** For Deploy API it is benign and the majority case.
  For a config with no path gate it is a defect — nothing ran that could have — so
  `noOpIsUnexpected` escalates it to a failure rather than an annotation, which on a `workflow_run`
  run page would be exactly as invisible as the gap this closes.

The full roster of GitHub-issue watchdogs, with what each one means and when it clears, is
[`ALERT_ROUTING.md`](../ops/ALERT_ROUTING.md) § Automated GitHub-issue alerts — that table is the
one home for the list; this section covers only the mechanics of this script.

Channel choice matches the sibling watchdogs: GitHub itself, via a dependency-free `.mjs` on
`GITHUB_TOKEN` with an injectable `fetch`. Both watched workflows are push-driven with no PR to
comment on, so an issue is the equivalent of their PR comment — no new service and no new token. In
each workflow the job holds the only write scope, job-scoped, leaving every other job on
`contents: read`. Like the other watchdogs it is best-effort and **exits 0 on every handled
outcome**: the underlying deploy job is already red, and a watchdog that reds the run creates the
noise it exists to remove. If the issues API is unreachable the summary and annotation still land.

The one deliberate exception is a **mis-wired** `ALERT_CONFIG`, which exits 1: that is not a handled
outcome but a configuration error, and it must be loud where it is introduced rather than degrading
into a watchdog that silently reports the wrong workflow.

## Schema drift detection (`scripts/ci/check-migration-drift.mjs`)

CI proves the code compiles and the tests pass. Until
[#833](https://github.com/pdcarlson/Frapp/issues/833) nothing verified that a **deployed database**
still matched `supabase/migrations/` — so a database could be dozens of migrations behind, or carry
migrations that exist nowhere in the repo, with every workflow green. Two modes, both observed for
real:

- **Behind.** `frapp-staging` held 2 rows in `schema_migrations` against 39 repo files (~5.5 months
  / 38 migrations). Public tables 29 vs 44, functions 1 vs 15, storage buckets 0 vs 7. Remediated
  2026-08-10. `frapp-prod` was measured in the same state on 2026-08-14 — 37 pending, remediation
  owned by [#832](https://github.com/pdcarlson/Frapp/issues/832).
- **Foreign.** The history carried `20260228000000_enable_rls_on_remaining_tables`, a version that
  has never existed in this repository (hand-applied in February). `supabase db push` refuses to
  run at all in that state, and the error's suggested fix (`migration repair --status reverted`) is
  destructive if applied without first reading what the row did — see
  [`../ops/DB_PROMOTION_RUNBOOK.md`](../ops/DB_PROMOTION_RUNBOOK.md), the **On-call note —
  reconciling a foreign migration row** paragraph — bold prose inside the `## 2026-08-10: Staging
  migration backlog cleared` entry, not a heading, so search the phrase rather than the headings.

**Why scheduled and not post-deploy.** `Deploy API` failed 44 of 44 executing runs for 71 days
(#763). A check that only ran after a successful deploy would have been silent for exactly the
period it was needed — a dead pipeline must not be able to hide drift. The schedule is what would
have caught February.

**Classification.** `pending` (repo, not applied) · `foreign` (applied, not in repo) · `matched`.
Foreign rows are never graced: a version the repo has never contained is wrong the moment it
appears. Pending rows are tolerated for `PENDING_GRACE_HOURS` (default 24) measured from the
migration's **own 14-digit version timestamp**, which is the only "when was this authored" signal
available without a git or API round-trip — so a migration merged minutes ago is not an alert, and
a back-dated one alerts immediately (deliberately conservative: this check may cry wolf, it may not
stay silent).

**Three verdicts, and the reason there are three.** `drift` raises the alert; `clean` closes it;
`unknown` — a target the Management API could not be read — does **neither**. An API blip must not
close a live alert (that is how a real outage gets silenced) and must not open one either (nothing
was observed to be drifting). `unknown` still exits non-zero, so a check that cannot run is a red
run rather than a quiet pass. Every scheduled watchdog in
`scripts/ci/` exits non-zero on a bad verdict, and for all but two of them green additionally means
"it was checked and it matched" — they *are* the check. The two that do **not** carry that second
meaning are `staging-conformance` and `production-auth-conformance`, which
exit 0 on an `inconclusive` run (nothing was asserted, so nothing was proved) and on
`unproven-recovery` (an open alert names an assertion this run could not evaluate, so it is neither
re-raised nor closed). Both say so in the step summary, and both deliberately leave the alert as
they found it — but their green is "no contradiction observed", not "verified". Read those two
that way. The annotate-only scripts (`deploy-alert`, `ci-wake`, `pr-base-sync`) only annotate a run
that is already red, and deliberately exit 0 so a watchdog never adds noise of its own.

**Read-only by construction.** It calls the Management API's migration-history endpoint
(`GET /v1/projects/{ref}/database/migrations` — the stable endpoint, not the Beta `database/query`
ones) and sends no SQL, so it cannot mutate a database even if its logic is wrong. It reports drift
and never repairs it; reconciliation is a human, E2-class action.

Project refs come from Infisical (`SUPABASE_PROJECT_REF`) here on purpose, even though
`.github/environments.json` commits them: `run-migration.mjs` fails closed when the two disagree,
so the divergence has to be observable from both sides (the workflow's own comment). That is why the
job injects twice and captures each ref before the second injection overwrites it. It runs in the
`automation` environment (above). The Infisical slug for production is **`prod`**, not
`production`. Like the deploy alert, the tracking issue carries `incident` so `/next` §0.2
never claims it as backlog work.

## Scheduled conformance (`scripts/ci/staging-conformance.mjs`)

Deploy visibility above fixes *"a push failed and nobody noticed."* This fixes the other half:
**nobody pushed, and the environment rotted anyway.** Until this workflow, every verification in the
repo was push-triggered, so a quiet week and a healthy week produced identical evidence. The four
incidents that motivated it ([#838](https://github.com/pdcarlson/Frapp/issues/838)) all share that
shape:

- `frapp-staging` sat **38 migrations / ~5.5 months** behind with every workflow green.
- The Infisical credential was invalid for **71+ days** (#696/#763).
- Both Vercel staging secret syncs were pointed at a git branch named `preview` that has never
  existed in this repository, and failed on that for months with nothing reporting it. Read
  [`SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md) §5 before drawing conclusions from
  that: it records "staging received nothing, so the breakage was accidentally protective" as a
  **misreading not to repeat** — `frapp-web` was read directly on 2026-08-12 and does hold the
  backend store — while also marking `frapp-landing` as *expected-but-unconfirmed*, since it was
  never inspected variable-by-variable. Neither "staging is empty" nor "both projects are
  confirmed full" is supported; confirm before relying on either.
- `custom_access_token_hook` was never enabled after #643 shipped, so `ChapterGuard` silently fell
  back to the client-supplied `x-chapter-id` header — the pre-#643 trust model (#805).

Runs daily at 07:30 UTC (`workflow_dispatch` for on-demand), asserting live
`frapp-staging`. Scope is **staging only** for Infisical syncs and the
sign-in probe. Production Auth hook, redirect allow list, `ACTIVE_HEALTHY`,
skip-until-on SMTP, and skip-until-SMTP-on Magic Link are a sibling,
`production-auth-conformance.yml`,
with its own alert title so a recovered staging cannot close a live production
incident. Remaining production-parity work on those dashboards moved from #1384 into #2505 (ADR-20, amendment of 2026-09-23).

**Scheduled workflows, one table.** Daily `schedule:` workflows are staggered so no two fire in the
same minute and a dump never races a Management API read of the project it is dumping. The
readiness probe (scheduled every 15 minutes) does not talk to the Management API, so it does not join that stagger:

| Time (UTC) | Workflow | Watches |
| --- | --- | --- |
| 06:15 | `production-backup-env.yml` | GitHub environment `production-backup` has no `required_reviewers` or `wait_timer`. Unreadable or missing is FAIL. `deployment_branch_policy` is ignored. Does not name `environment: production` or `environment: production-backup` |
| 06:30 | `db-backup.yml` | Offsite Postgres dump + Storage mirror; what it covers is [`DB_ROLLBACK_PLAYBOOK.md` § Backups: what exists](../ops/DB_ROLLBACK_PLAYBOOK.md#backups-what-exists) |
| 07:00 | `check-migration-drift.yml` | Applied migrations match `supabase/migrations/`, staging **and** production |
| 07:15 | `production-guardrails.yml` | Render auto-deploy off and tracking `main`, `healthCheckPath` `/health`, and neither Vercel project linked to Git |
| 07:30 | `staging-conformance.yml` | Project health, auth hook, redirect allow list, Auth SMTP (Resend + ≥300/hour), Magic Link template (`token_hash` on the app host), Render `healthCheckPath` `/health`, Render auto-deploy on tracking `main`, Infisical syncs, and a live sign-in probe against `frapp-staging` |
| 07:45 | `production-auth-conformance.yml` | Project health, auth hook, redirect allow list, Auth SMTP, and Magic Link template on `frapp-prod` (Site URL pinned to `https://app.frapp.live`). Empty SMTP is SKIPPED (hosted 2/hour cap); SMTP on requires `no-reply@mail.frapp.live` at ≥300/hour and a Magic Link href with `token_hash`. Does not name `environment: production` |
| 08:00 | `production-release-pin.yml` | Render live commit, Vercel production SHAs, and a peeled `vX.Y.Z` tag agree. Matching `main` is not required. `/health` `commit` is corroboration only. Does not name `environment: production` |
| 13:15 | `production-backup-freshness.yml` | Nightly `db-backup.yml` `backup-production` succeeded within 36h. Missing, failed, skipped, hung more than 3h, or unreadable Actions responses are FAIL. In-flight under 3h is pass (the job stays green; an open alert stays open). Does not name `environment: production` or `environment: production-backup`. Does not change the dump cron |
| 14:00 | `production-backup-storage-freshness.yml` | Nightly `db-backup.yml` `backup-production-storage` succeeded within 36h. Missing, failed, skipped, hung more than 3h, or unreadable Actions responses are FAIL. In-flight under 3h is pass (the job stays green; an open alert stays open). Does not name `environment: production` or `environment: production-backup`. Does not change the dump cron |
| every 15 min as scheduled; far less often in practice ([ADR-24](../../../spec/architecture/adr/adr-24.md) has the measured gaps) | `production-uptime.yml` | Live `GET https://api.frapp.live/health/ready` — HTTP 200 with JSON `status: "ok"`. Does not name `environment: production` |
| every 4 h at :23, and after every `Deploy API` / `Deploy production` run | `migration-snapshot.yml` | Watches nothing and raises no alert: it publishes both projects' applied-migration history for the PR migration gates (§ GitHub environments and bootstrap secrets). It reads the Management API, and a late start can overlap the 06:30 dump. A failed publish after a deploy shows up as red required migration checks naming it, on the next PR that touches a migration, once the download action's 15-minute wait runs out. `migration-drift` goes red on every PR, as `stale`, once a migration the snapshot lacks is past its 30-minute grace. A failed scheduled publish with no deploy since shows only when the snapshot passes the 24-hour limit ([#2588](https://github.com/pdcarlson/Frapp/issues/2588)) |

**Three outcomes, and the third is the point.** A check that cannot run must never look like a check
that passed:

| Outcome | Meaning | Effect |
| --- | --- | --- |
| `pass` | asserted against live staging, and it held | counts toward health |
| `fail` | asserted, and it did not hold | reds the run, raises the alert |
| `skipped` | could not assert (missing credential, or not yet built) | reported separately, **never** folded into the pass count |

Two rules follow from that, both about **not closing an alert on weak evidence**:

1. A run where *everything* skipped classifies as **`inconclusive`**, not healthy, and cannot close
   an open alert — a run that proved nothing is not evidence of recovery. Same rule the
   `deploy-alert` no-op draws, for the same reason.
2. Recovery is judged **per assertion, not by counting**. The alert body carries a visible
   `` `conformance-failing: <ids>` `` marker naming what it was raised for, refreshed on every
   raise, and the alert closes only when those exact assertions **PASS** again. Without this, an
   alert raised by `auth-hook` would close as "recovered" on a later run where `auth-hook` merely
   *skipped* — its credential deleted or renamed — and unrelated checks passed. Deleting a secret
   would resolve the alert. A run in that state reports **`unproven-recovery`**: green (nothing
   failed), but the alert stays open and the summary says why.

The marker is a visible backticked line rather than an HTML comment on purpose: #800 established
that HTML comments do not survive the GitHub MCP round-trip agents read issues through.

⚠️ **GitHub disables `schedule:` triggers after 60 days of repository inactivity**, emailing the
owner only. That ceiling is exactly backwards for the scheduled watchdogs — a long quiet stretch
silently turns off the things that watch quiet stretches. Every `schedule:` workflow in the table
above disables together. If the repo goes dormant, re-enable them from the Actions tab.

Two assertions ship degraded on purpose, each saying so in the step summary:

- **Migration parity is owned by `check-migration-drift.yml`, not by this workflow.**
  [#833](https://github.com/pdcarlson/Frapp/issues/833) was expected to land as a plain
  `npm run check:*` script this workflow would call. It landed as a **complete sibling
  watchdog** instead: its own daily schedule, its own alert issue, and coverage
  of production as well as staging. Calling its script from here would run the same comparison
  twice a day, let one real drift open two P1 alerts, and — because that script upserts and
  closes its own alert as a side effect — have this workflow mutating another watchdog's
  incident state. So the row is reported, not run: it shows as SKIPPED with a pointer, which
  asserts nothing and cannot close this workflow's alert. Deleting the row instead would have
  been worse; the table is meant to be a complete inventory of what is watched.
- **End-to-end sign-in** — the only row that exercises behaviour rather than configuration, covering
  migration, grants, RLS, and hook resolution in one probe — needs `STAGING_SMOKE_USER_EMAIL` /
  `STAGING_SMOKE_USER_PASSWORD`, which are not provisioned (#893). A fully unconfigured local run
  (no URL, no anon key, no smoke user) is still SKIPPED. **A half-set `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` pair, or a smoke user with neither, is FAIL** (#1767): Infisical injects both
  on the scheduled job, and SKIPPED after the anon key was blanked would keep 07:30 green. **The
  smoke user must have exactly one chapter membership:** a correctly-working hook returns a token
  with *no* claim when the user resolves to no chapter, so a zero-membership user is
  indistinguishable from a disabled hook. The check resolves that ambiguity in the safe direction
  — a claimless token is reported as **FAIL** naming both possible causes, never as a pass — so
  provisioning a zero-membership user produces a red run and a P1 blaming the hook on a healthy
  environment. Give it exactly one.

The Infisical injection step runs with `continue-on-error: true`, which is load-bearing rather than
lax: a revoked machine identity is the single most likely drift class, and failing the job at that
step would kill the run *before* the script could report it and raise the alert — a red run with no
issue, for the exact incident this workflow was built for.

Note what a green Infisical row does and does not mean. Its classification is three-way and closed
at both ends: any sync reporting `failed` is a FAIL; **every** sync reporting `succeeded` is a PASS;
anything else is SKIPPED. Infisical's status enum is `pending | running | succeeded | failed` plus
null before a sync has ever run — read from the open-source backend, **not observed against the live
API**, which is precisely why an unrecognised status skips rather than passes. The middle case cuts
both ways: calling "not succeeded" broken would open a P1 for a sync caught mid-window, while
calling it green would hide a sync wedged in `pending` because its destination token was revoked —
the #834 signature going undetected. A skip asserts nothing, reds nothing, and cannot close an open
alert, which is the honest answer to "we do not know yet."

Even a PASS does **not** assert the destinations hold the right values;
[`SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md) records the hard-won rule that "a
sync that reports Failed today tells you nothing about what it delivered before it broke — check the
destination, not the sync status." An unrecognised Infisical response shape **fails closed**, because
reading an unparseable response as "no failing syncs" would rebuild the silent green.

The alert issue is titled *"Staging conformance is failing — frapp-staging has drifted"*
(`incident`, `area:ci`, `P1`) and follows the same upsert contract as the deploy alert: created
if absent, reopened if closed, otherwise commented, and closed on the next clean run. It shares
`scripts/ci/lib/alert-issue.mjs` with the deploy alert and every other watchdog.
(`check-migration-drift.mjs` carried its own copy of that upsert logic until
[#909](https://github.com/pdcarlson/Frapp/issues/909) moved it onto the lib.) Unlike the deploy watchdog this script **is** the check,
so a confirmed drift exits non-zero and reds the run.

## Applied permission allows

Originally applied by a human paste in PR #667 (2026-08-07): at the time, the Claude Code
auto-mode classifier was observed to hard-block an agent editing `.claude/settings.json`
(2026-08-06/07; later sessions' edits went through, so treat that behavior as build-dependent, not
settled). Self-granting permissions is a boundary user intent does not clear — permission-prompt
fatigue is fixed by a human merging the allowlist, never by the agent mid-session. What the list
carries and why:

> **The ceiling rule (working hypothesis) — check this before writing any permission fix.**
> `.claude/settings.json` `permissions.allow` appears to operate only *within* the cloud harness's
> `--allowed-tools` launch snapshot: an allow entry for a tool the harness did not launch with looks
> inert, making the harness grant a ceiling rather than a floor. **Check the snapshot before
> theorising** — one command, any session:
>
> ```sh
> tr '\0' '\n' < /proc/<claude-pid>/cmdline | grep -A1 '^--allowed-tools$' | tail -1 | tr ',' '\n'
> ```
>
> **Status: strongly supported, not proven — and deliberately labelled that way.** Supporting
> evidence (2026-08-08): `mcp__Claude_Code_Remote__send_later` is absent from the snapshot, was
> allowlisted under three spellings, and still prompts (owner-observed); every `mcp__github__*` call
> is covered by the snapshot's wildcard and ran prompt-free across a whole `/next` run
> (owner-observed). It is also retrodictive — it would explain all three failed Linear attempts
> (#667, #669, #676), whose common feature was adding allow entries for tools the snapshot omitted.
>
> **What it does not establish.** Two data points, one absent tool. The older theory — that these
> tools are independently flagged as requiring live user interaction — predicts the same
> observations and is **not excluded**. The clean falsifier: a tool that *is* in the snapshot,
> *is* allowlisted, and still prompts. If you meet one, this rule is wrong; say so here rather than
> hunting a harness bug. Either way the operational advice is unchanged and is the part that
> matters: **when a tool is absent from the snapshot, do not spend a PR on a settings fix** — that
> is the loop that cost #667, #669 and #676. The snapshot observation was already recorded below in
> the Linear post-mortem; no general rule was drawn from it, which is how three PRs were spent
> guessing. See [#744](https://github.com/pdcarlson/Frapp/issues/744).

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
  `list_branches`, `get_file_contents`, `issue_read`, `list_issues`, `search_issues`, `get_label`,
  `list_issue_types`, `list_issue_fields` (each as `mcp__github__<tool>`).
- GitHub MCP tracker writes (added 2026-08-08 with the GitHub Issues migration, at the owner's
  request that agents "interact freely with GitHub issues"): `issue_write`, `sub_issue_write`.
  GitHub Issues is now the work tracker, so these are the same class of write Linear's `save_issue`
  was — on cloud sandboxes the harness `mcp__github__*` wildcard already covers them; these
  entries extend the grant to surfaces that honor project `permissions.allow`. Whether any given
  surface actually stops prompting is, as always, owner-observable only.
- GitHub MCP writes the babysit loop needs: `actions_run_trigger` (re-run infra-failed CI),
  `add_issue_comment`, `add_reply_to_pull_request_comment`, `resolve_review_thread`,
  `create_pull_request`, `update_pull_request`, `update_pull_request_branch`.
- **The `Claude_Code_Remote` trigger entries were removed from `permissions.allow`.** Twenty-one
  spellings (`send_later` / `create_trigger` / `update_trigger` / `delete_trigger` /
  `list_triggers` / `subscribe_pr_activity` / `unsubscribe_pr_activity` × server name, kebab-case,
  connector UUID) were inert on the cloud surface — `send_later` still prompted through all three
  (2026-08-08); the ceiling rule above is the likely why. They were misread as permission, so they
  came out. Do not re-add them to "allowlist" a tool the harness snapshot does not grant.
  `subscribe_pr_activity` that actually works is the **GitHub MCP** spelling, which stays listed.
  If the harness ever adds the trigger family to `--allowed-tools`, that is a new ADR, not a
  reason to restore dead allow-lines.
- Deliberately **excluded from the project allows**: `merge_pull_request`, `enable_pr_auto_merge`,
  `push_files`, `create_or_update_file`, `delete_file` — merging and direct repo-content writes
  are not repo-sanctioned, per the PAT policy above. **Know the limit of that exclusion:** on
  cloud sandboxes the harness's own `--allowed-tools` carries the `mcp__github__*` wildcard
  (agent-observed, 2026-08-08), which by its shape covers these five tools too — so on that
  surface the human merge gate is **policy, not an enforced prompt**. No one has verified whether
  these five prompt anywhere (only the owner can observe prompts). Agents must treat the
  exclusion as a standing instruction — never call them without explicit human direction —
  rather than trusting a prompt to stop the call.
- Permission allow-lines are exact string matches. An unmatched spelling is silently inert.
  Adding a spelling is only worth doing for a tool the harness `--allowed-tools` snapshot
  actually carries (the ceiling rule). The trigger family is absent from that snapshot, so
  no spelling of `send_later` belongs in `permissions.allow`.

Also verified: an "always allow" click in one session/surface does not propagate to fresh cloud
containers — only rules committed to `.claude/settings.json` travel with the repo, and even those
are bounded by the ceiling rule above.

The in-session trigger family (`send_later` / `create_trigger` / `list_triggers` …) is a
**dead end for unattended use on the cloud surface — do not build an unattended flow on it.** In a
session the owner was attending (2026-09-22), `list_triggers`, `create_trigger` and `update_trigger`
worked within the limits below; the rest of the family wasn't tried. See [`ROUTINES.md`](ROUTINES.md). Not an account-side
Routines gate (disproven 2026-08-08: the owner's Routines page was healthy and scheduled Routines
fired normally) and not a permissions-file miss (three spellings were allowlisted, and the family is
absent from the harness `--allowed-tools` snapshot — see the ceiling rule above).

**Symptoms differ per tool; record what you actually saw.** `send_later`, 2026-08-08: prompted the
owner, and **on approval succeeded**, returning a live trigger id — so for this tool the earlier
"`-32003` dead-end" and "approval is converted to a denial" descriptions no longer hold. That is
still disqualifying for unattended runs, but for a different reason: it stops and waits for a human.
`list_triggers`, `create_trigger` and `update_trigger`, 2026-09-22, in a session the owner was
attending: all three worked, so the earlier `-32003` reports no longer hold for them. `create_trigger`
created Docs Upkeep with no repository and no connectors attached, and `update_trigger` refuses a
Routine created in the UI ("Agents can only update routines they created"). Whether any of them
prompted the owner wasn't recorded; an agent can't observe prompts. None of this makes the family
usable for unattended runs.

## Agent dev stack (cloud sessions)

Decision is recorded in [**ADR-12**](../../../spec/architecture/adr/adr-12.md) (extending [ADR-11](../../../spec/architecture/adr/adr-11.md)): PGlite-backed NestJS tests are the **default substrate** (Paths C+D), a per-session Supabase branch is the **opt-in escape hatch** (Path A), and a rootless in-sandbox stack (Path B) is rejected. Track program-level state in **GitHub Issues** (the agent-infrastructure epic and its sub-issues). This section is the operating doc — what's in the stack today, how to bring it up, what's still blocked.

### What the stack is

Two layers, both runnable from a sandbox with no Docker and no privileged tooling:

1. **Hot-path code is testable in NestJS.** Per ADR-11, chat hot-path writes (`chat-send`, `chat-react`) live in the existing `apps/api` NestJS service alongside cold reads and the in-process push worker (ADR-09). Standard Jest + supertest covers integration; the `SupabaseAuthGuard` the push worker already uses is reused for auth. (It also said `SUPABASE_CLIENT` was reused "for Realtime emit" — as of #472 `ChatService` injects no Supabase client and emits nothing to Realtime, so the chat hot path needs no Realtime-capable substrate to test. The provider itself is unaffected and still injected at 59 sites — 37 repositories under `infrastructure/supabase/`, the rest spread across application services, interface guards, and the two realtime workers. What changed is only that the chat *send* path is no longer one of them.) Since #416 shipped, `supabase/functions/chat-*` is retired and chat-adjacent chunks no longer carry the "Runtime checks BLOCKED" disclaimer.
2. **Migration validation + RLS smoke run on PGlite.** `scripts/check-pglite-migrations.mjs` applies every `supabase/migrations/*.sql` to a fresh in-process Postgres-in-WASM and asserts the schema landmarks reviewers care about, plus an **RLS smoke tier** (ADR-12): every `public` table enables RLS (Frapp's default-deny invariant, #360), the chat hot-path tables hold their posture (`chat_channels` default-deny with no policies; `chat_messages` and `chat_message_actions` carry only client-read policies that stay scoped to `auth.uid()` — "no policies" stopped being the invariant for `chat_messages` when `20260816140000_realtime_carrier_repair.sql` gave it one), and `chapter_audit_log` stays append-only. It also verifies policy **enforcement** (#423): a non-owner `rls_probe` role, with `auth.uid()`/`auth.role()` stubbed to a signed-in client, reads the tables for real — asserting exact visibility sets on `chat_messages` / `chat_message_actions`, and zero rows on `members` / `financial_invoices`, which carry no client-reachable policy and must stay default-deny. Posture alone cannot catch a policy whose shape is fine but whose predicate is wrong; the enforcement tier can — for those four tables only, so a permissive policy on any other table still slips past. The harness creates the **`authenticated` role before applying migrations**, which matters more than it sounds: ~18 migrations wrap their policy and grant statements in `if exists (select 1 from pg_roles where rolname = 'authenticated')`, and without the role every one of those blocks is skipped, so a permissive policy written in the repo's own dominant idiom left the whole job green. What remains out of reach: a **real JWT** (GoTrue-minted, so any claim beyond `sub`/`role`), and **`to anon` targeting** — there is no `anon` role here, though `auth.role()` is stubbed to `'anon'` for the unauthenticated scenarios so predicates that test it are exercised. Both stay with the NestJS Jest tier. Always-on, runs in CI as `pglite-migrations`, and runs identically from any cloud-agent sandbox. No real DB required.

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
4. Write `SUPABASE_URL` / `SUPABASE_ANON_KEY` / a scoped, short-lived service-role JWT to `apps/*/.env.local`. Never commit — it is gitignored (`.gitignore` + `apps/web/.gitignore`), and the backstop is the pre-commit **gitleaks** scan (`.githooks/pre-commit` → `scripts/scan-secrets.mjs`, default ruleset per `.gitleaks.toml`), whose `jwt` rule has fired on real JWT material in this repo's history ([`SECRET_SCANNING.md`](SECRET_SCANNING.md)). There is no `*.supabase.co` rule — a project URL is not secret material, so do not rely on one catching a pasted config.
5. SessionEnd hook calls `delete_branch` (idempotent) and confirms via `list_branches`.

This hook does not exist yet — the SessionEnd teardown + scoped MCP write allowlist are tracked as **#532**. Until it lands, the MCP write tools stay un-allowlisted in `.claude/settings.json` (they prompt, so headless sessions can't use them) and the branch path is unavailable; do not work around it in a chunk PR. (Note: post-#416 there are no Edge Functions in this repo, so `deploy_edge_function` is not part of the bring-up.)

### "Runtime checks BLOCKED" protocol

The disclaimer ADR-11 was written against (chat-adjacent chunks gated on a live Supabase Edge Functions runtime) **retired with #416**. The hot path is now NestJS code that runs in the same Jest tier as the rest of the API, and migrations validate via PGlite — both run in any sandbox.

**If** the environment's network allowlist carries the **live staging egress** lines, the remaining reach is narrower than this section assumes: live Realtime / Presence and RLS-as-enforced-by-GoTrue can be exercised against hosted `frapp-staging` from a sandbox, provided the environment carries those lines *and* a staging smoke credential is available — which today it is not, per the open human-action ask in #893, so budget an authenticated check as blocked until that lands. Check `.cloud-sandbox-capabilities.json` first (written by `scripts/cloud-sandbox-egress-probe.sh` in the first seconds of bringup — always written, with `probe_ok: false` when it could not run) rather than probing by hand — and read [`.claude/skills/live-verification/SKILL.md`](../../../.claude/skills/live-verification/SKILL.md) before touching the deployed environment. Push fanout is not one case but two: **APNS is unreachable** (`api.push.apple.com` fails the policy check; no Apple host is proposed for the allowlist), while **`fcm.googleapis.com` is already reachable** through the default Trusted entry `*.googleapis.com`. Reachable transport is not a runnable test — delivery still needs service-account credentials and a real device token — so end-to-end push stays blocked, but do not report FCM as network-blocked when it is not.

If a chunk crosses a boundary the sandbox still can't reach (push fanout; anything needing production; anything needing Realtime/GoTrue where the egress or the credential is in fact absent):

- **Do not check the verification box.** Mark it blocked.
- File or link a tracking issue (`#401` is the agent infra parent; #235 closed-as-subsumed by ADR-11 and should not be reopened — file a fresh issue scoped to the new gap).
- In the chunk PR body, list each blocked step + the linked issue + which class of verification is missing.
- Record the same on the tracking issue — work status lives in **GitHub Issues**, not in a
  status doc ([`../DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md) § Where a fact
  lives — "work status is not a doc"; [`GITHUB_PM.md`](GITHUB_PM.md)).

### Sandbox-blocked tooling — known list

- **Docker / `supabase start` / `supabase db reset`:** the daemon is not started by default. In a **Claude Code web** sandbox configured per [`CLOUD_SANDBOX.md`](../environment/CLOUD_SANDBOX.md) (SessionStart → `scripts/cloud-sandbox-up.sh`; Full/Custom network), that script brings up Docker + local Supabase and writes `apps/api/.env.local` plus `apps/web/.env.local`, so the full stack and `npm run start:dev -w apps/api` work with no Infisical, and `npm run build -w apps/web` prerenders instead of dying on the missing `NEXT_PUBLIC_SUPABASE_*` vars (#1156). Where that wiring is absent (unconfigured env, plain CI), there is still no daemon: use the PGlite harness for migration validation.
- **Supabase MCP write tools (`create_branch`, `apply_migration`, `delete_branch`) and most read tools (`list_branches`, `get_project`, `get_cost`):** not granted by `.claude/settings.json` (its allow rules cover only the Workflow tool and the claude-code-remote scheduling and PR-watch tools — no Supabase entries), so they prompt — and unattended sandboxes cannot approve the prompt. `list_projects` has been observed to go through. Do not assume any MCP tool works until you've tried it.
- **Outbound HTTP to arbitrary hosts:** governed by the sandbox's network policy. Through the agent proxy the failure shape is `curl: (56) CONNECT tunnel failed, response 403`; `curl -sS "$HTTPS_PROXY/__agentproxy/status"` names the refused host under `recentRelayFailures`. Note `supabase start` pulls images from **AWS ECR Public** (`public.ecr.aws`) + **CloudFront** (`*.cloudfront.net`), which the **Trusted** policy does not reliably allow — add those hosts to a Custom allowlist. **Deployed staging** (`staging.frapp.live`, `*.staging.frapp.live`, `api-staging.frapp.live`, and the `frapp-staging` Supabase ref) is reachable *if and only if* the environment carries those lines. **Do not probe by hand and do not assume — read `.cloud-sandbox-capabilities.json`,** which `scripts/cloud-sandbox-egress-probe.sh` writes at the repo root within seconds of bringup starting, long before its `.done` sentinel. The SessionStart hook summarises it too, but only on a fire that finds it already written — never on a fresh container's first session, nor on any fire that starts a bringup — so read the file rather than waiting for the line. Check its `probe_ok` first: `false` means the probe could not run, and the empty `hosts`/`staging_reachable` arrays that come with it are **not** evidence that staging is blocked (nor that the production assertion passed). With `probe_ok: true`, its `warnings` array distinguishes *blocked* from *inconclusive*, which a hand-rolled `curl` will not. See [Live staging egress](../environment/CLOUD_SANDBOX.md#live-staging-egress) and [`.claude/skills/live-verification/SKILL.md`](../../../.claude/skills/live-verification/SKILL.md). **Production is never allowlisted** — the probe asserts that negatively, and a reachable prod host is reported as a SECURITY warning rather than as extra capability. Provider APIs (Render, Vercel, Sentry, PostHog) stay blocked to direct `fetch` and are reached via **MCP**, which bypasses the allowlist entirely; **Infisical is the only sanctioned exception** — it has no secrets-capable MCP connector and is reached by direct `fetch` via `app.infisical.com` on the environment allowlist ([#1279](https://github.com/pdcarlson/Frapp/issues/1279); canonical statement: [CLOUD_SANDBOX.md § What this does not unlock](../environment/CLOUD_SANDBOX.md#what-this-does-not-unlock)).
- **System packages requiring `apt-get` / root:** unavailable. The PGlite WASM bundle is npm-installable and needs none.

When you hit a new block, add it here in the same PR you discovered it in.
