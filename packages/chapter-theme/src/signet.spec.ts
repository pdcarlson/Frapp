import { describe, expect, it } from "vitest";

import { contrastRatio, normalizeHex, parseHex } from "@repo/color";
import Color from "colorjs.io";

import {
  deriveSignetPalette,
  HOUSE_SEED,
  liftAccent,
  scaleClears,
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
 * The step 9 fill and step 10 hover the generator paints for `seed` before any
 * lift: the §1 call with the seed itself as its accent. Test-only, to tell
 * which seeds the engine lifted. `gray` is restated from the engine's
 * `GENERATOR_PARAMS`, and the generator reads it only for a pure black or white
 * accent. A chromatic drift moves `#000000`'s fill, which "pins every lifted
 * fill and hover" below catches; an achromatic one (`#303030`, tried) changes
 * no fill this suite checks.
 */
const unlifted = (seed: string) => {
  const { accentScale } = generateRadixColors({
    appearance: "dark",
    gray: "#191919",
    background: LADDER.background,
    accent: seed,
  });
  // normalizeHex: the generator can return shorthand (`#fff`), as the engine
  // handles in `generatedFills`.
  return {
    fill: normalizeHex(accentScale[8]!),
    hover: normalizeHex(accentScale[9]!),
  };
};

const unliftedFill = (seed: string) => unlifted(seed).fill;

const oklch = (hex: string) => {
  const [l, c, h] = new Color(hex).to("oklch").coords;
  return { l: l ?? 0, c: c ?? 0, h: h ?? Number.NaN };
};

/**
 * The corpus seeds whose own scale failed §8 before the lift, with the fill
 * and hover each paints now. Measured on the engine, not derived: the point of
 * pinning them is that a generator or colour-library upgrade that moves any of
 * them shows up here first.
 *
 * `before` is the fill the seed painted unlifted. For nine of the ten it fell
 * under 3:1 on `--popover` (#2541); `#003087`'s `#1C6CFE` cleared at 3.31:1,
 * and it is here for its hover alone, `#1F63DE` at 2.79:1 (#2586). `#000000`,
 * `#003087`, `#472B62`, `#4B0082` and `#4B1A7E` paint the generator's own step
 * 9 (`getStep9Colors` swaps it in for a seed near the dark step 1), so what was
 * lifted is that fill, not the seed.
 */
const LIFTED_FILLS: Record<
  string,
  { before: string; after: string; hover: string }
> = {
  "#000000": { before: "#6E6E6E", after: "#828282", hover: "#767676" },
  "#003087": { before: "#1C6CFE", after: "#2D7BFF", hover: "#1E6DF0" },
  "#006400": { before: "#006400", after: "#41943C", hover: "#33872E" },
  "#472B62": { before: "#8758B4", after: "#9B6CCA", hover: "#8E5FBC" },
  "#4B0082": { before: "#901FED", after: "#AD51FF", hover: "#A042F1" },
  "#4B1A7E": { before: "#8939DE", after: "#A358FC", hover: "#974AEE" },
  "#8B0000": { before: "#8B0000", after: "#D75748", hover: "#C84A3C" },
  "#8B4513": { before: "#8B4513", after: "#B96F41", hover: "#AB6234" },
  "#BF0A30": { before: "#BF0A30", after: "#E94351", hover: "#DA3345" },
  "#CC0000": { before: "#CC0000", after: "#EF3B2D", hover: "#E0291D" },
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

      // accent-text on the background and on its tint, and on-primary on the
      // fill and on the hover shade (#2586).
      expect(contrastChecks).toHaveLength(4);
      for (const check of contrastChecks) {
        expect(
          check.passes,
          `${seed}: ${check.role} on ${check.against} = ${check.ratio.toFixed(2)}:1`,
        ).toBe(true);
      }
    }
  });

  /**
   * accent-engine.md §8's fill floor (#2541, #2586). `accent-primary` is the
   * only cue for a state in several consumers (switch track, active tab
   * underline, the focus ring border, poll selection), so WCAG 1.4.11 holds it
   * to 3:1 on every surface it paints on, not just under a label. Its hover
   * shade is held too: the voted poll option is a primary button, and pointing
   * at it swaps the fill that carries the vote for `accent-hover`.
   */
  describe("the accent-primary fill and its hover clear 3:1 on every ladder surface", () => {
    it("for every seed, as measured and as the engine reports it", () => {
      for (const seed of ALL_SEEDS) {
        const { palette, fillChecks } = deriveSignetPalette(seed);
        for (const role of [
          "--signet-accent-primary",
          "--signet-accent-hover",
        ] as const) {
          for (const [name, surface] of Object.entries(LADDER)) {
            expect(
              ratio(palette[role], surface),
              `${seed} → ${role} ${palette[role]} on ${name}`,
            ).toBeGreaterThanOrEqual(3);
          }
        }
        expect(fillChecks, seed).toHaveLength(8);
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
      const roles = [
        "--signet-accent-primary",
        "--signet-accent-hover",
      ] as const;
      const expectedOrder = roles.flatMap((role) =>
        Object.keys(SIGNET_FILL_SURFACES).map(
          (surface) => `${role} ${surface}`,
        ),
      );
      for (const seed of ALL_SEEDS) {
        const { palette, fillChecks } = deriveSignetPalette(seed);
        expect(
          fillChecks.map((check) => `${check.role} ${check.against}`),
        ).toEqual(expectedOrder);
        for (const check of fillChecks) {
          const role = check.role as (typeof roles)[number];
          expect(
            check.ratio,
            `${seed} ${role} on ${check.against}`,
          ).toBeCloseTo(ratio(palette[role], surfaceOf(check.against)), 6);
        }
      }
      // Crimson's own scale, before the lift, fails on every surface: fill
      // `#8B0000` and hover `#A4130C`.
      const crimson = unlifted("#8B0000");
      const failing = signetFillChecks({
        "--signet-accent-primary": crimson.fill,
        "--signet-accent-hover": crimson.hover,
      });
      expect(failing.map((check) => check.passes)).toEqual(
        Array<boolean>(8).fill(false),
      );
      for (const check of failing) {
        const hex =
          check.role === "--signet-accent-hover" ? crimson.hover : crimson.fill;
        expect(check.ratio).toBeCloseTo(
          ratio(hex, surfaceOf(check.against)),
          6,
        );
      }
      // And a hover under the floor fails on its own, beside a fill that
      // clears: `#003087`'s unlifted scale, the case #2586 added.
      const navy = unlifted("#003087");
      const navyChecks = signetFillChecks({
        "--signet-accent-primary": navy.fill,
        "--signet-accent-hover": navy.hover,
      });
      expect(
        navyChecks
          .filter((check) => !check.passes)
          .map((check) => `${check.role} ${check.against}`),
      ).toEqual(["--signet-accent-hover --popover"]);
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
      expect(normalizeHex(real!.generated.accentScale[8]!)).toBe("#D75748");
    });

    it("judges fine-step candidates by the scale the generator paints, too", () => {
      // The coarse walk finds a clearing step, then the fine walk looks for a
      // smaller one. This generator paints truly until a candidate clears and
      // crimson for every call after, so each fine candidate fails as painted
      // even where its lifted input would clear on its own. The only right
      // answer is the coarse step, as it painted.
      let cleared = false;
      const failsAfterFirstClear = (accent: string) => {
        const generated = generateRadixColors({
          appearance: "dark",
          gray: "#191919",
          background: LADDER.background,
          accent,
        });
        if (cleared) generated.accentScale[8] = "#8B0000";
        else if (scaleClears(generated)) cleared = true;
        return generated;
      };
      const lift = liftAccent("#8B0000", failsAfterFirstClear);
      expect(scaleClears(lift!.generated)).toBe(true);
      expect(normalizeHex(lift!.generated.accentScale[8]!)).not.toBe("#8B0000");
    });

    it("judges each candidate's hover by what the generator paints, too", () => {
      // This generator paints a dark grey hover on every scale. It fails 3:1 on
      // every surface, but a white label reads on it at over 6:1, so a lift
      // that checked only the fill and the label would stop at the first fill
      // that clears under a white label and ship this hover. Hover is judged
      // on its own, so no lift clears.
      const paintsDarkHover = (accent: string) => {
        const generated = generateRadixColors({
          appearance: "dark",
          gray: "#191919",
          background: LADDER.background,
          accent,
        });
        generated.accentScale[9] = "#5A5A5A";
        return generated;
      };
      expect(ratio("#5A5A5A", LADDER.popover)).toBeLessThan(3);
      expect(ratio("#FFFFFF", "#5A5A5A")).toBeGreaterThan(6);
      expect(liftAccent("#8B0000", paintsDarkHover)).toBeNull();
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

    it("lifts exactly the seeds whose own scale failed, and no others", () => {
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

    it("lifts a crimson chapter to a light brick red, the worked example", () => {
      // #8B0000 painted 1.50:1 on `--popover` (1.87:1 on the background), and
      // its hover `#A4130C` 1.91:1. It is the largest shift in the corpus.
      const { palette, resolvedSeed } = deriveSignetPalette("#8B0000");
      expect(resolvedSeed).toBe("#8B0000");
      expect(unliftedFill("#8B0000")).toBe("#8B0000");
      expect(palette["--signet-accent-primary"]).toBe("#D75748");
      expect(palette["--signet-accent-hover"]).toBe("#C84A3C");
      expect(ratio("#C84A3C", LADDER.popover)).toBeGreaterThanOrEqual(3);
      // The label turns black. White cleared AA on #2541's `#C34437` (5.00:1),
      // but no label reads at 4.5:1 on both a fill and a hover this far apart
      // once the hover clears 3:1 (accent-engine.md §8), so the lift runs on
      // until black clears the hover.
      expect(palette["--signet-accent-on-primary"]).toBe("#000000");
      expect(ratio("#000000", "#C84A3C")).toBeGreaterThanOrEqual(4.5);
      expect(ratio("#FFFFFF", "#D75748")).toBeLessThan(4.5);
    });

    it("pins every lifted fill and hover, and changes only the lightness", () => {
      for (const [seed, { before, after, hover }] of Object.entries(
        LIFTED_FILLS,
      )) {
        const { palette } = deriveSignetPalette(seed);
        const primary = palette["--signet-accent-primary"];
        expect(primary, seed).toBe(after);
        expect(palette["--signet-accent-hover"], seed).toBe(hover);
        // `before` is what the seed painted unlifted, and that scale failed:
        // its fill, or (for `#003087`) only its hover.
        const unliftedScale = unlifted(seed);
        expect(unliftedScale.fill, seed).toBe(before);
        expect(
          Math.min(
            ratio(unliftedScale.fill, LADDER.popover),
            ratio(unliftedScale.hover, LADDER.popover),
          ),
          seed,
        ).toBeLessThan(3);

        const was = oklch(before);
        const now = oklch(primary);
        expect(now.l, seed).toBeGreaterThan(was.l);
        // Hex rounding moves chroma and hue a hair; a real change of colour
        // would move them far more than this. The exception is chroma the sRGB
        // gamut cannot hold at the new lightness, which the CSS Color 4 gamut
        // mapping gives up rather than lightness: `#003087`'s blue and
        // `#4B0082`'s violet, both at the gamut's edge, are the corpus cases.
        const keptChromaFits = new Color("oklch", [
          now.l,
          was.c,
          was.h,
        ]).inGamut("srgb");
        if (keptChromaFits) {
          expect(Math.abs(now.c - was.c), `${seed} chroma`).toBeLessThan(0.003);
          if (was.c > 0.01) {
            expect(Math.abs(now.h - was.h), `${seed} hue`).toBeLessThan(0.5);
          }
        } else {
          expect(now.c, `${seed} chroma`).toBeLessThan(was.c);
          // That mapping ends by clipping to sRGB, which it accepts within
          // 0.02 ΔE_OK, so the hue can turn a little (`#4B0082`: 2.6°) but
          // never further than that from the original hue.
          const sameHue = new Color("oklch", [now.l, now.c, was.h]);
          expect(
            sameHue.deltaEOK(new Color(primary)),
            `${seed} hue`,
          ).toBeLessThan(0.02);
        }
      }
    });

    it("keeps on-primary legible on every lifted fill and its hover", () => {
      for (const seed of Object.keys(LIFTED_FILLS)) {
        const { palette } = deriveSignetPalette(seed);
        for (const role of [
          "--signet-accent-primary",
          "--signet-accent-hover",
        ] as const) {
          expect(
            ratio(palette["--signet-accent-on-primary"], palette[role]),
            `${seed} on ${role}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
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
      // Load-bearing: every API writer calls it bare, and onboarding calls it
      // before the chapter row exists, so a throw here fails chapter creation
      // outright (`deriveSignetPalette`'s docstring says why).
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
    // paired with `on-primary`, and clears the 3:1 fill floor. The floor holds
    // it to 3:1, not to 4.5:1, so this pins the reason a consumer must not
    // reach for it when it needs a text foreground.
    const illegible = REAL_CHAPTER_COLORS.filter((seed) => {
      const primary =
        deriveSignetPalette(seed).palette["--signet-accent-primary"];
      return ratio(primary, SURFACES.card) < 4.5;
    });
    expect(illegible.length).toBeGreaterThan(0);
  });
});
