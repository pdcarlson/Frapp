import { describe, expect, it } from "vitest";

import { contrastRatio, parseHex } from "@repo/color";

import { deriveSignetPalette, HOUSE_SEED, type SignetPalette } from "./signet.js";

/**
 * Every distinct color in `supabase/seed/chapter_directory.csv` — 50 real
 * fraternity chapters, 100 values, 18 distinct after dedupe.
 *
 * Frozen here rather than read from the CSV at test time. The seed file is real
 * production data that gets edited (it was repaired wholesale in #903), and a
 * suite that reads it would change what it asserts whenever that data moves —
 * failing on a data edit, or worse, silently narrowing its own coverage. The
 * point of these values is that they are *awkward* — near-black `#1F1A15`, pure
 * `#FFFFFF` and `#000000`, silver `#C0C0C0`, hot pink `#FF69B4`, and the light
 * gold `#C9A56F` that 45 of the 100 values use.
 */
const REAL_CHAPTER_COLORS = [
  "#000000",
  "#003087",
  "#006400",
  "#1F1A15",
  "#1F4E79",
  "#472B62",
  "#4B0082",
  "#4B1A7E",
  "#4B2E2E",
  "#800000",
  "#8B0000",
  "#8B4513",
  "#BF0A30",
  "#C0C0C0",
  "#C9A56F",
  "#CC0000",
  "#FF69B4",
  "#FFFFFF",
] as const;

const ALL_SEEDS = [...REAL_CHAPTER_COLORS, HOUSE_SEED];

const SOLID_TOKENS = [
  "--signet-accent-primary",
  "--signet-accent-hover",
  "--signet-accent-ring",
  "--signet-accent-subtle-bg",
  "--signet-accent-border",
  "--signet-accent-text",
  "--signet-accent-on-primary",
] as const satisfies readonly (keyof SignetPalette)[];

const ALPHA_TOKENS = [
  "--signet-accent-primary-alpha",
  "--signet-accent-hover-alpha",
  "--signet-accent-ring-alpha",
  "--signet-accent-subtle-bg-alpha",
  "--signet-accent-border-alpha",
  "--signet-accent-text-alpha",
] as const satisfies readonly (keyof SignetPalette)[];

const ratio = (a: string, b: string) =>
  contrastRatio(parseHex(a)!, parseHex(b)!);

describe("deriveSignetPalette", () => {
  it("emits every token for every real chapter color", () => {
    for (const seed of ALL_SEEDS) {
      const { palette } = deriveSignetPalette(seed);

      for (const token of SOLID_TOKENS) {
        // Six digits always. The generator emits shorthand for some seeds
        // (`accentContrast` is `#fff` on a dark one), and a stored token that is
        // sometimes 3-digit and sometimes 6-digit breaks any consumer slicing it.
        expect(palette[token], `${seed} ${token}`).toMatch(/^#[0-9A-F]{6}$/);
      }
      for (const token of ALPHA_TOKENS) {
        expect(palette[token], `${seed} ${token}`).toMatch(/^#[0-9A-F]{6,8}$/);
      }
    }
  });

  /**
   * accent-engine.md §8, as an executable assertion rather than a promise.
   *
   * This is the regression that a dependency upgrade would cause: the whole
   * point of vendoring the generator is that the guarantee depends on its exact
   * behavior. It already caught one real defect — the generator returns white as
   * the contrast color for light seeds in dark appearance, scoring 2.31:1 on
   * `#C9A56F` where black scores 9.10:1 — which `onPrimaryFor` now corrects.
   */
  it("guarantees AA on the accent-derived text roles, for every seed", () => {
    for (const seed of ALL_SEEDS) {
      const { contrastChecks } = deriveSignetPalette(seed);

      expect(contrastChecks).toHaveLength(3);
      for (const check of contrastChecks) {
        expect(
          check.passes,
          `${seed}: ${check.role} on ${check.against} = ${check.ratio.toFixed(2)}:1`,
        ).toBe(true);
      }
    }
  });

  it("keeps the generator's contrast color when it is already legible", () => {
    // The house seed is the case that must not regress: Radix picks a custom
    // dark `#2B2009` scoring 8.82:1, which beats both black and white.
    const { palette } = deriveSignetPalette(HOUSE_SEED);
    expect(palette["--signet-accent-on-primary"]).toBe("#2B2009");
  });

  it("substitutes black or white only when the generator's choice fails", () => {
    const { palette } = deriveSignetPalette("#C9A56F");
    expect(palette["--signet-accent-on-primary"]).toBe("#000000");
    expect(
      ratio(palette["--signet-accent-on-primary"], palette["--signet-accent-primary"]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("maps roles to the steps the spec assigns them", () => {
    // Step 9 is the primary fill, and for a seed already suited to it the
    // generator returns the seed itself — the cheapest observable proof that
    // `accent-primary` reads step 9 and not a neighbour.
    const { palette } = deriveSignetPalette(HOUSE_SEED);
    expect(palette["--signet-accent-primary"]).toBe(HOUSE_SEED);
  });

  it("is deterministic", () => {
    expect(deriveSignetPalette("#8B0000")).toEqual(deriveSignetPalette("#8B0000"));
  });

  describe("seed resolution", () => {
    it("treats an absent seed as house gold, not as bad data", () => {
      // `undefined`, `null`, and blank all mean "this chapter never picked an
      // accent", which is the ordinary case — the column is nullable and the
      // onboarding wizard does not require a color. Reporting it as invalid
      // would make the API log a data-integrity warning for every default
      // chapter, which is how a real signal gets tuned out.
      for (const absent of [undefined, null, "", "   "]) {
        const result = deriveSignetPalette(absent);
        expect(result.resolvedSeed, String(absent)).toBe(HOUSE_SEED);
        expect(result.invalidSeed, String(absent)).toBe(false);
      }
    });

    it("reports an unparseable seed rather than swallowing it", () => {
      // Something was stored and it was not a color: always an upstream bug.
      for (const bad of ["nope", "#12", "#1234", "rgb(1,2,3)"]) {
        const result = deriveSignetPalette(bad);
        expect(result.resolvedSeed, bad).toBe(HOUSE_SEED);
        expect(result.invalidSeed, bad).toBe(true);
      }
    });

    it("normalizes shorthand and casing", () => {
      expect(deriveSignetPalette("#abc").resolvedSeed).toBe("#AABBCC");
      expect(deriveSignetPalette("#8b0000").resolvedSeed).toBe("#8B0000");
    });

    it("never throws", () => {
      // Load-bearing: ChapterOnboardingService wraps its palette call in a
      // try/catch returning null, so a throw here would not surface as an error
      // — it would silently onboard a chapter with no palette at all.
      for (const input of [undefined, null, "", "☃", "#".repeat(64)]) {
        expect(() => deriveSignetPalette(input)).not.toThrow();
      }
    });
  });
});
