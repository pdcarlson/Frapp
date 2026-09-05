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

3. **No environment suffixes.** There's no `RENDER_DEPLOY_HOOK_URL_STAGING` — just `RENDER_DEPLOY_HOOK_URL` with different values per environment. GitHub's `environment:` feature and Infisical's environment scoping handle the routing.

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
│  6 syncs: Vercel ×4, Render ×2                                    │
└──────────────────────────────────────────────────────────────────┘
```

## Free Tier Limits

| Resource     | Limit | Our Usage                      |
| ------------ | ----- | ------------------------------ |
| Identities   | 5     | 1 (admin)                      |
| Projects     | 3     | 1 (Frapp)                      |
| Environments | 3     | 3 (dev, staging, prod)         |
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

| UI name     | Slug        | Maps to                               |
| ----------- | ----------- | ------------------------------------- |
| Development | `dev`       | Local development via `infisical run` |
| Staging     | `staging`   | `main` branch deploys                 |
| Production  | `prod`      | Production deploys — a dispatched commit, not a branch (#1340) |

The **slug** is what every tool takes — `infisical run --env=`, the workflows' `env-slug:`, and
`.infisical.json`. Two of the three differ from the UI name. Verify against
**Project Settings → Environments**, which lists Name and Slug side by side.

### 3. Add Canonical Values

For each environment, add the canonical values from
[`ENV_REFERENCE.md` § "Canonical Variables — The Complete Grid"](./ENV_REFERENCE.md#canonical-variables--the-complete-grid),
together with its § "API-Only Settings" and § "CD Secrets (Deploy Workflows Only)" subsections. That grid
has a column per slug and is the only complete list — work it whole rather than a subset. The partial table
this section used to carry omitted `STRIPE_PUBLISHABLE_KEY`, which §4 below then references as a `${…}`
value. Start with `staging`, then repeat for `prod` and `dev`.

### 4. Add References

In **all three environments**, add the reference rows from
[`ENV_REFERENCE.md` § "References — Framework-Specific Names"](./ENV_REFERENCE.md#references--framework-specific-names)
— the value string you type is identical in every environment; only the canonical value it resolves to
changes. That table also flags the one `NEXT_PUBLIC_*` name that is a **literal**, not a `${…}` reference
(`NEXT_PUBLIC_SENTRY_DSN`), and this list never carried it.

`EXPO_PUBLIC_LANDING_URL` and `EXPO_PUBLIC_ASK_ENABLED` are **not** Infisical references — they are
direct-set client flags/URLs (see [`ENV_REFERENCE.md`](./ENV_REFERENCE.md) § apps/mobile). There is
**no Infisical → EAS sync**; any `EXPO_PUBLIC_*` a device build needs must also be set in the EAS
dashboard (`development` / `preview` / `production`) or a non-secret `eas.json` `build.<profile>.env`
entry. The six live syncs are Render + Vercel only (next section).

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

There is no GitHub Actions sync — the Secret Syncs list holds exactly the six above. `deploy-api.yml`
**pulls** at job time instead, via `Infisical/secrets-action@v1.0.12` with `method: "universal"`,
authenticating with the `INFISICAL_MACHINE_IDENTITY_ID` and `INFISICAL_CLIENT_SECRET` repository
secrets. This is universal auth, not OIDC.

Each injection step selects its source with `env-slug`. Note the production slug is **`prod`**, not
`production` — the Infisical environment slug and the GitHub environment name differ.

Because the action exports every secret in the resolved environment as a job env var, **adding a
secret to the right Infisical environment is sufficient to make it available to CI** — no workflow
change is needed.

#### Blast radius

Since all six syncs read path `/`, each pushes backend-only secrets toward destinations that never
consume them. Only these variables are actually read in application source:

| Vercel project  | Variables read in source                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `frapp-web`     | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_LANDING_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL` |
| `frapp-landing` | `NEXT_PUBLIC_APP_URL`                                                                                                                       |

Everything else in the environment — database passwords, service-role keys, Stripe secrets, deploy
hook URLs — is pushed toward those projects without being used by them.

**The Vercel syncs deliver — including the staging ones.** On 2026-08-12 the `frapp-web`
environment-variable list was read directly, and both its `Preview` and `Production` scopes held the
full backend store: `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RENDER_DEPLOY_HOOK_URL`.

`frapp-landing` was **not** inspected variable-by-variable that day, so treat its contents as
expected-but-unconfirmed. The expectation is well founded — it is fed by two syncs with the same
`/` path from the same environments — but it is an inference, not a reading. Confirm it before
relying on it, and see the verification steps below.

Staging is not spared, and this is the part that is easy to miss: the staging syncs write to
`Preview` scope filtered to branch `main`, and `main` is exactly what staging deploys from. So the
`frapp-web` staging deployment receives every backend credential as a server-side env var. None of
them reach browsers — Next.js only inlines `NEXT_PUBLIC_*` into the client bundle — but any SSRF or
RCE in the staging web app reads through to the staging database and the Supabase account.

`SUPABASE_ACCESS_TOKEN` deserves separate mention: it is a Supabase **Management API** token, scoped
to the account rather than one project, and therefore strictly more powerful than
`SUPABASE_SERVICE_ROLE_KEY`. It is the first thing to rotate if any of this is ever believed
compromised.

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

Narrowing the syncs so the frontend projects stop receiving backend credentials is the remaining work
and is tracked in **#834**. The lever is a secret-path split (for example a frontend-only path that
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

Add these secrets to GitHub repository settings (Settings → Secrets → Actions):

**Infisical bootstrap (permanent) — repository scope:**

These three are **repository secrets**, not environment secrets. One machine identity serves both `staging` and `production` (the workflow selects the environment via `env-slug`, not via credentials), so a single repository-scoped pair is correct and environment-scoped copies would only create two places to get it wrong. Confirmed by the repository owner on 2026-08-10: neither the `staging` nor the `production` GitHub environment holds any secrets of its own.

| Secret                          | Value                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| `INFISICAL_MACHINE_IDENTITY_ID` | The identity's **Universal Auth → Client ID** — see the warning below        |
| `INFISICAL_CLIENT_SECRET`       | From the same Universal Auth panel → **Add Client Secret** (shown once)      |
| `INFISICAL_PROJECT_ID`          | From Infisical → Project Settings → Project ID                              |

**Optional — staging conformance smoke user (repository scope):**

Consumed only by `.github/workflows/staging-conformance.yml`. When absent, the workflow's
end-to-end sign-in assertion reports **SKIPPED** rather than passing — it never fakes a pass.

Worth knowing before treating that as optional: this is the **only behavioural** assertion the
workflow makes — the other three (project health, auth-hook enablement, secret-sync status) all
read configuration. Migration parity is not among them: `check-migration-drift.yml` owns it, and
the conformance table lists it only as a pointer. So an unprovisioned smoke user leaves the
workflow asserting three configuration properties and nothing about whether the stack actually
works. Provisioning it is what makes a green run mean much.

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

**Transitional (until Infisical GitHub Action injection is wired):**

The deploy workflow (`deploy-api.yml`) injects these from Infisical at runtime via `Infisical/secrets-action`, so they do **not** need to exist as GitHub secrets at all. Keep them in Infisical, scoped per environment there. (Earlier revisions of this document called for GitHub environment-scoped copies; that contradicted the repository-scope rule above and is no longer accurate — see #772.)

| Secret                   | Staging value                           | Production value                |
| ------------------------ | --------------------------------------- | ------------------------------- |
| `SUPABASE_ACCESS_TOKEN`  | Account-level token (same for both)     | (same)                          |
| `SUPABASE_PROJECT_REF`   | Staging project ref                     | Production project ref          |
| `RENDER_DEPLOY_HOOK_URL` | Staging deploy hook URL                 | Production deploy hook URL      |
| `API_HEALTHCHECK_URL`    | `https://api-staging.frapp.live/health` | `https://api.frapp.live/health` |

Once the `@infisical/secrets-action` is integrated into the deploy workflow, these transitional secrets can be removed from GitHub and injected from Infisical at runtime.

#### Troubleshooting: `Deploy API` fails with `401 Invalid credentials`

`Infisical/secrets-action` reports the same `401 Invalid credentials` whether the bootstrap secrets are **absent** or **rejected**. To tell those apart, `deploy-api.yml` runs a `Verify Infisical credentials are configured` preflight step before each injection:

| Preflight result                       | Meaning                                                                                          | Fix                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Fails**, naming the secret           | `INFISICAL_MACHINE_IDENTITY_ID` and/or `INFISICAL_CLIENT_SECRET` is unset or empty in this scope | Add it as a repository secret, or as an environment secret on `staging` / `production`    |
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
| Render deploy hook URLs   | On service recreation   | Copy from Render → update canonical value in Infisical       |
| Supabase access token     | Every 90 days           | Regenerate in Supabase account → update in Infisical         |
| R2 backup-bucket token    | On suspected compromise | Roll the scoped API token in Cloudflare R2 → update `BACKUP_S3_ACCESS_KEY_ID` + `BACKUP_S3_SECRET_ACCESS_KEY` in Infisical (`staging`). `db-backup.yml` pulls at job time, but the path-`/` staging syncs (§5) also push copies to the Render staging service and both Vercel Preview envs — count those in any blast-radius assessment (#834 tracks narrowing that) |

**All rotations happen in one place (Infisical).** Syncs propagate changes to all providers automatically.

## Emergency Procedures

### Secret Exposed

1. **Immediately** rotate the secret in the source provider (Supabase/Stripe/etc.)
2. Update the canonical value in Infisical (one place)
3. Syncs propagate automatically — verify all services are healthy
4. If committed to git: notify team, consider force-push to remove

### Infisical Down

- Existing secrets in Vercel/Render/GitHub are unaffected (synced copies persist)
- New changes must go directly to providers temporarily
- When Infisical recovers, reconcile and re-sync

## Audit

- Infisical dashboard → Audit Log for all secret access
- Verify sync health periodically for all six syncs (§5 — GitHub Actions is not one of them)
- Review no unexpected access patterns

## Provider API token sanity checks (operations)

When running infrastructure automation (agents/scripts), validate provider API credentials before making write calls:

- **Vercel token check**
  - `GET https://api.vercel.com/v2/user` should return an authenticated user.
- **Render token check**
  - `GET https://api.render.com/v1/services?limit=1` should return JSON data.
- **Supabase management token check**
  - `GET https://api.supabase.com/v1/projects` should return accessible projects.

Important:

- Keep provider API keys distinct (`VERCEL_API_KEY`, `RENDER_API_KEY`, `SUPABASE_API_KEY`, `INFISICAL_SERVICE_TOKEN`).
- In hosted agent VMs, legacy aliases may still appear in older docs or sessions (`RENDER_APIKEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`, `GITHUB_TOKEN`), but prefer the current names `RENDER_API_KEY` and `GITHUB_PAT` when present. (`GITHUB_TOKEN` is also the GitHub Actions runtime token — distinct from the PAT.) For `gh`/git, `export GH_TOKEN="$GITHUB_PAT"`.
- Do not reuse one provider's token in another provider variable.
