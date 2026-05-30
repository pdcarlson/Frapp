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
| `INFISICAL_API_KEY` | Infisical API (may lack the `local` env) |
| `RENDER_API_KEY` | Render API |
| `VERCEL_API_KEY` | Vercel API |
| `SUPABASE_API_KEY` | Supabase Management API |

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

> `CLAUDE_CODE_SUBAGENT_MODEL` is **not** a web-UI env var — it's a repo setting in
> [`.claude/settings.json`](../../../.claude/settings.json) (`env` block) pinning all
> subagents to `claude-sonnet-4-6`. Accepts a model id/alias or `inherit`.
