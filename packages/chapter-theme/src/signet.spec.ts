import { describe, expect, it } from "vitest";

import { contrastRatio, normalizeHex, parseHex } from "@repo/color";
import Color from "colorjs.io";

import {
  deriveSignetPalette,
  HOUSE_SEED,
  liftAccent,
  SIGNET_FILL_SURFACES,
  signetAccentSemanticVars,
  signetFillChecks,
  type SignetPalette,
} from "./signet.js";
import { generateRadixColors } from "./vendor/generate-radix-colors.js";

/**
 * Every distinct color `supabase/seed/chapter_directory.csv` has carried — 50
 * real fraternity chapters, 18 distinct after dedupe.
 *
 * Frozen here rather than read from the CSV at test time. The seed file is real
 * production data that gets edited (it was repaired wholesale in #903), and a
 * suite that reads it would change what it asserts whenever that data moves —
 * failing on a data edit, or worse, silently narrowing its own coverage. The
 * point of these values is that they are *awkward* — near-black `#1F1A15`, pure
 * `#FFFFFF` and `#000000`, silver `#C0C0C0`, hot pink `#FF69B4`, and the light
 * gold `#C9A56F` that 45 of the 50 chapters use as their accent.
 *
 * **That freeze has now paid for itself, which is why the count no longer
 * matches the file.** `default_colors` was a `{ dark, accent }` pair when this
 * list was taken: 18 distinct across both halves, of which only 5 were accents.
 * #1225 dropped the dead `dark` half, so the CSV holds 50 values and 5 distinct
 * colors today — `#BF0A30`, `#C0C0C0`, `#C9A56F`, `#FF69B4`, `#FFFFFF`. Reading
 * it at test time would therefore have silently cut this corpus from 18 seeds to
 * those 5, which is the exact narrowing this docstring predicted.
 *
 * Note *which* 13 it would drop, because it is the opposite of what a skim
 * suggests: every dark one. Pure black `#000000`, near-black `#1F1A15`, and the
 * navies, greens and maroons. What survives is the light end alone — white,
 * silver, hot pink and the gold — which is the worst possible corpus for a
 * dark-appearance generator, since the black/white `on-primary` substitution
 * below is exercised precisely by seeds near the luminance crossover. The list
 * stays as it is: these are the stress seeds, and where they came from does not
 * change what the engine owes them.
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

/**
 * The Signet neutral ladder, as the engine measures its fill floor against it.
 * The engine's own constant, not a copy: `packages/theme/src/signet.css.spec.ts`
 * pins it to `signetDarkTokens` and `signet.css`, the ladder that ships.
 */
const LADDER = {
  background: SIGNET_FILL_SURFACES["--background"],
  surface1: SIGNET_FILL_SURFACES["--surface-1"],
  card: SIGNET_FILL_SURFACES["--card"],
  popover: SIGNET_FILL_SURFACES["--popover"],
} as const;

/**
 * The step 9 the generator paints for `seed` before any lift: the §1 call with
 * the seed itself as its accent. Test-only, to tell which seeds the engine
 * lifted. `gray` is restated from the engine's `GENERATOR_PARAMS`; if it drifts,
 * the "lifts exactly" test below sees every seed as lifted and fails.
 */
const unliftedFill = (seed: string) =>
  // normalizeHex: the generator can return shorthand (`#fff`), as the engine
  // handles in `generatedFill`.
  normalizeHex(
    generateRadixColors({
      appearance: "dark",
      gray: "#191919",
      background: LADDER.background,
      accent: seed,
    }).accentScale[8]!,
  );

const oklch = (hex: string) => {
  const [l, c, h] = new Color(hex).to("oklch").coords;
  return { l: l ?? 0, c: c ?? 0, h: h ?? Number.NaN };
};

/**
 * The corpus seeds whose own fill fell under 3:1 on `--popover` before #2541,
 * with the fill each paints now. Measured on the engine, not derived: the
 * point of pinning them is that a generator or colour-library upgrade that
 * moves any of them shows up here first. `#000000`, `#472B62`, `#4B0082` and
 * `#4B1A7E` are the generator's own step 9 (`getStep9Colors` swaps it in for a
 * seed near the dark step 1), so what was lifted is that fill, not the seed.
 */
const LIFTED_FILLS: Record<string, { before: string; after: string }> = {
  "#000000": { before: "#6E6E6E", after: "#707070" },
  "#006400": { before: "#006400", after: "#2C8028" },
  "#472B62": { before: "#8758B4", after: "#895AB6" },
  "#4B0082": { before: "#901FED", after: "#9B32FA" },
  "#4B1A7E": { before: "#8939DE", after: "#9244E8" },
  "#8B0000": { before: "#8B0000", after: "#C34437" },
  "#8B4513": { before: "#8B4513", after: "#A55D2F" },
  "#BF0A30": { before: "#BF0A30", after: "#D42C41" },
  "#CC0000": { before: "#CC0000", after: "#DA2017" },
};

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

  /**
   * accent-engine.md §8's fill floor (#2541). `accent-primary` is the only cue
   * for a state in several consumers (switch track, active tab underline, the
   * focus ring border, poll selection), so WCAG 1.4.11 holds it to 3:1 on every
   * surface it paints on, not just under a label.
   */
  describe("the accent-primary fill clears 3:1 on every ladder surface", () => {
    it("for every seed, as measured and as the engine reports it", () => {
      for (const seed of ALL_SEEDS) {
        const { palette, fillChecks } = deriveSignetPalette(seed);
        const primary = palette["--signet-accent-primary"];
        for (const [name, surface] of Object.entries(LADDER)) {
          expect(
            ratio(primary, surface),
            `${seed} → ${primary} on ${name}`,
          ).toBeGreaterThanOrEqual(3);
        }
        expect(fillChecks, seed).toHaveLength(4);
        for (const check of fillChecks) {
          expect(
            check.passes,
            `${seed}: ${check.role} on ${check.against} = ${check.ratio.toFixed(2)}:1`,
          ).toBe(true);
        }
      }
    });

    it("reports each fill check as measured, and fails one under 3:1", () => {
      // `fillChecks` is what the API logs as `failedFillChecks`, the one
      // detector for a lift that stops working. A check that always passed, or
      // measured some other colour, would silence it while every seed above
      // still cleared.
      const surfaceOf = (against: string) =>
        SIGNET_FILL_SURFACES[against as keyof typeof SIGNET_FILL_SURFACES];
      for (const seed of ALL_SEEDS) {
        const { palette, fillChecks } = deriveSignetPalette(seed);
        const primary = palette["--signet-accent-primary"];
        expect(fillChecks.map((check) => check.against)).toEqual(
          Object.keys(SIGNET_FILL_SURFACES),
        );
        for (const check of fillChecks) {
          expect(check.ratio, `${seed} on ${check.against}`).toBeCloseTo(
            ratio(primary, surfaceOf(check.against)),
            6,
          );
        }
      }
      // Crimson's own fill, before the lift, fails on every surface.
      const unlifted = signetFillChecks("#8B0000");
      expect(unlifted.map((check) => check.passes)).toEqual([
        false,
        false,
        false,
        false,
      ]);
      for (const check of unlifted) {
        expect(check.ratio).toBeCloseTo(
          ratio("#8B0000", surfaceOf(check.against)),
          6,
        );
      }
    });

    it("judges each lift candidate by the fill the generator paints", () => {
      // The generator can swap in its own step 9, so a lifted colour is not
      // necessarily what paints. This one always paints crimson back: every
      // lifted input clears on its own and nothing it paints does, so the only
      // right answer is that no lift clears.
      const paintsCrimson = (accent: string) => {
        const generated = generateRadixColors({
          appearance: "dark",
          gray: "#191919",
          background: LADDER.background,
          accent,
        });
        generated.accentScale[8] = "#8B0000";
        return generated;
      };
      expect(liftAccent("#8B0000", paintsCrimson)).toBeNull();
      const real = liftAccent("#8B0000");
      expect(normalizeHex(real!.generated.accentScale[8]!)).toBe("#C34437");
    });

    it("judges fine-step candidates by the fill the generator paints, too", () => {
      // The coarse walk finds a clearing step, then the fine walk looks for a
      // smaller one. This generator paints truly until a candidate clears and
      // crimson for every call after, so each fine candidate fails as painted
      // even where its lifted input would clear on its own. The only right
      // answer is the coarse step, as it painted.
      const clears = (fill: string) =>
        signetFillChecks(normalizeHex(fill)).every((check) => check.passes);
      let cleared = false;
      const failsAfterFirstClear = (accent: string) => {
        const generated = generateRadixColors({
          appearance: "dark",
          gray: "#191919",
          background: LADDER.background,
          accent,
        });
        if (cleared) generated.accentScale[8] = "#8B0000";
        else if (clears(generated.accentScale[8]!)) cleared = true;
        return generated;
      };
      const lift = liftAccent("#8B0000", failsAfterFirstClear);
      expect(clears(lift!.generated.accentScale[8]!)).toBe(true);
    });

    it("derives hover and the alpha steps from the lifted fill, not the seed", () => {
      // accent-engine.md §8: the lift re-runs the generator so hover, the alpha
      // steps and on-primary all come from the fill that paints. A refactor
      // that swapped in only the lifted step 9 would leave crimson's hover
      // derived from `#8B0000`.
      const lifted = liftAccent("#8B0000")!.generated;
      const seeded = generateRadixColors({
        appearance: "dark",
        gray: "#191919",
        background: LADDER.background,
        accent: "#8B0000",
      });
      const { palette } = deriveSignetPalette("#8B0000");
      expect(palette["--signet-accent-hover"]).toBe(
        normalizeHex(lifted.accentScale[9]!),
      );
      expect(palette["--signet-accent-hover"]).not.toBe(
        normalizeHex(seeded.accentScale[9]!),
      );
      expect(palette["--signet-accent-primary-alpha"]).toBe(
        lifted.accentScaleAlpha[8]!.toUpperCase(),
      );
      expect(palette["--signet-accent-primary-alpha"]).not.toBe(
        seeded.accentScaleAlpha[8]!.toUpperCase(),
      );
    });

    it("lifts exactly the seeds whose own fill failed, and no others", () => {
      // The house seed and `#C9A56F` (45 of the 50 seeded chapters) must come
      // through untouched: the lift is a floor, not a restyle.
      const primaryOf = (seed: string) =>
        deriveSignetPalette(seed).palette["--signet-accent-primary"];
      const lifted = ALL_SEEDS.filter(
        (seed) => primaryOf(seed) !== unliftedFill(seed),
      );
      expect(lifted.sort()).toEqual(Object.keys(LIFTED_FILLS).sort());
      expect(primaryOf(HOUSE_SEED)).toBe(unliftedFill(HOUSE_SEED));
      expect(primaryOf("#C9A56F")).toBe(unliftedFill("#C9A56F"));
    });

    it("lifts a crimson chapter to brick red, the worked example", () => {
      // #8B0000 painted 1.50:1 on `--popover` (1.87:1 on the background). It is
      // the largest shift in the corpus.
      const { palette, resolvedSeed } = deriveSignetPalette("#8B0000");
      expect(resolvedSeed).toBe("#8B0000");
      expect(unliftedFill("#8B0000")).toBe("#8B0000");
      expect(palette["--signet-accent-primary"]).toBe("#C34437");
      expect(ratio("#C34437", LADDER.popover)).toBeGreaterThanOrEqual(3);
      // on-primary stays white, and still clears AA on the lifted fill.
      expect(palette["--signet-accent-on-primary"]).toBe("#FFFFFF");
    });

    it("pins every lifted fill, and changes only its lightness", () => {
      for (const [seed, { before, after }] of Object.entries(LIFTED_FILLS)) {
        const { palette } = deriveSignetPalette(seed);
        const primary = palette["--signet-accent-primary"];
        expect(primary, seed).toBe(after);
        expect(ratio(before, LADDER.popover), seed).toBeLessThan(3);

        const was = oklch(before);
        const now = oklch(primary);
        expect(now.l, seed).toBeGreaterThan(was.l);
        // Hex rounding moves chroma and hue a hair; a real change of colour
        // would move them far more than this.
        expect(Math.abs(now.c - was.c), `${seed} chroma`).toBeLessThan(0.003);
        if (was.c > 0.01) {
          expect(Math.abs(now.h - was.h), `${seed} hue`).toBeLessThan(0.5);
        }
      }
    });

    it("keeps on-primary legible on every lifted fill", () => {
      for (const seed of Object.keys(LIFTED_FILLS)) {
        const { palette } = deriveSignetPalette(seed);
        expect(
          ratio(
            palette["--signet-accent-on-primary"],
            palette["--signet-accent-primary"],
          ),
          seed,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("keeps the generator's contrast color when it is already legible", () => {
    // The house seed is the case that must not regress: Radix picks a custom
    // dark tone that beats both black and white, so `onPrimaryFor` leaves it
    // alone rather than substituting. On the greenfield seed `#DDB844` over the
    // `#131211` background that is `#292109` at 8.37:1; on the previous
    // `#F2B72E` over `#0E0D0B` it was `#2B2009` at 8.82:1. The assertion is the
    // value, but the property under test is that a legible generator choice
    // survives — a substituted `#000000` or `#FFFFFF` here is the regression.
    const { palette } = deriveSignetPalette(HOUSE_SEED);
    expect(palette["--signet-accent-on-primary"]).toBe("#292109");
  });

  it("substitutes black or white only when the generator's choice fails", () => {
    const { palette } = deriveSignetPalette("#C9A56F");
    expect(palette["--signet-accent-on-primary"]).toBe("#000000");
    expect(
      ratio(
        palette["--signet-accent-on-primary"],
        palette["--signet-accent-primary"],
      ),
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
    expect(deriveSignetPalette("#8B0000")).toEqual(
      deriveSignetPalette("#8B0000"),
    );
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

/**
 * The bridge between the persisted `--signet-accent-*` names and the semantic
 * names `foundations.md` §6 gives the accent slot. Pure remapping — the whole
 * risk is that a role gets wired to the wrong step, which no type catches
 * because every value is a string.
 */
describe("signetAccentSemanticVars", () => {
  const { palette } = deriveSignetPalette("#8B0000");
  const semantic = signetAccentSemanticVars(palette);

  it("maps each semantic name to its specified role", () => {
    expect(semantic).toEqual({
      "--primary": palette["--signet-accent-primary"],
      "--primary-hover": palette["--signet-accent-hover"],
      "--primary-foreground": palette["--signet-accent-on-primary"],
      "--ring": palette["--signet-accent-ring"],
      "--accent-subtle": palette["--signet-accent-subtle-bg"],
      "--accent-border": palette["--signet-accent-border"],
      "--accent-text": palette["--signet-accent-text"],
    });
  });

  it("emits no `--signet-` prefixed key", () => {
    // The two naming systems must not leak into each other: this map is for a
    // surface that has already moved its preset to bare `var(--token)`.
    for (const key of Object.keys(semantic)) {
      expect(key.startsWith("--signet-")).toBe(false);
    }
  });

  it("carries the contrast guarantees through unchanged", () => {
    // It is a remap, not a regeneration, so §8's by-construction guarantees
    // must still hold on the renamed roles for every real chapter color.
    for (const seed of REAL_CHAPTER_COLORS) {
      const result = deriveSignetPalette(seed);
      const mapped = signetAccentSemanticVars(result.palette);
      const fg = parseHex(mapped["--primary-foreground"]!);
      const bg = parseHex(mapped["--primary"]!);
      expect(fg, seed).not.toBeNull();
      expect(bg, seed).not.toBeNull();
      expect(contrastRatio(fg!, bg!), seed).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is a pure function of the palette it is handed", () => {
    expect(signetAccentSemanticVars(palette)).toEqual(semantic);
  });
});

/**
 * Which role a consumer may paint as a foreground.
 *
 * §8 holds the accent-derived *text* roles to 4.5:1 and `accent-primary`, the
 * solid fill, only to 3:1. That distinction is easy to lose — `accent-primary`
 * reads like "the chapter's colour" — and losing it ships illegible text
 * rather than a merely off-brand UI. `apps/mobile`'s
 * `useChapterBranding` hands one value to tab tints, glyphs and chip labels,
 * so it reads step 11; these are the numbers that decided that.
 */
describe("accent-text is the foreground-safe role", () => {
  const SURFACES = LADDER;
  /** Drawn on an accent fill — `gold.onHouse` in `@repo/theme`'s Signet tokens. */
  const ON_ACCENT_LABEL = "#2C2000";

  function ratio(a: string, b: string): number {
    return contrastRatio(parseHex(a)!, parseHex(b)!);
  }

  it("clears AA on every step of the neutral ladder, for every real chapter colour", () => {
    for (const seed of REAL_CHAPTER_COLORS) {
      const accentText =
        deriveSignetPalette(seed).palette["--signet-accent-text"];
      for (const [name, surface] of Object.entries(SURFACES)) {
        expect(
          ratio(accentText, surface),
          `${seed} → ${accentText} on ${name}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("also works the other way round, as a chip fill under a fixed label", () => {
    for (const seed of REAL_CHAPTER_COLORS) {
      const accentText =
        deriveSignetPalette(seed).palette["--signet-accent-text"];
      expect(
        ratio(ON_ACCENT_LABEL, accentText),
        `${seed} → label on ${accentText}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("shows why accent-primary is not interchangeable with it", () => {
    // Not a defect in the engine — step 9 is doing its specified job as a fill,
    // paired with `on-primary`, and clears the 3:1 fill floor. The lifted fills
    // sit just past 3:1 by design, so this pins the reason a consumer must not
    // reach for it when it needs a text foreground.
    const illegible = REAL_CHAPTER_COLORS.filter((seed) => {
      const primary =
        deriveSignetPalette(seed).palette["--signet-accent-primary"];
      return ratio(primary, SURFACES.card) < 4.5;
    });
    expect(illegible.length).toBeGreaterThan(0);
  });
});
