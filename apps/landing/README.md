# Frapp Landing Site (`apps/landing`)

Marketing site for Frapp (`frapp.live`).

## Local development

From repo root:

```bash
npm run dev -w apps/landing
```

Site URL: `http://localhost:3002`

## Environment

Canonical list: [`docs/internal/environment/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md) (`apps/landing` table). There is no `.env.example`.

- `NEXT_PUBLIC_APP_URL` — web app origin used for CTA and `/join` links
- `NEXT_PUBLIC_LANDING_SENTRY_DSN` — optional; unset → Sentry never inits
- `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` — optional write-only PostHog ingest; unset → PostHog never inits

## Common commands

```bash
# Build
npm run build -w apps/landing

# Lint
npm run lint -w apps/landing

# Type check
npm run check-types -w apps/landing
```

## Deployment

- Vercel project: `frapp-landing`
- Staging/production deploys are CI-owned ([ADR-21](../../spec/architecture/adr/adr-21.md)); there is no `production` branch
