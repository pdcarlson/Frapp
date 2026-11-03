# Environment & Configuration

This guide explains how Frapp is configured across local, staging, and production environments.

## 1. Environment matrix

We maintain three main environments:

- **Local** — developer machine, Supabase CLI + Docker, secrets from Infisical `dev` (`.env.local` as fallback; see §3)
- **Staging** — Supabase Cloud (staging project), the API on Render, web and landing on Vercel. A merge to `main` whose CI passes runs its deploy, which ships what the merge changed.
- **Production** — Supabase Cloud (prod project), the API on Render, web and landing on Vercel. Deployed only from a named commit, by the **Deploy production** workflow.

How each deploy runs, in order: [`docs/ops/deployment/ci-cd.md` § How Deployments Are Gated](../ops/deployment/ci-cd.md#how-deployments-are-gated). Why it is shaped that way: [`spec/environments/README.md` § 6](../../spec/environments/README.md#6-continuous-deployment-cd).

## 2. Secrets management

All non-local secrets are centrally managed in **Infisical**. Which providers it syncs to, and how CI gets its secrets instead: [`SECRETS_MANAGEMENT.md` § 5](../internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs). For the full per-app/per-environment mapping, see [`docs/internal/environment/ENV_REFERENCE.md`](../internal/environment/ENV_REFERENCE.md).

> **Note:** For the complete list of every environment variable, per app, per environment, see [`docs/internal/environment/ENV_REFERENCE.md`](../internal/environment/ENV_REFERENCE.md).

Key principles:

- **Infisical is the single source of truth** for all non-local secrets.
- **No `.env.example` files** — the centralized `ENV_REFERENCE.md` replaces them.
- **No placeholder secrets in CI** — CI (`ci.yml`) reads no runtime secrets. Where a job needs a value only to exist, it sets a deliberately fake stand-in that ships nowhere; what ships gets real values from Infisical (the frontends at build time, the API through its Render sync) ([`ci-cd.md` § Secrets in CI vs CD](../ops/deployment/ci-cd.md#secrets-in-ci-vs-cd)).
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
