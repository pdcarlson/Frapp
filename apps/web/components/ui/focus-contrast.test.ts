import { describe, expect, it } from "vitest";
import {
  AA_NON_TEXT,
  accentRolesFor,
  ratio,
  SEEDS,
  SURFACE,
} from "@/tests/signet-contrast";
import { FOCUS_RING, FOCUS_RING_OFFSET } from "./focus";

/**
 * The defect this file exists for.
 *
 * `FOCUS_RING_OFFSET` drew its ring in `--primary` (accent-9). That recipe is
 * used precisely by controls with no border to swap — `Switch`, whose border
 * carries on/off, and `TabsTrigger`, whose bottom border *is* the selected
 * indicator — so unlike `FOCUS_RING`, the ring is the entire focus indicator
 * and has to clear README §6's 3:1 non-text floor unaided. On five of the 19
 * seeded chapter accents it did not, which means a keyboard user on those
 * chapters got no conforming indicator on any control using this recipe.
 *
 * The guard measures **the token the recipe actually ships**, parsed out of the
 * exported class string, rather than a hard-coded role name. A guard that
 * restated the token would go green against a constant that no longer ships —
 * which is the whole failure mode `shared/elevation-contrast.test.ts` was
 * written against.
 */

/**
 * The CSS custom property behind a Tailwind `ring-*` utility.
 *
 * Only the roles these recipes can legally draw in; anything else should fail
 * loudly here rather than be silently skipped.
 */
const RING_ROLE: Record<string, string> = {
  ring: "--ring",
  primary: "--primary",
};

/** Pull `foo` out of the `focus-visible:ring-foo` in a recipe. */
function ringRoleOf(recipe: string): string {
  const names = [...recipe.matchAll(/focus-visible:ring-([a-z-]+)/g)]
    .map((m) => m[1]!)
    // `ring-2` / `ring-[3px]` are widths and `ring-offset-*` is the offset band.
    .filter((n) => n !== "offset-2" && !n.startsWith("offset-"));

  expect(names).toHaveLength(1);
  const role = RING_ROLE[names[0]!];
  expect(
    role,
    `unrecognized ring token "${names[0]}" — add it to RING_ROLE and check its contrast`,
  ).toBeDefined();
  return role!;
}

describe("FOCUS_RING_OFFSET is the whole indicator, so its ring must clear 3:1 alone", () => {
  it("draws in a token that clears the non-text floor on every seeded accent", () => {
    const role = ringRoleOf(FOCUS_RING_OFFSET);

    const failures = SEEDS.filter(
      (seed) =>
        ratio(accentRolesFor(seed)[role]!, SURFACE.background) < AA_NON_TEXT,
    );

    expect(failures).toEqual([]);
  });

  it("keeps a real margin over the floor, so a palette shift cannot silently erode it", () => {
    const role = ringRoleOf(FOCUS_RING_OFFSET);

    const worst = Math.min(
      ...SEEDS.map((seed) =>
        ratio(accentRolesFor(seed)[role]!, SURFACE.background),
      ),
    );

    // `#4B0082` is the tightest seed at ~3.05:1. Pinned a hair under so an
    // ordinary rounding change is not a failure, but an actual regression is.
    expect(worst).toBeGreaterThan(3.04);
  });

  it("records why --primary was wrong here, so the swap is not undone as cosmetic", () => {
    // The five that shipped without a conforming indicator. Kept as an explicit
    // expectation rather than a comment: if a palette change ever made accent-9
    // pass, this failing tells the next reader the constraint has moved.
    const failures = SEEDS.filter(
      (seed) =>
        ratio(accentRolesFor(seed)["--primary"]!, SURFACE.background) <
        AA_NON_TEXT,
    );

    expect(failures).toEqual([
      "#006400",
      "#1F4E79",
      "#800000",
      "#8B0000",
      "#8B4513",
    ]);
  });
});

describe("the offset band is load-bearing, not decoration", () => {
  it("keeps ring-offset-background, which is the surface the measurement assumes", () => {
    // The ring's inner edge abuts this 2px band. Drop it and the ring is judged
    // against whatever surface the control happens to sit on — see below.
    expect(FOCUS_RING_OFFSET).toContain("focus-visible:ring-offset-background");
  });

  it("shows the ring does NOT clear 3:1 against the deeper ladder steps", () => {
    const role = ringRoleOf(FOCUS_RING_OFFSET);
    const worstAgainst = (surface: string) =>
      Math.min(
        ...SEEDS.map((seed) => ratio(accentRolesFor(seed)[role]!, surface)),
      );

    // Why the offset exists: on a card or a popover the ring alone would fail,
    // so the band of --background is what guarantees a conforming neighbour.
    expect(worstAgainst(SURFACE.surface1)).toBeLessThan(AA_NON_TEXT);
    expect(worstAgainst(SURFACE.card)).toBeLessThan(AA_NON_TEXT);
    expect(worstAgainst(SURFACE.popover)).toBeLessThan(AA_NON_TEXT);
  });
});

describe("the two recipes differ on purpose", () => {
  it("leaves FOCUS_RING's border swap as the half that carries it", () => {
    // `--ring` at 25% composites to ~1.3:1, so the solid border is the signal
    // there. That is why FOCUS_RING may dilute its ring and this one may not.
    expect(FOCUS_RING).toContain("focus-visible:border-primary");
    expect(FOCUS_RING).toContain("focus-visible:ring-ring/25");
  });

  it("gives FOCUS_RING_OFFSET no border swap to depend on", () => {
    // The defining property of this recipe: it must never repaint the border,
    // because on Switch and TabsTrigger that border encodes state.
    expect(FOCUS_RING_OFFSET).not.toContain("border-");
  });
});
