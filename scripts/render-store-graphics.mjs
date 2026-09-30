#!/usr/bin/env node
/**
 * Renders the two Google Play listing graphics into `apps/mobile/store/graphics/`
 * from the locked emblem B vector master and the vendored Figtree. The owner
 * uploads them in Play Console; nothing here is read by a build.
 *
 *   play-icon-512.png               the store icon: the master tile, full bleed
 *   play-feature-graphic-1024x500.png  the banner at the top of the listing
 *
 * Both are generated, like every brand raster (`spec/ui/assets.md` §3): edit the
 * vector or this file, re-run `npm run render:store-graphics`, commit the
 * output. `check:brand-assets` audits the committed files with the same
 * predicates (`scripts/lib/store-graphics.mjs`) this script applies before it
 * writes, so a stale or misshapen graphic fails CI.
 *
 * ── The feature graphic's composition is not board-drawn ────────────────────
 *
 * No reference board draws a store banner, so it is assembled from what the
 * repo already ships, and nothing new is drawn:
 *
 *   - The field is the mark's own `#1A1A1A`, the field of the Play icon beside
 *     it. Play Console Help asks for a feature graphic that reads as an
 *     extension of the icon rather than a second copy of it (read through
 *     search-result snippets: support.google.com is blocked from the cloud
 *     sandbox), so the crest appears once, small, inside the lockup, and never
 *     as the tile.
 *   - The lockup is the landing header's (`apps/landing/components/frapp-lockup.tsx`):
 *     a 28px crest box, a 12px gap, and "Frapp" at the 18px title size, in
 *     `--foreground`. It is scaled up whole by `SCALE`. The word is set in
 *     Figtree Bold, the weight `frapp-lockup.svg` and the social card use: the
 *     header's 600 is a weight of the variable woff2, and the repo vendors
 *     static instances only at 400 and 700. If the header's numbers change,
 *     change `HEADER` with them; nothing checks the two agree.
 *   - The line beneath is the listing's own short description, "Your chapter,
 *     in one place" (`apps/mobile/store/README.md` § Identity), in
 *     `--muted-foreground`. Not the brand tagline "Ask your chapter anything":
 *     this binary has no Ask screen (#2259), and a listing graphic that
 *     promises one describes an app the store is not shipping.
 *
 * Colours are literals for the same reason `apps/landing/app/opengraph-image.tsx`
 * gives: there is no stylesheet to resolve a token against. Each is annotated
 * with the token it mirrors in `packages/theme/src/signet.css`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FIELD } from "./lib/brand-pixels.mjs";
import {
  FEATURE_HEIGHT,
  FEATURE_WIDTH,
  PLAY_FEATURE_GRAPHIC,
  PLAY_ICON,
  PLAY_ICON_SIZE,
  auditFeatureGraphic,
  auditPlayIcon,
} from "./lib/store-graphics.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const repo = (rel) => join(root, rel);

const MASTER_SVG = repo("packages/brand-assets/assets/signet-emblem-B.svg");
const GLYPH_SVG = repo(
  "packages/brand-assets/assets/signet-emblem-B-glyph.svg",
);
const FIGTREE_BOLD = repo("packages/theme/fonts/Figtree-Bold.ttf");
const FIGTREE_REGULAR = repo("packages/theme/fonts/Figtree-Regular.ttf");

const FOREGROUND = "#EDEAE3"; // --foreground
const MUTED_FOREGROUND = "#A9A399"; // --muted-foreground

const TAGLINE = "Your chapter, in one place";

/** The landing header lockup's px values, multiplied by `SCALE`. */
const HEADER = { crest: 28, gap: 12, word: 18 };
const SCALE = 6.5;
/** The line's size as a share of the word's, the social card's 34 / 88. */
const TAGLINE_RATIO = 34 / 88;
/** Space between the lockup's lowest ink and the line's cap height, in word px. */
const TAGLINE_GAP = 0.42;

/** Same supersample the brand rasterizer uses, for the same reason. */
const SUPERSAMPLE = 1024;

/**
 * Text as an RGBA image cropped to its INK, not its line box: sharp returns
 * Pango's ink rectangle. The whole layout below therefore places ink, which is
 * what the eye aligns, rather than line boxes a browser would.
 */
async function text(string, fontfile, family, px, color) {
  const { data: png, info } = await sharp({
    text: {
      text: `<span foreground="${color}">${string}</span>`,
      font: `${family} ${px}`,
      fontfile,
      rgba: true,
      dpi: 72, // 1pt = 1px, so `px` is a pixel size
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png, width: info.width, height: info.height };
}

/**
 * Pango falls back to a system font, silently, when the family does not
 * resolve, and the graphic would ship in DejaVu with every audit green. A
 * family that cannot exist has to lay out differently from Figtree; if it does
 * not, the vendored file never loaded.
 */
async function assertFigtreeLoaded() {
  const figtree = await text(
    "Frapp",
    FIGTREE_BOLD,
    "Figtree Bold",
    100,
    FOREGROUND,
  );
  const fallback = await text(
    "Frapp",
    FIGTREE_BOLD,
    "NoSuchFamily Bold",
    100,
    FOREGROUND,
  );
  if (figtree.width === fallback.width && figtree.height === fallback.height) {
    throw new Error(
      "Figtree did not load: text set in it lays out exactly like text in a family that does not exist, so Pango fell back to a system font",
    );
  }
}

async function playIcon() {
  const hi = await sharp(readFileSync(MASTER_SVG))
    .resize(SUPERSAMPLE, SUPERSAMPLE, { fit: "fill" })
    .png()
    .toBuffer();
  return sharp(hi)
    .resize(PLAY_ICON_SIZE, PLAY_ICON_SIZE, { fit: "fill" })
    .flatten({ background: { ...FIELD, alpha: 1 } })
    .ensureAlpha(1)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function featureGraphic() {
  await assertFigtreeLoaded();

  const crestBox = Math.round(HEADER.crest * SCALE);
  const gap = Math.round(HEADER.gap * SCALE);
  const wordPx = Math.round(HEADER.word * SCALE);
  const taglinePx = Math.round(wordPx * TAGLINE_RATIO);

  // The crest straight from the glyph vector at its final size, as the
  // rasterizer's inset glyph is: a first-generation render, no downscale.
  const crestPng = await sharp(readFileSync(GLYPH_SVG))
    .resize(crestBox, crestBox, { fit: "fill" })
    .png()
    .toBuffer();
  const crest = await sharp(crestPng)
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });
  const crestInk = {
    left: -crest.info.trimOffsetLeft,
    top: -crest.info.trimOffsetTop,
    width: crest.info.width,
    height: crest.info.height,
  };

  const word = await text(
    "Frapp",
    FIGTREE_BOLD,
    "Figtree Bold",
    wordPx,
    FOREGROUND,
  );
  // "F" alone measures the cap height, which places the baseline inside the
  // word's ink: "Frapp" descends below it, so its ink box is not its cap box.
  const capHeight = (
    await text("F", FIGTREE_BOLD, "Figtree Bold", wordPx, FOREGROUND)
  ).height;
  const line = await text(
    TAGLINE,
    FIGTREE_REGULAR,
    "Figtree",
    taglinePx,
    MUTED_FOREGROUND,
  );

  // Horizontal: crest box, the header's gap, then the word, centred as a unit.
  // The crest box keeps its transparent margins so the gap is the header's.
  const wordLeftInBox = crestBox + gap;
  const lockupLeft = crestInk.left; // leftmost ink in box coordinates
  const lockupRight = wordLeftInBox + word.width;
  const lockupWidth = lockupRight - lockupLeft;
  const originX = Math.round((FEATURE_WIDTH - lockupWidth) / 2) - lockupLeft;

  // Vertical: the word's cap height is centred on the crest's ink, the optical
  // centre, not its box (the crest sits low in its box).
  const crestInkMid = crestInk.top + crestInk.height / 2;
  const wordTopInBox = Math.round(crestInkMid - capHeight / 2);
  const lockupTop = Math.min(crestInk.top, wordTopInBox);
  const lockupBottom = Math.max(
    crestInk.top + crestInk.height,
    wordTopInBox + word.height,
  );
  const lineGap = Math.round(wordPx * TAGLINE_GAP);
  const blockHeight = lockupBottom - lockupTop + lineGap + line.height;
  const originY = Math.round((FEATURE_HEIGHT - blockHeight) / 2) - lockupTop;

  return sharp({
    create: {
      width: FEATURE_WIDTH,
      height: FEATURE_HEIGHT,
      channels: 3,
      background: FIELD,
    },
  })
    .composite([
      { input: crestPng, left: originX, top: originY },
      {
        input: word.png,
        left: originX + wordLeftInBox,
        top: originY + wordTopInBox,
      },
      {
        input: line.png,
        left: Math.round((FEATURE_WIDTH - line.width) / 2),
        top: originY + lockupBottom + lineGap,
      },
    ])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function write(rel, buffer) {
  mkdirSync(dirname(repo(rel)), { recursive: true });
  writeFileSync(repo(rel), buffer);
  console.log(`wrote ${rel} (${buffer.length} bytes)`);
}

async function main() {
  const icon = await playIcon();
  await auditPlayIcon(icon, PLAY_ICON, readFileSync(MASTER_SVG));
  write(PLAY_ICON, icon);

  const feature = await featureGraphic();
  await auditFeatureGraphic(feature, PLAY_FEATURE_GRAPHIC);
  write(PLAY_FEATURE_GRAPHIC, feature);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
