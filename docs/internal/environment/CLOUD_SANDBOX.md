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
| Per-session | `scripts/cloud-sandbox-up.sh` | every session, in the background | start dockerd; `docker login`; `supabase start` (fast — images cached); `db push --local`; repair local Postgres default ACLs; write `apps/api/.env.local` |

Both source `scripts/lib/cloud-sandbox-common.sh` (`cs_log`, `cs_ensure_docker_daemon`,
`cs_docker_login_if_creds`, `cs_supabase`, `cs_retry`, `cs_classify_failure`,
`cs_failure_hint`).

### Retry on transient registry failures

`supabase start` is the only network-bound step, and the only retried one. It pulls ~10
images from ECR Public via CloudFront; the CLI retries an individual blob fetch twice
internally (4s, 8s), which a CDN hiccup can simply outlast — and when it does, the whole
bringup dies. `cs_retry` wraps that one call in both scripts, running `supabase stop`
between attempts so a retry does not run over the half-created containers a failed attempt
left behind.

Retrying is gated on classification, because retrying indiscriminately is worse than not
retrying at all — three wasted ~90s attempts against a problem only a settings change can
fix just delays the answer:

| Class | Retried? | Why |
|-------|----------|-----|
| `transient` — 5xx, timeout, connection reset, truncated transfer | yes | upstream hiccup; usually clears |
| `unknown` — anything unrecognised | yes | the point is resilience against errors nobody enumerated, and every class that genuinely cannot be retried is named below |
| `policy` — network policy blocked a registry host | **no** | an allowlist does not heal on retry |
| `ratelimit` — Docker Hub pull limit | **no** | needs credentials, not patience |
| `deterministic` — denied ulimit, port in use, dockerd down, incompatible data volume | **no** | local and repeatable; each already has a row in the symptom table below |
| `toolchain` — `cs_supabase` exit 127 | **no** | bad version pin or blocked npm registry; a retry repeats a failing `npm install` |

Two details that look like nits and are not. The classifier strips telemetry lines *before*
testing for a policy failure (see the telemetry row below), and it matches HTTP statuses only
in context — a bare `429`/`503` is ignored, because Docker's own progress output
(`Downloading 429.5MB/1.2GB`) and Supabase image tags (`v2.193.0: Pulling from …`) are full of
incidental digits, and `ratelimit` is fail-fast. Likewise only the proxy's own
`Host not in allowlist` marker counts as `policy`: ECR Public serves blobs from presigned
CloudFront URLs that return a perfectly retryable `403 Forbidden` when the signature expires
mid-pull on a large image.

`db push --local`, the ACL repair, and writing `apps/api/.env.local` are deliberately **not**
retried. They are deterministic and local, so a retry only triples the time to the same error
and hides which step actually broke.

The ACL repair runs **after** `db push` because it fixes the tables those migrations just
created: the pinned Postgres image grants `anon`/`authenticated`/`service_role` no DML on
objects created by `postgres`, so without it the API's first query is `42501 permission
denied`. It also resets the schema's *default* privileges, so migrations added in a later
session inherit working grants. It never touches function `EXECUTE` — the RPC migrations
manage that explicitly, and a blanket grant would undo their lockdown. See the `42501` row
under [When bringup fails](#when-bringup-fails--stop-and-report).

Knobs, all optional:

| Variable | Default | Effect |
|----------|---------|--------|
| `FRAPP_SANDBOX_START_RETRIES` | `3` (**2** in setup) | total attempts for `supabase start` |
| `FRAPP_SANDBOX_RETRY_BASE_DELAY` | `10` (**5** in setup) | seconds before the 2nd attempt; doubles each time (capped at 300s). `0` disables the wait |
| `FRAPP_SANDBOX_CLEANUP_TIMEOUT` | `120` | seconds to allow the between-attempt `supabase stop` before abandoning it |

The setup pre-pull runs a **tighter budget than per-session bringup** on purpose: that script
has a ~5-minute wall-clock budget, and overrunning it is worse than failing, because the
harness kills it mid-pull and half-created containers get baked into the *cached* filesystem
every later session inherits. It also traps `TERM`/`INT` to tear the stack down if that
happens anyway.

Out-of-range and non-integer values fall back to the defaults rather than aborting the shell,
so a typo in a tuning variable cannot break bringup outright.

`cs_supabase` is how both scripts invoke the Supabase CLI — never bare `npx supabase`. It
resolves a **pinned** CLI (`CS_SUPABASE_CLI_VERSION`, override with
`FRAPP_SUPABASE_CLI_VERSION`) from a gitignored `.cache/supabase-cli/`, installing it on
first use. Same pinned-tooling pattern as gitleaks (`scripts/install-gitleaks.sh` →
`.cache/gitleaks/`), and kept out of the repo's dependency tree deliberately: the v2 CLI's
platform binary is ~200 MB, so as a root devDependency every `npm ci` in CI and the API
image's dev-deps stage would download it for a tool only these two scripts call.

> **Known version skew:** the sandbox pin is **not** the CLI version that applies
> migrations in CI — [`deploy-api.yml`](../../../.github/workflows/deploy-api.yml) pins
> `supabase/setup-cli` to **2.77.0** for the staging and production migration steps. The
> gap predates the pin (the scripts previously ran unpinned `npx supabase`, i.e. whatever
> `latest` was that day), and the sandbox cannot simply match 2.77.0 — it fails to start
> here because the realtime container aborts with `:listen_error, :eafnosupport` (IPv6
> bind, unsupported in this sandbox). Closing the gap means moving *deploy* forward, which
> needs staging verification and its own change.

### Auto-bringup and how the agent waits

`.claude/hooks/session-start.sh` launches `cloud-sandbox-up.sh` in the background when
the `/etc/frapp-cloud-sandbox` marker exists **or** `FRAPP_CLOUD_SANDBOX=1`. A `/tmp`
lock prevents a relaunch while a bringup is in flight, but the hook **reclaims a stale
lock and relaunches** when a prior run was killed (e.g. the session was paused/reclaimed)
and left the lock with no `.done`/`.failed` sentinel — so a resumed session never waits
forever on a sentinel that can't arrive. The session is **never blocked** on the ~60-90s
bringup. Before using the DB or booting the API, wait for one of:

- `.cloud-sandbox-up.done` — success (timestamp). Stack is up and `apps/api/.env.local`
  is written.
- `.cloud-sandbox-up.failed` — error (timestamp + reason). Inspect
  `/tmp/cloud-sandbox-up.log`.

Both sentinels are at the repo root and gitignored. The `.failed` reason is written to name
the fix, not just the symptom (`'supabase start' failed (policy) — the sandbox network
policy blocked a container registry. Set Network = Full, or …`), so a polling agent that
reads only the sentinel still knows what to tell the user. `~60-90s` is the healthy case:
a run that hits transient registry errors retries with backoff and takes longer before
landing either sentinel.

### Booting the API

`cloud-sandbox-up.sh` writes `apps/api/.env.local` (local Supabase keys from `supabase
status` + the Stripe vars), which the API's `ConfigModule` loads directly — so **no
Infisical is needed**:

```
npm run start:dev -w apps/api   # bypasses the infisical-wrapped dev:api script
```

`/health` and `/docs` then respond on `:3001`.

### Running `npm run build` in the sandbox

The sandbox exports `NODE_ENV=development`. That is correct for `dev`, but a bare `next build`
inherits it and produces a broken prerender (`Cannot read properties of null (reading 'useContext')`
on an arbitrary route). The Next apps therefore build through
[`scripts/next-build.mjs`](../../../scripts/next-build.mjs), which pins `NODE_ENV=production` — see
[`ENV_REFERENCE.md` → Production builds](./ENV_REFERENCE.md#production-builds-npm-run-build-and-node_env)
for the full mechanism. `apps/web` also needs `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
exported for its build to prerender.

## When bringup fails — STOP and report

If `.cloud-sandbox-up.failed` is present, **do not work around it** — stop and tell the user
exactly what to add or change in the Claude Code web environment, then wait. Most of these
failures are environment config the agent cannot fix from inside the session.

**Read the sentinel first — then still read the log.** For the `supabase start` step,
`.cloud-sandbox-up.failed` names the failure class and the remedy (`'supabase start' failed
(ratelimit) — Docker Hub refused the pull …`), so start there. Two caveats, both real:

- **Only that step is classified.** The other `fail()` sites still write plain reasons
  (`'supabase db push --local' failed.`, `Docker daemon did not start.`). A bare reason is a
  pointer to the log, not a finished diagnosis — and a failing migration is an in-repo fix, not
  something to stop and report as environment config.
- **A `(unknown)` class means exactly that.** Match the log against the table below yourself.

Registry errors in the log are also no longer self-evidently fatal: transient ones are
retried, so a **successful** bringup can contain several `503`s. A scary line with a
`.cloud-sandbox-up.done` next to it means the retry did its job — not a failure to report.
Conversely, one row below fires only on a *successful* run (`supabase start` slow / re-pulling
every session), so skim the log even when bringup succeeds.

| Symptom | Cause | What to do |
|---------|-------|------------|
| `403 Forbidden` / `Host not in allowlist` on `public.ecr.aws` or `*.cloudfront.net`; sentinel says `(policy)` | Network policy too restrictive | Set Network = **Full**, or Custom + `public.ecr.aws` + `*.cloudfront.net`. Fails **fast** — classified `policy`, so no attempts are wasted retrying it |
| Docker Hub `Rate exceeded` / `toomanyrequests`; sentinel says `(ratelimit)` | Missing/invalid Docker Hub creds | Add `DOCKERHUB_USERNAME` + a read-only `DOCKERHUB_TOKEN`. Also fails **fast** |
| `503 Service Unavailable` / `502` / `504` / `connection reset` / `unexpected EOF` on a registry or CDN host, **and** the bringup still succeeded | Transient registry/CDN hiccup | **Nothing — this is handled.** `cs_retry` retries `supabase start` with backoff; the log keeps the failed attempts, which is why they appear even on a healthy run |
| Same transient errors, but the sentinel says `'supabase start' failed (transient)` | Registry/CDN outage that outlasted every retry | Not an env-config problem. Start a fresh session to retry; if it persists, check the Supabase and AWS ECR Public status pages. Raise `FRAPP_SANDBOX_START_RETRIES` to widen the window |
| `posthog … 403 Host not in allowlist` | The Supabase CLI's **telemetry** call being blocked — **harmless, and never the cause** | Nothing. `DO_NOT_TRACK=1` + `SUPABASE_TELEMETRY_DISABLED=1` are exported in the shared lib so it should not appear at all; if a CLI version emits it anyway, the failure classifier filters telemetry lines out before matching, so it cannot be mistaken for the allowlist row above |
| API logs `Missing required environment variables` | `.env.local` not generated (bringup failed earlier) | Fix the upstream bringup failure; re-run after the env change lands in a **new** session |
| `supabase start` slow / re-pulling every session | Setup script not set, so images aren't cached | Set the **Setup script** field to `bash scripts/cloud-sandbox-setup.sh \|\| true` |
| `failed to start docker container "supabase_edge_runtime_*": error setting rlimit type 7: operation not permitted` | Sandbox denies the ulimit (`RLIMIT_NOFILE`) the Deno edge-runtime container sets, which aborts the whole `supabase start` | Already handled — bringup excludes edge-runtime (`supabase start -x edge-runtime`) since the API talks to Postgres directly and hot-path logic moved into NestJS (ADR-11/ADR-12). Set `FRAPP_SUPABASE_START_ARGS` to override if edge functions are genuinely needed |
| Auto-bringup never starts (no `.done`/`.failed`, no log) | Marker absent and `FRAPP_CLOUD_SANDBOX` unset | Set `FRAPP_CLOUD_SANDBOX=1` (or confirm the setup script ran to write the marker) |
| Log ends mid-step with no `.done`/`.failed` (e.g. frozen at "Starting Docker daemon") | A prior bringup was killed when the session paused/was reclaimed, leaving a stale `/tmp/cloud-sandbox-up.lock` | Self-heals — the SessionStart hook clears the stale lock and relaunches next session. To force it now: `rm -rf /tmp/cloud-sandbox-up.lock && bash scripts/cloud-sandbox-up.sh` |
| `Error: No matching Supabase CLI binary package found for linux-x64` (from `supabase/dist/supabase.js`), then a sentinel reading `'supabase start' failed (toolchain)` | The Supabase v2 CLI ships its binary as a platform-specific **optionalDependency** (`@supabase/cli-<platform>`). If that optional install is skipped, the launcher finds no binary and throws — and npx caches the broken tree under `~/.npm/_npx`, so it stays broken all session | **Repo fix, not an env change** — already handled: both scripts go through `cs_supabase`, which installs a pinned CLI into `.cache/supabase-cli/` and probes it by running `--version`. If it recurs, delete `.cache/supabase-cli/` to force a clean reinstall |
| API logs `42501 permission denied for table <name>` and `/health` reports `{"database":"error"}` / `degraded`, on a bringup that otherwise succeeded | The pinned `supabase/postgres` image (17.6.x) ships a default ACL for role `postgres` in schema `public` granting `anon`/`authenticated`/`service_role` only `Dxtm` — the DML bits `arwd` are missing. Migrations are applied as `postgres`, so every table inherits it. Survives `supabase db reset --local` | **Already handled** — bringup runs a `repair_local_acls` step after `db push` that grants table/sequence DML and fixes the default privileges for future migrations. If it recurs, re-run `bash scripts/cloud-sandbox-up.sh`. Confirm with `select defaclacl from pg_default_acl where pg_get_userbyid(defaclrole)='postgres' and defaclnamespace::regnamespace::text='public' and defaclobjtype='r';` — healthy shows `anon=arwdDxtm/postgres`, broken shows `anon=Dxtm/postgres`. The repair deliberately never grants function `EXECUTE` (the RPC migrations lock that down explicitly) |

Env var and network changes **apply to new sessions only** — the user must start a fresh
session for them to take effect.

**Not every row is a "stop and report".** Three kinds live in that table:

- **Environment config** (allowlist, Docker Hub creds, missing setup script, absent marker) —
  the user changes a setting in the Claude Code web environment, and only a **new** session
  picks it up. This is the case the "stop and report" rule is about.
- **No action needed** (retried transients, the PostHog telemetry line) — already handled in
  the scripts. Reporting these as blockers is a false alarm.
- **Repo fixes** (the missing Supabase CLI binary, the edge-runtime rlimit) — fixed in-tree,
  not in the web UI. A registry outage that outlasts every retry is a fourth case: nobody's
  config is wrong, and the only move is to try again later.

Prefer the pinned CLI (`cs_supabase`) over `npx supabase` in any new script: unpinned npx
re-resolves `latest` every session, so the toolchain can change under you between runs.

## Manual / fallback bringup

If auto-bringup is off or you need to drive it by hand, run the same script directly:

```
bash scripts/cloud-sandbox-up.sh
```

Or step through it: start the daemon (`sudo dockerd &>/tmp/dockerd.log &`, wait for
`/var/run/docker.sock`), then use the pinned CLI —
`.cache/supabase-cli/node_modules/.bin/supabase start`, then `… db push --local` — and build
`apps/api/.env.local` from `… status -o env` + the Stripe vars. (Source
`scripts/lib/cloud-sandbox-common.sh` and call `cs_supabase` to get the install-on-first-use
behaviour instead of managing that path by hand.) For migration
validation without Docker at all, use the PGlite harness (`npm run check:pglite-migrations`).

## Still out of scope

- **Supabase MCP write tools** (`create_branch`, `apply_migration`) are not allowlisted in
  `.claude/settings.json`, so they prompt — which unattended sandboxes cannot approve (the
  committed file has never carried a deny rule; see
  [`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md)). Local Supabase covers DB + migrations
  without them.
- **Live Realtime/Presence, push fanout (APNS/FCM), RLS-as-GoTrue** against the hosted
  stack still need real staging — keep the "Runtime checks BLOCKED" protocol in
  [`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md).
