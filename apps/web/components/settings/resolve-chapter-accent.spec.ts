import { describe, it, expect } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";

import { resolveChapterAccentColor } from "@/components/settings/resolve-chapter-accent";

/**
 * Covers the Settings accent preview's resolver. It moved here from
 * `@repo/theme/accent` with #3227, along with this suite. The preview's own
 * verdicts on real colours are pinned in `settings-contrast.spec.ts`.
 */

/** The dark card and house gold the real caller passes. */
const DARK = {
  background: signetDarkTokens.color.surface.card,
  fallbackAccent: signetDarkTokens.color.gold.house,
};
/** A light surface, to show the verdict depends on the surface named. */
const LIGHT = { background: "#FFFFFF", fallbackAccent: "#7A5A2F" };

/** The crimson `spec/behavior/branding.md` uses as its worked example. */
const CRIMSON = "#8B0000";

describe("resolveChapterAccentColor — the Settings preview's surface", () => {
  it("keeps an accent that clears AA on the dark card", () => {
    const result = resolveChapterAccentColor("#FFFF00", DARK);

    expect(result).toMatchObject({
      resolvedAccent: "#FFFF00",
      fallbackApplied: false,
      reason: "ok",
    });
    expect(result.contrastOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back to house gold when the accent is too dark for the card", () => {
    const result = resolveChapterAccentColor(CRIMSON, DARK);

    expect(result).toMatchObject({
      resolvedAccent: DARK.fallbackAccent,
      fallbackApplied: true,
      reason: "insufficient_contrast",
    });
    expect(result.contrastOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back on a missing or malformed accent", () => {
    for (const input of [undefined, "", "rebeccapurple", "#12345"]) {
      expect(resolveChapterAccentColor(input, DARK)).toMatchObject({
        resolvedAccent: DARK.fallbackAccent,
        fallbackApplied: true,
        reason: "invalid_format",
      });
    }
  });

  it("expands and upper-cases shorthand hex", () => {
    expect(resolveChapterAccentColor("#ff0", DARK).resolvedAccent).toBe(
      "#FFFF00",
    );
  });
});

describe("resolveChapterAccentColor — per-surface resolution", () => {
  it("judges the same accent against whichever surface it is given", () => {
    // The API validates accents only against a light background, so crimson
    // is a legal stored value that is unreadable on the dark card.
    expect(resolveChapterAccentColor(CRIMSON, LIGHT)).toMatchObject({
      resolvedAccent: CRIMSON,
      fallbackApplied: false,
    });
    expect(resolveChapterAccentColor(CRIMSON, DARK)).toMatchObject({
      fallbackApplied: true,
    });
  });

  it("reports contrast against the named background", () => {
    const onDark = resolveChapterAccentColor(DARK.fallbackAccent, DARK);
    const onWhite = resolveChapterAccentColor(DARK.fallbackAccent, LIGHT);

    // House gold is legible on the dark card and illegible on white; one
    // number cannot describe both.
    expect(onDark).toMatchObject({ fallbackApplied: false });
    expect(onDark.contrastOnBackground).toBeGreaterThanOrEqual(4.5);
    expect(onWhite.fallbackApplied).toBe(true);
  });

  it("escalates past a fallback that is illegible on the surface (#797)", () => {
    // Bronze on the dark card is the case #797 closed: it would have replaced
    // crimson with something no more readable.
    const result = resolveChapterAccentColor(CRIMSON, {
      background: DARK.background,
      fallbackAccent: "#7A5A2F",
    });

    expect(result.fallbackApplied).toBe(true);
    expect(result.resolvedAccent).not.toBe("#7A5A2F");
    expect(result.contrastOnBackground).toBeGreaterThanOrEqual(4.5);
  });
});

describe("resolveChapterAccentColor — caller contract", () => {
  it("throws on a background that is not a hex colour", () => {
    expect(() =>
      resolveChapterAccentColor(CRIMSON, { ...DARK, background: "nope" }),
    ).toThrow(TypeError);
  });

  it("throws on a fallback that is not a hex colour", () => {
    expect(() =>
      resolveChapterAccentColor(CRIMSON, { ...DARK, fallbackAccent: "nope" }),
    ).toThrow(TypeError);
  });
});
