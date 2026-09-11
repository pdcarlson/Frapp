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
 * which is the whole failure mode `shared/elevation-contrast.spec.ts` was
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
  "accent-text": "--accent-text",
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

    // accent-11's tightest seed is `#BF0A30` at 8.4806:1 against a 3.0 floor.
    //
    // The bound is deliberately well under the measurement rather than a hair
    // under it. This assertion previously read `> 3.04` against accent-8's
    // 3.05:1 worst case, which made it a tripwire on an indicator that was one
    // rounding step from non-conformance — and the greenfield ladder duly
    // tripped it. A recipe whose margin needs pinning to two decimal places is
    // the finding; 8:1 says the role has headroom, and a drop below that is a
    // palette change worth stopping on rather than a rounding artifact.
    expect(worst).toBeGreaterThan(8);
  });

  it("records why --primary and --ring are both wrong here, so the swap is not undone as cosmetic", () => {
    // Kept as explicit expectations rather than comments: if a palette change
    // ever made one of these pass, the failure tells the next reader the
    // constraint has moved instead of leaving a stale rationale in a comment.
    const failingSeeds = (role: string) =>
      SEEDS.filter(
        (seed) =>
          ratio(accentRolesFor(seed)[role]!, SURFACE.background) < AA_NON_TEXT,
      );

    // accent-9 never worked here; this is the original defect.
    expect(failingSeeds("--primary")).toEqual([
      "#006400",
      "#8B0000",
      "#8B4513",
      "#BF0A30",
    ]);

    // accent-8 worked on the previous surface ladder and stopped working when
    // the greenfield ladder lifted `--background` to `#131211`. Three of these
    // four are the achromatic seeds, which all derive the same `#606060` ring.
    expect(failingSeeds("--ring")).toEqual([
      "#000000",
      "#4B0082",
      "#C0C0C0",
      "#FFFFFF",
    ]);
  });
});

describe("the offset band fixes the surface the measurement assumes", () => {
  it("keeps ring-offset-background, which is the surface the measurement assumes", () => {
    // The ring's inner edge abuts this 2px band. Drop it and the ring is judged
    // against whatever surface the control happens to sit on — see below.
    expect(FOCUS_RING_OFFSET).toContain("focus-visible:ring-offset-background");
  });

  it("no longer depends on the offset for conformance, and says so", () => {
    const role = ringRoleOf(FOCUS_RING_OFFSET);
    const worstAgainst = (surface: string) =>
      Math.min(
        ...SEEDS.map((seed) => ratio(accentRolesFor(seed)[role]!, surface)),
      );

    // This assertion is INVERTED from what it read before, and the inversion is
    // the point rather than a loosening.
    //
    // While this recipe drew in accent-8, the ring failed 3:1 against every
    // ladder step deeper than `--background` (2.86 on `--surface-1`, 2.69 on
    // `--card`, 2.48 on `--popover`), so the offset band was the only thing
    // guaranteeing a conforming neighbour — it was load-bearing for contrast.
    // On accent-11 the ring clears the floor against every step on its own.
    //
    // So the offset is kept for two weaker but still real reasons — it fixes
    // one comparison surface instead of letting conformance vary by host, and
    // it keeps the ring from abutting the control — and NOT because the ring
    // would otherwise fail. Pinning the true relationship means a future move
    // back down the accent scale fails here, where the rationale lives.
    for (const surface of [SURFACE.surface1, SURFACE.card, SURFACE.popover]) {
      expect(worstAgainst(surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
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
