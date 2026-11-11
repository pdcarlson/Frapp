import { expect, test } from "@playwright/test";

/**
 * The sidebar fits a 1024×768 window, asserted rather than eyeballed (#2946).
 *
 * `spec/ui/web-dashboard/README.md` § Responsive contract: at `lg` and up the
 * nav column fits a 1024×768 window for every seeded role without scrolling.
 * Before #2946 a President's 17 rows needed an 828px-tall window and scrolled
 * by 60px at 768. The fix folded the six-row Admin group into one row, now named Chapter settings.
 * This test is what stops the list growing back past the budget one "just one
 * more row" at a time. Each row costs 36px.
 *
 * **Why this harness is the worst case.** It runs with no session (see
 * `responsive-floor.spec.ts`), seeds an active chapter, and answers the
 * permission read with the owner's `*`, so every permission-gated row shows.
 * The current-chapter read is held unanswered, so the module gate stays open
 * (`isNavItemVisible`) and every module row shows too, beta-off ones included:
 * more rows than any single seeded role sees, the President included.
 *
 * It used to need no stubs, because both gates failed open while unresolved.
 * The permission gate fails closed since #3854, so a sessionless page draws no
 * gated row at all and would measure a short list.
 *
 * Deliberately NOT a screenshot: it compares two integers, so it cannot drift
 * with a Chromium revision.
 */

const WIDTH = 1024;
const HEIGHT = 768;

test("the sidebar fits a 1024×768 window with every row showing", async ({
  page,
}) => {
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "frapp-active-chapter",
      JSON.stringify({ state: { activeChapterId: "nav-fit" }, version: 0 }),
    );
  });
  await page.route("**/v1/users/me/permissions", (route) =>
    route.fulfill({ json: { permissions: ["*"] } }),
  );
  // Never answered: an unresolved chapter read is what keeps every module row
  // in the list. It also rules out `networkidle`, which this request blocks.
  await page.route("**/v1/chapters/current", () => new Promise<void>(() => {}));
  await page.goto("/events");
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);

  // Same guard as the floor suite: a redirect to `/sign-in` would measure a
  // page with no sidebar and pass vacuously.
  await expect(page).toHaveURL(/\/events\/?$/);

  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  // The last row of the list. If the stubs above ever stop reaching the nav,
  // this is what goes missing, and the test says so instead of passing on a
  // shorter list.
  await expect(nav.getByRole("link", { name: "Chapter settings" })).toBeVisible();

  const measured = await nav.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    rows: el.querySelectorAll("a").length,
  }));

  expect(
    measured.scrollHeight,
    `The sidebar's ${measured.rows} rows need ${measured.scrollHeight}px but ` +
      `the nav region is ${measured.clientHeight}px at ${WIDTH}×${HEIGHT}, so it ` +
      "scrolls. Each row costs 36px and a section heading about 37px. Find " +
      "the new row a home inside an existing one (a tab, or Settings) rather " +
      "than growing the list — spec/ui/web-dashboard/README.md § Navigation map.",
  ).toBeLessThanOrEqual(measured.clientHeight);
});
