import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { DASHBOARD_ROUTES } from "./routes";

/**
 * Tool pages hold their 375px floor beside chat (#4033, #4022).
 *
 * Beside chat (#3779) a tool page can be as narrow as 375px in a window wide
 * enough for every viewport breakpoint, so a page that breaks on `sm`/`md`/`lg`
 * draws its desktop layout into a phone's width. `responsive-floor.spec.ts`
 * can't see that: its 375px *viewport* makes the page and the window the same
 * width. This opens each tool beside chat in a 1440px window with the divider
 * at its minimum (`frapp_chat_split=0`; CSS holds the page at 375px) and asserts
 * the page doesn't scroll sideways.
 *
 * **What CI measures.** The same sessionless harness as the other suites, so
 * most pages show an empty or loading state, and this mostly pins the shell's
 * beside-chat floor. The populated pages are the point, and they need a
 * signed-in chapter: start the stack, seed it (`scripts/demo/setup-demo.sh`),
 * boot the API and `next dev` yourself, then from `apps/web`
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 BESIDE_CHAT_SIGN_IN=1 \
 *     npx playwright test beside-chat-floor
 *
 * which signs in once as the demo president. `localhost`, not `127.0.0.1`:
 * the API's CORS list names the former (`docs/guides/demo-data.md`). A signed-in
 * harness for CI is #4033's open follow-up.
 *
 * Deliberately NOT a screenshot: it compares integers.
 */

const WINDOW = { width: 1440, height: 900 };
const FLOOR = 375;

const SIGN_IN = process.env.BESIDE_CHAT_SIGN_IN === "1";
// The local demo seed's login and chapter: `LOCAL_DEMO_*` and
// `demoIds(TEMPLATE_NAMESPACE)` in `scripts/demo/seed-demo.mjs`, which notes
// this copy. Restated rather than imported: `check-types` compiles this file,
// and the seed script is untyped JavaScript outside the web app.
const DEMO_EMAIL = "marcus.ellison@example.com";
const DEMO_PASSWORD = "DemoShowcase!2026";
const DEMO_CHAPTER_ID = "c0ffee00-0000-4000-8000-000000000001";

/**
 * Every dashboard route but `/chat` (chat alone, no tool page), plus the tool
 * surfaces `routes.ts` reaches only as a tab or not at all: Roles is a Settings
 * tab, Alumni a Directory tab, and Chat admin opens from Settings.
 */
const TOOL_ROUTES = [
  ...DASHBOARD_ROUTES.filter((route) => route !== "/chat"),
  "/chat-admin",
  "/settings?tab=roles",
  "/members?tab=alumni",
];

/**
 * Still on viewport breakpoints until the Settings rebuild (#3856, open as
 * #4106) lands: Settings' 200px rail sits beside its content at `lg`, so a
 * populated Settings overflows beside chat. Expected to fail signed in.
 */
const NOT_YET_CONVERTED = new Set(["/settings", "/settings?tab=roles"]);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function signInAsDemoPresident(page: Page) {
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.fill("#email", DEMO_EMAIL);
  await page.fill("#password", DEMO_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 30_000,
    }),
    page.click('button[type="submit"]'),
  ]);
  // The active chapter lives in a persisted store only the chapter picker
  // writes, so a fresh sign-in leaves every chapter query disabled
  // (`scripts/demo/capture-screenshots.mjs` says more).
  await page.evaluate((chapterId) => {
    localStorage.setItem(
      "frapp-active-chapter",
      JSON.stringify({
        state: { activeChapterId: chapterId, hasHydrated: true },
        version: 0,
      }),
    );
  }, DEMO_CHAPTER_ID);
  // Seeded logins have accepted no Terms (#2302). The prompt is the
  // dashboard's, so it mounts on a dashboard route, not on the sign-in redirect.
  await page.goto("/members", { waitUntil: "networkidle" });
  const terms = page.locator("#terms-prompt-accept");
  if (await terms.isVisible().catch(() => false)) {
    await terms.check();
    await page
      .locator('form:has(#terms-prompt-accept) button[type="submit"]')
      .click();
    await terms.waitFor({ state: "detached" });
  }
}

test.describe("tool pages hold the 375px floor beside chat", () => {
  // One sign-in for the whole run, reused by every test: a password sign-in
  // per route would also spend the local auth server's sign-in rate limit.
  let signedIn: Awaited<ReturnType<BrowserContext["storageState"]>> | null =
    null;

  test.beforeAll(async ({ browser }) => {
    if (!SIGN_IN) return;
    const context = await browser.newContext({ viewport: WINDOW });
    await signInAsDemoPresident(await context.newPage());
    signedIn = await context.storageState();
    await context.close();
  });

  test.beforeEach(async ({ page, context, baseURL }) => {
    await page.setViewportSize(WINDOW);
    const url = baseURL ?? "http://localhost:3000";
    if (signedIn) {
      await context.addCookies(signedIn.cookies);
      const origins = signedIn.origins;
      await context.addInitScript((saved) => {
        for (const origin of saved) {
          if (origin.origin !== window.location.origin) continue;
          for (const { name, value } of origin.localStorage) {
            window.localStorage.setItem(name, value);
          }
        }
      }, origins);
    }
    await context.addCookies([
      { name: "frapp_chat_open", value: "1", url },
      { name: "frapp_chat_split", value: "0", url },
    ]);
  });

  for (const route of TOOL_ROUTES) {
    test(`${route} does not scroll sideways beside chat`, async ({ page }) => {
      test.fixme(
        SIGN_IN && NOT_YET_CONVERTED.has(route),
        "Settings still follows the window until #3856 lands (#4033)",
      );
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      // The same guard as the viewport suite: a redirect to `/sign-in`
      // would measure a page with no shell.
      const [path = route, query] = route.split("?");
      await expect(page).toHaveURL(
        new RegExp(
          `${escapeRegExp(path)}/?` +
            (query ? `\\?${escapeRegExp(query)}` : "(\\?.*)?") +
            "$",
        ),
      );

      const toolPage = page.locator("[data-tool-page]");
      await expect(toolPage).toBeVisible();
      // Proof the page sits beside chat at its floor rather than alone in
      // the window, where every page fits and this test would prove nothing.
      await expect
        .poll(async () =>
          toolPage.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
        )
        .toBe(FLOOR);

      const measured = await toolPage.evaluate((el) => {
        // A scroll container's `scrollWidth` is its content width, so a table
        // inside its own `overflow-auto` wrapper is not an offender.
        const clipped = (node: Element): boolean => {
          for (let n: Element | null = node.parentElement; n && n !== el; n = n.parentElement) {
            const overflowX = getComputedStyle(n).overflowX;
            if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
              return true;
            }
          }
          return false;
        };
        const right = el.getBoundingClientRect().right;
        const widest = [...el.querySelectorAll("*")]
          .filter((node) => node.getBoundingClientRect().right > right + 0.5 && !clipped(node))
          .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          widest: widest
            ? {
                tag: widest.tagName.toLowerCase(),
                className: widest.getAttribute("class") ?? "",
                overflow: Math.round(widest.getBoundingClientRect().right - right),
              }
            : null,
        };
      });

      expect(
        measured.scrollWidth,
        `${route} scrolls sideways beside chat: ${measured.scrollWidth}px of ` +
          `content in a ${measured.clientWidth}px page.` +
          (measured.widest
            ? ` <${measured.widest.tag} class="${measured.widest.className}"> ` +
              `runs ${measured.widest.overflow}px past the page's edge.`
            : "") +
          " A layout breakpoint on this page probably reads the window " +
          "(`sm:`/`md:`/`lg:`) where it should read the page (`@container` " +
          "with `@xl:`/`@2xl:`/`@3xl:`; spec/ui/web-dashboard/README.md " +
          "§ Responsive contract).",
      ).toBeLessThanOrEqual(measured.clientWidth);
      expect(
        measured.documentWidth,
        `${route}: the document is wider than the window beside chat`,
      ).toBeLessThanOrEqual(WINDOW.width);
    });
  }
});
