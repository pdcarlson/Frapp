# Frapp Web Dashboard (`apps/web`)

Next.js admin dashboard for chapter leadership workflows.

## Local development

From repo root:

```bash
npm run dev -w apps/web
```

App URL: `http://localhost:3000`

## Environment

Provide the following variables through Infisical (`npm run dev:web`) or a local
`.env.local` fallback file:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL` (API origin, e.g. `http://localhost:3001` — the OpenAPI client adds `/v1/...` from the contract)

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

### Auth proxy (`proxy.ts`)

`apps/web/proxy.ts` is the Next.js 16 middleware file. It reads Supabase env
vars **per request** (not at module load) so the file can be imported safely
in environments without production secrets — notably the CI Playwright job,
which boots `npm run dev` to capture visual-regression baselines. When
`NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing the
proxy falls back to passthrough (no redirect, no session check); real
deployments always have both set via Vercel + Infisical.

### Visual regression tests

See [`tests/visual/README.md`](tests/visual/README.md) for the benign-env
rationale that lets the Playwright `webServer` boot without real Supabase
credentials.
