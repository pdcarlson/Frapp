# Developer guides (canonical)

These markdown files are the **source of truth** for Frapp developer-facing guides. There is no separate docs website in the monorepo right now—read here on GitHub or in your editor. A public docs site is a possible **post-launch** follow-up.

| Guide                | File                                       |
| -------------------- | ------------------------------------------ |
| Getting started      | [getting-started.md](getting-started.md)   |
| Deployment overview  | [deployment.md](deployment.md)             |
| Environment & config | [env-config.md](env-config.md)             |
| Docker (API)         | [docker.md](docker.md)                     |
| API architecture     | [api-architecture.md](api-architecture.md) |
| Database & Supabase  | [database.md](database.md)                 |
| Testing              | [testing.md](testing.md)                   |
| Contributing         | [contributing.md](contributing.md)         |

**Default local run (API + web + landing):** `npm run dev:stack` from repo root after Infisical login — full detail and alternatives in [`../internal/LOCAL_DEV.md`](../internal/LOCAL_DEV.md).

**Also read:** product and implementation specs in [`spec/`](../../spec/README.md), operator runbooks in [`docs/internal/`](../internal/README.md), and **[`docs/internal/DOCUMENTATION_CONVENTIONS.md`](../internal/DOCUMENTATION_CONVENTIONS.md)** (where to document PR changes).
