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

**2. Network access:** **Custom**, "include default list" **on**, with these lines in
**Allowed domains** (one per line):

```
public.ecr.aws
*.cloudfront.net
staging.frapp.live
*.staging.frapp.live
api-staging.frapp.live
hnoyzpidbmizhbqaiity.supabase.co
app.infisical.com
vercel.com
```

The first two are what makes `supabase start` work. The middle four are the **live staging
egress** described in [Live staging egress](#live-staging-egress) below; omit them and the
sandbox is still fully functional for local-stack work, it just cannot reach the deployed
environment. The seventh is the **Infisical API**
([#1279](https://github.com/pdcarlson/Frapp/issues/1279)): secrets access for agents, bounded
by the service token — scoped `dev` + `staging` **read-only**, never `prod` — not by the
network. Omit it and secrets stay unreadable from the sandbox
(credential details: [`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md)).

The eighth, `vercel.com`, is **unexplained**, and is recorded here only because it is
**observed in the live environment as of 2026-09-02** — read out of the settings box while
confirming the allowlist for [#1447](https://github.com/pdcarlson/Frapp/issues/1447). Nothing in
this repo asks for it, no script or workflow is known to depend on it, and it is not probed by
`scripts/cloud-sandbox-egress-probe.sh`, so its absence would not be noticed either. It also sits
against the posture in [What this does not unlock](#what-this-does-not-unlock) below, which says
provider APIs are reached over MCP rather than the allowlist.

Two things are worth separating. It grants **no reach to any Frapp production host** — none of
`api.frapp.live`, `app.frapp.live`, or the `frapp-prod` Supabase ref is under `vercel.com` — so it
is not a second instance of the [#1447](https://github.com/pdcarlson/Frapp/issues/1447)
regression, which is why documenting it does not reopen that issue. But whether a **bare** entry
also permits its subdomains is **not known**: the observations under
[Wildcard semantics](#wildcard-semantics--weaker-than-the-docs-imply) probed `*.` entries only,
and nothing here establishes the converse. Do not cite that section for a bare-entry rule.

**This entry needs an owner decision, not further documentation:** confirm what it is for and
record that here, or remove it from the environment and delete this paragraph. Until then, treat
it as drift rather than as precedent for adding undocumented entries.

**Three of the staging four are literal hosts on purpose.** Both wildcards a reader reaches for —
`*.frapp.live` and `*.supabase.co` — silently include **production**, because prod and
staging share an apex on both. The fourth line, `*.staging.frapp.live`, is a wildcard only
because its parent is staging-only; it is kept on sufferance rather than as a pattern to
copy, for the reason given under [Wildcard semantics](#wildcard-semantics--weaker-than-the-docs-imply).
See [Enumerate, do not wildcard](#enumerate-do-not-wildcard).

`supabase start` does **not** pull only from Docker Hub: the Postgres image (and several
others) come from **AWS ECR Public** (`public.ecr.aws/supabase/*`), served via
**CloudFront** (`*.cloudfront.net`). Trusted alone covers npm, GitHub, and Docker Hub —
enough for `npm ci` and `docker login`, but **not** ECR Public + CloudFront, so a
Trusted-only policy fails image pulls with `403 Forbidden` / `Host not in allowlist`.

**Full** also works for image pulls, and is the wrong choice here: it grants prod egress
too, which the allowlist above deliberately withholds.

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
| Per-session | `scripts/cloud-sandbox-up.sh` | every session, in the background | start dockerd; `docker login`; `supabase start` (fast — images cached); `db push --local`; repair local Postgres default ACLs; write `apps/api/.env.local` + `apps/web/.env.local`; verify `node_modules` is usable (**last**, so a broken npm never costs the database) |

Both source `scripts/lib/cloud-sandbox-common.sh` (`cs_log`, `cs_ensure_docker_daemon`,
`cs_docker_login_if_creds`, `cs_supabase`, `cs_retry`, `cs_classify_failure`,
`cs_failure_hint`, `cs_node_deps_ok`, `cs_verify_node_deps`).

**Bringup never writes to `node_modules`.** It reports on it and lets the session run `npm ci`
itself. The session's own gates and `npm install` are sanctioned to run while bringup is still
going (it is launched with `nohup … &`), so a repair here would race the agent over one
`node_modules` with no lock — and `npm ci` *deletes* the tree before installing, which would
turn a merely incomplete tree into a destroyed one whenever the repair itself failed.

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
| `deterministic` — denied ulimit, port in use, dockerd down, incompatible data volume | **no** | local and repeatable; each has a row in the symptom table below, and adding a pattern to the matcher means adding one |
| `toolchain` — `cs_supabase` exit 127 | **no** | bad version pin or blocked npm registry; a retry repeats a failing `npm install` |
| `dependencies` — `node_modules/.bin/turbo` does not run | **no** | not a retry at all. Unlike every class above it, this one never comes out of `cs_classify_failure` — bringup's last step raises it directly, and the fix is a foreground `npm ci` the session runs itself |

Two details that look like nits and are not. The classifier strips telemetry lines *before*
testing for a policy failure (see the telemetry row below), and it matches HTTP statuses only
in context — a bare `429`/`503` is ignored, because Docker's own progress output
(`Downloading 429.5MB/1.2GB`) and Supabase image tags (`v2.193.0: Pulling from …`) are full of
incidental digits, and `ratelimit` is fail-fast. Likewise only the proxy's own
`Host not in allowlist` marker counts as `policy`: ECR Public serves blobs from presigned
CloudFront URLs that return a perfectly retryable `403 Forbidden` when the signature expires
mid-pull on a large image.

`db push --local`, writing the app `.env.local` files, and the ACL repair are deliberately **not**
retried. They are deterministic and local, so a retry only triples the time to the same error
and hides which step actually broke. One nuance when reading a failed repair: it is not
*retried*, but it does have **two connection paths** — the host `psql` first, then `psql`
inside the `supabase_db_*` container. So a failure log can hold two errors for one step, and
the earlier (host-side) one is usually the one that explains it.

The ACL repair is sequenced **after `db push`** because it fixes the tables those migrations
just created: the pinned Postgres image grants `anon`/`authenticated`/`service_role` no DML on
objects created by `postgres`, so without it the API's first query is `42501 permission
denied`. It also resets the schema's *default* privileges, so migrations added in a later
session inherit working grants.

It is sequenced **after `write_env_files`** for a different reason: the repair is fatal, and
nothing in the env file depends on the grants. Running it earlier meant a failed repair
aborted before `.env.local` existed, leaving the API unable to boot at all — strictly worse
than the `42501` being repaired, where the API boots and only queries fail.

It never touches function `EXECUTE`. Ten migrations revoke EXECUTE from `public` and `anon`
(eight of them from `authenticated` too) and re-grant it only to named roles — `service_role`
in nine, `supabase_auth_admin` in one, and `authenticated` in the two that deliberately allow
a direct client call — so a blanket grant would undo every one of them; functions are also
unaffected by the defect to begin with. See the
`42501` row under [When bringup fails](#when-bringup-fails--stop-and-report).

The repair itself is not sandbox-specific — the defect is the image's shipped state, so the
laptop path hits it identically. It therefore lives in
[`scripts/lib/local-postgres-acl.sh`](../../../scripts/lib/local-postgres-acl.sh) and is called
by both this script and [`local-dev-setup.sh`](../../../scripts/local-dev-setup.sh). That lib is
deliberately free of `cs_*` dependencies so the laptop path can source it without inheriting the
sandbox's pinned Supabase CLI.

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

- `.cloud-sandbox-up.done` — success (timestamp). Stack is up and `apps/api/.env.local` + `apps/web/.env.local`
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

### What bringup provisions, per app

Two files, both gitignored, both regenerated from the same `supabase status` read each session.
Nothing else is written; anything not listed here has a working default or is not needed to build.

| File | Serves | Contents |
|---|---|---|
| `apps/api/.env.local` | `npm run start:dev -w apps/api` | The full `supabase status -o env` dump remapped to `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, plus the three `STRIPE_*` vars (real test keys when the session has them, clearly-marked placeholders otherwise), `PORT=3001`, `NODE_ENV=development` |
| `apps/web/.env.local` | `npm run build -w apps/web`, `npm run dev -w apps/web` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL=http://127.0.0.1:3001` |

`apps/landing` and `apps/mobile` get **nothing, deliberately**. Landing's only `NEXT_PUBLIC_*` var
defaults to the production origin in `apps/landing/lib/auth-urls.ts`, and mobile has no build script
and reads its Supabase vars with `?? ""`. Both are fine unconfigured.

The web file carries the two Supabase vars and **only** those two. `NEXT_PUBLIC_*` is inlined into
the client bundle by Next, so the service-role key — which is present in the same `supabase status`
output — must never be prefixed along with them. The anchored `grep` in `write_env_files` is what
enforces that, not the ordering of the lines.

### Running `npm run build` in the sandbox

The sandbox exports `NODE_ENV=development`. That is correct for `dev`, but a bare `next build`
inherits it and produces a broken prerender (`Cannot read properties of null (reading 'useContext')`
on an arbitrary route). The Next apps therefore build through
[`scripts/next-build.mjs`](../../../scripts/next-build.mjs), which pins `NODE_ENV=production` — see
[`ENV_REFERENCE.md` → Production builds](./ENV_REFERENCE.md#production-builds-npm-run-build-and-node_env)
for the full mechanism.

**No exports are needed.** `apps/web` reads `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` non-null-asserted, so without them the build dies prerendering
`/chat` — bringup therefore writes them to `apps/web/.env.local` alongside the API file (#1156).
If you hit that error, the file is missing rather than your change being wrong: re-run bringup.

## When bringup fails — STOP and report

If `.cloud-sandbox-up.failed` is present, **do not work around it** — stop and tell the user
exactly what to add or change in the Claude Code web environment, then wait. Most of these
failures are environment config the agent cannot fix from inside the session.

**Read the sentinel first — then still read the log.** For the `supabase start` step,
`.cloud-sandbox-up.failed` names the failure class and the remedy (`'supabase start' failed
(ratelimit) — Docker Hub refused the pull …`), so start there. Two caveats, both real:

- **Two steps are classified, not one.** `supabase start` carries a `cs_classify_failure` class,
  and the closing toolchain check writes `(dependencies)` the same way. Every other `fail()` site
  still writes a plain reason (`'supabase db push --local' failed.`, `Docker daemon did not
  start.`). A bare reason is a pointer to the log, not a finished diagnosis — and a failing
  migration is an in-repo fix, not something to stop and report as environment config.
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
| API logs `Missing required environment variables` | `apps/api/.env.local` not generated (bringup failed earlier) | Fix the upstream bringup failure; re-run after the env change lands in a **new** session |
| `npm run build -w apps/web` dies prerendering `/chat` with `@supabase/ssr: Your project's URL and API key are required to create a Supabase client!` | `apps/web/.env.local` missing — bringup failed, or the clone predates #1156 | Not your change. `rm -rf /tmp/cloud-sandbox-up.lock && bash scripts/cloud-sandbox-up.sh`, then rebuild |
| `supabase start` slow / re-pulling every session | Setup script not set, so images aren't cached | Set the **Setup script** field to `bash scripts/cloud-sandbox-setup.sh \|\| true` |
| `failed to start docker container "supabase_edge_runtime_*": error setting rlimit type 7: operation not permitted` | Sandbox denies the ulimit (`RLIMIT_NOFILE`) the Deno edge-runtime container sets, which aborts the whole `supabase start` | Already handled — bringup excludes edge-runtime (`supabase start -x edge-runtime`) since the API talks to Postgres directly and hot-path logic moved into NestJS (ADR-11/ADR-12). Set `FRAPP_SUPABASE_START_ARGS` to override if edge functions are genuinely needed |
| `failed to bind host port 0.0.0.0:54322/tcp: address already in use`, or `port is already allocated`; sentinel says `(deterministic)` | Something already holds a Supabase port — **check `docker ps -a` first**, since which holder it is decides the remedy. A `supabase_*` container left by an earlier bringup in this session is the case the scripts can clear. It is **not** the SessionStart stale-lock reclaim, which tests liveness (`kill -0` plus a `ps` args match) before relaunching and so cannot race a live predecessor | **Clear the containers, then re-run** — `deterministic` is fail-fast, so `cs_retry`'s `supabase stop` cleanup never runs for this class and nothing clears them for you: `bash -c '. scripts/lib/cloud-sandbox-common.sh && cs_supabase stop'` — **plain `stop`, no `--no-backup`**: the port is the problem, the data is not, and `--no-backup` would discard the local database to free a socket. If containers survive that, `docker ps -aq --filter name=supabase_ \| xargs -r docker rm -f`. Then `rm -rf /tmp/cloud-sandbox-up.lock && bash scripts/cloud-sandbox-up.sh`. If `docker ps -a` is **empty** and the port is still held, the holder is outside this Docker daemon — report that, it is not something the scripts can fix |
| `cannot connect to the docker daemon at unix:///var/run/docker.sock`; sentinel says `(deterministic)` | The daemon died *after* bringup started it. `cs_ensure_docker_daemon` runs first and `fail()`s with `Docker daemon did not start.` when it never comes up, so seeing this inside a `supabase start` log means it came up and then went away — usually the sandbox reclaiming it, or `dockerd` exiting on a privilege error | **Read `/tmp/dockerd.log` first** — it holds the reason, and the bringup log does not. If `dockerd` exited for lack of privileges that is an environment-config report, not a repo fix. Otherwise re-run `rm -rf /tmp/cloud-sandbox-up.lock && bash scripts/cloud-sandbox-up.sh`; a daemon that dies repeatedly in the same session is worth reporting rather than retrying |
| `database files are incompatible with server`; sentinel says `(deterministic)` | A `supabase_db_*` data volume was initialised by a **different Postgres major version** than the pinned image now starting over it. Retrying cannot help; the volume is the problem | **Discard the volume** — nothing in the sandbox holds data worth keeping and every table is rebuilt from `supabase/migrations/` on the next `db push`; if you believe otherwise, stop and ask rather than deleting. Order matters: `bash -c '. scripts/lib/cloud-sandbox-common.sh && cs_supabase stop --no-backup'` deletes the volumes by itself, but a crash-looping db container often makes that stop fail — so if it errors, run `docker ps -aq --filter name=supabase_ \| xargs -r docker rm -f` **first** (`docker volume rm` refuses a volume still attached to a container, even a stopped one), then `docker volume ls -q --filter name=supabase_db \| xargs -r docker volume rm`. Then re-run bringup. Background on the mismatch: [`getting-started.md`](../../guides/getting-started.md#postgres-17-and-local-supabase-volumes) — its `scripts/local-dev-setup.sh --reset-supabase-data` is the laptop equivalent, but it drives `npx supabase`, so use the pinned CLI here |
| Every `turbo` gate dies with `sh: 1: turbo: not found` (`check-types`, `lint`, workspace tests) while the plain-node gates such as `check:npm-audit` and `check:migration-safety` pass; or the sentinel says `'node dependencies missing or incomplete (dependencies)'` | `node_modules` is empty or half-populated. `cloud-sandbox-setup.sh` installs deps **non-fatally** on purpose and its warning goes to the web UI's environment setup log, which the session cannot read — so a failed install used to reach a green `.done` silently. The selective-looking split is the tell: only gates that shell out to `turbo` are affected | **Not a repo defect, and not `turbo.json`** — that is the wrong trail this row exists to close. Run **`npm ci`**; bringup deliberately does not run it for you (see *How it works*). Bringup's last step now checks the toolchain, so a `.failed` naming `(dependencies)` means turbo could not run. Note what `.done` does and does not promise: it means turbo ran, **not** that the tree is complete — a missing declared dependency only logs `WARN: 'npm ls --depth=0' reports a missing declared dependency` and still lands `.done`, so a later `Cannot find module` is worth tracing back here. **If `npm ci` cannot reach the registry that is a network-policy report** — `registry.npmjs.org` is not covered by the `policy` remedy above — and because setup's filesystem is cached ~7 days, a NEW session inherits the same broken tree until it is fixed |
| Auto-bringup never starts (no `.done`/`.failed`, no log) | Marker absent and `FRAPP_CLOUD_SANDBOX` unset | Set `FRAPP_CLOUD_SANDBOX=1` (or confirm the setup script ran to write the marker) |
| Log ends mid-step with no `.done`/`.failed` (e.g. frozen at "Starting Docker daemon") | A prior bringup was killed when the session paused/was reclaimed, leaving a stale `/tmp/cloud-sandbox-up.lock` | Self-heals — the SessionStart hook clears the stale lock and relaunches next session. To force it now: `rm -rf /tmp/cloud-sandbox-up.lock && bash scripts/cloud-sandbox-up.sh` |
| `Error: No matching Supabase CLI binary package found for linux-x64` (from `supabase/dist/supabase.js`), then a sentinel reading `'supabase start' failed (toolchain)` | The Supabase v2 CLI ships its binary as a platform-specific **optionalDependency** (`@supabase/cli-<platform>`). If that optional install is skipped, the launcher finds no binary and throws — and npx caches the broken tree under `~/.npm/_npx`, so it stays broken all session | **Repo fix, not an env change** — already handled: both scripts go through `cs_supabase`, which installs a pinned CLI into `.cache/supabase-cli/` and probes it by running `--version`. If it recurs, delete `.cache/supabase-cli/` to force a clean reinstall |
| API logs `42501 permission denied for table <name>` and `/health` reports `{"database":"error"}` / `degraded`, on a bringup that otherwise succeeded | The pinned `supabase/postgres` image (17.6.x) ships a default ACL for role `postgres` in schema `public` granting `anon`/`authenticated`/`service_role` only `Dxtm` — the DML bits `arwd` are missing. Migrations are applied as `postgres`, so every table inherits it. The **defect** is not cleared by `supabase db reset --local` — a reset rebuilds from the same template and reintroduces it (and drops the repair) | **Already handled at bringup** — `frapp_repair_local_acls` (shared with the laptop path via `scripts/lib/local-postgres-acl.sh`) runs after `db push`, granting table/sequence DML and fixing the schema's default privileges for future migrations. **Re-run `rm -rf /tmp/cloud-sandbox-up.lock && bash scripts/cloud-sandbox-up.sh` after any `supabase db reset --local`**, which is the usual way this reappears mid-session (the lock cleanup keeps a resumed session from launching a second concurrent bringup). Confirm with `select defaclacl from pg_default_acl where pg_get_userbyid(defaclrole)='postgres' and defaclnamespace::regnamespace::text='public' and defaclobjtype='r';` — healthy shows `anon=arwdDxtm/postgres`, broken shows `anon=Dxtm/postgres`. The repair deliberately never grants function `EXECUTE` (the RPC migrations lock that down explicitly) |

Env var and network changes **apply to new sessions only** — the user must start a fresh
session for them to take effect.

**Not every row is a "stop and report".** Four kinds live in that table:

- **Environment config** (allowlist, Docker Hub creds, missing setup script, absent marker,
  `dockerd` denied its privileges, npm unable to reach the registry) — the user changes a
  setting in the Claude Code web environment, and only a **new** session picks it up. This is
  the case the "stop and report" rule is about.
- **No action needed** (retried transients, the PostHog telemetry line) — already handled in
  the scripts. Reporting these as blockers is a false alarm.
- **Repo fixes** (the missing Supabase CLI binary, the edge-runtime rlimit, the dependency
  precondition) — fixed in-tree, not in the web UI.
- **Session-local state** (a port held by a leftover `supabase_*` container, a Postgres data
  volume from a different major version) — nobody's config is wrong and no code is broken;
  some scratch state from earlier in *this* session is in the way, and the agent clears it
  and re-runs. Fix it, do not report it. It was worth naming as its own kind because the
  three above all imply someone else acts, and these are the rows where **you** act — and
  because `deterministic` is fail-fast, so nothing clears them for you.

A registry outage that outlasts every retry sits outside all four: nobody's config is wrong,
nothing local is in the way, and the only move is to try again later.

Prefer the pinned CLI (`cs_supabase`) over `npx supabase` in any new script: unpinned npx
re-resolves `latest` every session, so the toolchain can change under you between runs.

## Manual / fallback bringup

If auto-bringup is off or you need to drive it by hand, run the same script directly:

```
bash scripts/cloud-sandbox-up.sh
```

Or step through it: start the daemon (`sudo dockerd &>/tmp/dockerd.log &`, wait for
`/var/run/docker.sock`), then use the pinned CLI —
`.cache/supabase-cli/node_modules/.bin/supabase start`, then `… db push --local` — then **repair
the default ACLs** (see below), and build `apps/api/.env.local` from `… status -o env` + the
Stripe vars plus `apps/web/.env.local` carrying the same URL and anon key under
`NEXT_PUBLIC_` names (and `NEXT_PUBLIC_API_URL=http://127.0.0.1:3001`). (Source `scripts/lib/cloud-sandbox-common.sh` and call `cs_supabase` to get the
install-on-first-use behaviour instead of managing that path by hand.) For migration
validation without Docker at all, use the PGlite harness (`npm run check:pglite-migrations`).

**Do not skip the ACL repair when stepping through by hand** — without it the API's first query
is `42501 permission denied for table chapters`. Re-running
`rm -rf /tmp/cloud-sandbox-up.lock && bash scripts/cloud-sandbox-up.sh` is the easiest way to
apply it. To call it directly, source
[`scripts/lib/local-postgres-acl.sh`](../../../scripts/lib/local-postgres-acl.sh) and run
`frapp_repair_local_acls "$PWD"`; the equivalent SQL, which must be run as `postgres` (with
`psql -X`, so a personal `~/.psqlrc` cannot roll it back) and must **not** grant function
`EXECUTE`:

```sql
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
```

⚠️ **`supabase db reset --local` undoes this.** The reset rebuilds the database from the
image's template, dropping both the grants and the altered default privileges, so an
otherwise-healthy session starts returning `42501` mid-run. Re-run the repair (or the whole
bringup script) after any local reset.

## Live staging egress

The four staging hosts in the allowlist above let a sandbox session
reach the **deployed staging environment**, not just the local stack. This is what retires
most of the "Runtime checks BLOCKED" protocol in
[`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md) — see
[`.claude/skills/live-verification/SKILL.md`](../../../.claude/skills/live-verification/SKILL.md)
for how an agent is expected to use it.

| Line | Reaches |
| ---- | ------- |
| `staging.frapp.live` | the landing site (apex — see wildcard note) |
| `*.staging.frapp.live` | `app.staging.frapp.live`, the web dashboard |
| `api-staging.frapp.live` | the Render-hosted API. A **sibling** of `staging.frapp.live`, not a subdomain of it, so `*.staging.frapp.live` does **not** cover it |
| `hnoyzpidbmizhbqaiity.supabase.co` | the hosted `frapp-staging` project — Realtime, Presence, GoTrue. The **staging project ref**, not a wildcard; if the project is ever rotated this line must be updated — and so must [`ci/environments.json`](../../../ci/environments.json), which `run-migration.mjs` fails closed against and `check-migration-order.mjs` reads, so a rotation that misses it blocks every production migration and every migration-bearing PR. The bringup probe below is what will tell you about this line |

### Wildcard semantics — weaker than the docs imply

The [cloud environments docs](https://code.claude.com/docs/en/cloud-environments#access-levels)
say "a leading `*.` matches every subdomain". Probing this sandbox shows that is not a safe
thing to rely on for a **Custom** entry. Two observations, both from the live proxy:

- **A Custom `*.` matched exactly one label.** With `*.supabase.co` in the allowlist,
  `<ref>.supabase.co` was allowed but `db.<ref>.supabase.co` was **rejected**
  (`connect_rejected` in `$HTTPS_PROXY/__agentproxy/status`). The *default* list behaves
  differently — `s3.us-east-1.amazonaws.com` resolves through its `*.amazonaws.com` at two
  labels deep — so default-list and Custom entries do **not** match identically, and the
  docs do not say so.
- **It does not match the apex**, under either. `amazonaws.com`, `googleapis.com`, and
  `supabase.co` are all blocked while their subdomains are allowed. That is why
  `staging.frapp.live` needs its own line.

**Operating rule: do not rely on `*.` spanning more than one label. Enumerate the host.**
`*.staging.frapp.live` is kept only because `app.staging.frapp.live` is exactly one label
deep; it is not evidence that deeper patterns work.

### Enumerate, do not wildcard

Both tempting shortcuts are wrong for the **same** reason: prod and staging share an apex,
on both domains.

| Shortcut | Also grants | Prod host it exposes |
| -------- | ----------- | -------------------- |
| `*.frapp.live` | the production web + API | `app.frapp.live`, `api.frapp.live` |
| `*.supabase.co` | the **production database project** | `unttyvyfezddlyafcydh.supabase.co` |

The second is the easier one to get wrong, because nothing in the hostname says "prod" —
`frapp-staging` is `hnoyzpidbmizhbqaiity` and `frapp-prod` is `unttyvyfezddlyafcydh`, two
opaque refs on one apex (`mcp__Supabase__list_projects` maps them). A single `*.supabase.co`
line therefore hands every unattended session a route to production data, which is exactly
what enumerating the `frapp.live` hosts was meant to prevent. This was shipped once and
caught by probing; the negative assertion in the bringup probe exists so it cannot happen
quietly again.

Reaching a prod host is not the same as reading prod data — that still needs prod
credentials, which this environment does not hold. But the environment's variables are, by
this doc's own rule above, visible to anyone who can edit it, so the two are one
configuration change apart. Staging is the blast radius we accept. **Enumerate.**

### What this does not unlock

- **Authentication.** Egress gets you an unauthenticated socket. Authenticated probes need
  a staging user; `scripts/ci/staging-conformance.mjs` already defines the convention
  (`STAGING_SMOKE_USER_EMAIL` / `STAGING_SMOKE_USER_PASSWORD`). Use a dedicated smoke
  account, never a real member's.
- **Provider APIs.** Render, Vercel, Sentry, and PostHog stay blocked to direct `fetch` — with
  one **unexplained** exception, a bare `vercel.com` line the live allowlist carries and this
  repo never asked for (see [What's configured in the web
  UI](#whats-configured-in-the-web-ui)); it is drift pending removal or justification, not a
  sanctioned path, so do not build on it. Otherwise
  agents fall back to **MCP connectors**, which do not go through this allowlist at all —
  those parts of the MCP-based
  [`infrastructure-research`](../../../.claude/skills/infrastructure-research/SKILL.md)
  workflow are unaffected either way. **Infisical is the exception: it has no MCP connector
  that can read secrets** — its only hosted MCP is a docs assistant, and the official secrets
  server `@infisical/mcp` is stdio-only, so it would run *inside* the sandbox under this same
  allowlist. The sanctioned path is therefore direct `fetch`, with `app.infisical.com` on the
  Allowed domains ([#1279](https://github.com/pdcarlson/Frapp/issues/1279)'s decision — the
  line is part of the standard configuration above); in an environment not yet carrying it,
  the host is blocked and Infisical is unverifiable from that sandbox. The network is
  not the secrecy boundary there — the service token is, scoped `dev` + `staging`
  read-only, never `prod`. **Both halves were verified live on 2026-08-27** from a fresh
  sandbox: `app.infisical.com/api/status` answered `Ok`, the token listed `dev` and `staging`
  secret names, and `GET /api/v2/service-token` reported exactly those two scopes with `read`
  permission. Note the boundary is quiet about itself — an out-of-scope environment returns
  `200` with **zero** secrets rather than a 403, so never read scope off a listing
  (see [`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md)). Only raw-`fetch` scripts
  like `staging-conformance.mjs` notice the difference for the other four, and those run in
  CI, where the allowlist does not apply.
- **Per-deployment Vercel URLs.** Of the deployment surfaces, only the aliased staging
  hostnames are allowlisted, not the unique `*.vercel.app` URL each deployment also gets.
  (The unexplained bare `vercel.com` entry noted above is the dashboard apex and does not
  cover `*.vercel.app` either.) When the alias lags behind the
  latest `main` build — the known Vercel behaviour described in
  [`../ops/DEPLOYMENT.md`](../ops/DEPLOYMENT.md) — you can reach what the alias currently
  points at, not the newer deployment behind it. Check the alias state via the Vercel MCP
  tools rather than assuming the hostname is current.
- **Writes being safe.** Nothing about egress makes a `POST` reversible. The skill's
  read-only default exists for that reason.

### Checking whether egress is live

**Do not probe by hand — it has already been done.** `scripts/cloud-sandbox-egress-probe.sh`
runs as the **first** step of bringup and writes `.cloud-sandbox-capabilities.json` at the
repo root (gitignored — it describes one environment's policy at one moment).
`.claude/hooks/session-start.sh` summarises it into the session context — but only in a
cloud sandbox (the whole block is gated on the `/etc/frapp-cloud-sandbox` marker, so a
laptop session never sees the line), and only on a fire that finds a manifest already on
disk **and written by the bringup that is already running** — a resume, a `/clear`, a
`/compact`, a second session in the same container. Freshness is decided by comparing the
manifest against the bringup lock's mtime, so any fire that *starts* a bringup stays silent
rather than reporting the previous run's answer: a stale `production correctly blocked`
would mask a `SECURITY` warning the new probe is writing right then. **The first session in
a fresh container therefore never carries the line**, and neither does a session that
cleared a stale lock or hand-restarted bringup. There you get the bringup notice, which
names the file, so read the file. **An absent `EGRESS:` line is never evidence the probe
did not run.**

It runs first, not last, for a reason worth knowing: **egress does not depend on the local
stack.** Reaching deployed staging needs no Docker, no Postgres, no containers. With the
probe at the end, any earlier `fail()` — a denied ulimit, an unhealthy container, an image
pull out of retries — exited before it and left the session with no manifest despite
perfectly good egress. That is backwards, because a session whose local stack just died is
the one most likely to fall back on live staging. It also means the manifest is ready
within about a second, long before the ~60–90s bringup lands `.done`.

```bash
# Read the answer
python3 -m json.tool .cloud-sandbox-capabilities.json

# Re-probe after changing the allowlist (or on a laptop, where bringup never ran)
bash scripts/cloud-sandbox-egress-probe.sh
```

The manifest reports three outcomes, and the distinction is the point:

| `status` | Means |
| -------- | ----- |
| `reachable` | the host answered — any HTTP code counts, including the 302 the web hosts return and the 404 the Supabase root returns |
| `blocked` | the connection was refused at the connect layer — `curl: (56) CONNECT tunnel failed, response 403` is the policy denial this normally means, but exit 35 (TLS) and 7 (refused) are grouped with it because the proxy's teardown varies. A staging host that is simply **down** therefore also reports `blocked`, and **nothing available in the sandbox separates the two**: the proxy's own `detail` reads `policy denial or upstream failure`. Say "not reachable" and name the host; do not assert the allowlist is wrong unless the line is genuinely absent from the environment |
| `timeout` / `no_dns` / `unknown` | the probe **could not tell**. Not a pass and not a fail; `ok` is `null` and it never counts toward either total |

That third row is why the manifest exists rather than a bare `curl`: a timeout looks
exactly like a block to a one-line probe, and acting on the wrong one wastes a session.
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` remains the ground truth for *which* host the
proxy refused, listed under `recentRelayFailures`.

The probe also asserts **negatively** that three named production hosts are unreachable —
`api.frapp.live`, `app.frapp.live`, and the `frapp-prod` Supabase ref. A prod host that
answers is reported as a `SECURITY` warning, not as extra capability — that is the tripwire
for an allowlist that has been widened back to a wildcard. Note what it does *not* cover:
the apexes themselves (`frapp.live`, `supabase.co`) are unprobed, as is `www.frapp.live`,
and nothing tests the label-depth behaviour from [Wildcard semantics](#wildcard-semantics--weaker-than-the-docs-imply). The negative assertion catches
a wildcard regression through the hosts it names, not every shape one could take.

It runs per session, never in `cloud-sandbox-setup.sh`: that script's filesystem is cached
for ~7 days, and a week-old cached answer about a policy that can change between sessions
is worse than no answer.

## Still out of scope

- **Supabase MCP write tools** (`create_branch`, `apply_migration`) are not allowlisted in
  `.claude/settings.json`, so they prompt — which unattended sandboxes cannot approve (the
  committed file has never carried a deny rule; see
  [`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md)). Local Supabase covers DB + migrations
  without them.
- **Push fanout**, but read the halves separately — they differ, and the obvious summary
  is wrong. **APNS is unreachable**: `api.push.apple.com` and `api.sandbox.push.apple.com`
  both fail the policy check, and no Apple host is proposed for the allowlist. **FCM's HTTP
  endpoint is already reachable** — `fcm.googleapis.com` resolves through the *default*
  Trusted entry `*.googleapis.com`, with no Frapp-specific line involved. That is transport
  only: an actual fanout test still needs service-account credentials and a real device
  token to deliver to, so end-to-end push remains a "Runtime checks BLOCKED" case under
  [`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md). Probe before assuming either way.
- **Live Realtime/Presence and RLS-as-GoTrue** are out of scope *only when the staging
  egress above is not configured*. With it plus a staging smoke credential they are
  reachable against hosted `frapp-staging` — that is the point of
  [Live staging egress](#live-staging-egress). Confirm with the `curl` probe there before
  claiming either way; do not infer it from this doc.
- **Production**, deliberately and permanently. Not an unconfigured gap — an excluded one.
