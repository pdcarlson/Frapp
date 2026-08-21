import { expect, test } from "@playwright/test";

/**
 * The 375px floor, asserted rather than eyeballed.
 *
 * `spec/ui/web-dashboard/README.md`: "375px is the floor. Every dashboard route
 * MUST render without horizontal scroll down to 375px." Nothing enforced it.
 * `dashboard-routes.spec.ts` pins every shot to 1440×960 and
 * `playwright.config.ts` sets no viewport, so the entire class of defect was
 * invisible to CI — seven routes had breached the floor by the time #1142 was
 * filed, and the shell had regressed without anyone noticing.
 *
 * This is deliberately NOT a screenshot test. It stores no baseline, so it
 * cannot go stale, cannot drift with a Chromium revision, and needs no
 * regeneration ritual when a page legitimately changes. It asserts one number.
 *
 * On failure it names the widest element inside `<main>` and its classes,
 * because "scrollWidth is 426" on its own sends the next person back to the
 * DevTools session this test was supposed to replace.
 */

const FLOOR = 375;

/** Every route `dashboard-routes.spec.ts` covers, which is every dashboard route. */
const ROUTES = [
  "/members",
  "/events",
  "/tasks",
  "/service",
  "/documents",
  "/backwork",
  "/geofences",
  "/study",
  "/polls",
  "/chat",
  "/points",
  "/billing",
  "/reports",
  "/profile",
  "/settings",
] as const;

test.describe("dashboard routes hold the 375px floor", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: FLOOR, height: 800 });
  });

  for (const route of ROUTES) {
    test(`${route} does not scroll horizontally at ${FLOOR}px`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();

      const measured = await page.evaluate((floor) => {
        const main = document.querySelector("main");
        // Deliberately NOT `main.clientWidth`. When the overflow is bad enough
        // `<main>` is itself stretched — it measured 523px on `/points` — and
        // comparing children against that inflated number finds no offender at
        // all. The budget is what `<main>` is *supposed* to get: the floor, less
        // its own horizontal padding.
        const style = main ? getComputedStyle(main) : null;
        const budget =
          floor -
          (style
            ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            : 0);
        const widest = [...(main?.querySelectorAll("*") ?? [])]
          .filter((el) => el.scrollWidth > budget)
          .sort((a, b) => b.scrollWidth - a.scrollWidth)[0];

        return {
          scrollWidth: document.documentElement.scrollWidth,
          budget,
          widest: widest
            ? {
                width: widest.scrollWidth,
                tag: widest.tagName.toLowerCase(),
                className: widest.getAttribute("class") ?? "",
              }
            : null,
        };
      }, FLOOR);

      expect(
        measured.scrollWidth,
        measured.widest
          ? `${route} overflows by ${measured.scrollWidth - FLOOR}px. The widest ` +
            `element inside <main> is <${measured.widest.tag}> at ` +
            `${measured.widest.width}px against a ${measured.budget}px budget: ` +
            `class="${measured.widest.className}". Give it a way to shrink — wrap it, ` +
            "stack it below `sm`, add `min-w-0`, or scroll it in its own container."
          : `${route} overflows by ${measured.scrollWidth - FLOOR}px, but every element ` +
            `inside <main> fits the ${measured.budget}px budget — so the cause is the ` +
            "shell, not the page. Check the header row, and that the content column " +
            "still carries `min-w-0`: a flex item without it cannot shrink below its " +
            "min-content width, which was six of the seven routes in #1142.",
      ).toBeLessThanOrEqual(FLOOR);
    });
  }
});
