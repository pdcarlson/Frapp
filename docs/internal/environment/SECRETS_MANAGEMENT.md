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
│  Syncs: Render ×2, Vercel ×4 (the 2 staging ones retired) — §5    │
│  Staging web/landing: built from an Infisical injection — §5      │
└──────────────────────────────────────────────────────────────────┘
```

## Free Tier Limits

| Resource     | Limit | Our Usage                      |
| ------------ | ----- | ------------------------------ |
| Identities   | 5     | 1 (admin)                      |
| Projects     | 3     | 1 (Frapp)                      |
| Environments | 3     | 3 — [`ENV_REFERENCE.md`](./ENV_REFERENCE.md#infisical-environments) |
| Integrations | 10    | 6 secret syncs — see §5        |

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
that name serves `apps/api` (Render sync) and `apps/web` (Vercel Production sync; injected into the staging build); it never reaches EAS. The live syncs are Render + Vercel only (next section).

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

#### Live syncs (6 total)

**Dashboard state last verified: 2026-08-12.** This table is a convenience copy of live
dashboard configuration and goes stale silently. Treat a disagreement between this table and the
Infisical/Vercel dashboards as the table being wrong, and re-stamp the date when you correct it.
See "Verifying this section against reality" below.

| Name                        | Infisical env | Path | Destination         | Vercel/Render env | Git branch filter |
| --------------------------- | ------------- | ---- | ------------------- | ----------------- | ----------------- |
| `render-api-production`     | Production    | `/`  | `frapp-api-prod`    | Service           | n/a               |
| `render-api-staging`        | Staging       | `/`  | `frapp-api-staging` | Service           | n/a               |
| `vercel-landing-production` | Production    | `/`  | `frapp-landing`     | Production        | none              |
| `vercel-landing-staging`    | Staging       | `/`  | `frapp-landing`     | Preview           | `main` — unverified, see below |
| `vercel-web-production`     | Production    | `/`  | `frapp-web`         | Production        | none              |
| `vercel-web-staging`        | Staging       | `/`  | `frapp-web`         | Preview           | `main` (read 2026-08-12) |

**The two staging Vercel syncs are retired (2026-09-24, [#2672](https://github.com/pdcarlson/Frapp/issues/2672)).**
Staging's web and landing builds take their app config from Infisical `staging` at build time
([§ Staging web and landing](#staging-web-and-landing-injected-at-build-not-synced)), so nothing
reads what `vercel-web-staging` and `vercel-landing-staging` write. Both have reported *Failed to
Sync* since the projects lost their Git link (ADR-21), which is what holds
[#2106](https://github.com/pdcarlson/Frapp/issues/2106) open. The owner deletes them, and their stale
`Preview · main` rows, once a staging deploy on the new path is green (tracked on
[#834](https://github.com/pdcarlson/Frapp/issues/834)); drop the two rows from this table then. The
branch-filter notes below describe those two syncs and stop mattering when they go.

**Read the last two columns carefully — they are different things that have both been called
"preview."** The *Vercel env* column is Vercel's own environment name (`Production` or `Preview`);
`Preview` there is correct and permanent. The *git branch filter* is a separate field naming a
repository branch. Conflating the two has already cost one investigation.

The branch filter is the field that keeps going wrong. A Vercel Preview env var is keyed on
`(environment, git branch)`, so a sync pointed at a branch that does not exist writes rows no
deployment will ever read — or fails outright, depending on how Vercel validates that day. Both
staging syncs originally targeted a branch literally named `preview`, which has never existed in this
repository (the only branch is `main`; `production` was retired in #1340). Never set that
value again.

`vercel-web-staging` was read in the Infisical UI on 2026-08-12 and targets `main`, which is correct —
`main` is the branch staging deploys from. **`vercel-landing-staging` was not opened that day**; its
`main` value is inferred from the two syncs having been repointed together and is the first thing to
confirm if landing's env vars ever look stale.

To inspect or edit one: Infisical → Integrations → **Secret Syncs**. To create one from scratch on a
fresh org, first authenticate the provider under **App Connections** (Vercel, Render), then
**Add Sync** and pick the source environment, path, and destination scope shown above.

#### GitHub Actions is not a sync

There is no GitHub Actions sync — the Secret Syncs list holds exactly the six above. The workflows
that need secrets **pull** at job time instead, via `Infisical/secrets-action@v1.0.12` with
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
change is needed. The one exception is the staging web and landing build, which hands each app only
the keys it is listed as reading (next section).

#### Staging web and landing: injected at build, not synced

**Decision (owner, 2026-09-24, [#834](https://github.com/pdcarlson/Frapp/issues/834#issuecomment-5821405063)):**
`deploy-vercel-staging.yml` injects Infisical `staging` itself and builds each app against exactly the
keys that app reads. No staging build reads a Vercel sync; the two staging syncs are retired and wait
for deletion (above). Why, and what was turned down:

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
`vercel build` the app's own keys, and removes those keys from the Preview env `vercel pull` writes,
so no Vercel row can supply one. The per-app key list is `APP_CONFIG_KEYS` in
[`scripts/ci/lib/vercel-build-env.mjs`](../../../scripts/ci/lib/vercel-build-env.mjs), and
`vercel-build-env.test.mjs` fails when it drifts from the `process.env` reads in `apps/web`,
`apps/landing` and every workspace package their bundles can contain. A required key missing from
Infisical fails the deploy before anything is built, naming the key, and so does a pull that leaves no
env file where the strip looks. Mechanism and evidence: that file's header.

**Runtime needs nothing from Infisical.** Next inlines `NEXT_PUBLIC_*` into client, server and proxy
code at build, and the only non-public key either app receives, `SENTRY_AUTH_TOKEN`, is read by
`next.config.js` alone. So deleting the Vercel Preview rows removes nothing a deployment reads at
request time.

**Production has not moved yet ([#2673](https://github.com/pdcarlson/Frapp/issues/2673)).**
`deploy-production.yml` injects Infisical `prod` in the same job as its Vercel steps, and those steps
still run on the whole job environment. So every production Vercel CLI process sees the whole `prod`
store, and any key that injection holds beats the Production row `vercel pull` writes: the rows the
`prod` syncs fill supply only keys the injection lacks. Narrowing those syncs therefore changes little
of what production compiles against; moving production to this path fixes both.

#### Blast radius

Since every sync reads path `/`, each pushes backend-only secrets toward destinations that never
consume them. What each frontend app actually reads is `APP_CONFIG_KEYS` in
[`scripts/ci/lib/vercel-build-env.mjs`](../../../scripts/ci/lib/vercel-build-env.mjs), a list a test
keeps equal to the source (this section used to carry its own copy, which had fallen five keys per app
behind). Everything else in the environment — database passwords, service-role keys, Stripe secrets,
deploy hook URLs — is pushed toward those projects without being used by them.

**The Vercel syncs deliver — including the staging ones.** On 2026-08-12 the `frapp-web`
environment-variable list was read directly, and both its `Preview` and `Production` scopes held the
full backend store: `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RENDER_DEPLOY_HOOK_URL`.

`frapp-landing` was **not** inspected variable-by-variable that day, so treat its contents as
expected-but-unconfirmed. The expectation is well founded — it is fed by two syncs with the same
`/` path from the same environments — but it is an inference, not a reading. Confirm it before
relying on it, and see the verification steps below.

Staging was not spared while its syncs worked: they wrote to `Preview` scope filtered to branch
`main`, and under the Git integration `main` is what staging deployed from, so the `frapp-web` staging
deployment received every backend credential as a server-side env var. None of them reach browsers,
because Next.js only inlines `NEXT_PUBLIC_*` into the client bundle, but any SSRF or RCE in the staging
web app would read through to the staging database and the Supabase account. Whether a CLI-created
deployment still receives those `main`-scoped rows at runtime was never established. Deleting them
(#834) settles it either way, and nothing an app reads depends on them
([§ Staging web and landing](#staging-web-and-landing-injected-at-build-not-synced)).

`SUPABASE_ACCESS_TOKEN` deserves separate mention: it is a Supabase **Management API** token. The
one these syncs delivered was scoped to the whole account, and therefore strictly more powerful than
`SUPABASE_SERVICE_ROLE_KEY`. **Corrected 2026-09-24 ([#2583](https://github.com/pdcarlson/Frapp/issues/2583)):**
that token is revoked, and each Infisical environment now holds its own read-only token scoped to
its own project (`ENV_REFERENCE.md` § CD Secrets). The Vercel copies still hold a revoked value,
because the Vercel syncs have failed since the projects were unlinked from Git (#2106). Still the
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

Narrowing the **production** syncs so the frontend projects stop receiving backend credentials is the
remaining work and is tracked in **#834** (the staging syncs feed no build, so they are deleted
rather than narrowed). The lever is a secret-path split (for example a frontend-only path that
the Vercel syncs read while Render and CI keep reading `/`) — there is no per-key filter, per "How a
sync decides what it pushes" above. Note the ordering: narrow the source path *first*, then delete
the leftover destination rows. Deleting first just invites the next sync to rewrite them.

#### Verifying this section against reality

Prose in this repo has been wrong about this twice. Before relying on any claim above, spend two
minutes confirming it:

1. **Infisical → Integrations → Secret Syncs.** For each sync read the source environment, the
   secret path, the destination scope, and the git branch. The branch is the field that has caused
   every incident so far.
2. **Vercel → project → Settings → Environment Variables.** Read what actually arrived. Group the
   rows by scope and by "Added" date — distinct dates mean distinct write generations, and old
   generations linger long after the config that created them is gone. A row scoped to a branch that
   no longer exists is inert but still readable.
3. Anything not marked **Sensitive** has a dashboard-readable value. Vercel flags these "Needs
   Attention"; the warning is about dashboard visibility, not about a detected leak.

Vercel's per-variable **Rotate Variable** button replaces only Vercel's copy. It does not rotate
anything at Supabase or Stripe, the old credential stays valid, and the next sync overwrites your new
value. Real rotation is provider first, then Infisical — never Vercel.

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
| `RENDER_DEPLOY_HOOK_URL` | _(none since #2505 — staging deploys by commit through the Render API too)_ | _(none — production deploys by commit through the Render API, never a hook)_ |
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

Note that a `Deploy API` run is reported green whenever the `check-changes` path gate skips all four deploy jobs, so a mostly-green run history does **not** mean the injection step works — only runs that touch `apps/api/` or `supabase/migrations/` exercise it. See [issue #696](https://github.com/pdcarlson/Frapp/issues/696), where that distinction hid a 100% injection failure rate for 71 days.

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
| R2 backup-bucket token    | On suspected compromise | Roll the scoped API token in Cloudflare R2 → update `BACKUP_S3_ACCESS_KEY_ID` + `BACKUP_S3_SECRET_ACCESS_KEY` in Infisical (`staging`). `db-backup.yml` pulls at job time, but the path-`/` `render-api-staging` sync (§5) also pushes a copy to the Render staging service. The retired staging Vercel syncs left copies in a Vercel project's Preview env only if the token predates that project's unlink (landing 2026-09-01, web 2026-09-02), until those rows are deleted (#834). Count every copy that applies in a blast-radius assessment ([`ENV_REFERENCE.md`](./ENV_REFERENCE.md) § Offsite Backup Secrets) |

**All rotations happen in one place (Infisical).** Syncs propagate changes to Render and to Vercel Production automatically; the staging web and landing builds read Infisical directly, so they pick up a change on their next deploy.

## Emergency Procedures

### Secret Exposed

1. **Immediately** rotate the secret in the source provider (Supabase/Stripe/etc.)
2. Update the canonical value in Infisical (one place)
3. Syncs propagate automatically — verify all services are healthy
4. If committed to git: notify team, consider force-push to remove

### Infisical Down

- Existing secrets in Vercel/Render are unaffected (synced copies persist), and so are the running deployments
- Deploys that inject at job time fail until it recovers: the staging API deploy, the staging web and landing deploy, and `deploy-production.yml`
- New changes must go directly to providers temporarily
- When Infisical recovers, reconcile and re-sync

## Audit

- Infisical dashboard → Audit Log for all secret access
- Verify sync health periodically for every sync in §5 (GitHub Actions is not one of them; the two staging Vercel syncs report Failed until they are deleted)
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
