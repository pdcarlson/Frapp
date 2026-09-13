// Guards the executable half of #2153.
//
// The issue's own "do not miss it" entry: `scripts/rasterize-brand-assets.mjs`
// carried a private copy of the brand pair and extracted the Android monochrome
// glyph with a `dr²+dg²+db² < 90²` ball around its gold centroid. The gold that
// actually shipped sat 42.2 units from that centroid — inside the ball, so it
// worked, with ~48 units of unlabelled margin. A re-export that pushed the gold
// past 90 would have produced a silently EMPTY `adaptive-icon-monochrome.png`,
// and `check:brand-assets` compared sha256 hashes only, so the empty PNG would
// have shipped through a green CI. The script had no test at all.
//
// WHY THIS SUITE DECODES NO IMAGES. The `ci-scripts-tests` job runs
// `npm run test:ci-scripts` with NO `npm ci` — deliberately, so the deploy-gate
// tests stay a fast standalone job ("these tests have no dependencies beyond
// node:test"). A single `import sharp` here would turn every run of that job
// red with ERR_MODULE_NOT_FOUND. So the predicates are tested against synthetic
// buffers, and the assertions that must decode committed PNGs live in
// `check:brand-assets`, which runs in `lint-and-typecheck` after `npm ci`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXACT_PAIR_MIN,
  FIELD,
  FIELD_HEX,
  GLYPH_COVERAGE_MAX,
  GLYPH_COVERAGE_MIN,
  GOLD,
  GOLD_HEX,
  ICO_SIZES,
  OFF_AXIS_MAX,
  RENDER_AGREEMENT_MIN,
  SYNCED,
  assertGlyphCoverage,
  assertIcoShape,
  assertLockedPair,
  assertSvgLocked,
  buildIco,
  census,
  coverage,
  coverageMask,
  glyphCoverage,
  maskIou,
  offAxis,
  pngHeader,
  readIco,
} from "../../lib/brand-pixels.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repo = (rel) => join(REPO_ROOT, rel);
const ASSETS = repo("packages/brand-assets/assets");

/** The pair the pre-#2153 rasters actually measured: JPEG artifacts. */
const JPEG_GOLD = { r: 0xdd, g: 0xa2, b: 0x20 };
const JPEG_FIELD = { r: 0x15, g: 0x15, b: 0x15 };

const euclidean = (a, b) =>
  Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

/** An RGBA buffer of one repeated colour, `visible` of them opaque. */
function rgba(pixels) {
  const buf = Buffer.alloc(pixels.length * 4);
  pixels.forEach((p, i) => {
    buf[i * 4] = p.r;
    buf[i * 4 + 1] = p.g;
    buf[i * 4 + 2] = p.b;
    buf[i * 4 + 3] = p.a ?? 255;
  });
  return buf;
}

const fill = (n, p) => Array.from({ length: n }, () => p);

// ── the lock itself ─────────────────────────────────────────────────────────

test("the locked pair is the pair the spec states", () => {
  assert.equal(FIELD_HEX, "#1A1A1A");
  assert.equal(GOLD_HEX, "#DDB844");
  assert.deepEqual(FIELD, { r: 0x1a, g: 0x1a, b: 0x1a });
  assert.deepEqual(GOLD, { r: 0xdd, g: 0xb8, b: 0x44 });
});

test("the spec'd gold and the JPEG gold are not a rounding difference", () => {
  // 42.2 units apart, which is what let the radius-90 ball pass them both and
  // hid the mismatch for the life of the asset.
  assert.ok(Math.abs(euclidean(GOLD, JPEG_GOLD) - 42.19) < 0.01);
});

// ── coverage(): the classifier that replaced the ball ───────────────────────

test("coverage is 0 on the field, 1 on the gold, 0.5 at the antialiased midpoint", () => {
  assert.equal(coverage(FIELD.r, FIELD.g, FIELD.b), 0);
  assert.equal(coverage(GOLD.r, GOLD.g, GOLD.b), 1);
  const mid = (a, b) => (a + b) / 2;
  assert.ok(
    Math.abs(
      coverage(
        mid(FIELD.r, GOLD.r),
        mid(FIELD.g, GOLD.g),
        mid(FIELD.b, GOLD.b),
      ) - 0.5,
    ) < 1e-12,
  );
});

test("coverage stays scale-free — an arbitrarily distant gold still classifies", () => {
  // THE REGRESSION. A gold far outside the old radius-90 ball: the ball drops
  // it (an empty monochrome layer), coverage() does not.
  const moved = { r: 0xff, g: 0xe0, b: 0xa0 };
  assert.ok(euclidean(GOLD, moved) > 90, "fixture must sit outside the old ball");

  const ballSaysGold =
    (moved.r - GOLD.r) ** 2 + (moved.g - GOLD.g) ** 2 + (moved.b - GOLD.b) ** 2 <
    90 * 90;
  assert.equal(ballSaysGold, false);
  assert.ok(coverage(moved.r, moved.g, moved.b) >= 0.5);
});

test("coverage classifies the ramp by half-coverage, not by distance", () => {
  const at = (t) =>
    coverage(
      FIELD.r + (GOLD.r - FIELD.r) * t,
      FIELD.g + (GOLD.g - FIELD.g) * t,
      FIELD.b + (GOLD.b - FIELD.b) * t,
    );
  assert.ok(at(0.49) < 0.5);
  assert.ok(at(0.51) >= 0.5);
});

// ── offAxis(): "is this drawn in the locked pair at all" ────────────────────

test("every blend of the locked pair is on the axis", () => {
  for (let i = 0; i <= 20; i += 1) {
    const t = i / 20;
    const d = offAxis(
      FIELD.r + (GOLD.r - FIELD.r) * t,
      FIELD.g + (GOLD.g - FIELD.g) * t,
      FIELD.b + (GOLD.b - FIELD.b) * t,
    );
    assert.ok(d < 1e-9, `t=${t} should be on-axis, got ${d}`);
  }
});

test("BOTH halves of the JPEG pair are off-axis by more than the tolerance", () => {
  // The gold fails any plausible limit (37.36). The FIELD is the one that
  // constrains OFF_AXIS_MAX: at 3.84 it would have passed the original limit
  // of 6, so a re-export flattened onto the old field could have shipped.
  assert.ok(offAxis(JPEG_GOLD.r, JPEG_GOLD.g, JPEG_GOLD.b) > OFF_AXIS_MAX);
  assert.ok(
    offAxis(JPEG_FIELD.r, JPEG_FIELD.g, JPEG_FIELD.b) > OFF_AXIS_MAX,
    `#151515 sits ${offAxis(0x15, 0x15, 0x15).toFixed(2)} off-axis and must be rejected`,
  );
});

test("assertLockedPair rejects zero gold, zero field, and off-axis paint", () => {
  const ok = { total: 100, visible: 100, field: 70, gold: 30, worstOffAxis: 0.9 };
  assert.doesNotThrow(() => assertLockedPair(ok, "fixture"));
  assert.throws(() => assertLockedPair({ ...ok, gold: 0 }, "f"), /zero #DDB844/);
  assert.throws(() => assertLockedPair({ ...ok, field: 0 }, "f"), /zero #1A1A1A/);
  assert.throws(() => assertLockedPair({ ...ok, visible: 0 }, "f"), /no visible pixels/);
  assert.throws(
    () => assertLockedPair({ ...ok, worstOffAxis: OFF_AXIS_MAX + 0.1 }, "f"),
    /off the #1A1A1A -> #DDB844 axis/,
  );
});

test("a crest-alone layer must carry no field at all", () => {
  // The guard that makes an opaque-tile regression visible on adaptive-icon.png
  // and splash-icon.png. Those two used to composite a charcoal square, whose
  // alpha measured identically whether the crest was there or not.
  const crest = { total: 10, visible: 10, field: 0, gold: 10, worstOffAxis: 0 };
  assert.doesNotThrow(() =>
    assertLockedPair(crest, "glyph", { requireField: false }),
  );
  assert.throws(
    () => assertLockedPair({ ...crest, field: 4 }, "glyph", { requireField: false }),
    /must carry no #1A1A1A field/,
  );
});

test("a near-miss re-export fails the exact-pair floor even with one true pixel", () => {
  // #151515 is only 3.84 off-axis, so presence-only checks let it through as
  // long as a single exact #1A1A1A pixel survives anywhere in the frame.
  const pixels = [
    ...fill(900, JPEG_FIELD),
    ...fill(99, GOLD),
    { ...FIELD },
  ];
  const stats = census(rgba(pixels), 4, 1000, 1);
  assert.equal(stats.field, 1);
  assert.ok(stats.gold > 0);
  assert.throws(
    () => assertLockedPair(stats, "near-miss.png", { edge: 1000 }),
    /off the #1A1A1A -> #DDB844 axis|exactly #1A1A1A or #DDB844/,
  );
  // …and a clean raster of the same size passes.
  const clean = census(rgba([...fill(760, FIELD), ...fill(240, GOLD)]), 4, 1000, 1);
  assert.doesNotThrow(() => assertLockedPair(clean, "clean.png", { edge: 1000 }));
  assert.ok(EXACT_PAIR_MIN > 0 && EXACT_PAIR_MIN < 1);
});

test("census claims colour only over the alpha it is given", () => {
  const pixels = [
    ...fill(5, { ...GOLD, a: 255 }),
    ...fill(5, { r: 0, g: 255, b: 0, a: 200 }), // a wildly off-axis fringe
  ];
  const buf = rgba(pixels);
  assert.equal(census(buf, 4, 10, 1, 255).visible, 5);
  assert.ok(census(buf, 4, 10, 1, 255).worstOffAxis < 1e-9);
  assert.equal(census(buf, 4, 10, 1, 128).visible, 10);
  assert.ok(census(buf, 4, 10, 1, 128).worstOffAxis > 100);
});

// ── glyph coverage: the empty-layer guard ───────────────────────────────────

test("assertGlyphCoverage rejects an empty layer and a solid slab", () => {
  assert.throws(() => assertGlyphCoverage(0, "empty.png"), /must never ship/);
  assert.throws(() => assertGlyphCoverage(1, "solid.png"), /must never ship/);
  assert.throws(() => assertGlyphCoverage(NaN, "nan.png"), /must never ship/);
  // The full-bleed crest (~24%) and the 17%-inset crest (~11%) both pass.
  assert.doesNotThrow(() => assertGlyphCoverage(0.2433, "glyph.png"));
  assert.doesNotThrow(() => assertGlyphCoverage(0.106, "inset.png"));
  assert.ok(GLYPH_COVERAGE_MIN > 0 && GLYPH_COVERAGE_MAX < 1);
});

test("glyphCoverage counts visible pixels", () => {
  const buf = rgba([
    { ...GOLD, a: 255 },
    { ...GOLD, a: 255 },
    { r: 0, g: 0, b: 0, a: 0 },
    { r: 0, g: 0, b: 0, a: 0 },
  ]);
  assert.equal(glyphCoverage(buf, 4, 2, 2), 0.5);
  assert.equal(glyphCoverage(Buffer.alloc(12), 3, 2, 2), 1);
});

// ── the staleness mask ──────────────────────────────────────────────────────

test("maskIou is 1 on agreement and falls off with real drift", () => {
  const a = Uint8Array.from([1, 1, 0, 0]);
  assert.equal(maskIou(a, Uint8Array.from([1, 1, 0, 0])), 1);
  assert.equal(maskIou(a, Uint8Array.from([1, 0, 0, 0])), 0.5);
  assert.equal(maskIou(Uint8Array.from([0, 0]), Uint8Array.from([0, 0])), 1);
  assert.throws(() => maskIou(a, Uint8Array.from([1])), /size mismatch/);
  assert.ok(RENDER_AGREEMENT_MIN > 0.9 && RENDER_AGREEMENT_MIN < 1);
});

test("coverageMask splits on the antialiasing midpoint", () => {
  const buf = rgba([FIELD, GOLD, FIELD, GOLD]);
  assert.deepEqual([...coverageMask(buf, 4, 2, 2)], [0, 1, 0, 1]);
});

// ── the committed vectors (text only — no decode) ───────────────────────────

test("every shipped vector paints only the locked pair", () => {
  for (const name of [
    "signet-emblem-B.svg",
    "signet-emblem-B-rounded.svg",
    "frapp-lockup.svg",
  ]) {
    assertSvgLocked(readFileSync(join(ASSETS, name), "utf8"), name);
  }
  assertSvgLocked(
    readFileSync(join(ASSETS, "signet-emblem-B-glyph.svg"), "utf8"),
    "signet-emblem-B-glyph.svg",
    { requireField: false },
  );
});

test("assertSvgLocked catches the three ways a vector goes off-brand", () => {
  const svg = readFileSync(join(ASSETS, "signet-emblem-B.svg"), "utf8");
  assert.throws(
    () => assertSvgLocked(svg.replace('fill="#DDB844"', 'fill="#EFB63B"'), "x"),
    /paints #EFB63B/,
    "the house accent is the confusion brand-identity.md §2 warns about",
  );
  assert.throws(
    () =>
      assertSvgLocked(
        svg.replace('fill="#DDB844"', 'fill="#DDB844" style="fill:#FF0000"'),
        "x",
      ),
    /paints #FF0000/,
    "a style= override ships just as hard as a fill attribute",
  );
  assert.throws(
    () => assertSvgLocked(svg.replace('width="1024" height="1024"', 'width="2048" height="1024"'), "x"),
    /does not match its viewBox aspect/,
    "fit:fill would render every raster stretched, and the staleness check distorts both sides identically",
  );
});

test("every brand SVG reuses the master geometry verbatim", () => {
  // All four are written in the same 1024-tall coordinate frame — the lockup is
  // 3360 wide because it holds a wordmark — so the same `d` copies between them.
  // A rewritten path in one file is drift, which is how the superseded SVG came
  // to draw a different mark from the raster in the first place (#2153).
  const pathOf = (name) =>
    readFileSync(join(ASSETS, name), "utf8")
      .match(/ d="([^"]+)"/)[1]
      .replace(/\s+/g, " ")
      .trim();
  const master = pathOf("signet-emblem-B.svg");
  assert.ok(master.length > 500, "the master path should be the real crest");
  for (const name of [
    "signet-emblem-B-glyph.svg",
    "signet-emblem-B-rounded.svg",
    "frapp-lockup.svg",
  ]) {
    assert.equal(pathOf(name), master, `${name} drew a different mark`);
  }
});

// ── the package ─────────────────────────────────────────────────────────────

test("every canonical asset follows the package naming scheme", () => {
  // #2153 left the package carrying five naming styles for one mark
  // (`signet-emblem-B-*`, `app-icon`, `apple-icon`, `icon`, `favicon-*`), which
  // is how a "superseded" SVG and the shipping raster sat side by side without
  // anyone noticing they drew different artwork. One scheme, asserted.
  // The `.ico` carries no `-<size>`: it is a container of three sizes, so any
  // one of them in its name would be a lie. `readIco` is what states its
  // contents, and `check:brand-assets` asserts them.
  const CANONICAL = /^signet-emblem-B(-glyph)?(-(?:16|32|48|96|180|512|1024))?\.(svg|png|ico)$/;
  const VARIANT = /^signet-emblem-B-(glyph|rounded)\.svg$/;
  // `frapp-*` filenames are frozen by spec/ui/assets.md §1 ("frapp-* filenames
  // … stay as-is in code"), so the lockup keeps its name. It is the only
  // exception, and it is named here rather than left to be rediscovered.
  const FROZEN = new Set(["frapp-lockup.svg"]);
  const offenders = readdirSync(ASSETS).filter(
    (name) => !FROZEN.has(name) && !CANONICAL.test(name) && !VARIANT.test(name),
  );
  assert.deepEqual(
    offenders,
    [],
    "assets must be named signet-emblem-B[-glyph|-rounded][-<size>].<ext>",
  );
});

test("the sync manifest names files that exist, and the package exports them", () => {
  // One manifest, two consumers. They were two hand-kept lists: adding a
  // destination to the copier and forgetting the gate exempted that file from
  // parity forever, and the failure is silent in exactly that direction.
  const exports = JSON.parse(
    readFileSync(repo("packages/brand-assets/package.json"), "utf8"),
  ).exports;
  for (const { canonical, targets } of SYNCED) {
    assert.ok(existsSync(repo(canonical)), `${canonical} is missing`);
    assert.ok(targets.length > 0);
    for (const dest of targets) {
      assert.ok(existsSync(repo(dest)), `${dest} is missing`);
    }
  }
  for (const target of Object.values(exports)) {
    const rel = join("packages/brand-assets", target);
    assert.ok(existsSync(repo(rel)), `exports maps missing file ${target}`);
  }
});

// ── the favicon container ───────────────────────────────────────────────────
//
// `apps/web/app/favicon.ico` was the one brand surface with no generator and no
// gate: it shipped Next's scaffold icon through green CI for as long as it
// existed, because it appeared in neither the sync manifest nor any roster in
// `check-brand-assets.mjs`.
//
// These stay decode-free like the rest of the suite — `pngHeader` reads the
// `IHDR` field by field, so a hand-built 26-byte header is a PNG as far as the
// container code is concerned, and the assertions that must read real pixels
// live in `check:brand-assets`.

/**
 * The smallest buffer `pngHeader` accepts, with a distinguishing tail byte.
 * Defaults to RGBA because that is what a real favicon payload must be —
 * Turbopack's ICO decoder rejects anything else and fails the web build.
 */
function fakePng(size, { colourType = 6, tail = 0 } = {}) {
  const png = Buffer.alloc(27);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(size, 16);
  png.writeUInt32BE(size, 20);
  png[24] = 8; // bit depth
  png[25] = colourType;
  png[26] = tail;
  return png;
}

test("pngHeader reads IHDR and rejects anything that is not a PNG", () => {
  assert.deepEqual(pngHeader(fakePng(48)), {
    width: 48,
    height: 48,
    colourType: 6,
  });
  assert.equal(pngHeader(Buffer.alloc(64)), null);
  assert.equal(pngHeader(Buffer.alloc(4)), null, "a truncated buffer is not a PNG");
});

test("buildIco round-trips through readIco", () => {
  const payloads = ICO_SIZES.map((size) => fakePng(size, { tail: size }));
  const entries = readIco(buildIco(payloads), "round-trip.ico");
  assert.deepEqual(
    entries.map((entry) => entry.width),
    ICO_SIZES,
  );
  entries.forEach((entry, index) => {
    assert.equal(entry.height, ICO_SIZES[index]);
    assert.ok(entry.payload.equals(payloads[index]), "payload survives packing");
  });
});

test("buildIco derives every directory field from the payload itself", () => {
  // A caller cannot hand this function a size that disagrees with the image,
  // because it is never asked for one — which is the failure `lying-entry`
  // below has to be constructed by hand to produce.
  const ico = buildIco([fakePng(256, { colourType: 2 }), fakePng(16)]);
  assert.equal(ico[6], 0, "256 is written as 0 — the one size that is not a byte");
  assert.equal(ico.readUInt16LE(6 + 6), 24, "truecolour RGB is 24bpp");
  assert.equal(ico.readUInt16LE(6 + 16 + 6), 32, "truecolour with alpha is 32bpp");
});

test("buildIco refuses an image an ICONDIRENTRY cannot describe", () => {
  assert.throws(() => buildIco([]), /at least one image/);
  assert.throws(() => buildIco([Buffer.alloc(64)]), /is not a PNG/);
  assert.throws(() => buildIco([fakePng(512)]), /256 is the ceiling/);
});

test("readIco refuses every container shape that hides its contents", () => {
  const good = buildIco(ICO_SIZES.map((size) => fakePng(size)));

  assert.throws(() => readIco(Buffer.alloc(2), "x.ico"), /too short/);

  const cursor = Buffer.from(good);
  cursor.writeUInt16LE(2, 2);
  assert.throws(() => readIco(cursor, "x.ico"), /resource type 2/);

  const empty = Buffer.from(good);
  empty.writeUInt16LE(0, 4);
  assert.throws(() => readIco(empty, "x.ico"), /zero images/);

  const overlong = Buffer.from(good);
  overlong.writeUInt16LE(999, 4);
  assert.throws(() => readIco(overlong, "x.ico"), /directory runs past the end/);

  const offFile = Buffer.from(good);
  offFile.writeUInt32LE(good.length + 1, 6 + 12);
  assert.throws(() => readIco(offFile, "x.ico"), /not inside the file/);

  // A payload sharp cannot open is a payload nothing in this repo can audit,
  // and it is literally where the scaffold favicon's 16/32/48 images lived.
  const dib = Buffer.from(good);
  dib.writeUInt32BE(0x28000000, good.readUInt32LE(6 + 12));
  assert.throws(() => readIco(dib, "x.ico"), /not a PNG payload/);

  // A browser picks a size from the DIRECTORY, never from the payload, so an
  // entry that misdeclares its image ships the wrong icon at every scale.
  const lying = Buffer.from(good);
  lying[6] = 64;
  assert.throws(() => readIco(lying, "x.ico"), /listed as 64x16 but its PNG is 16x16/);
});

test("assertIcoShape pins the size roster and the RGBA payload requirement", () => {
  const payloads = ICO_SIZES.map((size) => fakePng(size));
  assert.deepEqual(
    assertIcoShape(buildIco(payloads), "favicon.ico", ICO_SIZES).map((e) => e.width),
    ICO_SIZES,
  );

  assert.throws(
    () => assertIcoShape(buildIco(payloads.slice(0, 2)), "favicon.ico", ICO_SIZES),
    /carries 16x16, 32x32; the favicon must carry 16x16, 32x32, 48x48/,
  );

  // The regression that turned the web production build red: Turbopack's ICO
  // decoder refuses a non-RGBA payload outright, so an RGB one is a failed
  // build rather than a worse-looking icon. Asserted here so the next person
  // packing this container meets the rule instead of the Turbopack error.
  const rgbPayloads = ICO_SIZES.map((size) => fakePng(size, { colourType: 2 }));
  assert.throws(
    () => assertIcoShape(buildIco(rgbPayloads), "favicon.ico", ICO_SIZES),
    /colour type 2, not RGBA \(6\)/,
  );
});

test("no icon file in a Next app escapes the sync manifest", () => {
  // The regression this whole section exists for, stated as a property rather
  // than as one path. `favicon.ico` was not forgotten on purpose — it was added
  // by a scaffold, and nothing anywhere asked whether a new icon file under
  // `app/` was gated. Now something does.
  const ICON_FILE =
    /^(favicon\.\w+|icon\d?\.\w+|apple-icon\d?\.\w+|apple-touch-icon\.\w+|opengraph-emblem\.\w+)$/;
  const targets = new Set(SYNCED.flatMap((entry) => entry.targets));
  const unguarded = [];
  for (const app of ["apps/web/app", "apps/landing/app"]) {
    for (const name of readdirSync(repo(app))) {
      if (ICON_FILE.test(name) && !targets.has(`${app}/${name}`)) {
        unguarded.push(`${app}/${name}`);
      }
    }
  }
  assert.deepEqual(
    unguarded,
    [],
    "every icon file a Next app serves must be generated and gated — add it to SYNCED and to sync-brand-assets.mjs's source",
  );
});
