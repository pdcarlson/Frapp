# Environment & dev setup

Everything about running Frapp, its environment variables, and the credentials agents
use. **Claude Code web is the cloud agent environment**
(ADR-16 amendment 10); laptop/local is the other path.

| Doc | Scope |
| --- | ----- |
| [`CLOUD_SANDBOX.md`](./CLOUD_SANDBOX.md) | Cloud agent path — Claude Code web UI, network allowlist, auto-bringup, failure troubleshooting |
| [`LOCAL_DEV.md`](./LOCAL_DEV.md) | Secondary path — laptop/local dev: `dev:stack`, ports, per-app commands, Infisical vs `.env.local` |
| [`ENV_REFERENCE.md`](./ENV_REFERENCE.md) | The complete per-environment variable grid (Infisical canonical values + references) |
| [`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md) | Infisical project setup, provider syncs, rotation, emergency procedures |
| [`AGENT_CREDENTIALS.md`](./AGENT_CREDENTIALS.md) | Agent/provider credentials + cloud-sandbox runtime env vars |

Onboarding walkthrough: [`../../guides/getting-started.md`](../../guides/getting-started.md).
Placement rules: [`../DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).
