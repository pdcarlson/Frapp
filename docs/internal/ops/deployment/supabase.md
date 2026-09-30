## 3. Supabase Cloud Setup

You need **two** Supabase projects: one for staging, one for production.

### Create Projects

1. Go to https://supabase.com/dashboard → **New Project**.
2. Create `frapp-staging` (region closest to you).
3. Create `frapp-prod` — that is the name [`.github/environments.json`](../../../../.github/environments.json)
   records, and the one `scripts/run-migration.mjs` prints when an injected ref does not match.
   Region: closest to you — it need not match staging, and the two live projects do
   differ. [`DB_ROLLBACK_PLAYBOOK.md`](../DB_ROLLBACK_PLAYBOOK.md#backup-reality)
   § Backup reality records what they actually use.

### Plan and quotas

Both projects sit in one Supabase organization, **Frapp Live** (`iouzvaszrnjlndtmookt`). The
plan belongs to the organization, not to a project, so the two projects always share one plan.

**The organization has been on Pro since 2026-09-28.** To check it, call the Supabase MCP
`get_organization` with that id: it returns `"plan": "pro"`. The dashboard shows the same under
organization **Frapp Live → Billing → Subscription Plan**.

**Why it was upgraded.** On Free, staging and production shared one 1 GB storage quota. The
first real Discord import on staging stored 2.85 GB of attachments from a single chapter's
server. Once the grace period for going over quota ends, Supabase restricts **every** project in
the organization, production included: it can pause projects, make databases read-only, or answer
402 to every request ([Fair Use Policy](https://supabase.com/docs/guides/platform/billing-faq#fair-use-policy)).
Free also showed no Supabase daily backups (#1403), and it capped uploads at 50 MB (#1235).

**What Pro includes.** These are the organization-wide quotas unless a row says "per project".
Checked against Supabase's documentation on 2026-09-28; the linked pages own the current numbers.

| | Free (before) | Pro (now) |
| --- | --- | --- |
| [Storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size) | 1 GB | 100 GB, then $0.0213 per GB-month |
| [Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), uncached / cached | 5 GB / 5 GB | 250 GB / 250 GB, then $0.09 / $0.03 per GB |
| [Database](https://supabase.com/docs/guides/platform/database-size), per project | read-only past 500 MB of data | 8 GB disk included. It grows past 8 GB ($0.125 per GB-month) only with the spend cap off; with it on, the project goes read-only near 8 GB |
| [Largest upload](https://supabase.com/docs/guides/storage/uploads/file-limits) (the project's global file-size limit) | 50 MB at most | up to 500 GB with the spend cap off. With it on, the dashboard lowers the maximum without saying to what. Both projects are set to 100 MB |
| [Daily backups](https://supabase.com/docs/guides/platform/backups), per project | none shown | taken daily, the last 7 days restorable from the dashboard, which also offers restoring one into a new project |
| [Point-in-time recovery](https://supabase.com/docs/guides/platform/backups#point-in-time-recovery) | not available | a paid add-on, **not enabled** |
| [Pausing for inactivity](https://supabase.com/docs/guides/platform/free-project-pausing) | after about 7 quiet days | never |
| Support | community | the dashboard's support form |

**What it costs.** The plan is $25 a month. Compute is billed per project on top of it: each
project runs on the default Micro instance, about $10 a month, and Pro includes $10 of compute
credit, which covers one of them. Staging and production together therefore come to about **$35 a
month** before any overage
([how multiple projects are billed](https://supabase.com/docs/guides/platform/billing-faq#how-are-multiple-projects-billed-under-a-paid-organization)).
Point-in-time recovery would add about $100 a month per project for 7 days of recovery, and it
requires at least the Small compute size. It is not billed until someone enables it.

**The spend cap is on,** which is Pro's default. With it on, usage above a quota is not billed.
Instead, the organization gets a warning and a grace period, and after that the same restrictions
as on Free apply to both projects. Turning the cap off (organization **Billing → Cost Control**)
bills the overage at the rates in the table instead. The cap does not cover add-ons such as
point-in-time recovery. The organization's **Usage** page shows how close each quota is.

**Set up after the upgrade (2026-09-28):**

- **Each project's upload limit is 100 MB (#1235).** It lives under **Storage → Settings → Global file
  size limit**, which Free capped at 50 MB. Discord allows 100 MB attachments and the `chat-archive`
  bucket accepts 100 MB, but the lower of the two limits wins. Why a new project needs it set by hand,
  and the upload that proves it took effect:
  [`DB_PROMOTION_RUNBOOK.md` § 20260823124000_chat_archive_bucket.sql](../DB_PROMOTION_RUNBOOK.md#20260823124000_chat_archive_bucketsql).
- **`frapp-prod` shows Supabase's daily backups (#1403),** under **Database → Backups**. The nightly offsite dump
  still runs, and it is still the only copy that survives deleting the project, and the only
  backup of Storage files:
  [`DB_ROLLBACK_PLAYBOOK.md` § Backup reality](../DB_ROLLBACK_PLAYBOOK.md#backup-reality).

### Apply Migrations

```bash
# Link to staging project
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase db push

# Link to production project
npx supabase link --project-ref <PRODUCTION_PROJECT_REF>
npx supabase db push
```

Follow the internal promotion and rollback runbooks when promoting schema changes:

- `docs/internal/ops/DB_PROMOTION_RUNBOOK.md`
- `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`

### Edge Functions

The repo has one Supabase Edge Function, `discord-attachment-copy` (`supabase/functions/`). It copies
a Discord bot import's attachments from Discord's CDN into the `chat-archive` bucket, so the bytes
never pass through the API on Render ([ADR-26](../../../../spec/architecture/adr/adr-26.md), #2848).
The API's `SupabaseArchiveMediaCopier` is its only caller.

**How it deploys.** Only through CI, never by hand. `_deploy.yml` runs
`scripts/ci/deploy-edge-functions.mjs` after the migrations and before the API:

- on staging, every run whose plan is not `stale`;
- on production, a real `full` run.

The script checks the injected `SUPABASE_PROJECT_REF` against `.github/environments.json`, as the
migrations do. It then runs `supabase functions deploy <name> --use-api --project-ref <ref>` for
each function, so Supabase bundles it and the job needs no Docker. Order and gating:
[CI/CD § How Deployments Are Gated](ci-cd.md#how-deployments-are-gated).

**Its credential.** `SUPABASE_FUNCTIONS_DEPLOY_TOKEN`, one per Infisical environment. It is a
scoped access token for that environment's project alone, with only the **Edge Functions**
read-write permission. The read-only `SUPABASE_ACCESS_TOKEN` cannot deploy a function.
[`ENV_REFERENCE.md` § CD Secrets](../../environment/ENV_REFERENCE.md#cd-secrets-deploy-workflows-only)
says how to mint it. When it is missing, the staging and production deploys fail at this step, before
the API.

**Its settings.**

- **`verify_jwt = false`**, in `supabase/config.toml`, which the deploy reads. The function checks the
  caller's service credential itself, and that check also accepts the newer `sb_secret_…` keys, which
  the platform's JWT check refuses.
- **No secrets of its own.** It reads the platform's default `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  and `SUPABASE_SECRET_KEYS`.
- **No region pin.** `frapp-prod` is in `us-east-2`, which Edge Functions do not offer as an
  invocation region.

**Limits it is built around** (Supabase [`functions/limits`](https://supabase.com/docs/guides/functions/limits),
read 2026-09-29): 256 MB of memory, 2 s of CPU per request with async I/O excluded, and a
**150 s request idle timeout**, past which the caller gets a 504. So a call works to its own time and
byte budget, answers well before that, and hands back what it did not get to as `deferred` for the API
to send again. The budgets, and why each is set where it is, are the constants at the top of
`supabase/functions/discord-attachment-copy/handler.ts`.

**To check it is deployed:** Supabase MCP `list_edge_functions` for the project, or the dashboard's
**Edge Functions** page. Its logs are there too. A bot import whose copy service is missing or
refusing the API fails with *"Could not copy attachments into the archive: the copy service
answered …"* on the job.

### Collect Keys

From each project's dashboard → Settings → API Keys, note the project URL (`SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_URL`), the client key (`SUPABASE_ANON_KEY`) and the service key
(`SUPABASE_SERVICE_ROLE_KEY`, API only, never exposed to a client). Which key each name takes, and
which key generation, is in
[`ENV_REFERENCE.md` § Core App Secrets](../../environment/ENV_REFERENCE.md#core-app-secrets).

### Auth settings (hosted, dashboard or Management API)

These live on the project, not in this repo, so they are recorded here with the date they were
read. Read them back with `GET https://api.supabase.com/v1/projects/<ref>/config/auth`: each
Infisical environment's `SUPABASE_ACCESS_TOKEN` reads its own project's (read-only, one project
each since [#2583](https://github.com/pdcarlson/Frapp/issues/2583)). Write in the dashboard under
Authentication → URL Configuration / SMTP Settings, or with `PATCH` on the same path using a
personal token that can write; no stored CI token can.

| Setting | `frapp-prod` | `frapp-staging` |
| --- | --- | --- |
| Site URL | `https://app.frapp.live` (read 2026-09-07) | `https://app.staging.frapp.live` (read 2026-09-07) |
| Redirect allow list | `https://app.frapp.live`, `https://api.frapp.live`, **`frapp://**`**, **`https://app.frapp.live/**`** (read 2026-09-07) | `https://app.staging.frapp.live`, `https://api-staging.frapp.live`, `exp://localhost:8081`, **`frapp://**`**, **`https://app.staging.frapp.live/**`** (read 2026-09-07) |
| Email confirmations | required (`mailer_autoconfirm: false`) | required |
| Custom SMTP | **on** — Resend `smtp.resend.com:465`, user `resend`, From `Signet <no-reply@mail.frapp.live>` (owner send proof 2026-09-09 ~23:07Z from `https://app.frapp.live`). Target sender name `Frapp`: [ADR-25 step 3](#adr-25-step-3-the-sender-becomes-frapp) | **on** — Resend `smtp.resend.com:465`, From `Signet <no-reply@mail.staging.frapp.live>` (owner send proof 2026-09-09 from `https://app.staging.frapp.live`). Target sender name `Frapp`: [ADR-25 step 3](#adr-25-step-3-the-sender-becomes-frapp) |
| Auth email rate limit | **300 per hour** (owner dashboard toast 2026-09-09) | **300 per hour** (owner dashboard 2026-09-09; asserted daily as `auth-smtp`) |
| Password minimum length | 6 | 6 |
| Leaked password protection ("Prevent use of leaked passwords", Authentication → Sign In / Providers → Email; Pro plan and up) | **on** (owner 2026-09-29; security advisor clear at 21:14Z; asserted daily as `auth-leaked-password`) | **on** (owner 2026-09-29; security advisor clear at 21:31Z; asserted daily as `auth-leaked-password`) |
| Custom access-token hook | `public.custom_access_token_hook` (enabled) | same |

**`frapp://**` was added to both allow lists on 2026-09-06.** The mobile app's magic-link
`emailRedirectTo` is `Linking.createURL("/")` with a trailing `?` (`frapp:///?` in a build that
owns the scheme; see `spec/ui/mobile/navigation.md` § Magic-link auth callback) so the hosted
template can append `&token_hash=`. Without the allow-list entry, GoTrue rejects the redirect
and drops the member on the web Site URL instead. Expo Go's `exp://<host>:8081/--/` form is
still per-machine and still #765.

**`https://app.frapp.live/**` and `https://app.staging.frapp.live/**` were added on 2026-09-06
(late), for the web app.** GoTrue matches an allow-list entry as a glob, and a bare origin is a
glob that matches only itself — `https://app.frapp.live` admits exactly that string. Every web
`emailRedirectTo` is `${origin}${redirectTo}`: `/chat` by default, `/join?token=…` from an invite
link (`apps/web/app/sign-in/page.tsx`, `sign-up/page.tsx`). With only the bare origin listed, GoTrue
silently swapped each of those for the Site URL — the magic link still signed the member in, but at
`/`, and a sign-up made from an invite link arrived without its token. Verified before and after
with the unauthenticated probe `GET /auth/v1/verify?token=<invalid>&type=magiclink&redirect_to=<url>`
(with a valid `apikey`): GoTrue answers with a redirect to `redirect_to` when it is allowed and to
the Site URL when it is not, so `redirect_to=https://api-staging.frapp.live/anything` (a path under
a bare entry) went to the Site URL while `…/app.staging.frapp.live/join?token=abc` now goes through.
`scripts/ci/staging-conformance.mjs` asserts both wildcards daily (`auth-redirects`), so this cannot
silently revert or be forgotten on a new project.

**Custom SMTP (observation 2026-09-09).** Staging and production Auth SMTP are both
**proven**. Earlier 2026-09-08 claims that staging Auth SMTP was proven were
**wrong**: after the From switched to `mail.staging.frapp.live`, GoTrue 500ed because
the Resend SMTP password was still the old all-domains / wrong-domain key. A later
2026-09-09 note that production was configured-but-unproven is superseded by the
unused-inbox send below.

Correction, owner dashboard + Resend key list + owner send proofs 2026-09-09 (key
names only; never paste values into Slack or git):

- Sending keys are domain-scoped: `supabase-smtp-key-staging` →
  `mail.staging.frapp.live`, `supabase-smtp-key-prod` → `mail.frapp.live`. The
  previous unscoped `supabase-smtp-key` is gone from the account key list.
- Staging Auth SMTP uses the staging-scoped key. Proof: a Magic Link from
  `https://app.staging.frapp.live` succeeded (no 500). Mail landed in the primary
  inbox, Gmail Important. From `Signet <no-reply@mail.staging.frapp.live>`. Subject
  `Sign in to Signet`.
- Production Auth SMTP uses the prod-scoped key. Proof (2026-09-09 ~23:07Z): unused-inbox
  Magic Link from `https://app.frapp.live` succeeded. From
  `Signet <no-reply@mail.frapp.live>`. Host `smtp.resend.com`, port `465`, user
  `resend`, rate limit **300 emails/hour**.
- The Magic Link template body was copied staging → prod. Confirm and invite
  templates were **intentionally not copied**.
- Both projects are at **300/hour**. `_dmarc.frapp.live` is `v=DMARC1; p=none;`.

`staging-conformance.mjs` asserts the host, that live From, `smtp_sender_name=Frapp`,
and the send cap daily (`auth-smtp`) so a revert to the hosted 2/hour mailer, a leftover
Signet sender, or the burned apex From cannot sit green. It also asserts the Magic Link
subject and `token_hash` href daily (`auth-magic-link`) so a dashboard reset to
`{{ .ConfirmationURL }}` cannot sit green, and fails any `mailer_subjects_*` or a Magic
Link body that still says Signet.

Production SMTP is on, so the 07:45 `production-auth-conformance.yml` watchdog
fails an empty host, as staging does. It requires `Frapp <no-reply@mail.frapp.live>`
at ≥300/hour and fails a burned apex From. The Magic Link href must carry
`token_hash` + `type=magiclink`, whatever the SMTP state, or the 07:45 job fails.
Both used to be skipped while the host was empty (#2349). The
Magic Link body is now on prod; confirm and invite were intentionally left uncopied.

The Magic Link *href* on staging is `app.staging.frapp.live/auth/callback`
(`token_hash`, #1916). Gmail trained the apex From `invites@frapp.live` on the first
generic hosted templates, so sending now uses mail subdomains (Resend domains
`mail.staging.frapp.live` and `mail.frapp.live`, created 2026-09-08, tracking off)
so staging tests cannot burn production reputation. Staging invite mail doesn't follow
that yet: see the last item below. Do not send From the apex. The Auth senders are the
ones [ADR-25 step 3](#adr-25-step-3-the-sender-becomes-frapp) sets, and each console
says `Signet` until the owner makes that change (the table above has the last read,
2026-09-09):

- Staging Auth: `Frapp <no-reply@mail.staging.frapp.live>`
- Prod Auth: `Frapp <no-reply@mail.frapp.live>`
- API invite default: `Frapp <invites@mail.frapp.live>`. `RESEND_FROM_EMAIL` is unset on
  staging (its boot log, read 2026-09-24), so staging invites use this production
  subdomain too. Moving them to `Frapp <invites@mail.staging.frapp.live>` is
  [#2655](https://github.com/pdcarlson/Frapp/issues/2655).

Leave the existing `frapp.live` Resend domain in place until nothing uses it.

The Magic Link template, as ADR-25 step 3 sets it. The one on staging and prod as of
2026-09-09 is the same with Signet in the subject, heading and link text. Confirm and
invite were **intentionally not copied**:

Subject: `Sign in to Frapp`

Body: `<h2>Sign in to Frapp</h2><p>Use this one-time link to sign in. It expires soon.</p><p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink">Sign in to Frapp</a></p><p>If you did not ask to sign in, you can ignore this email.</p>`

Paste this only on the **Magic Link** template. Confirm signup / invite / recovery keep their
own `type` (`signup`, `invite`, `recovery`) — copying this body onto those breaks them.
Do **not** paste that on a host whose web deploy does not yet include the `token_hash` handler.
Leave Resend open/click tracking off (single-use links). Production SMTP uses the prod
mail subdomain From above, then 300/hour — dashboard-only; do not put the key in Slack
or git. Auth SMTP itself is proven on staging and production.

#### ADR-25 step 3: the sender becomes Frapp

*2026-09-24 ([#2578](https://github.com/pdcarlson/Frapp/issues/2578)).* From the merge of
step 3, `auth-smtp` and `auth-magic-link` expect Frapp: the sender name, the Magic Link
subject, no `mailer_subjects_*` that says Signet, and no `Signet` or `SIGNET` anywhere in
the Magic Link body, comments and `alt` text included. The match is case-sensitive: the
design system's file, class and CSS variable names are lowercase (`signet-emblem-B.png`,
`--signet-*`) and pass. The consoles are the owner's to change, in this order, before the
next scheduled run (staging 07:30 UTC, production 07:45 UTC). Production's step waits on
Deploy production, which is dispatched by hand, so merge once that day's Staging
conformance and Production Auth conformance runs both appear under Actions (a scheduled
run tests the `main` commit of the moment GitHub queued it, which is often late), and
deploy production the same day. A slip opens alerts that close on the first run that
passes: Staging conformance or Production Auth drift for a console not yet retyped, and
Migration drift for `20260924190000` if production hasn't deployed by the 07:00 UTC check
more than 24 hours after 2026-09-24 19:00 UTC. *Corrected 2026-09-28: that last alert no
longer fires. Production is now judged against its latest `v*` tag, not `main`, so a
migration merged and not yet shipped reads as unreleased
([`agent-infra.md` § Schema drift detection](../../../ci-cd/agent-infra.md#schema-drift-detection-scriptscicheck-migration-driftmjs)).
`20260924190000` shipped in v1.3.0.*

1. **Staging.** Once the merge's staging deploy is live, in `frapp-staging` →
   Authentication: SMTP Settings → Sender name `Frapp`; Email Templates → Magic Link → the
   subject above, and the body above pasted whole (it keeps the `token_hash` href); any
   other template subject that says Signet.
   *2026-09-24: this step first said to set staging's `RESEND_FROM_EMAIL` before merging.
   Staging never had it set, and the new API default already says Frapp, so the rename
   needs nothing there ([#2655](https://github.com/pdcarlson/Frapp/issues/2655)).*
2. **Production.** If `RESEND_FROM_EMAIL` is set in Infisical `prod`, set it to
   `Frapp <invites@mail.frapp.live>` before dispatching Deploy production of the merge
   commit (unset, the new API default is already Frapp). After that deploy, the same three
   Auth settings on `frapp-prod`. Renaming Auth before the deploy would send Frapp sign-in
   mail beside Signet invite mail from the older build.
3. **Confirm.** Dispatch Staging conformance and Production Auth conformance, then update
   the table above with the values read and the date.

### Invite mail (API, Render)

This is **not** Auth SMTP. Auth Magic Links use GoTrue + the `supabase-smtp-key-*`
Resend keys on the Supabase project. Invite mail is the API's `RESEND_API_KEY`
path (`selectEmailProvider()`). Do not treat a proven Magic Link as proof that
chapter invites send, or a Render env row as proof that Auth SMTP works.

Observation 2026-09-09 (owner confirmation, **names only**; values not opened).
This session's Render MCP could not re-read env-var lists (`unauthorized`); the
destination proof is Paul's dashboard read of the row names, not a Render API
dump.

| Surface | State |
| --- | --- |
| Render `frapp-api-staging` | env-var **row named** `RESEND_API_KEY` **present** |
| Render `frapp-api-prod` | env-var **row named** `RESEND_API_KEY` **present** |
| Infisical → Render syncs | already green (not re-opened here) |
| Resend keys for this path | `invite-mail-staging`, `invite-mail-prod` (listed 2026-09-09; separate from `supabase-smtp-key-staging` / `supabase-smtp-key-prod`) |

Did **not** Deploy production. A present env-var **name** is not proof the running
process has left the no-op provider — that would take a restart/Deploy, which
this observation did not do.

### Auth OAuth providers (Google and Apple)

Provider client ids and secrets live in the **Supabase dashboard** (Authentication → Providers), not Infisical. Do not invent values here. The web and mobile clients call `signInWithOAuth` / native SIWA against whatever the hosted project has enabled. Until a provider is enabled, the UI maps `provider is not enabled` to member-facing copy and magic-link still works.

**Redirect URLs the clients send** (must stay on the allow list in § Auth settings — the `/**` and `frapp://**` wildcards already cover them; confirm rather than adding a second copy of the origin):

| Surface | Redirect the app asks GoTrue to use |
| --- | --- |
| Web staging | `https://app.staging.frapp.live/auth/callback?next=<guarded path>` |
| Web production | `https://app.frapp.live/auth/callback?next=<guarded path>` |
| Mobile (release / dev-client) | `frapp:///?` (`Linking.createURL("/")` plus a trailing `?`) |
| Mobile Expo Go | `exp://<host>:8081/--/?` — same per-machine gap as magic-link (#765) |

GoTrue's own provider callback (what you paste into Google Cloud / Apple, **not** the app URL) is `https://<project-ref>.supabase.co/auth/v1/callback` per hosted project.

#### Done / Not done

Observation 2026-09-10 for the first two Google rows, **2026-09-13 for the Apple rows** (owner confirmation, **names only**; values not opened — the Apple rows were recorded while the owner drove the consoles). Secrets stay in the Google Cloud / Apple / Supabase dashboards. Dashboard-only: did **not** Deploy. Tracker: #2120.

| Item | State |
| --- | --- |
| Google Cloud OAuth 2.0 **Web** client (JS origins `https://app.frapp.live`, `https://app.staging.frapp.live`; redirect URIs the two hosted `/auth/v1/callback` URLs; client id + secret pasted into each project's Google provider) | **Done**. It lives in Cloud project `signet-frapp` and is named "Frapp Web client 1" under Google Auth Platform → Clients, a dashboard label only. *2026-09-24: renamed from "Signet Web client 1" by the owner ([#2669](https://github.com/pdcarlson/Frapp/issues/2669)).* |
| Google provider enabled on hosted `frapp-staging` and `frapp-prod` | **Done** |
| Google Auth Platform → **Audience** (publishing) | **Published: In production**, user type External, after the brand was verified (next row). Any Google account can now reach the consent screen. Earlier that day the status was **Testing** with **0 test users**, and the OAuth user cap read "0 users … counted over the entire lifetime of the app". **Google had already admitted accounts on both projects before that reading**: Google identities were linked on `frapp-staging` on 2026-09-10 and on `frapp-prod` on 2026-09-15, and a Google sign-in completed on `frapp-prod` on 2026-09-17 (see **Observed sign-ins** below). So either the counter doesn't count these sign-ins, or a project's Google provider isn't using the `signet-frapp` client the first row records. **Unresolved:** which of those holds, and why Testing with no test users didn't stop these sign-ins, if that was the status then. Nobody recorded the publishing status before 2026-09-28. *2026-09-28: the Testing reading, from the owner's screenshots ([#2669](https://github.com/pdcarlson/Frapp/issues/2669)). In production and External, from the owner's later Audience screenshot the same evening ([#2758](https://github.com/pdcarlson/Frapp/issues/2758)). 2026-09-30: this row said no Google sign-in had been seen to complete, and read the counter as "nobody had ever been admitted". Both projects' `auth.identities` disprove that ([#2945](https://github.com/pdcarlson/Frapp/issues/2945)).* |
| Google Auth Platform → **Branding** | App name **Frapp**. Home page `https://www.frapp.live`; privacy and terms `https://frapp.live/privacy` and `https://frapp.live/terms`; authorized domains `frapp.live`, `hnoyzpidbmizhbqaiity.supabase.co` and `unttyvyfezddlyafcydh.supabase.co`; `team@frapp.live` among the developer contacts; a crest logo that looks, by eye, like the more orange pre-#2153 export. Brand verification: **verified**. Google's Verification status reads "Your branding has been verified and is being shown to users." An earlier attempt had been flagged with two issues: the home page wasn't registered to the Cloud project's owner, and the app name didn't match the home page. The banner doesn't report on each issue. We infer both cleared through two fixes: the Search Console record in [`vercel.md` § 4.4](vercel.md#44-dns-records-squarespace-domains), and the Frapp landing (#2770) reaching production in [Deploy production run 36464014731](https://github.com/pdcarlson/Frapp/actions/runs/36464014731) of `0719d521`. *2026-09-24: the owner renamed the app name from Signet, with no verification prompt on save. 2026-09-28: the rest, from the owner's screenshots ([#2669](https://github.com/pdcarlson/Frapp/issues/2669), [#2758](https://github.com/pdcarlson/Frapp/issues/2758)). The verified status comes from a later screenshot the same evening, taken after that deploy ([#2758 comment](https://github.com/pdcarlson/Frapp/issues/2758#issuecomment-5876200553)). It shows app name Frapp, the owner's personal Gmail as user support email, and a gold crest logo, not compared against the current export. It doesn't show the links or domains above, which are the earlier reading. An agent read `www.frapp.live`, `/privacy` and `/terms` through the Vercel MCP and found Frapp on all three and no "Signet".* |
| Automatic linking | **On** (a later Google/Apple identity can attach to an existing email/password or magic-link user; do not merge `public.users` rows — unique on `supabase_auth_id` only) |
| Skip nonce (Google provider) | **Off** |
| Allow users without email — **Google** | **Off** |
| Allow users without email — **Apple** | **On** (2026-09-13). Apple may omit the email claim on a later native grant; AuthSync then stores the `noreply+<auth-id>@users.invalid` placeholder ([`spec/architecture/README.md`](../../../../spec/architecture/README.md)). With this **Off**, GoTrue rejects that sign-in outright and the placeholder path is unreachable. Not an App Store requirement — Apple requires that a member be able to *hide* an address, and Hide My Email still returns a real `@privaterelay.appleid.com` relay address (deliverable **once the sending domain is registered** — see **Still open** below). |
| Magic Link templates | **Untouched** by the OAuth work: don't change them for a provider. *2026-09-24: ADR-25 step 3 retypes them for the product name; see [§ ADR-25 step 3](#adr-25-step-3-the-sender-becomes-frapp).* |
| Apple Developer: App ID `live.frapp.mobile` + Sign in with Apple; Services ID `live.frapp.mobile.web`; Sign in with Apple key | **Done** (2026-09-13) |
| Apple provider enabled on hosted `frapp-staging` and `frapp-prod` | **Done** (2026-09-13) |
| Apple **Sign in with Apple for Email Communication** source domains | **Not done** — #2191. Until both sending domains are registered, mail to a Hide My Email member is refused by Apple's relay. |
| Custom Auth domain | **Later** — #2125 |
| Native Google iOS/Android OAuth clients | **Later** — #2126. Mobile Google uses this Web client through the browser auth session. |

**Apple Sign in with Apple — what the console actually asks for**

Recorded 2026-09-13 from a guided walkthrough of the live consoles. An earlier
version of this section said to *upload the `.p8` in the Supabase Apple
provider*. **There is no `.p8` upload.** Supabase stores one field, `Secret Key
(for OAuth)` — a JWT generated *from* the key file. The `.p8` never leaves the
machine that downloaded it.

1. **App ID** — Identifiers → `live.frapp.mobile` → enable **Sign in with
   Apple** → Edit → *Enable as a primary App ID*. Leave the **Server-to-Server
   Notification Endpoint blank**: Supabase Auth does not support it. Sign in
   with Apple needs an **Explicit** bundle id; a wildcard App ID cannot carry
   the capability. Changing capabilities invalidates existing provisioning
   profiles — EAS regenerates them on the next build.
2. **Services ID** — Identifiers → Services IDs → `live.frapp.mobile.web` →
   enable SIWA → Configure → Primary App ID `live.frapp.mobile`. Both hosted
   projects share this one Services ID. Domains and Return URLs are
   **comma-delimited, not newline-delimited**; a newline is parsed as one
   malformed value and the only feedback is "One or more domains are invalid".
   - Domains: `hnoyzpidbmizhbqaiity.supabase.co,unttyvyfezddlyafcydh.supabase.co`
   - Return URLs: the two `https://<project-ref>.supabase.co/auth/v1/callback`

   Apple's domain-association file does not apply here — that belongs to the
   Email Communication service, and a `supabase.co` host could not serve it in
   any case. The Services ID **Description** is member-facing on the web
   consent sheet, so it reads the product name, `Frapp`, not an internal label.
   *2026-09-24: the owner renamed it from "Signet Web" to `Frapp`, and their
   screenshot of the Services IDs list shows `Frapp` ([#2669](https://github.com/pdcarlson/Frapp/issues/2669)). Before
   anyone had read the console, this note said it was `Signet`.* Saving is four
   clicks deep (Next → Done → Continue → Save); stopping at Done loses the
   configuration silently.
3. **Key** — Keys → new key with Sign in with Apple → Primary App ID
   `live.frapp.mobile` → Register. `AuthKey_<KEYID>.p8` downloads **once** and
   cannot be re-fetched; Apple caps a team at two SIWA keys, and recovering from a
   lost key means revoking it in the Apple console — which frees the slot — then
   registering a replacement and re-generating the secret for both projects. It must never be committed to this repo. Note the Key ID; the
   Team ID is the **App ID Prefix** shown on any App ID page (kept out of this
   file for the same reason `eas.json` no longer names `appleTeamId` —
   [`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md)).
4. **Secret** — generate the JWT with the client-side generator on
   [Supabase's Apple provider guide](https://supabase.com/docs/guides/auth/social-login/auth-apple)
   (Team ID + Services ID + Key ID + `.p8`; the generator does not work in
   Safari). It is bound to the Services ID and team, **not** to a project, so
   one generated value goes into both. **It expires every 6 months — generated
   2026-09-13, so it must be regenerated by 2027-03-13**, after which web Apple
   sign-in breaks with no deploy to correlate against. That date is derived from
   Apple's 6-month cap, not read off the issued token; decode the JWT's own `exp`
   to confirm it. Nothing asserts this expiry — neither conformance script checks
   the Apple provider — so it is tracked only by **#2192**, and by nothing that
   will surface on the day. A correct value starts
   `eyJ`; one starting `-----BEGIN PRIVATE KEY-----` is the `.p8` pasted by
   mistake and fails only at the first sign-in attempt.
5. **Client IDs** — comma-separated, and the split is deliberate:
   - `frapp-prod`: `live.frapp.mobile.web,live.frapp.mobile`
   - `frapp-staging`: the same, plus `host.exp.Exponent`

   The Services ID covers web/browser OAuth; the **bundle id** covers native
   iOS, because [`apps/mobile/lib/apple-auth.ts`](../../../../apps/mobile/lib/apple-auth.ts)
   calls `signInWithIdToken` and that token's audience is the bundle id. Omit it
   and web sign-in works while native iOS fails. `host.exp.Exponent` is the Expo
   Go app's **shared** bundle id, so it is **staging-only on purpose**: trusting
   it in production would accept identity tokens that were not issued to this
   app.
6. Confirm each project's redirect allow list is unchanged — **confirm, do not
   add**. The lists are **per-project** and are recorded in
   [§ Auth settings](#auth-settings-hosted-dashboard-or-management-api); read them
   there rather than from a second copy here. Neither project carries the other's
   origin, and that is deliberate: `checkAuthRedirects` in
   `scripts/ci/staging-conformance.mjs` asserts exactly `${siteUrl}/**` plus
   `frapp://**`. Pasting the staging wildcard into production would let production
   GoTrue redirect a member onto a staging host. This list governs where GoTrue
   may send the member *afterward*; the `supabase.co/auth/v1/callback` URLs belong
   on Apple's side, not in it.

**Still open — Email Communication (#2191).** Register the sending domains under Apple →
Services → **Sign in with Apple for Email Communication**. There are **two**, and
[§ Auth settings](#auth-settings-hosted-dashboard-or-management-api) already names
both: `mail.frapp.live` (prod Auth SMTP, and the invite sender in
[`email.module.ts`](../../../../apps/api/src/modules/email/email.module.ts)) and
`mail.staging.frapp.live` (staging Auth SMTP — the Resend keys are domain-scoped,
so staging is a genuinely separate registration, not a duplicate). Until a domain
is registered, Apple's relay refuses mail sent from it to a
`@privaterelay.appleid.com` member. Expect that rejection in the **Resend
delivery log** rather than as an application error — look there first, not at the
API or the invite token. Not yet observed either way: no mail has been sent to a
relay address from either domain.

**Observed sign-ins.** The provider rows in the Done / Not done table record
configuration, not a sign-in. What has been observed, per project and surface,
as of 2026-09-30:

| | `frapp-staging` | `frapp-prod` |
| --- | --- | --- |
| **Apple, web** | **Observed.** The owner reported "live round-trip OK on `app.staging.frapp.live`" on 2026-09-13 at 16:59Z ([#2120](https://github.com/pdcarlson/Frapp/issues/2120#issuecomment-5654699636), closed 2026-09-30). The one `apple` identity was linked about five minutes earlier, at 16:53:45Z. | **Not observed**: no `apple` identity. [#808](https://github.com/pdcarlson/Frapp/issues/808) row 4 owns the first one, on `app.frapp.live`. |
| **Apple, native iOS** | Not observed. | Not observed. [#2334](https://github.com/pdcarlson/Frapp/issues/2334) owns it, on the iOS build. |
| **Google** | **Reported, not confirmed by the database.** The owner reported Google "OK in a normal window" in the same 2026-09-13 comment, naming no host. A private-window attempt that day hit a Supabase callback `Gateway Timeout`, treated at the time as a transient flake. Separately, the one `google` identity was linked on 2026-09-10 at 19:03Z, from an unrecorded surface, and no session from that day remains. At 16:26Z on 2026-09-13 the owner still wrote that no Google round-trip had happened. | **Observed, surface unrecorded.** The one `google` identity was linked on 2026-09-15 at 04:37Z to an existing user, created on 2026-09-07 with an `email` identity. That user holds a live session with the `oauth` method, created 2026-09-17 at 20:07Z; Google is its only OAuth identity, so that is a Google sign-in. Nobody reported it, and whether it came from the web app or a mobile build isn't recorded. |

Neither project has a sign-in recorded as coming from a mobile build.

How to read that database evidence:

- An `auth.identities` row is written when GoTrue accepts the provider's
  callback. It proves the round-trip to the provider reached GoTrue, not that
  the member ended up signed in. A session proves a sign-in, but its method
  (`auth.mfa_amr_claims`) reads `oauth` for both providers, and signing out
  deletes it.
- A row's `last_sign_in_at` doesn't advance on later sign-ins, as far as staging
  shows. The staging user's OAuth sign-in on 2026-09-28 (session created
  21:58:09Z, method `oauth`, provider not recorded) left both OAuth identities'
  `last_sign_in_at` where they were. So the Google row's 09-10 timestamp can't be
  read as "no Google sign-in since".
- Both projects' Auth audit logs are empty, so there is no per-sign-in history.
  Staging's remaining OAuth sessions were created 2026-09-13 at 16:58:17Z (49 seconds
  before the owner's report), 2026-09-14 and 2026-09-28. All three belong to the
  one staging user that holds the `email`, `google` and `apple` identities, linked
  by Automatic linking (row above).

*Read 2026-09-30 through the Supabase MCP's `execute_sql`, aggregates and
timestamps only. On `frapp-staging`: `select provider, count(*),
min(created_at), max(created_at), max(last_sign_in_at) from auth.identities
group by provider`; each OAuth identity joined to `auth.users` for the user's
`created_at`, `last_sign_in_at` and other identities; `select s.created_at,
c.authentication_method from auth.sessions s join auth.mfa_amr_claims c on
c.session_id = s.id`; and `select count(*) from auth.audit_log_entries`. On
`frapp-prod`: `select provider, count(*), min(created_at) from auth.identities
where provider in ('google', 'apple') group by provider`, then the same user
join, sessions read (for the Google user only) and audit-log count.*

The earlier instruction not to assert that Apple is enabled is superseded by the
provider rows above. **Conformance should still wait on an observed sign-in** in
the project it checks, not on this section. Staging has one with each provider:
Apple on web, and Google by the owner's report. So a staging check of their
config can be written ([#2949](https://github.com/pdcarlson/Frapp/issues/2949)),
though the native-only Apple client ids (the bundle id and `host.exp.Exponent`)
are config no sign-in has exercised yet. `frapp-prod` has an observed Google
sign-in and no Apple one. Neither conformance script checks either provider
today.

*2026-09-30 ([#2945](https://github.com/pdcarlson/Frapp/issues/2945)): this
paragraph was headed "Not proven — and not only for Apple". It said no live
Apple sign-in had been run against either project and, from 2026-09-28, that no
Google sign-in had happened. The strongest Google evidence it cited was a
kickoff that returned 2xx on hosted Auth on 2026-09-10. The Apple sentence
predated the owner's 09-13 staging report. The Google one was inferred from the
Audience counter, and both projects' Auth databases disprove it.*

---
