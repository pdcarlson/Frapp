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

| Setting | `frapp-prod` (read 2026-09-07) | `frapp-staging` (read 2026-09-07) |
| --- | --- | --- |
| Site URL | `https://app.frapp.live` | `https://app.staging.frapp.live` |
| Redirect allow list | `https://app.frapp.live`, `https://api.frapp.live`, **`frapp://**`**, **`https://app.frapp.live/**`** | `https://app.staging.frapp.live`, `https://api-staging.frapp.live`, `exp://localhost:8081`, **`frapp://**`**, **`https://app.staging.frapp.live/**`** |
| Email confirmations | required (`mailer_autoconfirm: false`) | required |
| Custom SMTP | **none** (still hosted 2/hour; #1824) | **on** — Resend `smtp.resend.com:465`, From `Signet <no-reply@mail.staging.frapp.live>` (read 2026-09-08) |
| Auth email rate limit | **2 per hour** | **300 per hour** (read 2026-09-08; asserted daily as `auth-smtp`) |
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

**Custom SMTP is proven on staging, not on production.** Staging Auth SMTP is Resend
(`smtp.resend.com:465`, sender `Signet <no-reply@mail.staging.frapp.live>` as of 2026-09-08),
`rate_limit_email_sent` is 300/hour, and `_dmarc.frapp.live` is `v=DMARC1; p=none;`.
`staging-conformance.mjs` asserts the host, that live From, `smtp_sender_name=Signet`, and the send cap daily (`auth-smtp`)
so a revert to the hosted 2/hour mailer, a leftover Frapp sender, or the burned apex From cannot sit green.
It also asserts the Magic Link subject and `token_hash` href daily (`auth-magic-link`) so a
dashboard reset to `{{ .ConfirmationURL }}` cannot sit green.
Production Auth is still the hosted 2/hour cap. The 07:45
`production-auth-conformance.yml` watchdog skip-asserts that: empty SMTP is
SKIPPED (the job stays green). Once SMTP is on, the same check requires
`Signet <no-reply@mail.frapp.live>` at ≥300/hour and fails a burned apex From.
The same watchdog skip-asserts the Magic Link template: ConfirmationURL is
SKIPPED while SMTP is unset. Once SMTP is on, the href must carry
`token_hash` + `type=magiclink` or the 07:45 job fails.
Turning SMTP on is still human work (#1824).

The Magic Link *href* on staging is `app.staging.frapp.live/auth/callback`
(`token_hash`, #1916). Gmail trained the apex From `invites@frapp.live` on the first
generic hosted templates, so sending now uses mail subdomains (Resend domains
`mail.staging.frapp.live` and `mail.frapp.live`, created 2026-09-08, tracking off)
and staging tests cannot burn production reputation. Do not send From the apex:

- Staging Auth: `Signet <no-reply@mail.staging.frapp.live>`
- Prod Auth (when enabled): `Signet <no-reply@mail.frapp.live>`
- API invite default: `Signet <invites@mail.frapp.live>` (staging API sets
  `RESEND_FROM_EMAIL` to `Signet <invites@mail.staging.frapp.live>`)

Leave the existing `frapp.live` Resend domain in place until nothing uses it.

The Magic Link template (already on staging; same body on prod when SMTP is enabled):

Subject: `Sign in to Signet`

Body: `<h2>Sign in to Signet</h2><p>Use this one-time link to sign in. It expires soon.</p><p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink">Sign in to Signet</a></p><p>If you did not ask to sign in, you can ignore this email.</p>`

Paste this only on the **Magic Link** template. Confirm signup / invite / recovery keep their
own `type` (`signup`, `invite`, `recovery`) — copying this body onto those breaks them.
Do **not** paste that on a host whose web deploy does not yet include the `token_hash` handler.
Leave Resend open/click tracking off (single-use links). Production SMTP uses the prod
mail subdomain From above, then 300/hour — dashboard-only; do not put the key in Slack
or git. `RESEND_API_KEY` on Render is a separate invite-mail path and is still absent
on both API services.

---
