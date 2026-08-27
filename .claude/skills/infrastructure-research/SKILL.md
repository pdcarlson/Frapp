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

**Available credentials:** the canonical list of provider/research env vars available in cloud agent sessions (`GITHUB_PAT`, `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN`, `INFISICAL_API_KEY`, `RENDER_API_KEY`, `VERCEL_API_KEY`, `SUPABASE_API_KEY`), including the full canonical-name/alias discussion, lives in [`docs/internal/environment/AGENT_CREDENTIALS.md`](../../../docs/internal/environment/AGENT_CREDENTIALS.md).

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

### Check secret presence (no values)

```bash
# workspaceId: export INFISICAL_PROJECT_ID from Infisical Project Settings, or read workspaceId from .infisical.json
curl -s -H "Authorization: Bearer $INFISICAL_API_KEY" \
  "https://app.infisical.com/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=staging&secretPath=/" \
  | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]"
```

### Compare environments

Check that staging and production have the same secret keys. Mind the name/slug trap: the
Infisical **slugs** are `dev` / `staging` / `prod` (canonical constant: `INFISICAL_ENV_SLUGS` in
`scripts/check-env-slugs.mjs`) — the UI display name "Production" is not the slug, and
`environment=production` returns an error, not an empty list:

```bash
for env in staging prod; do
  echo "=== $env ==="
  curl -s -H "Authorization: Bearer $INFISICAL_API_KEY" \
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
