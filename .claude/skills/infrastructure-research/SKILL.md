---
name: infrastructure-research
description: >
  Gather runtime truth from provider APIs (GitHub, Supabase, Render, Vercel, Infisical) when
  investigating deployment state, CI failures, environment configuration, secret sync, or service
  health. Use before proposing any infrastructure change, when reviewing PRs that touch CI or
  deploys, when debugging staging/production issues, or when checking whether secrets are in sync.
---

# Infrastructure Research

Check live provider state before you propose or review an infrastructure change. Config files,
docs, and earlier sessions describe what was intended, and deployed reality drifts from that.
You're done when every claim you make about deploys, CI, secrets, or service health rests on a
provider read you ran, or is reported as unverified with the reason.

Never print secret values. Reference only variable names and whether they're present. Anything you
print can end up in a PR, an issue, or a log.

Credential env var names and legacy aliases:
[`AGENT_CREDENTIALS.md`](../../../docs/internal/environment/AGENT_CREDENTIALS.md). Canonical variable
reference: [`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md). When either
changes, update it there, not here.

## Which channel to use

From a cloud session, use the provider's MCP connector (GitHub, Supabase, Render, Vercel) whenever
it has a tool for the question:

- Direct `fetch` to Render, Vercel, Sentry, and PostHog is blocked by the sandbox allowlist. MCP
  doesn't go through the allowlist.
- The GitHub MCP is the only sanctioned write path for issues, PRs, and comments.

The `curl`, `gh`, and CLI recipes below are for laptops and Actions. These also work from a session:
the GitHub REST reads, Infisical (which has no MCP), the local-stack Supabase commands, and the
staging `/health` check when live-staging egress is on
([`live-verification`](../live-verification/SKILL.md)). `gh` isn't installed in cloud sandboxes. On
a laptop, run `export GH_TOKEN="$GITHUB_PAT"` first, because `gh` doesn't read `GITHUB_PAT` (node
scripts do).

## GitHub

| Question | Session (GitHub MCP) | Laptop / Actions |
| -------- | -------------------- | ---------------- |
| CI runs on a branch | `actions_list` | `gh run list --branch main --limit 5` |
| Failed job logs | `get_job_logs` with `failed_only` | `gh run view <run_id> --log-failed` |
| PR status, checks, reviews | `pull_request_read` | `gh pr view <number>`, `gh pr checks <number>` |
| Recent PRs touching a path | `search_pull_requests` / `list_pull_requests` | `gh pr list --search "supabase/migrations" --state merged --limit 5` |

### The `api.github.com` route rule

From a cloud sandbox:

- **Read GitHub through the MCP** (the table above).
- **For a settings read the MCP has no tool for** (branch protection, environments, rulesets,
  vulnerability alerts), use the direct route with `GITHUB_PAT`: node's built-in `fetch`, which
  ignores `HTTPS_PROXY` (`/root/.ccr/README.md`), or `curl --noproxy '*'`. Recipes below.
- **Don't treat a proxy-route result as evidence about permissions.** Anything that honours
  `HTTPS_PROXY` (plain `curl`, `gh`) takes the proxy route, and what passes there varies by
  session and path. A 403 on it says nothing about the PAT, so don't regenerate the PAT with
  broader scopes, and don't set `NODE_USE_ENV_PROXY=1` for these scripts: it puts node back on
  the proxy route.

Measurements and the canonical statement:
[`AGENT_INFRA.md` → Work status](../../../docs/internal/ci-cd/AGENT_INFRA.md#work-status).

### Repo settings the MCP has no tool for (direct REST read)

Use direct REST only to read settings that no MCP tool exposes: branch protection, environments and
their protection rules, rulesets, repo visibility, and `vulnerability-alerts`.

- It isn't a write fallback. Issue and PR writes still go through the MCP.
- Applying branch protection is a human step with an admin PAT. That's policy. Access isn't the
  reason.

The probe below prints the status for each path. Add `await r.json()` if you need a body:

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
    // node's fetch ignores HTTPS_PROXY, so this is the direct route and a 403 is GitHub's
    // verdict on the PAT. (On the proxy route GitHub headers prove nothing about the PAT.)
    console.log(r.status, r.headers.get("x-github-request-id") ? "github" : "no-github-headers", p);
  }
})()'
```

With curl, keep `--noproxy '*'`. Without it, you're on the proxy route, and its 403 can be
mistaken for an auth failure:

```bash
curl -sS --noproxy '*' -H "Authorization: Bearer $GITHUB_PAT" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/pdcarlson/Frapp/environments/production" | python3 -m json.tool
```

How to read the results:

- **`vulnerability-alerts` returns 404 `"disabled"`.** Dependabot alerts are off
  ([#921](https://github.com/pdcarlson/Frapp/issues/921)). The request wasn't blocked.
- **`branches/production` returns 404.** That's expected. The branch was retired in #1340.
- **Required reviewers for production.** Read them from the protection rules on
  `environments/production`. Don't infer them from approval timing.
- **Required contexts.** The list is `ALL_REQUIRED_CHECKS` in `scripts/ci/lib/required-checks.mjs`.
  Don't trust a count quoted in a doc.

### Branch protection state

```bash
npm run configure:branch-protection:verify           # reads live and diffs; writes nothing, takes no flags
npm run configure:branch-protection -- --dry-run     # same read, prints the diff; the `--` is mandatory
```

From an agent session, run only `npm run configure:branch-protection:verify`. The other forms can
write:

- Bare `npm run configure:branch-protection` prints `Mode: LIVE` and `PUT`s the whole protection
  payload.
- `npm run configure:branch-protection --dry-run` without the `--` also applies. npm swallows the
  flag, so the script sees no arguments, and `assertKnownArgs` never sees the flag to refuse it.
- `:verify` sets its own flag and takes no others, so a typo can't turn it into a write.

`:verify` reads through node's `fetch` (`ghRequest` in `scripts/ci/lib/github.mjs`), so it works
from a cloud sandbox. Its coverage has limits, so a green `:verify` doesn't mean every live field
matches:

- It covers only the fields `buildProtectionPayload` manages on `main`.
- It skips `allow_fork_syncing` while `lock_branch` is false.
- It doesn't check rulesets or environments.

Applying protection is a human step. Runbook and current state:
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

## Supabase: Schema and project status

```bash
npx supabase status                   # local: services, ports, keys
npx supabase db diff --local          # local: uncommitted schema changes
npx supabase migration list --local   # local: applied migrations

export SUPABASE_ACCESS_TOKEN="$PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN"
npx supabase projects list
npx supabase migration list --project-ref <ref>
npx supabase db diff --linked         # local vs remote; needs a linked project
```

From a session, use the Supabase MCP (`list_projects`, `list_migrations`). A ref doesn't say which
project it belongs to, so look up refs by project name with `list_projects`. Never use one from
memory.

## Render: API deployment status

From a session, use the Render MCP (`list_services`, `list_deploys`, `get_deploy`). On a laptop:

```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services?type=web_service&limit=10" | python3 -m json.tool
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/<service_id>/deploys?limit=5" | python3 -m json.tool
```

Health checks. The `commit` field is the build Render serves:

```bash
curl -s https://api-staging.frapp.live/health   # Staging; also from a session with live-staging egress
curl -s https://api.frapp.live/health           # Production; laptop only, never allowlisted in sandboxes
```

## Vercel: Build and deployment status

`frapp-web` and `frapp-landing` are both unlinked from Git, so `link: null` is expected. CI does the
deploys:

- `deploy-vercel-staging.yml` deploys both after CI passes on `main`.
- `deploy-production.yml` deploys a dispatched SHA.

Both go through `scripts/ci/deploy-vercel.mjs`, which stamps every deployment with
`meta.githubCommitSha`. Report either of these:

- a deployment without that stamp;
- a Git link that has come back. The production guardrail treats that as a violation
  (`assertVercelNoGitLink` in `scripts/ci/production-guardrails.mjs`).

Canonical record: [ADR-21](../../../spec/architecture/adr/adr-21.md).

From a session, use the Vercel MCP (`list_deployments`, `get_deployment`,
`list_deployment_events`). On a laptop:

```bash
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v6/deployments?projectId=<project_id>&limit=5" | python3 -m json.tool
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v2/deployments/<deployment_id>/events" | python3 -m json.tool
```

## Infisical: Secret configuration

No MCP connector can read Infisical secrets. The official `@infisical/mcp` is stdio-only, so it
runs inside the sandbox under the same allowlist. The recipes below use direct HTTPS and need two
things:

- `app.infisical.com` on the environment's Allowed domains
  ([#1279](https://github.com/pdcarlson/Frapp/issues/1279);
  [`CLOUD_SANDBOX.md` § What this does not unlock](../../../docs/internal/environment/CLOUD_SANDBOX.md#what-this-does-not-unlock)).
- `INFISICAL_SERVICE_TOKEN` in the shell. CI doesn't carry this token; it uses machine-identity
  universal auth.

Check reach first with `curl -sS https://app.infisical.com/api/status`. Keep the `-S`: with `-s`
alone, the proxy's CONNECT 403 prints nothing. If the host is blocked, report Infisical state as
unverified.

Facts about the token and the environments:

- **The ambient token** is the service token `claude-sandbox-read` (`st.*`). It has read access to
  `dev` and `staging`, never `prod`.
- **Project ID.** `INFISICAL_PROJECT_ID` is exported in sessions and equals `workspaceId` in
  `.infisical.json`. If it's missing, export it from there.
- **Token format.** Service tokens come as 3 dot-segments (`st.<id>.<secret>`) or as 4, with a
  trailing client-side key. Both authenticate over HTTP, so the `case` strip in the recipes is
  harmless defence.
- **CLI.** The CLI takes the full token as `INFISICAL_TOKEN`. Don't use `infisical secrets` or
  `infisical export` in agent sessions: both print values.
- **Environment slugs** are `dev`, `staging`, and `prod` (`INFISICAL_ENV_SLUGS` in
  `scripts/check-env-slugs.mjs`). "Production" is only the display name, and
  `environment=production` returns 404.

Two cases return a wrong answer instead of an error:

- **Out-of-scope environment.** A request for an environment outside the token's scope returns
  `200` with an empty `secrets` array, on both `/api/v3/secrets/raw` and `/api/v4/secrets`. (A slug
  that doesn't exist returns 404.) `curl -f` can't tell "not scoped" from "empty". A listing with
  zero names doesn't show that an environment is unconfigured.
- **Single-scope override.** A token with exactly one non-glob scope makes the raw-secrets endpoint
  answer for the token's own environment and path, whatever you asked for. Identical key lists
  across environments can be this override, not parity. This is upstream-documented behaviour. The
  ambient token has two scopes, so this only happens with a single-scope token you mint.

So read a token's scope from the API, never from a listing. The response also contains the owner's
email and IP history, so print only these fields:

```bash
tok="$INFISICAL_SERVICE_TOKEN"; case "$tok" in st.*.*.*) tok="${tok%.*}";; esac
curl -fsS -H "Authorization: Bearer $tok" https://app.infisical.com/api/v2/service-token \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['name'], d['permissions'], [s['environment'] for s in d['scopes']])"
```

### Check secret presence (no values)

```bash
tok="$INFISICAL_SERVICE_TOKEN"; case "$tok" in st.*.*.*) tok="${tok%.*}";; esac
curl -fsS -H "Authorization: Bearer $tok" \
  "https://app.infisical.com/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=dev&secretPath=/" \
  | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]"
```

`/api/v3/secrets/raw` is deprecated upstream but still works. If it starts returning 404, switch
to `GET /api/v4/secrets?projectId=…`, which returns the same `secrets[].secretKey` shape.

### Compare environments

Comparing staging with prod needs a token scoped to both. The ambient token isn't scoped to prod,
so its `prod` column prints empty, which looks like "production has no keys". To compare:

1. Mint a read token scoped to staging and prod.
2. Confirm its scope with `/api/v2/service-token` before you trust either column.
3. Run the comparison from a laptop. Never store that token in the agent env.

```bash
tok="$INFISICAL_SERVICE_TOKEN"; case "$tok" in st.*.*.*) tok="${tok%.*}";; esac
for env in staging prod; do
  echo "=== $env ==="
  curl -fsS -H "Authorization: Bearer $tok" \
    "https://app.infisical.com/api/v3/secrets/raw?workspaceId=${INFISICAL_PROJECT_ID}&environment=$env&secretPath=/" \
    | python3 -c "import sys,json; [print(s['secretKey']) for s in json.load(sys.stdin).get('secrets',[])]" | sort
done
```

## Infisical sync map

The sync map shows which Infisical environment feeds which Render or Vercel destination. It lives
in [`SECRETS_MANAGEMENT.md`](../../../docs/internal/environment/SECRETS_MANAGEMENT.md) under
"5. Configure Secret Syncs". Read and update it there. It's a dated copy of the dashboard, so if the
two disagree, the doc is wrong: fix it and update its date.

GitHub Actions has no Infisical sync. Workflows pull secrets at job time through
`.github/actions/infisical-secrets` (`Infisical/secrets-action`, universal auth, not OIDC).

## Common investigation patterns

- **CI failing on a PR.**
  1. Find the failed job with `pull_request_read` or `actions_list`.
  2. Read the logs with `get_job_logs` (`failed_only`).
  3. Decide whether it's flaky, environmental, or a real code problem.
  4. If the contract check failed, regenerate with
     `npm run openapi:export -w apps/api && npm run generate -w packages/api-sdk`.
- **Is staging healthy?**
  1. Read `https://api-staging.frapp.live/health`, including `commit`.
  2. Check Render deploys for recent failures.
  3. Check that the newest web and landing Vercel deployments match the latest green CI on `main`.
     CI runs first, then both projects build, so allow time before calling a host stale.
  4. Compare Infisical `staging` key names against
     [`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md).
- **Did a migration land in production?**
  1. List applied migrations with `npx supabase migration list --project-ref <prod_ref>`, or with
     MCP `list_migrations` on the project `list_projects` names as production.
  2. Compare against `supabase/migrations/` on `main`. There's no `production` branch: production
     deploys a named commit on `main` via `.github/workflows/deploy-production.yml`. Gates:
     [`ci-cd.md` § How Deployments Are Gated](../../../docs/internal/ops/deployment/ci-cd.md#how-deployments-are-gated).
  3. Check promotion status in
     [`DB_PROMOTION_RUNBOOK.md`](../../../docs/internal/ops/DB_PROMOTION_RUNBOOK.md).
- **Are secrets in sync?**
  1. List key names per Infisical environment. The scope traps above apply.
  2. Compare them against `ENV_REFERENCE.md`.
  3. Confirm that each Render and Vercel sync is active.
