import { expect, test } from "@playwright/test";
import { DASHBOARD_ROUTES } from "./routes";

/**
 * Neither the document nor the shell scrolls on a dashboard route (#4000,
 * #3857).
 *
 * The shell is one viewport tall and each column scrolls inside it. When the
 * shell had no `position`, every `absolute` box in a long page (each `sr-only`
 * label, a Radix control's hidden input) took the initial containing block, so
 * the shell's overflow did not clip it. Those boxes sat at their unscrolled
 * place below the fold, the document grew past the viewport, and scrolling it
 * carried the whole shell up and left a black band below it. Positioning the
 * shell alone moved that overflow into the shell, which `overflow-hidden`
 * still let the skip link, focus or `scrollIntoView` scroll; hence the second
 * check, which tries to scroll the shell and expects it not to move.
 *
 * A short window is what makes it show: this harness has no session, so pages
 * render without data, and only Billing's plan table is long enough at a
 * normal height. 420px puts more pages' content below the fold.
 *
 * Deliberately NOT a screenshot: it compares integers.
 */

const WIDTH = 1280;
const HEIGHT = 420;

for (const route of DASHBOARD_ROUTES) {
  test(`${route}: the document and the shell stay one window tall`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    // A redirect to `/sign-in` would measure a page with no shell.
    const shell = page.locator("[data-dashboard-shell]");
    await expect(shell).toBeVisible();

    const measured = await shell.evaluate((el) => {
      // Every scroll a page can cause on its ancestors at once: the last box
      // in the shell centred into view, then a direct write.
      const all = el.querySelectorAll("*");
      all[all.length - 1]?.scrollIntoView({ block: "center" });
      el.scrollTop = 10_000;
      return {
        documentHeight: document.scrollingElement?.scrollHeight ?? 0,
        shellScrollTop: el.scrollTop,
      };
    });
    expect(
      measured.documentHeight,
      `${route}: the document is ${measured.documentHeight}px tall in a ` +
        `${HEIGHT}px window, so it scrolls and carries the shell up. Look for ` +
        "a box positioned outside the shell's containing block " +
        "(`dashboard-shell.tsx`, #4000).",
    ).toBeLessThanOrEqual(HEIGHT);
    expect(
      measured.shellScrollTop,
      `${route}: the shell scrolled ${measured.shellScrollTop}px, which ` +
        "slides the nav and top bar up past the window. The shell must stay " +
        "`overflow-clip` (`dashboard-shell.tsx`, #4000).",
    ).toBe(0);
  });
}
