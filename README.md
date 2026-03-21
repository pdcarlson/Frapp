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
packages/
  api-sdk/    — Generated TypeScript API client
  brand-assets/ — Canonical Frapp SVG marks (favicon + lockup); sync via `npm run sync:brand-assets`
  hooks/      — Shared React hooks
  ui/         — Shared UI components
  theme/      — Tailwind config + global styles
  validation/ — Shared Zod schemas
  eslint-config/      — Shared ESLint configuration
  typescript-config/  — Shared tsconfig
spec/         — Product spec, behavior spec, architecture, environments
supabase/     — Supabase project config + migrations
```

## Tech Stack

| Layer                | Technology                                  |
| -------------------- | ------------------------------------------- |
| Monorepo             | Turborepo + npm workspaces                  |
| Web + Landing        | Next.js (App Router), Tailwind, ShadCN UI   |
| Mobile               | Expo, React Native, Expo Router, NativeWind |
| API                  | NestJS 11, TypeScript (strict)              |
| Database             | PostgreSQL via Supabase                     |
| Auth                 | Supabase Auth                               |
| Storage              | Supabase Storage                            |
| Realtime             | Supabase Realtime                           |
| Billing              | Stripe                                      |
| Push                 | Expo Push Service                           |
| CI/CD                | GitHub Actions + Vercel + EAS               |

## Spec-Driven Development

All product decisions, behavior rules, and architecture are documented in the `spec/` directory:

- **[spec/product.md](spec/product.md)** — Features, user flows, surfaces, onboarding.
- **[spec/behavior.md](spec/behavior.md)** — Rules, edge cases, invariants, error handling.
- **[spec/architecture.md](spec/architecture.md)** — Stack, data model, auth, storage, API contracts.
- **[spec/environments.md](spec/environments.md)** — Local, staging, production setup; CI/CD.

The spec is the single source of truth. Implementation follows the spec.

## Quick Start

**Bootstrap Supabase + deps (WSL/Linux, Docker running):**

```bash
bash scripts/local-dev-setup.sh
```

If local Supabase containers are stuck or exited: `bash scripts/local-dev-setup.sh --reset-supabase`. If Postgres fails with **incompatible data directory** (e.g. after a CLI / `major_version` bump), wipe local volumes once: `bash scripts/local-dev-setup.sh --reset-supabase-data`. Full walkthrough: [docs/guides/getting-started.md](docs/guides/getting-started.md) and `bash scripts/local-dev-setup.sh --help`.

**Run all app dev servers (default):** from the repo root, after `npx infisical login` once — see [docs/internal/SECRETS_MANAGEMENT.md](docs/internal/SECRETS_MANAGEMENT.md):

```bash
npm run dev:stack
```

Per-app commands, no-Infisical fallback, mobile, and URLs: **[docs/internal/LOCAL_DEV.md](docs/internal/LOCAL_DEV.md)** (single reference for anything beyond `dev:stack`).

See [spec/environments.md](spec/environments.md) for environment model and variables.
