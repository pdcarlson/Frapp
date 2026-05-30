# Claude Code cloud sandbox (primary dev environment)

**Claude Code web sessions are the primary way Frapp is developed.** This is the single
source of truth for how the sandbox is configured so the full local stack — Docker,
local Supabase, and the NestJS API — comes up automatically each session. Laptop/local
setup is the secondary path: [`LOCAL_DEV.md`](./LOCAL_DEV.md). Agent credentials live in
[`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md); broader CI/agent infra is
[`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md).

## How Claude Code web environments work

A session runs in a fresh, ephemeral Anthropic VM (~4 vCPU / 16 GB / 30 GB disk). Key
properties that shape everything below (see
<https://code.claude.com/docs/en/claude-code-on-the-web>):

- **Environment variables** are set in the web UI and are **visible to anyone who can
  edit the environment** — use **test-mode** secrets only, never live keys.
- **Setup script** runs **as root, before the agent, with a ~5-minute budget.** Its
  **filesystem is cached (~7 days)** and reused across sessions, but **running daemons do
  NOT persist** — only files (installed packages, pulled Docker images) survive. So the
  setup script pre-pulls images; the per-session bringup starts the daemons.
- **Network access** is one of None / Trusted / Full / Custom. GitHub traffic uses a
  separate proxy and always works. Image registries do **not** all fall under Trusted
  (see the network note below).
- **Ephemerality:** repo is cloned fresh; anything not committed/pushed is lost when the
  VM is reclaimed.

## What's configured in the web UI

Open the environment settings dialog and set:

**1. Setup script** field:

```
bash scripts/cloud-sandbox-setup.sh || true
```

**2. Network access:** **Custom** with **`public.ecr.aws`** and **`*.cloudfront.net`**
added to the allowlist (keep "include default list" on), or simply **Full**.

`supabase start` does **not** pull only from Docker Hub: the Postgres image (and several
others) come from **AWS ECR Public** (`public.ecr.aws/supabase/*`), served via
**CloudFront** (`*.cloudfront.net`). Trusted alone covers npm, GitHub, and Docker Hub —
enough for `npm ci` and `docker login`, but **not** ECR Public + CloudFront, so a
Trusted-only policy fails image pulls with `403 Forbidden` / `Host not in allowlist`.

**3. Environment variables** (`.env` style, one `KEY=value` per line, no quotes):

```
DOCKERHUB_USERNAME=<docker hub user>
DOCKERHUB_TOKEN=<read-only docker hub access token>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

- `DOCKERHUB_*` lift Docker Hub anonymous pull rate limits (some images — e.g. `mailpit`
  — come from Docker Hub). Use a **read-only access token**, not the account password.
- `STRIPE_*` should be **restricted test-mode** keys. Optional: if absent, the bringup
  writes non-empty placeholders so the API still boots (billing endpoints that call
  Stripe won't work).
- Provider/research creds (`GITHUB_PAT`, etc.) and the full list:
  [`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md).

`FRAPP_CLOUD_SANDBOX` is **optional** — the setup script drops a marker
(`/etc/frapp-cloud-sandbox`) that the SessionStart hook auto-detects, so auto-bringup
works without it. Set `FRAPP_CLOUD_SANDBOX=1` only to force bringup where the marker is
absent (e.g. before the first cached setup run).

## How it works (two phases)

The filesystem is cached but running processes are not, so work is split:

| Phase | Script | Runs | Does |
|-------|--------|------|------|
| Setup (cached) | `scripts/cloud-sandbox-setup.sh` | once, as root, before the agent | writes the `/etc/frapp-cloud-sandbox` marker; `npm ci`; transient dockerd + `docker login` + `supabase start`/`stop` purely to **pull + cache images** |
| Per-session | `scripts/cloud-sandbox-up.sh` | every session, in the background | start dockerd; `docker login`; `supabase start` (fast — images cached); `db push --local`; write `apps/api/.env.local` |

Both source `scripts/lib/cloud-sandbox-common.sh` (`cs_ensure_docker_daemon`,
`cs_docker_login_if_creds`).

### Auto-bringup and how the agent waits

`.claude/hooks/session-start.sh` launches `cloud-sandbox-up.sh` in the background when
the `/etc/frapp-cloud-sandbox` marker exists **or** `FRAPP_CLOUD_SANDBOX=1` (a `/tmp`
lock prevents relaunch on resume). The session is **never blocked** on the ~60-90s
bringup. Before using the DB or booting the API, wait for one of:

- `.cloud-sandbox-up.done` — success (timestamp). Stack is up and `apps/api/.env.local`
  is written.
- `.cloud-sandbox-up.failed` — error (timestamp + reason). Inspect
  `/tmp/cloud-sandbox-up.log`.

Both sentinels are at the repo root and gitignored.

### Booting the API

`cloud-sandbox-up.sh` writes `apps/api/.env.local` (local Supabase keys from `supabase
status` + the Stripe vars), which the API's `ConfigModule` loads directly — so **no
Infisical is needed**:

```
npm run start:dev -w apps/api   # bypasses the infisical-wrapped dev:api script
```

`/health` and `/docs` then respond on `:3001`.

## When bringup fails — STOP and report

If `.cloud-sandbox-up.failed` is present (or anything below appears in
`/tmp/cloud-sandbox-up.log`), **do not work around it** — stop and tell the user exactly
what to add or change in the Claude Code web environment, then wait. These failures are
environment config the agent cannot fix from inside the session.

| Symptom in the log | Cause | Tell the user to |
|--------------------|-------|------------------|
| `403 Forbidden` / `Host not in allowlist` on `public.ecr.aws` or `*.cloudfront.net` | Network policy too restrictive | Set Network = **Full**, or Custom + `public.ecr.aws` + `*.cloudfront.net` |
| Docker Hub `Rate exceeded` / `toomanyrequests` | Missing/invalid Docker Hub creds | Add `DOCKERHUB_USERNAME` + a read-only `DOCKERHUB_TOKEN` |
| API logs `Missing required environment variables` | `.env.local` not generated (bringup failed earlier) | Fix the upstream bringup failure; re-run after the env change lands in a **new** session |
| `supabase start` slow / re-pulling every session | Setup script not set, so images aren't cached | Set the **Setup script** field to `bash scripts/cloud-sandbox-setup.sh \|\| true` |
| Auto-bringup never starts (no `.done`/`.failed`, no log) | Marker absent and `FRAPP_CLOUD_SANDBOX` unset | Set `FRAPP_CLOUD_SANDBOX=1` (or confirm the setup script ran to write the marker) |

Env var and network changes **apply to new sessions only** — the user must start a fresh
session for them to take effect.

## Manual / fallback bringup

If auto-bringup is off or you need to drive it by hand, run the same script directly:

```
bash scripts/cloud-sandbox-up.sh
```

Or step through it: start the daemon (`sudo dockerd &>/tmp/dockerd.log &`, wait for
`/var/run/docker.sock`), `npx supabase start`, `npx supabase db push --local`, then build
`apps/api/.env.local` from `npx supabase status -o env` + the Stripe vars. For migration
validation without Docker at all, use the PGlite harness (`npm run check:pglite-migrations`).

## Still out of scope

- **Supabase MCP write tools** (`create_branch`, `apply_migration`) remain denied by
  `.claude/settings.json`; local Supabase covers DB + migrations without them.
- **Live Realtime/Presence, push fanout (APNS/FCM), RLS-as-GoTrue** against the hosted
  stack still need real staging — keep the "Runtime checks BLOCKED" protocol in
  [`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md).
