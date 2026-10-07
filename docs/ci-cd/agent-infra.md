# Agent infrastructure and CI reference

Operational detail for AI agents and maintainers working on deploys, CI, secrets, and provider APIs. Day-to-day local setup lives in [`LOCAL_DEV.md`](../internal/environment/LOCAL_DEV.md).

## Research-first workflow

When relevant credentials exist in the environment, prefer gathering **runtime truth** (CI, deploy health, schema, secret presence) via provider APIs/CLIs before changing code or docs.

1. Gather state from providers (GitHub, Supabase, Vercel, Render, Infisical as applicable).
2. Use those checks when validating infra or release-impacting work.
3. Align proposals to observed reality; avoid stale assumptions.
4. **Never print secret values** — only names and presence/absence.

**CLI recipes** (GitHub `gh`, Supabase, curl examples for Render/Vercel/Infisical): see [`.claude/skills/infrastructure-research/SKILL.md`](../../.claude/skills/infrastructure-research/SKILL.md).

## Optional environment credentials

Provider/research credentials and cloud-sandbox runtime vars that may appear in cloud agent / automation sessions are listed canonically in [`../internal/environment/AGENT_CREDENTIALS.md`](../internal/environment/AGENT_CREDENTIALS.md) (including the canonical-name/alias discussion). Local development omits most of them; use Infisical login for app secrets instead. The GitHub PAT usage policy below stays here.

## GitHub PAT usage policy

The agent **may** use `GITHUB_PAT` for: creating/closing agent-owned PRs, labels, issues, the branch protection script in read-only mode — from an agent session that means `npm run configure:branch-protection:verify`, that exact command and nothing else (**Branch protection script** below names the two spellings that silently *apply* instead) — reading GitHub environments/protection rules, reading PR/CI/branch state. *Applying* branch protection or environment protection rules is a human step with an admin PAT — by policy, not for lack of capability; the canonical statement is in [`../ops/github-branch-protection-runbook.md`](../ops/github-branch-protection-runbook.md).

The agent **must not** use it to: merge without explicit approval, delete branches without approval, broaden repo settings — branch protection and environment protection rules included, since applying those is a human step (see above) — create/modify GitHub Secrets, force-push, or create releases/tags outside the automated release workflow.

Which variable holds the PAT, and exporting it as `GH_TOKEN` for `gh`/git: [`AGENTS.md` § Credentials and secrets](../../AGENTS.md#credentials-and-secrets). How the branch-protection script reads it: [`github-branch-protection-runbook.md`](../ops/github-branch-protection-runbook.md). Work tracking itself, including why the GitHub MCP and not the PAT is the tracker path in a cloud sandbox: [`github-pm.md`](github-pm.md).

### The `api.github.com` route rule

**Measured 2026-09-02.** Reachability of `api.github.com` from a
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
| CI                  | `.github/workflows/ci.yml` — parallel jobs. Per-job suite lists are **not restated here**: they live in [`github-branch-protection-runbook.md`](../ops/github-branch-protection-runbook.md) § Required Status Checks. Nothing asserts that copy any more — the docs gate that compared it against `ci.yml` was deleted along with the rest of them — so read `ci.yml` itself whenever the two could disagree. This copy was unasserted and had already lost `@repo/theme` — the same package whose disappearance (#1153) the gate exists to catch |
| Composite actions   | `.github/actions/<name>/action.yml` — shared step sequences called as `uses: ./.github/actions/<name>`. Requires an `actions/checkout` earlier in the job. The inventory, what each action owns, and the rules enforced over them all live in [`.github/actions/README.md`](../../.github/actions/README.md) — that directory's own README is the one home, and none of it is restated here. Two things an agent should know before opening it: every rule there is enforced by a test (`scripts/ci/__tests__/turbo-packages-build-action.test.mjs`, `…/infisical-secrets-action.test.mjs`, `…/node-setup-action.test.mjs`, `…/workflow-secrets-scope.test.mjs`), so a hand-written copy of anything an action owns fails `npm run test:ci-scripts` rather than review; and a local `uses: ./…` resolves from the runner **workspace at step-execution time**, which constrains both where in a job it may appear and which `dorny/paths-filter` lists must include `.github/actions/**`. The README gives the exact rules and why each exists. |
| Staging deploy | `.github/workflows/deploy-staging.yml` (**Deploy staging**) — after CI (`workflow_run`) on `main`. It calls the shared `deploy` job in `.github/workflows/_deploy.yml` (#2804) with `environment: staging`, which ships the migrations, Edge Functions, API, web and landing in the order [`ci-cd.md` § How Deployments Are Gated](../ops/deployment/ci-cd.md#how-deployments-are-gated) gives. Replaced `deploy-api.yml` (staging only since #1340) and `deploy-vercel-staging.yml` in #2803. |
| Production deploy   | `.github/workflows/deploy-production.yml` — `workflow_dispatch` ONLY, takes a `sha`. Validates the commit is an ancestor of `main` with green CI (`scripts/ci/validate-deploy-sha.mjs`) — the required-check roster intersected with the jobs that commit's own workflows define, so a check it predates reads *not applicable* instead of making an older commit undeployable (see the **Deploying an OLDER commit** callout in `docs/ops/db-rollback-playbook.md`) — then runs the production layers of the shared deploy job, in the order [`ci-cd.md` § How Deployments Are Gated](../ops/deployment/ci-cd.md#how-deployments-are-gated) gives (preflight, migration rehearsal, builds before anything is applied, then the apply and the ships), and calls `release.yml`. SHA confirmation/trim/validate run in an unscoped `validate` job so a bad paste cannot consume the reviewer gate (run 34234768094). The shipping path (`deploy`) is still one job under `environment: production`, so one approval click: since #2805 it is `_deploy.yml`'s job, the one staging calls, with production's layers switched on by the input, and it verifies the served commit (`verify-served-commit.mjs`) where it used to curl `/health/ready` for any 2xx. A failed ship opens the P1 *Deploy production failed* alert. A `scope: migrations-only` input applies the migrations and stops — no Render deploy, no Vercel build, no tag — which is what the deleted `Migrate production` workflow used to do, minus that workflow's habit of skipping every gate in this sentence. A `mobile_build` input (default `none`) then builds the shipped commit for the stores after a `full` ship and its tag, through `_mobile-build.yml` in the `automation` environment ([`mobile.md` § 6.6](../ops/deployment/mobile.md#66-store-submission), #3111). |
| Production guardrails | `.github/workflows/production-guardrails.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`, and re-run as a preflight inside the production deploy. Asserts Render `frapp-api-prod` has auto-deploy **off** and tracks `main`, that `serviceDetails.healthCheckPath` is `/health` (empty is a TCP socket check on the open port; `/health/ready` would cancel a deploy when a dependency is degraded), and that neither Vercel project is **linked to Git**. The auto-deploy and Vercel-link settings fail OPEN, so they can only be asserted, never enforced. The Vercel half was **inverted on 2026-09-02** ([#1579](https://github.com/pdcarlson/Frapp/issues/1579)): it used to assert that neither project's Production Branch was `main`, which ADR-21's unlink turned into a permanent self-inflicted failure — with `link: null` the branch is absent, and absent was coded as a violation, so the daily run AND the production-deploy preflight both failed. It now asserts the condition that actually keeps production safe post-ADR-21, that no Git link exists; a *present* link is the violation. Inverted rather than deleted, because staying unlinked is unversioned dashboard state a single click could undo. Because absent now means pass, the script first checks the response really is a project (`looksLikeVercelProject`) so an error envelope cannot read as "unlinked, therefore green". The Render auto-deploy assertion is unaffected by that inversion. See the Vercel note under this table. Logic in `scripts/ci/production-guardrails.mjs`. **Not** a required check. |
| Production uptime | `.github/workflows/production-uptime.yml` — **scheduled** every 15 minutes, though it runs [far less often](../../spec/architecture/adr/adr-24.md) + `workflow_dispatch`. GETs `https://api.frapp.live/health/ready` (never `/health` — [why](../../spec/behavior/observability.md#health-check)). Raises one `incident` alert on failure and closes it on recovery. Does **not** name `environment: production` — a `schedule:` job that did would suspend on the required-reviewer gate ([#1435](https://github.com/pdcarlson/Frapp/issues/1435)). Not a substitute for a Sentry 60 s monitor, which #2505 plans and the owner creates (quota; the script header says agent sessions don't). Logic in `scripts/ci/production-uptime.mjs`. **Not** a required check. |
| Production release pin | `.github/workflows/production-release-pin.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. Asserts Render `frapp-api-prod`'s live deploy commit, Vercel `frapp-web` and `frapp-landing` READY production `githubCommitSha`, and at least one peeled `vX.Y.Z` tag all name the same SHA. Matching `main` is not required — live is allowed to lag until the next Deploy. An unreadable matching-refs list or annotated-tag peel is FAIL, not a missing tag. `/health` `commit` is corroboration only (absent is ignored; the GET is timed out so a stall cannot hold the job). Does **not** name `environment: production` ([#1435](https://github.com/pdcarlson/Frapp/issues/1435)). Logic in `scripts/ci/production-release-pin.mjs`. **Not** a required check. |
| Production backup environment | `.github/workflows/production-backup-env.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. GETs GitHub environment `production-backup` and fails if `protection_rules` contains `required_reviewers` or `wait_timer`. Unreadable or missing is FAIL. `deployment_branch_policy` is not checked: the `main`-only rule is [#2583](https://github.com/pdcarlson/Frapp/issues/2583)'s (set 2026-09-23), and watching it is [#2585](https://github.com/pdcarlson/Frapp/issues/2585). Does **not** name `environment: production` or `environment: production-backup` (#1435): a schedule job that named the env it watches would hang on the same trap. Never PUTs the environment. Logic in `scripts/ci/production-backup-env.mjs`. **Not** a required check. |
| Production backup freshness | `.github/workflows/production-backup-freshness.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. GETs recent `db-backup.yml` runs on `main` and judges `backup-production` by [`backup-job-freshness.mjs`](../../scripts/ci/lib/backup-job-freshness.mjs); when it fails is the alert's row in [`alert-routing.md`](../ops/alert-routing.md). Unreadable Actions responses are FAIL. Does **not** name `environment: production` or `environment: production-backup` (#1435). Never PUTs. Reads with `GITHUB_TOKEN`. The script retries with `GITHUB_PAT` on 401/403 only when one is in its environment, which means a local run: the workflow passes none, because a PAT there could only be a repository secret (#2518). The hosted restore leftover stays on its own issue (1861); the reviewer watch stays on its own issue (1956). Logic in `scripts/ci/production-backup-freshness.mjs` with `BACKUP_WATCH=dump`, the script both freshness watches share. **Not** a required check. |
| Production backup storage freshness | `.github/workflows/production-backup-storage-freshness.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. GETs recent `db-backup.yml` runs on `main` and judges `backup-production-storage` by [`backup-job-freshness.mjs`](../../scripts/ci/lib/backup-job-freshness.mjs); when it fails is the alert's row in [`alert-routing.md`](../ops/alert-routing.md). Unreadable Actions responses are FAIL. Does **not** name `environment: production` or `environment: production-backup` (#1435). Never PUTs. Reads with `GITHUB_TOKEN`. The script retries with `GITHUB_PAT` on 401/403 only when one is in its environment, which means a local run: the workflow passes none, because a PAT there could only be a repository secret (#2518). The Postgres dump watch stays on its own issue (1963); the hosted restore leftover stays on its own issue (1861). Logic in `scripts/ci/production-backup-freshness.mjs` with `BACKUP_WATCH=storage`, the script both freshness watches share. **Not** a required check. |
| Supabase quota watch | `.github/workflows/supabase-quota.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`, whose `threshold_percent` input can only lower the alert's threshold (0 files the alert on purpose, to test the page). Reads each project's disk utilization and the sum of its `storage.objects` sizes through the Management API, with that project's read-only token, and raises one `incident` alert when the disk quota (per project) or the Storage quota (across the organization) is nearly used, or when a figure can't be read. When it fires and clears is the alert's row in [`alert-routing.md`](../ops/alert-routing.md); why these two and not egress or Realtime is [`supabase.md` § Plan and quotas](../ops/deployment/supabase.md#plan-and-quotas). Names the `automation` environment. Logic in `scripts/ci/supabase-quota.mjs`. **Not** a required check. |
| Routine heartbeat | `.github/workflows/routine-heartbeat.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. The five routines ([`routines.md`](routines.md)) are Claude Code Routines, whose run status nothing here can read, and which reports a session that stopped before its job as succeeded ([#2358](https://github.com/pdcarlson/Frapp/issues/2358)). Each run therefore ends by commenting a run record on the heartbeat issue ([`routines.md` § Run record](routines.md#run-record-all-routines)). This GETs those comments and, for each routine's latest scheduled fire, fails on no record or a `stopped` one; when it fails is the alert's row in [`alert-routing.md`](../ops/alert-routing.md). It judges no fire older than its own first run on `main`, read from its runs, so nothing is judged before the skills that write records merged. Unreadable comments or runs are FAIL. Only the owner's comments count. Reads and alerts with `GITHUB_TOKEN`; names no environment. Logic in `scripts/ci/routine-heartbeat.mjs` (tests: `scripts/ci/__tests__/routine-heartbeat.test.mjs`). **Not** a required check. |
| Deploy outcome      | Terminal `deploy-outcome` job in each workflow `scripts/ci/deploy-alert.mjs` has a config for (its `ALERT_CONFIGS` table; the alerts they raise are listed in [`alert-routing.md`](../ops/alert-routing.md#automated-github-issue-alerts)). In each it's the only job with a write scope (job-scoped `issues: write`; the workflow-level grant stays `contents: read`). Writes a step summary + annotation saying what the run did; the outcomes are listed in [§ Deploy visibility](#deploy-visibility-scriptscideploy-alertmjs). Upserts one `incident` alert issue on failure, and closes it on the next successful deploy. After a successful deploy it also raises or closes the `P2` source-map alerts (`sentry-sourcemaps-alert.mjs`, [#2489](https://github.com/pdcarlson/Frapp/issues/2489)). The config is selected per workflow by the required `ALERT_CONFIG` env var (tests: `scripts/ci/__tests__/deploy-alert.test.mjs`; `grep -l ALERT_CONFIG scripts/ci/__tests__` finds the ones that pin each workflow's wiring). **Not** a required check. See "Deploy visibility" below. |
| Deploy verification | Each deploy verifies itself, inline, by the id of the deploy it created: `deploy-staging.yml` (staging: `scripts/ci/plan-staging-deploy.mjs` decides from the commit staging serves, `scripts/ci/deploy-render-production.mjs` polls the Render deploy to `live`, then `scripts/ci/verify-served-commit.mjs` polls `/health/ready` until it answers 2xx **and** reports the planned commit) and `deploy-production.yml` (production, through the same `_deploy.yml` job since #2805, with the same Render script and served-commit check). In both, `scripts/ci/smoke-deployed-api.mjs` then asks the API what its clients ask (CORS for each dashboard origin, the minimum app version, the attachment-copy function accepting the API's key) before any frontend uploads ([#3113](https://github.com/pdcarlson/Frapp/issues/3113); [`ci-cd.md` § Deploy verification](../ops/deployment/ci-cd.md#deploy-verification)). A Render or Vercel deploy that ends `canceled` or superseded is a failure on both. There is no push-triggered observer any more. `verify-deployments.yml` was one: its two Vercel jobs were **removed on 2026-09-02** ([#1579](https://github.com/pdcarlson/Frapp/issues/1579)), since ADR-21's unlink meant no push produced a Vercel deployment to find, and its Render job was **retired on 2026-09-25** ([#2505](https://github.com/pdcarlson/Frapp/issues/2505)), when `deploy-api.yml` began deploying staging by commit and staging's auto-deploy became something to turn off ([#2679](https://github.com/pdcarlson/Frapp/issues/2679)). `verify-vercel-deploy.mjs`, the observer's script, sat unrun after that until **2026-09-30** ([#1778](https://github.com/pdcarlson/Frapp/issues/1778)): the terminal-state sets `deploy-vercel.mjs` imported from it moved to `scripts/ci/lib/providers.mjs`, and the script and its suite were deleted. |
| Migration drift     | `.github/workflows/check-migration-drift.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. Compares each deployed database's `schema_migrations` against what it should hold ([§ Schema drift detection](#schema-drift-detection-scriptscicheck-migration-driftmjs)) and upserts one `incident` alert issue, closing it when every environment is back in sync. Job-scoped `issues: write`; workflow-level grant stays `contents: read`. Logic in `scripts/ci/check-migration-drift.mjs` (tests: `scripts/ci/__tests__/check-migration-drift.test.mjs`). **Not** a required check. See "Schema drift detection" below. |
| Staging conformance | `.github/workflows/staging-conformance.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. Asserts live `frapp-staging` state rather than a push: project `ACTIVE_HEALTHY`, `custom_access_token_hook` enabled *and* pointed at the right function, the auth redirect allow list carrying `<site_url>/**` and `frapp://**` (a bare origin matches only itself, so without the wildcard GoTrue drops every web `emailRedirectTo` path — and any invite token in it — onto the Site URL; both projects were in that state until 2026-09-06), custom Auth SMTP on Resend at `Frapp <no-reply@mail.staging.frapp.live>` (`smtp_sender_name=Frapp`) with `rate_limit_email_sent` at least 300/hour (the hosted mailer is 2/hour; a revert brings back that cap for staging's members), the Magic Link template subject `Sign in to Frapp` and body carrying `token_hash` + `type=magiclink` (a revert to `{{ .ConfirmationURL }}` puts the href back on `*.supabase.co`), with no mailer subject and no Magic Link body still saying Signet, leaked-password protection on (`password_hibp_enabled: true`; it was off on both projects with every check green until 2026-09-29, [#2289](https://github.com/pdcarlson/Frapp/issues/2289)), Render `frapp-api-staging` `serviceDetails.healthCheckPath` `/health` (empty is TCP-only) and `autoDeploy: "no"` tracking `main` (the same as production-guardrails since [#2505](https://github.com/pdcarlson/Frapp/issues/2505): `deploy-staging.yml` deploys staging by commit after CI and the staging migrations, and auto-deploy would build every push before either and race it; until then this asserted `"yes"`), every Infisical secret sync succeeded, and an end-to-end sign-in whose JWT carries `active_chapter_id`. **Migration parity is deliberately NOT checked here** — `check-migration-drift.yml` above owns it end to end; see "Scheduled conformance" below. Upserts its own `incident` alert issue on drift and closes it on recovery. Logic in `scripts/ci/staging-conformance.mjs` (tests: `scripts/ci/__tests__/staging-conformance.test.mjs`). **Not** a required check — it verifies an environment, not a diff. |
| Production Auth conformance | `.github/workflows/production-auth-conformance.yml` — **scheduled** (see § Scheduled conformance below for the time) + `workflow_dispatch`. The production sibling of staging-conformance for the Auth settings first users hit on `frapp-prod`: project `ACTIVE_HEALTHY`, `custom_access_token_hook` enabled and pointed at the right function, and the redirect allow list carrying `https://app.frapp.live/**` plus `frapp://**` (Site URL is pinned, so a production project pointed at the staging origin cannot pass on matching staging wildcards). **Auth SMTP** must be on ([#1824](https://github.com/pdcarlson/Frapp/issues/1824)): an empty host (the hosted 2/hour mailer), a From other than `Frapp <no-reply@mail.frapp.live>`, or a send cap under 300/hour fails the run. **The Magic Link template** fails without `token_hash` + `type=magiclink`, with a Magic Link subject other than exactly `Sign in to Frapp`, or with a sibling `mailer_subjects_*` or Magic Link body that still says Signet, whatever the SMTP state. Both checks skipped an empty host until 2026-09-30, which let a switched-off mailer read as a healthy run ([#2349](https://github.com/pdcarlson/Frapp/issues/2349)). Leaked-password protection must be on (`password_hibp_enabled: true`, [#2289](https://github.com/pdcarlson/Frapp/issues/2289)); it is asserted whatever the SMTP state. Project ref comes from `.github/environments.json`, not injected `SUPABASE_PROJECT_REF`. Own alert title, so a recovered staging cannot close a live production incident. Does **not** name `environment: production` ([#1435](https://github.com/pdcarlson/Frapp/issues/1435)). Logic in `scripts/ci/production-auth-conformance.mjs`. **Not** a required check. |
| Release tags        | `.github/workflows/release.yml` — `workflow_call` from `deploy-production.yml` (plus `workflow_dispatch` for retry). Tags the deployed commit AFTER Render and Vercel report healthy, so a `v*` tag names something live. Bump is the highest `release:*` label across every PR merged since the last tag, with a `release:major` capped at minor while the latest tag is 0.x ([spec § Release labels](../../spec/environments/README.md#release-labels-for-version-tags); `scripts/ci/resolve-release-bump.mjs`), overridable by a dispatch input. The live SHA is checked out for history and the tag; the classifier itself is overlaid from the running workflow revision (`github.sha`), so a retry of an older live SHA does not re-run that SHA's pre-fix script (run 34155737950 died that way on issue #1340). A squash trailer that names an issue rather than a PR is skipped (loud warning); a 404 on a real PR still fails closed — re-dispatch Release with an explicit bump. The tag object is created through the Git Contents API (`POST /git/tags` + `POST /git/refs`), not receive-pack of a `v*` ref: GITHUB_TOKEN is a GitHub App and receive-pack refuses a tag whose tree's `.github/workflows` differs from default-branch HEAD (run 34247752847 shipped Packet B then died on `v1.0.0`; production was already on `0ca478e9`). That is not enough. `POST /git/tags` succeeded on run 34254679932 (dangling object `bca315f9`) and `POST /git/refs` still returned 403 `Resource not accessible by integration` — same App restriction, now at the ref. Do not widen the Actions App to cover workflow files. Create tag and Create GitHub Release use `RELEASE_GITHUB_TOKEN` (a *user* PAT with the **Contents and Workflows** permissions, read and write; an `automation` environment secret, which the release job names, never a `production` one) when set, else `GITHUB_TOKEN`. **Corrected 2026-09-29:** this said `contents:write`. With Contents alone the PAT made the tag object and was refused the ref for `v1.4.0`, whose commit's workflows differed from `main`'s tip (runs 36506993182, 36517450128); with Workflows added, run 36517657454 minted it. That was the first tag this token (created 2026-09-24) ever minted: `v1.3.0` went through the Actions token, because the release call did not pass `secrets: inherit` until #2839. `deploy-production.yml` passes `secrets: inherit` to the reusable workflow, which the called job needs to read the environment's copy. **Corrected 2026-09-28:** this row said no pass-through was needed, because the called job reads the environment's copy ([#2630](https://github.com/pdcarlson/Frapp/issues/2630)). Without `inherit` GitHub releases none of the environment's secrets to a called job (run 36479856561, #2804), and `v1.3.0`'s tag object was made by the Actions token, not the PAT. **Corrected 2026-09-24:** this row used to say to mint the `v1.0.0` ref (object `bca315f9` / SHA `0ca478e9`) and its GitHub Release from a laptop until the secret existed. That tag exists, as do `v1.1.0` and `v1.2.0`. **Corrected 2026-09-30:** no `v1.x` tag or release exists any more. `v1.0.0`–`v1.4.0` were renumbered to `v0.2.0`–`v0.6.0` on the same commits, each with its GitHub Release, and then deleted along with their releases ([#2529](https://github.com/pdcarlson/Frapp/issues/2529); [ADR-24](../../spec/architecture/adr/adr-24.md) decision 5). The run history in this row keeps the old names: `v1.0.0` is now `v0.2.0`, `v1.1.0` is `v0.3.0`, `v1.2.0` is `v0.4.0`, `v1.3.0` is `v0.5.0` and `v1.4.0` is `v0.6.0`. "Enable release immutability" was turned off in the repository settings during the re-tag; the six existing releases stay immutable. Whether GA can still take the name `v1.0.0` is [#3015](https://github.com/pdcarlson/Frapp/issues/3015). If a tag is ever minted by hand again, do not re-run Release to attach its GitHub Release: that run would see the tag as current and bump. **Corrected 2026-10-02:** a Release run for a commit that carries the newest plain `vX.Y.Z` now reuses that tag, skips the bump, and makes only its missing GitHub Release, so re-running it for a hand-minted newest tag is the way to attach one ([#3126](https://github.com/pdcarlson/Frapp/issues/3126)). A commit with an older tag is a rollback and still takes a higher one. |
| Docs                | `.github/workflows/docs.yml`. Despite the workflow's name it is **not** a documentation gate, and it is **not** a required check; the four docs gates that used to run here were deleted, and nothing replaced them in CI. Its job, and the separate `links.yml`, are described in [`docs-ci.md` § What runs](docs-ci.md#what-runs); neither is required. |
| CI wake             | `.github/workflows/ci-wake.yml` — `workflow_run` on CI / Docs checks / Links completion (PR runs only): classifies infra-vs-code failure, auto-requeues infra failures (≤3 total attempts), and upserts one PR wake comment **only for an outcome the PR-activity webhook does not already carry** — a cancelled or timed-out run, or an infra failure the re-queue could not absorb. Success and real failures clear the stale wake and say nothing. Logic in `scripts/ci/ci-wake.mjs` (tests: `scripts/ci/__tests__/ci-wake.test.mjs`). **Not** a required check. See [`pr-babysitting.md`](pr-babysitting.md). |
| PR base sync        | `.github/workflows/pr-base-sync.yml` — `push` to `main`: sweeps open PRs targeting it (cap 20, logged); behind + clean PRs are auto-updated via the update-branch API **only when the base-sync GitHub App token mints** (default-token pushes trigger no CI). Conflicts and per-PR update failures upsert one `<!-- frapp-base-sync -->` wake comment telling the watching agent to merge `main` itself; a missing or rejected token is repo-wide, so it raises **one** `incident` alert issue instead of the same comment on every PR. Logic in `scripts/ci/pr-base-sync.mjs` (tests: `scripts/ci/__tests__/pr-base-sync.test.mjs`). **Not** a required check. See [`pr-babysitting.md` → Base-branch sync](pr-babysitting.md#base-branch-sync-scriptscipr-base-syncmjs). |
| PR base guard       | `.github/workflows/pr-base-guard.yml` — the **only** workflow with no `on.pull_request.branches` filter, so it runs on every PR whatever the base. Fails when the base is not `main`, which is the one check a stacked PR would otherwise never get. No checkout, no npm, no third-party action; reads `pull_request.base.ref` off the event payload. Fires on `edited` too, so retargeting a base cannot leave a stale green. **Not** yet a required check — see [`pr-babysitting.md` → CI branch filters](pr-babysitting.md#ci-branch-filters-never-target-a-feature-branch). |
| Issue closed labels | `.github/workflows/issue-closed-labels.yml` — `issues: closed`: removes `in-review` and `in-progress` from the issue, since a closed issue's state is its status ([`github-pm.md` § States](github-pm.md#states-labels--native-issue-state)) and no session is alive at merge to do it. Skips the runner when neither label is present. A close made with a workflow's own `GITHUB_TOKEN` (a watchdog closing its `incident` issue) fires no workflow, so those keep their labels. No checkout, no npm, no third-party action; the runner's `gh` with `GITHUB_TOKEN` (`issues: write`). Tests: `scripts/ci/__tests__/issue-closed-labels.test.mjs`. **Not** a required check. |
| PR CI branch filter | `ci.yml` / `docs.yml` / `links.yml` set `on.pull_request.branches: [main]`. GitHub matches that list against the PR **base**. A PR whose base is anything else skips every required check. See [`pr-babysitting.md` → CI branch filters](pr-babysitting.md#ci-branch-filters-never-target-a-feature-branch). |
| Branch protection   | `npm run configure:branch-protection` (prefers `GITHUB_PAT`) — **that bare form is a LIVE apply and a human step**; from an agent session run only `npm run configure:branch-protection:verify`. See **Branch protection script** below and `CONTRIBUTING.md`. |
| AI code review      | **Repository-managed Git pre-push gate**, not CI — [`.githooks/pre-push`](../../.githooks/pre-push) is installed through the root `prepare` script for agents and humans. A push of unreviewed work is blocked until `.cache/diff-review/<SHA>` exists (a clean merge of `main` needs none) — `/diff-review` writes the marker; `/code-review` adds coverage but replaces nothing: it is only conditionally model-invocable and does not write the marker (the `claude-review.yml` CI workflow was removed 2026-06-04; the advisory `codex-review.yml` was removed 2026-09-21). See `ai-code-review-runbook.md` |
| Dependency updates  | `.github/dependabot.yml` opens the PRs. **Not** a required check (it opens PRs, it doesn't gate them). Schedule, grouping and the ignore list: [`dependency-updates.md`](dependency-updates.md). |
| Vercel              | Both projects are unlinked from Git (**`frapp-landing` 2026-09-01, `frapp-web` 2026-09-02**), so no push deploys anything. Every deployment is built on a runner and uploaded: staging by `deploy-staging.yml` after green CI on `main`, production by `deploy-production.yml` from a dispatched SHA. From the unlink until #1578 (2026-09-04) staging web and landing stayed frozen at their last Git builds: landing `2bf143b` (2026-09-01T20:19Z), web `0372c6d` (2026-09-02T02:41:42Z). See the note directly below. Its team and project ids live in `.github/environments.json`, and no workflow or action names one ([§ Environment identity](../../spec/environments/README.md#environment-identity), #2806). |

> **Vercel Git integration retired — `frapp-landing` 2026-09-01, `frapp-web` 2026-09-02; canonical
> record is ADR-21.** The owner disconnected **both** Vercel projects from Git, deliberately and
> **not as one event**: `frapp-landing` on 2026-09-01 and `frapp-web` roughly six and a half hours
> later on 2026-09-02 (`list_projects` reports `link: null` for both, read 2026-09-02). The red
> guardrail, the failing verify steps and the frozen staging hosts that followed from those two
> unlinks are why the two projects' freeze points and their verify jobs' first red runs carry
> different dates. **The first two are repaired** ([#1579](https://github.com/pdcarlson/Frapp/issues/1579),
> 2026-09-02): the guardrail assertion was inverted, and the two Vercel verify jobs were removed
> outright (and the rest of that workflow went with #2505 on 2026-09-25). While those jobs existed the failure was the **verify** step
> only: `scripts/ci/ensure-vercel-staging-alias.mjs` ran after it as a plain sequential step with no
> `if:` guard, so a failed verify ended the job and the alias step was *skipped* — that script never
> failed and emitted nothing to grep for. The full
> breakage list, the evidence and the rationale live in **ADR-21** in
> [`spec/architecture/adr/adr-21.md`](../../spec/architecture/adr/adr-21.md), with its 2026-09-02
> amendment — read it there rather than
> re-deriving it here. The replacement model (`vercel build`
> plus `vercel deploy --prebuilt` driven from GitHub Actions) was **built** by
> CI/CD stage 7, [#1578](https://github.com/pdcarlson/Frapp/issues/1578) under the
> [#1381](https://github.com/pdcarlson/Frapp/issues/1381) epic:
> `.github/workflows/deploy-vercel-staging.yml` (since #2803, `deploy-staging.yml`) deploys staging
> after green CI on `main`, and `deploy-production.yml` deploys production from a dispatched SHA. Both run
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

**PR review policy:** [`CONTRIBUTING.md` § PR review requirement policy](../../CONTRIBUTING.md#pr-review-requirement-policy).

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
[`../ops/github-branch-protection-runbook.md`](../ops/github-branch-protection-runbook.md)) — and
the two footguns above are why that policy is not merely etiquette.

Deeper deploy architecture: [`../ops/deployment/`](../ops/deployment/).

## Infisical sync map

The live syncs — source environment, secret path, destination scope, and the
date the dashboard was last read — are inventoried in exactly one place: [`SECRETS_MANAGEMENT.md` §5 "Configure Secret Syncs"](../internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs). GitHub Actions is not one of them; which workflows pull at job time instead: [`SECRETS_MANAGEMENT.md` § GitHub Actions is not a sync](../internal/environment/SECRETS_MANAGEMENT.md#github-actions-is-not-a-sync). Do not restate the table here.

Project ID is documented in [`SECRETS_MANAGEMENT.md`](../internal/environment/SECRETS_MANAGEMENT.md) and root `.infisical.json`.

## GitHub environments and bootstrap secrets

| Environment  | Protection        | Purpose                             |
| ------------ | ----------------- | ----------------------------------- |
| `staging`    | None; deployment branches `main` only ([#2583](https://github.com/pdcarlson/Frapp/issues/2583)) | Staging deploys (`main`), plus the staging check `staging-conformance.yml` |
| `production` | **A required reviewer that actually pauses jobs** (see the note below) — since #1340 this is the ONLY human gate on production | Production deploys + migrations |
| `production-backup` | **No required reviewers, on purpose.** Referenced by `db-backup.yml` since 2026-09-06 (#1435). GitHub's documented behaviour is to create an environment the first time a job *runs* against a name that does not exist, with no protection rules — so it appears after the first scheduled run, not on merge, and had not been observed via `GET /repos/…/environments` when this row was written (reconfirmed 2026-09-07 with the same `GET`: the name is still absent). **Corrected 2026-09-23: it exists now.** The `production-backup-env.yml` watchdog, which fails on a missing or unreadable environment, passed on each of its last five scheduled runs (2026-09-18 → 2026-09-22; latest [run 35722904165](https://github.com/pdcarlson/Frapp/actions/runs/35722904165)). If it is ever created by hand, it must be created **without** reviewers; a required-reviewer rule here silently suspends every nightly production dump. It also admits `main` only (the [`db-backup.yml`](../../.github/workflows/db-backup.yml) header), a branch filter rather than a reviewer gate. **Corrected 2026-09-24:** that lock was unset and tracked on #1827; [#2583](https://github.com/pdcarlson/Frapp/issues/2583) set it on 2026-09-23 | The nightly **read-only** production dump and Storage mirror. A `schedule:` job naming `production` would suspend on the reviewer gate every night; this environment exists so the backup needs no human at 02:30 while keeping the deploy gate untouched. Its only GitHub secrets are the Infisical pair (roster below) — the job injects Infisical `prod` (source) and `staging` (offsite bucket), and each backup action asserts the injected project ref against `.github/environments.json` before linking |
| `automation` | **No required reviewers, on purpose**, the same trap as `production-backup`. Deployment branches `main` only ([#2583](https://github.com/pdcarlson/Frapp/issues/2583)). Named with `deployment: false`, so its runs create no deployment records | Every unattended job on `main` that needs a secret and is not a staging or production deploy: `check-migration-drift`, `migration-snapshot`, `production-auth-conformance`, `production-guardrails`, `production-release-pin`, `pr-base-sync`, `release`, `supabase-quota`, and `_mobile-build.yml`'s jobs (the opt-in store build after a production ship, #3111), which is why that build costs no Approve click. Added by #2518 |

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
> **Verified directly 2026-09-02; the timing evidence above is now corroboration, not the basis.** This paragraph used to read "the environment's protection rules themselves were not read. `GET /repos/{owner}/{repo}/environments/production` is not reachable from an agent sandbox — the proxy answers `403`." The 403 was the proxy route, not the endpoint — see [The `api.github.com` route rule](#the-apigithubcom-route-rule). Read direct with node `fetch`, `GET /repos/pdcarlson/Frapp/environments/production` returns **200** and reports `protection_rules: ["required_reviewers"]`, and `GET /repos/pdcarlson/Frapp/environments` returns 200 listing nine environments (`Preview`, `Preview – frapp-docs`, `Preview – frapp-landing`, `Preview – frapp-web`, `production`, `Production – frapp-docs`, `Production – frapp-landing`, `Production – frapp-web`, `staging`). So a required-reviewer rule on `production` is a fact read off the API, and the created→started delays above are consistent with it rather than the only evidence for it. That read establishes the rule is **present**, not *who* the reviewers are — that still takes one look at **Settings → Environments → production**.
>
> **Consequence, and what #1340 did with it.** Production migrations used to be gated by a human twice: once at the promotion PR, and again after merge, on an approval click nobody was paged for. The second gate is the one that parked a one-migration apply for 29m52s on 2026-08-28.
>
> The resolution was not to remove the second gate but to remove the **first**. The promotion PR was the weaker of the two: it approved a branch merge, before anyone knew whether the migration applied, and it did not name the commit that would ship (Render auto-deployed the branch tip on commit, without waiting for CI). The environment approval happens on a run that names the SHA, after the replay has rehearsed the apply against production's live state, with a person watching. So `production` still has Required reviewers **on purpose**, and `deploy-production.yml` is unusable without them.
>
> One consequence worth stating plainly: the **shipping** path in `deploy-production.yml` is a **single `environment: production` job** (since #2805, the `_deploy.yml` job it calls) precisely because each environment-scoped job costs its own Approve click. Splitting migrate / Render / Vercel / verify would silently turn one approval into four. SHA confirmation, trim, and `validate-deploy-sha.mjs` are a prior **unscoped** job so a bad paste or confirmation cannot open that gate (run 34234768094 sat 20 minutes on Approve, then died at Validate; production was not touched). Do not put `environment: production` on `validate`.

### No repository secrets (#2518)

**The rule: every secret is an environment secret, and no repository secret exists.** The settings have followed it since [#2583](https://github.com/pdcarlson/Frapp/issues/2583) (**State**, below). For a same-repository pull request, and for a push or a dispatch on any branch, GitHub runs the workflow definitions from that branch. So a repository secret is readable by anyone who can push a branch: they edit a workflow, or add one. Agent sessions push branches, and they read public issue text. The boundary that holds is an environment whose **deployment branches** rule admits `main` only:

- GitHub matches the rule against the run's `GITHUB_REF`. A `pull_request` run is `refs/pull/N/merge`, a push or dispatch carries its own branch, and `schedule` and `workflow_run` run as the default branch.
- A job cannot read an environment's secrets until its rules pass.
- An environment secret also wins over a repository secret of the same name, which is what lets the move go one secret at a time.

Three rules follow. All are pinned by [`workflow-secrets-scope.test.mjs`](../../scripts/ci/__tests__/workflow-secrets-scope.test.mjs):

1. **Nothing a pull request triggers references a secret.** The migration gates read a published snapshot instead (below).
2. **Every job that references a secret names one of the four environments below, as a literal.** A computed name could select an unprotected environment, and naming one that does not exist makes GitHub create it with no rules. A new environment gets its `main` rule before its first secret, and then joins `CREDENTIAL_ENVIRONMENTS` in that test. One exception, for the shared deploy job ([`_deploy.yml`](../../.github/workflows/_deploy.yml), #2804): its job names `${{ inputs.environment }}`, which the test admits only because the file is callable only and every caller in this repo passes a literal from that list and runs on no pull-request trigger. Its callers pass `secrets: inherit`: without it a called job saw none of its environment's secrets (run 36479856561, and `release.yml`'s PAT before #2804's follow-up), and rule 3 holds every call into a secret-reading workflow to it. That `inherit` releases them is from [actions/runner#4453](https://github.com/actions/runner/issues/4453) until a run shows it (#2804). No repository secret exists for it to pass. Rule 1 also follows a call: a pull-request job may not call a workflow that reads secrets.
3. **A job that calls a reusable workflow whose jobs read secrets passes `secrets: inherit`, and names no secret itself.** Without `inherit` the called job's environment secrets read empty (run 36479856561); a secret the calling job names could only be a repository copy, since that job names no environment, and none may exist.

| Environment | Secrets | Consumers |
| --- | --- | --- |
| `automation` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `RENDER_API_KEY`, `VERCEL_API_KEY`, `RELEASE_GITHUB_TOKEN`, `PR_BASE_SYNC_APP_CLIENT_ID`, `PR_BASE_SYNC_APP_PRIVATE_KEY`, `EXPO_TOKEN` (read by `_mobile-build.yml`'s `build` job only, #3111; what it is and how to rotate it: [`mobile.md` § 6.6](../ops/deployment/mobile.md#66-store-submission)) | the table above. `_mobile-build.yml`'s `record` job also reads the base-sync App pair, to open the `shipped-builds.json` PR |
| `staging` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `RENDER_API_KEY`, `VERCEL_API_KEY`; optional `STAGING_SMOKE_USER_EMAIL`, `STAGING_SMOKE_USER_PASSWORD` | `_deploy.yml` (called by `deploy-staging.yml`: the called job names the environment, and the call passes `secrets: inherit`, without which none of them reached it, #2804), `db-backup.yml` (staging jobs), `staging-conformance.yml` |
| `production` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, `RENDER_API_KEY`, `VERCEL_API_KEY` | `_deploy.yml` (called by `deploy-production.yml`, which passes `secrets: inherit` the same way, #2805) |
| `production-backup` | `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET` | `db-backup.yml` (production jobs) |

**State on 2026-09-24: the workflows and the settings both follow the rules.** Corrected from this paragraph's first writing, earlier on 2026-09-23, when all nine secrets were still repository secrets and no environment had a branch rule; the rules were set and read back that evening. The owner's [#2583](https://github.com/pdcarlson/Frapp/issues/2583) locked the four environments above to `main` with admin bypass off, deleted the eight environments nothing used, moved every live secret into its environment, rotated every credential among them (the two IDs, `INFISICAL_MACHINE_IDENTITY_ID` and `PR_BASE_SYNC_APP_CLIENT_ID`, are unchanged), and deleted the rest. Read back on 2026-09-24T16:24Z over the direct route: `actions/secrets` returns `total_count: 0`, and each environment's only deployment branch policy is `main`. To read the live state, use the direct REST route ([The `api.github.com` route rule](#the-apigithubcom-route-rule)): `GET /repos/pdcarlson/Frapp/actions/secrets` (names only; the target is `total_count: 0`) and `GET /repos/pdcarlson/Frapp/environments` (each `deployment_branch_policy` set). [#2585](https://github.com/pdcarlson/Frapp/issues/2585) makes that a daily watchdog.

Read-only consumers of the provider keys: `production-guardrails.yml` (`RENDER_API_KEY` and `VERCEL_API_KEY`) and `staging-conformance.yml` (`RENDER_API_KEY`). `_deploy.yml` uses the same two keys to **create** deploys: for production (called by `deploy-production.yml`) a Render deploy by `commitId` and a Vercel deployment with `target: production`, for staging (called by `deploy-staging.yml`) the staging Render deploy and Vercel deployments. They never carry runtime values. Those runtime values (including `SUPABASE_ACCESS_TOKEN`) come from Infisical at job time ([`SECRETS_MANAGEMENT.md` § GitHub Actions is not a sync](../internal/environment/SECRETS_MANAGEMENT.md#github-actions-is-not-a-sync)), and the Infisical pair above is the only way in. `INFISICAL_PROJECT_ID` and `OPENROUTER_API_KEY` had no consumer and were deleted with #2583 ([#1587](https://github.com/pdcarlson/Frapp/issues/1587), [#2447](https://github.com/pdcarlson/Frapp/issues/2447); the OpenRouter key was also revoked at the provider).

**The migration snapshot.** `migration-drift-gate.yml`'s three jobs need each project's applied-migration history, and only a credential can read that. So [`migration-snapshot.yml`](../../.github/workflows/migration-snapshot.yml) reads it from `main`, in `automation`, after every `Deploy staging` and `Deploy production` run, every 4 hours, and as a store build starts, because that keeps its Deploy production run open for hours (its header's "When it runs" owns the list). It uploads the result as the `migration-snapshot` artifact, and [`download-migration-snapshot`](../../.github/actions/download-migration-snapshot/action.yml) fetches the newest one from a successful `main` run with `GITHUB_TOKEN`. The download action accepts only a run whose commit is on `main` (a tag named `main` would otherwise pass for it). Off `main` (a pull request, or a dispatch on a PR's branch), the required `migration-order` and `migration-replay` also need the snapshot to have been read after the latest finished `Deploy staging` or `Deploy production` run on `main`, with no `Deploy staging` run still in flight. While that isn't yet true they wait for the deploy to finish and its publish to land, for as long as the action's header sets (derived there, not measured end to end). If the snapshot is still stale after that, they fail on every PR that touches a migration, naming the publisher. Runs on `main` take the newest trusted snapshot as it is (`on-stale: use`). There the migration has already merged, and failing would leave a red required check on a `main` commit, one `validate-deploy-sha.mjs` refuses to deploy. The report-only `migration-drift` never waits either. It turns red as `stale` when a migration has been on `main` longer than its grace window and the snapshot cannot show whether staging has it: a `Deploy staging` run may have changed staging since, or whether one did could not be read. The job summary says which case applies and what to do; the cases are in [`drift-and-ordering.md` § `migration-drift`](../ops/database/drift-and-ordering.md#migration-drift--reports-does-not-block). The action's header has the reasoning, and the one residual: a `Deploy production` run still in flight. Behind all of it sits a 24-hour age limit on every snapshot. The fix is to repair the publisher, then Actions → **Migration snapshot** → Run workflow on `main`. The same run is the step after any manual change to a migration ledger (a `migration repair`, an `--include-all` apply), which triggers no publish ([`drift-and-ordering.md` § What catches drift, and what catches bad ordering](../ops/database/drift-and-ordering.md#what-catches-drift-and-what-catches-bad-ordering)).

## Release labels

How `release:*` labels set the version bump: [`spec/environments/README.md` § Release labels for version tags](../../spec/environments/README.md#release-labels-for-version-tags).

## Lint, test, build (repo root)

The commands are in [`AGENTS.md` § Lint, test, build, type-check](../../AGENTS.md#lint-test-build-type-check), and the CI job each one mirrors is in the [`testing` skill's CI parity checklist](../../.claude/skills/testing/SKILL.md#ci-parity-checklist). Why a cold clone needs no package prebuild for `lint` and `check-types` is in [`CONTRIBUTING.md` § Linting, types, and tests](../../CONTRIBUTING.md#linting-types-and-tests). Why `clean-checkout-typecheck` and `web-production-build` must never use the `turbo-packages-build` action is in [`.github/actions/README.md`](../../.github/actions/README.md). Why `check:api-contract` builds `./packages/*` itself, since turbo never schedules the root `check:*` scripts and so they can't inherit `^build`, is in `scripts/check-api-contract-drift.mjs`'s header. `check:npm-audit` and `check:migration-safety` need no package build at all. Treating those three kinds of script (turbo tasks, `check:api-contract`, and the build-free checks) as one is what caused #683.

## Dependency updates (Dependabot)

Dependabot's schedule and grouping, the npm it resolves the lockfile with, its ignore-list rule, and the write-ups behind several ignore entries, live in [`dependency-updates.md`](dependency-updates.md); the reason for every entry is commented inline in [`.github/dependabot.yml`](../../.github/dependabot.yml). Cite that file and a heading, never `§N`.

## eslint-plugin-react-hooks 7 compiler rules

`eslint-plugin-react-hooks` 7.x enables React Compiler rules on top of the two classic
Rules of Hooks. We do not run `babel-plugin-react-compiler`. Shared presets
([`packages/eslint-config/react-hooks.js`](../../packages/eslint-config/react-hooks.js))
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

## TypeScript 7 is native `tsc` plus a TypeScript 6 compiler API

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
set is `@repo/validation`, `@repo/color`, `@repo/formatting`, `@repo/observability`, `@repo/chapter-theme`,
`@repo/org-archetypes`, `@repo/chat-integrations` (each `"build": "tsc"`), and `@repo/api-sdk`
(`outDir` is set even though `check-types` passes `--noEmit` and there is no `build` script —
do not add a build as a side effect of this pin). Non-emitting packages (`@repo/theme`,
`@repo/hooks`, `@repo/chat-core`, which the apps consume as source) and the Next / Expo apps stay `noEmit`. `apps/api` sets `"rootDir": "./src"`
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
`vitest` / `playwright` configs. The app
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
`TS5107`; see [`docs/guides/testing.md`](../guides/testing.md) §6). The unit overlay does
not set `moduleResolution: "node"`; it still carries `ignoreDeprecations` so the four configs
share the same two keys if a later overlay adds a 6.0-deprecated option.

None of those ts-jest projects type-checks anything: each inherits `isolatedModules: true` from
`apps/api/tsconfig.json` and only transpiles, so a spec that no longer matches the code it tests
still runs. `apps/api`'s `check-types` is what catches it, by type-checking two programs:
`tsconfig.build.json`, the program `nest build` emits (`types: ["node"]`, so production code
cannot reach jest's globals), and `tsconfig.json`, which adds every spec and `test/` (`types:
["node", "jest"]`). Both name `types` because TypeScript 6 and 7 default it to `[]`: without
`jest` there, every `describe` and `jest.fn` in a spec is an unresolved name (#2821). Both runs
pass `--incremental false`. `tsconfig.json` sets `incremental: true`, and native `tsc` 7.0.2's
cache does not invalidate when `types` changes, whether on the command line or in the tsconfig,
in either direction: a cache written without jest's types went on reporting 17,668 errors after
they were added, and one written with them went on passing after they were removed. `tsc6`
invalidates correctly. Measured on 2026-09-30, the two runs took about five seconds together, so
the cache bought nothing.

**Do not flatten this back to `typescript@7`.** That is what Dependabot's first 5.9.2 → 7.0.2
bump did (#1031), and it failed `packages-build` / `clean-checkout-typecheck` / `api-docker-build`
on `packages/validation` (`TS5011` missing `rootDir`) before Nest, ESLint, and Jest could even
run. Re-evaluate when TypeScript 7.1 ships a stable programmatic API *and* those three peers
widen; until then the aliases move independently — native 7.x patches on `@typescript/native`,
6.0.x patches on the `typescript` alias (stay below 6.1 for `typescript-eslint`).

## Claude Code project settings

`.claude/settings.json` ships repo-wide config for Claude Code sessions (cloud and local). Current contents:

| Key               | Value  | Effect                                                                                                                                                                                                                                                           |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doneMeansMerged` | `true` | The session is not "done" when code is pushed — it's done when the PR is green and review-clean. Drives the babysit-until-green loop, whose steps and stop conditions are in [`AGENTS.md` § Autonomous PR lifecycle](../../AGENTS.md#autonomous-pr-lifecycle-cloud-sessions); wake-path facts are in [`pr-babysitting.md` → Wake coverage](pr-babysitting.md#wake-coverage). `send_later` (self-wake) was retired 2026-08-08: it prompts and can't be allowlisted. |
| `permissions.allow` | `Workflow` + GitHub MCP babysit/tracker tools | Auto-approves the multi-agent **Workflow** tool so `/next ultracode` fan-outs don't stall on a prompt. Lists the **GitHub MCP** tools the babysit loop and tracker need (`subscribe`/`unsubscribe_pr_activity`, issue/PR reads and writes, `actions_run_trigger`). The 21 `Claude_Code_Remote` / kebab-case / connector-UUID entries for `send_later` and the trigger family were **removed** — they were inert on the cloud surface (ceiling rule) and were being misread as permission. Do not re-add them to "allowlist" `send_later`; it still prompts. `merge_pull_request`, `enable_pr_auto_merge`, `push_files`, `create_or_update_file`, and `delete_file` stay unlisted — merging and direct repo-content writes are not repo-sanctioned (the harness `mcp__github__*` wildcard may still auto-approve them on cloud; the merge gate is policy — see "Applied permission allows"). Linear allows were removed with the retirement (#680). |
| `workflowSizeGuideline` | `medium` | Appends "keep workflows under 10 agents" to the Workflow tool's description for everyone who opens the repo (`small` <5, `medium` <10, `large` <50, `unrestricted` sends nothing). Read out of the 2.1.280 bundle and its settings docs: the guideline is advisory, ultracode doesn't change it, and a value in any settings file overrides `/config`'s "Dynamic workflow size" and hides that row. `/diff-review`'s `frapp-review` workflow is the one sanctioned exception ([ADR-23](../../spec/architecture/adr/adr-23.md); procedure: [`multi-agent`](../../.claude/skills/multi-agent/SKILL.md)). |
| `hooks` | SessionStart, PostToolUse (Bash) | SessionStart wires [`session-start.sh`](../../.claude/hooks/session-start.sh) for cloud-sandbox bringup. PostToolUse wires [`drop-stale-upstream.sh`](../../.claude/hooks/drop-stale-upstream.sh), which removes a merged branch's stale `origin/<branch>` ref so Claude Code's own Stop hook (the harness's `~/.claude/stop-hook-git-check.sh`) stops counting main's commits as unpushed after the branch is reset to main. When it acts, and what removing the ref costs, is in the script's header. Review enforcement is provider-neutral in [`.githooks/pre-push`](../../.githooks/pre-push). A second PreToolUse hook (`linear-autoallow.sh`, PR #676) auto-approved Linear's write tools; it was deleted with the Linear retirement — see "Applied permission allows" below. Details: [`ai-code-review-runbook.md`](ai-code-review-runbook.md) and [`AGENTS.md`](../../AGENTS.md) § Claude Code web sandbox. |

*Removed 2026-09-30:* `effortLevel: "high"`, added the same day (#2950) so sessions in this repo, suggested-task cards among them, would start at `high`. It couldn't reach the cloud sessions it was for. Observed that day: this repo's resumed cloud session was launched with `--effort xhigh`, which outranks project settings; a card launched in the cloud on a checkout carrying the key still ran at `xhigh` (its launch arguments weren't inspected); and an `/effort medium` line in a card's prompt arrived as plain text. Where the cloud launcher's level comes from, and whether every cloud launch passes one, isn't known. Paul dropped the key and the card effort rule with it, since card usage was low either way. Its one working effect goes with it: a local session launched without `--effort` or `CLAUDE_CODE_EFFORT_LEVEL` now starts at the user's saved level, or Opus 5.5's `medium`.

*Removed 2026-09-23:* `skipWorkflowUsageWarning: true`. It was listed here, read out of the 2.1.220 build, as marking the multi-agent workflow usage warning accepted "so unattended sessions don't stall". The 2.1.280 bundle reads the key only from user, local, flag and policy settings, never from this project file, so the value here did nothing. The warning it suppresses is a one-time consent prompt in auto permission mode; non-interactive and background sessions never show it, and approving any Workflow dialog writes the key to the approver's own user settings.

Authoring contract for the loop (what an agent must do) lives in [`AGENTS.md`](../../AGENTS.md) under "Autonomous PR lifecycle". That is canonical; the `doneMeansMerged` row above links to it rather than restating the steps.

## Shared CI script library (`scripts/ci/lib/`)

The scripts below are written against a small shared layer rather than each carrying its own copy.
Reach for these before writing a new helper; adding a fifteenth private `requireEnv` is the shape of
drift this layer exists to stop (stage 4 of the CI/CD redesign, [#1382](https://github.com/pdcarlson/Frapp/issues/1382)).

The table lists every module in `scripts/ci/lib/`, with all of its exports, and
`ci-lib-table.test.mjs` fails when a module or an export is missing from it. The first group is for
any script. The second serves one family of scripts, and is listed so a new member of that family
finds it rather than writing a second copy. A module's header owns its reasoning; a row says only
what to use it for.

| Module | Exports | Use it for |
| --- | --- | --- |
| `scripts/ci/lib/env.mjs` | `requireEnv`, `SECRETS_RUNBOOK` | Reading a required environment variable. Exits 1 naming the variable; emits a GitHub Actions `::error::` annotation under Actions and a plain `Error:` line locally. `hint` appends a pointer — pass `SECRETS_RUNBOOK` where the fix is provisioning a secret. |
| `scripts/ci/lib/invoked-directly.mjs` | `isInvokedDirectly` | The entry guard every script under `scripts/` runs its CLI behind, so a test can import the script's helpers without running it. `invoked-directly.test.mjs` fails on a script that reads `argv[1]` itself. |
| `scripts/ci/lib/http.mjs` | `fetchWithRetry`, `resilientFetch`, `isRetriableStatus`, `IDEMPOTENT_METHODS`, `DEFAULT_TIMEOUT_MS`, `NON_IDEMPOTENT_TIMEOUT_MS`, `DEFAULT_ATTEMPTS`, `DEFAULT_BACKOFF_MS` | Any outbound call. `resilientFetch` is a drop-in `fetch`: a `GET`, `HEAD` or `OPTIONS` gets a 15s timeout and up to 3 attempts, any other method one attempt under a 120s timeout (§ Retry is scoped to idempotent methods, below). The constants are those values. |
| `scripts/ci/lib/github.mjs` | `ghRequest`, `ghGetWithFallback`, `githubHeaders`, `GITHUB_API` | Every GitHub REST call. Every call is bounded by `http.mjs`'s timeout (15s for a read, 120s for a write), with or without `retry` ([#2333](https://github.com/pdcarlson/Frapp/issues/2333)). Never throws — a network rejection, or a call that outlives its timeout, returns `{ ok: false, status: 0, data: <message> }`, where the message folds in the error's `cause` (undici leaves `message` as the bare "fetch failed" and hangs the real diagnosis there). `data` is `null` only when a real HTTP response carried an empty body, so a truthy `data` is **not** evidence a response was received — check `status !== 0` for that. |
| `scripts/ci/lib/providers.mjs` | `fetchJson`, `fetchRenderDeploys`, `fetchVercelDeployments`, `findVercelDeploymentBySha`, `vercelDeploymentCreatedAt`, `vercelDeploymentState`, `VERCEL_TERMINAL_SUCCESS_STATES`, `VERCEL_TERMINAL_FAILURE_STATES`, `VERCEL_NEUTRAL_TERMINAL_STATES` | `fetchJson` is the shared ok-check-throw-json wrapper (was three near-identical copies, #1351); `fetchRenderDeploys` / `fetchVercelDeployments` list one page through it. `findVercelDeploymentBySha` pages back through the Vercel listing, bounded, looking for a SHA — use it rather than the single-page fetcher when matching against a specific commit, since a page holds only the newest slice and an older SHA can fall off it (#1377). Read a Vercel deployment row through `vercelDeploymentCreatedAt` and `vercelDeploymentState` (`state`, falling back to `readyState`, which Vercel also returns; was five copies, #1778), and classify it with the three state sets; what a `CANCELED` means stays each caller's call. |
| `scripts/ci/lib/polling.mjs` | `createClock`, `pollUntilTerminal` | `createClock` is an injectable clock, so a poll loop's tests run without sleeping. `pollUntilTerminal` is the shared "fetch, classify, sleep, repeat until terminal or timeout" loop behind the pollers (`deploy-render-production.mjs`, `deploy-vercel.mjs`, `verify-served-commit.mjs`, `verify-sentry-sourcemaps.mjs`; #1351, #2505) — it owns only the loop mechanics; each caller's `classify` closure keeps its own terminal-state judgment. |
| `scripts/ci/lib/alert-issue.mjs` | `defineAlert`, `isDefinedAlert`, `selectAlertConfig`, `findAlertIssues`, `findAlertIssuesDetailed`, `raiseAlert`, `resolveAlert`, `withAgentNote`, `ALERT_LOOKUP_LABEL`, `ALERT_ASSIGNEE` | The create/reopen/comment/close upsert contract for `incident` alert issues, and the one place their label and assignee are set. An alert's identity is declared once with `defineAlert({ title, labels })`, and the find, raise and resolve functions take that value as `alert`, refusing anything else (#1731). A watchdog that reads its alert before deciding hands that `findAlertIssuesDetailed` result to `raiseAlert` or `resolveAlert` as `lookup`, which reuse a successful read instead of reading the same pages again, and refuse one read for another alert (#2333). `selectAlertConfig` picks a script's config by name and throws on a missing or unknown one. |
| `scripts/ci/lib/environments.mjs` | `ENVIRONMENTS`, `SUPABASE_PROJECT_REF_PATTERN`, `parseEnvironments`, `loadEnvironments`, `RENDER_SERVICE_ID_PATTERN`, `VERCEL_TEAM_ID_PATTERN`, `VERCEL_PROJECT_ID_PATTERN`, `parseProviderIds`, `providerIdsFor`, `supabaseAccessTokenFor`, `getEnvironment` | Which Supabase project and Render service each environment is, and the Vercel team and projects both deploy to, read from `.github/environments.json` rather than from whatever a job's `SUPABASE_PROJECT_REF` holds. A workflow reads the ids through `scripts/ci/provider-ids.mjs`. `supabaseAccessTokenFor` picks the Management API token for one environment. |
| `scripts/ci/lib/required-checks.mjs` | `CI_CHECKS`, `DOCS_CHECKS`, `DRIFT_CHECKS`, `ALL_REQUIRED_CHECKS` | The required-check rosters, as data only. Branch protection (must these pass to merge?) and the deploy gates (did these pass on this commit?) both read them here, so neither imports the other. |
| `scripts/ci/lib/release-tag.mjs` | `RELEASE_TAG_PATTERN`, `latestReleaseTag` | Production's latest `vX.Y.Z` tag by `release.yml`'s own rule. Ask here what is live rather than re-deriving it. |
| `scripts/ci/lib/ops-docs.mjs` | `PROMOTION_LOG`, `PROMOTION_RUNBOOK`, `DRIFT_AND_ORDERING`, `ROLLBACK_PLAYBOOK`, `ALERT_ROUTING` | The repo paths of the ops docs that gates and alert bodies cite. `ops-docs.test.mjs` fails on an untracked path, so moving one is an edit here. |
| `scripts/ci/lib/supabase-cli-pin.mjs` | `SUPABASE_CLI_ACTION`, `parseSupabaseCliPin`, `readSupabaseCliPin`, `SUPABASE_CLI_SH`, `chooseSupabaseCli`, `probeSupabaseOnPath`, `resolveSupabaseCli` | The pinned Supabase CLI version, read from `.github/actions/supabase-cli/action.yml`. `resolveSupabaseCli` is the one place a script that also runs off CI picks which CLI to run, never bare `npx supabase` (#723). |

| Module (one family) | Exports | Use it for |
| --- | --- | --- |
| `scripts/ci/lib/migration-snapshot.mjs` | `SNAPSHOT_SCHEMA_VERSION`, `SNAPSHOT_ARTIFACT_NAME`, `SNAPSHOT_FILE_NAME`, `SNAPSHOT_WORKFLOW`, `DEFAULT_MAX_AGE_HOURS`, `buildSnapshot`, `parseSnapshot`, `checkFreshness`, `snapshotFetch`, `loadSnapshot`, `openSnapshot`, `describeSnapshot` | The published migration snapshot the pull-request migration gates read (#2518): build, parse, check freshness, and serve it through `snapshotFetch`. |
| `scripts/ci/lib/vercel-cli.mjs` | `VERCEL_TARGET_PRODUCTION`, `VERCEL_TARGET_PREVIEW`, `vercelEnvironmentFor`, `vercelPullArgs`, `vercelBuildArgs`, `vercelDeployArgs`, `parseDeploymentHost`, `runCommandCapturing`, `normalizeGitSha`, `vercelCliEnv`, `vercelDirFor`, `pulledEnvFileFor`, `defaultEnvFileFs`, `defaultStashFs`, `buildVercelProject`, `deployPrebuiltVercelProject` | The Vercel CLI half of CI deploys (ADR-21): `vercel pull`, `build` and `deploy --prebuilt`, behind `deploy-vercel.mjs`. |
| `scripts/ci/lib/vercel-build-env.mjs` | `APP_CONFIG_KEYS`, `appConfigKeysFor`, `formatEnvBaseline`, `parseEnvBaseline`, `infisicalBuildEnv`, `SENSITIVE_PLACEHOLDER`, `keysHoldingPlaceholder`, `refuseSensitivePlaceholders`, `isVercelSystemVariable`, `onlyVercelSystemRows` | What a CI-built Vercel bundle compiles against: each app's config keys, taken from Infisical rather than the Vercel project (#834), the recorded env baseline, and the refusal of a sensitive placeholder. |
| `scripts/ci/lib/backup-job-freshness.mjs` | `RUNS_PER_PAGE`, `jobVerdict`, `verdictLogLine`, `runsNewestFirst`, `TIMEOUT_SLACK_MS`, `TIMEOUT_OVERRUN_MS`, `finishedAttempt`, `judgeNewest`, `candidateOlderRuns`, `evaluateJobFreshness`, `readJobFreshness` | The verdict both production backup-freshness watches share for one Nightly Backup job. Its header is the canonical statement of the rules. |
| `scripts/ci/lib/render-health-check-path.mjs` | `EXPECTED_HEALTH_CHECK_PATH`, `readHealthCheckPath` | Reading Render's `serviceDetails.healthCheckPath`, for production-guardrails and staging-conformance. |
| `scripts/ci/lib/db-restore-target.mjs` | `redactDbUrl`, `dbUrlNamesProduction`, `assertDbRestoreTarget` | The production fence `scripts/db-restore.sh` runs before a restore, and `redactDbUrl` before logging a database URL. |
| `scripts/ci/lib/vitest-suite-collection.mjs` | `SUITE_NAME`, `readStaticStringArray`, `matchesGlob`, `matchesAny`, `walkFiles`, `relativePosix`, `silentlySkippedSuites` | Reading a `vitest.config.ts`'s `include` and `exclude`, for the web and landing guards against a spec vitest silently skips (#1788). Not for `scripts/ci/__tests__`, which stays on `node:test`. |

A module that reaches the network takes that access as a parameter (`fetchImpl`, or `backup-job-freshness.mjs`'s `get` and `vercel-cli.mjs`'s `runCommand`), and a poller takes its clock, which is what keeps the suites offline.

### Retry is scoped to idempotent methods, deliberately

`fetchWithRetry` retries `GET`, `HEAD` and `OPTIONS`. It does **not** retry `POST`, `PATCH`, `PUT` or
`DELETE`, and that restriction is load-bearing rather than conservative habit: `deploy-render-production.mjs`
**POSTs to create a deployment**. If the first POST reaches the
provider and only its response is lost — a gateway 502, or the timeout firing on a slow but successful
call — then re-sending it starts a **second deploy**, in production as in staging.

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
deploy scripts' provider calls (Render, Vercel) use `resilientFetch` directly instead.

Retry is off by default; the timeout is not. Without `retry` a call makes exactly one attempt, under
the same timeout `fetchWithRetry` applies. Before
[#2333](https://github.com/pdcarlson/Frapp/issues/2333) such a call was a bare `fetch`, and only
`configure-branch-protection.mjs` passed `retry`, so every watchdog call was unbounded. A GitHub
API that accepted the connection and never answered held each call until undici's own ~300s header
timeout, and two stalls used up a watchdog's `timeout-minutes: 10` before its alert was written.

Two consequences for callers:

- **Retry through `retry: true`, never by passing `resilientFetch` as `fetchImpl`.** `ghRequest`'s
  own deadline would then cover every attempt of the inner loop, and a stall on the first ends them
  all. `validate-deploy-sha.mjs` did this until #2333.
- **`ghGetWithFallback`** retries a GET on the same token, then re-sends it once with a fallback
  token only when the first is refused (401/403). Both backup-freshness watchdogs read Actions
  through it, because an unreadable read there files a P1.

## PR babysitting: wake signals and CI-failure triage

Wake coverage, CI-failure triage, CI branch filters, the CI-wake watchdog, and base-branch sync live in [`pr-babysitting.md`](pr-babysitting.md). Cite that file and a heading, never `§N`. This file keeps PAT policy, environments, TypeScript 7, scheduled conformance, the CI summary table, and the agent dev stack.

## Deploy visibility (`scripts/ci/deploy-alert.mjs`)

`Deploy API` failed **44 of 44 executing runs** between 2026-05-30 and 2026-08-08 and nobody
noticed for 71 days ([#763](https://github.com/pdcarlson/Frapp/issues/763); the credential defect
itself is [#696](https://github.com/pdcarlson/Frapp/issues/696)). Three things compounded, and the
first and third are what the `deploy-outcome` job fixes:

1. **A skipped run is a green run.** The `check-changes` path gate of the time skipped the
   migrate/deploy jobs when a push touched neither the API's source nor `supabase/migrations/`.
   46 of the last 90 runs were green-because-empty, so the Actions list read "mostly healthy"
   while the deploy path was 100% dead. (No path gate is left. Since #2803 staging deploys through
   `deploy-staging.yml`, whose one `deploy` job runs on every eligible push and plans its API
   deploy from the commit staging serves.)
2. **`workflow_run` failures land on no commit and no PR** the way `CI` does — nothing turns red
   anywhere a human normally looks. (Unfixed by design: this is how `workflow_run` works.)
3. **No notification of any kind.** A failed staging migration was indistinguishable from a quiet
   afternoon.

In `deploy-staging.yml` the terminal `deploy-outcome` job `needs` the `deploy` job (the call into `_deploy.yml`) and runs under
`always()` plus that job's own eligibility conditions, so it sees the whole run's shape.
`deploy-production.yml` has one too since #2805 (`ALERT_CONFIG: deploy-production`), gated by its
step `if:` so a dry run, a cancel or a green `migrations-only` run never reaches the script; a
deploy job that never started reaches it and files nothing (below). Per run it does two things:

- **Says what happened.** A step summary and a `::notice::`/`::error::` annotation state plainly
  whether the run **deployed** something, **failed**, found the API **up to date** (a `current`
  plan: the API needed no deploy and was verified; the frontends uploaded only if something they are
  built from changed, #2865), or was
  **superseded**, or (production only) **never started** its deploy job, with a per-job result
  table and the deploy plan. `cancelled` and `timed_out` count as failures. For staging that
  includes a pending job GitHub replaced in its concurrency queue (rare, and closed by the next
  run); production's is decided by the never-started rule below.
- **Raises or clears one alert issue.** On failure it upserts a single tracking issue titled
  *"Deploy staging is failing — merges are not reaching staging"* (`incident`, `area:ci`,
  `P1` by owner decision on #2803, assigned to the owner): created if absent, reopened if closed, otherwise commented — never a fresh issue per
  failure, because alert spam is how alerting gets muted. A later **successful** run for `main`'s
  tip (a deploy, or a verified up-to-date API) closes it as `completed`,
  along with any issue still open under the two titles it replaced (below). So an open alert issue
  means "the deploy path is broken right now". Production's is *"Deploy production failed —
  production may be partly deployed"* (`P1`, like every alert that production is down or drifting), and only a later real
  `full` production run that ships closes it.

After a successful deploy the job also runs `scripts/ci/sentry-sourcemaps-alert.mjs`, which raises
or closes the `P2` source-map alerts from the deploy job's `sourcemaps` verdicts, one per Sentry
project and environment ([#2489](https://github.com/pdcarlson/Frapp/issues/2489);
[`ci-cd.md` § Source maps](../ops/deployment/ci-cd.md#source-maps)). That step is separate
from the two above: it judges what a shipped deploy uploaded, and never reds the job.

A **superseded run never touches the alert**. A run that is not for `main`'s tip (as its checkout
fetched it) plans `forward` when its commit is newer than the one staging serves and changed the
image: it deploys and verifies, because `main` usually moves on while a run waits and the tip's
own run may never deploy, but its success doesn't close the alert, since the tip may still be
failing. A failed forward deploy does raise it. Anything else a non-tip run could do is `stale`:
deploying an older commit would roll staging back, so it deploys no API. Web and landing have their
own rule: a non-tip run uploads them only when both staging hostnames serve older commits and the
API staging will serve carries its API, so a green web-only change still ships when the tip's run
never comes. Only the tip's `deploy` or
`current` run closes the alert. A re-run of an old run still runs the migrations, which can fail
against an older tree and raise the alert. A **no-op** (the `deploy` job did not run) is escalated to a failure, because that
job runs on every eligible push. `incident` is what keeps
`/next` from claiming the alert as backlog work (§0.2 treats that label as never-claimable).

### Several workflows, one script (#1674)

`deploy-alert.mjs` is **not** specific to one workflow. It was written for `deploy-api.yml`, and
#1674 extended it to `deploy-vercel-staging.yml`, which shipped in #1578 with no alerting at all.
From #2431 to #2505 it also served `verify-deployments.yml`, a push-triggered observer of the
staging API's Render deploy; since #2505 the staging workflow creates and polls that deploy itself.
#2803 replaced both staging workflows with `deploy-staging.yml` and their two configs with one,
`deploy-staging`, and #2805 added `deploy-production`, so today two workflows use it. Which
workflow a run is reporting on is chosen by the **`ALERT_CONFIG`** env var, set explicitly in each workflow's
`deploy-outcome` step and resolved against the `ALERT_CONFIGS` table in the script. There is **no
default**: an absent or unknown value throws, because resolving to the wrong config would report one
workflow's job results into another's alert issue — or reopen the live P1 staging alert from an
unrelated failure.

Consequences worth knowing before editing the script:

- **Each config owns its alert title, and no two may match.** The title is the lookup key, so
  a shared one would let one workflow's recovery close another's live alert. A test pins their
  uniqueness. Renaming a title orphans whatever alert is open under the old one, which can then
  never be found or self-closed, unless the config lists the old identity in `retiredAlerts`
  (`defineAlert({ title })` with the old title, byte for byte).
  A run that closes the new alert closes an issue still open under a retired title too.
  `deploy-staging` lists the Deploy API and Deploy Vercel staging titles (#2803).
- **`gateJob` may be null.** `deploy-staging.yml` and `deploy-production.yml` each have one deploy
  job (the call into `_deploy.yml`) and no changed-path gate, so any code assuming a gate exists is
  wrong for both. Production's `validate` is deliberately not a gate job: it fails before anyone
  approves and costs nothing, so it must never alert.
- **A no-op is escalated.** It was benign for Deploy API while a path gate skipped its jobs on
  docs-only pushes. `deploy-staging.yml` has no gate, so a no-op means nothing ran that could
  have, and `noOpIsUnexpected` escalates it to a failure rather than an annotation, which on a
  `workflow_run` run page would be exactly as invisible as the gap this closes. A gated
  config with a benign no-op is still supported, and tested on a stand-in.
- **`planOutput` carries what a job result can't.** `deploy-staging.yml`'s `deploy` job (through `_deploy.yml`'s `plan` output) publishes
  `plan-staging-deploy.mjs`'s verdict (`deploy`, `current`, `forward` or `stale`). The script
  reads it to report a `current` run as up to date rather than deployed, and to leave the alert
  alone on a `stale` run or a successful `forward` one (a failed `forward` deploy still raises).
  `closesOn` makes the issue text say which runs close it.
- **A deploy job that never started is not a failed deploy.** A declined approval ends
  production's `deploy` with no step run and a result a real failure also has. The rule is the
  job, not the cause: `quietWhenNeverStarted` names the caller's deploy job, and the script reads
  **this attempt's** jobs (`GET /repos/{repo}/actions/runs/{id}/attempts/{n}/jobs`, so
  `deploy-outcome` holds `actions: read`). A job listed with no steps ran nothing: the script
  reports `not-started`, raises and closes nothing, and the summary says production is unchanged.
  That a declined approval lists no steps is derived from a skipped job's shape (run 34916333773:
  no `steps`, no `runner_id`), not yet observed; other pre-step ends (an expired approval, the
  environment's branch rule, a pending run replaced in the queue) are handled by the same rule
  if they list no steps, and raise if they don't. Not the run's approval history:
  a re-run keeps the run id, so an earlier attempt's rejection would quiet a later attempt's real
  failure. Not an output of the called job: a failed call may not carry its outputs back. When the
  jobs can't be read, or none has that name, it raises.

The full roster of GitHub-issue watchdogs, with what each one means and when it clears, is
[`alert-routing.md`](../ops/alert-routing.md) § Automated GitHub-issue alerts — that table is the
one home for the list; this section covers only the mechanics of this script.

Channel choice matches the sibling watchdogs: GitHub itself, via a dependency-free `.mjs` on
`GITHUB_TOKEN` with an injectable `fetch`. A staging deploy is merge-driven with no PR to
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
  [`drift-and-ordering.md` § Reconciling a foreign migration row](../ops/database/drift-and-ordering.md#reconciling-a-foreign-migration-row).

**Why scheduled and not post-deploy.** `Deploy API` failed 44 of 44 executing runs for 71 days
(#763). A check that only ran after a successful deploy would have been silent for exactly the
period it was needed — a dead pipeline must not be able to hide drift. The schedule is what would
have caught February.

**What each database is judged against.** Staging deploys on every merge, so it is expected to hold
every migration on `main`. Production moves only when a ship is dispatched, so it is expected to
hold the migrations of the latest `v*` tag, picked by `release.yml`'s own rule (git's version sort)
and required to be a plain `vX.Y.Z`. `deploy-production.yml` mints that tag only after its migrate
step succeeded; a tag minted by a `release.yml` dispatch or by hand asserts the same without
having proved it, so a pending production row points there first. `DRIFT_RELEASED_TARGETS` names
the targets judged this way; the workflow sets `production`, which is also the default for a hand
run, and fetches the `v*` tags into its shallow checkout. A migration merged since that tag is reported as
**unreleased** and never alerts: until 2026-09-28 production was judged against `main`, so every
merged migration reopened the P1 a day later and kept it open until the next ship. How far
production lags `main` is `/needs-me`'s to report, not an incident. A tag that cannot be read makes
production `unknown` (below), never a fallback to `main`, and a failed tag fetch does not stop
staging's check.

**Classification.** `pending` (expected, not applied) · `foreign` (applied, not on `main`, for
production too: a version shipped in the tag and since renamed or deleted on `main` blocks the next
production `db push`) · `unreleased` (on `main`, not in the tag, not applied; reported only) ·
`matched`.
Foreign rows are never graced: a version `main` does not hold blocks `db push` the moment it
appears, whether it was hand-applied and never committed or shipped and then renamed on `main`. The
two need opposite fixes (read and remove the row; mark the old version reverted and the new one
applied), and the alert body says how to tell them apart. Pending rows are tolerated for `PENDING_GRACE_HOURS` (default 24) measured from the
migration's **own 14-digit version timestamp**, which is the only "when was this authored" signal
available without a git or API round-trip — so a migration merged minutes ago is not an alert, and
a back-dated one alerts immediately (deliberately conservative: this check may cry wolf, it may not
stay silent).

**Three verdicts, and the reason there are three.** `drift` raises the alert; `clean` closes it;
`unknown` — a target the Management API could not be read, or one judged against a release whose
tag could not be read — does **neither**. An API blip must not
close a live alert (that is how a real outage gets silenced) and must not open one either (nothing
was observed to be drifting). `unknown` still exits non-zero, so a check that cannot run is a red
run rather than a quiet pass. So does a `clean` run whose open alert could not be read or closed,
since a green run would hide a P1 left open on a healthy environment. Every scheduled watchdog in
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
  [`SECRETS_MANAGEMENT.md`](../internal/environment/SECRETS_MANAGEMENT.md) §5 before drawing conclusions from
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
SMTP, the Magic Link template, and leaked-password protection are a sibling,
`production-auth-conformance.yml`,
with its own alert title so a recovered staging cannot close a live production
incident. Remaining production-parity work on those dashboards moved from #1384 into #2505 (ADR-20, amendment of 2026-09-23).

**Scheduled workflows, one table.** Daily `schedule:` workflows are staggered so no two fire in the
same minute and a dump never races a Management API read of the project it is dumping. The
readiness probe (scheduled every 15 minutes) does not talk to the Management API, so it does not join that stagger:

| Time (UTC) | Workflow | Watches |
| --- | --- | --- |
| 06:15 | `production-backup-env.yml` | GitHub environment `production-backup` has no `required_reviewers` or `wait_timer`. Unreadable or missing is FAIL. `deployment_branch_policy` is ignored. Does not name `environment: production` or `environment: production-backup` |
| 06:30 | `db-backup.yml` | Offsite Postgres dump + Storage mirror; what it covers is [`db-rollback-playbook.md` § Backups: what exists](../ops/db-rollback-playbook.md#backups-what-exists) |
| 07:00 | `check-migration-drift.yml` | Applied migrations match what each database should hold ([§ Schema drift detection](#schema-drift-detection-scriptscicheck-migration-driftmjs)) |
| 07:15 | `production-guardrails.yml` | Render auto-deploy off and tracking `main`, `healthCheckPath` `/health`, and neither Vercel project linked to Git |
| 07:30 | `staging-conformance.yml` | Project health, auth hook, redirect allow list, Auth SMTP, Magic Link template, leaked-password protection, Render `healthCheckPath` `/health`, Render auto-deploy off and tracking `main`, Infisical syncs, and a live sign-in probe against `frapp-staging`. What each asserts: the Staging conformance row in [§ CI/CD summary](#cicd-summary) |
| 07:45 | `production-auth-conformance.yml` | Project health, auth hook, redirect allow list, Auth SMTP, Magic Link template, and leaked-password protection on `frapp-prod` (Site URL pinned to `https://app.frapp.live`). Empty SMTP fails. What each asserts: the Production Auth conformance row in [§ CI/CD summary](#cicd-summary). Does not name `environment: production` |
| 08:00 | `production-release-pin.yml` | Render live commit, Vercel production SHAs, and a peeled `vX.Y.Z` tag agree. Matching `main` is not required. `/health` `commit` is corroboration only. Does not name `environment: production` |
| 08:15 | `supabase-quota.yml` | Each project's disk and the organization's Storage size are clear of the plan's quotas, and every figure is readable. What it asserts: the Supabase quota watch row in [§ CI/CD summary](#cicd-summary) |
| 13:15 | `production-backup-freshness.yml` | Nightly `db-backup.yml` `backup-production` is recent and not failing. What it asserts: the Production backup freshness row in [§ CI/CD summary](#cicd-summary) |
| 14:00 | `production-backup-storage-freshness.yml` | Nightly `db-backup.yml` `backup-production-storage` is recent and not failing. What it asserts: the Production backup storage freshness row in [§ CI/CD summary](#cicd-summary) |
| 19:20 | `routine-heartbeat.yml` | Every scheduled routine's latest run left a `done` run record on the heartbeat issue. Reads only GitHub, so it is placed after the day's last routine rather than in the Management API stagger. What it asserts: the Routine heartbeat row in [§ CI/CD summary](#cicd-summary) |
| every 15 min as scheduled; far less often in practice ([ADR-24](../../spec/architecture/adr/adr-24.md) has the measured gaps) | `production-uptime.yml` | Live `GET https://api.frapp.live/health/ready` — HTTP 200 with JSON `status: "ok"`. Does not name `environment: production` |
| every 4 h at :23, after every `Deploy staging` / `Deploy production` run, and when a store build starts (`_mobile-build.yml`) | `migration-snapshot.yml` | Watches nothing and raises no alert: it publishes both projects' applied-migration history for the PR migration gates (§ GitHub environments and bootstrap secrets). It reads the Management API, and a late start can overlap the 06:30 dump. A failed publish after a deploy shows up as red required migration checks naming it, on the next PR that touches a migration, once the download action's wait runs out. `migration-drift` goes red on every PR, as `stale`, once a migration the snapshot lacks is past its 30-minute grace. A failed scheduled publish with no deploy since shows only when the snapshot passes the 24-hour limit ([#2588](https://github.com/pdcarlson/Frapp/issues/2588)) |

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

**What watches the watchdogs: a check-in outside GitHub, not another watchdog**
([#2333](https://github.com/pdcarlson/Frapp/issues/2333)). A watchdog that stops leaves no alert,
and that silence reads exactly like health. It can stop because its schedule was disabled, because
its run died in `Checkout` or `Setup Node` before the script ran, or because its token lost
`issues: write`. Three answers were weighed:

- **A meta-watch**: one more scheduled workflow asserting that each watchdog ran recently. Rejected.
  It runs on the same GitHub cron, under the same 60-day disable and the same token, so it goes
  silent in the same ways as the jobs it watches.
- **An external dead-man's switch**: each scheduled job checks in to a monitor outside GitHub, and
  a missed check-in pages. **Chosen**, and already settled by
  [ADR-24](../../spec/architecture/adr/adr-24.md): rule I4 (every failure pages within 15 minutes,
  and a skip never reads green) and decision 3 (Sentry Team at the start of the beta, because the
  free plan's single cron monitor can't cover I4). "A check-in from every scheduled workflow" is
  [#2505](https://github.com/pdcarlson/Frapp/issues/2505)'s Team slice.
- **Accept and document**: the state of every watchdog until that slice ships.

Which jobs have a monitor, what each one raises and whether that reaches the owner are owned by
[`alert-routing.md` § Primary channels](../ops/alert-routing.md#primary-channels); on the
free plan the only one is the nightly dump's own. Until the Team slice ships and a test firing
proves the page, the absence of an alert is not evidence of health for any scheduled job.

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
[`SECRETS_MANAGEMENT.md`](../internal/environment/SECRETS_MANAGEMENT.md) records the hard-won rule that "a
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
> (#667, #669, #676), whose common feature was adding allow entries for tools the snapshot omitted:
> the snapshot then carried the `mcp__github__*` wildcard but none of Linear's eight write tools.
>
> **What it does not establish.** Two data points, one absent tool. The older theory — that these
> tools are independently flagged as requiring live user interaction — predicts the same
> observations and is **not excluded**. The clean falsifier: a tool that *is* in the snapshot,
> *is* allowlisted, and still prompts. If you meet one, this rule is wrong; say so here rather than
> hunting a harness bug. Either way the operational advice is unchanged and is the part that
> matters: **when a tool is absent from the snapshot, do not spend a PR on a settings fix** — that
> is the loop that cost #667, #669 and #676. The snapshot observation was recorded at the time (#680), but no
> general rule was drawn from it, which is how three PRs were spent guessing. See [#744](https://github.com/pdcarlson/Frapp/issues/744).

- **Linear retired 2026-08-08** after three PRs (#667, #669, #676) failed to verifiably stop its permission prompts. Record and evidence: [#680](https://github.com/pdcarlson/Frapp/issues/680). The migration PR removed the four Linear allow entries and the `linear-autoallow.sh` PreToolUse hook with its `mcp__.*__(save_.*|get_workspace)` wiring. Lesson: **never write a permission-behavior claim that isn't backed by the owner reporting what they saw**, because an agent cannot observe prompts.
- GitHub MCP reads: `get_me`, `pull_request_read`, `list_pull_requests`, `search_pull_requests`,
  `actions_get`, `actions_list`, `get_job_logs`, `get_check_run`, `get_commit`, `list_commits`,
  `list_tags`, `list_branches`, `get_file_contents`, `issue_read`, `list_issues`, `search_issues`,
  `get_label`, `list_issue_types`, `list_issue_fields` (each as `mcp__github__<tool>`).
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
worked within the limits below; the rest of the family wasn't tried. See [`routines.md`](routines.md). Not an account-side
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

Decision is recorded in [**ADR-12**](../../spec/architecture/adr/adr-12.md) (extending [ADR-11](../../spec/architecture/adr/adr-11.md)): PGlite-backed NestJS tests are the **default substrate** (Paths C+D), a per-session Supabase branch is the **opt-in escape hatch** (Path A), and a rootless in-sandbox stack (Path B) is rejected. Track program-level state in **GitHub Issues** (the agent-infrastructure epic and its sub-issues). This section is the operating doc — what's in the stack today, how to bring it up, what's still blocked.

### What the stack is

Two layers, both runnable from a sandbox with no Docker and no privileged tooling:

1. **Hot-path code is testable in NestJS.** Per ADR-11, chat hot-path writes (`chat-send`, `chat-react`) live in the existing `apps/api` NestJS service alongside cold reads and the in-process push worker (ADR-09). Standard Jest + supertest covers integration; the `SupabaseAuthGuard` the push worker already uses is reused for auth. (It also said `SUPABASE_CLIENT` was reused "for Realtime emit" — as of #472 `ChatService` injects no Supabase client and emits nothing to Realtime, so the chat hot path needs no Realtime-capable substrate to test. The provider itself is unaffected and still injected widely — the repositories under `infrastructure/supabase/`, application services, interface guards, and the two realtime workers. What changed is only that the chat *send* path is no longer one of them.) Since #416 shipped, `supabase/functions/chat-*` is retired and chat-adjacent chunks no longer carry the "Runtime checks BLOCKED" disclaimer.
2. **Migration validation + RLS smoke run on PGlite.** `scripts/pglite/run.mjs` applies every `supabase/migrations/*.sql` to a fresh in-process Postgres-in-WASM and asserts the schema landmarks reviewers care about, plus an **RLS smoke tier** (ADR-12): every `public` table enables RLS (Frapp's default-deny invariant, #360), the chat hot-path tables hold their posture (`chat_channels` default-deny with no policies; `chat_messages` and `chat_message_actions` carry only client-read policies that stay scoped to `auth.uid()` — "no policies" stopped being the invariant for `chat_messages` when `20260816140000_realtime_carrier_repair.sql` gave it one), and `chapter_audit_log` stays append-only. It also verifies policy **enforcement** (#423): non-owner probe roles, with `auth.uid()`/`auth.role()` stubbed per scenario, read the tables for real as a signed-in client and as the anon key — asserting exact visibility sets on `chat_messages` / `chat_message_actions`, and zero rows on `members` / `financial_invoices`, which carry no client-reachable policy and must stay default-deny. Posture alone cannot catch a policy whose shape is fine but whose predicate is wrong; the enforcement tier can — for those four tables only, so a permissive policy on any other table still slips past. The harness creates **Supabase's four roles before applying migrations** (`authenticated`, `anon`, `service_role`, `supabase_auth_admin`), which matters more than it sounds: many migrations wrap their policy, grant and revoke statements in `if exists (select 1 from pg_roles where rolname = '<role>')`, and without the role every one of those blocks is skipped, so a permissive policy written in the repo's own dominant idiom left the whole job green. What remains out of reach: a **real JWT** (GoTrue-minted, so any claim beyond `sub`/`role`), which stays with the NestJS Jest tier, and the `anon` EXECUTE grant hosted adds through `ALTER DEFAULT PRIVILEGES`, which the harness does not replay. Only `docs/ops/database/promotion-log.md`'s per-migration `has_function_privilege('anon', …)` checks cover that, for the functions whose entries carry one (#3052). Roster and limits: [`authorization-model.md` § RLS enforcement](../security/authorization-model.md#rls-enforcement-scriptspglite). Always-on, runs in CI as `pglite-migrations`, and runs identically from any cloud-agent sandbox. No real DB required.

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

Verification that needs a hosted database of the session's own, rather than the local stack or PGlite, takes a per-session Supabase branch. That path needs the Supabase MCP write tools (`create_branch`, `apply_migration`), which an unattended session can't use: why is under [`CLOUD_SANDBOX.md` § Blocked tooling — known list](../internal/environment/CLOUD_SANDBOX.md#blocked-tooling--known-list), and the [#411 spike comment](https://github.com/pdcarlson/Frapp/issues/411#issuecomment-4559934654) shows the failure mode. Live Realtime, Presence and GoTrue-enforced RLS against hosted `frapp-staging` need no branch; they need the staging egress lines, and for an authenticated check a staging smoke credential (see [the protocol below](#runtime-checks-blocked-protocol)).

Per **ADR-12** this is the **sanctioned opt-in escape hatch** (not a hypothetical). It is off by default: a session must explicitly opt in and acknowledge cost. When opted in, a SessionStart hook would:

1. Confirm cost via `mcp__f9f5eb7a-…__get_cost` / `confirm_cost`.
2. `create_branch` against the staging project (one branch per session, never shared).
3. Apply every migration in chronological order via `apply_migration`.
4. Write `SUPABASE_URL` / `SUPABASE_ANON_KEY` / a scoped, short-lived service-role JWT to `apps/*/.env.local`. Never commit — it is gitignored (`.gitignore` + `apps/web/.gitignore`), and the backstop is the pre-commit **gitleaks** scan (`.githooks/pre-commit` → `scripts/scan-secrets.mjs`, default ruleset per `.gitleaks.toml`), whose `jwt` rule has fired on real JWT material in this repo's history ([`secret-scanning.md`](secret-scanning.md)). There is no `*.supabase.co` rule — a project URL is not secret material, so do not rely on one catching a pasted config.
5. SessionEnd hook calls `delete_branch` (idempotent) and confirms via `list_branches`.

This hook does not exist yet — the SessionEnd teardown + scoped MCP write allowlist are tracked as **#532**. Until it lands, the branch path is unavailable; do not work around it in a chunk PR. (Note: `deploy_edge_function` is not part of the bring-up either. The repo's one Edge Function, the Discord importer's attachment copy (ADR-26), deploys only through `_deploy.yml`, never by hand.)

### "Runtime checks BLOCKED" protocol

The disclaimer ADR-11 was written against (chat-adjacent chunks gated on a live Supabase Edge Functions runtime) **retired with #416**. The hot path is now NestJS code that runs in the same Jest tier as the rest of the API, and migrations validate via PGlite — both run in any sandbox.

An environment that carries the live staging egress lines blocks less than this protocol assumes: live Realtime / Presence and RLS-as-enforced-by-GoTrue can be exercised against hosted `frapp-staging`. An authenticated check also needs a staging smoke credential, which doesn't exist yet (#893), so budget one as blocked until it does. What this session can reach, push included, is in [`CLOUD_SANDBOX.md` § Live staging egress](../internal/environment/CLOUD_SANDBOX.md#live-staging-egress) and its § Still out of scope; how to use staging: [`live-verification`](../../.claude/skills/live-verification/SKILL.md).

If a chunk crosses a boundary the sandbox still can't reach (push fanout; anything needing production; anything needing Realtime/GoTrue where the egress or the credential is in fact absent):

- **Do not check the verification box.** Mark it blocked.
- File or link a tracking issue (`#401` is the agent infra parent; #235 closed-as-subsumed by ADR-11 and should not be reopened — file a fresh issue scoped to the new gap).
- In the chunk PR body, list each blocked step + the linked issue + which class of verification is missing.
- Record the same on the tracking issue — work status lives in **GitHub Issues**, not in a
  status doc ([`../internal/DOCUMENTATION_CONVENTIONS.md`](../internal/DOCUMENTATION_CONVENTIONS.md) § Where a fact
  lives — "work status is not a doc"; [`github-pm.md`](github-pm.md)).

### Sandbox-blocked tooling

The known list lives in [`CLOUD_SANDBOX.md` § Blocked tooling — known list](../internal/environment/CLOUD_SANDBOX.md#blocked-tooling--known-list). Add a new block there, in the PR that finds it.
