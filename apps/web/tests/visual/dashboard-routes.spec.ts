import { expect, test } from "@playwright/test";

const dashboardRouteSnapshots = [
  { path: "/home", snapshotName: "home-main-content.png" },
  { path: "/members", snapshotName: "members-main-content.png" },
  { path: "/events", snapshotName: "events-main-content.png" },
  { path: "/points", snapshotName: "points-main-content.png" },
  { path: "/billing", snapshotName: "billing-main-content.png" },
  { path: "/profile", snapshotName: "profile-main-content.png" },
] as const;

test.describe("dashboard route visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  for (const route of dashboardRouteSnapshots) {
    test(`matches baseline for ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("main")).toHaveScreenshot(route.snapshotName, {
        animations: "disabled",
        caret: "hide",
      });
    });
  }
});
