import { describe, expect, it } from "vitest";
import { applyAlpha } from "@repo/color";
import {
  AA_NON_TEXT,
  accentRolesFor,
  HAIRLINE_ALPHA,
  ratio,
  SEEDS,
  SURFACE,
  signetDarkTokens,
} from "@/tests/signet-contrast";
import {
  meterFillClassName,
  meterTrackClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";

/**
 * The defect this file exists for.
 *
 * `/polls` drew its vote tally on a `bg-secondary` track. `--secondary` is an
 * alias of `--card` and the bar sits inside a `<CardContent>`, so the track
 * composited to **exactly 1.000:1** — every poll on the page shipped a bar
 * with no groove behind it, and the class name read fine.
 *
 * Chat's poll card had the right answer already (`bg-input`) and the reference
 * meters a third one (`--popover`), which made this three spellings of one
 * recipe. `components/shared/meter.ts` is now the only spelling; this pins the
 * measurement that chose it, so a later "simplify to the surface ladder" fails
 * loudly rather than reintroducing an invisible track.
 *
 * Everything here reads its values from `signetDarkTokens`, never from a
 * literal — a guard that restates the palette it guards goes green against
 * values that no longer ship.
 */

const WHITE = "#FFFFFF";

/**
 * Parsed from the token for `HAIRLINE_ALPHA`'s reason: `--input` is
 * `rgba(255,255,255,.14)` today, and a hardcoded `0.14` here would stop
 * tracking it the moment the token moves.
 */
const INPUT_ALPHA = Number(
  /rgba\([^)]*,\s*([\d.]+)\)/.exec(signetDarkTokens.color.border.input)?.[1] ??
    "0.14",
);

/** The chosen track. `--background` is the floor, so it is container-agnostic. */
const TRACK = SURFACE.background;

/** Every container a meter can be placed on in this app. */
const CONTAINERS = [
  SURFACE.background,
  SURFACE.surface1,
  SURFACE.card,
  SURFACE.popover,
] as const;

/*
  Derived once per seed rather than per assertion. `accentRolesFor` runs the
  whole accent generator, and the candidate comparison below is 5 candidates ×
  19 seeds — which is fast enough in a plain run and times out the 5s budget
  under `--coverage` instrumentation. The full suite caught that; a targeted
  `vitest run` on this file did not.
*/
const ROLES = new Map(SEEDS.map((seed) => [seed, accentRolesFor(seed)]));

const roleFor = (seed: string, role: string) => ROLES.get(seed)![role]!;
const fillFor = (seed: string) => roleFor(seed, "--primary");

describe("the invisible track", () => {
  it("would have caught bg-secondary on a card — the shipped defect", () => {
    // Not a near-miss. `--secondary` holds `--card`'s value, so this is the
    // container's own colour washed over itself.
    expect(ratio(SURFACE.card, SURFACE.card)).toBeCloseTo(1, 3);
  });

  it("gives the chosen track a groove on the card the poll sits in", () => {
    // Subtler than a raised track, and deliberately so — the relationship
    // that carries the data is fill-against-track, asserted below. The
    // reference accepts the same order of subtlety (its own track is 1.085:1).
    expect(ratio(TRACK, SURFACE.card)).toBeGreaterThan(
      ratio(SURFACE.popover, SURFACE.card),
    );
  });
});

describe("the fix that would itself have been a defect", () => {
  it("would have caught bg-input colliding with a maroon chapter's fill", () => {
    // Adopting chat's already-shipped spelling looked like the safe move: a
    // white wash at 14% is a real 1.540:1 groove against `--card`. But a
    // meter has two relationships and this is the one nobody measured — a
    // maroon `accent-9` lands almost exactly on that wash.
    const inputTrack = applyAlpha(WHITE, INPUT_ALPHA, SURFACE.card);
    const worst = Math.min(
      ...SEEDS.map((seed) => ratio(fillFor(seed), inputTrack)),
    );
    expect(worst).toBeLessThan(1.1);
  });

  it("beats every other candidate on fill-against-track", () => {
    const worstFor = (trackOf: (seed: string) => string) =>
      Math.min(...SEEDS.map((seed) => ratio(fillFor(seed), trackOf(seed))));

    const chosen = worstFor(() => TRACK);
    expect(chosen).toBeGreaterThan(worstFor(() => SURFACE.popover));
    expect(chosen).toBeGreaterThan(
      worstFor(() => applyAlpha(WHITE, INPUT_ALPHA, SURFACE.card)),
    );
    expect(chosen).toBeGreaterThan(
      worstFor(() => applyAlpha(WHITE, HAIRLINE_ALPHA, SURFACE.card)),
    );
    // The accent tint moves with the chapter, which sounds like it should win
    // — but it is still beaten, and it washes out to 1.001:1 inside a dialog.
    expect(chosen).toBeGreaterThan(
      worstFor((seed) => roleFor(seed, "--accent-subtle")),
    );
  });
});

describe("why the track recedes instead of rising", () => {
  it("grooves against both containers a meter is actually placed on", () => {
    // `/polls` renders inside a `<CardContent>` and chat's poll card inside a
    // message card, so `--card` is today's case; `--popover` is asserted
    // because a meter inside a dialog or sheet is one composition away and is
    // exactly where the other candidates fail.
    for (const container of [SURFACE.card, SURFACE.popover]) {
      expect(ratio(TRACK, container)).toBeGreaterThan(1.1);
    }
  });

  it("records that the groove is faintest on --surface-1, which nothing uses", () => {
    // One ladder step from the floor is 1.066:1 — under what `--card` gives
    // and not a usable groove. Recorded rather than enforced: no surface in
    // this app puts a meter on `--surface-1` (the sidebar is the only
    // `--surface-1` region and it holds no meters). If one ever does, this is
    // the number saying it needs its own answer rather than this recipe.
    expect(ratio(TRACK, SURFACE.surface1)).toBeLessThan(1.1);
    expect(CONTAINERS).toContain(SURFACE.surface1);
  });

  it("would have caught the two candidates that wash out inside a dialog", () => {
    // Both are the same 1.000:1 alias failure in a new place: a `--popover`
    // track inside a `DialogContent`, and an accent tint that is 1.001:1 there.
    expect(ratio(SURFACE.popover, SURFACE.popover)).toBeCloseTo(1, 3);
    const worstTint = Math.min(
      ...SEEDS.map((seed) =>
        ratio(roleFor(seed, "--accent-subtle"), SURFACE.popover),
      ),
    );
    expect(worstTint).toBeLessThan(1.01);
    // The chosen track holds there instead.
    expect(ratio(TRACK, SURFACE.popover)).toBeGreaterThan(1.2);
  });
});

describe("the accent fill, across every seeded chapter", () => {
  it("separates from its own track for all 19 seeds", () => {
    // Worst is 1.774:1 under `#800000`. The threshold is set just below the
    // measured worst case rather than at a round number, so a change that
    // erodes it fails here instead of shipping.
    for (const seed of SEEDS) {
      expect(ratio(fillFor(seed), TRACK), `seed ${seed}`).toBeGreaterThan(1.75);
    }
  });

  it("records that no seed's fill clears the non-text floor against the card", () => {
    // Deliberately recorded rather than enforced, the same way
    // `table-contrast.test.ts` records it for row states: at this ladder a
    // proportion fill cannot reach 3:1 for every seed, which is exactly why
    // both call sites print the count and percentage as text beside the bar
    // and mark the bar `aria-hidden`. If a later change makes the bar the only
    // signal, this is the number that says it cannot be.
    const worst = Math.min(...SEEDS.map((seed) => ratio(fillFor(seed), TRACK)));
    expect(worst).toBeLessThan(AA_NON_TEXT);
  });
});

describe("the recipe itself", () => {
  it("keeps one paint and two densities, not two paints", () => {
    // `table-controls.ts`'s split: the paint is written once and the heights
    // name their context. If these diverge, the second spelling is back.
    const paintOf = (recipe: string) =>
      recipe
        .split(" ")
        .filter((token) => !token.startsWith("h-"))
        .join(" ");
    expect(paintOf(meterTrackClassName)).toBe(
      paintOf(meterTrackDenseClassName),
    );
    expect(meterTrackClassName).not.toBe(meterTrackDenseClassName);
  });

  it("paints the track with the token this file measured", () => {
    expect(meterTrackClassName).toContain("bg-background");
    expect(meterFillClassName).toContain("bg-primary");
    // The two spellings this recipe replaced, named so a revert is loud.
    expect(meterTrackClassName).not.toContain("bg-secondary");
    expect(meterTrackClassName).not.toContain("bg-input");
  });
});
