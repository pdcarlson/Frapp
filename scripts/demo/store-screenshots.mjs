/**
 * The two stores' screenshot presets, and the checks a captured PNG must pass
 * before it is worth uploading. Kept apart from `capture-mobile.mjs`, which
 * launches a browser the moment it is imported, so that
 * `scripts/ci/__tests__/store-screenshots.test.mjs` can hold the presets to
 * each store's rules. Procedure and provenance:
 * `docs/ops/deployment/mobile.md` § 6.4 (App Store) and § 6.5
 * (Google Play).
 */
import { pngHeader } from "../lib/brand-pixels.mjs";

/** Every preset renders at 3x, like the marketing set. */
export const STORE_SCALE = 3;

/**
 * The App Store's 6.9" iPhone size: 440x956 points at 3x is 1320x2868 pixels.
 * Apple's screenshot specifications (developer.apple.com → App Store Connect
 * help → Reference → Screenshot specifications, read 2026-09-22) list 1320x2868
 * portrait among the 6.9" sizes, ask for a 6.5" set only when no 6.9" set is
 * provided, and scale the smaller iPhone sizes from the set above them. That
 * is the published page, not the console: #2454 asks for the size App Store
 * Connect states at upload to be confirmed and recorded.
 */
export const APP_STORE_PRESET = {
  name: "App Store",
  folder: "app-store",
  viewport: { width: 440, height: 956 },
  pixels: { width: 1320, height: 2868 },
};

/**
 * Play Console Help ("Add preview assets to showcase your app"): each side
 * 320-3840 px, the long side at most twice the short one, JPEG or 24-bit PNG
 * with no alpha, and 2 to 8 phone screenshots. For promotion Play also prefers
 * at least 1080 px on each side. That page is blocked from the cloud sandbox,
 * so these come from search-result snippets of it (2026-09-27), not the page
 * itself; #2720 asks for the console's own wording to be recorded at upload.
 */
export const PLAY_SCREENSHOT_LIMITS = {
  minSide: 320,
  maxSide: 3840,
  maxRatio: 2,
  minCount: 2,
  maxCount: 8,
  promotionMinSide: 1080,
};

/**
 * Google Play's phone screenshots: 414x736 points at 3x is 1242x2208 pixels,
 * 9:16, inside `PLAY_SCREENSHOT_LIMITS`. 9:16 is also the shape Play prefers
 * for promotion, and 414 is a Pixel-class width. Play rejects a PNG with
 * alpha, so this preset also requires an opaque 8-bit RGB file
 * (`opaqueRgb`), which is what Playwright writes today; the check turns a
 * change there into a failed run rather than a rejected upload.
 */
export const GOOGLE_PLAY_PRESET = {
  name: "Google Play",
  folder: "google-play",
  viewport: { width: 414, height: 736 },
  pixels: { width: 1242, height: 2208 },
  opaqueRgb: true,
  countLimits: {
    min: PLAY_SCREENSHOT_LIMITS.minCount,
    max: PLAY_SCREENSHOT_LIMITS.maxCount,
  },
};

/** Why a pixel size breaks Play's screenshot limits; empty when it doesn't. */
export function playSizeProblems({ width, height }) {
  const { minSide, maxSide, maxRatio } = PLAY_SCREENSHOT_LIMITS;
  const problems = [];
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < minSide) problems.push(`a side is under ${minSide} px`);
  if (long > maxSide) problems.push(`a side is over ${maxSide} px`);
  if (long > short * maxRatio) {
    problems.push(`the long side is more than ${maxRatio}x the short side`);
  }
  return problems;
}

const PNG_COLOUR_TYPE_RGB = 2;
const PNG_CHUNKS_START = 8;

/** Whether a PNG carries a `tRNS` chunk, which gives even an RGB image transparency. */
function hasTransparencyChunk(buffer) {
  let offset = PNG_CHUNKS_START;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (type === "tRNS") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

/**
 * Why a captured screenshot can't be uploaded under `preset`; empty when it
 * can. Reads only the chunk headers, never the pixels.
 */
export function storePngProblems(buffer, preset) {
  const header = pngHeader(buffer);
  if (!header) return ["not a PNG"];
  const problems = [];
  const { width, height } = preset.pixels;
  if (header.width !== width || header.height !== height) {
    problems.push(`${header.width}x${header.height}, expected ${width}x${height}`);
  }
  if (preset.opaqueRgb) {
    if (header.colourType !== PNG_COLOUR_TYPE_RGB || header.bitDepth !== 8) {
      problems.push(
        `PNG colour type ${header.colourType} at ${header.bitDepth}-bit, ` +
          "expected 8-bit RGB (colour type 2)",
      );
    }
    if (hasTransparencyChunk(buffer)) {
      problems.push("PNG carries a tRNS transparency chunk");
    }
  }
  return problems;
}

/**
 * Everything wrong with a captured store set: the screens that failed to
 * render (`screenFailures`, already worded), each file `storePngProblems`
 * refuses, and a count the store won't take. An empty list is the only state
 * in which `capture-mobile.mjs` keeps the folder; anything else deletes it, so
 * a failed run never leaves a set to upload by mistake.
 */
export function storeSetProblems(preset, shots, screenFailures = []) {
  const problems = [...screenFailures];
  for (const { slug, bytes } of shots) {
    for (const problem of storePngProblems(bytes, preset)) {
      problems.push(`${slug}: ${problem}`);
    }
  }
  const limits = preset.countLimits;
  if (limits && (shots.length < limits.min || shots.length > limits.max)) {
    problems.push(
      `${shots.length} screenshots, but ${preset.name} takes ${limits.min} to ${limits.max}`,
    );
  }
  return problems;
}
