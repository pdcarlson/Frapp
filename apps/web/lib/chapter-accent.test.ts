import { describe, it, expect } from "vitest";
import { resolveChapterAccentColor } from "@repo/theme/accent";
import { frappLightTokens, frappDarkTokens } from "@repo/theme/tokens";

/**
 * Covers the shared `@repo/theme/accent` helper.
 *
 * It lives in the web suite because that is where `resolveChapterAccentColor`
 * is consumed (`dashboard-shell.tsx`, `settings-page.tsx`) *and* because
 * `packages/theme` has no test runner and no CI job — a spec placed beside the
 * source would never execute (cf. #320, #766).
 */

const LIGHT_SURFACE = frappLightTokens.color.surface.card;
const DARK_SURFACE = frappDarkTokens.color.surface.card;
const LIGHT_BRAND = frappLightTokens.color.brand.bronze;
const DARK_BRAND = frappDarkTokens.color.brand.bronze;

/** The crimson `spec/behavior/branding.md` uses as its worked example. */
const CRIMSON = "#8B0000";

describe("resolveChapterAccentColor — default (web) behavior", () => {
  it("keeps an accent that clears AA on white", () => {
    const result = resolveChapterAccentColor(CRIMSON);

    expect(result).toMatchObject({
      resolvedAccent: CRIMSON,
      fallbackApplied: false,
      reason: "ok",
    });
    expect(result.contrastOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back when the accent is too light for white", () => {
    expect(resolveChapterAccentColor("#FFFF00")).toMatchObject({
      resolvedAccent: LIGHT_BRAND,
      fallbackApplied: true,
      reason: "insufficient_contrast",
    });
  });

  it("falls back on a missing or malformed accent", () => {
    for (const input of [undefined, "", "rebeccapurple", "#12345"]) {
      expect(resolveChapterAccentColor(input)).toMatchObject({
        resolvedAccent: LIGHT_BRAND,
        fallbackApplied: true,
        reason: "invalid_format",
      });
    }
  });

  it("expands and upper-cases shorthand hex", () => {
    expect(resolveChapterAccentColor("#a00").resolvedAccent).toBe("#AA0000");
  });
});

describe("resolveChapterAccentColor — per-surface resolution", () => {
  it("rejects on a dark surface an accent that passed on a light one", () => {
    // The gap this parameter exists to close: the API validates accents only
    // against a light background, so crimson is a legal stored value that is
    // unreadable on the native dark card.
    expect(
      resolveChapterAccentColor(CRIMSON, { background: LIGHT_SURFACE }),
    ).toMatchObject({ resolvedAccent: CRIMSON, fallbackApplied: false });

    expect(
      resolveChapterAccentColor(CRIMSON, {
        background: DARK_SURFACE,
        fallbackAccent: DARK_BRAND,
      }),
    ).toMatchObject({
      resolvedAccent: DARK_BRAND,
      fallbackApplied: true,
      reason: "insufficient_contrast",
    });
  });

  it("accepts on a dark surface an accent that failed on a light one", () => {
    expect(
      resolveChapterAccentColor("#FFFF00", {
        background: DARK_SURFACE,
        fallbackAccent: DARK_BRAND,
      }),
    ).toMatchObject({ resolvedAccent: "#FFFF00", fallbackApplied: false });
  });

  it("substitutes a fallback that is itself legible on the dark surface", () => {
    const result = resolveChapterAccentColor(CRIMSON, {
      background: DARK_SURFACE,
      fallbackAccent: DARK_BRAND,
    });

    expect(result.contrastOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it("reports contrast against the named background, not white", () => {
    const onDark = resolveChapterAccentColor(DARK_BRAND, {
      background: DARK_SURFACE,
      fallbackAccent: DARK_BRAND,
    });
    const onWhite = resolveChapterAccentColor(DARK_BRAND);

    // Bone-bronze is legible on ink and illegible on white; one number cannot
    // describe both, which is why the field is no longer "contrastOnWhite".
    expect(onDark.contrastOnBackground).toBeGreaterThanOrEqual(4.5);
    expect(onWhite.fallbackApplied).toBe(true);
  });

  it("degrades an unparseable background to white instead of NaN", () => {
    const result = resolveChapterAccentColor(CRIMSON, {
      background: "not-a-color",
    });

    expect(result.contrastOnBackground).toBe(
      resolveChapterAccentColor(CRIMSON).contrastOnBackground,
    );
    expect(Number.isNaN(result.contrastOnBackground)).toBe(false);
  });

  it("ignores an unparseable fallback rather than emitting it", () => {
    expect(
      resolveChapterAccentColor("#FFFF00", { fallbackAccent: "nope" }),
    ).toMatchObject({ resolvedAccent: LIGHT_BRAND, fallbackApplied: true });
  });
});
