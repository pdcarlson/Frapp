## 10. CI/CD Pipeline

### How Deployments Are Gated

**Staging** is gated behind CI success and runs on its own:

1. **PR created** → CI runs domain-specific jobs in parallel. Vercel deployments do not run for feature/PR branches.
2. **All checks pass** → PR is mergeable (branch protection enforced).
3. **PR merged** → Push event triggers the staging deploy pipeline (`workflow_run` waits for CI).
4. **Staging pipeline**: DB migration (dry-run → apply) → API deploy (Render) → `deploy-vercel-staging.yml` deploys web and landing (Preview target) and aliases the staging hostnames.

> ⚠️ **2026-09-02:** step 4 used to say "frontends auto-deploy to Preview (Vercel)". That path died
> with the Git unlink (ADR-21). CI-driven staging deploys landed in #1578. See
> [§ 4 Vercel Setup](vercel.md).

**Production** is gated behind a person, and runs only when asked. Dispatch **Deploy
production** with a commit SHA:

1. **Typed confirmation** (`DEPLOY TO PRODUCTION`) — checked in an unscoped `validate` job before any secret is read and before GitHub asks anyone to Approve.
2. **Commit validation** — trim, then the SHA must be an ancestor of `main` *and* have green CI, asserted against the required-check list branch protection uses, intersected with the jobs that commit's own workflows define (`scripts/ci/validate-deploy-sha.mjs`). Still unscoped. A bad paste fails here with no reviewer request (run 34234768094 sat on Approve, then died at Validate).
3. **Environment approval** — the shipping job (`deploy`) pauses on the `production` environment's Required reviewers. This is the only human gate, and it fires after `validate` succeeds, on a run that names the commit. Do not put `environment: production` on `validate`.
4. **Provider preflight** — Render auto-deploy is off; `healthCheckPath` is `/health`; neither Vercel project is linked to Git (`scripts/ci/production-guardrails.mjs`). The Vercel half asserted "does not promote from `main`" until #1579 inverted it on 2026-09-02; post-ADR-21 the safe condition is the *absence* of a Git link, so a **present** link is the violation.
5. **Migration rehearsal** → fence → `npm ci` + Vercel CLI → **Vercel production builds** (both
   projects, `vercel pull --environment=production` + `vercel build --prod`, each `.vercel` stashed
   under `$RUNNER_TEMP`) → dry-run → apply.
6. **Render deploy by `commitId`** → health smoke check → **Vercel production uploads** (each stash
   restored and shipped with `vercel deploy --prebuilt --prod`) → **tag**.

> ℹ️ **`scope: full` reaches a working Vercel step again as of #1578 (2026-09-04).** The two issues
> ADR-21 left behind are both closed: #1579 removed the provider-preflight block, and #1578 replaced
> the `gitSource` POST — which only meant anything while the Git integration existed — with
> `vercel build --prod` on the runner followed by `vercel deploy --prebuilt --prod`.
>
> ℹ️ **Since 2026-09-06 the Vercel BUILD happens before the apply.** `deploy-vercel.mjs` runs twice:
> `DEPLOY_PHASE=build` in step 5, before a byte of production has changed, and `DEPLOY_PHASE=upload`
> in step 6. The build is the half that fails for reasons unrelated to the commit — the OOM killer,
> a Production env var the Infisical sync never delivered, a registry blip — and it used to run last,
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
> rolled-back ship: open the run, read `report` (`DEPLOY_RESULT: success`, *Production IS
> updated*). Re-run the **Release** workflow with the live SHA. Job ids on that run were `deploy` /
> `release` / `report` (`needs:` keys those); the UI labels now say migrate-then-ship,
> mint-tag, and summarize. **Amended 2026-09-08:** an unscoped `validate` job now runs first
> (confirm / trim / `validate-deploy-sha.mjs`); `release` and `report` still consume
> `needs.deploy.outputs.*`. `run-name` is `{scope} {sha}`. `dry_run_only` still does not cover
> the Vercel path (those steps carry `if: !inputs.dry_run_only`).
>
> The similarly named **Deploy API** workflow is staging only (`deploy-api.yml`,
> `frapp-api-staging` after green CI on `main`). Its alert-issue title is an exact-match lookup
> key and is not renamed (`scripts/ci/deploy-alert.mjs`).
>
> On 2026-09-06 the `frapp-web` Production scope was found to hold **none** of
> `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`,
> `NEXT_PUBLIC_LANDING_URL` (nor `frapp-landing` `NEXT_PUBLIC_APP_URL`) — they existed only on
> Preview, as manual rows from 2026-02-28 — so the first production build would have compiled a
> broken bundle. They were written to the Production scope by API that day; the source-of-truth fix
> is the Infisical `prod` environment (see `SECRETS_MANAGEMENT.md` § Blast radius).

> **Deploying an OLDER commit.** That intersection in step 2 is deliberate, and it is what
> keeps an incident rollback possible. A required check added *after* a commit was made could
> never have run on it, so it is reported *not applicable* — named in the run log, never waved
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
> And if the narrowing would excuse *every* required check, the deploy is refused outright: that
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

**Optional hardening (not implemented here):** poll the Render [Deploys API](https://render.com/docs/deploys) after CI for the commit SHA and fail if the deploy never leaves `build_in_progress` / reaches `build_failed` — closest to “exactly what Render does,” but slower and flakier than building the same Dockerfile in Actions.

### Deploy verification (observer workflow)

After a push to `main`, `.github/workflows/verify-deployments.yml` polls Render to confirm the **staging** deploy for that SHA reached a healthy terminal state:

- **Render** (`verify-render-api`): fails on `build_failed` / `update_failed` / `pre_deploy_failed` or on "no deploy created for this SHA within 5 minutes" (autoDeploy-wiring red flag). Treats `canceled` / `deactivated` as neutral (superseded).
- **Vercel web** (`verify-vercel-web`) and **Vercel landing** (`verify-vercel-landing`): ⚠️ **removed 2026-09-02 by #1579** — ADR-21's Git unlink means no push creates a Vercel deployment, so these jobs could only ever fail. What follows describes the semantics `verify-vercel-deploy.mjs` still implements; the script is kept and is now imported by `deploy-vercel.mjs` for its terminal-state vocabulary, though no workflow calls it directly. **#1578** (2026-09-04) did not re-wire it here: `deploy-vercel-staging.yml` creates the deployments and so verifies them **by id**, which is strictly better than searching for one by SHA, and it must stay CI-gated where this workflow is push-triggered. This workflow remains the Render staging observer. Historically they failed on `ERROR`. Treat `CANCELED` as neutral **only when a later deployment on the same branch overtook it** — the signature of Vercel auto-cancelling a build that a newer push superseded, where the branch is still verified by the build that overtook it (and that build has its own verify run, so the later deployment need not be `READY` yet). A cancel that nothing overtook is a failure: it was a manual stop, a build concurrency limit, or an Ignored Build Step that skipped it. Note the test looks **forward**, not backward. Asking whether an *earlier* success exists was the right question while `turbo-ignore` ran — an earlier success was the baseline a skip diffed against — but on `main` one always exists, so as a supersession test it would call every cancel benign. "No deployment for this SHA within 3 minutes" is also a **failure**. It was neutral while `ignoreCommand` ran `turbo-ignore`, which legitimately suppressed a build for an unchanged app tree; both apps now pin `ignoreCommand: "exit 1"`, so with `git.deploymentEnabled.main = true` every push to `main` must produce a deployment row for both projects and a missing one means the Git integration did not fire. ⚠️ **2026-09-02:** that is now the permanent state — both projects are unlinked from Git (ADR-21), so a missing deployment row is expected rather than a red flag. Both jobs failed on every push (`verify-vercel-landing` since 2026-09-01, `verify-vercel-web` since 2026-09-02) until #1579 removed them; only the verify step ever failed, the alias step after it was skipped. See the dated note at the top of [Vercel Setup](vercel.md).

The workflow is currently advisory (not a required check). When a failure shows up in the Actions UI, the failure message will name the commit SHA and last observed state; open the linked Render / Vercel dashboard to read full deploy logs.

Production verification is **not** this workflow's job. `deploy-production.yml` verifies its own deploys inline, polling the Render deploy id and the Vercel deployment ids it was handed, so a bad production deploy fails the release rather than being reported after the fact. It also applies stricter semantics than the observer: on the production path a `CANCELED` Vercel deployment or a `canceled` Render deploy is a **failure**, because there is no newer push for it to have been superseded by — and, since #1578, because a deployment CI built and uploaded itself cannot be superseded at all. See the header of [`scripts/ci/deploy-vercel.mjs`](../../../../scripts/ci/deploy-vercel.mjs).

Script implementations and unit tests live under [`scripts/ci/`](../../../../scripts/ci/).

### Secrets in CI vs CD

**CI (lint, typecheck, tests)** does **not** use any runtime secrets. No Supabase, Stripe, or Vercel credentials are needed.

**CD (deploy workflows)** uses Infisical-injected runtime secrets in `deploy-api.yml` (staging) and `deploy-production.yml` (production). Variable names are **unified** — no `_STAGING` / `_PRODUCTION` suffixes. Each workflow resolves secrets at runtime from Infisical using the environment slug for its target (`staging` for `main`, `prod` for a production deploy):

| Variable                 | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `RENDER_DEPLOY_HOOK_URL` | Trigger API deploy (value differs per environment)       |
| `API_HEALTHCHECK_URL`    | Post-deploy health check (value differs per environment) |
| `SUPABASE_ACCESS_TOKEN`  | Supabase CLI auth for migrations                         |
| `SUPABASE_PROJECT_REF`   | Target DB for migrations (value differs per environment) |

3 permanent GitHub repository secrets bootstrap the Infisical connection: `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, and `INFISICAL_PROJECT_ID`. No GitHub environment-scoped deploy secrets are required once the workflow is using `Infisical/secrets-action`.

See `docs/internal/environment/ENV_REFERENCE.md` for the complete variable mapping.

---
