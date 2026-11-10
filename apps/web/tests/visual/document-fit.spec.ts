import { expect, test } from "@playwright/test";
import { DASHBOARD_ROUTES } from "./routes";

/**
 * The document never scrolls on a dashboard route (#4000, #3857).
 *
 * The shell is one viewport tall (`h-dvh overflow-hidden`) and each column
 * scrolls inside it. When the shell had no `position`, every `absolute` box
 * in a long page (each `sr-only` label, a Radix control's hidden input) took
 * `<body>` as its containing block, so the shell's `overflow-hidden` did not
 * clip it. Those boxes sat at their unscrolled place below the fold, the
 * document grew past the viewport, and scrolling it carried the whole shell up
 * and left a black band below it.
 *
 * A short window is what makes it show: this harness has no session, so pages
 * render without data, and only Billing's plan table is long enough at a
 * normal height. 420px puts more pages' content below the fold.
 *
 * Deliberately NOT a screenshot: it compares two integers.
 */

const WIDTH = 1280;
const HEIGHT = 420;

for (const route of DASHBOARD_ROUTES) {
  test(`${route}: the document is no taller than the window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    // A redirect to `/sign-in` would measure a page with no shell.
    await expect(page.locator("[data-dashboard-shell]")).toBeVisible();

    const scrollHeight = await page.evaluate(
      () => document.scrollingElement?.scrollHeight ?? 0,
    );
    expect(
      scrollHeight,
      `${route}: the document is ${scrollHeight}px tall in a ${HEIGHT}px ` +
        "window, so it scrolls and carries the shell up. Look for a box " +
        "positioned outside the shell's containing block " +
        "(`dashboard-shell.tsx`, #4000).",
    ).toBeLessThanOrEqual(HEIGHT);
  });
}
