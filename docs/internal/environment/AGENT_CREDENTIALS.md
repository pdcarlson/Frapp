# Agent credentials & cloud-sandbox env vars

Canonical list of the environment variables an AI-agent / automation session may carry.
Two groups: **provider/research credentials** (read-only API access for gathering runtime
truth) and **cloud-sandbox runtime vars** (make the local stack come up — see
[`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md)). Omit all of these on a normal laptop; use
`npx infisical login` for local app secrets instead.

**Never print secret values** — only names and presence/absence. All of these are stored
in the Claude Code web environment config and are **visible to anyone who can edit it**,
so use **test-mode / read-only** credentials only.

## Provider / research credentials

When present, gather runtime truth (CI, deploys, schema, secret presence) via provider
APIs before proposing changes. Usage policy for `GITHUB_PAT` lives in
[`../ci-cd/AGENT_INFRA.md`](../ci-cd/AGENT_INFRA.md) ("GitHub PAT usage policy").

| Env var | Typical use |
| ------- | ----------- |
| `GITHUB_PAT` | GitHub PAT — branch-protection script, agent-owned PRs/issues; export as `GH_TOKEN` for `gh` |
| `PDCARLSON_SUPABASE_PERSONAL_ACCESS_TOKEN` | Supabase CLI / management |
| `INFISICAL_SERVICE_TOKEN` | Infisical service token (`st.*` format — scoped at mint time; per [#1279](https://github.com/pdcarlson/Frapp/issues/1279) minted `dev` + `staging` **read-only**, never `prod`). The Infisical CLI reads it as `INFISICAL_TOKEN`: `export INFISICAL_TOKEN="$INFISICAL_SERVICE_TOKEN"` |
| `INFISICAL_PROJECT_ID` | Infisical project (workspace) id — same value as `workspaceId` in `.infisical.json` |
| `RENDER_API_KEY` | Render API |
| `VERCEL_API_KEY` | Vercel API |
| `SUPABASE_API_KEY` | Supabase Management API |
| `LINEAR_API_KEY` | Linear personal API key — **dead**: Linear was retired 2026-08-08 (work tracking moved to GitHub Issues, see [`../ci-cd/GITHUB_PM.md`](../ci-cd/GITHUB_PM.md) and [#680](https://github.com/pdcarlson/Frapp/issues/680)). Revoke it. |

> **Infisical naming.** Older docs said `INFISICAL_API_KEY`; cloud-sandbox sessions don't
> provide that variable — they carry `INFISICAL_SERVICE_TOKEN` + `INFISICAL_PROJECT_ID` (re-verify with
> `env | grep -oE '^INFISICAL_[A-Z_]+'`). Sandbox reach requires `app.infisical.com` on the
> environment's Allowed domains — [#1279](https://github.com/pdcarlson/Frapp/issues/1279)'s
> decision adds it (placement: [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) § "What's configured
> in the web UI"); in an environment without that line the host is blocked and the token is
> unexercisable from the sandbox. No Infisical MCP connector can read secrets, so there is no
> fallback path — see [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) § "What this does not unlock".
>
> **Canonical names & aliases.** The hosted-agent GitHub PAT is `GITHUB_PAT` — **not**
> `GITHUB_TOKEN` (the GitHub Actions runtime token, which lacks branch-administration
> scope). Scripts still tolerate the aliases `GITHUB_TOKEN`, `GH_PAT`, `GH_TOKEN`, and
> older images may expose `GITHUB_PERSONAL_ACCESS_TOKEN` /
> `GITHUB_FULL_PERSONAL_ACCESS_TOKEN` / `RENDER_APIKEY` — but new code and docs use the
> canonical names only.

## Cloud-sandbox runtime vars

Set in the Claude Code web UI to make `scripts/cloud-sandbox-up.sh` bring up the stack.
Full context, network policy, and troubleshooting: [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md).

| Env var | Purpose |
| ------- | ------- |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Docker Hub login (read-only token) to avoid anonymous pull rate limits |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | Test-mode Stripe keys; if absent the bringup writes non-empty placeholders so the API still boots |
| `FRAPP_CLOUD_SANDBOX` | **Optional.** Forces SessionStart auto-bringup. Normally unnecessary — the setup script writes `/etc/frapp-cloud-sandbox`, which the hook auto-detects |

> Sub-agents are **not** pinned to a model — `.claude/settings.json` no longer sets
> `CLAUDE_CODE_SUBAGENT_MODEL`, so sub-agents inherit the session model (Opus in a normal session).
