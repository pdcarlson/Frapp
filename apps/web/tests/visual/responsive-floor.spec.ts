import { expect, test } from "@playwright/test";

import { DASHBOARD_ROUTES } from "./routes";

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
 * **It blocks.** It still lives in this directory, because it needs the same
 * browser and dev server `playwright.config.ts` provisions for the snapshot
 * suite — but it runs in its own required CI job, `web-responsive-floor`, not
 * in `web-visual-regression` (#1152). The `@floor` tag below is what separates
 * them: the floor job runs `--grep @floor` and the visual job runs
 * `--grep-invert @floor`, so each suite runs exactly once and a NEW spec added
 * to this directory joins the visual job by default rather than falling through
 * a path list into neither.
 *
 * That split exists because the two suites fail for unrelated reasons. The
 * visual job is deliberately advisory — snapshots drift with Chromium revisions
 * and font rendering, and blocking merges on that is worse than not blocking.
 * This test stores no baseline and compares no pixels, so it has none of those
 * failure modes and inherited the exemption purely by directory. It reads one
 * integer and compares it to 375.
 *
 * On failure it names the widest element inside `<main>` and its classes,
 * because "scrollWidth is 426" on its own sends the next person back to the
 * DevTools session this test was supposed to replace.
 *
 * **What this harness does and does not exercise.** It runs with no session and
 * no active chapter, so several routes render an empty or loading state rather
 * than their populated content — the same limitation the screenshot baselines
 * carry, documented per route in `README.md`. That is not a hole for the defect
 * this gate was built for: the shell is identical on every route, and it was the
 * shell (one missing `min-w-0`) that caused six of the seven breaches in #1142.
 * `/points`, the one route whose fix is inside `<main>`, does render its real
 * content here — `useMyPoints` is gated on `chapterId`, so it settles instead of
 * retrying — and reverting the `max-sm:` classes does turn this test red.
 * A route whose *populated* table overflows while its empty state does not
 * would still slip through; signed-in coverage is a separate piece of work.
 */

const FLOOR = 375;

test.describe("dashboard routes hold the 375px floor", { tag: "@floor" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: FLOOR, height: 800 });
  });

  for (const route of DASHBOARD_ROUTES) {
    test(`${route} does not scroll horizontally at ${FLOOR}px`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      // The route actually under test must be the route that rendered. Without
      // this, a regressed `SUPABASE_AUTH_BYPASS` (or a run against an external
      // `PLAYWRIGHT_BASE_URL`, where the config skips `webServer` and never
      // applies the bypass env) redirects every route to `/sign-in`, whose
      // centred card holds 375px unconditionally — and all fifteen tests go
      // green having never rendered the dashboard shell at all.
      await expect(page).toHaveURL(new RegExp(`${route}/?$`));
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

        // A scroll container's `scrollWidth` is its *content* width, so a wide
        // table inside `ui/table.tsx`'s `overflow-auto` wrapper measures huge
        // while contributing nothing to the document's overflow. Reporting it
        // would name an innocent element and advise "scroll it in its own
        // container" at something already doing exactly that.
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
