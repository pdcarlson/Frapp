# Skill: Infrastructure Research

> Use when investigating deployment state, CI failures, environment configuration, or service health before proposing changes. Also applies when reviewing PRs, debugging production issues, or syncing secrets.

---

## Research-first principle

Before making infrastructure-related changes, gather runtime truth from the available APIs. This prevents stale assumptions and wasted effort.

**Available credentials** (env vars in Cloud sessions):

| Env var | CLI/API | What you can check |
|---------|---------|-------------------|
| `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` | `gh` CLI | PR status, CI logs, branch protection, labels |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI | Project status, migrations, schema |
| `INFISICAL_API_KEY` | Infisical API | Secret presence, sync status |
| `RENDER_APIKEY` | Render API | Service status, deploy history |
| `VERCEL_API_KEY` | Vercel API | Build status, deployment state |
| `SUPABASE_API_KEY` | Supabase Management API | Project-level operations |

---

## GitHub: CI and PR status

### Check CI status on a branch

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh run list --branch preview --limit 5
```

### View failed CI job logs

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh run view <run_id> --log-failed
```

### Check PR status and reviews

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh pr view <number>
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh pr checks <number>
```

### Branch protection state

```bash
GITHUB_PAT="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" npm run configure:branch-protection -- --dry-run
```

### Find recent PRs touching a path

```bash
GITHUB_TOKEN="$GITHUB_FULL_PERSONAL_ACCESS_TOKEN" gh pr list --search "supabase/migrations" --state merged --limit 5
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
curl -s -H "Authorization: Bearer $RENDER_APIKEY" \
  "https://api.render.com/v1/services?type=web_service&limit=10" | python3 -m json.tool
```

### Recent deploys

```bash
curl -s -H "Authorization: Bearer $RENDER_APIKEY" \
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
curl -s -H "Authorization: Bearer $INFISICAL_API_KEY" \
  "https://app.infisical.com/api/v3/secrets/raw?workspaceId=a207b6c2-0be2-4507-a8fb-9a21ee8538bd&environment=staging&secretPath=/" \
  | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]"
```

### Compare environments

Check that staging and production have the same secret keys:

```bash
for env in staging production; do
  echo "=== $env ==="
  curl -s -H "Authorization: Bearer $INFISICAL_API_KEY" \
    "https://app.infisical.com/api/v3/secrets/raw?workspaceId=a207b6c2-0be2-4507-a8fb-9a21ee8538bd&environment=$env&secretPath=/" \
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
4. Compare Infisical staging secrets against expected keys in `docs/internal/ENV_REFERENCE.md`

### "Did a migration land in production?"

1. `npx supabase migration list --project-ref <prod_ref>` (requires Supabase access token)
2. Cross-reference with `supabase/migrations/` in the `main` branch
3. Check `docs/internal/DB_PROMOTION_RUNBOOK.md` for promotion status

### "Are secrets in sync?"

1. List secret keys in each Infisical environment (see above)
2. Compare against `docs/internal/ENV_REFERENCE.md`
3. Verify Infisical syncs are active for each destination (Render, Vercel, GitHub)

---

## Infisical sync map (quick reference)

| # | From | To |
|---|------|----|
| 1 | staging | Render → frapp-api-staging |
| 2 | production | Render → frapp-api-prod |
| 3 | staging | Vercel → frapp-web (Preview) |
| 4 | production | Vercel → frapp-web (Production) |
| 5 | staging | Vercel → frapp-landing (Preview) |
| 6 | production | Vercel → frapp-landing (Production) |
| 7 | per-env | GitHub Actions (OIDC) |

---

## Updating this skill

- Add research patterns for new provider integrations (e.g., Sentry API, Expo EAS).
- Update the quick reference table if the Infisical sync map changes.
- Add new API keys to the credentials table as they become available.
