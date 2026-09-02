---
name: live-verification
description: >
  Verify a change against the deployed staging environment — the live web dashboard, landing
  site, API, and hosted Supabase — instead of only the local stack. Use when a claim needs the
  real deployment to settle it: live Realtime/Presence, RLS as GoTrue actually enforces it,
  a staging-only regression, "is staging actually serving the new build", or a visual check
  against the deployed UI. Also read it before pointing Playwright, `curl`, or a Supabase
  client at any `frapp.live` or `supabase.co` host from a sandbox.
---

# Live verification (deployed staging)

> Use when the local stack cannot settle the question and the deployed staging environment can.
> Local-stack work: [`testing`](../testing/SKILL.md). Provider runtime truth via MCP:
> [`infrastructure-research`](../infrastructure-research/SKILL.md).

> **2026-09-02 — the web and landing staging hosts are frozen; the API and Supabase halves are
> not.** Both Vercel projects were unlinked from Git (`frapp-landing` 2026-09-01, `frapp-web`
> 2026-09-02), so **nothing deploys staging web or landing on merge**: those hosts still serve
> their last Git builds — landing `2bf143b`, web `0372c6d` — until the CI-driven replacement in
> [#1578](https://github.com/pdcarlson/Frapp/issues/1578) lands. A web or landing check against
> staging therefore tests an **old build**, not your change, so it can neither confirm nor refute
> a claim about a commit merged since. The **API (Render staging) and hosted Supabase** halves of
> this skill are unaffected and remain the reason to use it. Canonical record: **ADR-21** in
> [`spec/architecture/README.md`](../../../spec/architecture/README.md); the failing verify jobs
> are [#1579](https://github.com/pdcarlson/Frapp/issues/1579).

Sandbox sessions can reach **deployed staging** when the cloud environment's network
allowlist carries the live-egress lines
([`CLOUD_SANDBOX.md` § Live staging egress](../../../docs/internal/environment/CLOUD_SANDBOX.md#live-staging-egress)).
That is a real capability and a real blast radius. This skill is the posture for using it.

## The three rules

1. **Probe before you claim.** Egress is environment config, not a repo fact. It can be
   absent, and this file cannot tell you. Run the preflight.
2. **Staging only. Never production.** Not as a preference — as a hard stop.
3. **Read-only unless the task requires a write.** Then own the cleanup.

## 1. Preflight — is egress actually on?

**Read the manifest; do not hand-roll a probe.** Bringup already answered this and wrote
it down:

```bash
python3 -m json.tool .cloud-sandbox-capabilities.json
```

Run it — do not wait for the summary. The SessionStart hook does summarise the manifest into
your context, but only in a **cloud sandbox** (it is gated on the `/etc/frapp-cloud-sandbox`
marker, so on a laptop it never fires however many manifests are on disk), and only on a fire
that finds the manifest already written — which a **fresh container's first session** never
is, because that same hook is what launches bringup about a second before the probe writes. **No `EGRESS:` line in your context is
not evidence the probe did not run.** If the file is genuinely missing (laptop session, or bringup did not run),
generate it: `bash scripts/cloud-sandbox-egress-probe.sh`.

| Manifest `status` | Meaning | Do |
| ----------------- | ------- | -- |
| `reachable` | the host answered (any HTTP code — `302` and `404` are normal here) | Proceed |
| `blocked` | proxy refused CONNECT — host not allowlisted | Stop. Report as environment config (below) |
| `timeout` / `no_dns` / `unknown` | the probe **could not tell** | Neither proceed nor report a block. Re-run the probe; if it stays inconclusive, say so in those words |

That last row is the one that gets misread. An inconclusive probe is not a block, and
reporting it as one sends the owner to edit an allowlist that was never the problem.

Two things the manifest gives you that a bare `curl` does not: the `warnings` array already
carries the correct remedy wording, and a `SECURITY` warning means a **production** host
answered — treat that as a stop-everything finding, not as extra capability.
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` remains ground truth for which host the proxy
refused, under `recentRelayFailures`.

When egress is off, that is a **human-only blocker** — an allowlist is dashboard config, not
something an agent can work around. Say exactly which line is missing, quoting
[`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md#live-staging-egress),
and file it per [`file-follow-up`](../file-follow-up/SKILL.md). Do not silently fall back to
the local stack and report the check as done — that is the silent-coverage failure
`scripts/ci/staging-conformance.mjs` was written to stop. A check that could not run is
**blocked**, never **passed**.

## 2. Never point at production

Production and staging share an apex on **both** domains:

| Staging — allowed | Production — **never** |
| ----------------- | ---------------------- |
| `staging.frapp.live` | `frapp.live` |
| `app.staging.frapp.live` | `app.frapp.live` / `www.frapp.live` |
| `api-staging.frapp.live` | `api.frapp.live` |
| `hnoyzpidbmizhbqaiity.supabase.co` | `unttyvyfezddlyafcydh.supabase.co` |

Before any command carrying a hostname, read the hostname. `api.frapp.live` and
`api-staging.frapp.live` differ by nine characters and by every consequence.

The Supabase row is the dangerous one: **nothing in either ref says which is which.** Never
type a `supabase.co` host from memory or from a doc. Resolve it from one of the two sources
that *name* the project: `mcp__Supabase__list_projects`, or the `staging_supabase` entry in
`.cloud-sandbox-capabilities.json`, which carries the label `frapp-staging Supabase`
alongside the URL. Do **not** reach for `SUPABASE_URL` in `apps/*/.env.local` — in a cloud
sandbox bringup writes the *local* stack there (`http://127.0.0.1:54321`), so it answers a
different question than the one you are asking. If you cannot say out loud which project a
ref belongs to, you do not yet know enough to send it a request.

The allowlist is a backstop that should never be the thing that catches you — it enumerates
staging hosts precisely so a typo fails closed rather than reaching prod, but a `POST` you
meant for staging is your responsibility before it is the proxy's.

If a task appears to *require* production, it does not. Stop and ask the owner.

## 3. Authentication

Egress alone gets an unauthenticated socket. Authenticated probes use the staging smoke
account convention already established by `scripts/ci/staging-conformance.mjs`:
`STAGING_SMOKE_USER_EMAIL` / `STAGING_SMOKE_USER_PASSWORD`, plus a staging project URL and
anon key. In CI those come from two different places — the smoke pair are GitHub Actions
secrets (`.github/workflows/staging-conformance.yml`), while `SUPABASE_URL` /
`SUPABASE_ANON_KEY` are injected by the Infisical step, per
[`SECRETS_MANAGEMENT.md`](../../../docs/internal/environment/SECRETS_MANAGEMENT.md). Do not
propose adding the latter as GitHub secrets; they are already stored once, in Infisical.

**In a sandbox, none of it is set.** The staging *URL* you can get from the manifest (above);
the anon key and the smoke credentials you cannot, and the smoke user itself is still the
open human-action ask in **#893** (the `[human]` there is a title prefix, not a label — do
not search for it as one). So treat an authenticated staging check as **blocked**, never
passed, until told otherwise.

**Do not read the URL and key from bare `SUPABASE_URL` / `SUPABASE_ANON_KEY` in a sandbox,
and never ask for them to be set as sandbox environment variables.** `staging-conformance.mjs`
reads those names because it runs in **CI**, where nothing else is competing for them. In a
sandbox they are the *local* stack's names: bringup writes them into `apps/api/.env.local`,
and `ConfigModule.forRoot({ envFilePath: [...] })` in `apps/api/src/app.module.ts` merges
`{ ...envFile, ...process.env }` — so a real environment variable of that name **wins over
the file**, repointing `supabase.provider.ts` at whatever host was exported. The rule: a
sandbox-side staging credential must use a name **no app-boot path reads** — a `STAGING_`
prefix is the obvious shape — and be passed explicitly to the check that needs it. If such
a variable is ever provisioned it belongs in
[`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md), which is the
single source of truth for env var names; none exists there today.

Rules: use the dedicated smoke account, never a real member's credentials. Never use a
service-role key for a check an anon or authenticated key can perform — the point of an
RLS check is that it runs *as* a constrained role. Never commit any of it. `.env.local` is
gitignored and the pre-commit **gitleaks** scan catches JWT material as a backstop — but it has no
`*.supabase.co` rule, so do not treat "the hook would have caught it" as coverage for a pasted
config block.

If the credential is absent, that is the same **blocked, not passed** outcome as §1.

## 4. What live staging is good for

The cases where it beats the local stack:

- **Realtime / Presence as the hosted stack negotiates it** — local Supabase does not
  reproduce the hosted WebSocket path. Pair with [`realtime-resilience`](../realtime-resilience/SKILL.md).
- **RLS as GoTrue enforces it**, with a real JWT and a real role. The PGlite tier
  (`npm run check:pglite-migrations`) asserts policy *presence and shape*; only hosted
  staging asserts *enforcement*.
- **`custom_access_token_hook` actually being enabled** — the exact drift class that went
  unnoticed in #805.
- **Is staging serving this commit** — **for the API (Render staging) only.** Since the
  2026-09-02 fence above, staging web and landing are frozen at a fixed build that no merge
  advances, so the Vercel alias lag described in
  [`DEPLOYMENT.md`](../../../docs/internal/ops/DEPLOYMENT.md) is no longer observable here —
  those hosts always serve an old commit, and finding that they do proves nothing about yours.

### Playwright against the deployed UI

`apps/web/playwright.config.ts` already honours `PLAYWRIGHT_BASE_URL`; setting it skips the
local `webServer` entirely. No code change needed:

```bash
PLAYWRIGHT_BASE_URL=https://app.staging.frapp.live npm run test:floor -w apps/web
```

**Unauthenticated, this run measures no dashboard route — every `responsive-floor.spec.ts` test
aborts before the floor is read.** (That spec is one test per `DASHBOARD_ROUTES` entry in
`apps/web/tests/visual/routes.ts`; count them there, not here. `test:floor` runs the whole
`tests/visual/` directory, so the pre-auth suite's handful of tests still run and pass —
a partially-green run is not evidence any dashboard route was measured.)
With an external `PLAYWRIGHT_BASE_URL` the config skips `webServer`, so `SUPABASE_AUTH_BYPASS`
is never applied. Every dashboard route is in `PROTECTED_ROUTE_PREFIXES`, so each redirects to
`/sign-in?redirectTo=%2F…` (`URLSearchParams.set` percent-encodes the slash, so the spec's
`toHaveURL` regex cannot match). `toHaveURL` is the **first** assertion in
`responsive-floor.spec.ts`, ahead of the `<main>` visibility check and the `scrollWidth`
evaluate — so every test stops there and not one route is measured.

That guard is doing its job: the sign-in card holds 375px unconditionally, so without it the
whole suite would go *green* having never rendered the dashboard shell. Never "fix" that assertion
to make a run pass — converting a false green into an honest red is the whole reason it exists.

**But do not invert it into a verification.** A wall of red `toHaveURL` failures tells you only
that you did not reach the dashboard. That is exactly what an unauthenticated run looks like,
and also what a genuinely regressed staging redirect, an expired session, or a Vercel SSO wall
looks like — so the result distinguishes none of them, and it is never evidence the deployed
pages hold 375px. Read the URL each test actually landed on before concluding anything.

§3 notes no staging credential is provisioned today, so in practice pointing this suite at
staging measures zero protected routes. Until that changes, treat it as a reachability probe,
not a floor check: **the 375px gate is the local `web-responsive-floor` run, and a staging run
is not a substitute for it.** For a visual read on deployed staging, take a screenshot and look
at it.

There is no pixel-baseline suite to point at staging any more — `web-visual-regression`,
its spec and its committed PNGs were deleted (see
[`QUALITY_GATES.md`](../../../docs/internal/ci-cd/QUALITY_GATES.md)). For a visual check
against deployed staging, take a screenshot and look at it — but per the 2026-09-02 fence at the
top of this file, that screenshot shows the **frozen** web/landing build, not your commit, so it
reads the deployed UI's current state and never verifies a change you merged.

## 5. Writes and cleanup

Default to read-only: `GET`, `HEAD`, sign-in, subscribe-and-observe.

When a check genuinely needs a write, before issuing it: know what you are creating, how
you will identify it later, and how you will remove it. Prefer the smoke account's own
chapter and data. Clean up in the same session — staging is shared, and a session's leftover
rows become the next session's confusing failure. If cleanup fails, say so explicitly and
name what was left behind; silently orphaning test data is worse than the original gap.

Never run a destructive or schema-changing operation against hosted staging to "test" it.
Migrations validate on PGlite and on the local stack. Schema changes reach staging through
the promotion flow in [`DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md),
not from an agent session.

## 6. What this does not cover

- **Push fanout (APNS/FCM)** — unreachable from any sandbox, not allowlisted, not proposed
  for it. Still the "Runtime checks BLOCKED" protocol in
  [`AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md).
- **Provider APIs** (Render, Vercel, Sentry, PostHog) — blocked to direct
  `fetch`, reached via **MCP**, which does not go through the network allowlist at all. Use
  [`infrastructure-research`](../infrastructure-research/SKILL.md). Exception: **Infisical
  has no MCP connector** — it is reached by direct `fetch` via the allowlisted
  `app.infisical.com` instead ([#1279](https://github.com/pdcarlson/Frapp/issues/1279)); in
  an environment without that allowlist line, report Infisical state as unverified.
- **Production**, in every form.

## 7. Reporting

In a PR body or issue comment, state which tier actually ran. These are three different
claims and collapsing them is how #696 and #805 stayed invisible:

- `verified locally` — local stack / PGlite / Jest
- `verified against staging` — deployed staging, egress confirmed by preflight
- `blocked` — could not run, with the reason and the missing piece named

Never write the second when you did the first.
