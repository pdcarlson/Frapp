import { expect, test, type Page } from "@playwright/test";

import { DASHBOARD_ROUTES } from "./routes";

/**
 * The document never scrolls on a dashboard route (#4000, #3857).
 *
 * The shell is the window's height and its columns scroll inside it. What
 * broke that was invisible content: an `sr-only` label or input is
 * `position: absolute`, and with no positioned ancestor it is laid out against
 * the page, so no scrolling column clips it. The ones far down a long column
 * made the document taller than the window, and a wheel at the end of a column
 * (the end of `/profile`, the chat members list) scrolled the whole app up off
 * the screen, leaving the page's bare background below it.
 *
 * A short, wide window: every column overflows, and chat sits beside the page.
 *
 * Two tests, because the sessionless harness (see `responsive-floor.spec.ts`)
 * renders most routes as a short empty state. The per-route one measures
 * whatever each route does render. The second plants the cause itself, a tall
 * block ending in an `sr-only` input, in the page column, so the mechanism is
 * covered whatever the harness has to show.
 */

const WIDTH = 1280;
const HEIGHT = 500;

/** Tries to scroll the window and the shell, then reports what moved. */
async function documentOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const shell = document.querySelector("[data-dashboard-shell]");
    window.scrollTo(0, 10_000);
    shell?.scrollTo(0, 10_000);
    return {
      documentHeight: root.scrollHeight,
      windowHeight: window.innerHeight,
      scrollY: window.scrollY,
      shellScrollTop: shell?.scrollTop ?? -1,
    };
  });
}

function expectNoDocumentScroll(
  measured: Awaited<ReturnType<typeof documentOverflow>>,
  route: string,
) {
  expect(
    measured.documentHeight,
    `${route}: the document is ${measured.documentHeight}px tall in a ` +
      `${measured.windowHeight}px window, so the whole app scrolls off the ` +
      "screen. Something absolutely positioned (an `sr-only` label or input, " +
      "usually) has no positioned ancestor inside the shell. See the comment " +
      "on the shell's root in components/layout/dashboard-shell.tsx.",
  ).toBeLessThanOrEqual(measured.windowHeight);
  expect(measured.scrollY, `${route}: the window scrolled`).toBe(0);
  expect(measured.shellScrollTop, `${route}: the shell itself scrolled`).toBe(0);
}

test.describe("the document never scrolls on a dashboard route", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  });

  for (const route of DASHBOARD_ROUTES) {
    test(`${route} keeps the document at the window's height`, async ({
      page,
    }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      // Same guard as the floor suite: never measure the sign-in card.
      await expect(page).not.toHaveURL(/\/sign-in/);

      expectNoDocumentScroll(await documentOverflow(page), route);
    });
  }

  test("hidden content far down the page column cannot move the app", async ({
    page,
  }) => {
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/\/sign-in/);

    const toolPage = page.locator("[data-tool-page]");
    await expect(toolPage).toBeVisible();
    const probe = await toolPage.evaluate((el) => {
      // One block, like a real section: the column is a flex container, and
      // an absolutely positioned flex child sits at its start, not its end.
      const section = document.createElement("div");
      section.style.flexShrink = "0";
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      const input = document.createElement("input");
      input.type = "radio";
      input.className = "sr-only";
      section.append(filler, input);
      el.append(section);

      el.scrollTo(0, el.scrollHeight);
      const column = el.getBoundingClientRect();
      const hidden = input.getBoundingClientRect();
      return {
        columnScrollTop: el.scrollTop,
        // The input travels with the column: at its end, it is inside it.
        inColumn: hidden.top >= column.top && hidden.bottom <= column.bottom,
      };
    });

    expectNoDocumentScroll(await documentOverflow(page), "/profile");
    expect(probe.columnScrollTop, "the page column scrolls").toBeGreaterThan(0);
    expect(
      probe.inColumn,
      "an sr-only input scrolls with the page column it is in",
    ).toBe(true);
  });
});
