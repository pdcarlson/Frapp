import { expect, test } from "@playwright/test";

import { DASHBOARD_ROUTES, snapshotNameFor } from "./routes";


test.describe("dashboard route visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  for (const route of DASHBOARD_ROUTES) {
    test(`matches baseline for ${route}`, async ({ page }) => {
      await page.goto(route);
      // Wait for the dev server's initial data fetches + font swap so the
      // rendered `<main>` height is stable. Without this, Playwright can
      // screenshot before Geist Sans finishes loading, causing a 1px
      // rounding drift in CI vs. local baselines.
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("main")).toHaveScreenshot(snapshotNameFor(route), {
        animations: "disabled",
        caret: "hide",
      });
    });
  }
});
