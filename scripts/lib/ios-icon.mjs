/**
 * The iOS app icon: an Apple Icon Composer bundle, `apps/mobile/assets/frapp.icon`,
 * which `expo.ios.icon` names. `rasterize-brand-assets.mjs` writes it from the
 * glyph vector; `check-brand-assets.mjs` and `brand-pixels.test.mjs` hold the
 * committed bundle to exactly what these functions produce.
 *
 * WHY A BUNDLE AND NOT PNG VARIANTS (owner, 2026-09-30). iOS 18+ shows icons in
 * default, dark, clear and tinted appearances, and iOS 26 renders them in
 * Liquid Glass. An Icon Composer bundle is Apple's format for that, and the
 * one Expo's own SDK 57 template ships: one layered document from which the
 * system derives every appearance. The owner accepted that Liquid Glass adds
 * its specular edge and a shadow to the crest; see `spec/ui/assets.md` §7.
 *
 * Apple publishes no schema for `icon.json`. The fields below follow the
 * reverse-engineered schemas in giginet/apple-icon-composer-skill and
 * dfabulich's, and the Expo template's own bundle, read on 2026-09-30. Nothing
 * in this repo can compile the bundle: `actool` runs only in Xcode 26+, so the
 * first EAS build is its first real test.
 *
 * This file imports nothing that needs `npm ci`: the `ci-scripts-tests` job
 * runs without it, and `brand-pixels.test.mjs` imports this.
 */
import { FIELD, GOLD_HEX } from "./brand-pixels.mjs";

export const IOS_ICON_DIR = "apps/mobile/assets/frapp.icon";
export const IOS_ICON_JSON = `${IOS_ICON_DIR}/icon.json`;
export const IOS_ICON_CREST = `${IOS_ICON_DIR}/Assets/crest.svg`;

/** An 8-bit sRGB channel as Icon Composer writes it: five decimals. */
const channel = (value) => (value / 255).toFixed(5);

/** The mark's field, `#1A1A1A`, in Icon Composer's colour syntax. */
export const FIELD_COLOUR = `extended-srgb:${channel(FIELD.r)},${channel(FIELD.g)},${channel(FIELD.b)},1.00000`;

/**
 * The document, key by key:
 *
 *   - The fill is the mark's field in the default AND the dark appearance. An
 *     icon with no dark fill goes black in dark mode (WWDC25 session 361), and
 *     the field is already dark, so dark mode keeps it.
 *   - One layer, the crest, from `crest.svg`, with no `position`: a 1024 x 1024
 *     image on the 1024 x 1024 canvas lands exactly where the crest sits in
 *     `icon.png`, the same frame every brand SVG shares.
 *   - Glass and the specular edge are on: that is the Liquid Glass look the
 *     owner accepted. Translucency is OFF, so the crest stays exactly the
 *     locked gold instead of letting the field show through it. A neutral
 *     shadow at 0.3 lifts it off the field without a halo.
 *   - Clear and tinted have no overrides: the system renders the crest white
 *     or grey on its own background there, so neither the field nor the gold
 *     survives in those two modes. That is the platform's rule, not a choice.
 *   - `color-space-for-untagged-svg-colors: srgb`, so `#DDB844` is read as sRGB
 *     and not widened to Display P3.
 *   - `squares: shared` with no `circles`: iOS (and the shared square
 *     platforms), no watchOS.
 */
export const ICON_DOCUMENT = {
  "color-space-for-untagged-svg-colors": "srgb",
  "fill-specializations": [
    { value: { solid: FIELD_COLOUR } },
    { appearance: "dark", value: { solid: FIELD_COLOUR } },
  ],
  groups: [
    {
      layers: [{ glass: true, "image-name": "crest.svg", name: "crest" }],
      shadow: { kind: "neutral", opacity: 0.3 },
      specular: true,
      translucency: { enabled: false, value: 0.5 },
    },
  ],
  "supported-platforms": { squares: "shared" },
};

/** `icon.json` as committed. */
export function iconJson() {
  return `${JSON.stringify(ICON_DOCUMENT, null, 2)}\n`;
}

/**
 * The one path's `d` in a brand SVG, verbatim. Every brand SVG shares the
 * crest's path string byte for byte (`brand-pixels.test.mjs`), so the bundle's
 * copy is held to the same rule.
 */
export function glyphPath(svg, label) {
  const paths = [...svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"/g)];
  if (paths.length !== 1) {
    throw new Error(
      `${label}: has ${paths.length} paths; the crest is exactly one`,
    );
  }
  return paths[0][1];
}

/**
 * `crest.svg`: the crest alone on transparency, in the brand frame, in the
 * plainest SVG there is. Apple lists no SVG features `actool` rejects, only
 * that text must be outlines and that unsupported features belong in a PNG,
 * so the bundle's copy carries no comment, `<title>`, style or effect: one
 * `<svg>` with its size and viewBox, and one filled path.
 */
export function crestSvg(d) {
  return (
    `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">\n` +
    `  <path fill="${GOLD_HEX}" d="${d}"/>\n` +
    `</svg>\n`
  );
}
