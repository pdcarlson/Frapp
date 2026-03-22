# Documentation index

Start here to find developer guides, operator runbooks, and how they relate to **`spec/`** (product and architecture truth).

## Where things live

| Area                            | Path                                     | Use for                                                                                |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| **Developer guides**            | [`docs/guides/`](guides/README.md)       | Onboarding, local dev pointers, testing, API/database overview, contributing narrative |
| **Internal / ops**              | [`docs/internal/`](internal/README.md)   | Secrets, incidents, branch protection, agent/CI reference, design ops                  |
| **Product & architecture spec** | [`spec/`](../spec/README.md)             | Product behavior, UI specs, security notes, environments, test specs                   |
| **Deployment runbook**          | [`DEPLOYMENT.md`](DEPLOYMENT.md)         | Full operator deployment setup (DNS, providers, staging/production)                    |
| **Performance notes**           | [`performance/`](performance/README.md)  | Ad-hoc performance investigations                                                      |
| **Security fix log**            | [`SECURITY_FIXES.md`](SECURITY_FIXES.md) | Historical security fixes (link to `spec/security-*.md` for durable rules)             |
| **Hooks package**               | [`hooks/`](hooks/README.md)              | Conventions and tests for `packages/hooks`                                             |
| **Archive**                     | [`archive/`](archive/README.md)          | Historical audits and roadmaps (not canonical)                                         |

Conventions for what to update in a PR: **[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](internal/DOCUMENTATION_CONVENTIONS.md)**.

## CI: docs/spec sync

Pull requests that change files **outside** `docs/` or `spec/` must also change **at least one** file under `docs/` or `spec/`. Details: [`docs/internal/DOCS_CI.md`](internal/DOCS_CI.md) (`scripts/check-docs-impact.mjs`).

## Quick links

- Hands-on setup: [`docs/guides/getting-started.md`](guides/getting-started.md)
- Local dev detail: [`docs/internal/LOCAL_DEV.md`](internal/LOCAL_DEV.md)
- Environment variables: [`docs/internal/ENV_REFERENCE.md`](internal/ENV_REFERENCE.md)
- Deployment overview (short): [`docs/guides/deployment.md`](guides/deployment.md)
