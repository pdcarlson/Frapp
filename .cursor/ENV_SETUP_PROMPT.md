# Frapp / Cursor Cloud environment setup

You are running **Cursor `/env setup`** for the **Frapp** monorepo (this checkout; confirm the GitHub remote with `git remote -v`). Follow the env-setup skill (`$HOME/.cursor/skills-cursor/env-setup/SKILL.md`) and the matching workflow reference after you call `environment-info`.

**Your job:** make a first-class Cursor Cloud environment that boots Docker + local Supabase + generated app env files + the three web/API/landing terminals, **without Infisical during Builds**, without wrapping Claude hooks as the owner, and without putting secrets in `environment.json`. Paul (the owner) will **Save** in the Environment panel when you propose. Do not claim Saved until he does.

This prompt is self-contained. Re-verify every claim against the checkout you actually have.

---

## 0. How to run this skill (mandatory)

1. Call **`environment-info`**. Record environment ID, URL, `environmentJsonPath`, current `environmentJson`, `repos[]` (use those exact strings for `refs[].repoUrl`), effective egress, and whether a Build already exists.
2. Read the matching env-setup reference and **follow it**:
   - Non-empty `environmentJsonPath` → `references/update-repo-managed-environment.md` (push a branch, trigger a draft Build **from that revision**, **do not** pass `environmentJson` override).
   - Null/absent `environmentJsonPath` but an environment ID exists → `references/update-db-managed-environment.md` (snapshot this VM, `trigger-environment-build` with `environmentJson` = READY snapshot + install/start under test, verify, `propose-environment-json` with `buildId`).
   - No environment at all → `references/create-environment.md`.
3. **Also keep `.cursor/environment.json` as the committed public contract.** The file already exists on `main`. A 2026-09-09 internal run reported `source: Repository` / `recordedVia: REPO_FILE_OBSERVED` but `environmentJsonPath: null` and `build: null`. Do not argue with the tool: follow the matching reference, and still write the same install/start/terminals/ports into the repo file so the next agent is repo-managed.
4. Schema: <https://cursor.com/schemas/environment.schema.json>. **Do not add `$schema`** (`unevaluatedProperties` is false). Setup guide: <https://cursor.com/docs/cloud-agent/setup>.
5. Asking to set up this environment **is** the explicit request to snapshot / draft-build / propose per the skill. Do that **after** the current VM works. Blockers (secrets, egress) must be requested with `cursor-cloud-request-environment-setup-actions` **before** snapshot/build/propose.
6. Do **not** deploy, mutate production, restore Linear, or run live `npm run configure:branch-protection` (the `:verify` variant is fine if you need to *read* protection).

---

## 1. Hard constraints (do not violate)

- **Do not delete `.claude/**` or Claude sandbox scripts.** Claude stays as fallback until a later cleanup chat. Cursor Cloud already loads `.claude/skills`; **do not copy** that tree into `.cursor/skills`.
- **Do not rewrite AGENTS.md** except a short `## Cursor Cloud specific instructions` section **if** future agents still need a wait-for-stack snippet that is not already obvious from `environment.json` terminals/start. Put runtime facts in `install`/`start`/`terminals`, not a novel. Do **not** rewrite babysit / PR-subscribe / tool-name policy (Prompt 2).
- **Do not implement Cursor Automations, hooks.json review-gate fail-closed wiring, or Bugbot as policy.** Automations overlap with Claude Routines during transition is fine and **out of scope**. Hygiene Scan must not be enabled until this stack is healthy.
- **Do not put secrets, tokens, or `.env` values in `environment.json`, Dockerfiles, committed scripts, logs, or chat.** User secrets are **unavailable during Builds**. `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` must be **environment or team secrets** (so install/start can `docker login`). Optional Stripe test keys may be environment secrets; if absent, bringup writes non-empty placeholders and the API still boots (billing calls will not work).
- **Do not put an egress allowlist into `environment.json` as a guess.** Egress is a **dashboard** decision (GitHub #2025). Request domains via `add_egress_allowlist_domain`. Paul applies Custom allowlist in the UI (see §7).
- **Do not restore `LINEAR_API_KEY` / Linear.** Work tracking is GitHub Issues.
- **Do not require Infisical for Builds.** `start` must generate `apps/api/.env.local` and `apps/web/.env.local` from local `supabase status` (gitignored). Laptop Infisical remains a separate path (`docs/internal/environment/LOCAL_DEV.md`).
- **Do not start Expo/mobile.** Headless VMs cannot run Expo Go.
- **Do not rewrite `package-lock.json`, widen the React `19.2.3` pin, or flatten TypeScript 7.** `npm ci` only.
- **Do not call `.claude/hooks/session-start.sh` as the Cursor start owner.** Cursor Cloud has no Claude `SessionStart` hook. `environment.json` `start` owns per-boot bringup. Cursor `sessionStart` hooks are not available on cloud agents.

---

## 2. What this repository is

Turborepo + npm workspaces: **4 apps, 13 shared packages**. Product apps that must run in the cloud VM:

| App | Workspace | Dev command | URL |
| --- | --- | --- | --- |
| Web (Next.js admin) | `apps/web` | `npm run dev -w apps/web` | http://localhost:3000 |
| API (NestJS) | `apps/api` | `npm run start:dev -w apps/api` | http://localhost:3001 — Swagger http://localhost:3001/docs — liveness `GET /health` |
| Landing (Next.js marketing) | `apps/landing` | `npm run dev -w apps/landing` | http://localhost:3002 |
| Mobile (Expo) | `apps/mobile` | skip in cloud | — |

Canonical laptop ports: `docs/internal/environment/LOCAL_DEV.md` § Ports and URLs. Local Supabase (from `supabase/config.toml`): **Kong/API `54321`**, Postgres `54322`, Studio `54323`. `LOCAL_DEV.md` lists Studio but omits `54321`; `environment.json` already exposes `54321` and `54323`. Keep both. You do not need to publish `54322`.

Pinned runtime: **Node 20** (API Dockerfile `node:20-alpine`, CI `node-version: 20`). Cursor’s base image often injects **Node 22** at the front of `PATH`. Node 22’s `ERR_REQUIRE_CYCLE_MODULE` breaks `nest start`. Terminals **must** run through `scripts/cursor-node20.sh` (nvm Node 20 prepended). Do not drop that wrapper.

Package manager: **npm** + root `package-lock.json`. Install with `npm ci`. After `npm ci`, build **only** shared packages (`./node_modules/.bin/turbo run build --filter='./packages/*'`). Do **not** `npm run build` the whole graph during install: `next build` for `apps/web` prerenders pages that need `NEXT_PUBLIC_SUPABASE_*`, which only exist after `start` writes `apps/web/.env.local`.

---

## 3. Current Cursor setup (improve; do not throw away)

Committed on `main` today (re-read the files; do not trust this dump if they drifted):

`.cursor/environment.json`:

- `name`: `Frapp`
- `user`: `ubuntu`
- `install`: `bash scripts/cursor-agent-install.sh`
- `start`: `bash scripts/cursor-agent-start.sh`
- `terminals`: `api` / `web` / `landing` via `scripts/cursor-node20.sh`
- `ports`: 3000, 3001, 3002, 54321, 54323

Dashboard environment (as of 2026-09-09; re-read `environment-info`):

- ID: `b91a291a-8c6a-486c-adb7-f5a7a1773ddc`
- URL: https://cursor.com/dashboard/cloud-agents/environments/e/b91a291a-8c6a-486c-adb7-f5a7a1773ddc
- No active Build on a sampled internal run (`build: null`) — just-in-time start. **A tested Build is a goal of this session.**

What already works (battle-tested, keep the behavior):

| Piece | Role |
| --- | --- |
| `scripts/cursor-agent-install.sh` | Idempotent: Docker Engine + `fuse-overlayfs` + `/etc/docker/daemon.json` (fuse-overlayfs, IPv6, ip6tables — nested VM + Supabase Realtime), nvm **Node 20**, `npm ci`, turbo build `packages/*`, pre-pull Supabase images via `scripts/cursor-agent-prepull.sh` (`sg docker`). |
| `scripts/cursor-agent-start.sh` | Per-boot sysctls (`bridge-nf-call-iptables=0`, IPv6), then `sg docker` + bringup. Must **return** after readiness. |
| `scripts/cloud-sandbox-up.sh` | Per-boot stack: dockerd, `supabase start -x edge-runtime`, `db push --local`, write both `.env.local` files, Postgres ACL repair, chapter-directory seed (non-fatal), **last** `node_modules` check. Sentinels: `.cloud-sandbox-up.done` / `.cloud-sandbox-up.failed`. Log: `/tmp/cloud-sandbox-up.log`. |
| `scripts/lib/cloud-sandbox-common.sh` | Pinned Supabase CLI **2.110.0** in `.cache/supabase-cli/` (not CI’s 2.77.0 — Realtime IPv6), docker login, retry classifier (policy / ratelimit / deterministic vs transient). |
| `scripts/cloud-sandbox-setup.sh` | **Claude** cached setup (`bash scripts/cloud-sandbox-setup.sh \|\| true` in the Claude UI). Do not make Cursor `install` *call this as the owner*. Its useful work (npm ci + image pre-pull) is already in `cursor-agent-install.sh`. Leave the file in-tree for Claude fallback. |
| `.claude/hooks/session-start.sh` | Claude-only background bringup. Not Cursor’s contract. |

Load-bearing nested-Docker facts (do not “simplify” away):

- Nested/unprivileged VM: Docker needs **`fuse-overlayfs`** and `containerd-snapshotter: false` or Supabase layer extract fails (`operation not permitted` whiteouts).
- `--force-confold` when apt-installing `fuse-overlayfs` (base image’s `/etc/fuse.conf` otherwise hangs on a conffile prompt).
- **IPv6 on the Docker network**: Realtime uses `ECTO_IPV6=true`.
- **`net.bridge.bridge-nf-call-iptables=0`** every boot (not in the snapshot): otherwise logflare/vector cannot reach Postgres.
- **Exclude edge-runtime** (`CS_SUPABASE_START_ARGS` default `-x edge-runtime`): Deno rlimit is denied and aborts the whole `supabase start`. Edge functions are not needed (logic is NestJS).
- `sg docker` because `sg` runs `/bin/sh`: bash-only helpers must live in their own `.sh` files (`cursor-agent-prepull.sh`).

---

## 4. Target: Cursor-owned install / start / terminals (Option A rewrite)

Paul’s decision: **Cursor manages setup.** `start` is part of Cursor-managed setup, not a Claude-script wrap forever.

**Default (do this): least-risk rewrite, Cursor owns the contract, shared script remains the implementation.**

A from-scratch rewrite of `cloud-sandbox-up.sh` + `cloud-sandbox-common.sh` in this session is **too large**. You would have to re-prove: ACL repair ordering vs env-file write, retry classification (allowlist vs Hub 429 vs CDN 5xx), `write_env_files` key validation, `(dependencies)` sentinel semantics, seed non-fatality, and IPv6/iptables. Do not gamble that.

Concrete rewrite to land:

1. **Keep** `scripts/cursor-agent-install.sh` as `install` (Cursor-owned). Optionally rename to `scripts/cursor-cloud-install.sh` **only if** you update every reference in the same change and prove install still idempotent. Prefer keeping the current name unless the rename is trivial.
2. **Extract** a Cursor-owned per-boot entrypoint `scripts/cursor-cloud-up.sh` that:
   - is what `environment.json` `start` invokes (directly or via a thin `cursor-agent-start.sh` that only applies boot sysctls then calls this script);
   - **does not** mention Claude hooks, `CLAUDE_PROJECT_DIR`, or `/etc/frapp-cloud-sandbox` as the *reason* it runs;
   - **may** `exec` or source the existing bringup so behavior stays identical;
   - still writes the **existing sentinels** `.cloud-sandbox-up.done` and `.cloud-sandbox-up.failed` (gitignored). Agents and docs already wait on those names. You may *also* write `.cursor-cloud-up.done` as an alias, but **do not drop the old names** in this phase.
3. Leave `scripts/cloud-sandbox-up.sh` in place so Claude fallback SessionStart keeps working. Prompt 2 (later) deletes Claude-branded ownership once Cursor start is observed healthy.
4. **`start` must start dockerd, bring Supabase up, write env files, then return.** Dev servers do **not** belong in `install` or as blocking processes inside `start`.
5. **`terminals`** stay the three app servers. **Improve them** so they wait for the success sentinel (or fail if `.failed` appears) before `npm run …`. Today they can race `start` and the API dies on missing `SUPABASE_URL`. Example shape (adapt, do not invent a second stack):

```bash
# wait for start-written sentinel, then exec the app
while [ ! -f .cloud-sandbox-up.done ] && [ ! -f .cloud-sandbox-up.failed ]; do sleep 2; done
if [ -f .cloud-sandbox-up.failed ]; then echo "stack bringup failed"; cat .cloud-sandbox-up.failed; exit 1; fi
exec bash scripts/cursor-node20.sh npm run start:dev -w apps/api
```

6. Prefer **Cursor’s default base image** unless you prove a system package is missing from it. The current install already installs Docker + fuse-overlayfs on first run (persists into a Build snapshot). A custom `.cursor/Dockerfile` is optional, not required. If you add one, do **not** `COPY` the whole repo; install `git` + `curl`; keep `user: ubuntu`; still run nvm Node 20 in `install` (do not assume the image’s Node is 20). Nested Docker: start from Cursor’s fuse-overlayfs + iptables-legacy recipe in <https://cursor.com/docs/cloud-agent/setup> § Running Docker, merged with the **IPv6 daemon.json** this repo already needs.
7. `install` must be idempotent and terminate. Run it twice on this VM before snapshotting.
8. `start` must be idempotent (already-running dockerd / supabase, no duplicate daemons, fail clearly).

---

## 5. Health checks agents must have

Keep a **file sentinel**, not “read the log and guess.”

| Signal | Meaning |
| --- | --- |
| `.cloud-sandbox-up.done` | Stack ready: Docker, Supabase, migrations, both `.env.local` files, ACL repair. Body may contain a WARN if `npm ls` is incomplete but turbo runs. |
| `.cloud-sandbox-up.failed` | Stop. Body is the human-readable class + hint. **Do not work around.** |
| Failed sentinel contains `(dependencies)` | **Exception:** stack is up; only `node_modules` is unusable. Fix **in this VM** with `npm ci`. Report only if `npm ci` cannot reach the registry (egress). |
| `/tmp/cloud-sandbox-up.log` | Live bringup log (also used as `CS_RETRY_LOG_LOCATION`). |
| `.cloud-sandbox-capabilities.json` | Staging-egress probe (written early). Read it; do not curl production to “check.” Production hosts must stay **blocked**. |

After terminals are up, prove the product:

1. `curl -fsS http://127.0.0.1:54321/health` or `supabase status` (Kong up).
2. `curl -fsS http://127.0.0.1:3001/health` (API liveness).
3. A real action, not just a process list: e.g. open Swagger `/docs`, or `GET /health/ready`, or create a trivial row through an existing test/script. Loading a blank page is not enough (env-setup skill).
4. Confirm `apps/api/.env.local` and `apps/web/.env.local` exist and are gitignored. They must contain local demo keys from the CLI, **not** hosted prod keys.
5. Confirm `git status` does not want to commit those env files.

Symptom table if bringup fails: `docs/internal/environment/CLOUD_SANDBOX.md` § When bringup fails — STOP and report. Trust `.failed` over the log.

---

## 6. Secrets model (dashboard, never JSON)

**Builds cannot see user secrets.** Anything `install` or `start` needs at Build time must be **environment or team** secrets.

Request with `add_secrets` when missing (confirm absence first):

| Name | Required? | Why |
| --- | --- | --- |
| `DOCKERHUB_USERNAME` | **Yes for reliable Builds** | `supabase start` / mailpit etc. pull from Docker Hub; anonymous Hub 429 is classified `ratelimit` and is fatal. |
| `DOCKERHUB_TOKEN` | **Yes for reliable Builds** | Read-only Hub token, not the account password. |
| `STRIPE_SECRET_KEY` | Optional | Test-mode only. Placeholders keep the API booting. |
| `STRIPE_WEBHOOK_SECRET` | Optional | Same. |
| `STRIPE_PRICE_ID` | Optional | Same. |

**Do not request for Builds (not required to boot the local stack):** Infisical tokens, `GITHUB_PAT`, Render/Vercel/Supabase management keys, any production key. Research creds are documented in `docs/internal/environment/AGENT_CREDENTIALS.md` and are optional for *agents*, not for environment snapshot.

App secrets for the running API/web come from **generated `.env.local`**, not from Infisical, during cloud sessions. Canonical Infisical grid for laptops/deploys: `docs/internal/environment/ENV_REFERENCE.md`. Do not invent a second grid.

---

## 7. Egress allowlist — when Paul sets it, and the host list

**When (Paul, in the Cursor environment dashboard):**

1. **Before or during this `/env setup` session’s first image pull / first draft Build** — `supabase start` needs **ECR Public + CloudFront**. Trusted-only / default-only policy fails with `403 Host not in allowlist` (`policy`, not retried).
2. **Immediately** when the env-setup agent calls `request-environment-setup-actions` with `add_egress_allowlist_domain` (complete those UI actions before expecting snapshot/build to proceed).
3. **After Save**, confirm the same Custom list is still attached to environment `b91a291a-8c6a-486c-adb7-f5a7a1773ddc` (or whatever `environment-info` returns). New sessions only pick up allowlist changes.

Use **Custom**, include Cursor’s default list, and add **exactly** these extra hosts (canonical Claude production-withholding list from `docs/internal/environment/CLOUD_SANDBOX.md` § What's configured in the web UI). **Do not invent hosts. Do not use `*.frapp.live` or `*.supabase.co`** (those wildcards include production).

```
public.ecr.aws
*.cloudfront.net
staging.frapp.live
*.staging.frapp.live
api-staging.frapp.live
hnoyzpidbmizhbqaiity.supabase.co
app.infisical.com
```

- First two: `supabase start` image pulls.
- Middle four: live **staging** only (`frapp-staging` ref `hnoyzpidbmizhbqaiity`). Optional for local-stack work; required for `/live-verification`.
- Last: Infisical API (#1279). Optional for Builds (we generate `.env.local`); needed later if an agent must list secret *names*.

**Omit `vercel.com`.** It is unexplained Claude-dashboard drift as of 2026-09-02. Nothing in-repo needs it.

**Must remain blocked:** `api.frapp.live`, `app.frapp.live`, `unttyvyfezddlyafcydh.supabase.co` (frapp-prod). The bringup probe asserts those negatives. **Do not set Network = Full.**

Agent: if a required registry host is blocked, request `add_egress_allowlist_domain` per host (or the wildcard line `*.cloudfront.net`) and **wait**. Do not disable TLS or widen to Full to make a Build pass.

---

## 8. MCP (which servers cloud agents need — not how to store keys)

Do not encode MCP API keys in `environment.json`. OAuth is per-user on Cursor Cloud.

| Server | Expectation |
| --- | --- |
| **GitHub** | Required. Tracker is GitHub Issues (MCP only; never `gh` / raw REST for issues/PRs). Must work for `/next` and later Automations. |
| **Granola** | Optional for env-setup itself. Often `needsAuth`. Do not block environment Save on it. Human re-auth: #2026. |
| **Supermemory** | Optional. May fail discovery. Do not block Save. Same human issue: #2026. |
| Cursor Cloud diagnostics | Built-in. Use `environment-info`, build logs, snapshot tools. |
| Other team MCPs (Supabase, Stripe, …) | Not required to *boot* the local stack. Do not fail setup because they needAuth. |

Do **not** set `disableAllMcpServers: true`. Leave `mcpServerAllowlist` unset unless team policy requires it.

---

## 9. Tiny AGENTS.md snippet (only if needed)

If you add `## Cursor Cloud specific instructions`, keep it to operational facts:

- Wait for `.cloud-sandbox-up.done` (or stop on `.failed`; `(dependencies)` → `npm ci`).
- API/web/landing are `terminals`; Node 20 wrapper is required.
- Generated `.env.local` means no Infisical to boot.
- On bringup failure, stop and report dashboard/egress/secrets; do not paper over it.
- Link `docs/internal/environment/CLOUD_SANDBOX.md` for the symptom table.

Do not paste Claude babysit tool names, `send_later` bans, or review-gate hook JSON here.

---

## 10. Validate, then snapshot / Build / propose

On **this** VM, before any snapshot:

1. System: `docker info`, `node -v` (20.x when using the wrapper), `git` present.
2. Final `install` command — **twice** (idempotent).
3. Final `start` command — succeeds, writes `.done`, returns.
4. Terminals: API `/health` 2xx; web and landing bind 3000/3002.
5. Representative product action (skill requirement).
6. No secrets in the diff. `git status` clean of `.env.local`.
7. Validate `environment.json` against the public schema (no extra fields).

Then follow the skill’s snapshot → draft Build → fresh-agent verify → `propose-environment-json` (`buildId` of the successful Build, **not** the raw snapshot id) → tell Paul to **Click Save**.

If a secret or allowlist host is missing, request it and **end the turn without proposing**.

Push any repo-file changes (`environment.json`, install/start scripts, optional AGENTS.md snippet) on a feature branch from updated `main` so the Build can see them when the flow is repo-managed. Branch naming: follow this session’s Cursor/cloud rules if any; otherwise `cursor-cloud-env-<short-id> (plus this session’s required agent branch prefix, if any)`.

---

## 11. Out of scope (Prompt 2 — do not do now)

After this environment exists and a later chat starts:

- Move skills `.claude/skills` → `.cursor/` and delete `.claude/**` once this chat is finished and Automations are considered.
- Strip AGENTS.md Claude-primary babysit tone; keep abstract; harness owns subscribe/tool names.
- Review-gate mechanics via **`/diff-review`** (abstract). Do **not** make Bugbot canonical.
- Cursor Automations paste/enable vs Claude Routines disable (see appendix; #2024 / #2027).
- ADR-16 “Cursor retired” correction in place (dated amendment). Related epic: **#2017**.

---

## Appendix — Automations vs Claude Routines (do not implement)

Owner reference only. Overlap during transition is fine.

**Keep as Cursor Automations later** (all must **attach this Frapp GitHub repository (`environment-info` `repos[]`)**; cron defaults to no repo). Spec: `docs/internal/ci-cd/ROUTINES.md`. Human paste: #2024. Observe a run before claiming live: #2027.

| Claude Routine | Cadence | Cursor Automation | Notes |
| --- | --- | --- | --- |
| Hygiene Scan | daily 06:00 ET | **Keep, enable last** | Needs this healthy full stack. Do not enable until `start` is observed green. |
| Issue Curator | daily 08:00 ET | **Keep** | GitHub MCP; no product code. |
| Issue Triage | daily 09:00 ET | **Keep** | After Curator. |
| PR Follow-ups | weekly Mon 07:00 ET | **Keep** | GitHub MCP. Marketplace “triage failed Actions” is adjacent, not a replacement. |
| Docs Upkeep | weekly Wed 07:00 ET | **Keep** | Needs git push / PR. |

**Drop / do not canonicalise now**

- Cursor Marketplace: Assign PR reviewers / PR Routing & Approval, Find vulnerabilities / Security Agents, Summarize changes daily, Fix bugs reported in Slack — not Frapp routines. Optional later; do not replace `/diff-review`.
- **Bugbot** — Paul is trying it; may not stick. Parallel experiment only.
- Linear Automations / `LINEAR_API_KEY` — retired. Old issue #740 is leftover, not a template to revive.
- Claude Routines — keep running until a Cursor Automation run is **observed**, then disable (#2027).

Docs: <https://cursor.com/docs/cloud-agent/automations>, marketplace templates at <https://cursor.com/marketplace/automations>. Cursor Cloud MCP `get-automation` is **read-only**; this env-setup agent cannot create Automations.
