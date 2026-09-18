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
   * One retry in CI only, and it is insurance rather than evidence that the
   * suite flakes: a geometry assertion either holds or it does not. What it
   * covers is the boot, not the tests — this job builds the app and starts a
   * server before anything runs, so a slow runner shows up as a `webServer`
   * timeout, and a retry is cheap next to a re-queued required check.
   */
  retries: isCi ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3102",
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
  /*
   * **Port 3102, not the app's own 3002, and `reuseExistingServer: false`.**
   * Both are about not silently measuring the wrong server.
   *
   * `npm run dev -w apps/landing` serves on 3002. With `reuseExistingServer`
   * and that port, a developer who happens to have the dev server up gets the
   * whole suite run against it — and per the note above that is the one server
   * these assertions do not hold on. The failure would read as a page
   * regression rather than a harness mismatch, and two of the tests would pass
   * for the wrong reason. `apps/web` can set that flag safely because its
   * webServer command IS `npm run dev`; here the two differ, so the port has to.
   *
   * Never reusing also means a local run always serves the build it just made.
   * A `next start` left over from an earlier run happily serves a stale
   * `.next`, which is the same class of silent-wrong-target mistake.
   */
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run build && npx next start --port 3102",
        url: "http://127.0.0.1:3102",
        reuseExistingServer: false,
        timeout: 240_000,
      },
});
