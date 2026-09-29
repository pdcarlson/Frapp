## 10. CI/CD Pipeline

### How Deployments Are Gated

**Staging** is gated behind CI success and runs on its own:

1. **PR created** → CI runs domain-specific jobs in parallel. Vercel deployments do not run for feature/PR branches.
2. **All checks pass** → PR is mergeable (branch protection enforced).
3. **PR merged** → Push event triggers the staging deploy pipeline (`workflow_run` waits for CI).
4. **Staging pipeline**: the **Deploy staging** workflow ([`deploy-staging.yml`](../../../../.github/workflows/deploy-staging.yml)) calls the shared deploy job ([`_deploy.yml`](../../../../.github/workflows/_deploy.yml), since [#2804](https://github.com/pdcarlson/Frapp/issues/2804)) with `environment: staging`. That one job, `deploy`, runs in the `staging` environment for its secrets, and the caller passes `secrets: inherit`: without it GitHub released none of them to the called job (run 36479856561, stopped by the job's first step before anything shipped). That `inherit` makes them arrive is from [actions/runner#4453](https://github.com/actions/runner/issues/4453) until the first run with it, recorded on #2804; the first step checks on every run. It works on the commit CI verified, in this order:
   1. Check out that commit with full history. `npm ci` and the pinned Vercel CLI install before any secret is present.
   2. Move the workspace to the trusted ref (`github.sha`, `main`) for the pieces that must not come from the commit being deployed: the Supabase CLI setup and the Infisical injection (local actions), the provider ids (from `.github/environments.json`, [#2806](https://github.com/pdcarlson/Frapp/issues/2806)), and a copy of the served-commit check. Record the environment baseline, inject Infisical `staging`, then check the deployed commit back out. `_deploy.yml`'s header has the reasoning (#2805).
   3. **Plan** (`plan-staging-deploy.mjs`), read-only. The API deploys when something its image is built from changed since the commit staging serves. Web and landing upload when something they are built from (`FRONTEND_BUILD_PATHS`) changed since what the staging hostnames serve ([#2865](https://github.com/pdcarlson/Frapp/issues/2865)); for `main`'s tip, also when it can't tell (a hostname it can't read, a commit on another history, a diff that fails). Any other commit uploads only when both hostnames serve older commits. Nothing uploads over a hostname serving a newer commit. Either way, it uploads only when the API staging will serve carries the commit's API. A re-run of the tip's run uploads even when nothing changed, which is how a rotated build-time value reaches staging. The script header has the reasoning.
   4. Migrations dry-run, listing what is pending, on every run.
   5. **Build** web and landing (`deploy-vercel.mjs`, `DEPLOY_PHASE=build`, Preview target) when the plan uploads. Each project's `.vercel` is stashed under `$RUNNER_TEMP`.
   6. Migrations apply, on every run.
   7. Deploy the Supabase Edge Functions (`deploy-edge-functions.mjs`) unless the plan is `stale`, which would roll one back. They go before the API because the API calls them ([Supabase § Edge Functions](supabase.md#edge-functions)).
   8. Deploy the commit to Render when the plan says so, and verify the API serves the planned commit (`verify-served-commit.mjs`) whenever anything ships. [Deploy verification](#deploy-verification) has the detail.
   9. **Upload** web and landing (`DEPLOY_PHASE=upload`) when the plan says so, then alias `app.staging.frapp.live` and `staging.frapp.live` to the new deployments.

   After a successful `deploy` job, a separate `prune-vercel-staging` job (`prune-vercel-staging.mjs`, checked out at `main`) deletes all but the newest `KEEP_PREVIEWS` preview deployments of each project, never a production deployment or one a staging hostname serves. Vercel counts every retained deployment against the Hobby team's Function Storage, which production shares (#2865). A failure there fails that job only, not the deploy, and raises no alert.

   Each step runs only when the ones before it passed. So a failed build, migration or API verify ships no frontend, and new frontends never go live before the migration and API they call. A run that isn't `main`'s tip never rolls anything back: the API plans `stale` when nothing moves it forward, and web and landing upload only over hosts serving older commits. The job holds the `db-migrate-staging` concurrency group with `cancel-in-progress: false`, so one staging deploy runs at a time and a running one is never cancelled. GitHub still replaces a *pending* run when a third arrives; that run ends `cancelled` and raises the alert, and the next run carries its changes. A `deploy-outcome` job then raises or closes the P1 staging alert ([`ALERT_ROUTING.md`](../ALERT_ROUTING.md#automated-github-issue-alerts)). Production runs the same job, with its own layers (steps 4 to 7 below).

> ⚠️ **2026-09-02:** step 4 used to say "frontends auto-deploy to Preview (Vercel)". That path died
> with the Git unlink (ADR-21). CI-driven staging deploys landed in #1578. See
> [§ 4 Vercel Setup](vercel.md).
>
> **Corrected 2026-09-28 (#2803):** until #2803 step 4 read as one sequence, and it was not. The
> same CI run started two staging workflows side by side: `deploy-api.yml` (**Deploy API**: migrate,
> then Render) and `deploy-vercel-staging.yml` (**Deploy Vercel staging**: build and upload web and
> landing in one phase, then alias). Nothing ordered them, so new frontends could go live before the
> migration or the API they call, and a failed migration shipped them anyway. `deploy-staging.yml`
> replaced both.

**Production** is gated behind a person, and runs only when asked. Dispatch **Deploy
production** with a commit SHA. After `validate`, it calls the same `_deploy.yml` job staging
does, with `environment: production` ([#2805](https://github.com/pdcarlson/Frapp/issues/2805)); its
layers are that job's steps named `inputs.environment == 'production'`:

1. **Typed confirmation** (`DEPLOY TO PRODUCTION`) — checked in an unscoped `validate` job before any secret is read and before GitHub asks anyone to Approve.
2. **Commit validation** — trim, then the SHA must be an ancestor of `main` _and_ have green CI, asserted against the required-check list branch protection uses, intersected with the jobs that commit's own workflows define (`scripts/ci/validate-deploy-sha.mjs`). Still unscoped. A bad paste fails here with no reviewer request (run 34234768094 sat on Approve, then died at Validate).
3. **Environment approval** — the shipping job (`deploy`, `_deploy.yml`'s) pauses on the `production` environment's Required reviewers. This is the only human gate, and it fires after `validate` succeeds, on a run that names the commit. Do not put `environment: production` on `validate`.
4. **Installs, then the trusted window** — `npm ci` and the Vercel CLI install on the deployed commit before any secret is injected (#2801). Then the job moves to the trusted ref (the dispatched `main`) for the local actions, the provider ids (from `.github/environments.json`, so a rollback ships to the services today's config names), the preflight below and the Infisical `prod` injection, and checks the deployed commit back out.
5. **Provider preflight** — Render auto-deploy is off; `healthCheckPath` is `/health`; neither Vercel project is linked to Git (`scripts/ci/production-guardrails.mjs`). The Vercel half asserted "does not promote from `main`" until #1579 inverted it on 2026-09-02; post-ADR-21 the safe condition is the _absence_ of a Git link, so a **present** link is the violation.
6. **Migration rehearsal** → fence → dry-run → **Vercel production builds**
   (both projects, `vercel pull --environment=production` + `vercel build --prod`, each `.vercel`
   stashed under `$RUNNER_TEMP`) → apply → **Edge Functions** (`deploy-edge-functions.mjs`, skipped
   on a dry run and under `migrations-only`).
7. **Render deploy by `commitId`** → **served-commit check** (`verify-served-commit.mjs`: `/health/ready`
   answers 2xx and reports this commit) → **Vercel production uploads** (each stash restored and
   shipped with `vercel deploy --prebuilt --prod`) → **tag**. A failure after the approval opens the
   P1 *Deploy production failed* alert issue ([`ALERT_ROUTING.md`](../ALERT_ROUTING.md#automated-github-issue-alerts)).

> **Corrected 2026-09-28 (#2805):** until #2805 production had its own copy of these steps in
> `deploy-production.yml`, with three differences that were accidents: `npm ci` and the Vercel CLI
> install ran after the Infisical `prod` injection (#2801), the API check was a `curl` loop that
> accepted any 2xx from `/health/ready` without checking the served commit, and the `report` job
> (now `deploy-outcome`) wrote a step summary but filed no alert. The notes below that name
> `report` or the health smoke check describe that version.

> ℹ️ **`scope: full` reaches a working Vercel step again as of #1578 (2026-09-04).** The two issues
> ADR-21 left behind are both closed: #1579 removed the provider-preflight block, and #1578 replaced
> the `gitSource` POST — which only meant anything while the Git integration existed — with
> `vercel build --prod` on the runner followed by `vercel deploy --prebuilt --prod`.
>
> ℹ️ **Since 2026-09-06 the Vercel BUILD happens before the apply.** `deploy-vercel.mjs` runs twice:
> `DEPLOY_PHASE=build` in step 6, before a byte of production has changed, and `DEPLOY_PHASE=upload`
> in step 7. The build is the half that fails for reasons unrelated to the commit — the OOM killer,
> an app key missing from Infisical `prod`, a registry blip — and it used to run last,
> which is how run 33275321347 left a migrated database and a new API under six-month-old frontends
> with no tag. Now a build failure costs nothing; only the upload, a far smaller surface, can still
> fail after the apply. That residual is a property of the shipping path's one-job design
> (ADR-20: migrate / Render / Vercel / verify stay one `environment: production` job so one
> approval; SHA confirmation, trim, and validation are a prior unscoped job). Splitting the
> shipping job would still turn one approval into four. **Amended 2026-09-08.** `release` is
> separate because `workflow_call` cannot be a step, and `report` errors loudly when the
> deploy succeeded and the tag did not.
>
> **2026-09-07 observation (run 34155737950).**
> First live `full` after #1578. Applied production migrations at 19:33:13Z, Render at 19:33:20Z
> (`dep-dafh307qj5pc73fall9g`), Vercel `--prebuilt --prod` upload at 19:36:02Z, then tagging failed on
> `GET /pulls/1340` (an issue number in a squash subject). The Actions list row stayed named
> **Deploy production** and concluded **failure**. That is not "API before DB" and not a
> rolled-back ship: open the run, read `report` (`DEPLOY_RESULT: success`, _Production IS
> updated_). Re-run the **Release** workflow with the live SHA. Job ids on that run were `deploy` /
> `release` / `report` (`needs:` keys those); the UI labels now say migrate-then-ship,
> mint-tag, and summarize. **Amended 2026-09-08:** an unscoped `validate` job now runs first
> (confirm / trim / `validate-deploy-sha.mjs`); `release` and `report` still consume
> `needs.deploy.outputs.*`.
>
> **Amended 2026-09-14** — both claims this paragraph used to make about `run-name` and
> `dry_run_only` are superseded. It said `run-name` is `{scope} {sha}` and that `dry_run_only`
> "still does not cover the Vercel path (those steps carry `if: !inputs.dry_run_only`)".
> A dry run now **does** cover the Vercel build: `npm ci`, the Vercel CLI install and
> `DEPLOY_PHASE=build` are gated on `scope != 'migrations-only'` alone. The upload, the
> migration apply, the Render deploy and the health check are still real-run only, so the
> shipping path is unchanged. `run-name` now prefixes `DRY RUN · ` when `dry_run_only` is set,
> because the two used to render identical rows in the Actions list.
>
> Staging's counterpart is **Deploy staging** (`deploy-staging.yml`, after green CI on `main`;
> step 4 of the staging list above). It replaced the staging-only **Deploy API** and **Deploy
> Vercel staging** workflows in #2803.
>
> On 2026-09-06 the `frapp-web` Production scope was found to hold **none** of
> `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`,
> `NEXT_PUBLIC_LANDING_URL` (nor `frapp-landing` `NEXT_PUBLIC_APP_URL`) — they existed only on
> Preview, as manual rows from 2026-02-28 — so the first production build would have compiled a
> broken bundle. They were written to the Production scope by API that day; the source-of-truth fix
> is the Infisical `prod` environment (see `SECRETS_MANAGEMENT.md` § Blast radius).
>
> **They did not stay written. Amended 2026-09-14, corrected 2026-09-15** — read the paragraph
> above as history, not as current state. Production builds that day died on these variables, but
> on _one at a time_, and the second attribution below was wrong for a full day:
>
> - [34894763676](https://github.com/pdcarlson/Frapp/actions/runs/34894763676) died on
>   `NEXT_PUBLIC_API_URL`, at config load, inside `next.config.js` — the early guard firing exactly
>   as designed: `⨯ Failed to load next.config.js`, with a frame at
>   `assertProductionWebPublicEnv` called from `next.config.js`. That frame is reachable only
>   _past_ that function's first statement — the `vercelEnv !== "production"` early return — so
>   `VERCEL_ENV` really is `production` inside `vercel build --prod` on the GitHub runner. (The
>   run's stack reads `lib/assert-production-public-env.js:88:3`; those are the line numbers as of
>   `dcc5cd7`, and the file has grown since — trust the symbol, not the number.)
> - [34896647837](https://github.com/pdcarlson/Frapp/actions/runs/34896647837) and
>   [34905005744](https://github.com/pdcarlson/Frapp/actions/runs/34905005744) did **not** die on
>   `NEXT_PUBLIC_SUPABASE_URL`. Both logged `✓ Running next.config.js took …ms` — i.e. the guard
>   ran and _passed_, which is positive evidence that both URLs were present and correct — and then
>   died prerendering `/` in `apps/web/lib/supabase/server.ts`. That throw names two variables while
>   `server.ts:13` tests `!url || !anonKey`, so the message could not say which was absent. It was
>   `NEXT_PUBLIC_SUPABASE_ANON_KEY`: run 34905005744's build-step environment lists
>   `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL` and the _unprefixed_ `SUPABASE_ANON_KEY`, and
>   no `NEXT_PUBLIC_SUPABASE_ANON_KEY` at all.
>
> The lesson is narrower than "the sync dropped everything": Infisical `prod` is missing the
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `${SUPABASE_ANON_KEY}` reference that ENV_REFERENCE.md
> § References — Framework-Specific Names requires in all three environments. The unprefixed key
> alone never reaches the bundle, because Next inlines only `NEXT_PUBLIC_*`. `NEXT_PUBLIC_POSTHOG_KEY`
> and `NEXT_PUBLIC_POSTHOG_HOST` are absent from that scope too; they degrade silently (analytics
> off) rather than failing the build.
>
> **Corrected 2026-09-28 (#2673):** a production build no longer reads the Vercel Production scope
> at all. It takes each app's keys from Infisical `prod`, the pulled file keeps only Vercel's system
> variables (#2810), and a required key Infisical lacks fails the build before anything compiles,
> naming the key
> (`The Infisical injection supplied no value for …`). So when a production build fails on a
> `NEXT_PUBLIC_*`, look in Infisical `prod`, not in Vercel, and read the build log's
> `App config from Infisical:` line for the keys each build received. Do not read a `server.ts` throw
> as naming the absent variable. The fix is a human edit in Infisical `prod` at path `/`: the repo
> cannot make it.

> **Deploying an OLDER commit.** That intersection in step 2 is deliberate, and it is what
> keeps an incident rollback possible. A required check added _after_ a commit was made could
> never have run on it, so it is reported _not applicable_ — named in the run log, never waved
> through silently — rather than refusing the deploy.
>
> Three things stay fatal, and they are why the narrowing is safe to have:
>
> - a check whose job that commit **does** define and which never reported;
> - a check defined in **neither** that commit nor `main` — that is a stale required-check
>   roster naming a job nothing defines, not an old commit, so it is never excused;
> - a run concluding `cancelled`, `timed_out` or `stale`. All three are refused, but reported
>   apart from a genuine failure and carrying the re-run remedy in the message, because a
>   superseded run asserted nothing rather than failing.
>
> And if the narrowing would excuse _every_ required check, the deploy is refused outright: that
> is a tree whose workflows could not be read, not a commit that predates a gate.
>
> Full account, including the incident that prompted it:
> `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md` § 1) Fast forward-fix (preferred), under the
> **Deploying an OLDER commit** callout.

There used to be two human gates: the `main` → `production` promotion PR's required
review, and then this environment approval after merge, on a click nobody was paged for.
That second click was measured holding a one-migration apply for 29m52s (evidence:
`docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap secrets). #1340
kept the approval and dropped the promotion PR, so the surviving gate is the one where a
human is actually looking at what is about to ship.

### Required Status Checks

The full list of CI jobs required for merge is in
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../GITHUB_BRANCH_PROTECTION_RUNBOOK.md) **§ Required Status
Checks** — the single hand-kept copy of the `CI_CHECKS` / `DOCS_CHECKS` / `DRIFT_CHECKS` arrays in
[`scripts/ci/lib/required-checks.mjs`](../../../../scripts/ci/lib/required-checks.mjs).

### API build parity (Render / Docker)

Render builds the API with `nest build` inside `apps/api/Dockerfile` (see the builder stage). That uses `tsconfig.build.json`, which can surface TypeScript errors that never ran in CI if the API workspace had no `check-types` task aligned with that config.

CI now runs **`npm run build -w apps/api`** in `lint-and-typecheck` (same `nest build` as production) and **`docker build -f apps/api/Dockerfile .`** in a separate `api-docker-build` job so the image layer that compiles the API is exercised on every push and PR. **`api-docker-build`** is a required status check for merge (listed in `scripts/ci/lib/required-checks.mjs` and applied by [`scripts/configure-branch-protection.mjs`](../../../../scripts/configure-branch-protection.mjs); after changing CI job names the roster has to be re-applied — a **human step**, run with an admin PAT). **From an agent session run `npm run configure:branch-protection:verify` and nothing else.** The bare `npm run configure:branch-protection` is a LIVE `PUT` of the whole protection payload, and `npm run configure:branch-protection --dry-run` **without the `--` separator** is swallowed by npm — the script then sees no flags and applies. Procedure: [`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

**A green build is not a startable image.** `api-docker-build` compiles the image; it long said
nothing about whether the container can start. #1160 is what that gap costs: the runner stage
copied `/app/node_modules/` and `/app/apps/api/node_modules/` but none of the `packages/*/node_modules/`
trees, so the image was correct only while npm hoisted every workspace dependency to the root. When
`colorjs.io` moved to `packages/chapter-theme/node_modules/` (2026-08-17) and then `zod` to
`packages/validation/node_modules/` (2026-08-20), each vanished from the image. **`verify-render-api`
then failed on 67 consecutive pushes to `main` while this job stayed green on every one of them**,
with Render reporting `update_failed` — a post-build state, which is why the build logs looked clean.
The 67 failures are counted from the Actions API; the `MODULE_NOT_FOUND` cause was read from Render's
runtime logs on two sampled dates in that window (`colorjs.io` on 08-18, `zod` on 08-21) rather than
on all 67.

Two consequences worth carrying:

- **The Dockerfile now copies each workspace package's `node_modules/`**, and `prod-deps` `mkdir -p`s
  every tree the runner copies. The guard has to run in both directions: a dependency that hoists to
  the root leaves `packages/<name>/node_modules` absent, and one forced down by a version conflict
  leaves it present — either way an unguarded `COPY` fails or silently ships an incomplete image.
- **`api-docker-build` now boots the image and probes `/health`** before passing. The build step sets
  `load: true` so there is an image to run, and the probe supplies obviously-fake values for every
  variable [`env.validation.ts`](../../../../apps/api/src/config/env.validation.ts) requires at boot —
  no secret is needed, because `/health` answers `200` without a working database ([Health Check](render.md#54-health-check)). Read the
  count off that array rather than from here: a total typed into prose has no mechanism to keep it
  true, and this sentence has already been wrong once for that reason.

**What this gate can't see:** Render's own build of the merged commit. `deploy-staging.yml` creates that deploy after the merge and polls it ([Deploy verification](#deploy-verification)), and alerts when it fails. It can't gate a merge, because Render deploys after it; building the same Dockerfile here is what can.

### Deploy verification

Every deploy is verified by the workflow that created it, by the id it was handed. There is no push-triggered observer.

- **Staging API** (`deploy-staging.yml` calling `_deploy.yml`'s job `deploy`; [#2505](https://github.com/pdcarlson/Frapp/issues/2505), [#2803](https://github.com/pdcarlson/Frapp/issues/2803)): first, before anything is built or applied, [`plan-staging-deploy.mjs`](../../../../scripts/ci/plan-staging-deploy.mjs) compares the commit CI verified with the one staging serves (`/health`'s `commit`). It deploys when anything the API image is built from changed since then, so an API commit whose own run never deployed is carried by the next one and a failed build is retried. A run that is not for `main`'s tip (as its checkout fetched it) still deploys `forward` when its commit is newer than the served one and changed the image, since the tip's own run may never deploy, but only the tip's run can close the alert. Anything else such a run would do is `stale`: it deploys no API, and a green one neither raises nor closes the alert, so re-running an old run can't roll staging back or clear an alert the tip's run raised (its migrations still run, and can fail against the older tree). When nothing needed deploying and the run is for `main`'s tip, the plan is `current`: it verifies the served commit, and the summary says up to date rather than deployed. When it can't tell, the tip deploys. [`deploy-render-production.mjs`](../../../../scripts/ci/deploy-render-production.mjs) (named for its first caller; production's deploy runs it from the deployed commit's tree, so the name stays) then creates a Render deploy for that commit and polls that deploy id. `live` passes; `build_failed` / `update_failed` / `pre_deploy_failed`, a superseded `canceled` / `deactivated`, a 401/403/404, three failed reads in a row, or no terminal state within 20 minutes fails. Then [`verify-served-commit.mjs`](../../../../scripts/ci/verify-served-commit.mjs) polls `API_HEALTHCHECK_URL` + `/ready` until it answers 2xx **and** its `commit` is the planned SHA (the served one, when the plan deployed nothing), for up to 5 minutes, whenever anything ships. Render's `live` only means the new instance passed `GET /health`, and a bare 2xx can come from the old instance while the new one switches in. A missing `API_HEALTHCHECK_URL` fails the job. Staging deploys serialize on the `db-migrate-staging` concurrency group, so one run's deploy never cancels another's. A failure fails the job, and `deploy-outcome` raises the Deploy staging alert.
- **Staging web and landing** (the same `_deploy.yml` job): built before the migrations and uploaded only after the API verify passes, when the plan says so (the rule is step 3 of [§ How Deployments Are Gated](#how-deployments-are-gated); the plan reads each staging hostname's `meta.githubCommitSha`). It creates each deployment from CI and verifies it by id; see [`deploy-vercel.mjs`](../../../../scripts/ci/deploy-vercel.mjs).
- **Production** (`deploy-production.yml` calling the same `_deploy.yml` job, since [#2805](https://github.com/pdcarlson/Frapp/issues/2805)): the same Render script, the same served-commit check (for a `migrations-only` run, on the commit production already serves, which must stay ready on the new schema) and the Vercel deployer, inline in the release, so a bad deploy fails the release rather than being reported after it. The served-commit check runs from a copy taken at the trusted ref, so a rollback to a commit from before the script existed still verifies. A failure raises the P1 Deploy production alert.

Until 2026-09-25 staging was verified from the side: `verify-deployments.yml` ran on every push to `main` and polled Render's deploy list for the pushed SHA, because Render auto-deployed every push. It could only guess whether a missing deploy was a problem, treated a superseded deploy as neutral, and was retired when staging moved to deploy-by-commit.

- *History:* **Vercel web** (`verify-vercel-web`) and **Vercel landing** (`verify-vercel-landing`) were jobs in that observer, ⚠️ **removed 2026-09-02 by #1579** — ADR-21's Git unlink means no push creates a Vercel deployment, so these jobs could only ever fail. What follows describes the semantics `verify-vercel-deploy.mjs` still implements; the script is kept and is now imported by `deploy-vercel.mjs` for its terminal-state vocabulary, though no workflow calls it directly. **#1578** (2026-09-04) did not re-wire it here: `deploy-vercel-staging.yml` (now `deploy-staging.yml`) creates the deployments and so verifies them **by id**, which is strictly better than searching for one by SHA, and it must stay CI-gated where that workflow was push-triggered. Historically they failed on `ERROR`. Treat `CANCELED` as neutral **only when a later deployment on the same branch overtook it** — the signature of Vercel auto-cancelling a build that a newer push superseded, where the branch is still verified by the build that overtook it (and that build has its own verify run, so the later deployment need not be `READY` yet). A cancel that nothing overtook is a failure: it was a manual stop, a build concurrency limit, or an Ignored Build Step that skipped it. Note the test looks **forward**, not backward. Asking whether an _earlier_ success exists was the right question while `turbo-ignore` ran — an earlier success was the baseline a skip diffed against — but on `main` one always exists, so as a supersession test it would call every cancel benign. "No deployment for this SHA within 3 minutes" is also a **failure**. It was neutral while `ignoreCommand` ran `turbo-ignore`, which legitimately suppressed a build for an unchanged app tree; both apps now pin `ignoreCommand: "exit 1"`, so with `git.deploymentEnabled.main = true` every push to `main` must produce a deployment row for both projects and a missing one means the Git integration did not fire. ⚠️ **2026-09-02:** that is now the permanent state — both projects are unlinked from Git (ADR-21), so a missing deployment row is expected rather than a red flag. Both jobs failed on every push (`verify-vercel-landing` since 2026-09-01, `verify-vercel-web` since 2026-09-02) until #1579 removed them; only the verify step ever failed, the alias step after it was skipped. See the dated note at the top of [Vercel Setup](vercel.md).

The staging deploy is not a required check: it runs after the merge, on `workflow_run`, where a red run notifies nobody. So its `deploy-outcome` job raises an alert issue on failure and closes it when a later run deploys ([`ALERT_ROUTING.md`](../ALERT_ROUTING.md#automated-github-issue-alerts)). The failure message in the run log names the commit SHA and the last observed state; open the Render dashboard to read the full deploy log.

Script implementations and unit tests live under [`scripts/ci/`](../../../../scripts/ci/).

### Secrets in CI vs CD

**CI (lint, typecheck, tests)** does **not** use any runtime secrets. No Supabase, Stripe, or Vercel credentials are needed.

**CD (deploy workflows)** uses Infisical-injected runtime secrets in `_deploy.yml`, the job `deploy-staging.yml` (staging) and `deploy-production.yml` (production) both call. Variable names are **unified** across environments ([`SECRETS_MANAGEMENT.md` § Key Design Principles](../../environment/SECRETS_MANAGEMENT.md#key-design-principles)). Each workflow resolves secrets at runtime from Infisical using the environment slug for its target (`staging` for `main`, `prod` for a production deploy). Which variables it reads, and what each is for, is kept in one place: [`ENV_REFERENCE.md` § CD Secrets](../../environment/ENV_REFERENCE.md#cd-secrets-deploy-workflows-only).

Two GitHub secrets bootstrap the Infisical connection: `INFISICAL_MACHINE_IDENTITY_ID` and `INFISICAL_CLIENT_SECRET`. Like every GitHub secret here they belong in environments restricted to `main`, never in repository scope, because a repository secret is readable from any branch ([#2518](https://github.com/pdcarlson/Frapp/issues/2518)). The deploy-time values themselves come from Infisical at job time ([`SECRETS_MANAGEMENT.md` § GitHub Actions is not a sync](../../environment/SECRETS_MANAGEMENT.md#github-actions-is-not-a-sync)). Which environment holds which secret, including the provider API tokens the deploy workflows use: [`AGENT_INFRA.md` § GitHub environments and bootstrap secrets](../../ci-cd/AGENT_INFRA.md#github-environments-and-bootstrap-secrets).


---
