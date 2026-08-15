# Dashboard visual regression suite

Playwright-driven screenshot tests for the five dashboard routes currently in
`apps/web/app/(dashboard)`. Runs in CI as the `web-visual-regression` job.

## Running locally

```bash
npm run test:visual -w apps/web          # uses playwright.config.ts webServer
npx playwright test --update-snapshots   # refresh baselines (review the diff!)
```

In **GitHub Actions**, `playwright.config.ts` sets `workers: 1` only when
`CI=true`. Match that when updating Linux baselines so widths match CI:

```bash
cd apps/web
CI=true npx playwright test --update-snapshots
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
real service. The env also includes `SUPABASE_AUTH_BYPASS=true`, which tells
the proxy (`apps/web/proxy.ts`) to skip auth redirects so protected routes
render their actual pages instead of redirecting to `/sign-in`. Real
deployments always receive the production values via Vercel + Infisical and
never set the bypass flag.

If you set real values locally (via `.env.local` or an exported shell env),
those take precedence — the defaults only fill gaps.

## Updating baselines

1. Make the UI change on a feature branch.
2. Run `npm run test:visual -w apps/web` locally to confirm what changed.
3. If the diff is expected, refresh with `npx playwright test --update-snapshots`.
4. Commit the updated `*-snapshots/*.png` files alongside the code change.

## Per-route attestations (regenerate-or-confirm history)

Each regenerated baseline must be listed with a reason + Chromium revision
(a convention from the retired redesign-chunk process). Add one per-route
entry below each time a chunk touches a dashboard surface (or, when nothing
changed, record why the existing baseline still applies) so reviewers don't
re-investigate the same surface.

### `/backwork` — #911's no-chapter guard, regenerated

**Status:** baseline **regenerated** (`backwork-main-content-linux.png`),
verified on the same Chromium revision CI installs.

**Why it moved:** `829cb46` (#911) added an early return to
`apps/web/components/backwork/backwork-page.tsx` — the fix for #873, where
`useBackworkResources` is `enabled: !!chapterId` and a disabled TanStack query
stays `pending` forever, so the spinner never stopped for a member with no
active chapter. This harness has no session, so `activeChapterId` is `null`,
the guard fires, and `<main>` is header + `EmptyState` ("No chapter selected")
at 1112×332. The old baseline was 1112×846 and showed Filters plus a Resources
card reading *"Loading backwork…"* — it was a photograph of the very bug #873
removed. Diff before regeneration: 13,736 px (ratio 0.02). **The page is
correct; only the baseline was stale.** The full 16-test run passed after the
regen, so no other surface was disturbed.

This is the same shape as the `/points` and `/chat` entries below: under this
harness the route renders its no-chapter branch, so the baseline attests to
that branch rather than to the real page. Restoring real coverage would mean
seeding `localStorage["frapp-active-chapter"]`, which would flip every route
that gates on `activeChapterId` (`/settings` renders its "Select an active
chapter" card today) and invalidate several passing baselines at once — worth
its own issue, not a side effect of a baseline refresh.

**Chromium revision used:** `chromium-headless-shell v1223` (Chrome Headless
Shell 148.0.7778.96), `@playwright/test` 1.60.0 — the same revision
`npx playwright install chromium` resolves in the `web-visual-regression` job.

**Sandbox note:** the cloud sandbox pre-installs revision 1194 (Chromium 141)
at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, which Playwright 1.60 refuses
to launch. Running the suite against 1194 anyway produced **8 spurious failures
of 16** at ratios of 0.02–0.04 — above the 0.01 `maxDiffPixelRatio` — on routes
CI passes, so a baseline regenerated on it would be a wrong fixture even if it
happened to pass. As with `/points`, the Playwright CDN was reachable here, so
1223 was fetched and used. After that, this sandbox reproduced CI exactly:
15 passed / 1 failed with byte-identical dimensions and pixel count.

Regenerate command used:

```bash
cd apps/web
CI=true npx playwright test tests/visual/dashboard-routes.spec.ts \
  --grep "/backwork" --update-snapshots
```

### `/points` — FRA-235 preview-fallback removal, regenerated

**Status:** baseline **regenerated** (`points-main-content-linux.png`), verified
locally against the same Chromium revision CI installs.

**Why it moved:** the old baseline captured a 1112×256 `LoadingState` card. In
this harness there is no active chapter, and `useMyPoints` was the one read in
`packages/hooks/src/use-points.ts` without `enabled: !!chapterId` — so it fired
against the non-routable `NEXT_PUBLIC_API_URL`, and TanStack Query's retry
backoff (3 retries, 1s/2s/4s) kept `isLoading` true well past the
`networkidle` screenshot point. FRA-235 gates that read like its three
siblings, so the query is now disabled without a chapter and the page renders
its real shell with honest empty states ("No leaderboard entries", "No
transactions in this window", `My balance 0 points`) at 1112×729. The diff was
16,231 px (ratio 0.03) before regeneration. Every other route in the suite
still matches its existing baseline — the full 16-test run passed after the
regen, so no other surface was disturbed.

**Chromium revision used:** `chromium-headless-shell v1223`
(Chrome Headless Shell 148.0.7778.96), the build `@playwright/test` 1.60.0
ships. The root `package-lock.json` pins `@playwright/test`, `playwright`, and
`playwright-core` to 1.60.0, so `npx playwright install --with-deps chromium`
in the `web-visual-regression` job resolves the same revision rather than
whatever `^1.58.2` happens to float to.

**Sandbox note (differs from the #311 precedent below):** the cloud sandbox
pre-installs revision 1194 at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
which Playwright 1.60 refuses to launch. Unlike when #311 was attested, the
Playwright CDN was reachable from this sandbox, so revision 1223 was fetched
and the regen ran on the CI-matching build rather than falling back to a
static-equivalence argument.

Regenerate command used:

```bash
cd apps/web
CI=true npx playwright test tests/visual/dashboard-routes.spec.ts \
  --grep "/points" --update-snapshots
```

### `/chat` — Chunk 04 (#278) rewrite, attested via #311

**Status:** baseline unchanged; rationale below; CI runtime confirmation is the
authoritative signal (see `web-visual-regression` job in `.github/workflows/ci.yml`).

**Why the Chunk 04 rewrite did not move `chat-main-content-linux.png`:** the
test exercises an unauthenticated, no-active-chapter session (Playwright opens
a fresh browser context with empty localStorage, so the persisted
`frapp-active-chapter` key is missing and `useChapterStore.activeChapterId`
is `null` — see `apps/web/lib/stores/chapter-store.ts`). Both the pre-rewrite
component (`apps/web/components/chat/chat-page.tsx` at commit `91581e0^`,
lines 439–446) and the post-rewrite shell
(`apps/web/components/chat/chat-shell.tsx:98-109`) early-return the same
`<Card>` with header "Chat" and description "Select an active chapter to load
channels and messages." The Slack-grade 3-pane surface introduced by #278
(`channel-list.tsx`, `message-timeline.tsx`, `composer.tsx`, `thread-panel.tsx`,
etc.) lives *past* that early return and is never reached under this test
harness. The on-disk PNG is ~6.5 kB, matching the size band of other empty-card
baselines (e.g. `billing` 6,455 B, `points` 6,287 B, `profile` 6,392 B), which
is consistent with the empty-state rendering. Chunk 05 will need to
re-evaluate this if it changes the no-active-chapter branch or if a future
test seeds an `activeChapterId` so the actual chat shell renders.

**Chromium revision used by CI:** the `web-visual-regression` job installs
the browser bundled with the project's pinned `@playwright/test` (currently
`^1.58.2` in `apps/web/package.json`) via
`npx playwright install --with-deps chromium`
(`.github/workflows/ci.yml:246`). Local regen runs must use the same
`@playwright/test` version — `npx playwright --version` should match
`apps/web/package.json` before running `--update-snapshots`.

**Sandbox limitation when #311 was attested:** the cloud-agent sandbox
that produced this note could not fetch the Chromium binary
(`playwright.azureedge.net`, `cdn.playwright.dev`, and
`playwright.download.prss.microsoft.com` all return HTTP 403
`x-deny-reason: host_not_allowed` for outbound requests). The static
equivalence above is the in-PR evidence; the `web-visual-regression` CI job
is the runtime verification. This is the same class of sandbox gap that
issue #235 (`ci: runtime-verify migrations + Edge Functions`) tracks for the
database layer — if the visual job stays sandbox-blocked across sessions,
file a sibling issue rather than ticking the verification box blind.

**Next session, if CI flagged a diff on `chat-main-content-linux.png`:**
regenerate **only** that file (Linux baseline, on the same Chromium revision
CI uses):

```bash
cd apps/web
CI=true npx playwright test tests/visual/dashboard-routes.spec.ts \
  --grep "/chat" --update-snapshots
```

Record the resulting `npx playwright --version` and the trigger
("Chunk NN <surface> rewrite") in this section.
