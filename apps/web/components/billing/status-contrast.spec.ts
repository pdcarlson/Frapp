import { describe, expect, it } from "vitest";
import {
  AA_TEXT,
  accentRolesFor,
  DESTRUCTIVE_TEXT,
  ratio,
  SEEDS,
  SEMANTIC,
  SURFACE,
  tint,
} from "@/tests/signet-contrast";

/**
 * Contrast for the §5 Semantic badge, which billing and points state status in.
 *
 * Two defects sit behind this file. The first is the ordinary kind: danger text
 * on a danger tint misses the gate and needs §1's lift, which is why
 * `--destructive-text` exists — and success and warning, added in this slice,
 * had to be measured rather than assumed to need one too.
 *
 * The second is the interesting kind, and it is not a contrast failure at all
 * in the usual sense. `/billing` painted `PAID` with the *accent* badge — the
 * chapter's own colour. Nothing about that pairing is unreadable. What it is,
 * is **indistinguishable from a different status** under the chapters most
 * likely to care: a green-accented chapter's accent badge is its success badge,
 * and a red-accented chapter's is its danger badge. `writing.md` §5 says status
 * colour is never decorative; these assertions are why that is a measurement
 * rather than a matter of taste.
 *
 * Seed corpus and the shared helpers: `tests/signet-contrast.ts`.
 */

const accentSubtleFor = (seed: string) =>
  accentRolesFor(seed)["--accent-subtle"]!;

describe("the Semantic badge kinds", () => {
  it("puts success and warning text over the gate on their own tint, unlifted", () => {
    // The measurement that decided these two ship without a `--destructive-text`
    // twin. If a ladder change ever pushes one under 4.5, this fails and the
    // remedy is §1's lift, not a hue change.
    for (const [name, bg] of Object.entries(SURFACE)) {
      expect(
        ratio(SEMANTIC.success, tint(SEMANTIC.success, bg)),
        `--success on its own tint over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
      expect(
        ratio(SEMANTIC.warning, tint(SEMANTIC.warning, bg)),
        `--warning on its own tint over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("still needs the lift for danger, on the two surfaces a badge lands on", () => {
    for (const name of ["card", "popover"] as const) {
      const bg = SURFACE[name];
      expect(
        ratio(SEMANTIC.destructive, tint(SEMANTIC.destructive, bg)),
        `unlifted --destructive on its own tint over ${name}`,
      ).toBeLessThan(AA_TEXT);
      expect(
        ratio(DESTRUCTIVE_TEXT, tint(SEMANTIC.destructive, bg)),
        `--destructive-text on the danger tint over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("records that --info would need a lift before it gets a first call site", () => {
    // There is no `info` badge kind, because there is no `info` call site — and
    // a variant with no call sites is what slice 2 deleted seven of. This is
    // here so whoever adds the first one inherits the number instead of the
    // defect: `--info` behaves exactly as `--destructive` did.
    expect(
      ratio(SEMANTIC.info, tint(SEMANTIC.info, SURFACE.popover)),
      "--info on its own tint over --popover",
    ).toBeLessThan(AA_TEXT);
  });
});

describe("status colour is never decorative", () => {
  it("would have caught PAID painted in the chapter accent", () => {
    // Under a green-seeded chapter the accent badge and the success badge are
    // the same pixels; under a red-seeded one the accent badge and the danger
    // badge are. So a chapter whose brand is green could not tell PAID from
    // PAID, and a chapter whose brand is red read PAID as OVERDUE — which is
    // the wrong direction to be wrong about money.
    const successTint = tint(SEMANTIC.success, SURFACE.card);
    const dangerTint = tint(SEMANTIC.destructive, SURFACE.card);

    expect(
      ratio(accentSubtleFor("#006400"), successTint),
      "a green chapter's accent badge vs the success badge",
    ).toBeLessThan(1.1);

    for (const seed of ["#8B0000", "#BF0A30", "#CC0000"] as const) {
      expect(
        ratio(accentSubtleFor(seed), dangerTint),
        `${seed} accent badge vs the danger badge`,
      ).toBeLessThan(1.2);
    }
  });

  it("keeps the semantic hues off the accent engine entirely, for every seed", () => {
    // The other half: a status must read the same under every chapter. None of
    // these is derived, so none of them moves.
    for (const seed of SEEDS) {
      const accent = accentSubtleFor(seed);
      for (const [name, hue] of Object.entries(SEMANTIC)) {
        expect(hue, `${seed} ${name}`).not.toBe(accent);
      }
    }
  });
});

describe("the #916 pair", () => {
  it("would have caught `text-emerald-700` on a card", () => {
    // Stock Tailwind emerald-700, which is what the points amounts rendered in
    // and what #916 is about. `--success` is the same intent, measured.
    expect(ratio("#047857", SURFACE.card)).toBeLessThan(AA_TEXT);
    expect(ratio(SEMANTIC.success, SURFACE.card)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the negative branch on the solid, because the lift is for tints only", () => {
    // Written the other way round first, and this assertion is what corrected
    // it. A negative points amount is danger text on a plain `--card` cell, not
    // on a danger tint, and the solid clears the gate there (4.72–5.79 across
    // the whole ladder). Reaching for `--destructive-text` outside a tint
    // over-applies §1's lift — the rule is "where a *drawn* tone measures below
    // the floor", and here it does not.
    for (const [name, bg] of Object.entries(SURFACE)) {
      expect(
        ratio(SEMANTIC.destructive, bg),
        `--destructive on plain ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("the warning notice", () => {
  it("clears the gate on the two surfaces the amber blocks landed on", () => {
    // `/billing`'s preview card sits on `--background`; the invite dialog's
    // notice sits on `--popover`. Both were stock amber with an inert `dark:`
    // twin before this slice.
    for (const name of ["background", "popover"] as const) {
      expect(
        ratio(SEMANTIC.warning, tint(SEMANTIC.warning, SURFACE[name])),
        `warning notice over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
