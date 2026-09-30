/**
 * The Google Play listing graphics: where they live, what shape Play takes,
 * and the audits both `scripts/render-store-graphics.mjs` (on the buffer it is
 * about to write) and `scripts/check-brand-assets.mjs` (on the committed file)
 * run, so the renderer cannot certify a file the gate then rejects.
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
import sharp from "sharp";
import {
  FIELD,
  RENDER_AGREEMENT_MIN,
  assertLockedPair,
  census,
  coverageMask,
  maskIou,
} from "./brand-pixels.mjs";

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

async function decode(buffer) {
  const [{ data, info }, meta] = await Promise.all([
    sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(buffer).metadata(),
  ]);
  return { data, info, meta };
}

/** Glyph mask at `size`, for comparing a raster with the vector it came from. */
async function shape(input, size) {
  const { data, info } = await sharp(input)
    .resize(size, size, { fit: "fill" })
    .flatten({ background: { ...FIELD, alpha: 1 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return coverageMask(data, info.channels, info.width, info.height);
}

/**
 * The Play icon: the master tile, full bleed, at 512 with an opaque alpha
 * channel ("32-bit PNG"). Throws on the first property it breaks.
 *
 * `masterSvg` is the vector master's bytes. The icon must still be a render of
 * it, the same staleness `check-brand-assets.mjs` §4 guards for the 1024 tile:
 * edit the vector without re-rendering and this fails.
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
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      throw new Error(
        `${label}: has a pixel ${((data[i] / 255) * 100).toFixed(1)}% opaque. Play shows its own UI through transparency, so the tile must be fully opaque`,
      );
    }
  }
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
      const cx =
        x + 0.5 < r ? r : x + 0.5 > info.width - r ? info.width - r : x + 0.5;
      const cy =
        y + 0.5 < r ? r : y + 0.5 > info.height - r ? info.height - r : y + 0.5;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) {
        throw new Error(
          `${label}: the crest reaches (${x}, ${y}), inside the corner Play's ${PLAY_ICON_MASK_RADIUS * 100}% radius mask removes`,
        );
      }
    }
  }

  const agreement = maskIou(
    await shape(masterSvg, PLAY_ICON_SIZE),
    await shape(buffer, PLAY_ICON_SIZE),
  );
  if (agreement < RENDER_AGREEMENT_MIN) {
    throw new Error(
      `${label}: agrees with signet-emblem-B.svg on only ${(agreement * 100).toFixed(3)}% of the glyph ` +
        `(floor ${(RENDER_AGREEMENT_MIN * 100).toFixed(1)}%). The vector was edited without re-rendering: run npm run render:store-graphics`,
    );
  }
}

/**
 * The feature graphic: 1024 x 500, no alpha channel at all, and nothing but the
 * mark's field within `FEATURE_MARGIN` of an edge.
 *
 * Its colours are NOT the locked pair: the wordmark and the line beneath it are
 * set in the text tokens. So this audits shape and placement, and the field,
 * which is the one colour the whole frame must agree on.
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
      const field =
        data[i] === FIELD.r &&
        data[i + 1] === FIELD.g &&
        data[i + 2] === FIELD.b;
      if (field) continue;
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
