import { expect, test } from "@playwright/test";

/**
 * The sidebar fits a 1024×768 window, asserted rather than eyeballed (#2946).
 *
 * `spec/ui/web-dashboard/README.md` § Responsive contract: at `lg` and up the
 * nav column fits a 1024×768 window for every seeded role without scrolling.
 * Before #2946 a President's 17 rows needed an 828px-tall window and scrolled
 * by 60px at 768. The fix folded the six-row Admin group into one Settings row.
 * This test is what stops the list growing back past the budget one "just one
 * more row" at a time. Each row costs 36px.
 *
 * **Why this harness is the worst case.** It runs with no session and no
 * active chapter (see `responsive-floor.spec.ts`), so the permission set and
 * the chapter read never resolve. Both nav gates fail open while unresolved
 * (`isNavItemVisible`), so every row any role could see renders here at once:
 * more than any single seeded role sees, the President included.
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
  await page.goto("/events");
  await page.waitForLoadState("networkidle");

  // Same guard as the floor suite: a redirect to `/sign-in` would measure a
  // page with no sidebar and pass vacuously.
  await expect(page).toHaveURL(/\/events\/?$/);

  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  // The last row of the list. If the fail-open premise above ever stops
  // holding, this is what goes missing, and the test says so instead of
  // passing on a shorter list.
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();

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
