# Frapp — The Operating System for Greek Life

Frapp is a multi-tenant SaaS platform that replaces the disjointed tools fraternity chapters rely on (Discord, OmegaFi, Life360) with a single, unified mobile and web experience.

## Repository Structure

```
apps/
  api/        — NestJS backend (REST + WebSockets)
  web/        — Next.js admin dashboard (app.frapp.live)
  mobile/     — Expo mobile app (iOS + Android)
  landing/    — Next.js marketing site (frapp.live)        [planned]
  docs/       — Next.js documentation site (docs.frapp.live)
packages/
  api-sdk/    — Generated TypeScript API client
  hooks/      — Shared React hooks
  ui/         — Shared UI components
  theme/      — Tailwind config + global styles
  validation/ — Shared Zod schemas
  eslint-config/      — Shared ESLint configuration
  typescript-config/  — Shared tsconfig
spec/         — Product spec, behavior spec, architecture, environments
supabase/     — Supabase project config + migrations       [planned]
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

```bash
npm install
npx supabase start
npx supabase db push
npm run dev
```

| Service         | URL                        |
| --------------- | -------------------------- |
| Web App         | http://localhost:3000      |
| API             | http://localhost:3001      |
| Swagger         | http://localhost:3001/docs |
| Docs            | http://localhost:3005      |
| Supabase Studio | http://127.0.0.1:54323     |

See [spec/environments.md](spec/environments.md) for full setup details and environment variables.
