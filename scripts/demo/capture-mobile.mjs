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
 * Only the pre-auth screens can come from the running app. `apps/mobile` stores
 * its session and API token exclusively in `expo-secure-store`, whose web build
 * is `export default {}` — so on web the token never persists and every
 * authenticated call 401s. The signed-in screens therefore come from
 * `spec/ui/design-system/reference/canvas-screens.dc.html`, which the
 * signet-cutover skill designates as visual truth for those surfaces.
 *
 *   node scripts/demo/capture-mobile.mjs
 *
 * Env: MOBILE_URL (default http://localhost:3002), OUT_ROOT, CHROMIUM_PATH
 */
import { chromium } from "playwright";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MOBILE_URL = process.env.MOBILE_URL ?? "http://localhost:3002";
const OUT_ROOT = process.env.OUT_ROOT ?? "screenshots";
const APP_DIR = path.join(OUT_ROOT, "mobile-app");
const REF_DIR = path.join(OUT_ROOT, "mobile-reference");

const BOARD = "spec/ui/design-system/reference/canvas-screens.dc.html";
const FONT = "packages/theme/fonts/FigtreeVF.woff2";

/** iPhone 16 Pro logical size — the `hint-size` the board's artboards declare. */
const PHONE = { width: 402, height: 874 };
const SCALE = 3;

/**
 * Routes the running app can actually render without a session — which is
 * sign-in, and only sign-in.
 *
 * `/welcome`, `/join`, `/chapter-picker` and `/create-chapter` all look
 * capturable and are not: `(auth)/_layout.tsx` routes them by *gate
 * destination*, not by URL, so a signed-out visit to any of them redirects to
 * `/sign-in`. Listing them here previously produced three byte-identical copies
 * of the sign-in screen under three different names. The landed-route
 * assertion below is what makes that failure loud instead of silent — keep it
 * if you add a route back.
 */
const APP_ROUTES = [["01-sign-in", "/sign-in", "Sign in"]];

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
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

  for (const [slug, route, label] of APP_ROUTES) {
    process.stdout.write(`  app ${route} ... `);
    try {
      await page.goto(`${MOBILE_URL}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      // Metro serves a bundle that boots the whole router before first paint.
      await page.waitForTimeout(9000);

      // Never save a screenshot under a name the app did not actually render.
      const landed = new URL(page.url()).pathname;
      if (landed !== route) {
        throw new Error(`redirected to ${landed} — not capturable signed out`);
      }

      await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
      const file = path.join(APP_DIR, `${slug}.png`);
      await page.screenshot({ path: file });
      done.push({ slug, label, file });
      console.log("ok");
    } catch (error) {
      failures.push(`${route}: ${error.message.split("\n")[0]}`);
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
  await rm(REF_DIR, { recursive: true, force: true });
  await mkdir(APP_DIR, { recursive: true });
  await mkdir(REF_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  console.log("Running app (pre-auth screens only — see header comment):");
  const app = await captureRunningApp(browser);

  console.log("\nDesign reference board:");
  const ref = await captureReferenceBoard(browser);

  await browser.close();
  console.log(`\n${app.length} app screens -> ${APP_DIR}`);
  console.log(`${ref.length} reference artboards -> ${REF_DIR}`);

  if (failures.length) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
