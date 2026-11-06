/**
 * The iOS app icon: PNGs that `expo.ios.icon` names per appearance. Dark is
 * `icon.png`, the full-bleed tile every other surface ships; light is
 * `icon-light.png`, the crest in the field's ink on cream; tinted is
 * `icon-tinted.png`, the crest in grey on black. `rasterize-brand-assets.mjs`
 * renders light and tinted from the glyph with `lightFromGlyph` and
 * `tintedFromGlyph`, `check-brand-assets.mjs` audits the committed files with
 * `assertLightIcon` and `assertTintedIcon`, and
 * `scripts/ci/__tests__/ios-icon.test.mjs` holds `app.json` to `iosIconConfig()`.
 *
 * WHY PNGs AND NOT AN ICON COMPOSER BUNDLE (2026-11-03, #3319). From
 * 2026-09-30 (#2941) the icon was an Icon Composer bundle,
 * `apps/mobile/assets/frapp.icon`, for the Liquid Glass look. The first iOS
 * store build that compiled it (EAS `30c8680b`, v0.8.1, the pinned Xcode 26.6
 * image with the iPhoneOS 26.5 SDK) died in `actool` on that bundle: "attempt
 * to insert nil object from objects[0]" in `CompileAssetCatalogVariant`, with
 * every other target built. Apple Developer Forums report the same assertion
 * on `.icon` bundles from Xcode releases after 26.4.1, and nothing in this
 * repo can run `actool` to tell an Xcode bug from a bundle fault, so the owner
 * moved the icon to the app-icon set every iOS app compiles. Light and dark
 * keep the gold crest on the field; tinted, and iOS 26's clear appearance,
 * were always iOS's own colouring of the crest. The Liquid Glass specular
 * edge and shadow are given up.
 *
 * THE APPEARANCES, as `@expo/prebuild-config` 57 writes them
 * (`withIosIcons.js`: light and tinted are flattened onto white with their
 * transparency removed; only dark keeps alpha):
 *
 *   - light: `icon-light.png`, opaque, the crest in the field's ink
 *     (`FIELD_HEX`) on cream (`LIGHT_FIELD_HEX`). Owner's pick, 2026-11-06:
 *     with `icon.png` here too, the light home screen showed the same black
 *     tile as dark mode. Of the light options drawn (gold on cream, gold on
 *     white, ink on cream) ink holds the most contrast at home-screen size;
 *     gold on a light tile washes out. Only the colours swap: the crest is the
 *     same glyph render as tinted, at the same full-bleed scale.
 *   - dark: `icon.png`, gold on the field. The field is already dark, so dark
 *     mode keeps it, as the bundle's dark fill did. Naming it makes the dark
 *     appearance this tile rather than leaving it to iOS.
 *   - tinted: grey on black, opaque. iOS reads a tinted icon's luminance as
 *     the tint mask and paints its own background, so the crest is white and
 *     the field black; neither locked colour survives tinting. Opaque because
 *     prebuild would flatten a transparent background onto white, and a white
 *     crest on white is an empty icon.
 *
 * This file imports nothing that needs `npm ci`: `ios-icon.test.mjs` imports
 * it, and the `ci-scripts-tests` job runs without `npm ci`.
 */
import { FIELD, FIELD_HEX, assertGlyphCoverage } from "./brand-pixels.mjs";

/** Each appearance's file, from the repo root. */
export const IOS_ICON = {
  light: "apps/mobile/assets/images/icon-light.png",
  dark: "apps/mobile/assets/images/icon.png",
  tinted: "apps/mobile/assets/images/icon-tinted.png",
};

export const IOS_ICON_TINTED = IOS_ICON.tinted;
export const IOS_ICON_LIGHT = IOS_ICON.light;

/** The light appearance's tile: a warm cream, so the ink crest reads as the mark rather than a cut-out. */
export const LIGHT_FIELD_HEX = "#F4EFE4";
const LIGHT_FIELD = {
  r: parseInt(LIGHT_FIELD_HEX.slice(1, 3), 16),
  g: parseInt(LIGHT_FIELD_HEX.slice(3, 5), 16),
  b: parseInt(LIGHT_FIELD_HEX.slice(5, 7), 16),
};
const INK = FIELD;

/** One channel of the crest at `alpha` (0-255) over the cream tile. */
function blend(cream, ink, alpha) {
  return Math.round((cream * (255 - alpha) + ink * alpha) / 255);
}

/** The one size Expo's prebuild writes an iOS app icon at, in pixels. */
export const IOS_ICON_SIZE = 1024;

/** `expo.ios.icon` as `apps/mobile/app.json` holds it: the same files, relative to the app. */
export function iosIconConfig() {
  return Object.fromEntries(
    Object.entries(IOS_ICON).map(([appearance, rel]) => [
      appearance,
      `./${rel.replace(/^apps\/mobile\//, "")}`,
    ]),
  );
}

/**
 * The tinted icon from the crest rendered on transparency (RGBA): each
 * pixel's grey level is the crest's alpha there, so the crest is white, its
 * antialiased edge a ramp, and everything else black. Returns raw RGB.
 */
export function tintedFromGlyph(data, channels) {
  if (channels !== 4) {
    throw new Error(`tintedFromGlyph: needs an RGBA render, got ${channels} channels`);
  }
  const pixels = data.length / 4;
  const out = Buffer.alloc(pixels * 3);
  for (let p = 0; p < pixels; p += 1) {
    const grey = data[p * 4 + 3];
    out[p * 3] = grey;
    out[p * 3 + 1] = grey;
    out[p * 3 + 2] = grey;
  }
  return out;
}

/**
 * The light icon from the crest rendered on transparency (RGBA): the crest's
 * alpha decides how far each pixel moves from cream to ink, so the edge keeps
 * the glyph render's antialiasing. Returns raw RGB.
 */
export function lightFromGlyph(data, channels) {
  if (channels !== 4) {
    throw new Error(`lightFromGlyph: needs an RGBA render, got ${channels} channels`);
  }
  const pixels = data.length / 4;
  const out = Buffer.alloc(pixels * 3);
  for (let p = 0; p < pixels; p += 1) {
    const alpha = data[p * 4 + 3];
    out[p * 3] = blend(LIGHT_FIELD.r, INK.r, alpha);
    out[p * 3 + 1] = blend(LIGHT_FIELD.g, INK.g, alpha);
    out[p * 3 + 2] = blend(LIGHT_FIELD.b, INK.b, alpha);
  }
  return out;
}

/** How far a light-icon pixel sits from cream (0) to ink (255), read off red, the widest channel. */
function lightAlpha(red) {
  return Math.round(((LIGHT_FIELD.r - red) * 255) / (LIGHT_FIELD.r - INK.r));
}

/**
 * What the committed `icon-light.png` must be: 1024², opaque RGB (prebuild
 * flattens a light icon's transparency onto white, which would drop the
 * cream), every pixel on the cream-to-ink line, cream at all four corners,
 * and a crest that covers as much of the canvas as any glyph layer may.
 */
export function assertLightIcon(data, channels, width, height, label) {
  if (width !== IOS_ICON_SIZE || height !== IOS_ICON_SIZE) {
    throw new Error(
      `${label}: is ${width}x${height}; it must be ${IOS_ICON_SIZE}x${IOS_ICON_SIZE}, the size Expo's prebuild writes every iOS app icon at`,
    );
  }
  if (channels !== 3) {
    throw new Error(
      `${label}: has ${channels} channels; it must be opaque RGB, because Expo's prebuild flattens a light icon's transparency onto white`,
    );
  }
  let inked = 0;
  for (let i = 0; i < data.length; i += 3) {
    const alpha = lightAlpha(data[i]);
    const onLine =
      alpha >= 0 &&
      alpha <= 255 &&
      Math.abs(data[i + 1] - blend(LIGHT_FIELD.g, INK.g, alpha)) <= 1 &&
      Math.abs(data[i + 2] - blend(LIGHT_FIELD.b, INK.b, alpha)) <= 1;
    if (!onLine) {
      const p = i / 3;
      throw new Error(
        `${label}: pixel (${p % width}, ${Math.floor(p / width)}) is off the ${LIGHT_FIELD_HEX} -> ${FIELD_HEX} line; the light icon is the crest in ink on cream and nothing else`,
      );
    }
    if (alpha >= 128) inked += 1;
  }
  for (const [x, y] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]) {
    const i = (y * width + x) * 3;
    if (data[i] !== LIGHT_FIELD.r || data[i + 1] !== LIGHT_FIELD.g || data[i + 2] !== LIGHT_FIELD.b) {
      throw new Error(`${label}: corner (${x}, ${y}) is not ${LIGHT_FIELD_HEX}; the crest sits on cream`);
    }
  }
  assertGlyphCoverage(inked / (width * height), label);
}

/** The crest's mask in a light icon: 1 where the pixel is past halfway to ink. */
export function lightMask(data, width, height) {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p += 1) {
    mask[p] = lightAlpha(data[p * 3]) >= 128 ? 1 : 0;
  }
  return mask;
}

/**
 * What the committed `icon-tinted.png` must be: 1024² like every iOS app
 * icon Expo writes, opaque RGB (see above for why opaque), grey in every
 * pixel, black at all four corners, and a crest that covers as much of the
 * canvas as any other glyph layer may. An empty or solid file fails, as it
 * does for every glyph layer (#2153).
 */
export function assertTintedIcon(data, channels, width, height, label) {
  if (width !== IOS_ICON_SIZE || height !== IOS_ICON_SIZE) {
    throw new Error(
      `${label}: is ${width}x${height}; it must be ${IOS_ICON_SIZE}x${IOS_ICON_SIZE}, the size Expo's prebuild writes every iOS app icon at`,
    );
  }
  if (channels !== 3) {
    throw new Error(
      `${label}: has ${channels} channels; it must be opaque RGB, because Expo's prebuild flattens a tinted icon's transparency onto white`,
    );
  }
  let lit = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) {
      const p = i / 3;
      throw new Error(
        `${label}: pixel (${p % width}, ${Math.floor(p / width)}) is not grey; iOS reads a tinted icon's luminance only`,
      );
    }
    if (data[i] >= 128) lit += 1;
  }
  for (const [x, y] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]) {
    if (data[(y * width + x) * 3] !== 0) {
      throw new Error(`${label}: corner (${x}, ${y}) is not black; the crest sits on black`);
    }
  }
  assertGlyphCoverage(lit / (width * height), label);
}

/** The crest's mask in a tinted icon: 1 where the grey is past half. */
export function tintedMask(data, width, height) {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p += 1) {
    mask[p] = data[p * 3] >= 128 ? 1 : 0;
  }
  return mask;
}
