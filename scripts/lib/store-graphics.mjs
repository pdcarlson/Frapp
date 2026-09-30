/**
 * The Google Play listing graphics: where they live, how the feature graphic
 * is composed, the shape Play takes, and the audits. `rasterize-brand-assets.mjs`
 * renders both graphics and audits each buffer before writing it;
 * `check-brand-assets.mjs` audits the committed files with the same functions,
 * so the renderer cannot certify a file the gate then rejects.
 *
 *   play-icon-512.png                  the store icon: the master tile, full bleed
 *   play-feature-graphic-1024x500.png  the banner at the top of the listing
 *
 * The owner uploads them in Play Console; nothing here is read by a build.
 *
 * The shapes are Play's, not ours. The icon spec was read in full at
 * developer.android.com/distribute/google-play/resources/icon-design-specifications
 * (last updated 2026-06-15): 512 x 512, 32-bit PNG, sRGB, at most 1024 KB,
 * full square with no rounded corners or shadow, because Play masks the
 * corners at a radius of 30% of the icon size. The feature graphic's 1024 x 500
 * and "JPEG or 24-bit PNG, no alpha" come from Play Console Help, which the
 * cloud sandbox cannot reach, so they rest on search-result snippets of it and
 * on #2555; the console refuses a wrong size at upload, so a wrong rule here
 * fails loudly rather than silently.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FIELD,
  RENDER_AGREEMENT_MIN,
  assertFullyOpaque,
  assertLockedPair,
  census,
  coverageMask,
  maskIou,
} from "./brand-pixels.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repo = (rel) => join(root, rel);

export const STORE_GRAPHICS_DIR = "apps/mobile/store/graphics";
export const PLAY_ICON = `${STORE_GRAPHICS_DIR}/play-icon-512.png`;
export const PLAY_FEATURE_GRAPHIC = `${STORE_GRAPHICS_DIR}/play-feature-graphic-1024x500.png`;

export const PLAY_ICON_SIZE = 512;
export const PLAY_ICON_MAX_BYTES = 1024 * 1024;
/** Play rounds the icon's corners at this fraction of its edge. */
export const PLAY_ICON_MASK_RADIUS = 0.3;

export const FEATURE_WIDTH = 1024;
export const FEATURE_HEIGHT = 500;
/**
 * Nothing but the field may paint within this many pixels of an edge. Play
 * crops the feature graphic's edges and lays the app icon and name over it in
 * some placements, so everything that carries meaning stays in the middle.
 * The number is ours; Play publishes no safe zone we could read.
 */
export const FEATURE_MARGIN = 96;
/**
 * How a committed feature graphic may differ from a fresh render. Renders are
 * hermetic (see `prepareFonts`) and byte-identical on one platform, so these
 * only absorb rounding between sharp builds on different CPUs, which touches
 * a few antialiased edge pixels by a level or two.
 *
 * Two limits, for the two ways a graphic goes stale. A moved or nicked crest,
 * or a changed word, moves a few pixels far: past `FEATURE_RENDER_WORST`. A
 * changed colour token moves every pixel of a word a little: past
 * `FEATURE_RENDER_ROUNDING` on more than `FEATURE_RENDER_DRIFT_MAX` pixels.
 */
export const FEATURE_RENDER_WORST = 16;
export const FEATURE_RENDER_ROUNDING = 2;
export const FEATURE_RENDER_DRIFT_MAX = 256;

const GLYPH_SVG = repo(
  "packages/brand-assets/assets/signet-emblem-B-glyph.svg",
);
const FIGTREE_BOLD = repo("packages/theme/fonts/Figtree-Bold.ttf");
const FIGTREE_REGULAR = repo("packages/theme/fonts/Figtree-Regular.ttf");

export async function decode(buffer) {
  const [{ data, info }, meta] = await Promise.all([
    sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(buffer).metadata(),
  ]);
  return { data, info, meta };
}

/**
 * Glyph mask of a square mark at `size`, for comparing a raster with the
 * vector it came from: 1 where the pixel sits on the gold side of the axis.
 */
export async function vectorMask(input, size) {
  const { data, info } = await sharp(input)
    .resize(size, size, { fit: "fill" })
    .flatten({ background: { ...FIELD, alpha: 1 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return coverageMask(data, info.channels, info.width, info.height);
}

// ── The feature graphic ─────────────────────────────────────────────────────
//
// Its composition is not board-drawn. No reference board draws a store
// banner, so it is assembled from what the repo already ships, and nothing new
// is drawn:
//
//   - The field is the mark's own `#1A1A1A`, the field of the Play icon beside
//     it. Play Console Help asks for a feature graphic that reads as an
//     extension of the icon rather than a second copy of it (read through
//     search-result snippets: support.google.com is blocked from the cloud
//     sandbox), so the crest appears once, small, inside the lockup, and never
//     as the tile.
//   - The lockup is the landing header's (`apps/landing/components/frapp-lockup.tsx`):
//     a 28px crest box, a 12px gap, and "Frapp" at the 18px title size, in
//     `--foreground`, scaled up whole by `SCALE`. The word is set in Figtree
//     Bold, the weight `frapp-lockup.svg` and the social card use: the header's
//     600 is a weight of the variable woff2, and the repo vendors static
//     instances only at 400 and 700. If the header's numbers change, change
//     `HEADER` with them; nothing checks the two agree.
//   - The line beneath is the listing's own short description, "Your chapter,
//     in one place" (`apps/mobile/store/README.md` § Identity), in
//     `--muted-foreground`. Not the brand tagline "Ask your chapter anything":
//     this binary has no Ask screen (#2259), and a listing graphic that
//     promises one describes an app the store is not shipping.
//
// Colours are literals for the reason `apps/landing/app/opengraph-image.tsx`
// gives: there is no stylesheet to resolve a token against. Each is annotated
// with the token it mirrors in `packages/theme/src/signet.css`.

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

/**
 * The family and weight a TrueType file declares: `name` ID 1 (Windows
 * platform) and `OS/2` `usWeightClass`. Throws on anything that is not an
 * sfnt, so a truncated file or an un-pulled LFS pointer fails here rather than
 * leaving Pango to set the text in whatever face it can find.
 */
export function fontFace(buffer, label) {
  const tables = {};
  try {
    const version = buffer.readUInt32BE(0);
    if (version !== 0x00010000 && buffer.toString("latin1", 0, 4) !== "true") {
      throw new Error("not a TrueType file");
    }
    for (let i = 0; i < buffer.readUInt16BE(4); i += 1) {
      const record = 12 + i * 16;
      tables[buffer.toString("latin1", record, record + 4)] =
        buffer.readUInt32BE(record + 8);
    }
    if (tables["OS/2"] === undefined || tables.name === undefined) {
      throw new Error("no OS/2 or name table");
    }
    const weight = buffer.readUInt16BE(tables["OS/2"] + 4);
    const name = tables.name;
    const strings = name + buffer.readUInt16BE(name + 4);
    for (let i = 0; i < buffer.readUInt16BE(name + 2); i += 1) {
      const record = name + 6 + i * 12;
      if (
        buffer.readUInt16BE(record) !== 3 ||
        buffer.readUInt16BE(record + 6) !== 1
      )
        continue;
      const start = strings + buffer.readUInt16BE(record + 10);
      const utf16be = Buffer.from(
        buffer.subarray(start, start + buffer.readUInt16BE(record + 8)),
      );
      return { family: utf16be.swap16().toString("utf16le"), weight };
    }
    throw new Error("no Windows family name");
  } catch (error) {
    throw new Error(`${label}: is not a readable font (${error.message})`);
  }
}

const FACES = [
  { file: FIGTREE_REGULAR, font: "Figtree", weight: 400 },
  { file: FIGTREE_BOLD, font: "Figtree Bold", weight: 700 },
];

async function textRaw(string, fontfile, font) {
  return sharp({ text: { text: string, font, fontfile, rgba: true, dpi: 72 } })
    .raw()
    .toBuffer();
}

/**
 * Make every text render in this process hermetic, or throw. Once per process.
 *
 * Text rasterizes differently under different fontconfig settings: this
 * machine's `/etc/fonts` (hintslight) sets "Frapp" a pixel wider than an empty
 * config does, so a render that depends on the host's config cannot be
 * compared with a committed file. So fontconfig is pointed at a config that
 * knows no system font, and the only faces it sees are the two vendored
 * Figtree files, which also removes any system font to fall back to.
 *
 * Each step closes a way the text could come out in the wrong face silently:
 *
 *   1. Each file must be the face it is named for (`fontFace`): a broken or
 *      swapped file fails here, not as a synthesized or substituted face.
 *   2. Both files are registered before anything is compared. `sharp`
 *      registers a `fontfile` on the render that names it, so a comparison
 *      made before the second face is registered compares against nothing.
 *   3. A family that does not exist must come out exactly as Figtree Regular.
 *      That holds only under the empty config, where Figtree is all there is;
 *      under the host's config it comes out in DejaVu. fontconfig reads
 *      `FONTCONFIG_FILE` once, at its first use in the process, so an earlier
 *      text render anywhere would leave the host's config in force, and this
 *      is what notices.
 *   4. The two faces must set the same string differently.
 *
 * Node writes `process.env` through to the C environment on Linux and macOS;
 * native Windows is not a supported host for this pipeline (WSL is).
 */
let fontsReady;
export function prepareFonts() {
  fontsReady ??= (async () => {
    for (const { file, weight } of FACES) {
      if (!existsSync(file)) {
        throw new Error(
          `missing ${file}: the feature graphic is set in the vendored Figtree`,
        );
      }
      const face = fontFace(readFileSync(file), file);
      if (face.family !== "Figtree" || face.weight !== weight) {
        throw new Error(
          `${file}: declares ${face.family} ${face.weight}, not Figtree ${weight}`,
        );
      }
    }
    const dir = mkdtempSync(join(tmpdir(), "frapp-fonts-"));
    writeFileSync(
      join(dir, "fonts.conf"),
      `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><cachedir>${dir}</cachedir></fontconfig>\n`,
    );
    process.env.FONTCONFIG_FILE = join(dir, "fonts.conf");

    const renders = [];
    for (const { file, font } of FACES)
      renders.push(await textRaw(TAGLINE, file, `${font} 60`));
    const unknown = await textRaw(TAGLINE, FIGTREE_REGULAR, "NoSuchFamily 60");
    const again = await textRaw(TAGLINE, FIGTREE_REGULAR, "Figtree 60");
    if (!unknown.equals(again)) {
      throw new Error(
        "fontconfig is not using the hermetic config: an unknown family did not resolve to Figtree, so something rendered text in this process before prepareFonts() and fontconfig kept the host's fonts",
      );
    }
    if (renders[0].equals(renders[1])) {
      throw new Error(
        "Figtree Regular and Figtree Bold set text identically: one face did not load",
      );
    }
  })();
  return fontsReady;
}

/**
 * Text as an RGBA image cropped to its INK, not its line box: sharp returns
 * Pango's ink rectangle. The layout therefore places ink, which is what the
 * eye aligns, rather than line boxes a browser would.
 */
async function text(string, fontfile, family, px, color) {
  await prepareFonts();
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

/** Renders the feature graphic: 1024 x 500, opaque RGB PNG. */
export async function renderFeatureGraphic() {
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

  // Horizontal: crest box, the header's gap, then the word, centred as a unit
  // on its ink. The crest box keeps its transparent margins, so the gap is the
  // header's.
  const wordLeftInBox = crestBox + gap;
  const lockupWidth = wordLeftInBox + word.width - crestInk.left;
  const originX = Math.round((FEATURE_WIDTH - lockupWidth) / 2) - crestInk.left;

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

// ── Audits ──────────────────────────────────────────────────────────────────

/**
 * The Play icon: the master tile, full bleed, at 512 with an opaque alpha
 * channel ("32-bit PNG"). Throws on the first property it breaks.
 *
 * `masterSvg` is the vector master's bytes. The icon must still be a render of
 * it, the same render-agreement check `check-brand-assets.mjs` runs on the
 * 1024 tile: edit the vector without re-rendering and this fails.
 */
export async function auditPlayIcon(buffer, label, masterSvg) {
  if (buffer.length > PLAY_ICON_MAX_BYTES) {
    throw new Error(
      `${label}: ${buffer.length} bytes, over Play's 1024 KB limit`,
    );
  }
  const { data, info, meta } = await decode(buffer);
  if (meta.format !== "png") {
    throw new Error(`${label}: is ${meta.format}; Play wants a PNG`);
  }
  if (info.width !== PLAY_ICON_SIZE || info.height !== PLAY_ICON_SIZE) {
    throw new Error(
      `${label}: is ${info.width}x${info.height}; Play wants ${PLAY_ICON_SIZE}x${PLAY_ICON_SIZE}`,
    );
  }
  if (meta.channels !== 4) {
    throw new Error(
      `${label}: has ${meta.channels} channels; Play wants a 32-bit (RGBA) PNG`,
    );
  }
  assertFullyOpaque(
    data,
    4,
    label,
    "Play shows its own UI through a transparent icon",
  );
  assertLockedPair(census(data, 4, info.width, info.height, 255), label, {
    edge: info.width,
  });

  // Play masks the corners itself. Nothing of the crest may sit in what the
  // mask removes, or the listing clips the mark.
  const r = PLAY_ICON_MASK_RADIUS * info.width;
  const mask = coverageMask(data, 4, info.width, info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (!mask[y * info.width + x]) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      const cx = Math.min(Math.max(px, r), info.width - r);
      const cy = Math.min(Math.max(py, r), info.height - r);
      if (Math.hypot(px - cx, py - cy) > r) {
        throw new Error(
          `${label}: the crest reaches (${x}, ${y}), inside the corner Play's ${PLAY_ICON_MASK_RADIUS * 100}% radius mask removes`,
        );
      }
    }
  }

  const agreement = maskIou(
    await vectorMask(masterSvg, PLAY_ICON_SIZE),
    await vectorMask(buffer, PLAY_ICON_SIZE),
  );
  if (agreement < RENDER_AGREEMENT_MIN) {
    throw new Error(
      `${label}: agrees with signet-emblem-B.svg on only ${(agreement * 100).toFixed(3)}% of the glyph ` +
        `(floor ${(RENDER_AGREEMENT_MIN * 100).toFixed(1)}%). The vector was edited without re-rendering: run npm run rasterize:brand-assets`,
    );
  }
}

/**
 * The feature graphic's shape: 1024 x 500, no alpha channel at all, and
 * nothing but the mark's field within `FEATURE_MARGIN` of an edge. Its colours
 * are not the locked pair (the word and the line are set in the text tokens),
 * so what it draws is checked by `assertFeatureGraphicCurrent`, not here.
 */
export async function auditFeatureGraphic(buffer, label) {
  const { data, info, meta } = await decode(buffer);
  if (meta.format !== "png") {
    throw new Error(`${label}: is ${meta.format}; this pipeline writes a PNG`);
  }
  if (info.width !== FEATURE_WIDTH || info.height !== FEATURE_HEIGHT) {
    throw new Error(
      `${label}: is ${info.width}x${info.height}; Play wants exactly ${FEATURE_WIDTH}x${FEATURE_HEIGHT}`,
    );
  }
  if (meta.channels !== 3) {
    throw new Error(
      `${label}: has ${meta.channels} channels; Play refuses a feature graphic with an alpha channel`,
    );
  }
  let painted = 0;
  for (let y = 0, i = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1, i += 4) {
      if (
        data[i] === FIELD.r &&
        data[i + 1] === FIELD.g &&
        data[i + 2] === FIELD.b
      ) {
        continue;
      }
      painted += 1;
      const inside =
        x >= FEATURE_MARGIN &&
        x < info.width - FEATURE_MARGIN &&
        y >= FEATURE_MARGIN &&
        y < info.height - FEATURE_MARGIN;
      if (!inside) {
        throw new Error(
          `${label}: paints (${x}, ${y}), within ${FEATURE_MARGIN}px of an edge Play may crop or overlay`,
        );
      }
    }
  }
  if (painted === 0) {
    throw new Error(`${label}: is the bare field; the lockup did not render`);
  }
}

/**
 * The committed feature graphic is what `renderFeatureGraphic` draws today.
 *
 * The one check that sees what the banner SAYS, in which colours, and which
 * crest it carries: a stale crest after a vector edit, a changed word, line or
 * colour token, or a file dropped in by hand. The limits are
 * `FEATURE_RENDER_WORST`, `FEATURE_RENDER_ROUNDING` and
 * `FEATURE_RENDER_DRIFT_MAX`.
 */
export async function assertFeatureGraphicCurrent(buffer, label) {
  const fresh = await sharp(await renderFeatureGraphic())
    .raw()
    .toBuffer();
  const committed = await sharp(buffer).removeAlpha().raw().toBuffer();
  if (fresh.length !== committed.length) {
    throw new Error(`${label}: is not the size a fresh render is`);
  }
  let worst = 0;
  let at = 0;
  let drifted = 0;
  for (let p = 0; p < fresh.length; p += 3) {
    let pixel = 0;
    for (let c = 0; c < 3; c += 1) {
      pixel = Math.max(pixel, Math.abs(fresh[p + c] - committed[p + c]));
    }
    if (pixel > FEATURE_RENDER_ROUNDING) drifted += 1;
    if (pixel > worst) {
      worst = pixel;
      at = p / 3;
    }
  }
  const rerender =
    "The crest, the copy or a colour changed without re-rendering: run npm run rasterize:brand-assets";
  if (worst > FEATURE_RENDER_WORST) {
    throw new Error(
      `${label}: differs from a fresh render by ${worst} levels at (${at % FEATURE_WIDTH}, ${Math.floor(at / FEATURE_WIDTH)}), ` +
        `over the ${FEATURE_RENDER_WORST}-level limit. ${rerender}`,
    );
  }
  if (drifted > FEATURE_RENDER_DRIFT_MAX) {
    throw new Error(
      `${label}: ${drifted} pixels differ from a fresh render by more than ${FEATURE_RENDER_ROUNDING} levels, ` +
        `over the ${FEATURE_RENDER_DRIFT_MAX}-pixel limit. ${rerender}`,
    );
  }
}
