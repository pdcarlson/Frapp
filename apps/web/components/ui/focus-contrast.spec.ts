import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  AA_NON_TEXT,
  accentRolesFor,
  ratio,
  SEEDS,
  SURFACE,
  tint,
} from "@/tests/signet-contrast";
import { buttonVariants } from "./button";
import {
  FOCUS_RING,
  FOCUS_RING_ALWAYS,
  FOCUS_RING_OFFSET,
  FOCUS_RING_WITHIN,
} from "./focus";

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
 * (The engine has held accent-9 to 3:1 since #2541, but without the headroom
 * this recipe needs; see the last test in the first block.)
 *
 * The bordered recipes (`FOCUS_RING`, `FOCUS_RING_ALWAYS`, `FOCUS_RING_WITHIN`)
 * had no contrast assertion at all until #2398 (lock L-07), which is half of
 * why their accent-9 border shipped under 3:1 on 9 of 19 seeds. They are
 * measured in the second block.
 *
 * The guards measure **the token the recipe actually ships**, parsed out of
 * the exported class string, rather than a hard-coded role name. A guard that
 * restated the token would go green against a constant that no longer ships —
 * which is the whole failure mode `shared/elevation-contrast.spec.ts` was
 * written against.
 */

/**
 * The CSS custom property behind a Tailwind `ring-*` or `border-*` utility.
 *
 * Only the roles these recipes can legally draw in; anything else should fail
 * loudly here rather than be silently skipped.
 */
const ACCENT_ROLE: Record<string, string> = {
  ring: "--ring",
  primary: "--primary",
  "accent-text": "--accent-text",
};

/** Pull `foo` out of the `focus-visible:ring-foo` in a recipe. */
function ringRoleOf(recipe: string): string {
  const matches = [
    ...recipe.matchAll(/focus-visible:ring-([a-z-]+)(\/\S+)?/g),
  ].filter((m) => !m[1]!.startsWith("offset-"));
  // A `/NN` opacity modifier would dilute the token this guard measures solid.
  expect(matches.map((m) => m[2])).toEqual(matches.map(() => undefined));
  // `ring-2` / `ring-[3px]` are widths (the pattern skips them) and
  // `ring-offset-*` is the offset band (filtered above).
  const names = matches.map((m) => m[1]!);

  expect(names).toHaveLength(1);
  const role = ACCENT_ROLE[names[0]!];
  expect(
    role,
    `unrecognized ring token "${names[0]}" — add it to ACCENT_ROLE and check its contrast`,
  ).toBeDefined();
  return role!;
}

/**
 * Pull `foo` out of the `<variant>:border-foo` in a bordered recipe, whichever
 * of the three variants it is spelled with.
 */
function borderRoleOf(recipe: string): string {
  const matches = [
    ...recipe.matchAll(
      /(?:focus-visible|focus-within|focus):border-([a-z-]+)(\/\S+)?/g,
    ),
  ];
  // A `/NN` opacity modifier would dilute the token this guard measures solid.
  expect(matches.map((m) => m[2])).toEqual(matches.map(() => undefined));
  const names = matches.map((m) => m[1]!);

  expect(names).toHaveLength(1);
  const role = ACCENT_ROLE[names[0]!];
  expect(
    role,
    `unrecognized border token "${names[0]}" — add it to ACCENT_ROLE and check its contrast`,
  ).toBeDefined();
  return role!;
}

/**
 * Every ladder step a bordered control can be painted on: the whole of
 * `SURFACE`, so a step added to the ladder is measured without an edit here.
 */
const LADDER = Object.values(SURFACE);

const BORDERED = {
  FOCUS_RING,
  FOCUS_RING_ALWAYS,
  FOCUS_RING_WITHIN,
} as const;

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
    // ever moves one of these, the failure tells the next reader the
    // constraint has moved instead of leaving a stale rationale in a comment.
    const failingSeeds = (role: string) =>
      SEEDS.filter(
        (seed) =>
          ratio(accentRolesFor(seed)[role]!, SURFACE.background) < AA_NON_TEXT,
      );
    const worstOn = (role: string, surface: string) =>
      Math.min(
        ...SEEDS.map((seed) => ratio(accentRolesFor(seed)[role]!, surface)),
      );

    // accent-9 was the original defect: it failed on `#006400`, `#8B0000`,
    // `#8B4513` and `#BF0A30`. Since #2541 the engine holds the fill to 3:1 on
    // every ladder surface (accent-engine.md §8), so it no longer fails here.
    // It is still the wrong token for the whole indicator: the floor guarantees
    // 3:1 and nothing more, and its worst seed, `#800000`, is one the engine
    // leaves alone (its generated `#F42F22` already clears), at 4.70:1 with
    // none of the 8:1 headroom the margin test above demands.
    expect(failingSeeds("--primary")).toEqual([]);
    expect(worstOn("--primary", SURFACE.background)).toBeLessThan(8);

    // accent-8 worked on the previous surface ladder and stopped working when
    // the greenfield ladder lifted `--background` to `#131211`. The three that
    // still fail are the achromatic seeds, which all derive the same `#606060`
    // ring. `#4B0082` failed too until #2541 lifted its fill, which moved its
    // whole scale.
    expect(failingSeeds("--ring")).toEqual(["#000000", "#C0C0C0", "#FFFFFF"]);
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

describe("FOCUS_RING, FOCUS_RING_ALWAYS and FOCUS_RING_WITHIN carry focus on their border", () => {
  it("all three swap the border to the same token", () => {
    // One recipe spelled three ways (`focus-visible`, `focus`, `focus-within`).
    // A token moved in one and not the others is the drift this pins.
    const roles = Object.values(BORDERED).map(borderRoleOf);
    expect(new Set(roles).size).toBe(1);
  });

  it.each(Object.entries(BORDERED))(
    "%s's border clears the non-text floor on every seed over every ladder step",
    (_name, recipe) => {
      const role = borderRoleOf(recipe);

      const failures = SEEDS.flatMap((seed) =>
        LADDER.filter(
          (surface) =>
            ratio(accentRolesFor(seed)[role]!, surface) < AA_NON_TEXT,
        ).map((surface) => `${seed} on ${surface}`),
      );

      expect(failures).toEqual([]);
    },
  );

  it("keeps real headroom over the floor, not the bare 3:1 the engine guarantees accent-9", () => {
    const role = borderRoleOf(FOCUS_RING);

    const worst = Math.min(
      ...SEEDS.flatMap((seed) =>
        LADDER.map((surface) => ratio(accentRolesFor(seed)[role]!, surface)),
      ),
    );

    // accent-11's tightest pair is `#BF0A30` over `--popover`, at 6.81:1.
    // The bound sits well under the measurement for the reason the offset
    // recipe's margin test gives.
    expect(worst).toBeGreaterThan(6);
  });

  it("records why --primary was the wrong border, so the swap is not undone as cosmetic", () => {
    // accent-9 conforms on every step since #2541 (the engine floors the fill
    // at 3:1, lifting the 10 seeds that needed it), but with no headroom: its
    // tightest pair is `#800000` over `--popover` at 3.78:1, a fill the lift
    // leaves alone. If an engine change ever moves this, the failure says the
    // constraint moved rather than leaving a stale rationale in a comment.
    const worstPrimary = Math.min(
      ...SEEDS.flatMap((seed) =>
        LADDER.map((surface) =>
          ratio(accentRolesFor(seed)["--primary"]!, surface),
        ),
      ),
    );
    expect(worstPrimary).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(worstPrimary).toBeLessThan(4);
  });

  it("needs the border, because the diluted ring alone fails everywhere", () => {
    // `ring-ring/25` composited over each step: 1.18–1.31:1, 0 of 76 pairs
    // clear 3:1. This is why the border is the load-bearing half, and why a
    // host with no border to swap has no indicator (#2965).
    expect(FOCUS_RING).toContain("focus-visible:ring-ring/25");
    const passing = SEEDS.flatMap((seed) =>
      LADDER.filter((surface) => {
        const halo = tint(accentRolesFor(seed)["--ring"]!, surface, 0.25);
        return ratio(halo, surface) >= AA_NON_TEXT;
      }),
    );
    expect(passing).toEqual([]);
  });

  it("changes a primary button's border on focus, which a --primary swap never did", () => {
    // The case the 2026-09-18 decision asked to measure. The default button
    // is filled `bg-primary` over a reserved `border-transparent`. With the
    // default `border-box` clip the fill paints under that border, so the
    // pixels focus repaints were accent-9 at rest: a `--primary` swap changed
    // nothing, and accent-11 alone would change them by only 1.09:1 on the
    // worst seed (1.01:1 over the hover shade). Clipping the fill to the
    // padding box makes the border show the surface at rest, so focus changes
    // it from the surface to accent-11.
    const primary = buttonVariants({ variant: "default" });
    expect(primary).toContain("bg-primary");
    expect(primary).toContain("border-transparent");
    expect(primary).toContain("bg-clip-padding");
    expect(primary).toContain(FOCUS_RING);

    const role = borderRoleOf(FOCUS_RING);
    const roles = (seed: string) => accentRolesFor(seed);

    // At rest the border pixel is the surface; focused, it is the recipe's
    // token. That change must clear the floor on every seed and step.
    const weakest = Math.min(
      ...SEEDS.flatMap((seed) =>
        LADDER.map((surface) => ratio(roles(seed)[role]!, surface)),
      ),
    );
    expect(weakest).toBeGreaterThanOrEqual(AA_NON_TEXT);

    // Unclipped, the change would be accent-9 (or its hover) to accent-11.
    // Pinned so the clip is not dropped as cosmetic.
    const unclipped = Math.min(
      ...SEEDS.map((seed) =>
        ratio(roles(seed)[role]!, roles(seed)["--primary"]!),
      ),
    );
    expect(unclipped).toBeLessThan(AA_NON_TEXT);
  });
});

describe("the two recipes differ on purpose", () => {
  it("leaves FOCUS_RING's border swap as the half that carries it", () => {
    // `--ring` at 25% composites to ~1.3:1, so the solid border is the signal
    // there. That is why FOCUS_RING may dilute its ring and this one may not.
    expect(FOCUS_RING).toContain("focus-visible:border-accent-text");
    expect(FOCUS_RING).toContain("focus-visible:ring-ring/25");
  });

  it("draws both recipes' signal in the same token", () => {
    expect(borderRoleOf(FOCUS_RING)).toBe(ringRoleOf(FOCUS_RING_OFFSET));
  });

  it("gives FOCUS_RING_OFFSET no border swap to depend on", () => {
    // The defining property of this recipe: it must never repaint the border,
    // because on Switch and TabsTrigger that border encodes state.
    expect(FOCUS_RING_OFFSET).not.toContain("border-");
  });
});

describe("global-error's hand copy of FOCUS_RING", () => {
  it("spells the recipe exactly as the constant does", () => {
    // `app/global-error.tsx` replaces the root layout and may not import the
    // component tree, so it restates the secondary Button's classes, this
    // recipe among them. A token moved here and not there is invisible to
    // every other guard, which only read the constant.
    const source = readFileSync(
      join(__dirname, "..", "..", "app", "global-error.tsx"),
      "utf8",
    );
    expect(source).toContain(FOCUS_RING);
  });
});
