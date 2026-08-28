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

### Auth proxy (`proxy.ts`)

`apps/web/proxy.ts` is the Next.js 16 middleware file. It reads Supabase env
vars **per request** (not at module load) so the file can be imported safely in
environments without production secrets. When `NEXT_PUBLIC_SUPABASE_URL` or
`NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing, the proxy falls back to passthrough
(no redirect, no session check); real deployments always have both set via
Vercel + Infisical.

`readSupabaseEnv()` has a **second, separate** passthrough branch, and it is the
one the CI Playwright job (`web-responsive-floor`) actually takes: when
`SUPABASE_AUTH_BYPASS=true` and `NODE_ENV !== "production"`, it returns `null`
before reading either var. That job is *not* an example of the missing-vars path
— `playwright.config.ts` injects stand-in values for both, so neither is missing.
Debug a floor run that lands on `/sign-in` by checking whether the bypass flag
reached the dev server, not whether the Supabase vars are set. That redirect is
precisely what `responsive-floor.spec.ts`'s `toHaveURL` assertion exists to catch.

### Browser tests (375px responsive floor)

`npm run test:floor -w apps/web` runs every spec under `tests/visual/` — today
just the 375px responsive-floor gate, which stores no baseline and compares no
pixels. See [`tests/visual/README.md`](tests/visual/README.md) for what the
harness does and does not exercise, and for the benign-env rationale that lets
the Playwright `webServer` boot without real Supabase credentials.

There is no dashboard screenshot suite: `web-visual-regression` and its
committed baselines were deleted, so there is nothing to regenerate.
