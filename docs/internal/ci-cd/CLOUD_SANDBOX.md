# Claude Code cloud sandbox

How the Claude Code **web** sandbox (ephemeral Anthropic VM) is configured so the
full local stack — Docker, local Supabase, and the NestJS API — runs there. This is
the single source of truth for the web-UI configuration; the scripts referenced
below live in `scripts/` and are the only moving parts in the repo.

Day-to-day local setup is [`LOCAL_DEV.md`](../environment/LOCAL_DEV.md); broader agent
infra is [`AGENT_INFRA.md`](./AGENT_INFRA.md).

## Why this exists

A Claude Code web session runs in a fresh VM with no Docker daemon started and no app
secrets. Without setup, `supabase start` / `docker build` fail and the API refuses to
boot (`apps/api/src/config/env.validation.ts` requires 6 vars). This wiring fixes all
three so chunks that need a real DB or a running API can be verified in-session.

## What the user configures in the Claude Code web UI

Open the environment settings dialog (see
<https://code.claude.com/docs/en/claude-code-on-the-web>) and set:

**1. Environment variables** (`.env` style, one `KEY=value` per line, no quotes):

```
FRAPP_CLOUD_SANDBOX=1
DOCKERHUB_USERNAME=<docker hub user>
DOCKERHUB_TOKEN=<read-only docker hub access token>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

- `FRAPP_CLOUD_SANDBOX=1` is the gate that turns on background bringup in the
  SessionStart hook. Without it, nothing auto-starts.
- `DOCKERHUB_*` lift Docker Hub anonymous pull rate limits (`supabase start` pulls
  ~10 images). Use a **read-only access token**, not the account password.
- `STRIPE_*` should be **restricted test-mode** keys. They are optional: if absent the
  bringup writes non-empty placeholders so the API still boots (billing endpoints that
  call Stripe won't work).
- **Visibility caveat:** environment variables are stored in the environment config and
  visible to anyone who can edit it. Keep these to test-mode values only — never live
  secrets.
- Existing agent creds (`GITHUB_PAT`, `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN`, …) are
  unaffected; see [`AGENT_INFRA.md`](./AGENT_INFRA.md).

**2. Setup script** field:

```
bash scripts/cloud-sandbox-setup.sh || true
```

**3. Network access:** **Trusted**. The default allowlist already covers Docker Hub,
npm, GitHub, and the Supabase image registries — enough for `docker login`,
`supabase start`, and `npm ci`. Choose Full only if a task needs arbitrary outbound
hosts (e.g. live `api.stripe.com` calls).

## How it works (two phases)

The web sandbox **caches the filesystem (~7 days) but not running processes**, so work
is split:

| Phase | Script | Runs | Does |
|-------|--------|------|------|
| Setup (cached) | `scripts/cloud-sandbox-setup.sh` | once, as root, before the agent | `npm ci`; start a transient dockerd; `docker login`; `supabase start` then `stop` purely to **pull + cache images** |
| Per-session | `scripts/cloud-sandbox-up.sh` | every session, in the background | start dockerd; `docker login`; `supabase start` (fast — images cached); `db push --local`; write `apps/api/.env.local` |

Both source `scripts/lib/cloud-sandbox-common.sh` (`cs_ensure_docker_daemon`,
`cs_docker_login_if_creds`), which `scripts/jules-setup.sh` reuses too.

### Auto-bringup and how the agent waits

When `FRAPP_CLOUD_SANDBOX=1`, `.claude/hooks/session-start.sh` launches
`cloud-sandbox-up.sh` in the background (a `/tmp` lock prevents relaunch on resume) and
tells the agent where to watch. The session is **never blocked** on the ~60-90s bringup.

Before using the DB or booting the API, wait for one of:

- `.cloud-sandbox-up.done` — success (timestamp). The stack is up and
  `apps/api/.env.local` is written.
- `.cloud-sandbox-up.failed` — error (timestamp + reason). Inspect
  `/tmp/cloud-sandbox-up.log`.

Both sentinels are at the repo root and gitignored.

### Booting the API

`cloud-sandbox-up.sh` writes `apps/api/.env.local` (local Supabase keys from
`supabase status` + the Stripe vars), which the API's `ConfigModule` loads directly — so
**no Infisical is needed**:

```
npm run start:dev -w apps/api   # bypasses the infisical-wrapped dev:api script
```

`/health` and `/docs` then respond on `:3001`.

## Still out of scope

- **Supabase MCP write tools** (`create_branch`, `apply_migration`) remain denied by
  `.claude/settings.json`; local Supabase covers DB + migrations without them.
- **Live Realtime/Presence, push fanout (APNS/FCM), RLS-as-GoTrue** against the hosted
  stack still need real staging — keep the "Runtime checks BLOCKED" protocol in
  [`AGENT_INFRA.md`](./AGENT_INFRA.md).
