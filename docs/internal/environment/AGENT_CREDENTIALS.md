# Agent credentials & cloud-sandbox env vars

Canonical list of the environment variables an AI-agent / automation session may carry.
Two groups: **provider/research credentials** (read-only API access for gathering runtime
truth) and **cloud-sandbox runtime vars** (make the local stack come up — see
[`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md)). Omit all of these on a normal laptop; use
`npx infisical login` for local app secrets instead.

**Never print secret values** — only names and presence/absence. On **Claude Code web** they
are stored in the Claude web environment config and are **visible to anyone who can edit it**,
so use **test-mode / read-only** credentials only.

## Provider / research credentials

When present, gather runtime truth (CI, deploys, schema, secret presence) via provider
APIs before proposing changes. Usage policy for `GITHUB_PAT` lives in
[`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md) ("GitHub PAT usage policy").

| Env var | Typical use |
| ------- | ----------- |
| `GITHUB_PAT` | GitHub PAT — branch-protection script, agent-owned PRs/issues; export as `GH_TOKEN` for `gh` |
| `INFISICAL_SERVICE_TOKEN` | Infisical service token (`st.*` format — scoped at mint time; per [#1279](https://github.com/pdcarlson/Frapp/issues/1279) minted `dev` + `staging` **read-only**, never `prod`, and confirmed so against `GET /api/v2/service-token` on 2026-08-27). The Infisical CLI reads it as `INFISICAL_TOKEN`: `export INFISICAL_TOKEN="$INFISICAL_SERVICE_TOKEN"` |
| `INFISICAL_PROJECT_ID` | Infisical project (workspace) id — same value as `workspaceId` in `.infisical.json` |

**Render, Vercel and Supabase go through their MCP connectors, not a key.** A session reads
them with the `mcp__Render__*`, `mcp__Vercel__*` and `mcp__Supabase__*` tools, which don't pass
through the sandbox allowlist. A key would buy nothing, because the sandbox blocks all three
providers' APIs ([`CLOUD_SANDBOX.md` § What this does not unlock](./CLOUD_SANDBOX.md#what-this-does-not-unlock)).
The Render MCP starts with no workspace selected, so pass `workspaceId` on each
call. Frapp's services (`frapp-api-staging`, `frapp-api-prod`) are in **Paul's workspace**
(`tea-d6lqqdpaae7s73f60uj0`), and `list_workspaces` also returns an unrelated one (checked
2026-09-24 with `list_workspaces` and `list_services`). Recipes:
[`infrastructure-research`](../../../.claude/skills/infrastructure-research/SKILL.md).

**Retired.** Don't use these from a session. If one is still set, tell Paul so he can remove it
from the Claude Code environment.

| Env var | Status |
| ------- | ------ |
| `RENDER_API_KEY` (older images: `RENDER_APIKEY`) | Removed 2026-09-23 and the agent's Render key revoked ([#2583](https://github.com/pdcarlson/Frapp/issues/2583)). The same name is still a GitHub Actions environment secret: [`AGENT_INFRA.md` § No repository secrets](../ci-cd/AGENT_INFRA.md#no-repository-secrets-2518). |
| `VERCEL_API_KEY` | Removed 2026-09-24; no live Vercel token matched it. Same Actions caveat as `RENDER_API_KEY`. |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN`, `SUPABASE_API_KEY`, `SUPABASE_ACCESS_TOKEN` | Removed from the environment by 2026-09-24T16:03Z. Every Supabase account token except CI's two project-scoped read-only ones was revoked the same day, `claude-code` (the agents' token) among them ([#2583](https://github.com/pdcarlson/Frapp/issues/2583)). `SUPABASE_ACCESS_TOKEN` is still the name CI reads from Infisical `staging` and `prod`, where it holds those read-only tokens ([`ENV_REFERENCE.md`](./ENV_REFERENCE.md)); leave that copy alone. No script reads the other two names. |
| `LINEAR_API_KEY` | Linear personal API key — **dead**: Linear was retired 2026-08-08 (work tracking moved to GitHub Issues, see [`../ci-cd/GITHUB_PM.md`](../ci-cd/GITHUB_PM.md) and [#680](https://github.com/pdcarlson/Frapp/issues/680)). Revoke it. |

> **Infisical naming.** Older docs said `INFISICAL_API_KEY`; cloud-sandbox sessions don't
> provide that variable — they carry `INFISICAL_SERVICE_TOKEN` + `INFISICAL_PROJECT_ID` (re-verify with
> `env | grep -oE '^INFISICAL_[A-Z_]+'`). Sandbox reach requires `app.infisical.com` on the
> environment's Allowed domains — [#1279](https://github.com/pdcarlson/Frapp/issues/1279)'s
> decision adds it (placement: [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) § "What's configured
> in the web UI"); in an environment without that line the host is blocked and the token is
> unexercisable from the sandbox. No Infisical MCP connector can read secrets, so there is no
> fallback path — see [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) § "What this does not unlock".
> **Verified end-to-end from a cloud sandbox on 2026-08-27**: `api/status` reachable, and the
> token listed secret *names* for `dev` and `staging`. **Do not read scope off a listing** — an
> environment the token is not scoped to answers `200` with an empty `secrets` array, not 401/403,
> so an out-of-scope env is indistinguishable from an empty one. Ask
> `GET /api/v2/service-token` (returns the token's own `scopes[]`/`permissions[]`); recipe and
> caveats in
> [`infrastructure-research`](../../../.claude/skills/infrastructure-research/SKILL.md)
> § "Infisical: Secret configuration".
>
> **Canonical names & aliases.** The hosted-agent GitHub PAT is `GITHUB_PAT` — **not**
> `GITHUB_TOKEN` (the GitHub Actions runtime token, which lacks branch-administration
> scope). Scripts still tolerate the aliases `GITHUB_TOKEN`, `GH_PAT`, `GH_TOKEN`, and
> older images may expose `GITHUB_PERSONAL_ACCESS_TOKEN` /
> `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` — but new code and docs use the canonical names only.
> `RENDER_APIKEY` is retired with `RENDER_API_KEY` (the table above).

## Cloud-sandbox runtime vars

Set in the Claude Code web UI
to make `scripts/cloud-sandbox-up.sh` bring up the stack.
Full context, network policy, and troubleshooting: [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md).

| Env var | Purpose |
| ------- | ------- |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Docker Hub login (read-only token) to avoid anonymous pull rate limits |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | Test-mode Stripe keys; if absent the bringup writes non-empty placeholders so the API still boots |
| `FRAPP_CLOUD_SANDBOX` | **Optional.** Forces SessionStart auto-bringup. Normally unnecessary — the setup script writes `/etc/frapp-cloud-sandbox`, which the hook auto-detects |

> Sub-agents are **not** pinned to a model — `.claude/settings.json` no longer sets
> `CLAUDE_CODE_SUBAGENT_MODEL`, so sub-agents inherit the session model (Opus in a normal session).
