# Frapp — The Operating System for Greek Life

Frapp is a multi-tenant SaaS platform that replaces the disjointed tools fraternity chapters rely on (Discord, OmegaFi, Life360) with a single, unified mobile and web experience.

## Repository Structure

```
apps/
  api/        — NestJS backend (REST + WebSockets)
  web/        — Next.js admin dashboard (app.frapp.live)
  mobile/     — Expo mobile app (iOS + Android)
  landing/    — Next.js marketing site (frapp.live)
  (Developer docs: repo-root `docs/guides/` — no Next.js docs app.)
packages/    — 13 shared workspaces
  api-sdk/            — Generated TypeScript API client
  brand-assets/       — Canonical SVG marks (favicon + lockup); sync via `npm run sync:brand-assets`
  chapter-theme/      — Chapter accent palette derivation (legacy web token map until Signet reskin)
  chat-core/          — Platform-neutral chat hot path (cache, send, realtime) behind injected adapters
  chat-integrations/  — Chat slash-command / integration helpers
  color/              — Shared WCAG contrast math
  eslint-config/      — Shared ESLint configuration
  formatting/         — Shared date/time/duration display helpers (web + mobile)
  hooks/              — Shared React hooks
  org-archetypes/     — Greek-org directory / archetype data
  theme/              — Tailwind config + global styles (legacy bone/bronze until web/landing reskin)
  typescript-config/  — Shared tsconfig
  validation/         — Shared Zod schemas
spec/         — Product spec, behavior spec, architecture, environments
supabase/     — Supabase project config + migrations
```

## Tech Stack

| Layer         | Technology                                  |
| ------------- | ------------------------------------------- |
| Monorepo      | Turborepo + npm workspaces                  |
| Web + Landing | Next.js (App Router), Tailwind, ShadCN UI   |
| Mobile        | Expo, React Native, Expo Router, NativeWind |
| API           | NestJS 11, TypeScript (strict)              |
| Database      | PostgreSQL via Supabase                     |
| Auth          | Supabase Auth                               |
| Storage       | Supabase Storage                            |
| Realtime      | Supabase Realtime                           |
| Billing       | Stripe                                      |
| Push          | Expo Push Service                           |
| CI/CD         | GitHub Actions + Vercel + EAS               |

## Spec-Driven Development

All product decisions, behavior rules, and architecture are documented in the `spec/` directory:

- **[spec/product/](spec/product/README.md)** — Features, user flows, surfaces, onboarding.
- **[spec/behavior/](spec/behavior/README.md)** — Rules, edge cases, invariants, error handling.
- **[spec/architecture/README.md](spec/architecture/README.md)** — Stack, data model, auth, storage, API contracts.
- **[spec/environments/README.md](spec/environments/README.md)** — Local, staging, production setup; CI/CD.

**`spec/` is the source of truth for intended behavior. Code is the source of truth for current behavior.** Disagreement between them is a tracked bug to file, not something an agent silently resolves by picking whichever loaded first. See [`AGENTS.md`](AGENTS.md) § Spec vs code.

**Documentation map (guides + runbooks + how they relate to spec):** [docs/README.md](docs/README.md).

## Quick Start

**Bootstrap Supabase + deps (WSL/Linux, Docker running):**

```bash
bash scripts/local-dev-setup.sh
```

If local Supabase containers are stuck or exited: `bash scripts/local-dev-setup.sh --reset-supabase`. If Postgres fails with **incompatible data directory** (e.g. after a CLI / `major_version` bump), wipe local volumes once: `bash scripts/local-dev-setup.sh --reset-supabase-data`. Full walkthrough: [docs/guides/getting-started.md](docs/guides/getting-started.md) and `bash scripts/local-dev-setup.sh --help`.

**Run all app dev servers (default):** from the repo root, after `npx infisical login` once — see [docs/internal/environment/SECRETS_MANAGEMENT.md](docs/internal/environment/SECRETS_MANAGEMENT.md):

```bash
npm run dev:stack
```

Per-app commands, no-Infisical fallback, mobile, and URLs: **[docs/internal/environment/LOCAL_DEV.md](docs/internal/environment/LOCAL_DEV.md)** (single reference for anything beyond `dev:stack`).

See [spec/environments/README.md](spec/environments/README.md) for environment model and variables.
