# Environment & dev setup

Everything about running Frapp, its environment variables, and the credentials agents
use. **Claude Code cloud sandboxes are the primary development environment**; laptop/local
is the secondary path.

| Doc | Scope |
| --- | ----- |
| [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) | **Primary dev path** — how the Claude Code web sandbox is configured (setup script, network, env vars), auto-bringup, and failure troubleshooting |
| [`LOCAL_DEV.md`](./LOCAL_DEV.md) | Secondary path — laptop/local dev: `dev:stack`, ports, per-app commands, Infisical vs `.env.local` |
| [`ENV_REFERENCE.md`](./ENV_REFERENCE.md) | The complete per-environment variable grid (Infisical canonical values + references) |
| [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md) | Infisical project setup, provider syncs, rotation, emergency procedures |
| [`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md) | Agent/provider credentials + cloud-sandbox runtime env vars |

Onboarding walkthrough: [`../../guides/getting-started.md`](../../guides/getting-started.md).
Placement rules: [`../DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).
