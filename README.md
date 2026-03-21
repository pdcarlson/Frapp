# Frapp — The Operating System for Greek Life

Frapp is a multi-tenant SaaS platform that replaces the disjointed tools fraternity chapters rely on (Discord, OmegaFi, Life360) with a single, unified mobile and web experience.

## Repository Structure

```
apps/
  api/        — NestJS backend (REST + WebSockets)
  web/        — Next.js admin dashboard (app.frapp.live)
  mobile/     — Expo mobile app (iOS + Android)
  landing/    — Next.js marketing site (frapp.live)
  docs/       — Next.js documentation site (docs.frapp.live)
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
| Web + Landing + Docs | Next.js (App Router), Tailwind, ShadCN UI   |
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

If local Supabase containers are stuck or exited: `bash scripts/local-dev-setup.sh --reset-supabase`. If Postgres fails with **incompatible data directory** (e.g. after a CLI / `major_version` bump), wipe local volumes once: `bash scripts/local-dev-setup.sh --reset-supabase-data`. Details: **Getting Started** in `apps/docs` (Postgres 17 + volumes) and `bash scripts/local-dev-setup.sh --help`.

Authenticate Infisical once (`npx infisical login`); see [docs/internal/SECRETS_MANAGEMENT.md](docs/internal/SECRETS_MANAGEMENT.md). Then start apps from the repo root (long-running servers). **One terminal** (API + web + landing + docs, prefixed logs):

```bash
npm run dev:stack
```

**Or** separate terminals with Infisical-injected env:

```bash
npm run dev:api
npm run dev:web
npm run dev:landing
npm run dev:docs
```

More detail: [docs/internal/LOCAL_DEV.md](docs/internal/LOCAL_DEV.md).

Without Infisical (use `.env.local` per `docs/internal/ENV_REFERENCE.md`):

```bash
bash scripts/local-dev-setup.sh
npm run start:dev -w apps/api
npm run dev -w apps/web
npm run dev -w apps/landing
npm run dev -w apps/docs
```

| Service         | URL                        |
| --------------- | -------------------------- |
| Web App         | http://localhost:3000      |
| API             | http://localhost:3001      |
| Swagger         | http://localhost:3001/docs |
| Docs            | http://localhost:3005      |
| Supabase Studio | http://127.0.0.1:54323     |

See [spec/environments.md](spec/environments.md) for full setup details and environment variables.
