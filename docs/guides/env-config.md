# Environment & Configuration

This guide explains how Frapp is configured across local, staging, and production environments.

## 1. Environment matrix

We maintain three main environments:

- **Local** — developer machine, Supabase CLI + Docker, `.env.local` files
- **Staging** — Supabase Cloud (staging project), containerized API, Vercel-hosted frontends —
  but the frontends are **frozen since 2026-09-02**: both Vercel projects were unlinked from Git
  (`frapp-landing` 2026-09-01, `frapp-web` 2026-09-02), so no merge deploys web or landing.
  Canonical record: ADR-21 in [`spec/architecture/adr/adr-21.md`](../../spec/architecture/adr/adr-21.md)
- **Production** — Supabase Cloud (prod project), API + frontends on production infrastructure

## 2. Secrets management

All non-local secrets are centrally managed in **Infisical**. Which providers it syncs to, and how CI gets its secrets instead: [`SECRETS_MANAGEMENT.md` § 5](../internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs). For the full per-app/per-environment mapping, see [`docs/internal/environment/ENV_REFERENCE.md`](../internal/environment/ENV_REFERENCE.md).

> **Note:** For the complete list of every environment variable, per app, per environment, see [`docs/internal/environment/ENV_REFERENCE.md`](../internal/environment/ENV_REFERENCE.md).

Key principles:

- **Infisical is the single source of truth** for all non-local secrets.
- **No `.env.example` files** — the centralized `ENV_REFERENCE.md` replaces them.
- **No placeholder secrets in CI** — CI only runs lint, typecheck, and tests (no runtime secrets needed).
- **Provider-native syncs** — Infisical pushes secrets to its sync destinations automatically (inventory linked above). Mobile EAS credentials are managed in Expo/EAS.

## 3. Local development setup

How local runs get their secrets (Infisical `dev`, a `.env.local` fallback, and the mobile exception) is in [`spec/environments/README.md` § 2](../../spec/environments/README.md#2-local-development). The steps are in [`getting-started.md` § 4](getting-started.md#4-configure-environment-variables); per-app commands and the no-Infisical fallback are in [`LOCAL_DEV.md`](../internal/environment/LOCAL_DEV.md).

## 4. Config module in the API

The NestJS API uses `@nestjs/config` to load environment variables:

- Reads from `process.env`; in development it loads **`.env.local` first and then `.env`** (whether values came from files or from Infisical-injected `process.env`).
- Provides typed access to configuration (database, Supabase, Stripe, etc.).
- Validates all required variables on startup via `env.validation.ts`.

When adding new env vars:

1. Add to the config module / validation.
2. Add the canonical value to Infisical, in the environments [`ENV_REFERENCE.md` § Adding a New Variable](../internal/environment/ENV_REFERENCE.md#adding-a-new-variable) says to fill (use the slug, never the UI display name).
3. Update `docs/internal/environment/ENV_REFERENCE.md`.
4. Update this guide if it matters to other developers.

## 5. Secrets and safety

> **Warning:** Never commit real secrets. Never use placeholder secrets in CI/CD workflows.

- Use `.env.local` for **local only** values (never committed).
- All staging/production secrets live in Infisical. Render receives them through syncs; the web and landing builds (staging and production) and the deploy workflows read Infisical at job time. Nothing is set in Vercel's env settings.
- Rotate keys immediately if they are ever exposed.
- See `docs/internal/environment/SECRETS_MANAGEMENT.md` for the rotation policy.

## 6. Supabase projects

We use separate Supabase projects for:

- **Local** — CLI-managed project via `supabase start`
- **Staging** — Cloud project in test mode
- **Production** — Cloud project with real data

Rules:

- Schema is **identical** across environments (migrations from `supabase/migrations/`).
- Never manually edit the prod schema via the UI without a migration.
- Keep staging as close to production as possible (schema + configuration).
