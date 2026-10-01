# DB Promotion Runbook (local → staging → production)

## Purpose

Use this runbook whenever `supabase/migrations/**` changes need to be promoted.

**Staging is automatic. Only production is a human action.** If you are here
looking for the command to push migrations to staging, there isn't one any more
— see [How migrations reach each environment](#how-migrations-reach-each-environment).

## How migrations reach each environment

| Environment    | How migrations get applied                                                                                                                                                                                                                                       | Who triggers it                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Local**      | `npm run supabase -- db push --local`                                                                                                                                                                                                                                   | You, while developing                     |
| **Staging**    | **Automatic.** The migration steps of the shared `deploy` job ([`_deploy.yml`](../../../.github/workflows/_deploy.yml), which [`deploy-staging.yml`](../../../.github/workflows/deploy-staging.yml) calls) run on every successful CI run on `main`, after the web and landing builds and before the API deploy                          | Nobody — merging to `main` is the trigger |
| **Production** | **Manual.** The [`Deploy production`](../../../.github/workflows/deploy-production.yml) workflow, which migrates and deploys one named commit together. Its `scope: migrations-only` input applies migrations _without_ shipping code, for recovery and backlogs | A human, deliberately                     |

### Staging: do not push by hand

The staging migration runs on **every** merge to `main`, not only merges that touch
`supabase/migrations/`. `supabase db push` applies whatever is pending and is a
no-op when nothing is, so every merge is also a retry for anything an earlier
run missed.

That is deliberate, and it is the fix for a real incident: two migrations merged
to `main` and were never applied to staging, because the job was gated on a
path filter computed with `git diff HEAD~1 … || echo ""` — any git failure read
as "no migrations changed" and the job skipped, green and silent.

**Do not run `supabase db push` against staging from a laptop.** The shared `deploy` job
([`_deploy.yml`](../../../.github/workflows/_deploy.yml), which `deploy-staging.yml` calls) serializes its runs with the
`db-migrate-staging` concurrency group (`db-migrate-${{ inputs.environment }}` there), and that lock cannot see a run on your machine — nothing in GitHub can. A hand-applied
migration also becomes a _foreign_ migration the moment its file changes or is
renamed before merge, and a foreign row makes `supabase db push` refuse to run
**at all** until someone reconciles it by hand
([`drift-and-ordering.md` § Reconciling a foreign migration row](drift-and-ordering.md#reconciling-a-foreign-migration-row)).

If staging needs a migration applied out of band, re-run the **Deploy staging**
run for the latest commit on `main`.

### Production: one path, two scopes

There is no `production` branch and no promotion PR. Both were retired in #1340 —
merging into a branch never named a commit, and Render's auto-deploy-on-commit
meant a push shipped whatever was at the tip without waiting for CI.

**`Deploy production`.** Actions → _Deploy production_ → Run workflow. Give it
the commit SHA you want live and type `DEPLOY TO PRODUCTION`. It refuses any SHA
that is not an ancestor of `main` or whose CI was not green, **rehearses the
migration against production's live applied state**, fences the working tree,
applies it — and then, depending on `scope`:

| `scope`           | What happens                                                                                                                                                                                                | Use it when                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `full` (default)  | Builds both Vercel bundles _before_ applying (a build failure then ships nothing), migrates, deploys the Supabase Edge Functions, deploys the same commit to Render, health-checks it, uploads the prebuilt bundles to Vercel, and tags `vX.Y.Z` | Almost always. Migrations and the code that needs them move together                                                                  |
| `migrations-only` | Migrates and stops. No Edge Functions or Render deploy, no Vercel build, **no tag**                                                                                                                                           | Re-running an apply that failed partway; applying a backlog ahead of the code that needs it; applying on a schedule no deploy matches |

There is also a **dry-run-only** mode that validates and rehearses, then stops
without applying anything, under either scope.

> **`migrations-only` leaves production running the previous code against the new
> schema.** That is the ordering invariant the whole pipeline rests on —
> migrations land before the API in a `full` run too — but here it persists
> until someone comes back with a `full` run. The migration must be
> forward-compatible with the currently-deployed API. It also deliberately
> creates no tag: a tag means "this is what is live", and a migrations-only run
> changes no deployed byte.

**There used to be a second workflow, `Migrate production`, and it has been
deleted.** It did the `migrations-only` job with none of the safety: it took an
arbitrary `ref`, and it skipped SHA validation, the provider guardrail
preflight, the migration replay and the working-tree fence. It was the most
dangerous path in the repository and it existed to back up the safest one. Its
stated reason for skipping the rehearsal — that rebuilding production's state is
least dependable once something has gone wrong — does not survive inspection:
the state that cannot be rebuilt is a foreign migration, and a foreign migration
blocks `supabase db push` outright anyway, so the rehearsal was not the thing
that would have failed. It was the thing that would have said so first.

The workflow's shipping job (the shared `_deploy.yml` job, since #2805) holds the
`db-migrate-production` concurrency group with `cancel-in-progress: false`, so two
dispatches queue instead of interleaving two `db push` runs against one database.

> **The `production` environment's Required reviewers is now the ONLY human
> gate, and it pauses the run.** Production migrations used to be gated by a
> human twice — at the promotion PR, and again after merge on an approval click
> nobody was paged for. On 2026-08-28 that second click held `migrate-production`
> for **29m52s** waiting to apply a single migration the dry run had already
> shown to be clean. #1340 kept the approval and dropped the promotion PR, so
> the surviving gate is the one where a person is looking at the run that names
> the commit.
>
> The evidence that environment protection really does pause jobs (and the one
> thing that was _not_ verified directly) is in
> `docs/ci-cd/agent-infra.md` § GitHub environments and bootstrap
> secrets — read that rather than trusting a restatement here.

**Production's applied migrations are a provider read, not a fact this page
keeps.** The dry run below lists what is pending before anything applies, and
the daily `check-migration-drift.yml` watches both projects' ledgers (what it
judges each against:
[`agent-infra.md` § Schema drift detection](../../ci-cd/agent-infra.md#schema-drift-detection-scriptscicheck-migration-driftmjs)).
The hand reads taken from 2026-08-29 to 2026-09-07 are a dated entry in the
[promotion log](promotion-log.md#2026-09-07-productions-applied-migrations-read-by-hand).

## Preflight checklist

- [ ] Migration filenames pass `npm run check:migration-safety`
- [ ] Lock-safety advisory read: `npm run check:migration-lock-safety -- --all`
      (or the `migration-lock-safety` job's summary on your PR). **Advisory, not
      blocking** — see [`.squawk.toml`](../../../.squawk.toml) for the rules this
      repo excludes and why
- [ ] PR includes migration SQL + rollback plan (`db-rollback-playbook.md`)
- [ ] PR appends an entry to the [promotion log](promotion-log.md)
      (`check:migration-safety` requires a per-migration entry in **both** the
      log and the rollback playbook — the log's header gives the entry shapes)
- [ ] Query/index/policy changes reviewed by at least one backend reviewer
- [ ] For a **production** promotion, a backup **taken by you**, with the dump path
      or object key recorded on the PR — or an explicit, written acceptance that
      there is no recovery path for this promotion. Nothing takes one for you at
      promotion time: `db-backup.yml` dumps `frapp-prod` nightly since 2026-09-06
      (the most recent `production/<label>/` in the bucket may be up to a day old,
      and the job is only as real as its last green run). Supabase's own daily backup, which
      the org has on Pro since 2026-09-28, can be up to a day old too, and point-in-time
      recovery is not enabled
      ([`db-rollback-playbook.md`](../db-rollback-playbook.md#backup-reality) § Backup reality),
      so this box cannot be ticked by having read it. This replaced an older item
      that asked you to _confirm_ Supabase backups: there were none to confirm, so
      it could only ever be ticked falsely.
      `scripts/db-backup.sh` can dump any project. It always needs a reachable
      Docker daemon (`supabase db dump` runs pg_dump in a container). Prefer
      `--db-url` for a one-off — nothing is left behind **in the tree**, unlike
      `--linked`, which needs `supabase link` and leaves the link under
      `supabase/.temp`, so re-link before running anything else from it. (The URL
      still carries the password on the command line, so it reaches your shell
      history and the process table like any other argv.) Either way it captures
      the **database** only; Storage objects need `scripts/storage-backup-run.mjs`,
      which is what `db-backup.yml`'s Storage jobs run.

## Local validation

```bash
npm run supabase -- start
npm run supabase -- db push --local
```

Then run:

```bash
npm run test -w apps/api
npm run check:api-contract
```

## After a staging apply

Merging to `main` applies the migration; these are the checks that it landed
cleanly. The **Deploy staging** run's `deploy` job log shows what was pending
before the apply (its `Run migrations (dry-run)` step always runs first) and what
it applied.

- [ ] The migration steps of the **Deploy staging** run for your merge commit are green
- [ ] `GET /health/ready` answers `200`. It probes fresh on every call, while
      `/health`'s fields can be up to 60 s old
      ([Health Check](../../../spec/behavior/observability.md#health-check)).
      A `503` names each dependency in `message`, and an unrelated Storage or
      `billing:` failure can 503 it with the database fully healthy, so read
      the `database:` part specifically for a migration verification
- [ ] One auth-protected API route succeeds
- [ ] Stripe staging webhook endpoint (`/v1/webhooks/stripe`) accepts signed event
- [ ] No migration-related errors in Render logs

If the migration failed, the API deploy and the web and landing upload for that
commit were **also** skipped (they are later steps of the same job), so a red
migration is never paired with a deployed API or frontend that expects the new
schema.

## Production promotion

Pick a deploy window and notify stakeholders first. Then run **Deploy production**
with the SHA you want live — start with the dry-run box (`dry_run_only`, labelled
*Validate, rehearse the migration, BUILD both frontends, and stop*) checked, to
read the pending list and let the replay rehearse the apply before anything
touches the database.

```text
Actions → Deploy production → Run workflow
  sha           <full 40-char SHA, already merged to main and CI-green>
  confirm       DEPLOY TO PRODUCTION
  dry_run_only  ✔ first pass, ✗ for the real one
  scope         full (or migrations-only — see below)
  bump          auto (or patch/minor/major to force it)
```

The dry-run pass is not ceremony: it runs the same validation, the same provider
preflight, and the same migration replay as the real deploy, so a red dry run
tells you what a real one would have done to the database before it did it.

**Since 2026-09-14 it also builds both frontends** (`scope: full` only) —
`vercel pull --environment=production` then `vercel build --prod`, the same
`DEPLOY_PHASE=build` the real run executes. That is the half that kept failing:
**all three** `full` attempts on 2026-09-14 died in that build STEP, each after a
reviewer had already approved. Two of them died inside `vercel build` itself, on a
variable the Vercel Production scope did not hold — 34894763676 on
`NEXT_PUBLIC_API_URL`, 34896647837 on `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(**corrected 2026-09-15**: this read `NEXT_PUBLIC_SUPABASE_URL` for a day. The
two runs died at different _stages_, and the stage is what names the variable —
34894763676 at config load in `next.config.js`, 34896647837 thirty seconds later
at prerender, i.e. _after_ the guard had passed and so with both URLs present.
See `docs/ops/deployment/ci-cd.md`). The third,
34892839657, died earlier and for a different reason: `requireEnv("DEPLOY_SHA")`
threw inside `deploy-vercel.mjs` _before_ it invoked the CLI at all, which was a
workflow wiring bug rather than an environment one, and #2265 fixed it.

The distinction matters when reading this: only the first two are evidence about
Infisical and Vercel. What all three share is the thing this change addresses —
the step they died in was the one step no dry run executed. The dry run that day
(34891891461) was green throughout, because it skipped every one of them.

The build creates no deployment — `vercel deploy --prebuilt` is a separate step —
so a dry run still uploads nothing and production keeps serving what it served
before.

What the dry run still does **not** rehearse: the migration apply, the Render
deploy, the health check, and the Vercel upload. Those are withheld by choice —
each one writes to production or takes production traffic — not because they are
impossible to rehearse, so do not read the list as a technical limit.

One difference sits _inside_ the build: a real run compiles with
`SENTRY_AUTH_TOKEN` when Infisical `prod` holds it
([which environments carry it](../../internal/environment/ENV_REFERENCE.md#appsapi-nestjs--render)),
and then uploads source maps and creates a Sentry release. A dry run withholds the
token from the build and strips it from the file `vercel pull` writes, so it mints
no release (#2275, since #2673). **Corrected 2026-09-28:** before that, the dry run
cleared only the job-env copy, so a dry run could mint a release through the
pulled file. That still holds for a dry run of a commit from before #2673 (for
example a rollback rehearsal), because the build runs that commit's copy of
`deploy-vercel.mjs`: if you are chasing production errors attributed to a version
that never shipped, such a dry run is a live suspect. Either way, a green dry-run
build does not prove the real build's Sentry upload will succeed.

A green dry run means the commit validates, the pending migrations replay cleanly
against production's applied state, and both bundles compile against the app
config currently in Infisical `prod` (no Vercel row supplies an app key since #2673, and
since #2810 no other Production row reaches the build unless it is named like a Vercel
system variable; the build log names every row kept, and a `::warning::` names any app key
Vercel held that Infisical didn't). It is not a promise that the apply or the upload
will succeed.

If you need to apply migrations _without_ shipping code — recovering a failed
apply, or clearing a backlog — run the same workflow with **`scope:
migrations-only`**. It keeps every gate the full path has (SHA validation, the
provider preflight, the replay, the working-tree fence) and simply stops after
the apply: no Render deploy, no Vercel build, no tag. Production is then running
the previous code against the new schema until you come back with a `full` run,
so the migration must be forward-compatible with the deployed API.

Before you promote — the API does not boot without these:

- [ ] Every name in `REQUIRED_ENV_VARS`
      ([`apps/api/src/config/env.validation.ts`](../../../apps/api/src/config/env.validation.ts))
      is set **and non-empty** in the target environment's Infisical folder:
      `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.
- [ ] Those values also have the right shape, because `validateEnv` refuses some
      non-empty values too: a client key (the publishable key or the legacy
      `anon` JWT) or an unresolved `${…}` reference in
      `SUPABASE_SERVICE_ROLE_KEY`, a staging or localhost `APP_URL` beside the
      production `SUPABASE_URL`, and a malformed `MOBILE_MIN_VERSION_*` /
      `MOBILE_UPDATE_URL_*`. Each throws at boot with the variable named.

`validateEnv` rejects an **empty string** exactly as it rejects an absent key
(`typeof value !== 'string' || value.trim().length === 0`), so a name that is
present in Infisical with a blank value still throws
`Missing required environment variables: ...` at boot. Nothing upstream catches
it: the Infisical sync succeeds, the image builds, and the container then
crash-loops until Render gives up and marks the deploy `update_failed`.

Check the values rather than the key list. A masked `***` in a workflow log
means present and non-empty; a name printed with nothing after the colon is the
blank that fails. The order matters here — migrations apply _before_ the API
deploys, so a blank secret fails **after** the schema has already moved.

Post-apply production checks:

- [ ] `GET /health` succeeds
- [ ] Critical API smoke tests pass (auth + chapter-scoped endpoint)
- [ ] Webhook delivery in Stripe dashboard is green
- [ ] No elevated 5xx/Sentry alerts after deploy

## Promotion guardrails

- Do not apply production migrations before staging validation. Staging applies
  itself on merge to `main`, so in practice this means: let the merge land, let
  its **Deploy staging** run go green, then deploy that commit to production.
- Deploy the commit you validated on staging. `Deploy production` takes a SHA
  rather than a branch precisely so "what we tested" and "what shipped" are the
  same object — `main` may have moved on since.
- Do not merge migration PRs without rollback instructions.
- If any post-apply check fails, stop and execute `db-rollback-playbook.md`.
- **Reference data reaches a hosted project only by migration.** `chapter_directory`'s
  rows come from `supabase/seed/chapter_directory.csv`, and until
  `20260907011500_chapter_directory_seed_rows.sql` only the local bootstrap scripts
  loaded them, so both hosted projects had an empty table (#840). That migration loads
  them everywhere: on a project that started empty,
  `select count(*) from chapter_directory where source = 'seed'` matches the CSV's row
  count once it has applied ([promotion log](promotion-log.md#2026-09-07-chapter-directory-reference-rows-reach-every-environment-840)).
  A changed CSV ships as a **new** migration generated with
  `npm run load:chapter-directory`, never as an edit to that file. What the loader
  guarantees (idempotent, row ids preserved, only `source = 'seed'` rows updated):
  [`docs/guides/database.md` § Reference data](../../guides/database.md#reference-data-the-chapter-directory).
