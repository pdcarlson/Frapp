# DB Promotion Runbook (local → staging → production)

## Purpose

Use this runbook whenever `supabase/migrations/**` changes need to be promoted.

**Staging is automatic. Only production is a human action.** If you are here
looking for the command to push migrations to staging, there isn't one any more
— see [How migrations reach each environment](#how-migrations-reach-each-environment).

## How migrations reach each environment

| Environment | How migrations get applied | Who triggers it |
| ----------- | -------------------------- | --------------- |
| **Local** | `npx supabase db push --local` | You, while developing |
| **Staging** | **Automatic.** The `migrate-staging` job in [`deploy-api.yml`](../../../.github/workflows/deploy-api.yml) runs on every successful CI run on `main` | Nobody — merging to `main` is the trigger |
| **Production** | **Manual.** The [`Deploy production`](../../../.github/workflows/deploy-production.yml) workflow, which migrates and deploys one named commit together. Its `scope: migrations-only` input applies migrations *without* shipping code, for recovery and backlogs | A human, deliberately |

### Staging: do not push by hand

`migrate-staging` runs on **every** merge to `main`, not only merges that touch
`supabase/migrations/`. `supabase db push` applies whatever is pending and is a
no-op when nothing is, so every merge is also a retry for anything an earlier
run missed.

That is deliberate, and it is the fix for a real incident: two migrations merged
to `main` and were never applied to staging, because the job was gated on a
path filter computed with `git diff HEAD~1 … || echo ""` — any git failure read
as "no migrations changed" and the job skipped, green and silent.

**Do not run `supabase db push` against staging from a laptop.** The workflow
serializes its runs with a `db-migrate-staging` concurrency group, and that lock
cannot see a run on your machine — nothing in GitHub can. A hand-applied
migration also becomes a *foreign* migration the moment its file changes or is
renamed before merge, and a foreign row makes `supabase db push` refuse to run
**at all** until someone reconciles it by hand.

If staging needs a migration applied out of band, re-run the `Deploy API`
workflow against the latest commit on `main`.

### Production: one path, two scopes

There is no `production` branch and no promotion PR. Both were retired in #1340 —
merging into a branch never named a commit, and Render's auto-deploy-on-commit
meant a push shipped whatever was at the tip without waiting for CI.

**`Deploy production`.** Actions → *Deploy production* → Run workflow. Give it
the commit SHA you want live and type `DEPLOY TO PRODUCTION`. It refuses any SHA
that is not an ancestor of `main` or whose CI was not green, **rehearses the
migration against production's live applied state**, fences the working tree,
applies it — and then, depending on `scope`:

| `scope` | What happens | Use it when |
| ------- | ------------ | ----------- |
| `full` (default) | Migrates, deploys the same commit to Render and Vercel, health-checks it, and tags `vX.Y.Z` | Almost always. Migrations and the code that needs them move together |
| `migrations-only` | Migrates and stops. No Render deploy, no Vercel build, **no tag** | Re-running an apply that failed partway; applying a backlog ahead of the code that needs it; applying on a schedule no deploy matches |

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

The workflow holds the `db-migrate-production` concurrency group with
`cancel-in-progress: false`, so two dispatches queue instead of interleaving two
`db push` runs against one database.

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
> thing that was *not* verified directly) is in
> `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap
> secrets — read that rather than trusting a restatement here.

> **✅ Production is reconciled and current (verified 2026-08-29).** The
> Management API reports **54** applied migrations on both `frapp-staging` and
> `frapp-prod`, newest `20260829002000`, exactly matching
> `supabase/migrations/` on `main`: nothing pending, and no foreign version.
> (This read **52** when checked on 2026-08-28; two migrations have landed since.)
> The hand-applied `20260228000000_enable_rls_on_remaining_tables` that used to
> block `supabase db push` outright is gone from the history (#832).
>
> This block previously warned that production was ~49 migrations behind and
> that both paths above would fail on the dry run. That was true on 2026-08-24
> and is not true now — left here as a correction rather than deleted, because
> a stale blocker is the kind of warning that sends the next reader to a runbook
> for a problem somebody already fixed.
>
> If a foreign version ever reappears, the `migration-replay` check
> ([`migration-drift-gate.yml`](../../../.github/workflows/migration-drift-gate.yml))
> now fails the PR that would walk into it, instead of the failure surfacing
> mid-deploy. Do not run `migration repair` to make such an error go away
> without first reading what the row did — see
> [`DB_ROLLBACK_PLAYBOOK.md`](./DB_ROLLBACK_PLAYBOOK.md).

## What catches drift, and what catches bad ordering

Three checks, deliberately different shapes:

| Check | When | Scope | On failure |
| ----- | ---- | ----- | ---------- |
| `migration-order` ([`migration-drift-gate.yml`](../../../.github/workflows/migration-drift-gate.yml)) | Every PR and every push to `main` — **required check** | Staging **and** production | Blocks the merge |
| `migration-drift` (same workflow) | Every PR and every push to `main` — **reports only** | Staging only | Reports; does not block |
| [`check-migration-drift.yml`](../../../.github/workflows/check-migration-drift.yml) | Daily, 07:00 UTC | Staging **and** production | Files/updates a tracking issue |

All three are read-only: they call the Supabase Management API's
migration-history endpoint and send no SQL. None of them ever repairs anything.

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
PR that *fixes* an ordering fault turns its own check green. It checks both
environments because production is deployed manually and is routinely behind —
the environment furthest ahead refuses first, and that is usually staging, which
is exactly why `migration-replay` (which rebuilds *production's* state) was
structurally blind to #1373.

### `migration-drift` — reports, does not block

It compares `origin/main` against staging's applied history — **not** your PR's
head — with a 30-minute grace from the moment a migration landed on `main`,
which is the window `migrate-staging` needs to apply it.

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

So if `migration-drift` is red on your PR and you did not cause it: staging is
out of sync for everyone and the schema your tests ran against is not the schema
on staging. That is worth fixing and worth not ignoring — it is simply no longer
worth blocking your merge on. Since #1363 that reading is reliable; before it,
a red here in the half hour after a merge was as likely to be the gate
mis-dating its own grace window as a real drift.

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
rehearsal — replays them in *version* order instead. If the migrations are
order-sensitive, those two are different databases.

**The one case that makes it legitimate.** A migration has already been applied
somewhere, and it is back-dated relative to another environment. Renaming it —
the remedy `migration-order` prints, and the right answer while a migration is
unapplied everywhere — would strand the applied copy as a *foreign* row on the
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
  `ci/environments.json` records for `--env`, the script exits before `link` or
  `push`. A production ref cannot be applied under a staging label, or the
  reverse.
- **Wrong directory.** `supabase/migrations/` is resolved from the working
  directory, so running from anywhere else is an error rather than a cheerful
  "no migrations to apply" and exit 0.

## Preflight checklist

- [ ] Migration filenames pass `npm run check:migration-safety`
- [ ] Lock-safety advisory read: `npm run check:migration-lock-safety -- --all`
      (or the `migration-lock-safety` job's summary on your PR). **Advisory, not
      blocking** — see [`.squawk.toml`](../../../.squawk.toml) for the rules this
      repo excludes and why
- [ ] PR includes migration SQL + rollback plan (`DB_ROLLBACK_PLAYBOOK.md`)
- [ ] PR appends an entry to the promotion log at the bottom of this file
      (`check:migration-safety` requires touching this doc or the rollback
      playbook — it cannot tell which one you owed)
- [ ] Query/index/policy changes reviewed by at least one backend reviewer
- [ ] Supabase backups/snapshots confirmed before a **production** promotion

## Local validation

```bash
npx supabase start
npx supabase db push --local
```

Then run:

```bash
npm run test -w apps/api
npm run check:api-contract
```

## After a staging apply

Merging to `main` applies the migration; these are the checks that it landed
cleanly. The `Deploy API` run's `migrate-staging` job log shows what was pending
before the apply (it always dry-runs first) and what it applied.

- [ ] `migrate-staging` for your merge commit is green
- [ ] `GET /health` reports `database: connected` (its aggregate `status` also
      reflects Supabase Storage reachability — an unrelated Storage hiccup can
      read `degraded` with the database fully healthy, so check the
      `database` field specifically for a migration verification)
- [ ] One auth-protected API route succeeds
- [ ] Stripe staging webhook endpoint (`/v1/webhooks/stripe`) accepts signed event
- [ ] No migration-related errors in Render logs

If `migrate-staging` failed, the API deploy for that commit was **also**
blocked (`deploy-staging` requires it to succeed) — so a red migration is never
paired with a deployed API that expects the new schema.

## Production promotion

Pick a deploy window and notify stakeholders first. Then run **Deploy production**
with the SHA you want live — start with **Stop after the dry run** checked, to
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

If you need to apply migrations *without* shipping code — recovering a failed
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
      `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
      `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.

`validateEnv` rejects an **empty string** exactly as it rejects an absent key
(`typeof value !== 'string' || value.trim().length === 0`), so a name that is
present in Infisical with a blank value still throws
`Missing required environment variables: ...` at boot. Nothing upstream catches
it: the Infisical sync succeeds, the image builds, and the container then
crash-loops until Render gives up and marks the deploy `update_failed`.

Check the values rather than the key list. A masked `***` in a workflow log
means present and non-empty; a name printed with nothing after the colon is the
blank that fails. The order matters here — migrations apply *before* the API
deploys, so a blank secret fails **after** the schema has already moved.

Post-apply production checks:

- [ ] `GET /health` succeeds
- [ ] Critical API smoke tests pass (auth + chapter-scoped endpoint)
- [ ] Webhook delivery in Stripe dashboard is green
- [ ] No elevated 5xx/Sentry alerts after deploy

## Promotion guardrails

- Do not apply production migrations before staging validation. Staging applies
  itself on merge to `main`, so in practice this means: let the merge land, let
  `migrate-staging` go green, then deploy that commit to production.
- Deploy the commit you validated on staging. `Deploy production` takes a SHA
  rather than a branch precisely so "what we tested" and "what shipped" are the
  same object — `main` may have moved on since.
- Do not merge migration PRs without rollback instructions.
- If any post-apply check fails, stop and execute `DB_ROLLBACK_PLAYBOOK.md`.
- **Promoting migrations does not carry reference data.** `chapter_directory` is
  populated from `supabase/seed/chapter_directory.csv` by
  `scripts/load-chapter-directory.mjs`, which the local bootstrap scripts run and the
  promotion path does not. A hosted project therefore has the table and its indexes
  but **zero rows** until someone loads it — which is how it stayed empty in every
  environment long enough to reach production onboarding (#840). Check
  `select count(*) from chapter_directory` as part of post-apply verification;
  populating staging is tracked in #902.

  When you do load it, generate the SQL with `npm run load:chapter-directory` and read
  it before applying. It is idempotent and **preserves row ids**, which matters here:
  `chapters.directory_id` references `chapter_directory(id) on delete set null`, so a
  delete-and-reload would silently detach every chapter already linked to a directory
  entry. Updates are scoped to `source = 'seed'`, so hand-curated rows survive.

## Promotion log

Every migration below records what it does, how it was promoted, and anything a
promoter must do by hand. `check:migration-safety` requires a migration PR to
touch this file **or** [`DB_ROLLBACK_PLAYBOOK.md`](DB_ROLLBACK_PLAYBOOK.md) — it
backs the habit, it does not prove the log complete. Appending here stays the
promoter's job.

## 2026-08-31: `chapter_documents` metadata — mime type, size, document type, effective date (#716)

One additive migration. Adds four nullable columns to an existing table; no
backfill, no lock-heavy operation, no RLS change (the table already has RLS
enabled with no client policies).

### 20260831220000_chapter_documents_metadata.sql
* **Purpose**: Adds `content_type`, `byte_size`, `document_type`, `effective_date`
  to `chapter_documents`, prerequisite work for the AI corpus retrieval design
  (ADR-13 §13, #720) which needs a currency signal distinct from upload time and
  provenance metadata beyond a title. `content_type`/`byte_size` are populated
  from what the client already knows about the file (`file.type` / `file.size`);
  `document_type`/`effective_date` are optional form fields, user-supplied and
  never inferred. A check constraint keeps `byte_size` non-negative when set.
* **Checks**: After `db push`, `select column_name from information_schema.columns where table_name = 'chapter_documents' and column_name in ('content_type','byte_size','document_type','effective_date');` — should return 4 rows. `select conname from pg_constraint where conname = 'chapter_documents_byte_size_nonneg';` — should return 1 row.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback the `chapter_documents` metadata columns.

## 2026-08-24: Discord bot connection — two migrations

The second way in: a single Signet-owned bot a chapter installs through
Discord's ordinary "Add to Server" OAuth flow, after which the API reads the
history itself. Promotes after `20260824120000` below, which owns the job tables
these extend.

**Promote them together, in filename order, in one window.** They are not
independent: `20260824140000` ships the connect flow, and `20260824150000` ships
the check that decides *which chapter* a connected guild may be read into. An
environment left on the first alone is not a partially-migrated environment, it
is a vulnerable one — see the emphasised bullet under the second entry before
you plan the window.

Neither migration carries the Discord app itself. See the **⚠️ Human action**
bullet below; a promotion that skips it leaves the feature dark in a way no
catalog query detects.

### 20260824140000_discord_bot_connection.sql

* **Purpose**: give a chapter somewhere to record which Discord server it
  connected, and give the callback that writes it a safe handshake. Two new
  tables — `discord_connections` (the chapter ↔ guild mapping) and
  `discord_oauth_states` (the OAuth `state`, which is a row rather than a signed
  blob so it can be single-use). Plus `discord_imports.source`, which is what
  lets one job table serve both the phase-2 upload path and this one, and three
  columns on `discord_import_channels` for the backwards per-channel message
  walk.
* **The only per-chapter value here is a guild id.** The bot token is one global
  secret per environment; nothing in this schema stores it and no chapter ever
  sees it. A guild id is a public snowflake and is worthless without the install
  behind it — which is why `guild_id` is deliberately **not** globally unique.
  Two chapters legitimately connecting one server (an umbrella org, a chapter
  re-created in Signet) is a real case, and uniqueness would prevent nothing an
  attacker can do: the tenant control is that the guild is read *through*
  `chapter_id` and never supplied by a caller. Do not add a unique constraint
  under the impression it is a tenant control.
* **Shape**: two new tables with RLS enabled and **no policies**; one column
  with a constant default on `discord_imports`; one CHECK added **validated**;
  three columns on `discord_import_channels`; two new indexes.
* **Locks**: both `add column … default` statements are catalog-only — a
  non-volatile default has not rewritten the heap since PG11, so neither
  `source` nor `position` scans anything. The CHECK is the one statement that
  does: it is added validated rather than `NOT VALID` + `validate`, so it holds
  ACCESS EXCLUSIVE on `discord_imports` for a full scan. That table holds one
  row per import job and is small in every environment today, which is why it
  was written the short way — confirm with `select count(*) from
  discord_imports;` before promoting rather than assuming it stayed small. Both
  index builds hold SHARE on their table for the duration; `discord_oauth_states`
  is new and empty, and `discord_import_channels` is only written while an import
  runs, so promote when no import is in flight.
* **Checks** (after promotion):
  - `select relrowsecurity from pg_class where relname='discord_connections';` → **`t`**
  - `select relrowsecurity from pg_class where relname='discord_oauth_states';` → **`t`**
  - `select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname in ('discord_connections','discord_oauth_states');` → **0**. Default-deny is the whole posture: the API reads these on the service-role key, so a policy would open a direct-PostgREST surface nothing needs. `discord_oauth_states` in particular must never be client-readable — its primary key **is** the CSRF token, so a SELECT on it is the entire attack.
  - `select conname from pg_constraint where conname='discord_connections_chapter_unique';` → one row. One connection per chapter, because an import names no guild — it reads the chapter's connection.
  - `select indexdef from pg_indexes where indexname='idx_discord_oauth_states_expiry';` → predicate is **`WHERE (consumed_at IS NULL)`**. This serves the hourly reaper only; the consume path is the primary key.
  - `select column_default from information_schema.columns where table_name='discord_imports' and column_name='source';` → **`'upload'::text`**. Every pre-existing import must still read as an upload with no backfill.
  - `select pg_get_constraintdef(oid) from pg_constraint where conname='discord_imports_source_check';` → `CHECK ((source = ANY (ARRAY['upload'::text, 'bot'::text])))`
  - `select indexdef from pg_indexes where indexname='idx_discord_import_channels_order';` → on `(import_id, position, discord_channel_id)`
  - Sanity: `GET /v1/discord/availability` answers `200` with `{"available":true}` once the secrets are set, and the Discord card appears as a second option in the import wizard's source step — the DiscordChatExporter upload path must still be offered alongside it, not replaced.
* **Rollback**: see **Rollback the Discord bot connection** in
  [`DB_ROLLBACK_PLAYBOOK.md`](DB_ROLLBACK_PLAYBOOK.md). **Read it before
  promoting** — dropping `discord_connections` discards every chapter's guild
  mapping, and there is no way to rebuild one without each chapter's admin
  re-running the OAuth flow by hand.

### 20260824150000_discord_connect_confirm.sql

* **Purpose**: close a confused-deputy hole in the migration above. That one
  bound a guild to whichever chapter minted the `state`, and minting a state is
  an ordinary permitted action for any `channels:manage` holder in **any**
  tenant. Both facts the callback checked were real — the guild came off the
  token exchange, Manage Server was read under the authorizing human's own token
  — but together they prove only that *a human with Manage Server installed the
  bot into guild G*, never that they intended *chapter X* to read it. Discord's
  consent screen names Signet; it does not name the chapter. These columns park
  the guild as pending and mint a second one-time token, delivered only to the
  browser that completed the OAuth, which activation requires alongside a session
  whose active chapter matches.
* **⚠️ Promoting `20260824140000` without this one is the vulnerability.** They
  were authored as one change and split only by filename. Phase-3 API code
  running against a `discord_oauth_states` that lacks `confirm_token` cannot
  perform the chapter check at all, and every Discord-side check still passes
  honestly, so nothing looks wrong from either end. If a window forces you to
  stop between them, roll `140000` back rather than leaving it live — the
  feature dark is fine, the feature half-migrated is not.
* **Shape**: nine nullable columns with no default (catalog-only, no rewrite)
  and one partial unique index. No data change; nothing to backfill.
* **Locks**: every `add column` is a catalog flag — ACCESS EXCLUSIVE held
  momentarily, no scan. The unique index build holds SHARE on
  `discord_oauth_states`, which holds only in-flight handshakes and is reaped
  hourly, so the window is negligible in any environment.
* **Checks** (after promotion):
  - `select count(*) from information_schema.columns where table_name='discord_oauth_states' and column_name in ('pending_guild_id','pending_guild_name','pending_guild_icon','pending_discord_user_id','pending_discord_username','pending_permissions','pending_scopes','confirm_token','confirm_expires_at','confirmed_at');` → **10**. Anything less means the chapter check cannot run — stop and re-read the emphasised bullet above.
  - `select data_type from information_schema.columns where table_name='discord_oauth_states' and column_name='confirm_token';` → `uuid`. It is minted by `gen_random_uuid()` server-side and must never be derived from anything a caller sent.
  - `select indexdef from pg_indexes where indexname='idx_discord_oauth_states_confirm_token';` → `UNIQUE`, with predicate **`WHERE (confirm_token IS NOT NULL)`**. Unique rather than plain because two rows sharing a token would make "the pending connection this token names" ambiguous, and resolving that ambiguity would decide which chapter gets a guild.
  - Sanity: complete a connect against a scratch Discord server, then confirm the callback lands on `…/discord-import?discord=…` and never returns a raw 500. A JSON error body here means the API is answering a top-level browser redirect with an exception — most often this migration pair not being applied at all, which is exactly how it presented on staging.
* **Rollback**: see **Rollback the Discord connect confirmation** in
  [`DB_ROLLBACK_PLAYBOOK.md`](DB_ROLLBACK_PLAYBOOK.md). **Read it before
  promoting** — rolling this back alone re-opens the confused-deputy hole
  described above, so it is a rollback of the pair or neither.

* **⚠️ Human action on the hosted projects.** Neither migration carries any of
  this, and all of it is dashboard-only:
  - The four Discord secrets must exist in Infisical for the environment. Names
    and per-environment values are owned by
    [`ENV_REFERENCE.md`](../environment/ENV_REFERENCE.md) — do not restate them
    here. `GET /v1/discord/availability` answering `false` after a clean
    promotion means a missing secret, not a missing table.
  - The OAuth redirect URI must be registered in the Discord Developer Portal
    for the environment, and it is the **API** origin, not the app origin —
    `https://api-staging.frapp.live/v1/discord/connect/callback`, not
    `https://app.staging.frapp.live/…`. This is the one that has actually been
    got wrong: the app origin looks right, matches `APP_URL`, and fails only at
    the end of a real OAuth round trip with Discord's own `invalid_redirect_uri`
    screen, after the admin has already picked a server.
  - The Message Content Intent must be ON for the app. Without it Discord answers
    `200` with `content: ""` on every message, so an import would silently write
    an archive of empty messages rather than fail.

## 2026-08-24: Discord archive importer — one migration

The importer itself. Promotes after the five foundation migrations below, which
it depends on (`chat_messages.author_name`, `chat_message_attachments`, and the
`chat-archive` bucket).

### 20260824120000_discord_import.sql

> **Comment correction (not yet applied to the file).** This migration's header
> says a signed-URL PUT of a disallowed type "answers 415 `invalid_mime_type`".
> The status is **400**; the `415` is a field inside the response body. The
> header is left as shipped because migration files are treated as immutable —
> tracked in #1409. Canonical statement:
> `packages/validation/src/upload-allowlists.ts` § What the bucket allowlist
> actually enforces.

* **Purpose**: give the importer its own identity column and the three tables an
  import needs while it runs. `chat_messages.external_message_id` holds the
  Discord message snowflake and is the re-run dedupe key; `discord_imports`,
  `discord_import_channels` and `discord_import_files` hold the job, the admin's
  channel mapping, and the manifest of uploaded files.
* **Reverses a phase-1 decision.** `20260823120000` put the snowflake in
  `client_message_id`; that was flagged for review at the time and is undone
  here. `client_message_id` is the *client's* optimistic-send key (ADR-03) —
  minted by the composer, round-tripped through the offline outbox — and sharing
  one column with a foreign system's identifier made every reader of either path
  check which kind of value it held. See the ADR-03 amendment of the same date.
* **Shape**: one nullable column with no default (catalog-only, no rewrite), two
  new indexes on `chat_messages`, three new tables with RLS enabled and **no
  policies**.
* **Locks**: `add column` is a catalog flag. **Both index builds hold SHARE on
  `chat_messages` for their duration**, which blocks writes — and unlike phase 1
  this may run against a table that already holds an archive, so size the window
  against `select count(*) from chat_messages` first and promote when send volume
  is low. Neither is `CONCURRENTLY`: Supabase migrations run inside a
  transaction.
* **`NULLS NOT DISTINCT` on the new index is inert**, and the migration header
  says so. `channel_id` is NOT NULL and the partial predicate excludes a null
  `external_message_id`, so neither key column can be null inside the index. It
  is spelled for symmetry with `idx_chat_messages_dedupe`; do not cite this index
  as evidence the clause matters.
* **Checks** (after promotion):
  - `select indexdef from pg_indexes where indexname='idx_chat_messages_external_dedupe';` → `UNIQUE`, on `(channel_id, external_message_id)`
  - `select is_nullable from information_schema.columns where table_name='discord_imports' and column_name='consent_acknowledged_at';` → **`NO`**. This is the compliance gate: a friction point enforced only in the web wizard is skippable by anything that calls the API directly, so the column is what guarantees no import exists that nobody acknowledged.
  - `select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname in ('discord_imports','discord_import_channels','discord_import_files');` → **0**
  - `select indexdef from pg_indexes where indexname='idx_chat_messages_discord_import';` → predicate is **`WHERE (kind = 'imported')`**. This is load-bearing and the obvious alternative is silently broken: Postgres must prove the query's `WHERE` implies the index predicate, and it cannot derive `metadata ? 'discord_import_id'` from `metadata ->> 'discord_import_id' = $1`. With that predicate the purge does not use the index even with `enable_seqscan = off` — unreachable, not merely unattractive, and indistinguishable from working until an import gets large.
  - Sanity: `POST /v1/discord-imports` without `consent_acknowledged` answers 400.
* **Rollback**: see **Rollback the Discord importer** in
  [`DB_ROLLBACK_PLAYBOOK.md`](DB_ROLLBACK_PLAYBOOK.md). **Read it before
  promoting** — dropping `external_message_id` destroys re-run idempotency for
  any archive already imported, so re-running the importer after that rollback
  duplicates the whole archive.

## 2026-08-24: Discord archive foundation — five migrations

The schema and insert-path work that has to exist before a DiscordChatExporter
import can be written. The importer itself is **not** in this change. Three of
the five are also live-chat fixes that stand on their own.

Promote them **in filename order**; they are ordered by dependency (the
attachments backfill reads rows the authors migration does not touch, but the
kind-semantics migration replaces a policy the authors migration leaves alone).

### 20260823120000_chat_message_authors.sql

* **Purpose**: let a message name an author who is not a Signet user. `sender_id`
  becomes nullable and `author_name` / `author_avatar_path` /
  `author_external_id` are added, so an imported Discord message can carry
  attribution without minting a `users` row per Discord handle — a row there is
  reachable from the chapter roster, the members directory, server-side mention
  resolution and `anonymize_user`, so synthetic users would publish non-members
  into all four to satisfy a foreign key.
* **Shape**: additive plus one `NOT NULL` drop. Three nullable columns with no
  default (catalog-only, no rewrite), one CHECK, one index replaced, one index
  added.
* **Locks**: `alter column drop not null` is a catalog flag — ACCESS EXCLUSIVE
  held momentarily, no heap rewrite. The CHECK is added `NOT VALID` and validated
  in a second statement, so the scan runs under SHARE UPDATE EXCLUSIVE and does
  **not** block chat sends; adding it validated would have held ACCESS EXCLUSIVE
  for a full table scan. `idx_chat_messages_dedupe` is dropped and recreated —
  that is a real (brief) window with no dedupe index, so run it when send volume
  is low; the index build holds SHARE.
* **The `NULLS NOT DISTINCT` clause — superseded, but the index is kept.** This
  entry originally said the importer writes the Discord *message* snowflake into
  `client_message_id`, and that the clause is what makes a re-run safe. **That is
  no longer true.** `20260824120000_discord_import.sql` gave the importer its own
  `external_message_id` column and its own index; `client_message_id` stayed the
  client's optimistic-send key (ADR-03, and its 2026-08-24 amendment).
  The clause on `idx_chat_messages_dedupe` is therefore now inert — imported rows
  do not set `client_message_id`, and live rows always carry a sender. It is
  deliberately **not** removed: dropping and rebuilding a unique index on the
  product's hot insert path would open a real window with no idempotency
  protection on live sends, to delete something that costs nothing.
  `author_external_id` is the *author's* id and was never part of either key,
  since two messages from one author in one channel share it.
* **Checks** (after promotion):
  - `select is_nullable from information_schema.columns where table_name='chat_messages' and column_name='sender_id';` → `YES`
  - `select convalidated from pg_constraint where conname='chat_messages_author_present';` → `t`
  - `select indexdef from pg_indexes where indexname='idx_chat_messages_dedupe';` → contains `NULLS NOT DISTINCT` (retained, now inert — see above)
  - Sanity: an existing message still shows its sender in the web client (the
    label now resolves through `resolveAuthorLabel` in `@repo/hooks`).
* **Rollback**: see **Rollback the chat author fields** in
  [`DB_ROLLBACK_PLAYBOOK.md`](DB_ROLLBACK_PLAYBOOK.md). **Coordinated** — re-adding
  `NOT NULL` fails while any imported row exists.

### 20260823121000_chat_message_attachments.sql

* **Purpose**: attachments become rows. The composer appended
  `📎 <name> (<storagePath>)` into `chat_messages.content`, so the message body was
  the only record the object existed — nothing linked it to the message, it could
  not be rendered or listed, deleting the message could not clean it up, and a
  member could edit the sigil out and orphan the file. This is a live-chat bug;
  the Discord import needs the same model.
* **Shape**: one new table (RLS enabled, **no policies** — default deny, matching
  `chat_channels`), two indexes, one unique constraint, and a **data backfill**
  that parses the legacy sigils out of existing message bodies into rows and then
  strips them from `content`.
* **`channel_id` is denormalised on purpose.** `chat_messages` has no
  `chapter_id`; chapter scope is reached through `chat_channels`. Carrying
  `message_id` alone would make this table's tenant scope a two-hop resolution
  the repository tenant-scope harness cannot express and every read would have to
  spell as a nested PostgREST embed. It is always derived from the message
  server-side, never from client input.
* **Locks**: `create table` is trivial. The backfill `UPDATE` touches only rows
  matching the sigil pattern (`where m.content ~ …`), so on a chapter that never
  attached a file it updates nothing.
* **The backfill rewrites message bodies.** It is reversible by construction —
  the filename and the storage path both survive in the new rows — but read the
  rollback entry before promoting. The path group is anchored on
  `chapters/<uuid>/chat/` so a member who typed that shape by hand is not matched.
* **Checks** (after promotion):
  - `select count(*) from chat_message_attachments;` → matches the number of
    legacy sigils; compare against
    `select count(*) from chat_messages where content ~ '📎 .+ \(chapters/';` → **0**
  - `select relrowsecurity from pg_class where relname='chat_message_attachments';` → `t`
  - `select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname='chat_message_attachments';` → **0**
  - Spot-check one rewritten message: the body reads cleanly and its attachment
    row carries the same filename.
* **Rollback**: see **Rollback chat attachments** in the playbook.

### 20260823122000_chat_message_search_vector.sql

* **Purpose**: message search stops being an unindexed `ILIKE '%q%'`. Adds a
  generated `content_search tsvector` and a GIN index; `SearchService` switches to
  `websearch_to_tsquery`.
* **Shape**: one stored generated column, one GIN index.
* **Locks — the one to schedule.** Unlike a plain `add column` with a
  non-volatile default, a STORED generated column **rewrites the heap** under
  ACCESS EXCLUSIVE: chat sends block for the length of the rewrite. The GIN build
  that follows is a plain `create index` (not `CONCURRENTLY` — Supabase
  migrations run inside a transaction, and `CONCURRENTLY` cannot) and holds SHARE,
  blocking writes for its duration.
  **Both are trivial at today's row count and would not be after an import.**
  Landing this before the archive is the entire reason it is in the foundation
  slice. Size the window against `select count(*) from chat_messages;` — this
  supersedes the "there is deliberately no index on `chat_messages`" note in the
  2026-08-16 entry, which was specifically about a GIN index on `mentions` that
  an aggregate `filter` clause could never use.
* **No new extension.** `pg_trgm` and `unaccent` are available in the Supabase
  image but installed nowhere, and the PGlite CI gate registers only `pgcrypto`
  and `vector`. Plain tsvector + GIN is core Postgres. The behaviour change is
  stemming (searching `attach` now finds `attached`) and the loss of
  within-word substring matching.
* **Checks** (after promotion):
  - `select is_generated from information_schema.columns where table_name='chat_messages' and column_name='content_search';` → `ALWAYS`
  - `explain select 1 from chat_messages where content_search @@ websearch_to_tsquery('english','budget');`
    → **at archive scale**, a Bitmap Index Scan on `idx_chat_messages_content_search`.
    On a small table expect a Seq Scan and do **not** treat that as a failure: GIN
    has a high startup cost, so the planner correctly prefers a sequential scan
    until the table is big enough to pay for it. Measured on PG 17.6 here: at 5k
    rows it chose Seq Scan; at 60k it chose the index unprompted (1.95 ms vs
    14.5 ms with the index paths disabled). To prove the index is *usable* on a
    small table, `set enable_seqscan = off;` and re-run the `explain`.
  - `GET /v1/search?q=<a phrase you know exists>` returns the hit.
* **Rollback**: see **Rollback chat message search** in the playbook. **Coordinated**
  — the API queries the column by name.

### 20260823123000_chat_imported_kind_semantics.sql

* **Purpose**: two rules that make `kind = 'imported'` safe.
  `get_channel_unread_counts` excludes imported rows explicitly, and the
  `chat_messages` SELECT policy excludes them so Supabase Realtime never fans an
  archive backfill out to connected clients.
* **Shape**: `create or replace function` plus a policy drop/recreate. No table
  touched, no data rewritten.
* **The unread change is a no-op today, on purpose.** The previous body joined on
  `m.sender_id <> p_user_id`, which is NULL for a null-sender row and so excluded
  imported messages *by accident*. That is the behaviour we want, which is exactly
  why it now says so: the accident is invisible, it reads as a null-safety bug to
  anyone auditing, and the obvious "fix" (`is distinct from`) would silently hand
  every member a badge the size of the import. Both rules are now stated
  independently.
* **The policy change is the Realtime fan-out control.** Supabase Realtime
  evaluates this exact policy per subscriber in `realtime.apply_rls` and emits a
  frame only for rows that pass. **A publication row filter cannot substitute**:
  `realtime.list_changes` builds wal2json's `add-tables` parameter from
  `pg_publication_tables` names and never reads `prqual`, so
  `alter publication supabase_realtime ... where (kind <> 'imported')` is silently
  ignored. It costs nothing functionally — nothing reads `chat_messages` directly
  through PostgREST (verified: no `from('chat_messages')` anywhere in `apps/web`,
  `apps/mobile` or `packages/*`), so this policy exists solely as the Realtime
  carrier.
* **The predicate is untouched deliberately.** `can_read_chat_message` is *also*
  the `chat_message_actions` SELECT policy, so pushing `kind` into the function
  would break reactions and poll votes on imported messages. The rule lives in
  the policy.
* **Checks** (after promotion):
  - `select pg_get_expr(polqual, polrelid) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname='chat_messages';`
    → contains `kind <> 'imported'`
  - `select prosrc from pg_proc where proname='get_channel_unread_counts';`
    → contains both `kind <> 'imported'` and `sender_id is distinct from`
  - `select grantee from information_schema.role_routine_grants where routine_name='get_channel_unread_counts';`
    → no `anon`/`authenticated` rows
  - **Live check, worth doing by hand**: subscribe a browser to a channel, insert
    one `kind='text'` and one `kind='imported'` row into it, and confirm exactly
    one frame arrives.
* **Rollback**: see **Rollback the imported-kind semantics** in the playbook.

### 20260823124000_chat_archive_bucket.sql

* **Purpose**: a `chat-archive` storage bucket for media pulled out of a Discord
  export — wider MIME list and a 100 MB cap (Discord's boosted-server per-file
  ceiling), versus live chat's 13-type `document` list and 25 MB.
* **Shape**: one bucket upsert, guarded on `to_regclass('storage.buckets')` so it
  is a no-op on bare Postgres (the PGlite gate). Private, no `storage.objects`
  policies — same posture as every other bucket.
* **Writes — superseded by `20260824120000`.** This entry planned for the
  importer to fetch each Discord CDN object itself and write the bytes through
  `IStorageProvider.uploadFile`. The importer that shipped does not: the admin
  runs DiscordChatExporter with `--media`, which downloads the media to their own
  machine, and their **browser** uploads each file straight to this bucket
  through a signed URL on that path. **This is no longer the only writer.** The
  phase-3 bot path (`20260824140000_discord_bot_connection.sql`) has the API
  stream attachments out of Discord's CDN into the same bucket through
  `IStorageProvider` on the service-role key — a different code path, with the
  MIME check performed in the worker before the transfer rather than by the
  bucket alone. Do not scope an incident on this bucket to signed-URL uploads.
  So `allowed_mime_types` is now the enforcement point rather than a second belt
  — and it does enforce, though only over the **declared** header, never the
  bytes. The rejection is **HTTP 400**, not the `415` several comments in this
  repo claimed; see `packages/validation/src/upload-allowlists.ts` § What the
  bucket allowlist actually enforces for the captured response and its caveats.
  The API additionally re-derives the expected type from the file extension
  before minting a URL, so a rejection is a readable error rather than a failed
  PUT. Content type still cannot be pinned at sign time (#1230).
* **Object layout — also superseded.** The migration header declares
  `chapters/{chapter_id}/chat-archive/{channel_id}/{message_id}/{basename}`,
  which assumes Signet ids exist when the object is written. They do not: the
  browser uploads before any channel or message has been created. The shipped
  layout is import-scoped —
  `chapters/{chapter_id}/chat-archive/imports/{import_id}/{export,media}/…` —
  which also gives the per-import purge a single prefix to sweep. Canonical
  definition: `archiveImportPrefix()` in
  [`apps/api/src/domain/constants/storage.ts`](../../../apps/api/src/domain/constants/storage.ts).
* **⚠️ Human action on the hosted projects.** `supabase/config.toml` sets a
  **global** storage `file_size_limit`, raised to `104857600` in this change for
  the local stack. The hosted projects have an equivalent **project-level**
  setting that is dashboard-only and is **not** carried by promoting migrations —
  a 100 MB object will be rejected until someone raises it under
  Storage → Settings. Do this before running the importer, or attachments over
  25 MB fail with a 413 that looks like a bucket misconfiguration.
* **Checks** (after promotion):
  - `select id, public, file_size_limit, array_length(allowed_mime_types,1) from storage.buckets where id='chat-archive';`
    → `chat-archive | f | 104857600 | 33`
  - Upload a >25 MB test object through the API and confirm it lands (this is what
    catches the dashboard setting above).
* **Rollback**: see **Rollback the chat-archive bucket** in the playbook.

## 2026-08-16: Chat unread + mention counts (C1 of #937)

### 20260816190000_chat_unread_and_mentions.sql

* **Purpose**: Give the server the ability to answer "how many unread, how many mentions" per
  channel, which it has never had. The read cursor already exists and is written on every channel
  open (`POST /v1/channels/{id}/read` → `channel_read_receipts.last_read_at`), but nothing read it
  back: `findByChannelAndUser` has zero production call sites and `GET /v1/channels` returns raw
  rows with no aggregation. Mentions did not exist as data at all — the push worker has been
  reading a `mentions` field off the message row through a structural cast over a column that never
  existed, so the `mentions` push tier has never fired for anyone. Mobile's channel list needs both
  badges, and web's #315 badge is intended to read the same function rather than
  grow a second definition of "unread" — neither client is wired to it yet as of
  this migration.
* **Shape**: additive only. One column (`chat_messages.mentions uuid[] not null default '{}'`), one
  index, one `security definer` function. No table created, no column dropped, no data rewritten.
  Every statement is guarded (`if not exists` / `create or replace`), so the file is re-runnable.
* **Locks — the part worth reading before scheduling.** The `add column` is cheap: it takes an
  `ACCESS EXCLUSIVE` lock but does not rewrite the heap, because Postgres stores a non-volatile
  default as catalog metadata rather than materialising it per row (confirmed on PG 17.6 against a
  50k-row table: `pg_relation_filenode` unchanged, `atthasmissing = t`). So it is O(1) in
  `chat_messages` size and the exclusive lock is held only momentarily.
  The index is the one to think about, because a plain `create index` (not `concurrently`) holds a
  `SHARE` lock for the whole build, blocking every INSERT/UPDATE/DELETE on that table meanwhile.
  Here it is on `channel_read_receipts`, which holds at most one row per member per channel, so the
  build is short. **There is deliberately no index on `chat_messages`** — see the migration's own
  comment for why a GIN index there would have been unusable *and* would have blocked chat sends
  for the length of its build. If a future migration does index `chat_messages`, size the window
  against that table's row count rather than assuming this entry's profile.
* **Why `security definer`**: `chat_channels` and `channel_read_receipts` both have RLS enabled with
  **zero policies** (`00000000000000_initial_schema.sql:468,471`), which denies everything to
  non-service roles. The function is granted to `service_role` only — `public`, `anon` and
  `authenticated` are explicitly revoked — and `search_path` is pinned to `public, pg_temp` — with `pg_temp`
  **last**, which is the part that matters: named implicitly it is searched *first*, so a session that can
  `create temp table chat_messages (...)` would have the definer function read its forged rows. Verify with
  `select proconfig from pg_proc where proname='get_channel_unread_counts';` — expect `{"search_path=public, pg_temp"}`.
  Per-channel access is filtered in the service against the same predicate the rest of chat uses,
  rather than duplicated in SQL where it would drift.
* **Not yet applied.** This lands as a file only; promotion follows the order at the top of this
  runbook. Nothing was run against a hosted project as part of the change that introduced it. It was
  applied and exercised against the local stack only.
* **Checks** (after promotion):
  - Objects exist — expect one row each:
    `select 1 from information_schema.columns where table_name='chat_messages' and column_name='mentions';`
    `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_channel_unread_counts';`
  - Grants are service-role only — expect no `anon`/`authenticated` rows:
    `select grantee from information_schema.role_routine_grants where routine_name='get_channel_unread_counts';`
  - Function answers for a real member (substitute ids) — expect one row per channel in the chapter,
    including channels with zero unread:
    `select * from public.get_channel_unread_counts('<chapter_id>','<users.id>');`
  - Sanity: no member sees their own messages as unread — pick a chapter's most recent sender and
    confirm the channel they just posted in does not count that message.
* **Rollback**: see **Rollback the chat unread/mention slice** in
  [`DB_ROLLBACK_PLAYBOOK.md`](DB_ROLLBACK_PLAYBOOK.md). Note it is a **coordinated** rollback — the
  API must be redeployed to a pre-C1 revision *before* the function is dropped, or
  `GET /v1/channels/unread` 500s on every poll.

## 2026-08-14: Backfill `chapters.accent_color` from branding (#795)

### 20260814120000_backfill_chapter_accent_color_from_branding.sql

* **Purpose**: Data-only repair. The onboarding wizard wrote the officer's chosen accent into
  `chapters.branding.colors.accent` and into the derived `theme_palette`, but never into the
  `chapters.accent_color` column, which kept its schema default `#2563EB`. Every surface reading
  the column — the web dashboard shell, mobile chapter branding, the membership summary in
  `packages/hooks` — rendered Royal Blue for a chapter that had chosen something else, while
  `theme_palette` readers were branded correctly. The API now treats `branding.colors.accent` as
  authoritative and mirrors it into the column on all three write paths, so this only repairs rows
  written before that.
* **Shape**: single `UPDATE`, no DDL, no locks beyond the touched rows. Idempotent and re-runnable:
  it matches only rows whose branding holds a well-formed `#RRGGBB` accent differing from the
  column, and uses `is distinct from` so a NULL column is handled rather than skipped.
* **Not yet applied.** This lands as a file only; promotion follows the order at the top of this
  runbook. Nothing was run against a hosted project as part of the change that introduced it.
* **Checks** (after promotion):
  - Rows still disagreeing — expect 0:
    `select count(*) from public.chapters where branding->'colors'->>'accent' ~ '^#[0-9A-Fa-f]{6}$' and accent_color is distinct from branding->'colors'->>'accent';`
  - Rows repaired, before/after: `select count(*) from public.chapters where accent_color = '#2563EB';`
    should fall by the number of chapters that had chosen a custom accent.
* **Rollback**: no schema change to revert. The previous per-row values are not recoverable from
  the migration itself, so capture them first if that matters:
  `create table tmp_accent_backup as select id, accent_color from public.chapters;`
  Restoring is an `UPDATE … FROM` off that table. In practice the pre-state is the schema default
  for affected rows, which carried no information.

## 2026-08-10: Staging migration backlog cleared — two blockers behind the #696 credential

On 2026-08-10 the first CI-driven migration since 2026-02-28 ran successfully against `frapp-staging` ([run 31318329969 attempt 4](https://github.com/pdcarlson/Frapp/actions/runs/31318329969)), applying **38** migrations in a single push. `schema_migrations` went from 1 row to 39 — it held 2 before the foreign row described below was removed. Post-apply state: public tables 29 → 44, public functions 1 → 15, storage buckets 0 → 7 (`backwork, branding, chat, documents, profiles, reports, service`).

**Every dated section below except the initial schema** was applied to staging in that one run, not on its own date — staging's history contained nothing but `00000000000000_initial_schema`. Treat their "after `db push`" checks as first verified on 2026-08-10, and note that production has had no successful CI migration either (#832).

Fixing the invalid Infisical credential (#696) was necessary but **not sufficient**. Two further blockers only became visible once injection worked, and both will recur on the first **production** migration:

* **`SUPABASE_DB_PASSWORD` is mandatory.** The pinned Supabase CLI cannot initialise its `cli_login_postgres` login role — it sets that role's password with an already-expired `valid until`, failing as `42501: permission denied to alter role`. Reads like a privilege problem; is a CLI bug ([supabase/cli#5091](https://github.com/supabase/cli/issues/5091), pin tracked in #835). Setting `SUPABASE_DB_PASSWORD` in the Infisical environment makes the CLI connect directly and skip the broken path. Present in the Infisical `development`, `staging`, and `production` environments as of 2026-08-10. Verified on both as of 2026-08-29: `frapp-prod` is `ACTIVE_HEALTHY`, not paused, and run [33275321347](https://github.com/pdcarlson/Frapp/actions/runs/33275321347) applied production migrations successfully — so the production value is exercised, not merely provisioned. (This line previously said the opposite, from a period when `frapp-prod` was paused and no production deploy had run.)
* **Migration-history reconciliation.** `db push` refused with `Remote migration versions not found in local migrations directory`. Staging's `schema_migrations` carried `20260228000000_enable_rls_on_remaining_tables`, a version that has never existed in this repository on any branch. Its recorded `statements` column showed four `alter table … enable row level security` calls (`users`, `chapters`, `push_tokens`, `user_settings`) — a hand-applied February hotfix. The current `00000000000000_initial_schema.sql` already enables RLS on all four, so the row was redundant and was deleted.

**On-call note — reconciling a foreign migration row.** When `db push` reports a remote version missing locally, the CLI suggests `supabase migration repair --status reverted <version>`. **Do not run it blind.** First read what the row actually did:

```sql
select version, name, array_to_string(statements, E'\n;;\n') as sql_text
from supabase_migrations.schema_migrations where version = '<version>';
```

Postgres stores the executed SQL, so a migration absent from git is still fully recoverable from the database. Only once you have confirmed its effects are either redundant with the repo or intentionally superseded should you remove the row (`delete from supabase_migrations.schema_migrations where version = '<version>';` — equivalent in effect to `repair --status reverted`, and what was used here). Record the `version` and `name` first — re-inserting them is the rollback. If the row's SQL is **not** represented in `supabase/migrations/`, stop: the correct fix is a new migration capturing it, not deleting the evidence.

**This class of drift now has a detector.** `.github/workflows/check-migration-drift.yml` runs
daily (07:00 UTC) and compares `supabase_migrations.schema_migrations` on each deployed database
against `supabase/migrations/`, reporting three sets — **pending** (in the repo, not applied),
**foreign** (applied, absent from the repo), and **matched**. Foreign rows fail immediately;
pending rows are tolerated for 24h after their own version timestamp so a just-merged migration is
not an alert. A failure upserts one `routine-state` tracking issue and closes it once every
environment is back in sync, so "alert issue open" means "a deployed database is drifting right
now". Semantics in `scripts/ci/check-migration-drift.mjs`; run it by hand from the Actions tab
(`workflow_dispatch`, with an adjustable grace window) or via `npm run check:migration-drift`.

The check **reports and never repairs** — it sends no SQL. Reconciling a foreign row is the manual
procedure above, and applying a backlog of pending migrations is a deliberate promotion, not
something a watchdog should do on its own.

## 2026-08-09: Activation funnel — `chapter_activation_milestones` (#267)
* **Migration**: `20260809001500_chapter_activation_milestones.sql`
* **Purpose**: Records the first time a chapter reaches each of the seven free-to-paid activation milestones (onboarding submitted → first invite → first redemption → first chat message → first paid module → checkout started → checkout completed), per `spec/behavior/observability.md` § Product Analytics — Activation Funnel. The unique `(chapter_id, milestone)` key *is* the "first" semantics: the API attempts an insert on every candidate action and only a winning insert emits the analytics event, so Stripe redeliveries and client retries cannot double-count. It also keeps conversion queryable in plain SQL when no `POSTHOG_API_KEY` is set.
* **Safety**: Purely additive — one new table, one new index, no changes to any existing object, no backfill. `chapter_id` FKs to `chapters` with `on delete cascade`, so chapter deletion cleans up. RLS is enabled with **zero policies** (API/service-role only, same posture as `stripe_webhook_events` and `chapter_directory_requests`); the table holds bookkeeping with no user id and nothing member-visible. The `milestone` CHECK pins the seven values to `ACTIVATION_MILESTONES` in `@repo/validation` — the two must be edited together.
* **Order**: Apply **before** deploying the API build with #267. The post-#267 services call `ActivationService.record` at seven call sites; a missing table makes every call throw inside the service's own catch, which logs an error per action and records nothing. It cannot break a request — recording is best-effort by construction — so the only cost of applying late is a gap in the funnel plus log noise. Harmless ahead of the deploy: nothing reads or writes the table until that build ships.
* **Checks**: After `db push`, `insert into chapter_activation_milestones (chapter_id, milestone) values ('<real chapter uuid>', 'activation-onboarding-submitted');` succeeds, and running the identical insert a second time fails with a unique violation on `chapter_activation_milestones_chapter_id_milestone_key`. `insert … values ('<uuid>', 'not-a-milestone');` must fail the CHECK. Clean up with `delete from chapter_activation_milestones where chapter_id = '<uuid>';`. Post-deploy, completing the onboarding wizard for a new chapter must leave exactly one `activation-onboarding-submitted` row for it.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback the activation funnel table.

## 2026-08-05: Durable Stripe webhook idempotency — `stripe_webhook_events` (FRA-23)
* **Migration**: `20260805150000_stripe_webhook_events.sql`
* **Purpose**: Replaces `BillingService`'s process-local `Set<string>` of handled Stripe event ids with a persisted claim table plus the `claim_stripe_webhook_event` CAS function. The in-memory set died with the process, so a Render deploy, a crash, or a second API instance let Stripe's replay re-apply an event — double-writing subscription status and re-firing the president's billing alert. `chapters.last_stripe_webhook_at` (FRA-242) does **not** cover this: it treats two events sharing a Stripe second as not-stale by design, and a redelivery carries the same `event.created` as the mark it wrote.
* **Safety**: Purely additive — one new table, one new function, no changes to any existing object. RLS is enabled with **zero policies** (API/service-role only, same posture as `chapter_directory_requests`); the table holds delivery bookkeeping with no `chapter_id`, no FK and nothing member-visible. `security invoker` matches `apply_invoice_payment`: the API always calls it through the service-role client, which bypasses RLS.
* **Order**: Apply **before** deploying the API build with FRA-23 — the post-FRA-23 `BillingService` claims every side-effecting event, and a missing table surfaces as a 500 on `POST /v1/webhooks/stripe`, which Stripe then retries for days. Harmless ahead of the deploy: nothing reads the table until that build ships.
* **Checks**: After `db push`, `select claim_stripe_webhook_event('evt_probe','invoice.paid',300);` returns `(claimed,1)`; calling it a second time returns `(in_flight,1)`; after `update stripe_webhook_events set status='failed' where event_id='evt_probe';` it returns `(claimed,2)`. Clean up with `delete from stripe_webhook_events where event_id = 'evt_probe';`. Post-deploy, replaying a delivered event from the Stripe dashboard must log `Skipping already-processed event …` and leave `chapters` untouched.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback durable Stripe webhook idempotency.

## 2026-08-03: `service` storage bucket for service-hour proofs (FRA-49)
* **Migration**: `20260803231500_service_proof_bucket.sql`
* **Purpose**: Provisions the private `service` storage bucket that holds service-hour proof uploads under `chapters/{chapter_id}/service/{proof_id}/` per `spec/behavior/service-hours.md`. First bucket managed in a migration (the five older buckets were dashboard-created); the row carries `allowed_mime_types` (images + PDF) and `file_size_limit` (25MB) because storage-api enforces those columns on the signed-URL PUT itself — the API's allowlist only gates URL issuance and a signed upload URL cannot pin a content type.
* **Safety**: Additive DML into `storage.buckets` only — no DDL, no data changes, no RLS policies (the bucket is private; all access goes through API-issued signed URLs, which bypass RLS). The whole statement is wrapped in a `DO` block that no-ops when `storage.buckets` doesn't exist, so it replays cleanly on bare Postgres / PGlite. `ON CONFLICT (id) DO UPDATE` re-asserts `public=false` and the constraint columns, so re-running (or a pre-existing hand-made bucket) converges to the intended config.
* **Order**: Apply **before** deploying the API build with FRA-49 — `POST /v1/service-entries/proof-upload-url` mints upload URLs against the bucket, and a missing bucket surfaces as a 500 on that route (entry creation without proof is unaffected). Harmless ahead of the deploy.
* **Checks**: After `db push`, `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'service';` returns 1 row with `public = false`, `file_size_limit = 26214400`, and the five image/PDF MIME types. Post-deploy, requesting an upload URL (member with `service:log`), PUTting a small PNG to it, and creating an entry with the returned path must succeed end to end; PUTting a `text/html` body to a fresh signed URL must be rejected by storage-api.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback the `service` proof bucket.

## 2026-08-03: `chat_message_actions` membership-scoped read RLS (FRA-38)
* **Migration**: `20260803150000_chat_message_actions_membership_rls.sql`
* **Purpose**: Closes a high-severity cross-tenant read leak. The table's `SELECT` policy was `using (auth.role() = 'authenticated')`, so any authenticated user could read every reaction/poll-vote row in every chapter, private DM and role-gated channel — and the web client reads this table **directly under the user's JWT** (a per-channel backfill plus a global Realtime subscription), so RLS was the only gate. Replaces the policy with one scoped `TO authenticated` and gated on a new `SECURITY DEFINER` helper `public.can_read_chat_message(uuid)` that mirrors the canonical `canAccessChannel` predicate. Details in `docs/internal/security/SECURITY_FIXES.md`.
* **Safety**: Non-destructive — one `create or replace function` plus a `drop policy if exists` / `create policy` swap on the same policy name. No columns, no data, no backfill, and **no replica-identity change** (see the migration header for why `FULL` is deliberately *not* set). `security definer` with `search_path` pinned to `public`, EXECUTE revoked from `public`/`anon` and granted to `authenticated`/`service_role`; every role statement — including the policy's `TO authenticated` clause, emitted via `format()` — is guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite. INSERT/DELETE policies and the `service_role` write path are untouched, so Edge Function hot-path writes are unaffected.
* **Order**: Standalone — **no coordinated app deploy required**. No application code changes with it; the web backfill and Realtime subscription work under either policy. Safe to apply at any point relative to the API/web rollout.
* **Checks**: After `db push`:
  * `select polname, polroles::regrole[], pg_get_expr(polqual, polrelid) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'chat_message_actions' and p.polpermissive and p.polcmd in ('r','*');` returns **exactly one** row — `chat_message_actions_select`, `polroles = {authenticated}`, expression containing `can_read_chat_message(message_id)` joined by `AND`. Note `polcmd in ('r','*')`: a `FOR ALL` policy also applies to SELECT and ORs in, so checking `'r'` alone would miss it. Any second permissive row here re-opens the leak.
  * `select prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_read_chat_message';` returns `prosecdef = true` and `proconfig = {search_path=public}`.
  * `select has_function_privilege('anon', 'public.can_read_chat_message(uuid)', 'execute');` returns `false`; the same for `authenticated` returns `true`.
  * `select relreplident from pg_class where relname = 'chat_message_actions';` returns `d` (default). `f` means someone re-added `REPLICA IDENTITY FULL` on the disproven rationale.
  * `polroles = {authenticated}` above **is now exercised in CI** — the PGlite harness creates the `authenticated` role before applying migrations, so the `pg_roles`-guarded `TO authenticated` clause is emitted there and binds its probe role. Still worth eyeballing here, because CI proves the clause is emitted, not that this project applied the migration that emits it. Without the clause, anon reads can fail with `42501 permission denied for function` instead of returning no rows, depending on plan shape.
  * Post-apply smoke: open the chat page as a normal member — reactions still render on load (backfill) and a reaction added in another session still appears live (Realtime INSERT). If reactions vanish entirely, the policy is denying legitimate reads: roll back per the playbook rather than debugging in production.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback `chat_message_actions` membership-scoped read RLS.

## 2026-08-03: Account deletion — `users.deleted_at` + `anonymize_user` RPC (FRA-40)
* **Migration**: `20260803140000_account_deletion_anonymize_user_rpc.sql`
* **Purpose**: Implements the DB half of individual account deletion per `spec/behavior/data-retention.md`. Adds `users.deleted_at timestamptz` (tombstone marker), the `anonymize_card_content(text, text)` helper, and `anonymize_user(uuid, boolean)` — an atomic function that scrubs the users row in place (email → per-user `@anonymized.invalid` sentinel, display name → "Deleted User", bio/avatar/graduation year/city/company/active chapter → null), deletes current-state rows (members → cascades member_custom_field_values, user_settings, push_tokens, notifications, notification_preferences, chat_notification_preferences, channel_read_receipts, study_sessions), and rewrites the deleted user's display-name snapshots inside task/points/event chat cards — the payload name keys plus the generated `content` string (content keyed on each row's own payload snapshot, word-boundary matched, so renames and similar names are safe; event cards, which carry no payload name, get a structural creator-prefix rewrite) — in a single combined UPDATE that runs on the **first successful scrub only** (snapshots are historical and cannot regress once memberships are gone). It deliberately has **no tombstone early-return** for the users-row scrub: every call re-runs it (preserving the original `deleted_at`), so PII written onto the tombstone during the API's retry window is re-scrubbed, while retries stay cheap because the card scan is first-run-gated. History (point transactions, attendance, chat messages, service entries, poll votes, reactions, invoices) keeps its FKs to the tombstone. `DELETE /v1/users/me` calls it via `AccountDeletionService`.
* **Safety**: Additive DDL — one nullable column (`ADD COLUMN IF NOT EXISTS`, no default, no backfill) plus `create or replace function`. The function itself deletes/overwrites rows **only for the single user id it is invoked with**, only via the API's authenticated self-service route. `security invoker` with EXECUTE revoked from `public`/`anon`/`authenticated` and granted to `service_role`; role statements guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite. Refuses the seeded system user id.
* **Order**: Apply **before** deploying the API build with FRA-40 — the new `DELETE /v1/users/me` route calls the function, and a missing function surfaces as a 500. Harmless ahead of the deploy (nothing calls it yet).
* **Checks**: After `db push`, `select proname, prosecdef from pg_proc where proname in ('anonymize_user','anonymize_card_content');` returns 2 rows with `prosecdef = false`; `select has_function_privilege('service_role', 'public.anonymize_user(uuid, boolean)', 'execute');` returns `true` and the same for `anon`/`authenticated` returns `false`; `select column_name from information_schema.columns where table_name = 'users' and column_name = 'deleted_at';` returns 1 row. Post-deploy, deleting a test account must return `{"success":true}`, leave the row with `display_name = 'Deleted User'` and `deleted_at` set, and preserve its point/chat history.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback account deletion.

## 2026-08-03: Invoice payment RPC + idempotency indexes (FRA-15)
* **Migration**: `20260803120000_invoice_payment_rpc_and_indexes.sql`
* **Purpose**: Adds `apply_invoice_payment(uuid, uuid, text, text)` — a compare-and-set that moves an `OPEN` invoice to `PAID` and inserts its `PAYMENT` ledger row (with the Stripe charge id) in one transaction — plus two partial unique indexes on `financial_invoices.stripe_payment_intent_id` and `financial_transactions.stripe_charge_id` (PAYMENT rows). Both the Stripe webhook and the admin manual-PAID path call the function, which is what makes their race safe in both directions per `spec/behavior/billing.md`.
* **Safety**: Additive — one `create or replace function` and two `create unique index if not exists`. No columns, no data changes, no destructive DDL. Both indexed columns were never written before this change set, so the indexes cannot conflict with existing rows. `security invoker`, with EXECUTE revoked from `public`/`anon`/`authenticated` and granted to `service_role`; the role statements are guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite.
* **Order**: Apply **before** deploying the API build that contains FRA-15 — the new code calls the function on the webhook path, and a missing function surfaces as a 500 that Stripe retries for up to ~72h. The migration is harmless ahead of the deploy (nothing calls it yet).
* **Checks**: After `db push`, `select proname from pg_proc where proname = 'apply_invoice_payment';` returns 1 row; `select has_function_privilege('service_role', 'public.apply_invoice_payment(uuid, uuid, text, text)', 'execute');` returns `true` and the same for `anon`/`authenticated` returns `false`; `select indexname from pg_indexes where indexname in ('idx_financial_invoices_payment_intent','idx_financial_transactions_payment_charge');` returns both. Post-deploy, a member dues payment should move the invoice to `PAID` and leave exactly one `financial_transactions` row with a non-null `stripe_charge_id`; a webhook redelivery must not add a second.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback the invoice payment RPC + indexes.

## 2026-08-02: Active-chapter JWT claim — `custom_access_token_hook` (FRA-303)
* **Migration**: `20260802120000_active_chapter_jwt_claim.sql`
* **Purpose**: Adds `users.active_chapter_id uuid references chapters(id) on delete set null` and the `public.custom_access_token_hook(event jsonb)` auth hook that stamps it into every issued access token as the top-level `active_chapter_id` claim. This is the authoritative chapter context `ChapterGuard` reconciles against per `spec/behavior/multi-tenancy.md`; before it, the client-supplied `x-chapter-id` header was the only source.
* **Safety**: Additive — one nullable column (`ADD COLUMN IF NOT EXISTS`, no default, no backfill) plus `create or replace function`. The hook body is wrapped in `exception when others then return event`, so a failure degrades to an unmodified token rather than blocking sign-in. Role grants are guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite. Two SELECT policies scoped **to `supabase_auth_admin` only** are added on `users` and `members` (both have RLS enabled with no policies); the API uses the service-role key and bypasses RLS, so no other caller's visibility changes.
* **⚠️ Required manual step per hosted environment**: applying the migration does **not** enable the hook. Enable it in the Supabase dashboard (**Authentication → Hooks** → Custom Access Token → `public.custom_access_token_hook`), or via the Management API `PATCH /v1/projects/{ref}/config/auth` with `hook_custom_access_token_enabled: true` and `hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook"`. Local is already wired through `[auth.hook.custom_access_token]` in `supabase/config.toml`. **Order does not matter**: until the hook is enabled the claim is simply absent and the `x-chapter-id` fallback carries context, so the migration is safe to promote ahead of the toggle.
* **Status**: enabled on **`frapp-staging`** as of 2026-08-10 (Postgres function, schema `public`, function `custom_access_token_hook`) and verified with a live password-grant sign-in — the decoded access token carried a top-level `active_chapter_id`. **Not enabled on `frapp-prod`** — this is a still-open manual dashboard step, tracked in #805; it is not because the project is inactive (`frapp-prod` is `ACTIVE_HEALTHY`, per the `SUPABASE_DB_PASSWORD` entry's 2026-08-29 correction under "## 2026-08-10: Staging migration backlog cleared" above). Note the claim only appears for a user who resolves to a chapter, so on an environment with no `chapters`/`members` rows a correctly-working hook still issues a token with no claim — verifying there requires data that reaches one of the hook's resolution branches.
* **Checks**: After `db push`, `select proname from pg_proc where proname = 'custom_access_token_hook';` returns 1 row; `select has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute');` returns `true` and the same for `anon`/`authenticated` returns `false`. After enabling the hook, sign in as a single-chapter user and decode the access token — `active_chapter_id` must be present. If sign-in breaks, disable the hook in the dashboard first (instant mitigation, no deploy needed), then investigate.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback active-chapter JWT claim.

## 2026-06-04: Terms/Privacy acceptance on `chapters` (FRA-17) + migration-version collision fix (FRA-288)

One additive migration, plus a remediation rename of an already-merged migration.

### 20260604130000_chapter_legal_acceptance.sql
* **Purpose**: Adds `chapters.legal_accepted_at timestamptz`, `legal_policy_version text`, and `legal_accepted_by uuid references users(id) on delete set null` (all nullable). `ChapterOnboardingService` stamps them from the authenticated session actor + server clock at chapter creation, recording the admin's Terms of Service / Privacy Policy acceptance (`spec/behavior/legal.md`, `spec/product/onboarding.md`).
* **Safety**: `ADD COLUMN IF NOT EXISTS` (nullable, no default) — backward-compatible and not lock-heavy. No backfill: chapters created before this shipped keep `NULL` (no explicit consent was captured for them; we don't fabricate one). The FK uses `on delete set null` (matching `audit_log.actor_user_id`), so deleting the accepting user never blocks.
* **Checks**: After `db push`, `select column_name from information_schema.columns where table_name='chapters' and column_name like 'legal_%';` returns 3 rows (`legal_accepted_at`, `legal_accepted_by`, `legal_policy_version`).

### Remediation: `chapter_last_stripe_webhook_at` migration version `20260604120000` → `20260604121000` (FRA-288)
* **Why**: PRs #634 (`20260604120000_add_transfer_presidency_rpc.sql`) and #635 (`20260604121000_chapter_last_stripe_webhook_at.sql`) merged with the **same** version `20260604120000`. Supabase keys `schema_migrations` by version, so applying the second violates `schema_migrations_pkey` — breaking `supabase start` / `db reset` on any fresh DB. #635's file is renamed to a unique later version; #634 keeps `120000`.
* **On-call note**: On a DB that **already applied** the old `20260604121000_chapter_last_stripe_webhook_at.sql`, `supabase db push` sees `20260604121000` as pending and re-runs it. The body is `ADD COLUMN IF NOT EXISTS last_stripe_webhook_at` — a safe no-op — but `supabase migration list` may show the superseded `120000` stripe entry; run `supabase migration repair` only if the CLI reports drift. `frapp-staging` / `frapp-prod` were paused during the collision window (migrations not applied), so they take the corrected sequence cleanly on the next push.
* **Guardrail**: `scripts/check-migration-safety.mjs` now fails on duplicate 14-digit version prefixes (not just duplicate filenames), so this collision class is caught in CI going forward.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Terms/Privacy acceptance columns.

## 2026-06-04: Add `transfer_presidency` RPC (FRA-39)
* **Migration**: `20260604120000_add_transfer_presidency_rpc.sql`
* **Purpose**: Atomic presidency transfer — removes the wildcard (`*`) President role from the current President and adds it to the target member inside one transaction, replacing the two independent `members` updates in `RbacService.transferPresidency` that could leave a chapter with zero or two Presidents on a partial failure (`spec/behavior/rbac.md` → Presidency Transfer). EXECUTE is locked to `service_role`; the API calls it via `SupabaseMemberRepository.transferPresidencyAtomic`.
* **Safety**: Additive — creates one function, no schema or data changes. `create or replace function` is idempotent; the revoke/grant block guards each Supabase role on existence so it also applies on bare Postgres / PGlite.
* **Checks**: After `db push`, `select proname from pg_proc where proname = 'transfer_presidency';` returns 1 row; `select has_function_privilege('service_role', 'transfer_presidency(uuid, uuid, uuid, text)', 'execute');` returns `true`.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback `transfer_presidency` RPC.

## 2026-06-02: past_due grace clock on `chapters` (FRA-109)

One additive migration that adds a nullable column and backfills existing `past_due` rows.

### 20260602120000_chapter_past_due_since.sql
* **Purpose**: Adds `chapters.past_due_since timestamptz` (nullable) so `ChapterGuard` can enforce the spec's 3-day `past_due` grace window (`spec/behavior/billing.md`). The Stripe webhook (`BillingService`) stamps it on the into-`past_due` transition and clears it on recovery/exit.
* **Safety**: `ADD COLUMN IF NOT EXISTS` (nullable, no default) is non-lock-heavy and backward-compatible — older API code simply ignores the column. The backfill (`update chapters set past_due_since = now() where subscription_status = 'past_due' and past_due_since is null`) only touches rows already in `past_due` and starts their grace clock at promotion time, so an existing lapsed chapter is not instantly hard-locked. Idempotent.
* **Checks**: `select column_name from information_schema.columns where table_name = 'chapters' and column_name = 'past_due_since';` — should return 1 row. `select count(*) from chapters where subscription_status = 'past_due' and past_due_since is null;` — should return 0 after apply.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback past_due grace clock.

## 2026-05-30: Chunk 07d — Dues config schema alignment (#540)

One migration that modifies an existing (but empty) table to match the spec.

### 20260530193000_chapter_dues_config_align_spec.sql
* **Purpose**: Aligns `chapter_dues_config.cadence` to the canonical spec (`spec/behavior/settings/customization.md` → Dues Tab): drops the old `cadence in ('semester','monthly','annual')` CHECK, sets the default to `per_semester`, and adds a new CHECK `cadence in ('monthly','per_semester','per_quarter')`. Also adds `installment_count int not null default 1 check (installment_count >= 1)` for the spec's installment "count".
* **Safety**: `chapter_dues_config` has had **no write path** since it was created (`20260523120000`) — no API wrote it (this chunk adds the first), onboarding never provisioned a row, and `seed.sql` doesn't touch it. So the table is empty in every environment and the new CHECK cannot be violated by an existing row; no data backfill/remap is required. The new column is `NOT NULL DEFAULT 1`, filled for any (hypothetical) existing row on add.
* **Checks**: After `db push`, `select pg_get_constraintdef(oid) from pg_constraint where conname = 'chapter_dues_config_cadence_check';` — should list `monthly`/`per_semester`/`per_quarter`. `select column_name from information_schema.columns where table_name = 'chapter_dues_config' and column_name = 'installment_count';` — should return 1 row.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 07d dues config alignment.

## 2026-05-30: Analytics opt-out flag on `chapters` (#464)

One additive migration. Adds a single boolean column with a default — fully backward-compatible, no backfill, no lock-heavy operation (Postgres fills existing rows with the default on add).

### 20260530180000_chapter_analytics_opt_out.sql
* **Purpose**: Adds `chapters.analytics_opt_out boolean not null default false`. Read server-side by `AnalyticsService` as defense-in-depth before any server-originated analytics event is sent (pseudonymous pipeline, `spec/behavior/data-retention.md` #analytics-events-pseudonymous). The Settings toggle that writes it is tracked as #466.
* **Checks**: After `db push`, `select column_name from information_schema.columns where table_name = 'chapters' and column_name = 'analytics_opt_out';` — should return 1 row; `select analytics_opt_out from public.chapters limit 1;` — defaults to `false`.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback analytics opt-out flag.

## 2025-02-26: Add `get_points_report` RPC
* **Migration**: `20250226120000_add_get_points_report_rpc.sql`
* **Purpose**: Creates an RPC for faster points report aggregation.
* **Checks**: Verify the RPC exists using `select has_function_privilege('get_points_report(uuid, uuid, text)', 'execute');`.
* **Superseded by**: `20260604140000_get_points_report_window_filter.sql` (2026-06-04) — replaces the `text` overload with `p_since timestamptz`.

## 2026-06-04: Points report window filter (`get_points_report` → `p_since`)
* **Migration**: `20260604140000_get_points_report_window_filter.sql`
* **Purpose**: FRA-31 — drops the old `get_points_report(uuid, uuid, text)` overload and recreates it with `p_since timestamptz`, so semester/month points reports filter `point_transactions.created_at` (the API resolves the window's lower bound, matching the points leaderboard) instead of silently returning all-time totals.
* **Checks**: After `db push`, confirm the new signature exists and the old one is gone: `select has_function_privilege('get_points_report(uuid, uuid, timestamptz)', 'execute');` returns `t`, and `select to_regprocedure('get_points_report(uuid, uuid, text)') is null;` returns `t`. Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback `get_points_report` RPC.

## 2026-04-17: Poll list vote aggregation RPCs
* **Migration**: `20260417180000_add_poll_list_vote_aggregate_rpcs.sql`
* **Purpose**: `get_poll_vote_option_totals` and `get_poll_user_votes_for_messages` aggregate `poll_votes` in Postgres for `GET /v1/polls` (chapter poll list) instead of loading every vote row into the API.
* **Checks**: After `db push`, e.g. `select proname from pg_proc where proname in ('get_poll_vote_option_totals', 'get_poll_user_votes_for_messages');` Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback poll list vote aggregate RPCs.

## 2026-04-17: Point transactions chapter audit index
* **Migration**: `20260417120000_point_transactions_chapter_created_at_idx.sql`
* **Purpose**: B-tree on `(chapter_id, created_at desc)` so chapter-scoped point transaction lists (admin Audit tab, `GET /v1/points/transactions`) stay fast as tables grow.
* **Checks**: After `db push`, confirm the index exists, e.g. `select indexname from pg_indexes where tablename = 'point_transactions' and indexname = 'idx_point_transactions_chapter_created_at';`

## 2026-04-17: Backfill `polls:view_all` on system roles (Treasurer, VP, Secretary)
* **Migration**: `20260417140000_backfill_polls_view_all_system_roles.sql`
* **Purpose**: Data-only backfill so existing chapters match new seeds: Treasurer gains `polls:view_all` where missing; Vice President and Secretary system rows are inserted with `polls:view_all` and `display_order` is shifted for chapters that lacked VP.
* **Checks**: After `db push`, spot-check system roles — e.g. `select count(*) from public.roles where is_system and name = 'Treasurer' and 'polls:view_all' = any (permissions);` should equal the number of Treasurer rows; confirm VP/Secretary rows exist per chapter (`select chapter_id, name from public.roles where is_system and name in ('Vice President', 'Secretary') order by chapter_id, name limit 20;`). Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback `backfill_polls_view_all_system_roles`.

## 2026-04-17: Add `members:view` to VP / Secretary system roles
* **Migration**: `20260417150000_backfill_members_view_vp_secretary.sql`
* **Purpose**: Append `members:view` to Vice President and Secretary so they can use chapter-scoped routes that merge controller- and handler-level `@RequirePermissions` (e.g. dashboard poll list requires both `members:view` and `polls:view_all`).
* **Checks**: After `db push`, e.g. `select count(*) from public.roles where is_system and name in ('Vice President', 'Secretary') and 'members:view' = any (permissions);` should equal twice the number of chapters with those rows (or verify zero rows missing the permission). Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback `backfill_members_view_vp_secretary`.

## 2026-05-27: Chunk 05 — Chat integrations + push: chat_notification_preferences

One additive migration. Creates a new table with one RLS policy (select-own) and an `updated_at` trigger.

### 20260527120000_chat_notification_preferences.sql
* **Purpose**: Creates `chat_notification_preferences` (ADR-06) — the per-channel + per-kind notification level (`all` / `mentions` / `off`) the Chunk 05 push worker reads. Distinct from the existing `notification_preferences` table (boolean, category-keyed). Two scope arms (`scope ∈ {channel, kind}`) with a check constraint ensuring exactly one of `scope_id` / `scope_kind` is set, a unique index on `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))`, and a `(user_id, chapter_id)` index for the worker's hot path. RLS enabled with one policy: members may read their own rows; writes flow through the API (service role).
* **Checks**:
  - Table: `select tablename from pg_tables where tablename = 'chat_notification_preferences';` — should return 1 row.
  - Indexes: `select indexname from pg_indexes where tablename = 'chat_notification_preferences';` — should include `idx_chat_notif_prefs_unique` and `idx_chat_notif_prefs_user_chapter`.
  - RLS: `select relrowsecurity from pg_class where relname = 'chat_notification_preferences';` — should return `true`.
  - Policy: `select policyname from pg_policies where tablename = 'chat_notification_preferences';` — should return `chat_notification_preferences_select_own`.
  - Trigger: `select tgname from pg_trigger where tgrelid = 'chat_notification_preferences'::regclass and tgname = 'trg_chat_notification_preferences_updated_at';` — should return 1 row.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 05 migration.

## 2026-05-24: Chunk 03 — Onboarding wizard: system user seed + chapter_directory_requests

One additive migration. Creates a new table and seeds one well-known row. No existing columns modified, no lock-heavy operations.

### 20260524120000_chapter_directory_requests.sql
* **Purpose**: (1) Idempotent `INSERT … ON CONFLICT DO NOTHING` seeds the all-zeros system user (`00000000-0000-0000-0000-000000000000`) required as `sender_id` for system-authored `chat_messages` rows (audit-bridge entries, and the onboarding welcome message — which lands in `#general`, not `#chapter-audit`). Without this seed every writer that posts as the system user silently no-ops due to the `NOT NULL FK` on `chat_messages.sender_id` — the Chunk 02 audit bridge, the onboarding welcome message, poll-expiry notices and the invite-acceptance DM, all four of which swallow the insert error to a `logger.warn`. (2) Creates `chapter_directory_requests` table — captures manual-entry chapter submissions from the onboarding wizard so the curated directory seed can be backfilled later (#232). RLS enabled; no client policies (API/service-role only).
* **Checks**:
  - System user: `select id from public.users where id = '00000000-0000-0000-0000-000000000000';` — should return 1 row.
  - Table: `select tablename from pg_tables where tablename = 'chapter_directory_requests';` — should return 1 row.
  - Indexes: `select indexname from pg_indexes where tablename = 'chapter_directory_requests';` — should return `idx_chapter_directory_requests_status` and `idx_chapter_directory_requests_chapter`.
  - RLS: `select relrowsecurity from pg_class where relname = 'chapter_directory_requests';` — should return `true`.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 03 migration.

## 2026-05-23: Chunk 02 — Chapter customization + audit log + directory + chat hot-path

Four additive migrations in this PR. All use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE` — fully backward-compatible, no lock-heavy operations, no data backfills.

### 20260523120000_chapter_customization.sql
* **Purpose**: Adds 7 new columns to `chapters` (org_archetype, enabled_modules, vocabulary, branding, theme_palette, directory_id, beta_config) and creates `chapter_custom_fields`, `chapter_custom_roles`, `chapter_workflows`, `chapter_dues_config`. All new tables have RLS enabled (no policies — access controlled at API layer per repo convention).
* **Checks**: `select column_name from information_schema.columns where table_name = 'chapters' and column_name in ('org_archetype','enabled_modules','vocabulary','branding','theme_palette','directory_id','beta_config');` — should return 7 rows.

### 20260523130000_audit_log.sql
* **Purpose**: Creates `chapter_audit_log` append-only table. Two explicit RLS policies deny UPDATE and DELETE to enforce append-only at the DB level.
* **Checks**: `select tablename from pg_tables where tablename = 'chapter_audit_log';` + `select policyname from pg_policies where tablename = 'chapter_audit_log';` — should return 2 policies (audit_log_no_update, audit_log_no_delete).

### 20260523140000_chapter_directory.sql
* **Purpose**: Creates `chapter_directory` global reference table with generated `search_vector` tsvector column. Adds FK constraint from `chapters.directory_id` → `chapter_directory.id`.
* **Checks**: `select column_name from information_schema.columns where table_name = 'chapter_directory' and column_name = 'search_vector';` — should return 1 row. `select indexname from pg_indexes where tablename = 'chapter_directory' and indexname = 'idx_chapter_directory_search';` — should return 1 row.

### 20260523150000_chat_hotpath.sql
* **Purpose**: Adds `kind`, `payload`, `client_message_id`, `deleted_at` to `chat_messages`. Creates partial unique index for client_message_id dedup. Creates `chat_message_actions` table with two indexes.
* **Checks**: `select column_name from information_schema.columns where table_name = 'chat_messages' and column_name in ('kind','payload','client_message_id','deleted_at');` — should return 4 rows. `select indexname from pg_indexes where tablename = 'chat_messages' and indexname = 'idx_chat_messages_dedupe';` — should return 1 row.

**Rollback**: All migrations are additive (new columns/tables). Rollback is: drop new tables (chapter_directory, chapter_audit_log, chapter_custom_fields, chapter_custom_roles, chapter_workflows, chapter_dues_config, chat_message_actions), drop new columns from chapters and chat_messages. See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 02 migrations.
