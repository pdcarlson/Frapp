---
name: live-verification
description: >
  Verify a change against the deployed staging environment — the live web dashboard, landing
  site, API, and hosted Supabase — instead of only the local stack. Use when a claim needs the
  real deployment to settle it: live Realtime/Presence, RLS as GoTrue actually enforces it,
  a staging-only regression, or "is staging actually serving the new build". Staging web and
  landing custom domains are Vercel Authentication-gated (#1951), so they are not a walkthrough
  target yet. Also read it before pointing Playwright, `curl`, or a Supabase client at any
  `frapp.live` or `supabase.co` host from a sandbox.
---

# Live verification (deployed staging)

Use this skill when the local stack can't settle a question and deployed staging can. For
local-stack work, use [`testing`](../testing/SKILL.md). For provider state, use
[`infrastructure-research`](../infrastructure-research/SKILL.md). A sandbox can reach staging only
when the environment allowlist carries the live-egress lines
([`CLOUD_SANDBOX.md` § Live staging egress](../../../docs/internal/environment/CLOUD_SANDBOX.md#live-staging-egress)).
You're done when the claim is reported at the tier that actually ran ([Reporting](#reporting)).

CI deploys staging web and landing with `deploy-vercel-staging.yml` after CI passes on `main`. Once
that deploy finishes, staging serves the current build
([ADR-21](../../../spec/architecture/adr/adr-21.md)).

## The three rules

1. **Probe before you claim.** Egress is environment config, not a repo fact, and it can be off.
   Run the preflight.
2. **Staging only, never production.** This is a hard stop. The two share apex domains, and you
   can't take a request back.
3. **Read-only unless the task requires a write.** If it does, you own the cleanup.

## Preflight

Don't write your own probe. Read the manifest that bringup already wrote:

```bash
python3 -m json.tool .cloud-sandbox-capabilities.json
```

Read it even if no `EGRESS:` line showed up in your context. The SessionStart hook only summarises
the manifest in a cloud sandbox (it checks for the `/etc/frapp-cloud-sandbox` marker) and only if
the manifest already exists. On a fresh container's first session, it doesn't exist yet. If the
file is missing (on a laptop, or when bringup didn't run), generate it with
`bash scripts/cloud-sandbox-egress-probe.sh`.

Check `probe_ok` first. If it's `false`, the probe couldn't run, and the empty `hosts[]`,
`staging_reachable`, and `production_blocked_as_expected` arrays mean nothing. Re-run the probe. If
it still can't run, report the check as `blocked` and give the reason the manifest gives
(`python3` unavailable, no writable temp dir, or the builder failed). Don't blame the allowlist or
file a blocker against the environment. Nothing was probed.

With `probe_ok: true`, read each host's `status`:

| Manifest `status` | Meaning | Do |
| ----------------- | ------- | -- |
| `reachable` | The host answered with some HTTP code. The socket works, but the app may not have loaded. On staging web/landing, a 302 is usually [Vercel Authentication](#vercel-authentication). | Go on to the next gate. Don't claim the UI loaded. |
| `blocked` | The connection was refused (curl exit 56, 35, or 7). A host that's down looks the same as a policy denial. | Stop and report the host as not reachable. |
| `timeout` / `no_dns` / `unknown` | The probe couldn't tell. | Don't proceed, and don't report a block. Re-run the probe. If it's still inconclusive, say so in those words. |

The manifest's `blocked` status means a refused connection. The reporting tier `blocked` means a
check that couldn't run. A `probe_ok: false` manifest is the reporting kind, not the manifest kind.

Don't name a cause you haven't checked. "`api-staging` did not answer" is always a valid report.
"`api-staging` is not allowlisted" needs evidence that the line is missing. The proxy's own
`detail` reads `policy denial or upstream failure`. To see which hosts the proxy refused, check
`recentRelayFailures` in `curl -sS "$HTTPS_PROXY/__agentproxy/status"`. The manifest's `warnings`
array already has the right remedy wording.

A `SECURITY` warning means a production host answered. Stop everything and report it.

If egress really is off, you can't fix it. The allowlist is dashboard config, so it's a
human-only blocker. Name the missing line, quoting
[`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md#live-staging-egress), and
file it per [`file-follow-up`](../file-follow-up/SKILL.md). Don't fall back to the local stack and
report the check as done. `scripts/ci/staging-conformance.mjs` was written to stop that kind of
silent coverage loss.

## Never point at production

| Staging — allowed | Production — never |
| ----------------- | ------------------ |
| `staging.frapp.live` | `frapp.live` |
| `app.staging.frapp.live` | `app.frapp.live` / `www.frapp.live` |
| `api-staging.frapp.live` | `api.frapp.live` |
| `hnoyzpidbmizhbqaiity.supabase.co` | `unttyvyfezddlyafcydh.supabase.co` |

Read the hostname in every command before you run it.

Supabase refs are where mistakes happen, because neither ref says which project it is. Never type a
`supabase.co` host from memory or copy one from a doc. Resolve it from a source that names the
project:

- `mcp__Supabase__list_projects`.
- The `staging_supabase` entry in `.cloud-sandbox-capabilities.json`, which carries the label
  `frapp-staging Supabase`. This only works on a `probe_ok: true` manifest, because a degraded one
  has an empty `hosts[]`.

Don't take the host from `SUPABASE_URL` in `apps/*/.env.local`. In a sandbox, that holds the local
stack's URL (`http://127.0.0.1:54321`).

The allowlist carries the staging hosts and no production ones, so a typo fails closed. Don't rely on it: a mistyped `POST`
is your mistake, not the proxy's. If a task seems to require production, it doesn't. Stop and ask
the owner.

## Authentication

Egress only proves the socket works. Staging web and landing have two more gates. First, Vercel
Authentication sits in front of the hostname. Second, Signet/Supabase auth runs inside the app.
`api-staging.frapp.live` is on Render, so the Vercel gate doesn't apply to it.

### Vercel Authentication

Unauthenticated requests to `https://app.staging.frapp.live` and `https://staging.frapp.live`
return a 302 to `https://vercel.com/sso-api` (`Login – Vercel`), not the Signet app. That redirect
is Vercel Authentication. It isn't Password Protection and it isn't a Signet 401.

Both projects store `ssoProtection.deploymentType = all_except_custom_domains`. On this Hobby plan,
that setting still gates Preview deployments, and both staging hosts are Preview custom domains on
`gitBranch=main`. Only the Production custom domains are excepted. Unique Preview `*.vercel.app`
URLs are gated too, so they don't work around it.

Fixing this is a human task, tracked in [#1951](https://github.com/pdcarlson/Frapp/issues/1951).
Don't disable protection, generate a `protectionBypass`, or change the project's protection
settings. The Vercel MCP principal is on the team (`list_teams` shows it and `list_deployments`
works, checked 2026-09-22), so read deployment state through it. `get_access_to_vercel_url` mints a
share link that bypasses Vercel Authentication, so the rule above rules it out.
`web_fetch_vercel_url` returned 403 when the principal wasn't on the team, and hasn't been re-tested
since.

#1951 is done when `curl -I https://app.staging.frapp.live/sign-in` returns the Signet app instead
of `Login – Vercel`. Until then, these are all `blocked`, never passed:

- a correlated web+API walkthrough,
- a Playwright run against `https://app.staging.frapp.live`,
- a screenshot of "the deployed UI".

A preflight result of `reachable` with `http_code: 302` is this redirect.

### Staging smoke credentials

Authenticated Signet probes follow the convention in `scripts/ci/staging-conformance.mjs`:
`STAGING_SMOKE_USER_EMAIL` / `STAGING_SMOKE_USER_PASSWORD`, plus a staging project URL and anon key.
In CI, the smoke pair are GitHub Actions secrets (`.github/workflows/staging-conformance.yml`).
`SUPABASE_URL` / `SUPABASE_ANON_KEY` come from the Infisical step
([`SECRETS_MANAGEMENT.md`](../../../docs/internal/environment/SECRETS_MANAGEMENT.md)). Don't propose
adding those two as GitHub secrets.

In a sandbox, none of these are set. You can get the staging URL from the manifest. You can't get
the anon key or the smoke credentials. The smoke user is still an open human task,
[#893](https://github.com/pdcarlson/Frapp/issues/893). `[human]` is a title prefix there, not a
label. Report an authenticated staging check as `blocked` until you're told otherwise.

Never read staging values from bare `SUPABASE_URL` / `SUPABASE_ANON_KEY` in a sandbox, and never ask
for them to be set as sandbox env vars. Those names belong to the local stack there. Bringup writes
them into `apps/api/.env.local`, and `ConfigModule.forRoot` in `apps/api/src/app.module.ts` lets
`process.env` override that file. An exported `SUPABASE_URL` would repoint the local API. If you
need a staging credential in a sandbox:

- Give it a name no app-boot path reads, such as one with a `STAGING_` prefix.
- Pass it explicitly to the check.
- If it's provisioned as an environment variable, register it in
  [`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md). None exists there today.

Rules for credentials:

- Use the dedicated smoke account, never a real member's credentials.
- Don't use a service-role key for a check an anon or authenticated key can do. An RLS check has to
  run as the constrained role to mean anything.
- Never commit any of it. The pre-commit gitleaks scan catches JWTs. It has no `*.supabase.co` rule,
  so it won't catch a pasted config block.

## What live staging is good for

- **Realtime and Presence** as the hosted stack negotiates them. Local Supabase doesn't reproduce
  the hosted WebSocket path. Pair this with [`realtime-resilience`](../realtime-resilience/SKILL.md).
- **RLS with a real GoTrue-minted JWT.** `npm run check:pglite-migrations` already tests policy
  enforcement black-box for `chat_messages`, `chat_message_actions`, `members`, and
  `financial_invoices`, with `auth.uid()`/`auth.role()` stubbed, so a wrong predicate on those
  tables is settled locally. You need staging only for claims beyond `sub`/`role` (including
  `custom_access_token_hook` output) and for `TO anon` targeting, because PGlite has no `anon`
  role. Read that job's output before you decide you need staging.
- **Whether `custom_access_token_hook` is actually enabled.** This has drifted unnoticed before.
- **Which commit staging serves.**
  - API: read the `commit` field of `GET https://api-staging.frapp.live/health`.
  - Web and landing: read the aliased deployment through the Vercel MCP or REST. The custom
    domains return the Vercel Authentication page, not the bundle.
  - For alias lag, see [`vercel.md`](../../../docs/internal/ops/deployment/vercel.md).
    Per-deployment `*.vercel.app` URLs aren't allowlisted.

### Playwright against the deployed UI

`apps/web/playwright.config.ts` honours `PLAYWRIGHT_BASE_URL`, and skips the local `webServer`
when it's set:

```bash
PLAYWRIGHT_BASE_URL=https://app.staging.frapp.live npm run test:floor -w apps/web
```

Until #1951 is fixed, this run loads `Login – Vercel`. Even after that, an unauthenticated run
measures no dashboard route:

- With an external base URL, `SUPABASE_AUTH_BYPASS` is never applied.
- Every route in `PROTECTED_ROUTE_PREFIXES` redirects to `/sign-in?redirectTo=%2F…`.
- `toHaveURL` is the first assertion in `responsive-floor.spec.ts`, so every floor test fails
  there.
- The pre-auth tests still pass. A partly green run doesn't show that any dashboard route was
  measured.

Don't loosen that assertion to make the run pass. The sign-in card holds 375px, so without the
assertion the suite would pass without ever rendering the dashboard.

Don't read the red run as a result either. An unauthenticated run, a regressed redirect, an
expired session, and the SSO wall all fail the same way. Check the URL each test landed on.

The 375px gate is the local `web-responsive-floor` run, and a staging run doesn't replace it. No
pixel-baseline suite exists any more ([`QUALITY_GATES.md`](../../../docs/internal/ci-cd/QUALITY_GATES.md)).

## Writes and cleanup

Default to read-only: `GET`, `HEAD`, sign-in, subscribe-and-observe.

Before a write, know three things: what you'll create, how you'll find it again, and how you'll
remove it. Prefer the smoke account's own chapter and data.

Clean up in the same session. Staging is shared, and your leftover rows become the next session's
confusing failure. If cleanup fails, say so and name what was left behind.

Never run a destructive or schema-changing operation against hosted staging. Migrations are
validated on PGlite and the local stack. Schema changes reach staging only through
[`DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md), never from an agent
session.

## What this does not cover

- **Push fanout (APNS/FCM).** APNS is unreachable from a sandbox. FCM's endpoint is reachable, but
  delivery needs service-account credentials and a real device token, so don't report FCM as
  network-blocked. End-to-end push stays under the "Runtime checks BLOCKED" protocol in
  [`AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md).
- **Provider APIs (Render, Vercel, Sentry, PostHog).** Direct `fetch` is blocked. Reach them
  through MCP, which bypasses the allowlist, per
  [`infrastructure-research`](../infrastructure-research/SKILL.md).
  - The bare `vercel.com` allowlist line is unexplained drift, not a sanctioned path
    ([`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md#whats-configured-in-the-web-ui)).
  - Infisical is the exception. It has no MCP connector, so reach it by direct `fetch` to
    `app.infisical.com` ([#1279](https://github.com/pdcarlson/Frapp/issues/1279)). Without that
    allowlist line, report Infisical state as unverified.
- **Production**, in any form.

## Reporting

In a PR body or issue comment, name the tier that actually ran. These are three different claims:

- `verified locally` — local stack / PGlite / Jest
- `verified against staging` — deployed staging, egress confirmed by preflight
- `blocked` — could not run, with the reason and the missing piece named

Never write the second when you did the first, and never write either for a check that couldn't
run. Blurring the tiers is how staging drift goes unnoticed. For example:

```text
RLS on chat_messages: verified locally (check:pglite-migrations).
Hook claim via real JWT: blocked — no staging smoke credential in the sandbox (#893).
```
