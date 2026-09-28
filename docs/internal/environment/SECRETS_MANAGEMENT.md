# Secrets Management with Infisical

## Overview

All secrets for the Frapp project are centrally managed in [Infisical](https://infisical.com) (free tier) with automatic syncs to deployment providers. This eliminates managing secrets across multiple dashboards.

> **For the complete variable list per app per environment, see [`ENV_REFERENCE.md`](./ENV_REFERENCE.md).**
> This document covers the Infisical setup, sync configuration, and operational procedures.
>
> **Keeping secrets out of git:** a `gitleaks` pre-commit + CI gate scans for accidentally committed secrets — see [`../ci-cd/SECRET_SCANNING.md`](../ci-cd/SECRET_SCANNING.md).

## Key Design Principles

1. **Canonical values stored once.** Each secret (e.g., `SUPABASE_URL`) is stored once per Infisical environment. The value changes per environment (`dev`/`staging`/`prod`), but the name stays the same.

2. **References eliminate duplication.** Framework-specific names (`NEXT_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`) are Infisical **secret references** that resolve to the canonical value. Change `SUPABASE_URL` → all references update.

3. **No environment suffixes.** There's no `API_HEALTHCHECK_URL_STAGING` — just `API_HEALTHCHECK_URL` with different values per environment. Infisical's environment scoping does the routing: each `infisical-secrets` call picks its environment with a literal `env-slug` ([§ GitHub Actions is not a sync](#github-actions-is-not-a-sync)). A job's GitHub `environment:` plays no part in it.

4. **No `.env.local` files (primary path).** Default local run is **`npm run dev:stack`** from the repo root (API + web + landing + docs; secrets from Infisical `dev` via the CLI). Requires `npx infisical login` on the machine. Per-app `dev:*` and fallbacks: [`LOCAL_DEV.md`](./LOCAL_DEV.md).

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                          INFISICAL                                │
│                                                                   │
│  Canonical values (stored once, value changes per environment):   │
│    SUPABASE_URL, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY, ...       │
│                                                                   │
│  References (resolve to canonical):                               │
│    NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}                     │
│    EXPO_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}                     │
│    NEXT_PUBLIC_API_URL = ${API_URL}                               │
│    ...                                                            │
│                                                                   │
│  3 environments: dev, staging, prod                               │
│  Syncs: Render ×2 (the Vercel ones are deleted) — §5              │
│  Web/landing (both envs): built from an Infisical injection — §5  │
└──────────────────────────────────────────────────────────────────┘
```

## Free Tier Limits

| Resource     | Limit | Our Usage                      |
| ------------ | ----- | ------------------------------ |
| Identities   | 5     | 1 (admin)                      |
| Projects     | 3     | 1 (Frapp)                      |
| Environments | 3     | 3 — [`ENV_REFERENCE.md`](./ENV_REFERENCE.md#infisical-environments) |
| Integrations | 10    | 4 secret syncs — see §5        |

The integration count is derived from the sync inventory in §5, not tracked independently — this row
and `ENV_REFERENCE.md` previously disagreed (7 vs 6) because both counted by hand. Infisical's own
billing/usage view is authoritative if you need the number for a plan decision.

## Initial Setup

### 1. Create Infisical Account

1. Go to https://app.infisical.com/signup
2. Create account with your GitHub email
3. Create a new project named "Frapp"

### 2. Create Environments

Create one environment per row of
[`ENV_REFERENCE.md` § Infisical Environments](./ENV_REFERENCE.md#infisical-environments), giving each
the **slug** that table lists, not just its UI name: the slug is what every tool takes —
`infisical run --env=`, the workflows' `env-slug:`, and `.infisical.json` — and the two differ. Verify against
**Project Settings → Environments**, which lists Name and Slug side by side.

### 3. Add Canonical Values

For each environment, add the canonical values from
[`ENV_REFERENCE.md` § "Canonical Variables — The Complete Grid"](./ENV_REFERENCE.md#canonical-variables--the-complete-grid),
together with its § "API-Only Settings" and § "CD Secrets (Deploy Workflows Only)" subsections. That grid
has a column per slug and is the only complete list — work it whole rather than a subset. The partial table
this section used to carry omitted `STRIPE_PUBLISHABLE_KEY`, which §4 below then references as a `${…}`
value. Start with `staging`, then repeat for `prod` and `dev`.

### 4. Add References

In **every environment**, add the reference rows from
[`ENV_REFERENCE.md` § "References — Framework-Specific Names"](./ENV_REFERENCE.md#references--framework-specific-names)
— the value string you type is identical in every environment; only the canonical value it resolves to
changes. That table also flags the one `NEXT_PUBLIC_*` name that is a **literal**, not a `${…}` reference
(`NEXT_PUBLIC_SENTRY_DSN`), and this list never carried it.

`EXPO_PUBLIC_LANDING_URL` and `EXPO_PUBLIC_ASK_ENABLED` are **not** Infisical references — they are
direct-set client flags/URLs (see [`ENV_REFERENCE.md`](./ENV_REFERENCE.md) § apps/mobile). There is
**no Infisical → EAS sync**; any `EXPO_PUBLIC_*` a device build needs must also be set in the EAS
dashboard (`development` / `preview` / `production`) or a non-secret `eas.json` `build.<profile>.env`
entry. **This is not limited to `EXPO_PUBLIC_*`:** `SENTRY_AUTH_TOKEN` is build-time only and never
bundled, yet a Release build *fails* without it in EAS — see
[`ENV_REFERENCE.md`](./ENV_REFERENCE.md#appsmobile-expo--eas) § apps/mobile. An Infisical entry for
that name serves `apps/api` (Render sync) and `apps/web` (injected into the staging and production builds); it never reaches EAS. The live syncs are Render only (next section).

### 5. Configure Secret Syncs

#### How a sync decides what it pushes

A sync's payload is defined by exactly two things: the source **environment** and the source
**secret path**. Infisical's sync editor exposes no per-key include/exclude filter — the Source
step offers Environment and Secret Path and nothing else, and its own help text states that "the
environment + path together define the set of secrets this sync will push out."

The **Customize key names** option under Sync Options is not a filter despite sounding like one.
It applies a prefix/suffix so Infisical can recognise which keys at the *destination* it manages,
leaving unmatched destination keys untouched. It does not narrow what gets sent.

Every sync below is configured at path `/`, so **each one pushes every secret in its source
environment to its destination.** Narrowing a sync means splitting the secret store into paths and
repointing the sync — there is no filter to switch on. See the "Blast radius" note below.

#### Live syncs (2 total)

**Dashboard state last verified: 2026-09-28**, for the two Render rows; the Vercel deletions below
are the owner's report. This table is a convenience copy of live
dashboard configuration and goes stale silently. Treat a disagreement between this table and the
Infisical/Vercel dashboards as the table being wrong, and re-stamp the date when you correct it.
See "Verifying this section against reality" below.

| Name                        | Infisical env | Path | Destination         | Vercel/Render env |
| --------------------------- | ------------- | ---- | ------------------- | ----------------- |
| `render-api-production`     | Production    | `/`  | `frapp-api-prod`    | Service           |
| `render-api-staging`        | Staging       | `/`  | `frapp-api-staging` | Service           |

All four syncs then live read **Synced** in the Infisical UI on 2026-09-28, before the two
production Vercel syncs were deleted.

**The two production Vercel syncs are deleted (2026-09-28, [#834](https://github.com/pdcarlson/Frapp/issues/834)).**
`vercel-web-production` and `vercel-landing-production` copied the whole `prod` store into each
project's Production scope, and since [#2673](https://github.com/pdcarlson/Frapp/issues/2673) no build
read it ([§ Staging web and landing](#staging-web-and-landing-injected-at-build-not-synced)). The owner
deleted both with **Remove Synced Secrets** on, so Infisical removes the rows each wrote before it
deletes the sync. That record is the owner's report; the dashboards were not re-read from an agent
session, whose tokens can list neither Infisical's syncs nor Vercel's env rows. The next production
build reads the result: its log names every row it removed from the pulled env
([#2810](https://github.com/pdcarlson/Frapp/issues/2810)). Vercel's own `NX_DAEMON` and `TURBO_*`
build-tool rows are expected there. Any other name, above all one Infisical `prod` holds, is a
Production row the removal left behind.

**The two staging Vercel syncs are deleted (2026-09-28, [#834](https://github.com/pdcarlson/Frapp/issues/834)).**
`vercel-web-staging` and `vercel-landing-staging` wrote Preview rows scoped to git branch `main`.
They failed from the day ADR-21 unlinked the projects from Git
(`Project "…" does not have a connected Git repository`), which is what held
[#2106](https://github.com/pdcarlson/Frapp/issues/2106)'s `infisical-syncs` assertion red, and
nothing read what they wrote: staging's web and landing builds take their app config from Infisical
`staging` at build time ([§ Staging web and landing](#staging-web-and-landing-injected-at-build-not-synced)).
The owner deleted both syncs with **Remove Synced Secrets** off, then deleted every
**Preview · `main`** row in `frapp-web` and `frapp-landing` by hand; both projects' env lists,
filtered to `main`, read empty afterwards, and Production rows were left alone. With that option on,
Infisical's `deleteSecretSync` (open-source backend, read 2026-09-28) queues a job that removes the
synced secrets first and deletes the sync only when it completes; that the job would fail here on the
same Git error is inferred, not observed. `frapp-landing`'s sync branch was never read in the
dashboard (only `frapp-web`'s, `main`, on 2026-08-12), so its unfiltered Preview list was read
afterwards too: it held one row, an unscoped `NEXT_PUBLIC_APP_URL` added 2026-02-28. The owner then
deleted the unscoped Preview rows in both projects as well (`frapp-web`'s three `NEXT_PUBLIC_*`,
`frapp-landing`'s one), which no build read, and turned **Branch Tracking** off on both projects'
Preview environment. Neither project holds a Preview env variable now.

**Never re-create a Vercel Preview sync with a git branch filter.** The *Vercel env* column is
Vercel's environment name (`Production` or `Preview`); a Preview sync additionally names a
repository branch, and Infisical resolves that branch through the project's Git connection, which
these projects deliberately don't have. Before the Git unlink the same field caused a different
failure: both staging syncs targeted a branch literally named `preview`, which has never existed in
this repository, and wrote rows no deployment read.

To inspect or edit one: Infisical → Integrations → **Secret Syncs**. To create one from scratch on a
fresh org, first authenticate the provider under **App Connections** (Vercel, Render), then
**Add Sync** and pick the source environment, path, and destination scope shown above.

#### GitHub Actions is not a sync

There is no GitHub Actions sync — the Secret Syncs list holds exactly the two above. The workflows
that need secrets **pull** at job time instead, via `Infisical/secrets-action@v1.0.12` (pinned to that tag's commit SHA, #2647) with
`method: "universal"`, authenticating with the `INFISICAL_MACHINE_IDENTITY_ID` and
`INFISICAL_CLIENT_SECRET` secrets, read through the GitHub environment each job names (§6). This is universal
auth, not OIDC. Every workflow that calls the composite action below does this — today
`deploy-api.yml`, `deploy-production.yml`, `deploy-vercel-staging.yml`, `db-backup.yml`,
`check-migration-drift.yml`, `migration-snapshot.yml`, `staging-conformance.yml` and
`production-auth-conformance.yml` (re-derive with
`git grep -l 'actions/infisical-secrets' .github/workflows`) — not `deploy-api.yml` alone. No pull-request job is among them: `migration-drift-gate.yml` reads the snapshot
`migration-snapshot.yml` publishes instead (#2518).

That call is written once, in the [`infisical-secrets`](../../../.github/actions/infisical-secrets/action.yml)
composite action, which every workflow needing secrets calls; no workflow spells out
`Infisical/secrets-action` itself. The credentials reach it as `with:` inputs because a composite
action cannot read the `secrets` context.

Each call site selects its source with `env-slug`. Note the production slug is **`prod`**, not
`production` — the Infisical environment slug and the GitHub environment name differ. **Pass that
slug as a quoted literal, never an expression:** `scripts/check-env-slugs.mjs` validates slugs by
matching `env-slug: "<slug>"` in `.github/workflows` and `.github/actions`, so an expression is
invisible to it and the gate would go green having checked nothing.

Because the action exports every secret in the resolved environment as a job env var, **adding a
secret to the right Infisical environment is sufficient to make it available to CI** — no workflow
change is needed. The one exception is the web and landing build, staging and production alike, which
hands each app only the keys it is listed as reading (next section).

#### Staging web and landing: injected at build, not synced

**Decision (owner, 2026-09-24, [#834](https://github.com/pdcarlson/Frapp/issues/834#issuecomment-5821405063)):**
`deploy-vercel-staging.yml` injects Infisical `staging` itself and builds each app against exactly the
keys that app reads. No staging build reads a Vercel sync; the two staging syncs were deleted on
2026-09-28 (above). Why, and what was turned down:

- **The syncs cannot address a Git-less project.** Infisical scopes a Vercel Preview write by git
  branch and resolves the branch through the project's connected repository. ADR-21 removed that link
  on purpose (landing 2026-09-01, web 2026-09-02), and every sync since has failed with
  `Project "…" does not have a connected Git repository`.
- **They had already stopped feeding the build.** `vercel pull --environment=preview` without
  `--git-branch` asks for Preview rows with no branch (Vercel CLI 59.11.7 source), and run
  [36053129347](https://github.com/pdcarlson/Frapp/actions/runs/36053129347)'s log shows it returned
  only a few unscoped `NEXT_PUBLIC_*` rows, none of the syncs' `Preview · main` rows.
- **They carried the whole backend store** into two projects that read a handful of public values
  ([§ Blast radius](#blast-radius)).
- **Rejected:** an unfiltered Preview target for the syncs (it would silence #2106 but keep fanning
  every backend secret into the frontends), and reconnecting Git (it restores push-triggered deploys
  that bypass the CI gate; ADR-21).

**How it works.** The job records its env var names, then calls the `infisical-secrets` action for
`staging` after `npm ci` and the Vercel CLI install, so no install script sees the store.
`scripts/ci/deploy-vercel.mjs` then runs every Vercel CLI step on the recorded names alone, gives
`vercel build` the app's own keys, and keeps only Vercel's system variables (`VERCEL`, `VERCEL_*`,
`NEXT_PUBLIC_VERCEL_*`) from the Preview env `vercel pull` writes, so no project row outside that
namespace reaches the build ([#2810](https://github.com/pdcarlson/Frapp/issues/2810)). The per-app key list is `APP_CONFIG_KEYS` in
[`scripts/ci/lib/vercel-build-env.mjs`](../../../scripts/ci/lib/vercel-build-env.mjs), and
`vercel-build-env.test.mjs` fails when it drifts from the `process.env` reads in `apps/web`,
`apps/landing` and every workspace package their bundles can contain. A required key missing from
Infisical fails the deploy before anything is built, naming the key, and so does a `[SENSITIVE]`
placeholder value in the injection or the recorded baseline. A placeholder in a kept pulled row or in
the build's own environment, or a pull that leaves no env file where the filter looks, fails that
project's build before it runs, which on staging's single-phase path can come after the other project
has shipped. Mechanism and evidence: that file's header.

**Runtime needs nothing from Infisical.** Next inlines `NEXT_PUBLIC_*` into client, server and proxy
code at build, and the only non-public key either app receives, `SENTRY_AUTH_TOKEN`, is read by
`next.config.js` alone. So deleting the syncs' Vercel Preview rows (2026-09-28) removed nothing a
deployment reads at request time.

**Production takes the same path (owner, 2026-09-28, [#2673](https://github.com/pdcarlson/Frapp/issues/2673)).**
`deploy-production.yml` records its env names immediately before its Infisical `prod` injection, and
both Vercel steps (build and upload) run on those names plus each app's `APP_CONFIG_KEYS`. Before
this, every production Vercel CLI process ran on the whole `prod` store, and a Production row filled
any app key the injection lacked. A dry run withholds `SENTRY_AUTH_TOKEN` from the build, and the
pulled file keeps no app key, so it mints no Sentry release
([#2275](https://github.com/pdcarlson/Frapp/issues/2275)). A key Vercel's Production env holds that
Infisical `prod` doesn't supply prints a `::warning::` naming it, which is how a value that only
ever lived in Vercel shows up. With that, **no build reads a Vercel env row**, so the two production
Vercel syncs only copied the whole `prod` store into two frontend projects, and the owner deleted
them on 2026-09-28 (§5, #834). Nothing
here depends on Vercel's Git link or branch tracking, both of which are off.

#### Blast radius

Every sync reads path `/`, so while the Vercel syncs lived, each pushed backend-only secrets toward
frontend projects that never consumed them; the two Render syncs that remain feed the API, which
does. What each frontend app actually reads is `APP_CONFIG_KEYS` in
[`scripts/ci/lib/vercel-build-env.mjs`](../../../scripts/ci/lib/vercel-build-env.mjs), a list a test
keeps equal to the source (this section used to carry its own copy, which had fallen five keys per app
behind). Everything else in the environment — database passwords, service-role keys, Stripe secrets,
deploy hook URLs — was pushed toward those projects without being used by them, until the syncs were
deleted (staging and production both on 2026-09-28).

**The Vercel syncs delivered, until they were deleted.** On 2026-08-12 the `frapp-web`
environment-variable list was read directly, and both its `Preview` and `Production` scopes held the
full backend store: `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RENDER_DEPLOY_HOOK_URL`.

`frapp-landing` was **not** inspected variable-by-variable that day, so treat its contents as
expected-but-unconfirmed. The expectation is well founded — its Production scope was fed by a sync
with the same `/` path from the same environment — but it is an inference, not a reading. Confirm it before
relying on it, and see the verification steps below.

Staging was not spared while its syncs worked: they wrote to `Preview` scope filtered to branch
`main`, and under the Git integration `main` is what staging deployed from, so the `frapp-web` staging
deployment received every backend credential as a server-side env var. None of them reach browsers,
because Next.js only inlines `NEXT_PUBLIC_*` into the client bundle, but any SSRF or RCE in the staging
web app would read through to the staging database and the Supabase account. Whether a CLI-created
deployment still received those `main`-scoped rows at runtime was never established. The rows were
deleted on 2026-09-28 (#834), which settles it either way, and nothing an app reads depended on them
([§ Staging web and landing](#staging-web-and-landing-injected-at-build-not-synced)).

`SUPABASE_ACCESS_TOKEN` deserves separate mention: it is a Supabase **Management API** token. The
one these syncs delivered was scoped to the whole account, and therefore strictly more powerful than
`SUPABASE_SERVICE_ROLE_KEY`. **Corrected 2026-09-24 ([#2583](https://github.com/pdcarlson/Frapp/issues/2583)):**
that token is revoked, and each Infisical environment now holds its own read-only token scoped to
its own project (`ENV_REFERENCE.md` § CD Secrets). The staging Vercel copies, which held the revoked
value because those syncs failed from the Git unlink onward, were deleted on 2026-09-28 (#834). Still the
first thing to rotate if any of this is ever believed compromised.

An earlier misreading is worth recording so it is not repeated. Because the staging syncs once failed
with `Branch "preview" not found in the connected Git repository`, this document previously claimed
the breakage was "accidentally protective" and that staging received nothing. That was wrong. The
failure predated the repoint to `main`; afterwards the full store landed. A sync that reports Failed
today tells you nothing about what it delivered before it broke — **check the destination, not the
sync status.**

A third generation of rows also existed: a Mar-7 batch scoped to the dead `preview` branch, left
behind by the original misconfiguration. Those were inert (no deployment reads a nonexistent branch)
but, unlike the current rows, were **not** marked Sensitive, so their values were readable in the
Vercel dashboard. They were deleted from both `frapp-web` and `frapp-landing` on 2026-08-12.

The **production** syncs delivered the whole `prod` store into both frontend projects until the
owner deleted them on 2026-09-28. Since #2673 no build read what they wrote, so they were deleted
rather than narrowed, like the staging ones (owner decision 2026-09-28, #834; a secret-path split was
the rejected alternative). They went with **Remove Synced Secrets** on, which deletes the rows a sync
wrote before the sync itself; had the rows gone first, the next sync would have rewritten them.

#### Verifying this section against reality

Prose in this repo has been wrong about this twice. Before relying on any claim above, spend two
minutes confirming it:

1. **Infisical → Integrations → Secret Syncs.** For each sync read the source environment, the
   secret path, and the destination scope. A Vercel Preview sync would also carry a git branch, the
   field behind every incident so far; none exists today, and one should not be re-created (above).
2. **Vercel → project → Settings → Environment Variables.** Read what actually arrived. Group the
   rows by scope and by "Added" date — distinct dates mean distinct write generations, and old
   generations linger long after the config that created them is gone. A row scoped to a branch that
   no longer exists is inert but still readable.
3. Anything not marked **Sensitive** has a dashboard-readable value. Vercel flags these "Needs
   Attention"; the warning is about dashboard visibility, not about a detected leak.

Vercel's per-variable **Rotate Variable** button replaces only Vercel's copy. It does not rotate
anything at Supabase or Stripe, the old credential stays valid, and no build reads Vercel's copy
anyway. Real rotation is provider first, then Infisical — never Vercel.

### 6. Configure GitHub

Add these as **environment** secrets (Settings → Environments → the environment → Environment
secrets), never as repository secrets. Which environment holds which secret, and the `main`-only
branch rule each environment needs first, is the roster in
[`AGENT_INFRA.md` § GitHub environments and bootstrap secrets](../ci-cd/AGENT_INFRA.md#github-environments-and-bootstrap-secrets).

**Infisical bootstrap (permanent), one copy per environment that injects:**

> **Corrected 2026-09-23 (#2518).** This section used to say these were **repository secrets**:
> one machine identity serves every environment, the workflow selects the environment with
> `env-slug` rather than with credentials, so one repository-scoped pair seemed correct and
> environment copies seemed like "two places to get it wrong" (owner-confirmed 2026-08-10). The
> premise that missed: a repository secret is readable by **any branch**. A same-repository pull
> request, or a push to any branch, runs that branch's own workflow definitions, so anyone who
> can push a branch could read `prod` through this identity. The copies are the price of an
> environment's `main`-only branch rule, which is the only thing a branch cannot edit. One
> identity still serves every environment until the per-environment split
> ([ADR-24](../../../spec/architecture/adr/adr-24.md), rule I6).

| Secret                          | Value                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| `INFISICAL_MACHINE_IDENTITY_ID` | The identity's **Universal Auth → Client ID** — see the warning below        |
| `INFISICAL_CLIENT_SECRET`       | From the same Universal Auth panel → **Add Client Secret** (shown once)      |

`INFISICAL_PROJECT_ID` is no longer needed: no workflow reads it (the action pins `project-slug`),
and its repository copy was deleted on 2026-09-23 (#1587).

**Optional — staging conformance smoke user (`staging` environment):**

Consumed only by `.github/workflows/staging-conformance.yml`. When absent, the workflow's
end-to-end sign-in assertion reports **SKIPPED** rather than passing — it never fakes a pass.

Worth knowing before treating that as optional: this is the **only behavioural** assertion the
workflow makes — everything else in the 07:30 roster in
[`AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md#scheduled-conformance-scriptscistaging-conformancemjs)
reads provider state. Migration
parity is not among them: `check-migration-drift.yml` owns it, and the conformance table lists it
only as a pointer. So an unprovisioned smoke user leaves the workflow asserting configuration and
nothing about whether the stack actually works. Provisioning it is what makes a green run mean
much.

| Secret                        | Value                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| `STAGING_SMOKE_USER_EMAIL`    | Email of a dedicated staging-only user, no production access   |
| `STAGING_SMOKE_USER_PASSWORD` | That user's password                                           |

> ⚠️ **The smoke user must belong to exactly one chapter.** `custom_access_token_hook` omits the
> `active_chapter_id` claim entirely for a user who resolves to no chapter, so a zero-membership
> smoke user yields a claimless token from a *correctly working* hook, which is indistinguishable
> from a disabled one. The check resolves that ambiguity toward safety: a claimless token is a
> **FAIL** naming both causes. So a zero-membership user does not quietly under-test — it reds the
> daily run and opens a P1 blaming the auth hook on a healthy environment. Give it one membership
> and no more.

> ⚠️ **`INFISICAL_MACHINE_IDENTITY_ID` wants the Client ID, not the identity ID.** An Infisical machine identity has an **ID** on its Details page and a separate **Client ID** inside its Universal Auth panel. Only the Client ID authenticates. The secret's name points at the wrong one, and pasting the Details-page ID yields `401 Invalid credentials` — indistinguishable at a glance from a revoked credential. This cost 71 days of dead deploys (#696).

**Not GitHub secrets — injected from Infisical at job time:**

The deploy workflows inject these from Infisical at runtime through [`infisical-secrets`](../../../.github/actions/infisical-secrets/action.yml), so they do **not** need to exist as GitHub secrets at all. Keep them in Infisical, scoped per environment there. (Earlier revisions of this document called for GitHub environment-scoped copies of these values. That is still wrong, because Infisical serves them (#772). The only GitHub secrets are the credentials in the roster [`AGENT_INFRA.md` § GitHub environments and bootstrap secrets](../ci-cd/AGENT_INFRA.md#github-environments-and-bootstrap-secrets) lists.)

| Secret                   | Staging value                           | Production value                |
| ------------------------ | --------------------------------------- | ------------------------------- |
| `SUPABASE_ACCESS_TOKEN`  | Read-only token, `frapp-staging` only   | Read-only token, `frapp-prod` only |
| `SUPABASE_PROJECT_REF`   | Staging project ref                     | Production project ref          |
| `RENDER_DEPLOY_HOOK_URL` | _(none: unused since #2505, which deploys staging by commit through the Render API; the stored copy is deleted and the hook regenerated by #2679)_ | _(none — production deploys by commit through the Render API, never a hook)_ |
| `API_HEALTHCHECK_URL`    | `https://api-staging.frapp.live/health` | `https://api.frapp.live/health` |

#### Troubleshooting: `Deploy API` fails with `401 Invalid credentials`

`Infisical/secrets-action` reports the same `401 Invalid credentials` whether the bootstrap secrets are **absent** or **rejected**. To tell those apart, every injection runs a `Verify Infisical credentials are configured` preflight first. That preflight is no longer written in the workflow: it is the first step of the [`infisical-secrets`](../../../.github/actions/infisical-secrets/action.yml) composite action, so it now runs at **every** injection site rather than the nine that happened to carry a copy. The sites are the `EXPECTED` roster in [`infisical-secrets-action.test.mjs`](../../../scripts/ci/__tests__/infisical-secrets-action.test.mjs), which fails when a call site is added or removed without it.

The table below describes the sites that **fail** on a missing credential: every site on the action's default `error` mode. **The two conformance watchdogs are the exception**, `staging-conformance.yml` and `production-auth-conformance.yml`, and read differently: they pass `on-missing-credentials: warn`, because those workflows exist to *report* credential drift rather than die of it. There the preflight step stays green and emits a `::warning::` naming the missing secret, so a missing credential shows up as a **warning above an otherwise-normal 401**, not as a failed step. Read the warning before concluding from row 3 that the credentials were rejected.

| Preflight result                       | Meaning                                                                                          | Fix                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Fails**, naming the secret           | `INFISICAL_MACHINE_IDENTITY_ID` and/or `INFISICAL_CLIENT_SECRET` is unset or empty in this scope | Add it as an environment secret on the environment the job names (`AGENT_INFRA.md` roster), never as a repository secret |
| **Passes with a whitespace warning**, then 401 | A value carries a stray leading or trailing character — usually a newline picked up when pasting | Re-paste both secrets in GitHub *before* rotating anything in Infisical                    |
| **Passes** cleanly, then injection 401s | The credentials exist and are well-formed, but Infisical rejected them | **Check whether they ever worked before rotating** — see below |

**When the preflight passes and injection still 401s, read the Infisical dashboard before touching anything.** Open the machine identity and look at two fields:

| What you see                                                              | What it means                                                     | Fix                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Last Logged In** has a date, client secret shows **uses > 0**           | It genuinely worked once and has since been revoked or expired    | Issue a new client secret and update `INFISICAL_CLIENT_SECRET`                                    |
| **Last Logged In: —** and client secret **Number of Uses: 0**             | This pair has **never** authenticated — nothing was ever rotated  | The stored Client ID is wrong (most likely the identity's Details-page ID). Set both secrets from the Universal Auth panel |

#696 was the second case: the identity had recorded no successful login since it was created, so nothing had been revoked and rotating the secret alone would not have helped. Which value was wrong could not be confirmed after the fact — GitHub secrets are write-only — but the remedy is the same either way: set **both** secrets from the Universal Auth panel in one pass, rather than replacing only the one you suspect. Also confirm the identity is attached to the project (`Projects` section on its Details page) and that its trusted-IP ranges permit GitHub runners.

Note that while `Deploy API` had a `check-changes` path gate, a run was reported green whenever it skipped all four deploy jobs, so a mostly-green history did **not** mean the injection step worked: only runs that touched `apps/api/` or `supabase/migrations/` exercised it. See [issue #696](https://github.com/pdcarlson/Frapp/issues/696), where that distinction hid a 100% injection failure rate for 71 days. Since #2505 both `migrate-staging` and `deploy-staging` inject on every eligible push, and a run where neither ran is escalated as a failure.

### 7. Update `.infisical.json`

Replace `REPLACE_WITH_INFISICAL_PROJECT_ID` in `.infisical.json` with the actual project ID.

### 8. Test Local Development

```bash
npx infisical login
npm run dev:stack   # Default: API + web + landing + docs from repo root
```

Per-app commands and fallbacks: [`LOCAL_DEV.md`](./LOCAL_DEV.md).

## Secret Rotation Policy

| Secret Type               | Rotation Frequency      | Procedure                                                    |
| ------------------------- | ----------------------- | ------------------------------------------------------------ |
| Supabase service role key | On suspected compromise | Regenerate in Supabase → update canonical value in Infisical |
| Stripe secret key         | On suspected compromise | Regenerate in Stripe → update canonical value in Infisical   |
| Supabase access token     | Every 90 days           | Regenerate in Supabase account → update in Infisical         |
| R2 backup-bucket token    | On suspected compromise | Roll the scoped API token in Cloudflare R2 → update `BACKUP_S3_ACCESS_KEY_ID` + `BACKUP_S3_SECRET_ACCESS_KEY` in Infisical (`staging`). `db-backup.yml` pulls at job time, but the path-`/` `render-api-staging` sync (§5) also pushes a copy to the Render staging service. The staging Vercel syncs and their `Preview · main` rows were deleted on 2026-09-28 (#834); neither project's Preview env holds a copy (§5). Count every copy that applies in a blast-radius assessment ([`ENV_REFERENCE.md`](./ENV_REFERENCE.md) § Offsite Backup Secrets) |

**All rotations happen in one place (Infisical).** Syncs propagate changes to Render automatically. The web and landing builds read Infisical directly, staging and production alike (#2673), so they pick up a change only on their next deploy: a merge for staging, a **Deploy production** dispatch for production. A value a bundle inlines (`NEXT_PUBLIC_*`) stays the old one until then.

## Emergency Procedures

### Secret Exposed

1. **Immediately** rotate the secret in the source provider (Supabase/Stripe/etc.)
2. Update the canonical value in Infisical (one place)
3. The Render syncs propagate automatically; web and landing need a redeploy (staging: re-run **Deploy Vercel staging**; production: dispatch **Deploy production**). Verify all services are healthy
4. If committed to git: notify team, consider force-push to remove

### Infisical Down

- Existing secrets in Vercel/Render are unaffected (synced copies persist), and so are the running deployments
- Deploys that inject at job time fail until it recovers: the staging API deploy, the staging web and landing deploy, and `deploy-production.yml`
- New changes must go directly to providers temporarily
- When Infisical recovers, reconcile and re-sync

## Audit

- Infisical dashboard → Audit Log for all secret access
- Verify sync health periodically for every sync in §5 (GitHub Actions is not one of them). Both report Synced; a Failed one is a real incident
- Review no unexpected access patterns

## Provider API token sanity checks (operations)

When running infrastructure automation from a laptop or a script, validate provider API credentials before making write calls. A cloud session can't reach these hosts; it uses the MCP connectors instead (below):

- **Vercel token check**
  - `GET https://api.vercel.com/v2/user` should return an authenticated user.
- **Render token check**
  - `GET https://api.render.com/v1/services?limit=1` should return JSON data.
- **Supabase management token check**
  - `GET https://api.supabase.com/v1/projects` should return accessible projects.

Important:

- Keep provider API keys distinct (`VERCEL_API_KEY`, `RENDER_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `INFISICAL_SERVICE_TOKEN`).
- Hosted agent sessions read Render, Vercel and Supabase through the MCP connectors, not a key. The names a session carries, the retired ones, and their legacy aliases: [`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md).
- Do not reuse one provider's token in another provider variable.
