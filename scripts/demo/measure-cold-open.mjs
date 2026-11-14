#!/usr/bin/env node
/**
 * Count the API requests one cold open of the app makes, and time its first
 * screen, on the local stack (#4709, #3728).
 *
 * A "cold open" here is a fresh page load with a signed-in session already
 * stored and an empty in-memory query cache: what a member gets opening the
 * web dashboard in a new tab, or launching the phone app (run as
 * react-native-web, the only form a headless sandbox can drive). Each run
 * signs in once, saves the session, then opens the app `RUNS` times in fresh
 * browser contexts seeded with that session, and reports the median.
 *
 *   scripts/demo/setup-demo.sh                              # seed the demo chapter
 *   node apps/api/dist/main                                 # API on :3001
 *   npm run build -w apps/web && npm run start -w apps/web  # web on :3000
 *   EXPO_PUBLIC_WEB_SECURE_STORE=1 npx expo start --web --port 3002   # from apps/mobile
 *   node scripts/demo/measure-cold-open.mjs web
 *   node scripts/demo/measure-cold-open.mjs mobile
 *
 * What it reports, per surface:
 *   - `beforeFirstScreen`: requests to the API that STARTED before the first
 *     screen drew (web: a message in the open channel; mobile: a channel row
 *     or the open thread's composer). This is the number #4709's acceptance
 *     bounds (at most 10).
 *   - `inWindow`: every API request in the `WINDOW_MS` after navigation, the
 *     whole burst the open causes, including what loads after first paint.
 *   - `firstScreenMs`: navigation start to the first screen.
 *   - `p95Ms` / `maxMs`: API response times inside the window. The local
 *     stack has no network latency, so these show queueing, not prod numbers.
 *   - the per-path breakdown of the window, so a regression names its source.
 *
 * Env: WEB_URL (default http://localhost:3000), MOBILE_URL (default
 *      http://localhost:3002), API_URL (default http://localhost:3001),
 *      RUNS (default 3), WINDOW_MS (default 8000), CHROMIUM_PATH,
 *      DEMO_EMAIL, DEMO_PASSWORD, JSON=1 (machine-readable output),
 *      RESUME_AFTER_MS (measure a return to the app that long after the
 *      open instead of the open itself; 65000 is past both clients' stale
 *      times),
 *      TRACE=1 (each run's requests in order, with their `include` and
 *      whether they started before the first screen).
 */
import { chromium } from "playwright";

import { LOCAL_DEMO_EMAIL, LOCAL_DEMO_PASSWORD, TEMPLATE_NAMESPACE, demoIds } from "./seed-demo.mjs";

const SURFACE = process.argv[2];
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const MOBILE_URL = process.env.MOBILE_URL ?? "http://localhost:3002";
const API_URL = process.env.API_URL ?? "http://localhost:3001";
const RUNS = Number(process.env.RUNS ?? 3);
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error(`RUNS must be a whole number of at least 1, not "${process.env.RUNS}"`);
  process.exit(2);
}
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 8000);
/**
 * Measure a return to the app instead of the open (#3728): after the open,
 * wait this long (past the clients' stale times), hide the page, show it
 * again, and count what the return fires in `WINDOW_MS`.
 */
const RESUME_AFTER_MS = process.env.RESUME_AFTER_MS ? Number(process.env.RESUME_AFTER_MS) : null;
const EMAIL = process.env.DEMO_EMAIL ?? LOCAL_DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD ?? LOCAL_DEMO_PASSWORD;
const CHAPTER_ID = demoIds(TEMPLATE_NAMESPACE).chapterId;

/** The API's origin under both loopback spellings: web's env says 127.0.0.1, mobile's localhost. */
const API_ORIGINS = (() => {
  const api = new URL(API_URL);
  const swap = api.hostname === "localhost" ? "127.0.0.1" : api.hostname === "127.0.0.1" ? "localhost" : api.hostname;
  return new Set([api.origin, `${api.protocol}//${swap}${api.port ? `:${api.port}` : ""}`]);
})();

/** Terms copy, as in capture-mobile.mjs / capture-screenshots.mjs. */
const TERMS_PROMPT_TITLE = "Agree to the Terms to continue";
const TERMS_PROMPT_CTA = "Agree and continue";

const SURFACES = {
  web: {
    url: WEB_URL,
    route: "/chat",
    // A message row in the open channel's timeline.
    firstScreen: () => Boolean(document.querySelector('[role="list"] [role="listitem"]')),
    signIn: signInWeb,
  },
  mobile: {
    url: MOBILE_URL,
    route: "/",
    // A channel row on chat home, or the composer of the thread a returning
    // member lands on.
    firstScreen: () =>
      Boolean(document.querySelector('[aria-label^="#"]')) ||
      Boolean(document.querySelector('[placeholder^="Message"]')),
    signIn: signInMobile,
  },
};

async function waitForText(page, text, timeout = 60_000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });
}

async function agreeToTermsIfAsked(page) {
  const asked = await page.evaluate((t) => document.body.innerText.includes(t), TERMS_PROMPT_TITLE);
  if (!asked) return;
  // `click`, not `check`: react-native-web's checkbox is not a native input.
  await page.getByRole("checkbox").first().click();
  await page.getByText(TERMS_PROMPT_CTA, { exact: true }).last().click();
}

async function signInWeb(page) {
  await page.goto(`${WEB_URL}/sign-in`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle");
  await agreeToTermsIfAsked(page);
  // The active chapter lives in a persisted store only `useSelectChapter`
  // writes (see capture-screenshots.mjs), so seed it like a returning member.
  await page.evaluate((chapterId) => {
    localStorage.setItem(
      "frapp-active-chapter",
      JSON.stringify({ state: { activeChapterId: chapterId, hasHydrated: true }, version: 0 }),
    );
  }, CHAPTER_ID);
}

async function signInMobile(page) {
  await page.goto(`${MOBILE_URL}/sign-in`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForText(page, "Continue with email", 120_000);
  await page.getByText("Continue with email", { exact: true }).click();
  await waitForText(page, "Sign in with email");
  await page.locator('input[type="email"], input[inputmode="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForFunction(
    (prompt) =>
      Boolean(document.querySelector('[aria-label^="#"]')) || document.body.innerText.includes(prompt),
    TERMS_PROMPT_TITLE,
    { timeout: 120_000 },
  );
  await agreeToTermsIfAsked(page);
  await page.waitForFunction(() => Boolean(document.querySelector('[aria-label^="#"]')), null, {
    timeout: 60_000,
  });
  // Let the landing settle so the saved state includes the last-channel memo.
  await page.waitForTimeout(3000);
}

/** Collapse ids out of a path so the breakdown groups like routes. */
function routeOf(url) {
  const { pathname } = new URL(url);
  return pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
}

/**
 * Hide or show the page the way a backgrounded tab or app does: both clients
 * (TanStack's focus manager, mobile's AppState on react-native-web, web's
 * realtime resume) listen for `visibilitychange`.
 */
async function setVisibility(page, state) {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => next === "hidden" });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    if (next === "visible") window.dispatchEvent(new Event("focus"));
  }, state);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function measureOnce(browser, surface, storageState) {
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  const started = new Map();
  let t0 = 0;
  page.on("request", (request) => {
    if (!API_ORIGINS.has(new URL(request.url()).origin)) return;
    if (request.method() === "OPTIONS") return;
    const entry = {
      method: request.method(),
      route: routeOf(request.url()),
      include: new URL(request.url()).searchParams.get("include"),
      at: Date.now() - t0,
    };
    started.set(request, entry);
    requests.push(entry);
  });
  const finish = (request) => {
    const entry = started.get(request);
    if (entry) entry.ms = Date.now() - t0 - entry.at;
  };
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);

  t0 = Date.now();
  await page.goto(`${surface.url}${surface.route}`, { waitUntil: "commit", timeout: 120_000 });
  await page.waitForFunction(surface.firstScreen, null, { timeout: 60_000, polling: 50 });
  let firstScreenMs = Date.now() - t0;
  if (RESUME_AFTER_MS !== null) {
    await page.waitForTimeout(Math.max(0, RESUME_AFTER_MS - firstScreenMs));
    await setVisibility(page, "hidden");
    await page.waitForTimeout(2000);
    requests.length = 0;
    t0 = Date.now();
    await setVisibility(page, "visible");
    // Everything a return fires counts; there is no first screen to wait for.
    firstScreenMs = WINDOW_MS;
  }
  const remaining = WINDOW_MS - (Date.now() - t0);
  if (remaining > 0) await page.waitForTimeout(remaining);
  await context.close();

  const inWindow = requests.filter((r) => r.at <= WINDOW_MS);
  const durations = inWindow.map((r) => r.ms).filter((ms) => typeof ms === "number");
  const byRoute = {};
  for (const r of inWindow) {
    const key = `${r.method} ${r.route}`;
    byRoute[key] = (byRoute[key] ?? 0) + 1;
  }
  if (process.env.TRACE === "1") {
    for (const r of requests) {
      console.log(`    ${String(r.at).padStart(5)}ms ${r.method} ${r.route}${r.include ? ` [${r.include}]` : ""}${r.at < firstScreenMs ? "" : "  (after first screen)"}`);
    }
  }
  return {
    beforeFirstScreen: requests.filter((r) => r.at < firstScreenMs).length,
    inWindow: inWindow.length,
    firstScreenMs,
    p95Ms: percentile(durations, 95),
    maxMs: durations.length ? Math.max(...durations) : 0,
    byRoute,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const surface = SURFACES[SURFACE];
  if (!surface) {
    console.error("usage: measure-cold-open.mjs <web|mobile>");
    process.exit(2);
  }
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  try {
    const signInContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const signInPage = await signInContext.newPage();
    await surface.signIn(signInPage);
    const storageState = await signInContext.storageState();
    await signInContext.close();

    // One unmeasured open warms the servers (bundles, JIT, connection pools).
    await measureOnce(browser, surface, storageState);
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) runs.push(await measureOnce(browser, surface, storageState));

    const summary = {
      surface: SURFACE,
      runs: runs.length,
      beforeFirstScreen: median(runs.map((r) => r.beforeFirstScreen)),
      inWindow: median(runs.map((r) => r.inWindow)),
      firstScreenMs: median(runs.map((r) => r.firstScreenMs)),
      p95Ms: median(runs.map((r) => r.p95Ms)),
      maxMs: median(runs.map((r) => r.maxMs)),
      byRoute: runs[runs.length - 1].byRoute,
    };
    if (process.env.JSON === "1") {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    const what = RESUME_AFTER_MS === null ? "cold opens" : `returns to the app after ${RESUME_AFTER_MS} ms`;
    console.log(`${SURFACE}: median of ${runs.length} ${what} (window ${WINDOW_MS} ms)`);
    console.log(`  requests before first screen: ${summary.beforeFirstScreen}`);
    console.log(`  requests in window:           ${summary.inWindow}`);
    console.log(`  first screen:                 ${summary.firstScreenMs} ms`);
    console.log(`  API p95 / max in window:      ${summary.p95Ms} / ${summary.maxMs} ms`);
    console.log("  by route (last run):");
    for (const [route, count] of Object.entries(summary.byRoute).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(3)}  ${route}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
