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
 * ## Store sets (`--store`, or `STORE=1`)
 *
 * The owner approved renders of the real app as the store screenshots
 * (#2454), and the store binary has no Ask (#2259), so the store set is a
 * different list from the marketing one above, not a subset of its output.
 * Each screen is captured once, at the 6.9" iPhone viewport, then framed by
 * `store-frames.mjs` (caption, phone, one lifted card) for both stores:
 *
 *   store-raw/         the seven bare captures, 1320x2868 (440x956 at 3x)
 *   app-store/         the framed set, 1320x2868
 *   google-play/       the framed set, 1242x2208 (9:16; Play caps the long
 *                      side at 2x the short, which the App Store size passes)
 *
 * No Ask shot, no reference board, and a hard stop: if an AI surface is in a
 * shot (see `ASK_ON_SCREEN`), which takes an API running with `AI_ENABLED`
 * on, the run deletes all three folders and exits non-zero. Run it against
 * the default stack, where AI is off. Until 2026-11-12 the entry was a header
 * pill behind a build flag, `EXPO_PUBLIC_ASK_ENABLED`, and this stop saw it on
 * every tab; the bar that replaced it is inside the + panel, so the stop now
 * guards the shots, not the stack.
 * The presets and the checks each file must pass live in
 * `store-screenshots.mjs`; any failed check deletes the folders, like the Ask
 * refusal. Procedure and the sizes' provenance:
 * `docs/ops/deployment/mobile.md` § 6.4 and § 6.5.
 *
 * Env: MOBILE_URL (default http://localhost:3002), OUT_ROOT, CHROMIUM_PATH,
 *      DEMO_EMAIL, DEMO_PASSWORD, EVENT_ID, SKIP_REFERENCE=1, STORE=1
 */
import { chromium } from "playwright";
import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { LOCAL_DEMO_EMAIL, LOCAL_DEMO_PASSWORD, TEMPLATE_NAMESPACE, demoIds } from "./seed-demo.mjs";
import { APP_STORE_PRESET, STORE_SCALE, storeSetProblems } from "./store-screenshots.mjs";
import { composeProblems, composeStoreFrames } from "./store-frames.mjs";

const MOBILE_URL = process.env.MOBILE_URL ?? "http://localhost:3002";
const OUT_ROOT = process.env.OUT_ROOT ?? "screenshots";
const APP_DIR = path.join(OUT_ROOT, "mobile-app");
const REF_DIR = path.join(OUT_ROOT, "mobile-reference");

const STORE = process.argv.includes("--store") || process.env.STORE === "1";
for (const [retired, env] of [["--app-store", "APP_STORE"], ["--google-play", "GOOGLE_PLAY"]]) {
  if (process.argv.includes(retired) || process.env[env] === "1") {
    throw new Error(`${retired} (${env}=1) is retired: --store captures once and frames both store sets.`);
  }
}

// The local login setup-demo.sh creates; seed-demo.mjs owns the values.
const EMAIL = process.env.DEMO_EMAIL ?? LOCAL_DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD ?? LOCAL_DEMO_PASSWORD;

/** The zoned Chapter Meeting the demo seed marks up for check-in. */
const EVENT_ID = process.env.EVENT_ID ?? `${demoIds(TEMPLATE_NAMESPACE).prefix}3000000000e1`;

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

/**
 * Poll `read(arg)` in the page until it returns truthy, or throw with `label`
 * on timeout. `arg` is how a value reaches `read`, which runs in the browser
 * and sees none of this script's variables.
 */
async function waitFor(page, label, read, timeoutMs = 30_000, arg) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await page.evaluate(read, arg).catch(() => false)) return;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(400);
  }
}

const bodyText = () => document.body.innerText;

/**
 * Chat home's channel list has loaded: the #general row, not a section header.
 * Which headers draw depends on how the seed files its channels (CHANNELS is
 * only the unfiled ones, #1684), while every chapter always has #general.
 * Runs in the page, so it is self-contained; the two waits that combine this
 * check with others restate the selector inline, because a function handed to
 * the page can't call this one.
 */
const GENERAL_ROW_SHOWN = () =>
  Boolean(document.querySelector('[aria-label^="#general"]'));

/**
 * The #general thread has drawn. Two things this must not be phrased as. Not
 * "the channel list has gone": React Navigation keeps the tab's index screen
 * mounted under the pushed thread, so the list stays in the DOM throughout.
 * And not `innerText.includes("Message")` for the composer: a placeholder is an
 * attribute, so it never appears in `innerText` and the wait could only time
 * out. The thread's own `#general` heading is drawn by this route alone (the
 * tab navigator's "Thread" header it used to wait for is gone, #2485).
 */
const GENERAL_THREAD_SHOWN = () =>
  [...document.querySelectorAll('[role="heading"], h1')].some(
    (heading) => heading.textContent === "#general",
  ) && Boolean(document.querySelector('[placeholder^="Message"]'));

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
    label: "s04 — Chat home (chapter channels, UP NEXT)",
    ready: GENERAL_ROW_SHOWN,
  },
  // There is no `02-ask-answer` shot since 2026-11-12. It photographed Ask
  // answering from a hand-written table behind a build flag, both deleted when
  // Ask got its real API. The seeded demo stack runs with AI off, so it has no
  // Ask to shoot; the later slugs keep their numbers so existing sets line up.
  {
    slug: "03-chat-thread",
    route: "/",
    label: "s05 — Chat thread, #general",
    async act(page) {
      await page.getByText("general", { exact: true }).first().click();
      await page.waitForTimeout(2000);
    },
    ready: GENERAL_THREAD_SHOWN,
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
 * The store set: what the listing sells (`apps/mobile/store/README.md`
 * § Description), in the order a browser of the listing should meet it. Most
 * visitors judge a listing by its first three frames, so those carry the daily
 * loop: talk (Chat home), plan (Events), show up (Host check-in, the thing a
 * group chat can't do). The rest of the member's week follows. The slugs are
 * the framed files' names too, and `store-frames.mjs` keys its captions on
 * them. Every screen here ships in the store binary; there
 * is deliberately no Ask shot, because that binary has no Ask (#2259).
 *
 * No Dues shot either: a populated ledger footers "Payments run through your
 * chapter's Stripe account.", and the reviewer's own Dues tab is seeded empty
 * so App Review never sees that footer or a Pay control (store README § Seed
 * the reviewer's chapter). The listing's text still names dues and payment
 * history; it is the in-app payment copy the shots keep out.
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
    // The #general row alone is the channels query (`GENERAL_ROW_SHOWN` says
    // why not a section header); UP NEXT and the unread badges come from
    // separate queries (events/tasks, unread counts), so wait for both.
    ready: () =>
      Boolean(document.querySelector('[aria-label^="#general"]')) &&
      document.body.innerText.includes("UP NEXT") &&
      /\n\d+\n/.test(document.body.innerText),
  },
  {
    slug: "02-events",
    route: "/events",
    label: "Events — upcoming, with points and the mandatory meeting",
    ready: () =>
      document.body.innerText.includes("Chapter Meeting") &&
      document.body.innerText.includes("pts"),
  },
  {
    slug: "03-host-check-in",
    route: `/host-check-in?eventId=${EVENT_ID}`,
    label: "Host check-in — rotating QR at the door (officer)",
    // Same clock rule as the marketing shot: twelve seconds or more left,
    // for the reason given there.
    ready: () => /Rotates in 0:(1[2-9]|2\d)/.test(document.body.innerText),
  },
  {
    slug: "04-chat-thread",
    route: "/",
    label: "Chat thread — #general",
    async act(page) {
      await page.getByText("general", { exact: true }).first().click();
      await page.waitForTimeout(2000);
    },
    ready: GENERAL_THREAD_SHOWN,
    expectRoute: "/chat-thread",
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
 * Whether an AI surface is in the shot. Since 2026-11-12 Ask's entry is a bar
 * inside the + panel, which no shot opens, so Ask itself can't be
 * photographed by accident; what can is a row that only exists with AI on:
 * the Tasks tab's "N suggested tasks". Also matched: "Ask Frapp" (the bar or
 * the sheet, should a shot ever open one) and the ✦ glyph and bare "Ask" the
 * entry used before, so an old bundle is still refused. Runs in the page.
 */
const ASK_ON_SCREEN = () =>
  document.body.innerText.includes("✦") ||
  Boolean(
    document.querySelector('[aria-label="Ask"], [aria-label="Ask Frapp"]'),
  ) ||
  [...document.querySelectorAll("body *")].some((el) => {
    if (el.childElementCount !== 0) return false;
    const text = el.textContent.trim();
    return (
      text === "Ask" ||
      text === "Ask Frapp" ||
      /^\d+ suggested tasks?$/.test(text)
    );
  });

class AskOnScreenError extends Error {}

async function signIn(page) {
  await page.goto(`${MOBILE_URL}/sign-in`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  // s01 keeps the password form behind "Continue with email" (#3349).
  await waitFor(page, "sign-in screen", () =>
    document.body.innerText.includes("Continue with email"),
  );
  await page.getByText("Continue with email", { exact: true }).click();
  await waitFor(page, "sign-in form", () =>
    document.body.innerText.includes("Sign in with email"),
  );

  await page
    .locator('input[type="email"], input[inputmode="email"]')
    .first()
    .fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();

  // A loaded channel row is the first thing that proves the whole chain
  // worked: session persisted, token mirrored, API accepted the Bearer.
  // A seeded login has accepted no Terms (#2302), so the auth gate may ask
  // first, on /terms; agree for it and carry on to the home the shots are of.
  await waitFor(
    page,
    "signed-in home or the Terms prompt (is EXPO_PUBLIC_WEB_SECURE_STORE=1 set?)",
    (prompt) =>
      Boolean(document.querySelector('[aria-label^="#general"]')) ||
      document.body.innerText.includes(prompt),
    60_000,
    TERMS_PROMPT_TITLE,
  );
  await agreeToTermsIfAsked(page);
  await waitFor(
    page,
    "signed-in home",
    GENERAL_ROW_SHOWN,
    60_000,
  );
}

/**
 * The Terms prompt's title and button, from `TERMS_PROMPT_COPY` in
 * `@repo/validation` (this script imports no workspace package, so a change
 * there must be made here too; the capture fails loudly if it isn't).
 */
const TERMS_PROMPT_TITLE = "Agree to the Terms to continue";
const TERMS_PROMPT_CTA = "Agree and continue";

/**
 * Tick the Terms prompt for the demo login when the gate shows it (#2302). The
 * login is the operator's own demo account, and a store screenshot of the
 * prompt is not what these captures are for.
 */
async function agreeToTermsIfAsked(page) {
  const asked = await page.evaluate(
    (title) => document.body.innerText.includes(title),
    TERMS_PROMPT_TITLE,
  );
  if (!asked) return;
  await page.getByRole("checkbox").first().click();
  await page.getByText(TERMS_PROMPT_CTA, { exact: true }).click();
}

async function captureRunningApp(
  browser,
  {
    screens = APP_SCREENS,
    viewport = PHONE,
    scale = SCALE,
    outDir = APP_DIR,
    noAsk = false,
    timezoneId,
  } = {},
) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    colorScheme: "dark",
    isMobile: true,
    hasTouch: true,
    ...(timezoneId ? { timezoneId } : {}),
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
          `${slug}: an AI surface is on screen. Production has no AI ` +
            `(#2259), so the API behind this capture must run with ` +
            `AI_ENABLED off. Refusing to write a store set.`,
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

/**
 * The demo seed puts each event at a UTC hour (`demo-seed.sql` § Events), so
 * the store run renders in UTC to show the 7:00 PM chapter meeting at 7:00 PM.
 * Chat and study times are minutes before the seed ran, so a seed in the small
 * hours stamps the thread "3:00 AM". Seed and shoot after this UTC hour, on
 * the same UTC day. The run can only see its own clock, not the seed's.
 */
const STORE_TIMEZONE = "UTC";
const STORE_FROM_HOUR_UTC = 13;

async function captureStoreSet(browser) {
  const rawDir = path.join(OUT_ROOT, "store-raw");
  const dirs = [rawDir, ...["app-store", "google-play"].map((f) => path.join(OUT_ROOT, f))];
  const clear = () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  await clear();

  // Refuse the copy, and a frame list that has drifted from STORE_SCREENS,
  // before spending a capture on them.
  const planned = composeProblems(STORE_SCREENS.map((s) => s.slug));
  if (planned.length) {
    failures.push(...planned);
    console.log("\nStore sets not written: the frames don't fit the screens, see below.");
    return;
  }
  await mkdir(rawDir, { recursive: true });

  const hour = new Date().getUTCHours();
  if (hour < STORE_FROM_HOUR_UTC) {
    console.log(
      `  warning: it is ${hour}:00 UTC. If the demo was seeded today, chat and study times read as ` +
        `the small hours; re-seed and shoot after ${STORE_FROM_HOUR_UTC}:00 UTC.`,
    );
  } else {
    console.log(
      `  note: chat and study times follow the seed's clock; seed after ${STORE_FROM_HOUR_UTC}:00 UTC today.`,
    );
  }

  const { viewport } = APP_STORE_PRESET;
  console.log(
    `Store screens, ${viewport.width}x${viewport.height} @${STORE_SCALE}x ` +
      "(signed in against the seeded demo chapter):",
  );
  const failuresBefore = failures.length;
  let shots;
  try {
    shots = await captureRunningApp(browser, {
      screens: STORE_SCREENS,
      viewport,
      scale: STORE_SCALE,
      outDir: rawDir,
      noAsk: true,
      timezoneId: STORE_TIMEZONE,
    });
  } catch (error) {
    // No partial store set survives a run that saw Ask: a folder of the shots
    // taken before it is exactly what someone would upload by mistake.
    await clear();
    throw error;
  }

  // captureRunningApp words and records its own screen failures.
  const screenFailures = failures.slice(failuresBefore);
  const read = (list) =>
    Promise.all(list.map(async ({ slug, file }) => ({ slug, bytes: await readFile(file) })));
  const problems = storeSetProblems(APP_STORE_PRESET, await read(shots), screenFailures);

  let sets = [];
  if (!problems.length) {
    try {
      sets = await composeStoreFrames(browser, {
        rawDir,
        outRoot: OUT_ROOT,
        capturedSlugs: shots.map((s) => s.slug),
      });
      for (const set of sets) {
        for (const problem of storeSetProblems(set.preset, await read(set.files))) {
          problems.push(`${set.preset.name}: ${problem}`);
        }
      }
    } catch (error) {
      // A half-framed set is as uploadable by mistake as a half-captured one.
      await clear();
      throw error;
    }
  }
  failures.push(...problems.slice(screenFailures.length));

  // The same rule as the Ask refusal, for every other problem: a screen that
  // never rendered, a file the store would reject, or a count it won't take
  // leaves nothing behind to upload.
  if (problems.length) {
    await clear();
    console.log("\nStore sets not written: store-raw/, app-store/ and google-play/ removed, see below.");
    return;
  }

  for (const { preset, dir, files } of sets) {
    const { width, height } = preset.pixels;
    console.log(`\n${files.length} ${preset.name} frames, ${width}x${height} -> ${dir}`);
    for (const { slug } of files) console.log(`  ${slug}.png`);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  if (STORE) {
    try {
      await captureStoreSet(browser);
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
