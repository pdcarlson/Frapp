#!/usr/bin/env node
/**
 * Time the web dashboard's main screens on a throttled connection, on the
 * local stack (#3716).
 *
 * `measure-cold-open.mjs` counts what one open asks the API for, on an
 * unthrottled loopback, where every byte is free. This one puts Chrome's own
 * network throttling in front of the same production build, so the bytes and
 * the round trips cost what they cost a member on a slow connection, and times
 * when each screen becomes usable:
 *
 *   scripts/demo/setup-demo.sh                              # seed the demo chapter
 *   node apps/api/dist/main                                 # API on :3001
 *   npm run build -w apps/web && npm run start -w apps/web  # web on :3000
 *   node scripts/demo/measure-slow-network.mjs
 *
 * Each screen opens twice in one browser context:
 *   - cold: a fresh context, so nothing is in the HTTP cache or IndexedDB yet
 *     (a member's first visit, or the first after the cache was cleared);
 *   - warm: the same URL again straight after, with the cache the cold open
 *     filled (a member coming back).
 *
 * What it reports per open, in ms from navigation:
 *   - `fcp`: first contentful paint (the server-rendered shell);
 *   - `ready`: the screen's own content is on it (a message in the open
 *     channel, Activity's week card, the Calendar's day list);
 *   - `composer`: the message box can take typing (the editor has mounted);
 *   - `js`: compressed JavaScript fetched, in KB; `api`: API requests made.
 * `TRACE=1` also prints each open's API requests with their start and end.
 *
 * Caveats the numbers carry:
 *   - The local API speaks HTTP/1.1, so Chrome queues a burst of more than six
 *     requests to it behind each other. Staging and production speak HTTP/2,
 *     which does not, so the warm API waits here run long.
 *   - Throttling is Chrome's per-request model (DevTools' presets): it adds the
 *     latency to every request and caps throughput, but models no TCP or TLS
 *     handshake.
 *   - No `NEXT_PUBLIC_POSTHOG_KEY` locally, so the analytics SDK never loads.
 *
 * Env: WEB_URL (default http://localhost:3000), PROFILES (default
 *      "slow4g,slow3g"), SCREENS (default all: chat,channel,activity,calendar),
 *      CHROMIUM_PATH, DEMO_EMAIL, DEMO_PASSWORD, JSON=1, TRACE=1.
 */
import { chromium } from "playwright";

import { LOCAL_DEMO_EMAIL, LOCAL_DEMO_PASSWORD, TEMPLATE_NAMESPACE, demoIds } from "./seed-demo.mjs";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const EMAIL = process.env.DEMO_EMAIL ?? LOCAL_DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD ?? LOCAL_DEMO_PASSWORD;
const { prefix } = demoIds(TEMPLATE_NAMESPACE);
/** #intramurals, a channel other than the one chat home opens on. */
const OTHER_CHANNEL_ID = `${prefix}4000000000b4`;

/**
 * Chrome DevTools' presets. "Slow 4G" is the preset DevTools called "Fast 3G"
 * until Chrome 128; "Slow 3G" kept its name.
 */
const PROFILES = {
  slow4g: { latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8, uploadThroughput: (750 * 1024 * 0.9) / 8 },
  slow3g: { latency: 2000, downloadThroughput: (500 * 1024 * 0.8) / 8, uploadThroughput: (500 * 1024 * 0.8) / 8 },
};

const SCREENS = {
  chat: {
    route: "/chat",
    ready: () => Boolean(document.querySelector('[role="list"] [role="listitem"]')),
  },
  channel: {
    route: `/chat?channel=${OTHER_CHANNEL_ID}`,
    ready: () => document.body.innerText.includes("Undefeated season"),
  },
  activity: {
    route: "/activity",
    ready: () => /left this week/i.test(document.body.innerText),
  },
  // Events in its Calendar view: sign-in stores that choice for the member.
  calendar: {
    route: "/events",
    ready: () => /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d+/.test(document.body.innerText),
  },
};

const profiles = (process.env.PROFILES ?? "slow4g,slow3g").split(",");
for (const name of profiles) {
  if (!PROFILES[name]) {
    console.error(`PROFILES: unknown profile "${name}" (known: ${Object.keys(PROFILES).join(", ")})`);
    process.exit(2);
  }
}
const screens = (process.env.SCREENS ?? Object.keys(SCREENS).join(",")).split(",");
for (const name of screens) {
  if (!SCREENS[name]) {
    console.error(`SCREENS: unknown screen "${name}" (known: ${Object.keys(SCREENS).join(", ")})`);
    process.exit(2);
  }
}

async function signIn(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${WEB_URL}/sign-in`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle");
  const asked = await page
    .getByText("Agree to the Terms to continue")
    .waitFor({ timeout: 8000 })
    .then(() => true, () => false);
  if (asked) {
    await page.getByRole("checkbox").first().click();
    await page.getByText("Agree and continue", { exact: true }).click();
    await page.waitForTimeout(2000);
  }
  // The Calendar screen is Events with its Calendar view picked.
  await page.goto(`${WEB_URL}/events`, { waitUntil: "networkidle" });
  await page.getByText("Calendar", { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const state = await context.storageState();
  await context.close();
  return state;
}

async function openOnce(page, cdp, screen) {
  const byId = new Map();
  const finished = [];
  const onRequest = (e) => byId.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp });
  const onResponse = (e) => {
    const r = byId.get(e.requestId);
    if (r) r.type = e.type;
  };
  const onFinished = (e) => {
    const r = byId.get(e.requestId);
    if (!r) return;
    r.end = e.timestamp;
    r.bytes = e.encodedDataLength;
    finished.push(r);
  };
  cdp.on("Network.requestWillBeSent", onRequest);
  cdp.on("Network.responseReceived", onResponse);
  cdp.on("Network.loadingFinished", onFinished);

  const t0 = Date.now();
  await page.goto(`${WEB_URL}${screen.route}`, { waitUntil: "commit", timeout: 180_000 });
  const marks = {};
  const mark = async (name, fn) => {
    await page.waitForFunction(fn, null, { timeout: 180_000, polling: 50 });
    marks[name] = Date.now() - t0;
  };
  await Promise.all([
    mark("ready", screen.ready),
    mark("composer", () => Boolean(document.querySelector('[contenteditable="true"]'))),
  ]);
  // Let the open's trailing requests land before the next one starts.
  await page.waitForTimeout(1500);
  const fcp = await page.evaluate(() => {
    const entry = performance.getEntriesByName("first-contentful-paint")[0];
    return entry ? Math.round(entry.startTime) : null;
  });
  cdp.off("Network.requestWillBeSent", onRequest);
  cdp.off("Network.responseReceived", onResponse);
  cdp.off("Network.loadingFinished", onFinished);

  const first = Math.min(...finished.map((r) => r.start));
  const api = finished
    .filter((r) => r.type === "Fetch" || r.type === "XHR")
    .filter((r) => new URL(r.url).origin !== new URL(WEB_URL).origin)
    .map((r) => ({
      path: new URL(r.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id"),
      start: Math.round((r.start - first) * 1000),
      end: Math.round((r.end - first) * 1000),
    }))
    .sort((a, b) => a.start - b.start);
  const js = finished.filter((r) => r.type === "Script").reduce((sum, r) => sum + r.bytes, 0);
  return { fcp, ...marks, jsKb: Math.round(js / 1024), api };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const storageState = await signIn(browser);
  // One unthrottled pass warms the server (route compilation, JIT, pools).
  {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    for (const name of screens) await page.goto(`${WEB_URL}${SCREENS[name].route}`, { waitUntil: "networkidle" });
    await context.close();
  }
  const results = [];
  for (const profile of profiles) {
    for (const name of screens) {
      const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...PROFILES[profile] });
      const cold = await openOnce(page, cdp, SCREENS[name]);
      const warm = await openOnce(page, cdp, SCREENS[name]);
      await context.close();
      results.push({ profile, screen: name, cold, warm });
    }
  }
  if (process.env.JSON === "1") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("profile  screen    open   fcp     ready   composer  js KB  api");
    for (const r of results) {
      for (const open of ["cold", "warm"]) {
        const o = r[open];
        console.log(
          `${r.profile.padEnd(8)} ${r.screen.padEnd(9)} ${open.padEnd(5)} ${String(o.fcp).padStart(6)} ${String(o.ready).padStart(7)} ${String(o.composer).padStart(9)} ${String(o.jsKb).padStart(6)} ${String(o.api.length).padStart(4)}`,
        );
        if (process.env.TRACE === "1") {
          for (const a of o.api) console.log(`    ${String(a.start).padStart(6)} ${String(a.end).padStart(6)}  ${a.path}`);
        }
      }
    }
  }
} finally {
  await browser.close();
}
