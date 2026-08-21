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

The SessionStart hook also summarises it into your context, so you may already have the
answer without running anything. If the file is missing (laptop session, or bringup did not
run), generate it: `bash scripts/cloud-sandbox-egress-probe.sh`.

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
type a `supabase.co` host from memory or from a doc — resolve it from the environment
(`SUPABASE_URL` in `apps/*/.env.local`) or from `mcp__Supabase__list_projects`, where the
project is *named*. If you cannot say out loud which project a ref belongs to, you do not
yet know enough to send it a request.

The allowlist is a backstop that should never be the thing that catches you — it enumerates
staging hosts precisely so a typo fails closed rather than reaching prod, but a `POST` you
meant for staging is your responsibility before it is the proxy's.

If a task appears to *require* production, it does not. Stop and ask the owner.

## 3. Authentication

Egress alone gets an unauthenticated socket. Authenticated probes use the staging smoke
account convention already established by `scripts/ci/staging-conformance.mjs`:

- `STAGING_SMOKE_USER_EMAIL` / `STAGING_SMOKE_USER_PASSWORD`
- Hosted staging Supabase via `SUPABASE_URL` + `SUPABASE_ANON_KEY`

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
- **Is staging serving this commit** — the Vercel alias lag documented in
  [`DEPLOYMENT.md`](../../../docs/internal/ops/DEPLOYMENT.md) is directly observable here.

### Playwright against the deployed UI

`apps/web/playwright.config.ts` already honours `PLAYWRIGHT_BASE_URL`; setting it skips the
local `webServer` entirely. No code change needed:

```bash
PLAYWRIGHT_BASE_URL=https://app.staging.frapp.live npm run test:visual -w apps/web
```

**A green run here can mean nothing was tested.** With an external `PLAYWRIGHT_BASE_URL`
the config skips `webServer`, so `SUPABASE_AUTH_BYPASS` is never applied. Unauthenticated,
every protected route redirects to `/sign-in` — and as
`apps/web/tests/visual/responsive-floor.spec.ts` puts it, that page's "centred card holds
375px unconditionally — and all fifteen tests go green having never rendered the dashboard
shell at all." The floor suite asserts `toHaveURL` to catch exactly this; the snapshot suite
(`test:visual`) does not. So before believing any staging run:

- Confirm you are **authenticated** (§3), or restrict the run to genuinely public routes.
- Confirm the **route under test actually rendered** — assert the URL, or eyeball a
  screenshot. "Exit code 0" is not evidence here.

Then treat the pixels with care too: committed baselines were captured against the local dev
server (`tests/visual/**-snapshots/*-linux.png`), so diffs against deployed staging are
expected and are **not** by themselves a regression — different fonts, real data, real
latency. Use this mode to answer "does the deployed page work / render / not throw", keep
`npm run test:visual -w apps/web` on its local baseline as the actual gate, and never
refresh a baseline from a staging run.

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
- **Provider APIs** (Render, Vercel, Infisical, Sentry, PostHog) — blocked to direct
  `fetch`, reached via **MCP**, which does not go through the network allowlist at all. Use
  [`infrastructure-research`](../infrastructure-research/SKILL.md).
- **Production**, in every form.

## 7. Reporting

In a PR body or issue comment, state which tier actually ran. These are three different
claims and collapsing them is how #696 and #805 stayed invisible:

- `verified locally` — local stack / PGlite / Jest
- `verified against staging` — deployed staging, egress confirmed by preflight
- `blocked` — could not run, with the reason and the missing piece named

Never write the second when you did the first.
