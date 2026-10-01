# Migration drift and ordering

What the migration checks judge, what a red one means, and the two hand
recoveries: `--include-all`, and reconciling a foreign migration row. Promoting
a migration is [`promotion.md`](promotion.md); the dated record of each
promotion is [`promotion-log.md`](promotion-log.md).

## What catches drift, and what catches bad ordering

Three checks, deliberately different shapes:

| Check                                                                                                 | When                                                   | Scope                      | On failure                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------- | ------------------------------ |
| `migration-order` ([`migration-drift-gate.yml`](../../../.github/workflows/migration-drift-gate.yml)) | Every PR and every push to `main` — **required check** | Staging **and** production | Blocks the merge               |
| `migration-drift` (same workflow)                                                                     | Every PR and every push to `main` — **reports only**   | Staging only               | Reports; does not block        |
| [`check-migration-drift.yml`](../../../.github/workflows/check-migration-drift.yml)                   | Daily, 07:00 UTC                                       | Staging **and** production | Files/updates a tracking issue |

All three are read-only, and none of them ever repairs anything. The daily
watchdog calls the Supabase Management API's migration-history endpoint itself
and sends no SQL. The two PR checks, and `migration-replay` in the same
workflow, hold no credential at all (#2518). They read the snapshot of that same
endpoint that
[`migration-snapshot.yml`](../../../.github/workflows/migration-snapshot.yml)
publishes from `main` after every deploy. Off `main` (a pull request, or a
dispatch on a branch), when the snapshot predates the latest deploy,
`migration-order` and `migration-replay` wait for the next publish (the
budget is set in [`download-migration-snapshot`'s header](../../../.github/actions/download-migration-snapshot/action.yml)),
then fail and name the publisher
([`agent-infra.md` § GitHub environments and bootstrap secrets](../../ci-cd/agent-infra.md#github-environments-and-bootstrap-secrets)).
`migration-drift` never waits: it judges the newest snapshot as it is, and says
when a `Deploy staging` run has overtaken that snapshot (below).

**After you change a migration ledger by hand, re-publish before you re-run a PR.**
A `migration repair`, an `--include-all` apply or a hand-applied file triggers no
publish, so the PR checks keep judging against the state from before your change.
The fix PR you open next then fails, for example with `stranded-migrations`
after a repair. Run Actions → **Migration snapshot** → Run workflow on `main`,
wait for it to go green, then re-run the PR's checks. `migration-order`'s summary
names the snapshot's capture time, so you can check which state it read.

### `migration-order` — the required one

It asks whether a migration **this change introduces** sorts before a version
the target database has already applied. If one does, `supabase db push`
refuses rather than reordering:

> Found local migration files to be inserted before the last migration on
> remote database. Rerun the command with `--include-all` flag to apply these
> migrations.

That is #1373: `20260829000000_rollover_promote_new_members` merged after
`20260829002000` was already applied to staging, and staging's migration deploy
halted. Measured against the pinned CLI 2.77.0 — exit 1, nothing applied, ledger
untouched. The CLI stops; it does not reorder.

The remedy the check prints is the right one in the ordinary case: **rename the
file to a version after the newest applied one**, keeping its name. That is safe
while the migration is unapplied everywhere, which is the normal state for one
still in review. If it has already been applied somewhere, renaming strands that
state — read [`--include-all`](#--include-all-recovery-only) instead.

It reads only head-minus-base, which is what makes it safe to require: a change
touching no migrations introduces nothing, so it makes zero network calls, and a
PR that _fixes_ an ordering fault turns its own check green. It checks both
environments because production is deployed manually and is routinely behind —
the environment furthest ahead refuses first, and that is usually staging, which
is exactly why `migration-replay` (which rebuilds _production's_ state) was
structurally blind to #1373.

### `migration-drift` — reports, does not block

It compares `origin/main` against staging's applied history — **not** your PR's
head — with a 30-minute grace from the moment a migration landed on `main`.
The grace has to cover the `Deploy staging` run applying the migration and the
snapshot publish that follows it, because the check reads the published
snapshot, not staging.

"Landed on `main`" means the commit on `main`'s own first-parent chain — the
merge commit, or the squash commit where the merge was squashed — not the
feature-branch commit that authored the file. The distinction is the whole
grace: a migration authored last week and merged two minutes ago has had two
minutes, not a week. Until #1363 the gate measured the authoring commit, so any
PR that sat in review longer than 30 minutes got no grace at all and the gate
went red across every open PR seconds after any migration merged.

**It is no longer a required check.** It measures whether staging is behind
main, which is a question no individual PR contains or can change, so as a
required check it was a repo-wide merge-freeze switch rather than a gate — and
#1373 used it as one, making every open PR in the repository unmergeable until a
human intervened. It still runs and reports on every PR, and the daily scheduled
check above files a self-closing P1 issue for the same condition.

So if `migration-drift` is red on your PR and you did not cause it, read the
job summary's first line, because red has two meanings:

- **Drift detected.** Staging is out of sync for everyone, and the schema your
  tests ran against is not the schema on staging. That is worth fixing and
  worth not ignoring — it is simply no longer worth blocking your merge on.
  Since #1363 that reading is reliable; before it, a red here in the half hour
  after a merge was as likely to be the gate mis-dating its own grace window as
  a real drift.
- **Cannot verify** (the `stale` verdict, #2518). A migration on `main` is past
  its grace window, and the newest snapshot cannot show whether staging has
  it. The summary names which of three reasons applies:
  - A `Deploy staging` run finished after the snapshot was taken, and the publish
    it triggers has not landed. The publisher is behind, not staging. If
    **Migration snapshot** is still running, re-run the check when it
    finishes. If it failed, fix it, re-run it on `main`, then re-run the check.
  - A `Deploy staging` run is still in progress. Re-run the check once it and its
    publish have finished.
  - The download step could not read what `Deploy staging` did (an Actions API
    error, named in that step's log). Re-run the check.

  If a migration is still missing after a fresh publish, that run reports
  drift.

A run can show both. The drift summary then also lists the migrations the
snapshot cannot vouch for, with the reason and the step for each, so one run
reports both problems.

### `--include-all` (recovery only)

`scripts/run-migration.mjs` accepts `--include-all`, which passes the same flag
to `supabase db push`. **No workflow sets it, and the script refuses it under
`CI=true` unless `MIGRATION_ALLOW_INCLUDE_ALL=true` is also set** — two
deliberate acts, because this is the flag that applies exactly what
`migration-order` exists to keep off `main`.

**What it does.** Without it, the CLI refuses to apply any migration sorting
before the newest version the remote has already applied, and stops:

> Found local migration files to be inserted before the last migration on remote
> database. Rerun the command with `--include-all` flag to apply these
> migrations.

With it, the CLI applies those migrations at the end of the history regardless of
where their versions sort. The ledger then records them in an order that does not
match their version order, and every later reconstruction of that database's
state — `migration-replay`'s baseline rebuild, a `db reset`, a restore
rehearsal — replays them in _version_ order instead. If the migrations are
order-sensitive, those two are different databases.

**The one case that makes it legitimate.** A migration has already been applied
somewhere, and it is back-dated relative to another environment. Renaming it —
the remedy `migration-order` prints, and the right answer while a migration is
unapplied everywhere — would strand the applied copy as a _foreign_ row on the
environment that has it, which blocks `db push` on that environment outright.
When renaming would strand state, `--include-all` is the lesser evil.

**It is not the systemic answer.** Reaching for it means an ordering fault
already merged. Fix the fault; the gate that should have caught it is
`migration-order`, and if it did not, that is a bug in the gate worth filing.

    # Recovery, run by a human who has read the above. From the REPOSITORY ROOT.
    SUPABASE_ACCESS_TOKEN=... \
    SUPABASE_PROJECT_REF=... \
    SUPABASE_DB_PASSWORD=... \
      node scripts/run-migration.mjs --env production --include-all

All three variables are mandatory and the script refuses without them.
`SUPABASE_DB_PASSWORD` is the one that surprises people: without it the pinned
CLI cannot initialise its `cli_login_postgres` role and dies as
`42501: permission denied to alter role`, which reads as a privilege problem on
the production database and is a CLI bug ([supabase/cli#5091](https://github.com/supabase/cli/issues/5091)).
The script now says so rather than letting you debug it mid-incident.

Two other refusals, both deliberate:

- **Wrong project.** If `SUPABASE_PROJECT_REF` does not match the ref
  `.github/environments.json` records for `--env`, the script exits before `link` or
  `push`. A production ref cannot be applied under a staging label, or the
  reverse.
- **Wrong directory.** `supabase/migrations/` is resolved from the working
  directory, so running from anywhere else is an error rather than a cheerful
  "no migrations to apply" and exit 0.

## Reconciling a foreign migration row

A foreign row is a version in a hosted database's `schema_migrations` that no
file in `supabase/migrations/` explains. `supabase db push` refuses to run
against that database at all while one is there.

**What finds one.** The daily `check-migration-drift.yml` watchdog (the table
above) reports one on either project. On a PR, `migration-replay` fails outright
when production holds one, and the `migration-drift` summary lists any on
staging. None of them repairs anything: they send no SQL. Reconciling a foreign
row is the manual procedure below, and applying a backlog of pending migrations
is a deliberate promotion, not something a watchdog should do on its own.

**The CLI's suggested fix is destructive.** When `db push` reports a remote
version missing locally, the CLI suggests
`supabase migration repair --status reverted <version>`. **Do not run it
blind.**

1. **Check whether the version ever existed in git:**
   `git log --all --oneline -- 'supabase/migrations/<version>_*'`. If it shipped
   and `main` has renamed it since, the SQL already ran: mark the old version
   reverted and the new one applied, and delete nothing.
2. **Otherwise, read what the row actually did.** Postgres stores the executed
   SQL, so a migration absent from git is still fully recoverable from the
   database:

   ```sql
   select version, name, array_to_string(statements, E'\n;;\n') as sql_text
   from supabase_migrations.schema_migrations where version = '<version>';
   ```

3. **Remove the row only once its effects are redundant with the repo or
   intentionally superseded:**
   `delete from supabase_migrations.schema_migrations where version = '<version>';`.
   That is equivalent in effect to `repair --status reverted`, and it is what the
   [2026-08-10 staging cleanup](promotion-log.md#2026-08-10-staging-migration-backlog-cleared--two-blockers-behind-the-696-credential)
   used. Record the `version` and `name` first: re-inserting them is the rollback.
4. **If the row's SQL is not represented in `supabase/migrations/`, stop.** The
   correct fix is a new migration capturing it, not deleting the evidence.

A hand change to a ledger triggers no snapshot publish, so re-publish before
re-running a PR's checks ([above](#what-catches-drift-and-what-catches-bad-ordering)).
To confirm the database is clean again, run `check-migration-drift.yml` from the
Actions tab (`workflow_dispatch`, with an adjustable `grace_hours`) or
`npm run check:migration-drift`.
