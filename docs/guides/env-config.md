# Environment & Configuration

This guide explains how Frapp is configured across local, staging, and production environments.

## 1. Environment matrix

We maintain three main environments:

- **Local** — developer machine, Supabase CLI + Docker, `.env.local` files
- **Staging** — Supabase Cloud (staging project), containerized API, Vercel preview frontends
- **Production** — Supabase Cloud (prod project), API + frontends on production infrastructure

## 2. Secrets management

All staging and production secrets are centrally managed in **Infisical** and automatically synced to deployment targets (Vercel, Render, and GitHub Actions). For the full per-app/per-environment mapping, see [`docs/internal/ENV_REFERENCE.md`](../internal/ENV_REFERENCE.md).

> **Note:** For the complete list of every environment variable, per app, per environment, see [`docs/internal/ENV_REFERENCE.md`](../internal/ENV_REFERENCE.md).

Key principles:

- **Infisical is the single source of truth** for all non-local secrets.
- **No `.env.example` files** — the centralized `ENV_REFERENCE.md` replaces them.
- **No placeholder secrets in CI** — CI only runs lint, typecheck, and tests (no runtime secrets needed).
- **Provider-native syncs** — Infisical pushes secrets to Vercel, Render, and GitHub Actions automatically; mobile EAS credentials are managed in Expo/EAS.

## 3. Local development setup

**Recommended:** use the **Infisical CLI** as the primary local flow so secrets stay centralized (same source as staging/prod). Authenticate once with `npx infisical login`, then run apps with secrets injected:

```bash
npx infisical run --env=local -- npm run start:dev -w apps/api
npx infisical run --env=local -- npm run dev -w apps/web
```

For all three apps in one terminal, use `npm run dev:stack` from the repo root (it wraps the same Infisical pattern). Populate the Infisical **`local`** environment using values from `npx supabase status -o env` plus the app-specific keys listed in [`docs/internal/ENV_REFERENCE.md`](../internal/ENV_REFERENCE.md).

### Fallback: Supabase CLI + `.env.local`

If Infisical is unavailable, generate local env files from Supabase and merge in app vars from `ENV_REFERENCE.md`:

```bash
npx supabase start
npx supabase status -o env
```

Create `.env.local` per app from that output, then add remaining variables (for the API, include `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` — placeholders are fine unless you are testing billing). Treat `.env.local` as a **fallback**; prefer Infisical when possible.

## 4. Config module in the API

The NestJS API uses `@nestjs/config` to load environment variables:

- Reads from `process.env`; in development it loads **`.env.local` first and then `.env`** (whether values came from files or from Infisical-injected `process.env`).
- Provides typed access to configuration (database, Supabase, Stripe, etc.).
- Validates all required variables on startup via `env.validation.ts`.

When adding new env vars:

1. Add to the config module / validation.
2. Add to Infisical (staging and production environments).
3. Update `docs/internal/ENV_REFERENCE.md`.
4. Update this guide if it matters to other developers.

## 5. Secrets and safety

> **Warning:** Never commit real secrets. Never use placeholder secrets in CI/CD workflows.

- Use `.env.local` for **local only** values (never committed).
- All staging/production secrets live in Infisical and are synced to providers.
- Rotate keys immediately if they are ever exposed.
- See `docs/internal/SECRETS_MANAGEMENT.md` for the rotation policy.

## 6. Supabase projects

We use separate Supabase projects for:

- **Local** — CLI-managed project via `supabase start`
- **Staging** — Cloud project in test mode
- **Production** — Cloud project with real data

Rules:

- Schema is **identical** across environments (migrations from `supabase/migrations/`).
- Never manually edit the prod schema via the UI without a migration.
- Keep staging as close to production as possible (schema + configuration).
