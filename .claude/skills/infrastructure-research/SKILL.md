---
name: infrastructure-research
description: >
  Gather runtime truth from provider APIs (GitHub, Supabase, Render, Vercel, Infisical) when
  investigating deployment state, CI failures, environment configuration, secret sync, or service
  health. Use before proposing any infrastructure change, when reviewing PRs that touch CI or
  deploys, when debugging staging/production issues, or when checking whether secrets are in sync.
---

# Infrastructure Research

> Use when investigating deployment state, CI failures, environment configuration, or service health before proposing changes. Also applies when reviewing PRs, debugging production issues, or syncing secrets.

---

## Research-first principle

Before making infrastructure-related changes, gather runtime truth from the available APIs. This prevents stale assumptions and wasted effort.

**Available credentials:** the canonical list of provider/research env vars available in cloud agent sessions (`GITHUB_PAT`, `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN`, `INFISICAL_SERVICE_TOKEN` + `INFISICAL_PROJECT_ID`, `RENDER_API_KEY`, `VERCEL_API_KEY`, `SUPABASE_API_KEY`), including the full canonical-name/alias discussion, lives in [`docs/internal/environment/AGENT_CREDENTIALS.md`](../../../docs/internal/environment/AGENT_CREDENTIALS.md).

Notes needed by the recipes below:

- For `gh`/git, export the PAT as `GH_TOKEN` first: `export GH_TOKEN="$GITHUB_PAT"` (`gh` does not auto-read `GITHUB_PAT`). Node scripts read `GITHUB_PAT` directly. `gh` is a laptop/Actions tool here — it is not installed in cloud sandboxes, and it reads `HTTPS_PROXY`, so where it is present it would be expected to take the proxy route described below and 403 on repo-scoped paths (not measured).
- Older cloud VM images may expose legacy aliases (`GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`, `RENDER_APIKEY`). Scripts tolerate GitHub aliases where explicitly noted, but new snippets should use the canonical names.
- [`docs/internal/environment/ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md) is the canonical variable reference.

**Never print secret values.** Only reference variable names and presence/absence.

---

## GitHub: CI and PR status

**MCP first.** For anything the GitHub MCP exposes a tool for — workflow runs and job logs
(`actions_list`, `actions_get`, `get_job_logs`), PRs (`list_pull_requests`, `pull_request_read`),
issues, commits, branches — use the MCP. It is the sanctioned path, and the only sanctioned
**write** path for issues, PRs and comments. The `gh` recipes below are laptop/Actions recipes;
direct REST (further down) is a **read** channel for repo settings the MCP has no tool for.

### The `api.github.com` route rule (measured 2026-09-02)

Reachability of `api.github.com` from a cloud sandbox is **route-dependent, not session-dependent**
— the older "session-dependent, observed both blocked and working" framing was wrong. Measured on
one host, with one `GITHUB_PAT`, inside one minute:

- Anything that honours `HTTPS_PROXY` reaches the agent proxy's GitHub-credential layer, which
  answers **403** `{"message":"GitHub access is not enabled for this session"}` on **every
  repo-scoped path**, whatever `Authorization` header is attached. Plain `curl` is in that class,
  and `gh` reads `HTTPS_PROXY` too, so expect the same route from a sandbox (`gh` itself was not
  measured this session). `GET /user` through the same proxy returns **200** — the proxy allows
  non-repo paths, so a probe that never touches a repo path can look healthy.
- The same request sent **direct** returns **200 from GitHub itself**, carrying `server: github.com`
  and `x-github-request-id`. Two ways to send it direct: node's built-in `fetch`, which does **not**
  read `HTTPS_PROXY` (`/root/.ccr/README.md`), or `curl --noproxy '*'`. Direct egress is bounded
  only by the environment network allowlist, which carries `api.github.com`.

**That 403 is the route, not the credential.** Never regenerate the PAT with broader scopes to
chase one — the token was never what failed. And never set `NODE_USE_ENV_PROXY=1` for these
scripts: it pushes node onto the 403 route. Canonical statement:
[`AGENT_INFRA.md` → Work status](../../../docs/internal/ci-cd/AGENT_INFRA.md#work-status).

### Repo settings the MCP has no tool for (direct REST read)

Direct REST is the read channel for settings no MCP tool exposes: branch protection, environments
and their protection rules, rulesets, repo visibility, `vulnerability-alerts`. It is **not** a write
fallback and not an MCP replacement — issue/PR writes still go through the MCP, and *applying*
branch protection stays a human step with an admin PAT **by policy**, not because it is unreachable.

A reachability-and-status probe across those endpoints (statuses only — add a `await r.json()` where
you need a body):

```bash
node -e '(async () => {
  const h = { Authorization: `Bearer ${process.env.GITHUB_PAT}`, Accept: "application/vnd.github+json" };
  for (const p of [
    "/repos/pdcarlson/Frapp/branches/main/protection",
    "/repos/pdcarlson/Frapp/environments",
    "/repos/pdcarlson/Frapp/environments/production",
    "/repos/pdcarlson/Frapp/rulesets",
    "/repos/pdcarlson/Frapp/vulnerability-alerts",
  ]) {
    const r = await fetch(`https://api.github.com${p}`, { headers: h });
    // x-github-request-id present => GitHub answered; absent on a 403 => the proxy did
    console.log(r.status, r.headers.get("x-github-request-id") ? "github" : "proxy", p);
  }
})()'
```

One path at a time, with curl — **keep `--noproxy '*'`**, or you take the 403 route and misread it
as an auth failure:

```bash
curl -sS --noproxy '*' -H "Authorization: Bearer $GITHUB_PAT" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/pdcarlson/Frapp/environments/production" | python3 -m json.tool
```

What that route returned on 2026-09-02 (full record in
[`AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md)): `branches/main/protection` **200**
with 21 required contexts, `strict: true`, `enforce_admins: true`, `required_linear_history: true`,
`required_pull_request_reviews: null`; `environments` **200** listing nine; `environments/production`
**200** with `protection_rules: ["required_reviewers"]` — the required-reviewer gate is now read off
the API rather than inferred from approval timing; `rulesets` **200** with one; the repo **200** with
`visibility: public`; `vulnerability-alerts` **404 `"disabled"`** — Dependabot alerts are *off* on
this repo, a 404 meaning disabled, not a 403 meaning blocked (#921 covers turning them on);
`branches/production` and its protection both **404**, that branch having been retired by #1340.

### Check CI status on a branch

```bash
gh run list --branch main --limit 5
```

### View failed CI job logs

```bash
gh run view <run_id> --log-failed
```

### Check PR status and reviews

```bash
gh pr view <number>
gh pr checks <number>
```

### Branch protection state

```bash
npm run configure:branch-protection:verify           # reads live and diffs; writes nothing, takes no flags
npm run configure:branch-protection -- --dry-run     # same read, prints the diff; the `--` is mandatory
```

Prefer `:verify` from an agent session: it carries its own `--verify` and so cannot be mis-spelled
into a write. The script's `hasFlag` is exact-match and an unrecognised spelling reads as *absent*,
which means LIVE — `npm run configure:branch-protection --dry-run` (no `--`) is swallowed by npm, so
the script sees zero args and applies. `assertKnownArgs` refuses an unknown argument it can see, but
it cannot see one npm ate.

Both read through node's global `fetch` (`ghRequest` in `scripts/ci/lib/github.mjs`), so they take
the direct route: **`:verify` exits 0 from a cloud sandbox**, confirmed 2026-09-02. That is a real
ground-truth check on live `main` rather than a check of declared intent, but only over the fields
`buildProtectionPayload` manages on `main`: `allow_fork_syncing` is excluded while `lock_branch` is
false (GitHub honours it only on a locked branch, so comparing it would fail forever) and live `main`
is in fact `false` against a desired `true`; rulesets and environments are not covered at all. A
green `:verify` is therefore not proof that live protection matches the roster in every field.

Applying — the bare `npm run configure:branch-protection` — remains a human step with an admin PAT
by policy; the script reads `GITHUB_PAT` first, with `GITHUB_TOKEN` / `GH_PAT` / `GH_TOKEN`
tolerated as aliases. Runbook:
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

### Find recent PRs touching a path

```bash
gh pr list --search "supabase/migrations" --state merged --limit 5
```

---

## Supabase: Schema and project status

### Local status

```bash
npx supabase status          # Running services, ports, keys
npx supabase db diff --local  # Uncommitted schema changes
npx supabase migration list --local  # Applied migrations
```

### Remote project (staging/production)

```bash
export SUPABASE_ACCESS_TOKEN="$PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN"
npx supabase projects list
npx supabase migration list --project-ref <ref>
```

### Compare local vs remote schema

```bash
npx supabase db diff --linked  # Requires project to be linked
```

---

## Render: API deployment status

### Check service status

```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services?type=web_service&limit=10" | python3 -m json.tool
```

### Recent deploys

```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/<service_id>/deploys?limit=5" | python3 -m json.tool
```

### Health check

```bash
curl -s https://api-staging.frapp.live/health   # Staging
curl -s https://api.frapp.live/health           # Production
```

---

## Vercel: Build and deployment status

> **Git integration retired 2026-09-02 — read these results with that in mind.** The owner
> disconnected **both** Vercel projects from Git; `list_projects` reports `link: null` for
> `frapp-web` and `frapp-landing` alike. Deliberate owner decision, recorded as **ADR-21** in
> [`spec/architecture/README.md`](../../../spec/architecture/README.md). Live right now: the daily
> production-guardrails run is red on `assertVercelProductionBranch` (an absent
> `project.link.productionBranch` reads as a violation), and because that script is also the
> preflight inside `deploy-production.yml`, **production deploys are blocked**;
> `verify-deployments.yml`'s Vercel jobs and `scripts/ci/ensure-vercel-staging-alias.mjs` fail on
> every push to `main` since 2026-09-01T20:46Z; `scripts/ci/deploy-vercel-production.mjs` is
> presumed broken because its `gitSource` argument needs the integration; and **nothing deploys
> staging web or landing on merge any more** — those hosts are frozen at their last Git build
> (landing `2bf143b` 2026-09-01T20:19Z, web `ad0f8c9` 2026-09-02T02:22Z). The replacement model —
> `vercel build` plus `vercel deploy --prebuilt --prod` from GitHub Actions — is **designed, not
> built**; nothing runs it today. So a Vercel deployment list whose newest entry is the frozen build
> named above is expected state until that replacement exists — anything newer, or anything older, is
> worth reporting.

### List deployments

```bash
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v6/deployments?projectId=<project_id>&limit=5" | python3 -m json.tool
```

### Check build logs

```bash
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v2/deployments/<deployment_id>/events" | python3 -m json.tool
```

---

## Infisical: Secret configuration

> **Sandbox reach depends on the environment allowlist.** Per
> [#1279](https://github.com/pdcarlson/Frapp/issues/1279)'s decision, `app.infisical.com`
> belongs on the environment's Allowed domains (canonical statement:
> [`CLOUD_SANDBOX.md`](../../../docs/internal/environment/CLOUD_SANDBOX.md)
> § "What this does not unlock"). There is no MCP fallback — unlike Render / Vercel / Sentry /
> PostHog, no Infisical MCP connector can read secrets (the official `@infisical/mcp` is
> stdio-only, so it runs *inside* the sandbox under the same allowlist). In an environment
> missing the allowlist line, the proxy answers 403 to CONNECT and Infisical state is
> **unverified** from that sandbox — check first with
> `curl -sS https://app.infisical.com/api/status`
> (keep the `-S` — with `-s` alone, the proxy's CONNECT 403 produces silent empty output).
> The recipes need that reach plus `INFISICAL_SERVICE_TOKEN` in the shell — a sandbox or a
> laptop; CI authenticates differently (machine-identity universal auth in the workflows) and
> does not carry the service token.

The credential is a **service token** (`INFISICAL_SERVICE_TOKEN`, `st.*` format), scoped at mint
time to specific environment(s)+path(s).

> **An out-of-scope environment does not error — it returns `200` with an empty `secrets` array.**
> Verified 2026-08-27 from a cloud sandbox with the live `dev`+`staging` token: `environment=prod`
> answered `200` and zero names on **both** `/api/v3/secrets/raw` and `/api/v4/secrets`, while a
> slug that does not exist (`production`, `bogus-slug-xyz`) answered `404`. Two consequences:
> `curl -f` cannot tell "not scoped to this env" from "this env is empty", and **a zero-name
> listing is not evidence that an environment is unconfigured.** A second silent-wrong-answer mode
> compounds it: a token with exactly one (non-glob) scope makes the raw-secrets endpoint *silently
> substitute its scoped environment/path* for whatever the query named, returning 200 with that
> env's keys. (That second mode is upstream-documented behaviour and was **not** re-tested on
> 2026-08-27 — the ambient token has two scopes, so it cannot trigger it. Treat it as a live
> hazard for any single-scope token you mint.)

**Never infer a token's scope from a listing — ask the API.** `GET /api/v2/service-token`,
authenticated with the token itself, returns its own `scopes[]` and `permissions[]`:

```bash
tok="$INFISICAL_SERVICE_TOKEN"; case "$tok" in st.*.*.*) tok="${tok%.*}";; esac
curl -fsS -H "Authorization: Bearer $tok" https://app.infisical.com/api/v2/service-token \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['name'], d['permissions'], [s['environment'] for s in d['scopes']])"
```

That response also embeds the owning user's email and device/IP history, so extract the fields
above rather than dumping it. The project's token is `claude-sandbox-read`, scoped `dev` +
`staging` with `read` permission per #1279 — confirmed against that endpoint, not inferred from a
listing. The CLI reads the same value as `INFISICAL_TOKEN` (full token). **Do not use `infisical secrets`
or `infisical export` in agent sessions — both print secret values.** Use the names-only recipes
below.

### Check secret presence (no values)

```bash
# INFISICAL_PROJECT_ID is exported in agent sessions; same value as workspaceId in .infisical.json
# Service tokens arrive as 3 dot-segments (st.<id>.<secret>) or 4 (a trailing client-side key).
# Segment count does NOT track token age, and BOTH forms authenticate as-is: verified 2026-08-27
# against a same-day mint that was 4 segments, where the full and the stripped form each returned
# 200 and the same names. The case-strip below is harmless defence rather than a requirement --
# keep it anyway (the CLI always wants the FULL token).
# -f catches a dead or blocked token (404/403). It does NOT catch an out-of-scope environment,
# which returns 200 with zero names -- confirm scope via /api/v2/service-token above.
tok="$INFISICAL_SERVICE_TOKEN"; case "$tok" in st.*.*.*) tok="${tok%.*}";; esac
curl -fsS -H "Authorization: Bearer $tok" \
  "https://app.infisical.com/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=dev&secretPath=/" \
  | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]"
```

Upstream now files `GET /api/v3/secrets/raw` under *deprecated* (replacement:
`GET /api/v4/secrets?projectId=…`, same `secrets[].secretKey` response shape); the v3 route is
still live — if it ever 404s, switch to the v4 form.

### Compare environments

Check that staging and production have the same secret keys — this needs a token scoped to
**both** environments, which the ambient `INFISICAL_SERVICE_TOKEN` (dev+staging, never prod)
deliberately is not. **Run with the ambient token, the `prod` iteration prints an empty list
rather than failing** — out-of-scope environments answer `200` with zero secrets (see above), and
`-f` does not fire — so the loop reports what looks like "production holds no keys" when it
actually means "this token cannot read production". That is a wrong answer, not a missing one.
The comparison therefore takes a purpose-minted staging+prod read token, used from a laptop and
never stored in the agent env; check what you hold with `/api/v2/service-token` before trusting
either column. Also: with a *single*-scope token the override described above returns the same
scoped env's keys for every iteration, so identical lists across envs would be the override, not
parity. Mind the name/slug trap: the
Infisical **slugs** are `dev` / `staging` / `prod` (canonical constant: `INFISICAL_ENV_SLUGS` in
`scripts/check-env-slugs.mjs`) — the UI display name "Production" is not the slug, and
`environment=production` returns an error, not an empty list:

```bash
tok="$INFISICAL_SERVICE_TOKEN"; case "$tok" in st.*.*.*) tok="${tok%.*}";; esac
for env in staging prod; do
  echo "=== $env ==="
  curl -fsS -H "Authorization: Bearer $tok" \
    "https://app.infisical.com/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=$env&secretPath=/" \
    | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]" | sort
done
```

**Never print secret values.** Only reference variable names and presence/absence.

---

## Common investigation patterns

### "CI is failing on my PR"

1. `pull_request_read` or `actions_list` via the MCP — identify which job failed (`gh pr checks
   <number>` on a laptop; from a sandbox `gh` takes the 403 proxy route)
2. `get_job_logs` with `failed_only` via the MCP — read the failure logs (`gh run view <run_id>
   --log-failed` on a laptop)
3. Check if it's a flaky test, environment issue, or real code problem
4. If contract check fails: regenerate with `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`

### "Is staging healthy?"

1. `curl https://api-staging.frapp.live/health`
2. Check Render deploys for recent failures
3. Check Vercel deployments for web/landing build status — but since 2026-09-02 nothing deploys
   them on merge (see the Vercel note above), so a build older than that is expected state
4. Compare Infisical staging secrets against expected keys in [`docs/internal/environment/ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md)

### "Did a migration land in production?"

1. `npx supabase migration list --project-ref <prod_ref>` (requires Supabase access token)
2. Cross-reference with `supabase/migrations/` on `main` — there is no separate
   production branch since #1340 (`GET /repos/pdcarlson/Frapp/branches/production` reads 404);
   production is deployed from a named commit on `main` by
   `.github/workflows/deploy-production.yml`. As of 2026-09-02 that workflow's guardrail preflight
   is failing on the retired Vercel Git integration, so nothing new can land in production until
   that is repaired — see the Vercel note above
3. Check [`docs/internal/ops/DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md) for promotion status

### "Are secrets in sync?"

1. List secret keys in each Infisical environment (see above)
2. Compare against [`docs/internal/environment/ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md)
3. Verify Infisical syncs are active for each destination (Render, Vercel, GitHub)

---

## Infisical sync map

The canonical sync map (which Infisical environment feeds which Render/Vercel/GitHub Actions destination) lives in [`docs/internal/ci-cd/AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md) under "Infisical sync map" — check it there rather than relying on a copy here.

---

## Updating this skill

- Add research patterns for new provider integrations (e.g., Sentry API, Expo EAS).
- If the Infisical sync map changes, update [`docs/internal/ci-cd/AGENT_INFRA.md`](../../../docs/internal/ci-cd/AGENT_INFRA.md); if credentials change, update [`docs/internal/environment/AGENT_CREDENTIALS.md`](../../../docs/internal/environment/AGENT_CREDENTIALS.md) — this skill only points at them.
- For Infisical `workspaceId` in curl examples: set **`INFISICAL_PROJECT_ID`** to the project ID from Infisical (same value as GitHub secret `INFISICAL_PROJECT_ID` in [`docs/internal/environment/ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md)), or keep **`.infisical.json`** `workspaceId` in sync and `export INFISICAL_PROJECT_ID=…` before running the snippets.
