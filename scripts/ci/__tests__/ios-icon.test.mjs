// The iOS Icon Composer bundle (`scripts/lib/ios-icon.mjs`).
//
// Nothing in CI can compile an `.icon`: `actool` is Xcode 26+ only, so the
// first EAS build is the bundle's first real test. What CI can hold is intent:
// the document says what the owner decided (2026-09-30, `spec/ui/assets.md`
// §7), and the committed bundle is exactly what the generator writes. Like
// `brand-pixels.test.mjs`, this imports nothing that needs `npm ci`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIELD_HEX,
  GOLD_HEX,
  assertSvgLocked,
} from "../../lib/brand-pixels.mjs";
import {
  FIELD_COLOUR,
  ICON_DOCUMENT,
  IOS_ICON_DIR,
  crestSvg,
  glyphPath,
  iconJson,
} from "../../lib/ios-icon.mjs";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const repo = (rel) => join(REPO_ROOT, rel);
const GLYPH = readFileSync(
  repo("packages/brand-assets/assets/signet-emblem-B-glyph.svg"),
  "utf8",
);

test("the fill is the mark's field, in the default and the dark appearance", () => {
  const channel = Number.parseInt(FIELD_HEX.slice(1, 3), 16) / 255;
  assert.equal(
    FIELD_COLOUR,
    `extended-srgb:${channel.toFixed(5)},${channel.toFixed(5)},${channel.toFixed(5)},1.00000`,
  );
  const fills = ICON_DOCUMENT["fill-specializations"];
  assert.deepEqual(
    fills.map((f) => [f.appearance ?? "default", f.value.solid]),
    [
      ["default", FIELD_COLOUR],
      ["dark", FIELD_COLOUR],
    ],
  );
  // `fill` and `fill-specializations` are alternatives; the tools reject both.
  assert.equal(ICON_DOCUMENT.fill, undefined);
});

test("one glass crest layer in the brand frame, gold kept exact", () => {
  const [group, ...rest] = ICON_DOCUMENT.groups;
  assert.equal(rest.length, 0);
  assert.deepEqual(group.layers, [
    { glass: true, "image-name": "crest.svg", name: "crest" },
  ]);
  // No `position`: the 1024 image fills the 1024 canvas, so the crest sits
  // where it sits in icon.png. No layer `fill`: it would replace the gold.
  assert.equal(group.layers[0].position, undefined);
  assert.equal(group.layers[0].fill, undefined);
  assert.equal(group.specular, true);
  assert.deepEqual(group.translucency, { enabled: false, value: 0.5 });
  assert.equal(group.shadow.kind, "neutral");
  assert.equal(ICON_DOCUMENT["color-space-for-untagged-svg-colors"], "srgb");
});

test("the document uses no Icon Composer 2 keys, which an Xcode 26 toolchain rejects", () => {
  const json = iconJson();
  for (const key of [
    "features",
    "refractivity",
    "specular-highlight-placement",
  ]) {
    assert.ok(!json.includes(`"${key}"`), `icon.json must not use "${key}"`);
  }
  assert.deepEqual(ICON_DOCUMENT["supported-platforms"], { squares: "shared" });
});

test("crest.svg is the glyph's own path in the locked gold, in the plainest SVG", () => {
  const svg = crestSvg(glyphPath(GLYPH, "glyph"));
  assert.doesNotThrow(() =>
    assertSvgLocked(svg, "crest.svg", { requireField: false }),
  );
  assert.ok(svg.includes(`fill="${GOLD_HEX}"`));
  for (const banned of [
    "<!--",
    "<title",
    "<style",
    "<text",
    "<image",
    "filter",
    "mask",
  ]) {
    assert.ok(!svg.includes(banned), `crest.svg must not carry ${banned}`);
  }
  assert.equal(glyphPath(svg, "crest.svg"), glyphPath(GLYPH, "glyph"));
});

test("glyphPath refuses a glyph crest.svg cannot copy whole", () => {
  // One path, via svgPath (brand-pixels.test.mjs covers its cases).
  assert.throws(
    () => glyphPath("<svg></svg>", "empty"),
    /has 0 <path> elements/,
  );
  // Another shape, or a path attribute crestSvg would drop, would ship on
  // Android and Play and silently not on iOS.
  assert.throws(
    () =>
      glyphPath(
        GLYPH.replace("</svg>", '<circle cx="1" cy="1" r="1"/></svg>'),
        "circle",
      ),
    /draws <circle> besides its path/,
  );
  assert.throws(
    () =>
      glyphPath(
        GLYPH.replace("<path", '<path fill-rule="evenodd"'),
        "fill-rule",
      ),
    /carries fill-rule, which crest.svg would drop/,
  );
  // A Windows checkout reads the same path.
  assert.equal(
    glyphPath(GLYPH.replace(/\n/g, "\r\n"), "crlf"),
    glyphPath(GLYPH, "glyph"),
  );
});

test("app.json names the bundle as a plain string on ios.icon", () => {
  // Whether the committed bundle is what the generator writes is
  // check:brand-assets' job (section 6); this holds the one fact it can't see.
  // A `.icon` must be a plain string on `ios.icon`. Expo 57 warns about one
  // anywhere else: as the top-level `icon` it still uses it, and inside the
  // light/dark/tinted object it treats the directory as an image.
  const appJson = JSON.parse(
    readFileSync(repo("apps/mobile/app.json"), "utf8"),
  );
  assert.equal(
    appJson.expo.ios.icon,
    `./${IOS_ICON_DIR.replace("apps/mobile/", "")}`,
  );
});
