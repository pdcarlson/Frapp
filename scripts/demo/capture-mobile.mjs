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
 * ## App Store preset (`--app-store`, or `APP_STORE=1`)
 *
 * The owner approved these renders as the App Store screenshots (#2454), and
 * the store binary has no Ask (#2259), so the store set is a different list
 * from the marketing one above, not a subset of its output:
 *
 *   app-store/         1320x2868 PNGs (440x956 at 3x, the 6.9" iPhone size)
 *
 * No Ask shot, no reference board, and a hard stop: if any ✦ Ask surface is on
 * screen — which is what an Expo server started with `EXPO_PUBLIC_ASK_ENABLED`
 * set looks like — the run deletes the folder and exits non-zero, so a
 * flag-on dev server can never produce a store set. Run it with the flag
 * unset. Procedure and the size's provenance:
 * `docs/internal/ops/deployment/mobile.md` § 6.4.
 *
 * Env: MOBILE_URL (default http://localhost:3002), OUT_ROOT, CHROMIUM_PATH,
 *      DEMO_EMAIL, DEMO_PASSWORD, EVENT_ID, SKIP_REFERENCE=1, APP_STORE=1
 */
import { chromium } from "playwright";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MOBILE_URL = process.env.MOBILE_URL ?? "http://localhost:3002";
const OUT_ROOT = process.env.OUT_ROOT ?? "screenshots";
const APP_DIR = path.join(OUT_ROOT, "mobile-app");
const REF_DIR = path.join(OUT_ROOT, "mobile-reference");
const STORE_DIR = path.join(OUT_ROOT, "app-store");

const APP_STORE =
  process.argv.includes("--app-store") || process.env.APP_STORE === "1";

const EMAIL = process.env.DEMO_EMAIL ?? "marcus.ellison@westfield.edu";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoShowcase!2026";

/** The zoned Chapter Meeting the demo seed marks up for check-in. */
const EVENT_ID = process.env.EVENT_ID ?? "c0ffee00-0000-4000-8000-3000000000e1";

const BOARD = "spec/ui/design-system/reference/canvas-screens.dc.html";
const FONT = "packages/theme/fonts/FigtreeVF.woff2";

/** iPhone 16 Pro logical size — the `hint-size` the board's artboards declare. */
const PHONE = { width: 402, height: 874 };
const SCALE = 3;

/**
 * The App Store's 6.9" iPhone size: 440x956 points at 3x is 1320x2868 pixels.
 * Apple's screenshot specifications (developer.apple.com → App Store Connect
 * help → Reference → Screenshot specifications, read 2026-09-22) list 1320x2868
 * portrait among the 6.9" sizes, ask for a 6.5" set only when no 6.9" set is
 * provided, and scale the smaller iPhone sizes from the set above them. That
 * is the published page, not the console: #2454 asks for the size App Store
 * Connect states at upload to be confirmed and recorded.
 */
const STORE_PHONE = { width: 440, height: 956 };
const STORE_PIXELS = { width: 1320, height: 2868 };

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
 *
 * `#error-toast` is the same toast in the current Expo web runtime: a direct
 * child of `<body>` that draws inside its own shadow root, which no selector
 * here can reach, so the host itself is what gets hidden. Seen 2026-09-22 over
 * the chat thread's tab bar, reporting a dev-only React DOM warning ("Received
 * `false` for a non-boolean attribute `accessible`") that the native build
 * never raises.
 */
const HIDE_DEV_OVERLAY_CSS = `
  #metro-error-overlay,
  #error-toast,
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
    // The check asks for twelve: the shot is taken a second or so after it
    // passes, and a check at "0:10" was saved as "0:09" (2026-09-22).
    ready: () => /Rotates in 0:(1[2-9]|2\d)/.test(document.body.innerText),
  },
];

/**
 * The App Store set: what the listing sells (`apps/mobile/store/README.md`
 * § Description), in the order a browser of the listing should meet it —
 * chat first, because that is the product's centre, then the officer's QR,
 * then the member's week. Every screen here ships in the store binary; there
 * is deliberately no Ask shot, because that binary has no Ask (#2259).
 *
 * No Dues shot either: a populated ledger footers "Payments run through your
 * chapter's Stripe account.", and the listing is built so App Review never
 * sees payment copy (store README § Seed the reviewer's chapter).
 *
 * Same shape as `APP_SCREENS`. `ready` gates on content that only arrives
 * once the screen's queries have landed, so no shot is of a skeleton or an
 * empty state.
 */
const STORE_SCREENS = [
  {
    slug: "01-chat-home",
    route: "/",
    label: "Chat home — chapter channels, unread counts, UP NEXT",
    ready: () => document.body.innerText.includes("CHANNELS"),
  },
  {
    slug: "02-chat-thread",
    route: "/",
    label: "Chat thread — #general",
    async act(page) {
      await page.getByText("general", { exact: true }).first().click();
      await page.waitForTimeout(2000);
    },
    // Why these two and not something simpler: see `03-chat-thread` above.
    ready: () =>
      document.body.innerText.includes("Thread") &&
      Boolean(document.querySelector('[placeholder="Message"]')),
    expectRoute: "/chat-thread",
  },
  {
    slug: "03-events",
    route: "/events",
    label: "Events — upcoming, with points and the mandatory meeting",
    ready: () =>
      document.body.innerText.includes("Chapter Meeting") &&
      document.body.innerText.includes("pts"),
  },
  {
    slug: "04-host-check-in",
    route: `/host-check-in?eventId=${EVENT_ID}`,
    label: "Host check-in — rotating QR at the door (officer)",
    // Same clock rule as the marketing shot: ten seconds or more left.
    ready: () => /Rotates in 0:(1[2-9]|2\d)/.test(document.body.innerText),
  },
  {
    slug: "05-tasks",
    route: "/tasks",
    label: "Tasks — assigned tasks, semester points and house rank",
    // A task row as well as the points card: the card lands on its own, and
    // without a row the shot is the "You're all clear" empty state. The demo
    // seed assigns roster #1, the account this signs in as, two open tasks.
    ready: () =>
      /House rank\s*#\d+/.test(document.body.innerText) &&
      Boolean(document.querySelector('[role="checkbox"]')),
  },
  {
    slug: "06-study",
    route: "/study",
    label: "Study hours — zones, this week, recent sessions",
    ready: () => document.body.innerText.includes("RECENT SESSIONS"),
  },
  {
    slug: "07-directory",
    route: "/directory",
    // Not "actives and alumni": the Actives chip lists every member, alumni
    // included, so the screen does not yet make the split its chips name.
    label: "Directory — the chapter's members, searchable by name",
    ready: () =>
      Boolean(document.querySelector('[aria-label^="View "][role="button"]')),
  },
];

/**
 * Whether any Ask surface is on screen: the ✦ glyph, the pill's accessible
 * name, or a leaf whose whole text is "Ask" (the pill's label, or the tab
 * navigator's title on the `ask` route). Runs in the page.
 */
const ASK_ON_SCREEN = () =>
  document.body.innerText.includes("✦") ||
  Boolean(document.querySelector('[aria-label="Ask"]')) ||
  [...document.querySelectorAll("body *")].some(
    (el) => el.childElementCount === 0 && el.textContent.trim() === "Ask",
  );

class AskOnScreenError extends Error {}

/** Width and height from a PNG's IHDR chunk, which always follows the magic. */
async function pngSize(file) {
  const bytes = await readFile(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

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

async function captureRunningApp(
  browser,
  {
    screens = APP_SCREENS,
    viewport = PHONE,
    outDir = APP_DIR,
    noAsk = false,
  } = {},
) {
  const context = await browser.newContext({
    viewport,
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

  for (const screen of screens) {
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

      // Checked on the settled screen, immediately before the shot, so what is
      // checked is what is saved.
      if (noAsk && (await page.evaluate(ASK_ON_SCREEN))) {
        throw new AskOnScreenError(
          `${slug}: an Ask surface is on screen. The store binary has no Ask ` +
            `(#2259), so this server must be started with ` +
            `EXPO_PUBLIC_ASK_ENABLED unset. Refusing to write a store set.`,
        );
      }

      const file = path.join(outDir, `${slug}.png`);
      await page.screenshot({ path: file });
      done.push({ slug, label, file });
      console.log("ok");
    } catch (error) {
      if (error instanceof AskOnScreenError) {
        console.log("REFUSED");
        await context.close();
        throw error;
      }
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

async function captureAppStore(browser) {
  await rm(STORE_DIR, { recursive: true, force: true });
  await mkdir(STORE_DIR, { recursive: true });

  console.log(
    `App Store set, ${STORE_PHONE.width}x${STORE_PHONE.height} @${SCALE}x ` +
      "(signed in against the seeded demo chapter):",
  );
  let shots;
  try {
    shots = await captureRunningApp(browser, {
      screens: STORE_SCREENS,
      viewport: STORE_PHONE,
      outDir: STORE_DIR,
      noAsk: true,
    });
  } catch (error) {
    // No partial store set survives a run that saw Ask: a folder of the shots
    // taken before it is exactly what someone would upload by mistake.
    await rm(STORE_DIR, { recursive: true, force: true });
    throw error;
  }

  for (const shot of shots) {
    const { width, height } = await pngSize(shot.file);
    shot.size = `${width}x${height}`;
    if (width !== STORE_PIXELS.width || height !== STORE_PIXELS.height) {
      failures.push(
        `${shot.slug}: ${shot.size}, expected ` +
          `${STORE_PIXELS.width}x${STORE_PIXELS.height}`,
      );
    }
  }

  console.log(`\n${shots.length} App Store screens -> ${STORE_DIR}`);
  for (const { slug, label, size } of shots) {
    console.log(`  ${slug}.png  ${size}  ${label}`);
  }
  return shots;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });

  if (APP_STORE) {
    try {
      await captureAppStore(browser);
    } finally {
      await browser.close();
    }
    if (failures.length) {
      console.log("\nFailed:");
      for (const f of failures) console.log(`  ${f}`);
      process.exitCode = 1;
    }
    return;
  }

  await rm(APP_DIR, { recursive: true, force: true });
  await mkdir(APP_DIR, { recursive: true });

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
