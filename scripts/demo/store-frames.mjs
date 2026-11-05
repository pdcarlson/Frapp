/**
 * The store screenshot frames: caption, app screen and one lifted card per
 * frame, in Frapp's charcoal and gold, composed around the raw app captures.
 *
 * `capture-mobile.mjs --store` captures each screen once, at the App Store's
 * 440x956 viewport at 3x, then hands the folder here. Each store's frame is
 * its own shape (App Store 1320x2868, Google Play 1242x2208), but the screen
 * inside it is the same capture, so both sets carry identical screens and
 * captions. Kept apart from `capture-mobile.mjs`, which launches a browser
 * the moment it is imported, so `scripts/ci/__tests__/store-frames.test.mjs`
 * can hold the captions to the listing rules without one.
 *
 * Design: the owner picked direction A (charcoal) on 2026-11-05 from three
 * mocked directions. The gold and the emblem are the brand mark's
 * (`scripts/lib/brand-pixels.mjs`), as on the icon and the Play feature
 * graphic, and the type is Figtree; the field is a warmer charcoal than the
 * mark's `#1A1A1A`, so the phone's near-black screen still reads against it. A gold line runs
 * across the whole set so the store's row of frames reads as one piece.
 * Procedure: `docs/ops/deployment/mobile.md` § 6.4.
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GOLD_HEX } from "../lib/brand-pixels.mjs";
import {
  APP_STORE_PRESET,
  GOOGLE_PLAY_PRESET,
  STORE_SCALE,
} from "./store-screenshots.mjs";

const FONT = "packages/theme/fonts/FigtreeVF.woff2";
const EMBLEM = "packages/brand-assets/assets/signet-emblem-B-glyph.svg";

/** A warm charcoal field, the mark's gold, the two text tones and the app's screen. */
export const FRAME_COLOURS = {
  field: "#161514",
  gold: GOLD_HEX,
  cream: "#F3EFE6",
  muted: "#A9A39A",
  screen: "#121110",
};

/**
 * One entry per store screen, keyed by `STORE_SCREENS` slug and in its order.
 * `title` marks its gold words with <em>. `callout` lifts one region of the
 * capture out of the phone: x, y, w, h are fractions of the raw capture,
 * `scale` sizes the card against the phone's width (default 1), `dy` nudges it
 * by a fraction of the frame height, and `rot` tilts it in degrees.
 *
 * Captions follow the listing rules: nothing that ranks the app itself, no
 * award, price or promotion text (Play), no "Signet" anywhere (ADR-25), and
 * written the way a member would say it. A member's rank inside the app is
 * a feature, not a store ranking.
 */
export const STORE_FRAMES = [
  {
    slug: "01-chat-home",
    eyebrow: "Chat",
    title: "Your chapter,<br>in <em>one place</em>",
    sub: "Channels, what's up next, and what's due, on one screen.",
  },
  {
    slug: "02-events",
    eyebrow: "Events",
    title: "Know what's on<br><em>this week</em>",
    sub: "Every event, where it is, and what it's worth in points.",
    callout: { x: 0.035, y: 0.157, w: 0.93, h: 0.112 },
  },
  {
    slug: "03-host-check-in",
    eyebrow: "Check-in",
    title: "Check in<br><em>at the door</em>",
    sub: "Officers hold up a QR. Members scan it and they're counted.",
    callout: { x: 0.18, y: 0.655, w: 0.64, h: 0.095, scale: 0.72, rot: 1.2 },
  },
  {
    slug: "04-chat-thread",
    eyebrow: "Channels",
    title: "The group chat,<br><em>sorted</em>",
    sub: "Channels for announcements, exec and every committee.",
    callout: { x: 0.015, y: 0.394, w: 0.97, h: 0.112 },
  },
  {
    slug: "05-tasks",
    eyebrow: "Points",
    title: "See your points<br>and <em>your rank</em>",
    sub: "Your tasks, your semester points, and where you stand in the house.",
    callout: { x: 0.033, y: 0.068, w: 0.934, h: 0.1, dy: -0.012 },
  },
  {
    slug: "06-study",
    eyebrow: "Study hours",
    title: "Study hours<br><em>that count</em>",
    sub: "Start a session inside your chapter's study zones.",
    callout: { x: 0.035, y: 0.093, w: 0.93, h: 0.2 },
  },
  {
    slug: "07-directory",
    eyebrow: "Directory",
    title: "Find anyone<br>in <em>the chapter</em>",
    sub: "Every member and their role, searchable by name.",
  },
];

/** The words a frame puts on screen, tags stripped, for the copy checks. */
export function frameText(frame) {
  return [frame.eyebrow, frame.title, frame.sub]
    .join(" ")
    .replace(/<[^>]+>/g, " ");
}

/**
 * Play forbids text that ranks the app, cites an award, or quotes a price or
 * promotion on a screenshot; ADR-25 keeps "Signet" off every surface. Why a
 * frame's copy breaks either; empty when it doesn't. A word list, so it
 * catches the usual phrasings, not every one: the owner still reads the set.
 */
const STORE_CLAIM = new RegExp(
  [
    String.raw`#\s?1\b`,
    String.raw`\bno\.?\s?1\b`,
    String.raw`\bnumber one\b`,
    String.raw`\bbest\b`,
    String.raw`\btop[- ](?:rated|ranked|\d+)\b`,
    String.raw`\btop (?:\w+ )?apps?\b`,
    String.raw`\baward`,
    String.raw`\bapp of the (?:year|day)\b`,
    String.raw`\b(?:editor'?s'?|editors) (?:choice|pick)\b`,
    String.raw`\bpopular\b`,
    String.raw`\bfree\b`,
    String.raw`\bon sale\b`,
    String.raw`\bdiscount`,
    String.raw`% off`,
    String.raw`\$\d`,
  ].join("|"),
  "i",
);
export function frameCopyProblems(frame) {
  const text = frameText(frame);
  const problems = [];
  if (/signet/i.test(text)) problems.push(`${frame.slug}: says "Signet"`);
  if (STORE_CLAIM.test(text)) {
    problems.push(`${frame.slug}: ranking, award, price or promotion wording`);
  }
  return problems;
}

const IOS_STATUS = `<span>9:41</span><span class="icons">
<svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>
<svg width="15" height="11" viewBox="0 0 15 11"><path d="M7.5 2.2c2.1 0 4 .8 5.4 2.2l1.1-1.1A9.2 9.2 0 0 0 7.5.6 9.2 9.2 0 0 0 1 3.3l1.1 1.1a7.6 7.6 0 0 1 5.4-2.2Zm0 3.2c1.2 0 2.3.5 3.1 1.3l1.1-1.1a6 6 0 0 0-8.4 0l1.1 1.1c.8-.8 1.9-1.3 3.1-1.3Zm0 3.2c-.5 0-.9.2-1.2.5l1.2 1.3 1.2-1.3c-.3-.3-.7-.5-1.2-.5Z"/></svg>
<svg width="25" height="12" viewBox="0 0 25 12"><rect x=".5" y=".5" width="21" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="18" height="8" rx="2"/><rect x="22.5" y="4" width="1.6" height="4" rx=".8" opacity=".4"/></svg></span>`;

/** Android puts the time on the left, then wifi, signal and an upright battery. */
const ANDROID_STATUS = `<span>12:30</span><span class="icons">
<svg width="14" height="11" viewBox="0 0 14 11"><path d="M7 11 0 3.2A10.4 10.4 0 0 1 7 .5c2.7 0 5.1 1 7 2.7Z"/></svg>
<svg width="11" height="11" viewBox="0 0 11 11"><path d="M11 0v11H0Z"/></svg>
<svg width="7" height="12" viewBox="0 0 7 12"><rect x="2" y="0" width="3" height="1.4" rx=".4"/><rect x="0" y="1.2" width="7" height="10.8" rx="1.4"/></svg></span>`;

/**
 * Each store's frame, in CSS pixels (rendered at `STORE_SCALE`): the phone's
 * width, how far down it starts, and the status bar its platform draws. The
 * phone runs off the bottom edge on purpose; the lifted card shows the detail.
 */
export const FRAME_LAYOUTS = [
  {
    preset: APP_STORE_PRESET,
    phoneWidth: 336,
    phoneTop: 0.315,
    status: IOS_STATUS,
  },
  {
    preset: GOOGLE_PLAY_PRESET,
    phoneWidth: 304,
    phoneTop: 0.335,
    status: ANDROID_STATUS,
  },
];

const fileUrl = (p) => pathToFileURL(path.resolve(p)).href;

function wavePath(W, H, n) {
  let d = `M -20 ${H * 0.62}`;
  for (let i = 0; i < n; i++) {
    const x0 = i * W;
    const [a, b] = i % 2 ? [0.48, 0.8] : [0.8, 0.48];
    d += ` C ${x0 + W * 0.3} ${H * a}, ${x0 + W * 0.7} ${H * b}, ${x0 + W} ${H * 0.62}`;
  }
  return d;
}

/** The whole set as one strip of frames, so the gold line runs across them. */
export function stripHtml(layout, rawDir, frames = STORE_FRAMES) {
  const { preset, phoneWidth: phoneW, status } = layout;
  const { width: W, height: H } = preset.viewport;
  const RAW = APP_STORE_PRESET.pixels;
  const phoneTop = H * layout.phoneTop;
  const bezel = phoneW * 0.028;
  const screenW = phoneW - 2 * bezel;
  const statusH = phoneW * 0.11;
  const c = FRAME_COLOURS;
  const n = frames.length;

  const css = `
@font-face { font-family: Figtree; src: url("${fileUrl(FONT)}"); font-weight: 300 900; }
* { box-sizing: border-box; margin: 0; }
body { width: ${W * n}px; height: ${H}px; overflow: hidden; background: ${c.field}; font-family: Figtree; }
.strip { position: relative; display: flex; width: 100%; height: 100%; }
.frame { position: relative; flex: 0 0 ${W}px; height: ${H}px; }
.copy { position: absolute; left: 34px; right: 34px; top: ${H * 0.072}px; z-index: 3; }
.eyebrow { font-size: 13px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: ${c.gold};
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.eyebrow::before { content: ""; width: 22px; height: 2px; background: currentColor; }
h1 { font-size: ${W * 0.086}px; line-height: 1.04; font-weight: 750; letter-spacing: -0.025em; color: ${c.cream}; }
h1 em { font-style: normal; color: ${c.gold}; }
.sub { margin-top: 14px; font-size: ${W * 0.039}px; line-height: 1.38; font-weight: 450; color: ${c.muted}; max-width: 94%; }
.mark { position: absolute; right: 30px; top: ${H * 0.076}px; width: 30px; z-index: 3; }
.phone { position: absolute; left: 50%; transform: translateX(-50%); top: ${phoneTop}px; width: ${phoneW}px; z-index: 2;
  border-radius: ${phoneW * 0.15}px; padding: ${bezel}px;
  background: linear-gradient(160deg, #3a3835, #1d1c1a 40%, #2b2a27);
  box-shadow: 0 0 0 1px rgba(255,255,255,.07), 0 40px 80px rgba(0,0,0,.55); }
.screen { border-radius: ${phoneW * 0.125}px; overflow: hidden; background: ${c.screen}; }
.screen img { display: block; width: 100%; }
.status { height: ${statusH}px; display: flex; justify-content: space-between; align-items: center;
  padding: 0 ${phoneW * 0.09}px 0 ${phoneW * 0.11}px; color: ${c.cream}; fill: ${c.cream};
  font-weight: 650; font-size: ${phoneW * 0.047}px; }
.status .icons { display: flex; gap: 5px; align-items: center; }
.hole { position: absolute; z-index: 3; left: calc(50% - ${screenW / 2}px); width: ${screenW}px; background: ${c.screen}; }
.callout { position: absolute; left: 50%; z-index: 4; border-radius: 16px; background-color: ${c.screen};
  box-shadow: 0 0 0 1px rgba(221,184,68,.45), 0 28px 56px -12px rgba(0,0,0,.75), 0 10px 20px -8px rgba(0,0,0,.6); }
.thread { position: absolute; inset: 0; z-index: 1; }
`;

  const sections = frames.map((f) => {
    const img = fileUrl(path.join(rawDir, `${f.slug}.png`));
    let lifted = "";
    if (f.callout) {
      const k0 = f.callout;
      const outW = (phoneW + 44) * (k0.scale ?? 1);
      const k = outW / (RAW.width * k0.w);
      const h = RAW.height * k0.h * k;
      const onScreen = screenW / RAW.width;
      const srcTop = phoneTop + bezel + statusH + RAW.height * k0.y * onScreen;
      const srcH = RAW.height * k0.h * onScreen;
      // Grow mostly downward from where the card sits, then keep the whole
      // card inside the frame: a lifted card must never be cut by the edge.
      const natural = srcTop - (h - srcH) * 0.2 + (k0.dy ?? 0) * H;
      const top = Math.min(natural, H - h - H * 0.07);
      // Moved up to fit (the shorter Play frame): blank the spot it was
      // lifted from, so the card is not drawn twice.
      const hole =
        natural - top > 4
          ? `<div class="hole" style="top:${srcTop}px;height:${H - srcTop}px"></div>`
          : "";
      lifted = `${hole}<div class="callout" style="width:${outW}px;height:${h}px;top:${top}px;
        transform:translateX(-50%) rotate(${k0.rot ?? -1.2}deg);
        background-image:url('${img}');background-repeat:no-repeat;
        background-position:${-RAW.width * k0.x * k}px ${-RAW.height * k0.y * k}px;
        background-size:${RAW.width * k}px auto;"></div>`;
    }
    return `<section class="frame">
  <img class="mark" src="${fileUrl(EMBLEM)}" alt="">
  <div class="copy"><div class="eyebrow">${f.eyebrow}</div><h1>${f.title}</h1><p class="sub">${f.sub}</p></div>
  <div class="phone"><div class="screen"><div class="status">${status}</div><img src="${img}" alt=""></div></div>
  ${lifted}
</section>`;
  });

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="strip">
<svg class="thread" viewBox="0 0 ${W * n} ${H}" preserveAspectRatio="none">
  <path d="${wavePath(W, H, n)}" fill="none" stroke="${c.gold}" stroke-width="1.6" opacity=".55"/></svg>
${sections.join("\n")}
</div></body></html>`;
}

/**
 * Why the frames can't be composed from these captures: copy that breaks the
 * listing rules, or captured slugs that don't match the frames one for one (a
 * frame with no capture renders a blank phone that still passes every size
 * check). Empty when they can.
 */
export function composeProblems(capturedSlugs, frames = STORE_FRAMES) {
  const problems = frames.flatMap(frameCopyProblems);
  const want = frames.map((f) => f.slug).join(", ");
  const got = capturedSlugs.join(", ");
  if (want !== got)
    problems.push(`frames are [${want}] but the captures are [${got}]`);
  return problems;
}

/**
 * Frame every raw capture in `rawDir` for both stores, into
 * `<outRoot>/<preset.folder>/<slug>.png`. Returns one entry per store with the
 * files written; `capture-mobile.mjs` checks them with `storeSetProblems`.
 */
export async function composeStoreFrames(
  browser,
  { rawDir, outRoot, capturedSlugs },
) {
  const problems = composeProblems(capturedSlugs);
  if (problems.length)
    throw new Error(`Store frames refused:\n  ${problems.join("\n  ")}`);
  // A missing file renders as an empty phone, so check before framing.
  await Promise.all(
    STORE_FRAMES.map((f) => access(path.join(rawDir, `${f.slug}.png`))),
  );

  const results = [];
  for (const layout of FRAME_LAYOUTS) {
    const { preset } = layout;
    const { width: W, height: H } = preset.viewport;
    const dir = path.join(outRoot, preset.folder);
    await mkdir(dir, { recursive: true });
    // file:// so the page can load the captures, the font and the emblem.
    const htmlPath = path.join(rawDir, `frames-${preset.folder}.html`);
    await writeFile(htmlPath, stripHtml(layout, rawDir));

    const page = await browser.newPage({
      viewport: { width: W * STORE_FRAMES.length, height: H },
      deviceScaleFactor: STORE_SCALE,
    });
    await page.goto(fileUrl(htmlPath), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const files = [];
    for (const [i, frame] of STORE_FRAMES.entries()) {
      const file = path.join(dir, `${frame.slug}.png`);
      await page.screenshot({
        path: file,
        clip: { x: i * W, y: 0, width: W, height: H },
      });
      files.push({ slug: frame.slug, file });
    }
    await page.close();
    results.push({ preset, dir, files });
  }
  return results;
}
