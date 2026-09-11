// The locked Signet brand pair, the predicates that make it checkable, and the
// one manifest of which canonical raster is copied where.
//
// One implementation, three consumers, deliberately:
//   * scripts/rasterize-brand-assets.mjs — renders the assets, audits its own output
//   * scripts/sync-brand-assets.mjs      — copies canonical -> app surfaces
//   * scripts/check-brand-assets.mjs     — the CI gate, audits the COMMITTED files
//   (and scripts/ci/__tests__/brand-pixels.test.mjs, which unit-tests all of it)
//
// WHY THIS EXISTS (#2153). The rasterize script used to declare its own private
// `FIELD` and `GOLD` as byte literals — invisible to a `grep DDB844` sweep — and
// classify gold with a radius-90 euclidean ball around that centroid. The gold
// actually shipping sat 42.2 units away: inside the ball, so it worked, with
// ~48 units of unlabelled margin and no test. A re-export that moved the gold
// past 90 would have emitted a silently EMPTY Android monochrome icon, and
// `check:brand-assets` compared sha256 hashes only — it never read a pixel — so
// an all-transparent PNG would have shipped through a green CI.
//
// Meanwhile the master raster was a JPEG-derived letterbox measuring `#DDA220`
// on `#151515`, with `#DDB844` in zero pixels of any committed file, while the
// spec said `#DDB844` on `#1A1A1A`. Nothing could see that either.
//
// So the pair lives here once, and the properties worth enforcing are stated as
// predicates rather than as prose in a spec.
//
// A NOTE ON WHAT "EMPTY" MEANS PER FILE. The three layers that composite onto
// transparency are not the same shape of thing, and one check does not fit them:
//
//   * `adaptive-icon.png` / `splash-icon.png` are an opaque charcoal TILE inset
//     on transparency. Their alpha channel describes the inset square, not the
//     mark — a tile with the crest entirely missing has exactly the same alpha.
//     They are audited on the COLOUR of their visible pixels (`censusVisible`),
//     which is the only thing that can tell a mark from a blank swatch.
//   * `signet-emblem-B-glyph-1024.png` is the crest alone in gold. Its alpha IS
//     the mark, and its visible pixels must be gold and never field.
//   * `adaptive-icon-monochrome.png` is the crest alone in white — deliberately
//     off the brand axis — so only its alpha carries information.

/** `spec/ui/brand-identity.md` §2. Hex strings, so a repo-wide grep finds them. */
export const FIELD_HEX = "#1A1A1A";
export const GOLD_HEX = "#DDB844";

function rgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export const FIELD = rgb(FIELD_HEX);
export const GOLD = rgb(GOLD_HEX);

const AXIS = { r: GOLD.r - FIELD.r, g: GOLD.g - FIELD.g, b: GOLD.b - FIELD.b };
const AXIS_LEN2 = AXIS.r ** 2 + AXIS.g ** 2 + AXIS.b ** 2;

/**
 * Where a pixel sits on the field -> gold axis. A two-colour mark drawn with
 * antialiasing puts every pixel on that segment, so this IS the pixel's glyph
 * coverage: 0 field, 1 gold, 0.5 the half-covered edge.
 *
 * This replaces the radius-90 ball. It is scale-free — it does not care how far
 * apart the two brand colours sit — so unlike a fixed radius it cannot silently
 * stop matching when the brand moves.
 */
export function coverage(r, g, b) {
  return (
    ((r - FIELD.r) * AXIS.r + (g - FIELD.g) * AXIS.g + (b - FIELD.b) * AXIS.b) /
    AXIS_LEN2
  );
}

/**
 * Perpendicular distance from that axis. Zero for any blend of the two brand
 * colours; large for anything else — a third colour, a gradient, or the chroma
 * smear a JPEG round-trip leaves behind.
 */
export function offAxis(r, g, b) {
  const t = coverage(r, g, b);
  const dr = r - (FIELD.r + AXIS.r * t);
  const dg = g - (FIELD.g + AXIS.g * t);
  const db = b - (FIELD.b + AXIS.b * t);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Antialiasing lands pixels ON the axis, so this only has to absorb 8-bit
 * rounding, which is bounded whatever the renderer: the widest any committed
 * raster strays is 1.52. The pre-#2153 JPEG tile peaked at 50.17.
 *
 * The ceiling is 3 rather than something looser because the artifact FIELD, not
 * just the artifact gold, has to fall outside it. `#DDA220` sits 37.36 off-axis
 * and would fail any plausible limit; `#151515` sits only 3.84 off, so a limit
 * of 6 would have admitted a re-export flattened onto the old field.
 */
export const OFF_AXIS_MAX = 3;

/**
 * Share of visible pixels that must be EXACTLY one of the two locked hexes,
 * for a raster big enough that antialiasing is not most of it.
 *
 * Presence alone is too weak on its own: a raster flattened onto the old
 * `#151515` passes a "has at least one `#1A1A1A` pixel" test as long as a
 * single exact pixel survives anywhere in the frame. Measured, this separates
 * cleanly — the committed 180² scores 90.4% and the 1024² scores 99.6%, while
 * the pre-#2153 JPEG tile scores 0.0025%.
 */
export const EXACT_PAIR_MIN = 0.5;
export const EXACT_PAIR_MIN_EDGE = 128;

/** Alpha at or above this counts as a visible pixel. */
const ALPHA_VISIBLE = 128;

/**
 * Pixel census over pixels with alpha >= `alphaMin`, so it reads an opaque
 * raster and a layer composited on transparency the same way. `channels` of 3
 * means every pixel is visible.
 *
 * COLOUR CLAIMS USE `alphaMin: 255`. A partially transparent pixel's RGB is an
 * artifact of the premultiply/unpremultiply round-trip, not of the artwork: on
 * the inset crest the worst such pixel sits 4.11 units off the brand axis while
 * the worst fully opaque one sits at 0. Auditing the fringe would be auditing
 * sharp's rounding. Coverage claims still use the default, because there the
 * question is which pixels are visible at all.
 */
export function census(data, channels, width, height, alphaMin = ALPHA_VISIBLE) {
  let visible = 0;
  let field = 0;
  let gold = 0;
  let worstOffAxis = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (channels > 3 && data[i + 3] < alphaMin) continue;
    visible += 1;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r === GOLD.r && g === GOLD.g && b === GOLD.b) gold += 1;
    else if (r === FIELD.r && g === FIELD.g && b === FIELD.b) field += 1;
    const d = offAxis(r, g, b);
    if (d > worstOffAxis) worstOffAxis = d;
  }
  return { total: width * height, visible, field, gold, worstOffAxis };
}

/**
 * The assertion the exporter and the CI gate both run.
 *
 * Small rasters (a 16px favicon) legitimately have few exact-hex pixels once
 * antialiasing dominates, so this requires presence rather than a share —
 * "zero" is the failure that matters, and it is exactly what every committed
 * file scored before #2153.
 *
 * `requireField` is false for the gold-on-transparent crest, which has no field
 * by construction; asserting one there would be asserting a bug.
 */
export function assertLockedPair(stats, label, { requireField = true, edge = 0 } = {}) {
  if (stats.visible === 0) {
    throw new Error(`${label}: has no visible pixels at all (#2153)`);
  }
  if (stats.gold === 0) {
    throw new Error(`${label}: contains zero ${GOLD_HEX} pixels (#2153)`);
  }
  if (requireField && stats.field === 0) {
    throw new Error(`${label}: contains zero ${FIELD_HEX} pixels (#2153)`);
  }
  if (!requireField && stats.field > 0) {
    throw new Error(
      `${label}: is the crest alone and must carry no ${FIELD_HEX} field, but ${stats.field} pixels are field — it was keyed out of the tile rather than rendered on transparency`,
    );
  }
  if (stats.worstOffAxis > OFF_AXIS_MAX) {
    throw new Error(
      `${label}: a pixel sits ${stats.worstOffAxis.toFixed(1)} units off the ` +
        `${FIELD_HEX} -> ${GOLD_HEX} axis (limit ${OFF_AXIS_MAX}) — the mark is not drawn ` +
        `in the locked pair; a JPEG round-trip looks exactly like this (#2153)`,
    );
  }
  if (edge >= EXACT_PAIR_MIN_EDGE) {
    const exact = (stats.field + stats.gold) / stats.visible;
    if (exact < EXACT_PAIR_MIN) {
      throw new Error(
        `${label}: only ${(exact * 100).toFixed(2)}% of visible pixels are exactly ` +
          `${FIELD_HEX} or ${GOLD_HEX} (floor ${(EXACT_PAIR_MIN * 100).toFixed(0)}%) — ` +
          `a near-miss re-export or a lossy round-trip looks exactly like this (#2153)`,
      );
    }
  }
  return stats;
}

/**
 * Bounds for a layer whose ALPHA is the mark — the white monochrome crest, and
 * the gold crest on transparency. Full bleed the crest covers ~24% of its
 * canvas; inset 17% for an Android launcher mask it covers ~11%. The band spans
 * both and still cannot admit the two failures worth catching: an all
 * transparent layer and a solid slab.
 *
 * Deliberately NOT applied to `adaptive-icon.png` / `splash-icon.png`: their
 * alpha is an inset square, so it measures the same whether the crest is there
 * or not. See the note at the top of this file.
 */
export const GLYPH_COVERAGE_MIN = 0.04;
export const GLYPH_COVERAGE_MAX = 0.6;

export function assertGlyphCoverage(fraction, label) {
  if (!(fraction >= GLYPH_COVERAGE_MIN) || !(fraction <= GLYPH_COVERAGE_MAX)) {
    throw new Error(
      `${label}: glyph covers ${(fraction * 100).toFixed(2)}% of the layer, outside the ` +
        `${(GLYPH_COVERAGE_MIN * 100).toFixed(0)}-${(GLYPH_COVERAGE_MAX * 100).toFixed(0)}% band — ` +
        `an empty or solid glyph layer must never ship (#2153)`,
    );
  }
}

/** Share of a layer whose pixels are visible. */
export function glyphCoverage(data, channels, width, height) {
  if (channels <= 3) return 1;
  let covered = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (data[i + 3] >= ALPHA_VISIBLE) covered += 1;
  }
  return covered / (width * height);
}

/**
 * Bounds for the inset opaque tile behind an Android launcher mask. 17% inset
 * each side is (1 - 0.34)² = 43.6% of the canvas; the band allows the inset to
 * be retuned without allowing a full-bleed or a vanished tile.
 */
export const INSET_TILE_MIN = 0.25;
export const INSET_TILE_MAX = 0.75;

export function assertInsetTile(fraction, label) {
  if (!(fraction >= INSET_TILE_MIN) || !(fraction <= INSET_TILE_MAX)) {
    throw new Error(
      `${label}: opaque tile covers ${(fraction * 100).toFixed(2)}% of the canvas, outside the ` +
        `${(INSET_TILE_MIN * 100).toFixed(0)}-${(INSET_TILE_MAX * 100).toFixed(0)}% band — ` +
        `the glyph must stay inside the 66% launcher safe zone (spec/ui/assets.md §7)`,
    );
  }
}

/**
 * The locked pair, asserted against the SVG source rather than the pixels.
 *
 * Every shipped SVG goes through this, not just the two the rasters render
 * from: `signet-emblem-B-rounded.svg` and `frapp-lockup.svg` are `@repo/brand-assets`
 * exports that reach consumers directly, and the raster checks are structurally
 * blind to them. The staleness check cannot cover it either — it compares
 * glyph masks, so it is colour-blind by construction.
 */
export function assertSvgLocked(svg, label, { requireField = true } = {}) {
  // Every 6-digit hex anywhere in the file, not just `fill="…"`. A colour set
  // through `style="fill:#FF0000"`, a `stroke`, or a gradient stop is just as
  // shipped, and the raster gates cannot see any of them: the staleness check
  // compares glyph MASKS, so it is colour-blind by construction — recolouring
  // the master's gold to the house accent still scores 99.97% agreement.
  const colours = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) =>
    m[0].toUpperCase(),
  );
  for (const fn of ["rgb(", "rgba(", "hsl(", "hsla("]) {
    if (svg.includes(fn)) {
      throw new Error(
        `${label}: uses ${fn}…) — brand colours must be written as the locked hex literals so they are greppable and checkable`,
      );
    }
  }
  const unexpected = [...new Set(colours)].filter(
    (f) => f !== FIELD_HEX && f !== GOLD_HEX,
  );
  if (unexpected.length > 0) {
    throw new Error(
      `${label}: paints ${unexpected.join(", ")}; the locked pair is ` +
        `${FIELD_HEX} / ${GOLD_HEX} (spec/ui/brand-identity.md §2)`,
    );
  }
  for (const required of requireField ? [FIELD_HEX, GOLD_HEX] : [GOLD_HEX]) {
    if (!colours.includes(required)) {
      throw new Error(`${label}: never paints ${required}`);
    }
  }
  // The invariant is the COORDINATE SCALE AND ORIGIN, not the viewBox string:
  // the lockup is `0 0 3360 1024` because it holds a wordmark beside the tile.
  // What every file must share is the origin and the 1024-unit height, because
  // that is what lets the same `d` be copied between them verbatim.
  const viewBox = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) 1024"/);
  if (!viewBox) {
    throw new Error(
      `${label}: must keep a "0 0 <width> 1024" viewBox — the shared path data is written in that frame, and rescaling it silently reframes the crest`,
    );
  }

  // And the intrinsic size must carry the viewBox's aspect. Nothing downstream
  // can catch a mismatch: the rasters are rendered with `fit: "fill"`, and the
  // staleness check pushes the SVG through that SAME resize before comparing,
  // so a `width="2048" height="1024"` on a square viewBox renders every icon
  // horizontally stretched while reporting 100% agreement with itself.
  const box = svg.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"/);
  if (!box) {
    throw new Error(`${label}: must declare intrinsic width and height`);
  }
  const declared = Number(box[1]) / Number(box[2]);
  const intended = Number(viewBox[1]) / 1024;
  if (Math.abs(declared - intended) > 1e-6) {
    throw new Error(
      `${label}: intrinsic ${box[1]}x${box[2]} (aspect ${declared.toFixed(4)}) does not match its ` +
        `viewBox aspect ${intended.toFixed(4)} — every raster would render distorted, and the ` +
        `staleness check distorts both sides identically so it cannot see it`,
    );
  }
}

/**
 * Agreement between two glyph masks, as intersection-over-union.
 *
 * Used to prove the committed rasters are still a render of the committed SVG.
 * Byte equality is the wrong test — a different libvips/librsvg build moves
 * antialiased edges by a fraction of a pixel — but a real geometry edit moves
 * them by whole pixels. On the 1024² master, an in-sync pair scores 100.000%
 * and a 2px path shift scores 97.86%, so the threshold below has three orders
 * of magnitude of headroom over renderer noise.
 */
export const RENDER_AGREEMENT_MIN = 0.995;

export function maskIou(a, b) {
  if (a.length !== b.length) {
    throw new Error(`mask size mismatch: ${a.length} vs ${b.length}`);
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) intersection += 1;
    if (a[i] || b[i]) union += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

/** Glyph mask of an opaque raster: 1 where the pixel is on the gold side. */
export function coverageMask(data, channels, width, height) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += channels, p += 1) {
    mask[p] = coverage(data[i], data[i + 1], data[i + 2]) >= 0.5 ? 1 : 0;
  }
  return mask;
}

/**
 * The canonical -> synced manifest, in one place.
 *
 * `sync-brand-assets.mjs` copies along it and `check-brand-assets.mjs` asserts
 * parity along it. They were two hand-kept lists; adding a destination to the
 * copier and forgetting the gate would have exempted that file from parity
 * forever, and the failure is silent in exactly that direction.
 */
export const SYNCED = [
  {
    canonical: "packages/brand-assets/assets/signet-emblem-B-32.png",
    targets: ["apps/landing/app/icon.png", "apps/web/app/icon.png"],
  },
  {
    canonical: "packages/brand-assets/assets/signet-emblem-B-180.png",
    targets: ["apps/landing/app/apple-icon.png", "apps/web/app/apple-icon.png"],
  },
  {
    canonical: "packages/brand-assets/assets/signet-emblem-B-1024.png",
    targets: [
      "apps/landing/public/brand/signet-emblem-B.png",
      "apps/web/public/brand/signet-emblem-B.png",
      "apps/landing/app/opengraph-emblem.png",
    ],
  },
];
