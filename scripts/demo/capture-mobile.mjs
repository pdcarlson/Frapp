#!/usr/bin/env node
/**
 * Capture mobile (Signet) imagery for marketing / showcase use.
 *
 * Two sources, kept in separate folders because they are not the same kind of
 * evidence:
 *
 *   mobile-app/        real screens off the running Expo app (react-native-web)
 *   mobile-reference/  artboards from the committed design reference board
 *
 * The signed-in screens come from the running app. That needs the app to hold a
 * session on web, which `expo-secure-store` cannot do — its web entry point is
 * `export default {}` — so `lib/secure-store.web.ts` swaps in a localStorage
 * adapter when `EXPO_PUBLIC_WEB_SECURE_STORE=1`. Start Expo with that set or
 * every route below redirects to `/sign-in`; the landed-route assertion turns
 * that into a loud failure rather than a folder of identical sign-in screens.
 *
 *   scripts/demo/setup-demo.sh                        # seed the demo chapter
 *   npx expo start --web --port 3002                  # from apps/mobile
 *   node scripts/demo/capture-mobile.mjs
 *
 * Env: MOBILE_URL (default http://localhost:3002), OUT_ROOT, CHROMIUM_PATH,
 *      DEMO_EMAIL, DEMO_PASSWORD, EVENT_ID, SKIP_REFERENCE=1
 */
import { chromium } from "playwright";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MOBILE_URL = process.env.MOBILE_URL ?? "http://localhost:3002";
const OUT_ROOT = process.env.OUT_ROOT ?? "screenshots";
const APP_DIR = path.join(OUT_ROOT, "mobile-app");
const REF_DIR = path.join(OUT_ROOT, "mobile-reference");

const EMAIL = process.env.DEMO_EMAIL ?? "marcus.ellison@westfield.edu";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoShowcase!2026";

/** The zoned Chapter Meeting the demo seed marks up for check-in. */
const EVENT_ID = process.env.EVENT_ID ?? "c0ffee00-0000-4000-8000-3000000000e1";

const BOARD = "spec/ui/design-system/reference/canvas-screens.dc.html";
const FONT = "packages/theme/fonts/FigtreeVF.woff2";

/** iPhone 16 Pro logical size — the `hint-size` the board's artboards declare. */
const PHONE = { width: 402, height: 874 };
const SCALE = 3;

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
`;

/**
 * Metro's dev-only error toast, hidden for the shot.
 *
 * `expo-camera`'s web build fetches a wasm barcode decoder that the sandbox has
 * no network for, and the rejection lands in the LogBox toast as a red
 * "Aborted(...)" pill across the tab bar. It is a dev-server artifact of the
 * web target — the native build neither loads that wasm nor renders a toast —
 * so it is chrome to suppress, not a defect the screenshot should record.
 */
const HIDE_DEV_OVERLAY_CSS = `
  #metro-error-overlay,
  [data-testid="logbox-toast"],
  div[role="alert"]:has(> div > div > span) { display: none !important; }
`;

function slugify(text) {
  return (
    text
      // Drop non-ASCII before NFKD, not after: normalizing first decomposes the
      // mojibake "â" into "a" + a combining mark, and the bare "a" survives into
      // the filename (s04-chat-a-channels-landing).
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/[^\w\s-]/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 48)
  );
}

/**
 * Repair double-encoded UTF-8 in the board's text.
 *
 * `canvas-screens.dc.html` was committed with its non-ASCII characters encoded
 * twice — "✦" (e2 9c a6) reads as "âœ¦" (c3a2 c593 c2a6), and the same for every
 * "·" and em dash. Verified against the raw bytes, not inferred from the render.
 * Left alone it lands in the marketing images as literal "âœ¦ Ask".
 *
 * This repairs the DOM at capture time only; the file on disk is still corrupt
 * and wants its own fix.
 */
const REPAIR_MOJIBAKE = () => {
  // The bad decode was cp1252, not Latin-1, so the corrupted text contains
  // characters *above* U+00FF ("€" for byte 0x80, "œ" for 0x9C). Mapping only
  // charCodeAt <= 0xFF silently skips exactly the strings that need repair.
  const CP1252_HIGH = new Map(
    Object.entries({
      0x20ac: 0x80,
      0x201a: 0x82,
      0x0192: 0x83,
      0x201e: 0x84,
      0x2026: 0x85,
      0x2020: 0x86,
      0x2021: 0x87,
      0x02c6: 0x88,
      0x2030: 0x89,
      0x0160: 0x8a,
      0x2039: 0x8b,
      0x0152: 0x8c,
      0x017d: 0x8e,
      0x2018: 0x91,
      0x2019: 0x92,
      0x201c: 0x93,
      0x201d: 0x94,
      0x2022: 0x95,
      0x2013: 0x96,
      0x2014: 0x97,
      0x02dc: 0x98,
      0x2122: 0x99,
      0x0161: 0x9a,
      0x203a: 0x9b,
      0x0153: 0x9c,
      0x017e: 0x9e,
      0x0178: 0x9f,
    }).map(([k, v]) => [Number(k), v]),
  );

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const nonAscii = (s) => [...s].filter((c) => c.charCodeAt(0) > 0x7f).length;

  function repair(text) {
    if (nonAscii(text) === 0) return text;
    const bytes = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const byte = cp <= 0xff ? cp : CP1252_HIGH.get(cp);
      if (byte === undefined) return text; // not a cp1252 round-trip
      bytes.push(byte);
    }
    let decoded;
    try {
      decoded = decoder.decode(Uint8Array.from(bytes));
    } catch {
      return text; // not double-encoded after all
    }
    // A real repair collapses mojibake runs into single characters. If it did
    // not reduce the non-ASCII count, treat the text as legitimately accented
    // and leave it exactly as authored.
    return nonAscii(decoded) < nonAscii(text) ? decoded : text;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) node.nodeValue = repair(node.nodeValue);
};

const failures = [];

/** Poll `read()` until it returns truthy, or throw with `label` on timeout. */
async function waitFor(page, label, read, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(read).catch(() => false)) return;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(400);
  }
}

const bodyText = () => document.body.innerText;

/**
 * The signed-in screens, in capture order.
 *
 * `ready` runs in the page and gates the shot on content the screen only shows
 * once its queries have landed — a fixed sleep photographs skeletons on a slow
 * bundle and wastes seconds on a fast one. `act` runs before it, for screens
 * that need a tap to reach the state worth showing.
 */
const APP_SCREENS = [
  {
    slug: "01-home-chat",
    route: "/",
    label: "s04 — Chat home (chapter channels, UP NEXT, ✦ Ask pill)",
    ready: () => document.body.innerText.includes("CHANNELS"),
  },
  {
    slug: "02-ask-answer",
    // Deliberately not the `/ask` route. Ask is a sheet hosted by Chat home and
    // Events behind the ✦ pill, never a screen of its own
    // (`spec/ui/mobile/navigation.md:60`); `app/(tabs)/ask.tsx` exists only to
    // back a frozen `Tabs.Screen` registration and says so in its own header
    // comment. Shooting the route photographs a deliberately bare shell with
    // the tab navigator's "Ask" title stacked above the shell's own — the pill
    // on s04 is where a member actually opens this.
    route: "/",
    label: "s17 — Ask sheet over Chat home, answered with citations",
    async act(page) {
      await page.getByLabel("Ask", { exact: true }).first().click();
      await page.waitForTimeout(1200);
      await page.getByText("When's the next mandatory event?").first().click();
    },
    // The citation chip only exists on an `answered` result, so this waits out
    // the sheet's deliberate in-flight state rather than racing it.
    ready: () => document.body.innerText.includes("Bylaws"),
  },
  {
    slug: "03-chat-thread",
    route: "/",
    label: "s05 — Chat thread, #general",
    async act(page) {
      await page.getByText("general", { exact: true }).first().click();
      await page.waitForTimeout(2000);
    },
    // Two things this predicate must not be phrased as. Not "CHANNELS has
    // gone": React Navigation keeps the tab's index screen mounted under the
    // pushed thread, so the channel list stays in `innerText` throughout. And
    // not `innerText.includes("Message")` for the composer: a placeholder is an
    // attribute, so it never appears in `innerText` at all and the wait can
    // only ever time out. "Thread" is text, and only this route renders it.
    ready: () =>
      document.body.innerText.includes("Thread") &&
      Boolean(document.querySelector('[placeholder="Message"]')),
    expectRoute: "/chat-thread",
  },
  {
    slug: "04-host-check-in",
    route: `/host-check-in?eventId=${EVENT_ID}`,
    label: "s22 — Host check-in, rotating QR + manual override",
    // "Rotates in 0:00" is the clamped floor of an expiring window, not a
    // stopped clock: the token query polls every 10s and `formatCountdown`
    // floors at zero in between. Hold out for ten seconds or more left on the
    // clock — merely non-zero lands "0:02" about as often as not, which reads
    // as a code caught mid-expiry rather than one an officer is projecting.
    ready: () => /Rotates in 0:[12]\d/.test(document.body.innerText),
  },
];

async function signIn(page) {
  await page.goto(`${MOBILE_URL}/sign-in`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await waitFor(page, "sign-in form", () =>
    document.body.innerText.includes("Sign in to your chapter"),
  );

  await page
    .locator('input[type="email"], input[inputmode="email"]')
    .first()
    .fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();

  // The chapter name in the header is the first thing that proves the whole
  // chain worked: session persisted, token mirrored, API accepted the Bearer.
  await waitFor(
    page,
    "signed-in home (is EXPO_PUBLIC_WEB_SECURE_STORE=1 set?)",
    () => document.body.innerText.includes("CHANNELS"),
    60_000,
  );
}

async function captureRunningApp(browser) {
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const done = [];

  process.stdout.write(`  signing in as ${EMAIL} ... `);
  await signIn(page);
  console.log("ok");

  for (const screen of APP_SCREENS) {
    const { slug, route, label } = screen;
    process.stdout.write(`  app ${slug} ... `);
    try {
      await page.goto(`${MOBILE_URL}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      // Let the router settle on the requested route before acting on it.
      await waitFor(page, `${slug} first paint`, bodyText);
      await page.waitForTimeout(2500);

      if (screen.act) await screen.act(page);
      if (screen.ready) await waitFor(page, slug, screen.ready);

      // Never save a screenshot under a name the app did not actually render.
      const landed = new URL(page.url()).pathname;
      const expected =
        screen.expectRoute ?? new URL(route, MOBILE_URL).pathname;
      if (landed !== expected) {
        throw new Error(`landed on ${landed}, expected ${expected}`);
      }

      await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
      await page.addStyleTag({ content: HIDE_DEV_OVERLAY_CSS }).catch(() => {});
      await page.waitForTimeout(300);

      const file = path.join(APP_DIR, `${slug}.png`);
      await page.screenshot({ path: file });
      done.push({ slug, label, file });
      console.log("ok");
    } catch (error) {
      failures.push(`${slug}: ${error.message.split("\n")[0]}`);
      console.log(`FAILED: ${error.message.split("\n")[0]}`);
    }
  }

  await context.close();
  return done;
}

async function captureReferenceBoard(browser) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  const fontData = await readFile(FONT);
  const fontUri = `data:font/woff2;base64,${fontData.toString("base64")}`;

  await page.goto(pathToFileURL(path.resolve(BOARD)).href, {
    waitUntil: "domcontentloaded",
  });

  // The board declares Figtree from Google Fonts and draws each screen inside
  // an `<x-import>` iOS device frame from `./ios-frame.jsx` — neither of which
  // is committed next to it. Supply both: the vendored variable font, and a
  // fixed-size frame so `height:100%` on each screen root resolves.
  await page.addStyleTag({
    content: `
      @font-face {
        font-family: 'Figtree';
        src: url('${fontUri}') format('woff2');
        font-weight: 400 700;
        font-display: block;
      }
      ${FREEZE_CSS}
      x-import {
        display: block !important;
        width: ${PHONE.width}px;
        height: ${PHONE.height}px;
        overflow: hidden;
        background: #0E0D0B;
        border-radius: 44px;
      }
    `,
  });
  await page.evaluate(REPAIR_MOJIBAKE);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const boards = await page.evaluate(() =>
    [...document.querySelectorAll(".fopt")].map((el) => ({
      id: el.id,
      label:
        el
          .querySelector(".folabel")
          ?.textContent?.replace(/^s\d+/, "")
          .trim() ??
        el.getAttribute("data-screen-label") ??
        el.id,
      hasFrame: Boolean(el.querySelector("x-import")),
    })),
  );

  const done = [];
  for (const board of boards) {
    if (!board.hasFrame) {
      console.log(`  ref ${board.id} ... skipped (no artboard)`);
      continue;
    }
    const file = path.join(REF_DIR, `${board.id}-${slugify(board.label)}.png`);
    const frame = page.locator(`#${board.id} x-import`).first();
    await frame.scrollIntoViewIfNeeded();
    await frame.screenshot({ path: file });
    done.push({ id: board.id, label: board.label, file });
    console.log(`  ref ${board.id} ... ok  ${board.label.slice(0, 46)}`);
  }

  await context.close();
  return done;
}

async function main() {
  await rm(APP_DIR, { recursive: true, force: true });
  await mkdir(APP_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });

  console.log("Running app (signed in against the seeded demo chapter):");
  const app = await captureRunningApp(browser);

  let ref = [];
  if (process.env.SKIP_REFERENCE !== "1") {
    await rm(REF_DIR, { recursive: true, force: true });
    await mkdir(REF_DIR, { recursive: true });
    console.log("\nDesign reference board:");
    ref = await captureReferenceBoard(browser);
  }

  await browser.close();
  console.log(`\n${app.length} app screens -> ${APP_DIR}`);
  for (const { slug, label } of app) console.log(`  ${slug}.png  ${label}`);
  if (ref.length)
    console.log(`${ref.length} reference artboards -> ${REF_DIR}`);

  if (failures.length) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
