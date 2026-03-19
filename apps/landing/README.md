# Frapp Landing Site (`apps/landing`)

Marketing site for Frapp (`frapp.live`).

## Local development

From repo root:

```bash
npm run dev -w apps/landing
```

Site URL: `http://localhost:3002`

## Environment

Copy `.env.example` to `.env.local` and configure:

- `NEXT_PUBLIC_APP_URL` — web app URL used for CTA links

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

- Vercel config: `apps/landing/vercel.json`
- `main` branch deploys to staging landing domain
- `production` branch deploys to production landing domain
