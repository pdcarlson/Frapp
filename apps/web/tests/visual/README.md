# Dashboard browser suite

Playwright tests that drive the dashboard routes in `apps/web/app/(dashboard)`
against a real `next dev`. One suite today — `responsive-floor.spec.ts`, the
375px floor gate — running in CI as the **required** `web-responsive-floor` job.

The route list both this suite and any future one reads is `routes.ts`. Add a
dashboard screen there and every spec in this directory picks it up.

## There used to be a snapshot suite here

`dashboard-routes.spec.ts` photographed each route at 1440×960 and compared it
to a committed PNG, running as the advisory `web-visual-regression` job. It has
been **deleted**, along with its sixteen baselines and the `test:visual` script.

The reason is the reason it was advisory in the first place. Baselines were
pinned to the exact Chromium build CI installs, so they drifted with every
Playwright bump, and refreshing one correctly required either CI's own browser
revision or a local `npx playwright install chromium` plus a careful check that
the revision matched. A gate that cannot block, and whose red X is usually
answered by regenerating the fixture, is not measuring anything — it is a tax on
every UI change. The 375px floor gate was split out of it in #1152 precisely
because it is the half worth keeping.

If pixel coverage comes back, it should come back as a hosted service with
per-PR review and accepted-baseline management (Percy, Chromatic, Argos), not as
PNGs in the repo.

## Running locally

```bash
npm run test:floor -w apps/web   # the 375px floor gate; boots its own dev server
```

`test:floor` runs the whole directory rather than a `--grep` slice, so a new spec
added here joins the required job by default instead of falling into no job at
all. Don't reintroduce a filter without a second job to catch what it excludes.

In **GitHub Actions**, `playwright.config.ts` sets `workers: 1` and `forbidOnly`
only when `CI=true`. Prefix with `CI=true` to reproduce a CI failure exactly.

### If the browser will not launch (cloud sandboxes)

Agent sandboxes preinstall a Chromium under `PLAYWRIGHT_BROWSERS_PATH`
(`/opt/pw-browsers`) whose revision may not match the one the pinned
`@playwright/test` expects — r1194 against r1234, at the time of writing — and
`playwright test` then fails to find a browser at all. **Do not run
`playwright install`**: the point of the preinstalled build is that the sandbox
has no egress for it.

Because this suite stores no baseline and compares no pixels, the revision skew
cannot affect its *result* — it only has to launch. An uncommitted config that
extends the real one is enough:

```ts
// apps/web/playwright.sandbox.config.ts — do NOT commit
import base from "./playwright.config";

export default {
  ...base,
  use: {
    ...(base as { use?: Record<string, unknown> }).use,
    launchOptions: {
      executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
};
```

```bash
cd apps/web && CI=true npx playwright test --config=playwright.sandbox.config.ts
```

Keep it uncommitted: it hardcodes one sandbox's revision path, and CI installs
the pinned browser properly. Check the actual directory name under
`/opt/pw-browsers` rather than copying the revision above.

**Delete it once the run is done.** `check-types` compiles everything under
`apps/web`, and this file fails it — `TS4082: Default export of the module has
or is using private name 'TestConfigWebServer'`, because spreading the base
config widens the inferred type past what the package exports. It is not in
`.gitignore` either, so leaving it behind turns both `npm run check-types` and
`git status` red for reasons that have nothing to do with the branch.

## What the harness does and does not exercise

Every spec here runs with **no session and no active chapter**: Playwright opens
a fresh context with empty `localStorage`, so the persisted
`frapp-active-chapter` key is missing and `useChapterStore.activeChapterId` is
`null` (`apps/web/lib/stores/chapter-store.ts`). Several routes therefore render
an empty state or a "Select an active chapter" card rather than their populated
content — `/chat` and `/backwork` early-return before their real surfaces mount,
and `/points` is the one route whose fix for #1142 lives inside `<main>` and does
render for real.

That is a real limit, not a formality: a route whose *populated* table overflows
at 375px while its empty state does not would still pass. Seeding an active
chapter would flip every route that gates on `activeChapterId` at once and is its
own piece of work, not a side effect of a test change.

It is not a hole for the defect the floor gate was built for. The shell is
identical on every route, and it was the shell — one missing `min-w-0` — that
broke six of the seven routes in #1142.

## Why `webServer.env` has benign defaults

`playwright.config.ts` boots `npm run dev` when no `PLAYWRIGHT_BASE_URL` is
exported. In CI the job has no Supabase credentials, so the merged
`webServer.env` injects non-routable stand-ins for:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL`

These make Next.js finish its boot handshake and point at no real service. The
env also sets `SUPABASE_AUTH_BYPASS=true`, which tells the proxy
(`apps/web/proxy.ts`) to skip auth redirects so protected routes render their
actual pages instead of `/sign-in`. Real deployments always receive production
values via Vercel + Infisical and never set the bypass flag.

If you export real values locally (`.env.local` or the shell), those win — the
defaults only fill gaps.

`responsive-floor.spec.ts` asserts the landed URL still matches the route it
requested, which is what stops a regressed bypass from silently turning the whole
suite into fifteen green measurements of the sign-in card.
