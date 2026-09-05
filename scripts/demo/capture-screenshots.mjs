#!/usr/bin/env node
/**
 * Capture marketing / showcase screenshots of the web dashboard.
 *
 * Signs in as the demo president seeded by `scripts/demo/demo-seed.sql`, walks
 * the dashboard routes, and writes 2x PNGs to `screenshots/web/`.
 *
 * Output is gitignored on purpose: docs/internal/DOCUMENTATION_CONVENTIONS.md
 * forbids inventing a new top-level folder ("never create a new top-level file,
 * and never invent a top-level folder"), and there is no sanctioned home for
 * generated marketing binaries. Regenerate, do not commit.
 *
 * Prereqs: local Supabase up, demo seed loaded, API on :3001, web on :3000.
 *
 *   node scripts/demo/capture-screenshots.mjs
 *
 * Env:
 *   BASE_URL    default http://localhost:3000
 *   OUT_DIR     default screenshots/web
 *   DEMO_EMAIL / DEMO_PASSWORD  demo login
 */
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

// `localhost`, not `127.0.0.1`: the API's CORS allowlist (apps/api/src/main.ts)
// names `http://localhost:3000`, and every browser call fails preflight from
// the numeric origin — which looks exactly like "the app has no data".
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CHAPTER_ID =
  process.env.DEMO_CHAPTER_ID ?? "c0ffee00-0000-4000-8000-000000000001";
const OUT_DIR = process.env.OUT_DIR ?? "screenshots/web";
const EMAIL = process.env.DEMO_EMAIL ?? "marcus.ellison@westfield.edu";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoShowcase!2026";

/** Marketing frame: 16:10, captured at 2x for retina-quality stills. */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

// `/dashboard` is deliberately absent: the proxy treats `/chat` as the
// dashboard root and redirects there, so capturing both yields the same image
// under two names.
const ROUTES = [
  ["members", "/members", "Member directory"],
  ["events", "/events", "Events & attendance"],
  ["tasks", "/tasks", "Task board"],
  ["chat", "/chat", "Chapter chat"],
  ["billing", "/billing", "Dues & billing"],
  ["points", "/points", "Points ledger"],
  ["service", "/service", "Service hours"],
  ["study", "/study", "Study hours"],
  ["documents", "/documents", "Document library"],
  ["polls", "/polls", "Polls"],
  ["reports", "/reports", "Reports"],
  ["geofences", "/geofences", "Study geofences"],
  ["backwork", "/backwork", "Backwork archive"],
  ["settings", "/settings", "Chapter settings"],
  ["profile", "/profile", "Member profile"],
];

/** Suppress animation and caret noise so repeat runs are byte-stable. */
const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
`;

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Skeletons resolve after the first data paint; give them a beat.
  await page.waitForTimeout(1200);
  await page
    .waitForFunction(
      () => !document.querySelector('[data-slot="skeleton"], .animate-pulse'),
      { timeout: 4000 },
    )
    .catch(() => {});
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), {
      timeout: 30_000,
    }),
    page.click('button[type="submit"]'),
  ]);
  await settle(page);
  console.log(`  signed in -> ${new URL(page.url()).pathname}`);

  // The session cookie alone is not enough. `activeChapterId` lives in a
  // zustand/persist store that only `useSelectChapter` writes, so a fresh
  // sign-in leaves it null and every chapter-scoped query stays `enabled:
  // false` — the dashboard renders its empty states with the data right there
  // in the API. Single-chapter users already auto-resolve server-side (the
  // JWT carries the claim), so seeding the same id here cannot disagree with
  // the token the way a real mid-session switch could.
  await page.evaluate((chapterId) => {
    localStorage.setItem(
      "frapp-active-chapter",
      JSON.stringify({
        state: { activeChapterId: chapterId, hasHydrated: true },
        version: 0,
      }),
    );
  }, CHAPTER_ID);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // The sandbox ships a pinned Chromium that may not match this Playwright
  // build's expected revision; point at it rather than downloading another.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  console.log(`Signing in as ${EMAIL}`);
  await signIn(page);

  const captured = [];
  const failed = [];

  for (const [slug, route, label] of ROUTES) {
    process.stdout.write(`  ${route} ... `);
    try {
      await page.goto(`${BASE_URL}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
      await settle(page);

      const landed = new URL(page.url()).pathname;
      if (landed.startsWith("/sign-in")) {
        throw new Error("bounced to /sign-in — session lost");
      }

      const file = path.join(OUT_DIR, `${slug}.png`);
      await page.screenshot({ path: file });
      captured.push({ slug, route, label, file, landed });
      console.log(`ok${landed === route ? "" : ` (-> ${landed})`}`);
    } catch (error) {
      failed.push({ route, message: error.message.split("\n")[0] });
      console.log(`FAILED: ${error.message.split("\n")[0]}`);
    }
  }

  await browser.close();

  console.log(`\n${captured.length}/${ROUTES.length} captured -> ${OUT_DIR}`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  ${f.route}: ${f.message}`);
  }
  return failed.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
