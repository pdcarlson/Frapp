/**
 * The iOS app icon: PNGs that `expo.ios.icon` names per appearance. Light and
 * dark are `icon.png`, the full-bleed tile every other surface ships; tinted is
 * `icon-tinted.png`, the crest in grey on black, which `rasterize-brand-assets.mjs`
 * renders with `tintedFromGlyph`. `check-brand-assets.mjs` audits the committed
 * tinted file with `assertTintedIcon`, and `scripts/ci/__tests__/ios-icon.test.mjs`
 * holds `app.json` to `iosIconConfig()`.
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
 *   - light: `icon.png`, opaque, gold on the field.
 *   - dark: `icon.png` again. The field is already dark, so dark mode keeps
 *     it, as the bundle's dark fill did. Naming it makes the dark appearance
 *     this tile rather than leaving it to iOS.
 *   - tinted: grey on black, opaque. iOS reads a tinted icon's luminance as
 *     the tint mask and paints its own background, so the crest is white and
 *     the field black; neither locked colour survives tinting. Opaque because
 *     prebuild would flatten a transparent background onto white, and a white
 *     crest on white is an empty icon.
 *
 * This file imports nothing that needs `npm ci`: `ios-icon.test.mjs` imports
 * it, and the `ci-scripts-tests` job runs without `npm ci`.
 */
import { assertGlyphCoverage } from "./brand-pixels.mjs";

/** Each appearance's file, from the repo root. */
export const IOS_ICON = {
  light: "apps/mobile/assets/images/icon.png",
  dark: "apps/mobile/assets/images/icon.png",
  tinted: "apps/mobile/assets/images/icon-tinted.png",
};

export const IOS_ICON_TINTED = IOS_ICON.tinted;

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
