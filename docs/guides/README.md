# Developer guides (canonical)

These markdown files are the **source of truth** for Frapp developer-facing guides. The published Next.js app at `apps/docs` (e.g. docs.frapp.live) is on **content freeze**; it links here so navigation stays stable while edits happen only in this folder.

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

**Default local run (all apps):** `npm run dev:stack` from repo root after Infisical login — full detail and alternatives in [`../internal/LOCAL_DEV.md`](../internal/LOCAL_DEV.md).

**Also read:** product and implementation specs in [`spec/`](../../spec/), and operator runbooks in [`docs/internal/`](../internal/README.md).
