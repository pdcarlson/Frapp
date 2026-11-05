import { expect, test } from "@playwright/test";

/**
 * Sign-in and sign-up fit a small laptop window without scrolling.
 *
 * Paul, 2026-11-05: the split sign-in column scrolled even on his laptop, and
 * an average screen is smaller. 1280×650 is a 1366×768 or 1280×720 laptop
 * once the browser's own chrome takes its share, the smallest window the
 * signed-out frame shows its product panel in (`lg` is 1024). The
 * `components/auth/` comments cite this suite for the number.
 */

const FIT = { width: 1280, height: 650 } as const;

test.describe("sign-in and sign-up fit a laptop window", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(FIT);
  });

  for (const route of ["/sign-in", "/sign-up"]) {
    test(`${route} does not scroll vertically at ${FIT.width}×${FIT.height}`, async ({
      page,
    }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const scrollHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      expect(scrollHeight, `${route} is ${scrollHeight}px tall`).toBeLessThanOrEqual(
        FIT.height,
      );
    });
  }
});
