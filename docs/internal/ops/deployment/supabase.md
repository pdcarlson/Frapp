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

Because production SMTP is now on, the 07:45 `production-auth-conformance.yml`
watchdog no longer skip-asserts an empty host. Empty SMTP is still SKIPPED *if* the
host is empty; with SMTP on, the same check requires
`Frapp <no-reply@mail.frapp.live>` at ≥300/hour and fails a burned apex From. Magic
Link is the same: ConfirmationURL is SKIPPED only while SMTP is unset; with SMTP on,
the href must carry `token_hash` + `type=magiclink` or the 07:45 job fails. The
Magic Link body is now on prod; confirm and invite were intentionally left uncopied.

The Magic Link *href* on staging is `app.staging.frapp.live/auth/callback`
(`token_hash`, #1916). Gmail trained the apex From `invites@frapp.live` on the first
generic hosted templates, so sending now uses mail subdomains (Resend domains
`mail.staging.frapp.live` and `mail.frapp.live`, created 2026-09-08, tracking off)
and staging tests cannot burn production reputation. Do not send From the apex. These
are the senders [ADR-25 step 3](#adr-25-step-3-the-sender-becomes-frapp) sets. Each
console, and `RESEND_FROM_EMAIL` wherever it is set, still says `Signet` until the owner
makes that change (the table above has the last read, 2026-09-09):

- Staging Auth: `Frapp <no-reply@mail.staging.frapp.live>`
- Prod Auth: `Frapp <no-reply@mail.frapp.live>`
- API invite default: `Frapp <invites@mail.frapp.live>`, with staging's
  `RESEND_FROM_EMAIL` set to `Frapp <invites@mail.staging.frapp.live>`

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
more than 24 hours after 2026-09-24 19:00 UTC:

1. **Staging.** Just before merging, set Infisical `staging` `RESEND_FROM_EMAIL` to
   `Frapp <invites@mail.staging.frapp.live>`. The API reads it only at boot, so the merge's
   staging deploy is what picks it up. Once that deploy is live, in `frapp-staging` →
   Authentication: SMTP Settings → Sender name `Frapp`; Email Templates → Magic Link → the
   subject above, and the body above pasted whole (it keeps the `token_hash` href); any
   other template subject that says Signet.
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

Observation 2026-09-10 for the Google rows, **2026-09-13 for the Apple rows** (owner confirmation, **names only**; values not opened — the Apple rows were recorded while the owner drove the consoles). Secrets stay in the Google Cloud / Apple / Supabase dashboards. Dashboard-only: did **not** Deploy. Tracker: #2120.

| Item | State |
| --- | --- |
| Google Cloud OAuth 2.0 **Web** client (JS origins `https://app.frapp.live`, `https://app.staging.frapp.live`; redirect URIs the two hosted `/auth/v1/callback` URLs; client id + secret pasted into each project's Google provider) | **Done** |
| Google provider enabled on hosted `frapp-staging` and `frapp-prod` | **Done** |
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
   consent sheet, so it reads `Signet`, not an internal label. Saving is four
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

**Not proven — and not only for Apple.** The strongest evidence ever recorded for
**Google** is that kickoff can 2xx on hosted Auth (2026-09-10): a redirect the
provider accepted, *not* a completed round-trip. The Google rows above should not
be read as a proven sign-in either. For Apple it is weaker still — no live Apple
sign-in has been run against either project. The
provider is enabled and configured; that is not the same as a verified
round-trip on web or native iOS, and this table is not evidence of one. The
earlier instruction not to assert that Apple is enabled is superseded by the
rows above, but **conformance should still wait on an observed sign-in**, not on
this section.

---
