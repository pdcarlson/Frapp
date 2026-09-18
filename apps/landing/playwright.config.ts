import { defineConfig } from "@playwright/test";

const isCi = Boolean(process.env.CI);

/**
 * The landing's browser suite: the fold, measured.
 *
 * It is the same LANE as `apps/web/tests/visual/` and deliberately not the same
 * measurement. That lane stores no baseline and compares no pixels — the
 * snapshot suite that did was deleted because baselines pinned to CI's Chromium
 * build drifted with every bump, and `.claude/skills/testing/SKILL.md` says in
 * as many words never to re-add an `--update-snapshots` step. So this suite
 * photographs nothing. It reads geometry off the rendered page and compares it
 * to the numbers the reskin boards commit to: the 1440x900 fold on
 * `spec/ui/landing/reference/canvas/HeroB.dc.html` and the 390 phone board D6
 * pins (`Phone.dc.html`), at 390x844.
 *
 * `testDir` selection is by DIRECTORY, not by tag, for the reason
 * `apps/web/playwright.config.ts` gives: a new spec dropped in here joins the
 * CI job by default instead of falling through into no job at all.
 *
 * **The zero-test guard is load-bearing and is why this directory holds one
 * spec.** Playwright exits 1 when a run collects no tests, which is what stops
 * this job from going green having asserted nothing. That guard keys on the
 * collected-test COUNT, so it weakens the moment a second spec lands here: with
 * two, deleting one leaves the run passing on the survivor. `apps/web` closes
 * that hole with a spec that reads its sibling off disk and pins the route
 * count. Adding a second spec to this directory means taking that on too.
 */
export default defineConfig({
  testDir: "./tests/visual",
  timeout: 30_000,
  fullyParallel: false,
  workers: isCi ? 1 : undefined,
  /*
   * A committed `test.only` would narrow the run to one test and still exit 0,
   * which is the other way a gate goes hollow. Same posture as `apps/web`.
   */
  forbidOnly: isCi,
  /*
   * One retry in CI only. This suite boots a cold `next dev` and pays each
   * route's first compile, and unlike the dashboard floor it has no warm
   * sibling job. It is insurance against a slow first compile, not evidence
   * that the suite flakes: a geometry assertion either holds or does not.
   */
  retries: isCi ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  /*
   * A PRODUCTION build, not `next dev`, and that is not a preference.
   *
   * Under `next dev` the stylesheet is injected by JavaScript, so at the moment
   * React's effects run the page has not been laid out with it: every
   * `RevealOnView` measures a top inside the viewport, takes the
   * measure-before-arm early return, and never arms. Measured on this page at
   * 1440x900 — `next dev` arms 0 blocks, `next start` arms 6. A suite pointed at
   * dev would assert against a page whose motion never engages, which is most of
   * what there is to assert.
   */
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run build && npx next start --port 3002",
        url: "http://127.0.0.1:3002",
        reuseExistingServer: !isCi,
        timeout: 240_000,
      },
});
