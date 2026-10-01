# Environments & CI/CD Specification: Frapp

---

## 1. Environment Matrix

|              | Local                             | Staging                                 | Production                            |
| ------------ | --------------------------------- | --------------------------------------- | ------------------------------------- |
| **Landing**  | localhost:3002                    | Vercel preview / staging.frapp.live     | frapp.live                            |
| **Web App**  | localhost:3000                    | Vercel preview / app.staging.frapp.live | app.frapp.live                        |
| **API**      | localhost:3001                    | Render (`main` branch service)          | Render (deployed by commit id)        |
| **Mobile**   | Expo Go (local network)           | EAS internal distribution               | App Store / Google Play               |
| **Database** | Supabase local (`supabase start`) | Supabase staging project                | Supabase production project           |
| **Auth**     | Supabase Auth (local)             | Supabase Auth (staging project)         | Supabase Auth (production project)    |
| **Storage**  | Supabase Storage (local)          | Supabase Storage (staging project)      | Supabase Storage (production project) |
| **Stripe**   | Test mode (`sk_test_`)            | Test mode (`sk_test_`)                  | Live mode (`sk_live_`)                |
| **Push**     | Expo Go (dev)                     | EAS internal builds                     | Production builds                     |

Each Supabase project (local, staging, production) is fully isolated: separate database, auth users, storage buckets, and API keys. Both Vercel projects are unlinked from Git (ADR-21), so the staging Landing and Web App hosts are deployed by CI rather than by a push — see §6 **Web and Landing (Vercel)**.

### Branch-to-environment mapping

| Branch      | Purpose                              | Deployment behavior                                    |
| ----------- | ------------------------------------ | ------------------------------------------------------ |
| `main`      | Pre-production / staging integration | Green CI on `main` triggers the staging deploy (`deploy-staging.yml`): migrations, the Render API and the Vercel web and landing deploys, in that order (#2803). Push-triggered Vercel Previews were retired with the Git unlink (ADR-21) — see §6 |
| `feature/*` | Short-lived feature work             | No automatic Vercel deployments; merged into `main`    |

Production is **not** mapped to a branch. It is deployed by running the **Deploy
production** workflow against a named commit, which must already be an ancestor of `main`
with green CI. The `production` branch that used to occupy this table was retired in
#1340.

---

## 2. Local Development

### Prerequisites

- Node.js at or above the root `package.json` `engines.node`, which is the one statement of the floor. `.nvmrc`, CI's `node-version:` and `apps/api/Dockerfile` pin only the major, so whichever release of it they land on (an older install under `nvm use`, the runner's cached toolchain, a cached image layer) can sit below the floor. Check `node -v` against `engines.node`.
- npm v10+
- Docker available to your shell (Docker Desktop with **WSL integration** on Windows/WSL, or Docker Engine on Linux)
- Supabase CLI: none to install. The repo pins one version, the one CI deploys with, and `npm run supabase -- <args>` runs it, installing it into the gitignored `.cache/supabase-cli/` on first use (`scripts/lib/supabase-cli.sh`)
- Expo Go app on iOS/Android device

### Setup

**One-shot bootstrap (recommended on WSL/Ubuntu):** from the repo root, with Docker already running:

```bash
bash scripts/local-dev-setup.sh
# Skip typecheck / migration-safety for a faster loop:
# bash scripts/local-dev-setup.sh --quick
# Stuck or exited Supabase containers (this repo only; keeps volumes):
# bash scripts/local-dev-setup.sh --reset-supabase
# Wipe local Supabase data volumes (destructive; confirm in terminal):
# bash scripts/local-dev-setup.sh --reset-supabase-data
```

The script runs `npm install`, then `supabase start` and `supabase db push --local` on the pinned CLI, the local Postgres default-ACL repair (fatal if it fails; `FRAPP_SKIP_ACL_REPAIR=1` overrides), optional validation, then prints **`npm run dev:stack`** (and pointers to [`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md)). It does **not** start `dockerd` (the Claude Code cloud sandbox does — see [`CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md)). It does **not** stop unrelated Docker containers—only this project’s Supabase CLI stack. If `supabase start` fails in an interactive shell, it may prompt once to run `supabase stop` and retry (volumes preserved).

**Manual sequence** (equivalent):

```bash
# 1. Install dependencies
npm install

# 2. Start Supabase local (Postgres, Auth, Storage, Realtime), on the pinned CLI
npm run supabase -- start

# 3. Apply database migrations (--local targets the local Supabase instance)
npm run supabase -- db push --local

# 4. Repair the local Postgres default ACLs. The pinned supabase/postgres image ships
#    schema `public` without DML grants for anon/authenticated/service_role, so skipping
#    this leaves every API query failing with `42501 permission denied for table ...`.
#    Not needed if you ran scripts/local-dev-setup.sh above — it does this for you.
bash -c '. scripts/lib/supabase-cli.sh && . scripts/lib/local-postgres-acl.sh && frapp_repair_local_acls "$PWD" frapp_supabase'

# 5. Start apps — default (with Infisical — see docs/internal/environment/LOCAL_DEV.md):
npm run dev:stack
# Per-app, no Infisical, Turbo caveats: docs/internal/environment/LOCAL_DEV.md
```

### Environment Variables

If you are not using Infisical CLI injection, create a `.env.local` file for each app. Local Supabase keys come from `npm run -s supabase -- status -o env`.

See **[`docs/internal/environment/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md)** for the complete list of every variable, per app, per environment.

**Alternative (Infisical CLI):** Skip `.env.local` files entirely by injecting from Infisical:

```bash
npx infisical run --env=dev -- npm run start:dev -w apps/api
```

### Accessing Services

Ports and URLs for web, API, Swagger, landing and Supabase Studio: [`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md) § Ports and URLs.

### Running Mobile

```bash
cd apps/mobile
npm start
```

Scan the QR code with Expo Go. Phone and PC must be on the same network.

### Updating the API Contract

After changing an API endpoint, regenerate and commit both contract artifacts. Commands, the committed artifacts, and the CI freshness check: [`../architecture/README.md`](../architecture/README.md) § 10 API Contract Strategy.

---

## 3. Staging

- **Purpose:** QA, stakeholder demos, mobile TestFlight/internal builds.
- **Git branch:** `main` — pushes trigger staging/pre-production deployments.
- **Supabase:** Dedicated staging project (separate from production). Create via Supabase dashboard or CLI.
- **Web / Landing:** Vercel Preview deployments with staging domains (`app.staging.frapp.live`, `staging.frapp.live`). Both projects are unlinked from Git (ADR-21), so no push produces a preview; `deploy-staging.yml` builds them after CI succeeds on `main`, uploads them once the staging API is verified, then aliases both hostnames (#1578, #2803). It uploads only when something web or landing is built from changed since what the hostnames serve, so after a docs, API or mobile merge they stay on an older commit; the job keeps the newest few staging deployments and deletes the rest (#2865). A run for a commit `main` has moved past uploads only over hostnames serving older commits — see §6 **Web and Landing (Vercel)**.
- **API:** Render staging service (`frapp-api-staging`), pointing at Supabase staging. After CI and the staging migration, `deploy-staging.yml` deploys the `main` commit by commit through the Render API whenever anything the API image is built from changed since the commit staging serves; Render auto-deploy must be off (#2505), and it read off on 2026-09-29; the rest of #2679 retires the staging deploy hook.
- **Mobile:** EAS internal distribution builds (`eas build --profile preview`).
- **Stripe:** Test mode keys (`sk_test_`).
- **Data:** May contain seed data. Never production user data.

---

## 4. Production

- **Git branch:** none. Production is deployed from a **named commit on `main`** by
  `.github/workflows/deploy-production.yml` (`workflow_dispatch`, typed confirmation,
  and the `production` environment's Required reviewers), which calls the deploy job
  staging shares (`_deploy.yml`) with production's layers switched on (#2805).
- **Supabase:** Dedicated production project. Fully isolated users, database, storage.
- **Web App:** `app.frapp.live` (Vercel, production deployment created by the workflow, which
  builds the named commit on the runner with `vercel build --prod` and uploads it with
  `vercel deploy --prebuilt --prod`). The guardrail preflight stopped blocking the dispatch with
  #1579, and #1578 replaced the `gitSource` call the retired integration used to serve. See §6
  **Web and Landing (Vercel)**.
- **Landing:** `frapp.live` (Vercel, same).
- **API:** Render production service (`frapp-api-prod`), deployed by commit id through
  the Render API, pointing at Supabase production + Stripe live keys. Render-side
  auto-deploy must stay **off** — `scripts/ci/production-guardrails.mjs` asserts it.
- **Mobile:** App Store and Google Play via EAS Submit, uploaded to TestFlight and the Play internal track and never released by a machine. **Deploy production** builds and uploads the commit it just shipped when its `mobile_build` input asks; a maintainer can still do it by hand (see **Store submission** under [Mobile (EAS)](#mobile-eas)).
- **Stripe:** Live mode (`sk_live_`). Requires business verification (KYC) before launch.
- **Monitoring:** Error tracking (Sentry or equivalent), structured logging, uptime checks.

> **Full setup walkthrough:** See [`docs/ops/deployment/`](../../docs/ops/deployment/) for step-by-step instructions covering Vercel, Render, Supabase, EAS, DNS, and environment variables.

---

## 5. Continuous Integration (CI)

CI runs as domain-specific parallel jobs on every PR to `main`. Each job is an independent required status check — failures are visible per domain, not hidden behind a single monolith gate.

### CI Job Matrix

The roster is not restated here. Every check name, what it validates, and whether it blocks a merge
or only reports are in
[`github-branch-protection-runbook.md`](../../docs/ops/github-branch-protection-runbook.md)
**§ Required Status Checks** — the single hand-kept copy of the `CI_CHECKS` / `DOCS_CHECKS` /
`DRIFT_CHECKS` arrays in
[`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs). **Nothing asserts
that copy.** `npm run check:doc-tables` used to compare the two; it was deleted along with the other
docs gates, so the roster now stays true only because whoever edits the arrays remembers to edit the
runbook in the same change. Where they disagree, `required-checks.mjs` is the source and the runbook
is the stale one. What follows is the CI *model* those checks implement.

`web-tests` and `web-responsive-floor` are **path-gated and still required**, which is only a contradiction if you assume a skip blocks. It does not: GitHub reports a job skipped by a *job-level* conditional as *Success*, and `success` / `skipped` / `neutral` all satisfy a required check. `changes` is required for a different and less obvious reason — a required check whose `needs:` parent fails is skipped and *may not block merging*, so a non-required parent would leave both satisfiable without ever running. See the ADR-15 amendment in [`../architecture/adr/adr-15.md`](../architecture/adr/adr-15.md) and the comments in [`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs).

The runbook's roster states the *intended* set — every entry in it is a line in `CI_CHECKS` /
`DOCS_CHECKS` / `DRIFT_CHECKS` in [`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs),
with no exceptions in that direction — `buildProtectionPayload` appends nothing to the roster, it PUTs the arrays as
they stand. (`branch-policy` was the exception this paragraph used to name. It was deleted with the
`production` branch in #1340.)
Live branch protection is whatever an admin last applied and can lag the script, so no doc claims
per-check whether a gate is live today; read live state per
[`github-branch-protection-runbook.md`](../../docs/ops/github-branch-protection-runbook.md).

`pglite-migrations` is also path-gated, and required since #2538. `duplicate-detection` is advisory, for the reason in [`quality-gates.md` § The gates, and why each has the posture it does](../../docs/ci-cd/quality-gates.md#the-gates-and-why-each-has-the-posture-it-does).

There was a second advisory job, `web-visual-regression`, and it has been **deleted**. It compared each dashboard route against a committed PNG; its exemption was specifically about pixels, since baselines pinned to CI's Chromium build drift with it. The 375px floor gate used to live in the same job and inherited that exemption by directory despite storing no baseline and comparing no pixels — #1152 split it into the required `web-responsive-floor` above, and the snapshot job was later removed along with its spec, its baselines and the `test:visual` script.

### Environment identity

Each environment's Supabase project ref is recorded in
[`.github/environments.json`](../../.github/environments.json), read through
`scripts/ci/lib/environments.mjs`. Refs are **not secrets** — they are already published in
[`db-rollback-playbook.md`](../../docs/ops/db-rollback-playbook.md) and
[`CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md), and one grants nothing without
`SUPABASE_ACCESS_TOKEN`. Committing them is what makes an assertion possible: `scripts/run-migration.mjs`
compares the ref Infisical injected against the one this file records for `--env`, and **fails closed on a
mismatch before any `link` or `push`**. Before that existed, `--env` was validated, printed, and then
dropped — `--env staging` and `--env production` were the same program, so a mis-scoped Infisical folder
would have applied migrations to production while every log line said staging.

The same file holds each environment's Render service id (`renderServiceId`) and the Vercel team and
project ids (its `vercel` block), since [#2806](https://github.com/pdcarlson/Frapp/issues/2806). Every
workflow reads them through `scripts/ci/provider-ids.mjs`, and a test fails on a literal id anywhere under
`.github/workflows` or `.github/actions`. They are not secrets either: each grants nothing without
`RENDER_API_KEY` or `VERCEL_API_KEY`.

Three consequences worth holding together:

- **Rotating a project touches every file that names its ref**, not only `.github/environments.json` — see
  [`db-rollback-playbook.md` § Backup reality](../../docs/ops/db-rollback-playbook.md#backup-reality).
  Missing the file blocks every production migration and fails `migration-order` on every
  migration-bearing PR.
- **Recreating a Render service or a Vercel project means changing its id in this file.** The deploy,
  `production-guardrails.yml` and `production-release-pin.yml` all read it from here, and the format
  check can't tell an old id from a new one, so a stale id deploys to, or asserts against, the object
  that was replaced.
- **`check-migration-drift.yml` deliberately still reads its refs from Infisical.** Pointing it at the
  committed file too would make the pair agree by construction, and the fence would assert nothing.

### Additional checks outside `ci.yml`

The docs workflows (`docs.yml`, `links.yml`) and what each of their jobs checks:
[`docs-ci.md` § What runs](../../docs/ci-cd/docs-ci.md#what-runs). The migration checks —
which workflow runs them, which are required, what each validates, and why `migration-drift` was
demoted out of `DRIFT_CHECKS` — are in
[`github-branch-protection-runbook.md` § Required Status Checks](../../docs/ops/github-branch-protection-runbook.md#required-status-checks).

Four docs gates used to run here — `docs-structure`, `doc-paths`, `doc-refs` and `doc-tables` — and
all four are **deleted**, with their scripts, their allowlists and their `check:doc-*` npm scripts.
`doc-paths` was the only one ever promoted to required, which is why `DOCS_CHECKS` is now an empty
array; the comment on that array in
[`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs) records the trade,
and what replaced them is the standard in
[`DOCUMENTATION_CONVENTIONS.md`](../../docs/internal/DOCUMENTATION_CONVENTIONS.md) plus the docs
angle in `.claude/skills/diff-review/angles.md`. No gate reads the docs corpus for documentation
defects now. `link-check` still resolves its links and anchors, and `env-slugs` still walks every
`.md` under `docs/` and `spec/` for `--env=` slugs — neither says whether a claim is true.

**Code review is a repository-managed Git pre-push gate, not a CI check.** Frapp's gate is **`/diff-review`**. The root `prepare` script (and, in a Claude Code cloud session, the SessionStart hook) installs [`.githooks/pre-push`](../../.githooks/pre-push) through `core.hooksPath`, so local Codex, cloud agents, and humans share one mechanism. Every non-deletion ref update that publishes unreviewed work requires evidence for its exact pushed commit at `.cache/diff-review/<PUSHED_COMMIT_SHA>`; retrying cannot satisfy it. Git guarantees that the hook's nonzero exit aborts the push when installed, but `--no-verify`, a changed hooks path, or skipped installation bypass it, so it is not an unconditional server-side gate. Details live in the [review runbook](../../docs/ci-cd/ai-code-review-runbook.md).

- Merge-time review requirements on `main` (approving reviews, conversation resolution), and why no branch is stricter: [`CONTRIBUTING.md` § PR review requirement policy](../../CONTRIBUTING.md#pr-review-requirement-policy).
- Full runbook: [`ai-code-review-runbook.md`](../../docs/ci-cd/ai-code-review-runbook.md).

### Key Design Decisions

- **The frontend build gate is production-shaped, not preview-shaped.** `web-production-build` builds `apps/web` and `apps/landing` under `npm ci --omit=dev`, matching Vercel's production install, because nothing in CI ran `next build` before #1374 and that gap took production down twice (#1331, #1372). Staging frontends are still verified through Vercel preview deployments off `main`; production deployments are created by `deploy-production.yml`. The build-shape difference between the two is a recorded trade-off — ADR-20 decision 3. **The staging half of that has not run since the unlink** (landing 2026-09-01, web 2026-09-02): with both Vercel projects unlinked from Git (ADR-21) no push produces a preview, so no Vercel build of either frontend happens on merge any more — see §6 **Web and Landing (Vercel)**.
- **No placeholder secrets.** CI never sets `NEXT_PUBLIC_SUPABASE_URL` or similar to dummy values. All env-dependent builds happen in the provider (Vercel/Render).
- **The API contract check regenerates; it is not a git-diff heuristic.** `npm run check:api-contract` (`scripts/check-api-contract-drift.mjs`) builds the shared packages, rebuilds `apps/api/openapi.json` and `packages/api-sdk/src/types.ts`, and fails on any difference from the committed copies — the git-diff heuristic it replaced false-positived on contract-neutral controller edits. The Swagger export does bootstrap NestJS, but only to build the document, so placeholder credentials suffice and no Supabase/Stripe secrets are needed in CI. Details: [`../architecture/README.md`](../architecture/README.md) § 10 API Contract Strategy.
- **Mobile CI stops short of a native build** (`mobile-validate` in `ci.yml` runs, among other steps, `npm run check:expo-sdk-line`, which fails an Expo package installed off the SDK line or missing from Dependabot's ignore list; `npm run lint`, `check-types`, `test` for `apps/mobile`; an iOS production Metro bundle (`expo export`) on a tree with no prebuilt packages; `npm run check:mobile-native-declarations`, which checks the purpose strings, Android permissions and required-reason declarations the config plugins resolve; and `expo prebuild --no-install`, which generates the native projects without compiling them). EAS builds are expensive and slow; they run on-demand, not per-PR.

If any required check fails, the PR cannot be merged. Branch protection rules enforce this for all users, including admins.

---

## 6. Continuous Deployment (CD)

> **Current state (2026-09-04) — Vercel deploys run from CI.** Both Vercel projects were
> deliberately unlinked from Git (landing 2026-09-01, web 2026-09-02), so no push produces a
> deployment and nothing about this section depends on the Git integration any more. The three
> repairs that took: **#1579** (2026-09-02) inverted the production-guardrails Vercel assertion to
> require the *absence* of a Git link and removed `verify-deployments.yml`'s two Vercel verify jobs;
> **#1578** (2026-09-04) built the replacement deploys — `vercel build` on the runner, then
> `vercel deploy --prebuilt`, for both staging and production. Render **staging** (the
> `deploy-api.yml` push path, now `deploy-staging.yml`) and EAS were unaffected throughout. **ADR-21** in
> [`../architecture/adr/adr-21.md`](../architecture/adr/adr-21.md) is the canonical record of the unlink,
> the freeze points and the repairs.

Staging deploy steps are gated by CI: after CI succeeds on `main`, `deploy-staging.yml` calls one shared job (`_deploy.yml`, #2804) that deploys the database, API, web and landing, with the frontends uploaded only after the API is verified. The step order is [`ci-cd.md` § How Deployments Are Gated](../../docs/ops/deployment/ci-cd.md#how-deployments-are-gated). Nothing about production is push-triggered — `deploy-production.yml` creates the Render deploy and both Vercel production deployments itself, for a commit a human named.

### Deploy Pipeline (on merge)

Staging deploys on every merge whose CI passes; production deploys a SHA a human dispatches and
approves. Both run the same job, `_deploy.yml`, in the order
[`ci-cd.md` § How Deployments Are Gated](../../docs/ops/deployment/ci-cd.md#how-deployments-are-gated)
gives. **Corrected 2026-09-30 (#2489):** this section used to restate that order as a diagram. It
had drifted twice (it left out the Supabase Edge Functions deploy and, when #2489 added it, the
source-map check), so the order now lives only in `ci-cd.md`.

Production deployments run only when a human dispatches **Deploy production** with a
commit SHA, types the confirmation phrase, and approves the `production` environment.
That environment approval is now the **single** human gate — it replaced the promotion
PR's required review, and it fires at the moment of deploy rather than before anyone
knew whether the migration applied. Evidence that the environment gate really does pause
jobs is in `docs/ci-cd/agent-infra.md` § GitHub environments and bootstrap
secrets.

### Web and Landing (Vercel)

> **Current state (2026-09-04) — both projects are unlinked from Git** (Vercel reports
> `link: null` for both) and **all deploys come from CI**. **ADR-21** in
> [`../architecture/adr/adr-21.md`](../architecture/adr/adr-21.md) is the canonical record of the unlink,
> the per-project freeze points and the repairs; **#1579** (2026-09-02) fixed the guardrails half
> and **#1578** (2026-09-04) built the deploys described below.

- **Staging:** `deploy-staging.yml` runs after CI succeeds on `main` (a `workflow_run`
  trigger: a push trigger would deploy before CI finished). Its one job runs
  `vercel pull --environment=preview` and `vercel build` for web and landing before the
  migrations, and `vercel deploy --prebuilt` for both only once the staging API serves the
  commit. It then points `app.staging.frapp.live` and `staging.frapp.live` at the new
  deployments. A failed build, migration or API verify ships no frontend (#2803). Nothing is
  push-triggered on Vercel any more. Each build compiles against the
  keys its app reads from Infisical `staging`, which the job injects, and never against a Vercel
  Preview row. No staging build reads an Infisical→Vercel sync; the two staging syncs were deleted
  on 2026-09-28 (#834, #2672).
- **Production** deployments are **created by the workflow**, not by a push: a fresh build of
  the named commit with `vercel build --prod`, against the keys its app reads from Infisical
  `prod`, which the job injects, and never against a Vercel Production row (#2673). Promoting a staging build instead would ship a bundle with the
  staging API URL and staging Supabase keys inlined at build time.
- Every deployment CI creates is stamped `--meta githubCommitSha=<sha>`. A `--prebuilt`
  upload carries no git metadata of its own, and the named-commit guarantee (ADR-19), the
  staging-alias lookup and the observer's per-branch supersession test all read it back.
- Web and landing build **sequentially** in one job: `vercel build` writes `.vercel/output`
  into the working tree, so two concurrent builds in one checkout would overwrite each other.
- Feature/PR branches do not deploy on Vercel.
- **`git.deploymentEnabled` and `ignoreCommand: "exit 1"` in both `vercel.json` files are now
  inert** — they govern the Git integration's build pipeline, and there is no integration.
  They are **kept deliberately** (ADR-21: *do not delete either key*): they are the versioned
  form of settings that are otherwise dashboard-only, so re-linking Git must not find them
  missing. `ignoreCommand` originally replaced `npx turbo-ignore <app>`, which skipped a
  production release by diffing it against the `main` preview of the same commit
  (run 33275321347); that reasoning governs again the moment the integration is restored.
- Vercel detects the monorepo structure from each project's Root Directory, which
  `vercel pull` fetches into `.vercel/` before the build.

### API (Render)

- API deploys are gated behind CI success using `workflow_run` triggers.
- Production: a human dispatches **Deploy production** with a commit SHA → the workflow calls the Render API with that `commitId` (no deploy hook, and no push involved).
- Push to `main` (after CI) → `deploy-staging.yml` first plans from the commit staging serves, then builds web and landing when they will ship and runs the staging migration: when anything the API image is built from changed since the served commit, it calls the Render API with that push's `commitId` and waits until `/health/ready` reports it; otherwise, when anything ships, it verifies the served commit. A run `main` has moved past deploys only forward (its commit newer than the served one), never an older commit; its migrations still run. No deploy hook, and Render auto-deploy must be off (#2505, #2679).
- Render builds the Docker image from `apps/api/Dockerfile` and performs zero-downtime swap.
- Database migrations run automatically before deploy (see Section 8).
- See `render.yaml` for the infrastructure-as-code definition.

### Mobile (EAS)

- **Production build:** `eas build --platform <ios|android|all> --profile production`, of the commit production serves (the latest `v*` tag), never `main`'s tip: a binary newer than production calls routes production doesn't serve yet (#2526). **Deploy production** runs it for the commit it just shipped and tagged when its `mobile_build` input names a platform (#3111).
- **Preview build (staging):** `eas build --platform all --profile preview`.
- **iOS builds pin an Xcode 26 image** (`build.<profile>.ios.image` in `apps/mobile/eas.json`, every profile; #2477). Apple's TN3187 says an app built with the iOS 27 SDK must adopt the UIScene life cycle or it does not launch, and SDK 57's prebuild still emits the AppDelegate window. Without `image`, EAS builds on `auto`, whose SDK alias EAS moves to a newer Xcode when it ships one (it moved `sdk-54` to Xcode 26). The binary would upload to TestFlight and then abort at launch. The pin defers the move to Xcode 27; it doesn't fix it. It has to move before Apple's Xcode 27 submission floor (expected spring 2027). The move means adopting scenes, through `expo` ≥ 57.0.23 with `expo-build-properties` `ios.enableSceneSupport: true`, or the SDK 58 upgrade (#2329). Either route makes the Sign in with Apple `fatalError` in #2334 reachable, so it ships with that fix. To take a newer Xcode 26 image, read the name from Expo's [build infrastructure](https://docs.expo.dev/build-reference/infrastructure/) page. [`eas-production-profile.test.mjs`](../../scripts/ci/__tests__/eas-production-profile.test.mjs) pins the name and refuses an alias or a non-26 image.
- **OTA updates: the client is installed, and nothing publishes to it yet** (#2526, ADR-24 decision 8). Every build carries `expo-updates` with `runtimeVersion: { policy: "appVersion" }`, a `channel` named after its build profile (`apps/mobile/eas.json`), and `checkAutomatically: "ON_LOAD"` with no wait, so with nothing published an app runs the bundle it was built with. An update published for runtime `0.9.0` reaches every build of `0.9.0`, so every build whose native code changes needs a new `expo.version` (see **Native changes** below). Two builds of one version with different native code would both take an update built against the newer one, and the older would crash on a missing module; if that has already happened, raise `MOBILE_MIN_VERSION_*` past the older build before publishing. The `fingerprint` policy was considered and rejected (2026-09-24): it hashes the resolved config, which carries per-build values (`extra.gitSha` from `EAS_BUILD_GIT_COMMIT_HASH`, and the contents of `google-services.json` on Android), so an update published anywhere but the build worker would silently never match a shipped binary. A `fingerprint.config.js` could drop both (`SourceSkips.ExpoConfigExtraSection` for `extra`, an `ignorePaths` entry for the Android file), but that is a hand-kept list of every config input that varies by environment: miss one later and the match breaks, with nothing to show it until an update fails to reach a binary that can't be changed. A version bump is a rule a pipeline can check (#2511). There is no `eas update` pipeline, and the one CI job that holds `EXPO_TOKEN`, the opt-in store build (`_mobile-build.yml`), never runs `eas update`. Don't run `eas update` by hand before one exists: it ignores `eas.json`'s build `env`, so the published bundle would fall back to `http://localhost:3001` and tag Sentry `development` (#2504 digest 06, which lists the other traps). It also evaluates `apps/mobile/app.config.js` with no `EAS_BUILD_PROFILE`, so every fence there that keys on a profile (production URLs and keys, the Android google-services check, the client-key allowlist, Ask) is skipped and only the secret-key check runs. The pipeline (#2511) has to set a profile, and then supply what those fences expect: a `production` profile counts as Android unless `EAS_BUILD_PLATFORM` is `ios`, so an Android or platform-less run also needs the google-services file, or config evaluation stops.
- **Minimum version:** every native build sends `X-Client-Version` and asks `GET /v1/client-policy` at launch and on return to the foreground; a build below the API's `MOBILE_MIN_VERSION_*` sees a blocking update screen. That, not OTA, is how an old binary is retired. Setting a minimum: [`ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md) § API-Only Settings; behaviour: [`spec/ui/mobile/patterns.md`](../ui/mobile/patterns.md) § Minimum version.
- **Native changes:** bump `expo.version` in `apps/mobile/app.json` first (the OTA runtime is keyed to it), then a full build + App Store / Google Play submission via `eas submit` (**Store submission** below).
- **Store submission uploads, and never releases.** Every production build goes to TestFlight or the Play `internal` track; submitting for App Review and promoting a Play track are a human's clicks. Two paths upload, and both build only the commit production serves (the latest `v*` tag) and record each upload in `apps/mobile/store/shipped-builds.json`: **Deploy production**, when its `mobile_build` input names a platform (default `none`), builds the commit it just shipped and opens the recording PR itself (#3111); a maintainer can also build and submit from a terminal and record by hand. A failed store build never rolls back or reds the ship it follows. How each path runs, what it needs, and the owner steps: [`mobile.md` § 6.6](../../docs/ops/deployment/mobile.md#66-store-submission).
- **The EAS project is permanent from the first store build.** Every binary carries its id (`extra.eas.projectId` in `apps/mobile/app.json`) in `updates.url`, and asks the Expo push service for tokens under it (`apps/mobile/lib/notifications/push.ts`). A new project (another `eas init`) would cut every shipped install off from OTA updates and push until its owner updates from the store. [`mobile-permanent-identifiers.test.mjs`](../../scripts/ci/__tests__/mobile-permanent-identifiers.test.mjs) pins the id.

### Deploy Ordering

**Default:** the frontends ship after the API. On staging, one job (`_deploy.yml`, called by `deploy-staging.yml`) runs the migrations, deploys and verifies the Render API, and only then uploads the Vercel frontends it built at the start (#2803); production uses the same order. Database migrations always run before the API deploy. The step order is [`ci-cd.md` § How Deployments Are Gated](../../docs/ops/deployment/ci-cd.md#how-deployments-are-gated).

> **Corrected 2026-09-28 (#2803):** this default used to read "Vercel (frontends) and Render (API)
> deployments run in parallel after merge", as two workflows both gated on CI success
> (`deploy-vercel-staging.yml` and `deploy-api.yml`, since #1578). Nothing ordered them, so a new
> frontend could go live before the migration or API it calls. `deploy-staging.yml` replaced both.

**Exception — breaking API changes:** When compatibility is not maintained, split the change into PRs and ship them in this order:

1. Merge/deploy the backward-compatible API PR first.
2. Verify the API health check passes.
3. Merge frontend follow-up PRs only after API verification.

Since #2803 the staging pipeline orders each run: a frontend uploads only after the API deployed with it is verified, so a frontend merged on top of a failed API deploy does not ship. The split is still needed for a breaking change, because the previous frontends keep calling the new API from the moment it is live until the upload finishes. Breaking changes must be documented in the PR description and flagged for manual coordination. Use backward-compatible migration patterns wherever possible to avoid this scenario.

### Release labels for version tags

Version bumps are derived from the `release:*` labels on **every PR merged since the last
`v*` tag**, taking the highest. The label belongs on each ordinary PR — there is no
promotion PR to carry it any more.

- No release label on any PR in range → patch bump
- Any `release:minor` in range → minor bump
- Any `release:major` in range → major bump, except while the latest tag's major is 0,
  when it is a minor bump

Releases are pre-1.0 until v1 GA ([#2523](https://github.com/pdcarlson/Frapp/issues/2523);
ADR-24 decision 5), and during 0.x a breaking API or database change is a minor bump. So a
label never leaves 0.x: that takes the Deploy production dispatch's `bump=major`
(`capBumpBeforeOne` in `scripts/ci/resolve-release-bump.mjs`). From 0.x that mints
`v1.0.0`, which was the name of an immutable GitHub Release deleted in the 2026-09-30
renumber. Whether GitHub accepts the name for a new Release, and so how GA leaves 0.x, is
open ([#3015](https://github.com/pdcarlson/Frapp/issues/3015)).

The **Deploy production** dispatch also accepts an explicit `bump` input that overrides
the scan. The tag is created *after* Render and Vercel report healthy, so a `v*` tag
names a commit that is live.

---

## 7. Secret Management

Secrets are centrally managed in **Infisical** (free tier) with automatic syncs to deployment providers. This provides a single source of truth for all environment variables across all environments.

### Infisical Setup

| Property         | Value                                                  |
| ---------------- | ------------------------------------------------------ |
| **Project**      | Frapp                                                  |
| **Environments** | Named by slug, not display name — [`ENV_REFERENCE.md` § Infisical Environments](../../docs/internal/environment/ENV_REFERENCE.md#infisical-environments) |
| **Syncs**        | Not restated here — the live inventory, and why GitHub Actions is not a sync, is [`SECRETS_MANAGEMENT.md` § 5](../../docs/internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs) |

### How It Works

Canonical values (e.g., `SUPABASE_URL`) are stored **once** per Infisical environment. Framework-specific names (e.g., `NEXT_PUBLIC_SUPABASE_URL`) are **secret references** that resolve to the canonical value automatically. No duplication.

See **[`docs/internal/environment/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md)** for the complete variable list and **[`docs/internal/environment/SECRETS_MANAGEMENT.md`](../../docs/internal/environment/SECRETS_MANAGEMENT.md)** for the setup guide.

### Bootstrap Secrets (GitHub only)

Two GitHub secrets bootstrap the Infisical connection:

| Secret                          | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| `INFISICAL_MACHINE_IDENTITY_ID` | Universal-auth machine identity for Infisical      |
| `INFISICAL_CLIENT_SECRET`       | Client Secret for Infisical machine identity auth |

Other GitHub secrets sit beside them. Every GitHub secret belongs to an **environment** restricted to `main`, never to repository scope. A
repository secret is readable from any branch, because a branch's own workflow definitions run on
its pushes and pull requests (#2518). Nothing a pull request triggers reads a secret. Roster,
environments and current state:
`docs/ci-cd/agent-infra.md` § GitHub environments and bootstrap secrets.

### Local Development

**Primary method (no `.env.local` files):**

```bash
npx infisical login       # One-time setup
npm run dev:stack         # Default: API + web + landing (repo root)
```

Per-app Infisical commands, mobile, and no-Infisical fallback: **[`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md)**.

### Rules

- **Never** commit secrets. **Never** log secrets. Rotate keys immediately if exposed.
- **No placeholder secrets in CI.** CI does not build apps that require runtime secrets.
- **No environment suffixes**: one name per secret, its value differing per Infisical environment ([`SECRETS_MANAGEMENT.md` § Key Design Principles](../../docs/internal/environment/SECRETS_MANAGEMENT.md#key-design-principles)).

---

## 8. Database Migrations

### Local Development

Creating and applying a migration locally: [`CONTRIBUTING.md` § Database Migrations](../../CONTRIBUTING.md#database-migrations). Rebuilding the local database from scratch, and what that drops: [`docs/guides/database.md` § 2. Schema location](../../docs/guides/database.md#2-schema-location).

### Remote (Staging / Production)

Remote projects are migrated by `scripts/run-migration.mjs --env <staging|production>`, which links the named project and runs `db push` on the pinned CLI. Every deploy runs it (below). Staging is never pushed by hand, and production goes through **Deploy production**; a by-hand run is a recovery path only ([`drift-and-ordering.md` § `--include-all`](../../docs/ops/database/drift-and-ordering.md#--include-all-recovery-only)).

### Automated Migrations (CI/CD)

Migrations run automatically as part of the deploy pipeline, after CI passes and before app deployments:

1. **Pre-flight validation** (CI): `check:migration-safety` validates filenames and promotion docs; `scripts/ci/check-migration-order.mjs` validates ordering.
2. **Dry run** (CD): `supabase db push --dry-run` shows what will change before applying.
3. **Apply** (CD): `supabase db push` applies pending migrations.
4. **Failure handling**: If migration fails, the pipeline stops — no app deploy happens.
5. **Production gate**: ONE gate, deliberately. The `production` environment's Required
   reviewers pause `deploy-production.yml` before it applies anything. There used to be
   two — the `main` → `production` promotion PR's required review, and then this approval
   after merge on a click nobody was paged for. The promotion PR went with the branch
   (#1340); the environment approval stayed, because it is the one that happens while a
   human is actually looking at the run. Evidence that it pauses jobs (it held a
   one-migration apply for 29m52s) is in `docs/ci-cd/agent-infra.md` § GitHub
   environments and bootstrap secrets.
6. **Production rehearsal**: before applying, `deploy-production.yml` runs
   `scripts/ci/check-migration-replay.mjs` against production's live applied state —
   rebuilding it on a disposable stack and running the pending tail through the same CLI
   path. A rehearsal that finds nothing pending verified nothing, and the run's summary
   says which it was.

### Safety Rules

- Migration files live in `supabase/migrations/`.
- Migrations are version-controlled and applied in order.
- Filenames must match pattern: `YYYYMMDDHHMMSS_snake_case_name.sql`.
- Breaking schema changes require a migration plan (backward-compatible where possible; coordinate with API deploys).
- Every migration should have a documented rollback strategy in `docs/ops/db-rollback-playbook.md`.
- See `docs/ops/deployment/` for the full migration deployment workflow.

## Claude Code web

Frapp's cloud agent environment is **Claude Code web** (ADR-16 amendment 10). Public contract: Setup script `scripts/cloud-sandbox-setup.sh` plus SessionStart, which launches the bringup in `scripts/cloud-sandbox-up.sh`. Full configuration and failure troubleshooting: [`docs/internal/environment/CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md). Agent instructions: [`AGENTS.md`](../../AGENTS.md).

## Scheduled backlog agents

**Claude Code Routines** are the scheduled path. Canonical prompts, cron, and enable notes: [`docs/ci-cd/routines.md`](../../docs/ci-cd/routines.md). Do not restate liveness here. Linear stays retired (ADR-16 amendment 5).
