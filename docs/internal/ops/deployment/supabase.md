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

### Collect Keys

From each project's dashboard → Settings → API, note:

| Key                         | Where it goes                                                  |
| --------------------------- | -------------------------------------------------------------- |
| **Project URL**             | `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`                    |
| **anon public key**         | `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`          |
| **service_role secret key** | `SUPABASE_SERVICE_ROLE_KEY` (API only, never expose to client) |

### Auth settings (hosted, dashboard or Management API)

These live on the project, not in this repo, so they are recorded here with the date they were
read. Read them back with `GET https://api.supabase.com/v1/projects/<ref>/config/auth` (a
`SUPABASE_ACCESS_TOKEN` is enough); write with `PATCH` on the same path, or in the dashboard under
Authentication → URL Configuration / SMTP Settings.

| Setting | `frapp-prod` | `frapp-staging` |
| --- | --- | --- |
| Site URL | `https://app.frapp.live` (read 2026-09-07) | `https://app.staging.frapp.live` (read 2026-09-07) |
| Redirect allow list | `https://app.frapp.live`, `https://api.frapp.live`, **`frapp://**`**, **`https://app.frapp.live/**`** (read 2026-09-07) | `https://app.staging.frapp.live`, `https://api-staging.frapp.live`, `exp://localhost:8081`, **`frapp://**`**, **`https://app.staging.frapp.live/**`** (read 2026-09-07) |
| Email confirmations | required (`mailer_autoconfirm: false`) | required |
| Custom SMTP | **on** — Resend `smtp.resend.com:465`, user `resend`, From `Signet <no-reply@mail.frapp.live>` (owner send proof 2026-09-09 ~23:07Z from `https://app.frapp.live`) | **on** — Resend `smtp.resend.com:465`, From `Signet <no-reply@mail.staging.frapp.live>` (owner send proof 2026-09-09 from `https://app.staging.frapp.live`) |
| Auth email rate limit | **300 per hour** (owner dashboard toast 2026-09-09) | **300 per hour** (owner dashboard 2026-09-09; asserted daily as `auth-smtp`) |
| Password minimum length | 6 | 6 |
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

`staging-conformance.mjs` asserts the host, that live From, `smtp_sender_name=Signet`,
and the send cap daily (`auth-smtp`) so a revert to the hosted 2/hour mailer, a leftover
Frapp sender, or the burned apex From cannot sit green. It also asserts the Magic Link
subject and `token_hash` href daily (`auth-magic-link`) so a dashboard reset to
`{{ .ConfirmationURL }}` cannot sit green.

Because production SMTP is now on, the 07:45 `production-auth-conformance.yml`
watchdog no longer skip-asserts an empty host. Empty SMTP is still SKIPPED *if* the
host is empty; with SMTP on, the same check requires
`Signet <no-reply@mail.frapp.live>` at ≥300/hour and fails a burned apex From. Magic
Link is the same: ConfirmationURL is SKIPPED only while SMTP is unset; with SMTP on,
the href must carry `token_hash` + `type=magiclink` or the 07:45 job fails. The
Magic Link body is now on prod; confirm and invite were intentionally left uncopied.

The Magic Link *href* on staging is `app.staging.frapp.live/auth/callback`
(`token_hash`, #1916). Gmail trained the apex From `invites@frapp.live` on the first
generic hosted templates, so sending now uses mail subdomains (Resend domains
`mail.staging.frapp.live` and `mail.frapp.live`, created 2026-09-08, tracking off)
and staging tests cannot burn production reputation. Do not send From the apex:

- Staging Auth: `Signet <no-reply@mail.staging.frapp.live>`
- Prod Auth: `Signet <no-reply@mail.frapp.live>`
- API invite default: `Signet <invites@mail.frapp.live>` (staging API sets
  `RESEND_FROM_EMAIL` to `Signet <invites@mail.staging.frapp.live>`)

Leave the existing `frapp.live` Resend domain in place until nothing uses it.

The Magic Link template (on staging and prod as of 2026-09-09; confirm and invite
were **intentionally not copied**):

Subject: `Sign in to Signet`

Body: `<h2>Sign in to Signet</h2><p>Use this one-time link to sign in. It expires soon.</p><p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink">Sign in to Signet</a></p><p>If you did not ask to sign in, you can ignore this email.</p>`

Paste this only on the **Magic Link** template. Confirm signup / invite / recovery keep their
own `type` (`signup`, `invite`, `recovery`) — copying this body onto those breaks them.
Do **not** paste that on a host whose web deploy does not yet include the `token_hash` handler.
Leave Resend open/click tracking off (single-use links). Production SMTP uses the prod
mail subdomain From above, then 300/hour — dashboard-only; do not put the key in Slack
or git. Auth SMTP itself is proven on staging and production.

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

Observation 2026-09-10 (owner confirmation, **names only**; values not opened). Secrets stay in the Google Cloud / Supabase dashboards. Did **not** Deploy. Tracker: #2120.

| Item | State |
| --- | --- |
| Google Cloud OAuth 2.0 **Web** client (JS origins `https://app.frapp.live`, `https://app.staging.frapp.live`; redirect URIs the two hosted `/auth/v1/callback` URLs; client id + secret pasted into each project's Google provider) | **Done** |
| Google provider enabled on hosted `frapp-staging` and `frapp-prod` | **Done** |
| Automatic linking | **On** (a later Google/Apple identity can attach to an existing email/password or magic-link user; do not merge `public.users` rows — unique on `supabase_auth_id` only) |
| Skip nonce (Google provider) | **Off** |
| Allow users without email | **Off** |
| Magic Link templates | **Untouched** — do not change them |
| Apple Developer: App ID `live.frapp.mobile` + Sign in with Apple; Services ID; `.p8` uploaded in each project's Apple provider (key id, team id, Services ID) | **Not done** — remaining human work on #2120 |
| Custom Auth domain | **Later** — #2125 |
| Native Google iOS/Android OAuth clients | **Later** — #2126. Mobile Google uses this Web client through the browser auth session. |

**Remaining human console steps (Apple; names only; no secrets):**

1. Apple Developer:
   - App ID `live.frapp.mobile` → enable **Sign in with Apple**
   - Services ID (web) with Return URL `https://<project-ref>.supabase.co/auth/v1/callback` for each hosted project
   - Key with Sign in with Apple enabled; upload the `.p8` in the Supabase Apple provider (key id, team id, Services ID). Native SIWA uses the app's bundle id; web/browser fallback uses the Services ID.
2. Confirm the redirect allow list still includes `https://app.frapp.live/**`, `https://app.staging.frapp.live/**`, and `frapp://**`.
3. Do not add failing conformance that **Apple** is enabled until that list is done. Google kickoff can 2xx on hosted Auth now; Apple still maps to “This sign-in method isn't available yet.”

---
