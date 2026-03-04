# Frapp Web Dashboard (`apps/web`)

Next.js admin dashboard for chapter leadership workflows.

## Local development

From repo root:

```bash
npm run dev -w apps/web
```

App URL: `http://localhost:3000`

## Environment

Copy `.env.example` to `.env.local` and provide:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL`

## Common commands

```bash
# Development
npm run dev -w apps/web

# Build
npm run build -w apps/web

# Lint
npm run lint -w apps/web

# Type check
npm run check-types -w apps/web
```

## Notes

- Uses shared theme tokens from `@repo/theme`.
- Uses shared API client/hooks from `@repo/api-sdk` and `@repo/hooks`.
- Vercel project config lives in `apps/web/vercel.json`.
