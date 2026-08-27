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

- For `gh`/git, export the PAT as `GH_TOKEN` first: `export GH_TOKEN="$GITHUB_PAT"` (`gh` does not auto-read `GITHUB_PAT`). Node scripts read `GITHUB_PAT` directly.
- Older cloud VM images may expose legacy aliases (`GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_FULL_PERSONAL_ACCESS_TOKEN`, `RENDER_APIKEY`). Scripts tolerate GitHub aliases where explicitly noted, but new snippets should use the canonical names.
- [`docs/internal/environment/ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md) is the canonical variable reference.

**Never print secret values.** Only reference variable names and presence/absence.

---

## GitHub: CI and PR status

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
npm run configure:branch-protection -- --dry-run
```

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

1. `gh pr checks <number>` — identify which job failed
2. `gh run view <run_id> --log-failed` — read the failure logs
3. Check if it's a flaky test, environment issue, or real code problem
4. If contract check fails: regenerate with `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`

### "Is staging healthy?"

1. `curl https://api-staging.frapp.live/health`
2. Check Render deploys for recent failures
3. Check Vercel deployments for web/landing build status
4. Compare Infisical staging secrets against expected keys in [`docs/internal/environment/ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md)

### "Did a migration land in production?"

1. `npx supabase migration list --project-ref <prod_ref>` (requires Supabase access token)
2. Cross-reference with `supabase/migrations/` in the `production` branch
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
