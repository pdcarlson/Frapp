import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { DASHBOARD_ROUTES, PRE_AUTH_ROUTES } from "./routes";

/**
 * The 375px floor for the routes a signed-out visitor sees.
 *
 * `responsive-floor.spec.ts` covers the fifteen dashboard routes and cannot
 * cover these: it asserts each route did **not** land on `/sign-in`, which is
 * the guard that stops a regressed `SUPABASE_AUTH_BYPASS` from turning all
 * fifteen into green measurements of the sign-in card. For a pre-auth route
 * that assertion is inverted, so these carry a per-route expected URL instead.
 *
 * The #920 Profile & pre-auth slice rebuilt `/sign-in`, `/sign-up` and `/join`
 * and repainted `/` and `/no-access`; before it, nothing measured any of them
 * at any width. `/join` still is not measured here — see `routes.ts`.
 *
 * **Worth stating: these four are the routes this harness renders *correctly*.**
 * Its usual limitation is that a sessionless run leaves roughly ten of the
 * fifteen dashboard routes showing an empty-state card instead of their real
 * content. Signed out is not a degraded mode for a sign-in screen; it is the
 * only mode, so this suite is real coverage rather than shell coverage.
 */

const FLOOR = 375;

test.describe("pre-auth routes hold the 375px floor", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: FLOOR, height: 800 });
  });

  for (const { route, expectUrl } of PRE_AUTH_ROUTES) {
    test(`${route} does not scroll horizontally at ${FLOOR}px`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      // The inverse of the dashboard suite's assertion, and load-bearing for
      // the same reason: a pre-auth route that quietly redirected would
      // otherwise be measured under another route's name.
      await expect(page).toHaveURL(expectUrl);
      await expect(page.locator("main")).toBeVisible();

      const measured = await page.evaluate((floor) => {
        const main = document.querySelector("main");
        const style = main ? getComputedStyle(main) : null;
        const budget =
          floor -
          (style
            ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            : 0);

        const clipped = (el: Element): boolean => {
          for (let node: Element | null = el; node && node !== main; node = node.parentElement) {
            const overflowX = getComputedStyle(node).overflowX;
            if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
              return true;
            }
          }
          return false;
        };

        const widest = [...(main?.querySelectorAll("*") ?? [])]
          .filter((el) => el.scrollWidth > budget && !clipped(el))
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
            `class="${measured.widest.className}".`
          : `${route} overflows by ${measured.scrollWidth - FLOOR}px, but every element ` +
            `inside <main> fits the ${measured.budget}px budget. The pre-auth column is ` +
            "`max-w-[400px] mx-auto` with `px-6`, so a breach here is the column's " +
            "padding or a child that cannot wrap — check the footer link row first.",
      ).toBeLessThanOrEqual(FLOOR);
    });
  }
});

/**
 * The guard this suite's existence costs, restored.
 *
 * `playwright.config.ts` says it plainly: Playwright exits 1 only when a run
 * collects **no** tests, so with two specs in this directory "delete or rename
 * the floor spec and the run passes on the survivor and exits 0 with the floor
 * silently unmeasured. Adding a second spec to this directory means taking
 * that on deliberately."
 *
 * Taken on, and closed. Deleting or renaming `responsive-floor.spec.ts`, or
 * quietly shrinking its route list, turns the surviving spec red — which is a
 * strictly better guard than the one it replaces, because the old one only
 * fired when the directory collected nothing at all.
 */
test("the dashboard floor suite still exists and still measures all fifteen routes", () => {
  // `new URL(..., import.meta.url)` rather than `__dirname`: Playwright loads
  // these specs as ES modules, where `__dirname` is not defined at all.
  const sibling = new URL("./responsive-floor.spec.ts", import.meta.url);
  const source = readFileSync(sibling, "utf8");
  expect(
    source,
    "responsive-floor.spec.ts must keep reading DASHBOARD_ROUTES from routes.ts",
  ).toMatch(/DASHBOARD_ROUTES/);
  expect(
    DASHBOARD_ROUTES,
    "a dashboard route was removed from the required floor gate",
  ).toHaveLength(15);
});
