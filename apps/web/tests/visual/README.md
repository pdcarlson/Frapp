# Dashboard visual regression suite

Playwright-driven screenshot tests for the five dashboard routes currently in
`apps/web/app/(dashboard)`. Runs in CI as the `web-visual-regression` job.

## Running locally

```bash
npm run test:visual -w apps/web          # uses playwright.config.ts webServer
npx playwright test --update-snapshots   # refresh baselines (review the diff!)
```

Snapshots are stored per OS (Linux baselines are checked in for CI); regenerate
on the same platform CI uses.

## Why `webServer.env` has benign defaults

The Playwright config boots `npm run dev` when no `PLAYWRIGHT_BASE_URL` is
exported. In CI the job does not have Supabase credentials, so the merged
`webServer.env` injects non-routable stand-ins for:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL`

These values make Next.js finish its boot handshake. They do not point at any
real service; the proxy (`apps/web/proxy.ts`) detects missing-or-placeholder
env and skips auth redirects. Real deployments always receive the production
values via Vercel + Infisical.

If you set real values locally (via `.env.local` or an exported shell env),
those take precedence — the defaults only fill gaps.

## Updating baselines

1. Make the UI change on a feature branch.
2. Run `npm run test:visual -w apps/web` locally to confirm what changed.
3. If the diff is expected, refresh with `npx playwright test --update-snapshots`.
4. Commit the updated `*-snapshots/*.png` files alongside the code change.
