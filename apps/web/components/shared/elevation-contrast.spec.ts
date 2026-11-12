import { describe, expect, it } from "vitest";
import { applyAlpha, parseHex, relativeLuminance } from "@repo/color";
import {
  AA_NON_TEXT,
  AA_TEXT,
  accentRolesFor,
  CARD_HOVER,
  HAIRLINE_ALPHA,
  ratio,
  SEEDS,
  SEMANTIC,
  SURFACE,
  statusTint,
  INDISTINGUISHABLE,
  TEXT,
} from "@/tests/signet-contrast";

/**
 * The defect this file exists for.
 *
 * Chapter Ops shipped two fills that composited to **exactly 1.000:1** — not
 * the 1.085:1 near-miss `components/shared/table-contrast.spec.ts` pins for a
 * card-seated row, but a container's own colour washed over itself. Both
 * survived review twice because the class names read fine: `bg-accent/40` on a
 * dialog and `bg-secondary/40` on a card are only wrong once you know that
 * `--accent` was an alias of `--popover` and `--secondary` an alias of `--card`.
 *
 * Both aliases are deleted (#3036). The two tests below stay as the record of
 * why they were wrong: a wash of a colour over itself composites to that
 * colour, so a surface step washed over the same step is nothing. That holds
 * for any value, so they pin no token; `packages/theme/src/signet.css.spec.ts`
 * keeps the aliases from being declared again.
 *
 * It lives in `shared/` for `table-contrast.spec.ts`'s reason: four families
 * composited the same ladder mistake here, and the families whose #920 slice
 * has not landed will inherit it.
 *
 * These are the values. They cannot see who reaches for a token, and would
 * stay green through a revert of every call site they were written for, so
 * the call-site half is `elevation-call-sites.spec.ts` beside this file.
 */

const luminance = (hex: string) => relativeLuminance(parseHex(hex)!);

describe("the aliases that made two fills invisible (deleted, #3036)", () => {
  // These two stay as the record of why the ShadCN names were wrong (see the
  // file header: they hold for any value): the scaffold's `--accent`
  // held `--popover`'s value and its `--secondary` held `--card`'s, so a wash
  // of either over its own container composited to the container.
  it("a --popover wash inside a dialog is nothing, which is what bg-accent was", () => {
    // `event-editor-dialog`'s role rows were `hover:bg-accent/40` inside a
    // `DialogContent`, which *is* `--popover`.
    const composited = applyAlpha(SURFACE.popover, 0.4, SURFACE.popover);
    expect(ratio(composited, SURFACE.popover)).toBeCloseTo(1, 3);
  });

  it("a --card wash inside a card is nothing, which is what bg-secondary was", () => {
    // `geofences-admin-page`'s coordinate list was `bg-secondary/40` inside a
    // `CardContent`. `shared/subscription-gate.tsx` records the same pair.
    const composited = applyAlpha(SURFACE.card, 0.4, SURFACE.card);
    expect(ratio(composited, SURFACE.card)).toBeCloseTo(1, 3);
  });
});

describe("every ladder step is perceptibly its own surface (#3826, #2399)", () => {
  // The floor the 2026-11-12 ladder was chosen to clear. Before it, the steps
  // were 1.05 / 1.05 / 1.08 and nothing asserted a minimum: the pins in this
  // file only recorded that two fills aliased, so a ladder could get tighter
  // and stay green. This one fails if any adjacent pair drops under the bound.
  const LADDER = [
    ["--background", SURFACE.background],
    ["--surface-1", SURFACE.surface1],
    ["--card", SURFACE.card],
    ["--popover", SURFACE.popover],
  ] as const;
  it.each(LADDER.slice(1).map((step, i) => [LADDER[i]![0], step[0], LADDER[i]![1], step[1]]))(
    "%s to %s",
    (_lower, _upper, lower, upper) => {
      expect(luminance(upper)).toBeGreaterThan(luminance(lower));
      expect(ratio(upper, lower)).toBeGreaterThanOrEqual(INDISTINGUISHABLE);
    },
  );
});

describe("a state cannot elevate above the step it renders in", () => {
  it("would have caught the attendance panel's card inside a sheet", () => {
    // `--popover` is the top of the ladder, so a `--card` panel inside a
    // `SheetContent` is a step DOWN — it reads as a hole, not as elevation.
    // Until the 2026-11-12 ladder (#3826) the step was also imperceptible;
    // now it is visible (1.16:1), which makes the hole plainer, not better.
    expect(ratio(SURFACE.card, SURFACE.popover)).toBeCloseTo(1.163, 2);
    expect(luminance(SURFACE.card)).toBeLessThan(luminance(SURFACE.popover));
  });

  it("shows that dropping the fill improves the boundary rather than costing one", () => {
    // This is the whole argument for `nested-states` over a `<Card>` here, and
    // it is the assertion that should fail if someone "restores the Card for
    // consistency": the hairline over `--popover` separates better from
    // `--popover` than the card's own hairline does.
    const hairlineOverCard = applyAlpha(
      "#ffffff",
      HAIRLINE_ALPHA,
      SURFACE.card,
    );
    const hairlineOverPopover = applyAlpha(
      "#ffffff",
      HAIRLINE_ALPHA,
      SURFACE.popover,
    );
    const withFill = ratio(hairlineOverCard, SURFACE.popover);
    const withoutFill = ratio(hairlineOverPopover, SURFACE.popover);
    expect(withFill).toBeLessThan(withoutFill);
    expect(withoutFill).toBeGreaterThan(1.25);
  });

  it("keeps a nested state's fill off its container entirely", () => {
    // The `Card > CardContent > EmptyState` case, four of which this family
    // shipped: `--card` on `--card`.
    expect(ratio(SURFACE.card, SURFACE.card)).toBeCloseTo(1, 3);
  });
});

describe("hairlines are load-bearing, so their alpha is not a free parameter", () => {
  it("would have caught divide-border/70", () => {
    // Five row lists diluted the token to 0.056. §2 makes the hairline the
    // edge once elevation is ~1.12:1, and §3 rule 3 bans one-off values.
    const atToken = ratio(
      applyAlpha("#ffffff", HAIRLINE_ALPHA, SURFACE.card),
      SURFACE.card,
    );
    const diluted = ratio(
      applyAlpha("#ffffff", HAIRLINE_ALPHA * 0.7, SURFACE.card),
      SURFACE.card,
    );
    expect(diluted).toBeLessThan(atToken);
    // Neither clears §6's 3:1 non-text floor and at this ladder neither can —
    // recorded so the numbers are not mistaken for a passing grade.
    expect(atToken).toBeLessThan(AA_NON_TEXT);
  });
});

describe("the amber notices were a light-mode island", () => {
  it("would have caught bg-amber-50 shipping on the dark shell", () => {
    // Nothing sets `.dark`, so the `dark:` half never applied and the light
    // branch painted on `--popover`.
    expect(ratio("#fffbeb", SURFACE.popover)).toBeGreaterThan(10);
  });

  it("puts the warning tint's text over the gate on both surfaces it lands on", () => {
    // The replacement, matching `shared/subscription-gate.tsx`'s definite
    // branch. Unlifted, per components.md §5 — only danger needs §1's lift.
    for (const name of ["card", "popover"] as const) {
      expect(
        ratio(SEMANTIC.warning, statusTint("warning", SURFACE[name])),
        `--warning on its own tint over ${name}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

/**
 * Every ladder step a control can sit on, derived rather than listed, so a step
 * added to `signetDarkTokens` is measured against `--card-hover` without an edit
 * here (`focus-contrast.spec.ts` derives its ladder the same way).
 */
const STEPS = Object.entries(SURFACE);

describe("a card-filled control hovers above the ladder (#1220)", () => {
  /*
   * The Secondary button's hover was the elevated step, `hover:bg-accent`. On a
   * card that moved it 1.105:1; inside a dialog, which IS `--popover`, it
   * painted the button in the dialog's own colour (the wash test at the top).
   * There is no step above `--popover` to borrow, so `--card-hover` is one: the
   * elevated step lifted toward white, which is distinct from every step by
   * being above all of them.
   */
  it("is the lowest neutral perceptibly above --popover, so a ladder change cannot leave it behind", () => {
    // An opaque literal (no `color-mix` floor), held to its derivation here
    // rather than trusted to be re-derived by whoever next moves the ladder.
    // Until the 2026-11-12 ladder (#3826) the derivation was `--popover` lifted
    // 6% toward white; on the lighter `--popover` that overshot what the text
    // on it can afford (role-colors-contrast.spec.ts), so it is now the first
    // neutral grey that clears the perceptible bound, and no higher.
    const grey = (v: number) =>
      "#" + v.toString(16).padStart(2, "0").toUpperCase().repeat(3);
    let v = parseHex(SURFACE.popover)!.r;
    while (ratio(grey(v), SURFACE.popover) < INDISTINGUISHABLE) v += 1;
    expect(CARD_HOVER.toUpperCase()).toBe(grey(v));
  });

  it.each(STEPS)("reads as a state on %s", (_name, step) => {
    // The rest fill is `--card` on every one of these, so the `--card` row is
    // also the rest-to-hover delta wherever the button sits.
    expect(ratio(CARD_HOVER, step)).toBeGreaterThan(INDISTINGUISHABLE);
  });

  it.each([
    ["foreground", TEXT.foreground],
    ["muted-foreground", TEXT.mutedForeground],
    ["muted", TEXT.muted],
  ] as const)("keeps %s text over the text gate on it", (_name, tone) => {
    // A hovered row's title, its sub-line and its timestamp all sit on it,
    // and since 2026-11-09 it is also the quiet fill under text. `--muted` is
    // the one the 2026-11-12 ladder (#3826) had to lift for: at `#9E9E9E` it
    // fell to 4.18:1 here. The 7:1 reading floor is the four ladder steps';
    // on this state fill the gate is AA (`--muted-foreground` 6.42:1).
    expect(ratio(tone, CARD_HOVER)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("does not need a chapter: a white alpha would have, and failed on --background", () => {
    // The recipe weighed first: `rgba(255,255,255,.06)` tracks its container
    // the way a hairline does, which is the problem. Over `--background` it
    // composited to about the button's own card rest fill on the 2026-11-05
    // ladder, so hovering a page level Secondary button changed nothing. On
    // the 2026-11-12 ladder (#3826) it lands *under* the card rest fill, so
    // the hover would step down instead: the same defect, the other way.
    const alphaOverBackground = applyAlpha("#ffffff", 0.06, SURFACE.background);
    expect(luminance(alphaOverBackground)).toBeLessThan(luminance(SURFACE.card));
  });
});

/** #1208's floor: no row hover in the shell sits under this against its container. */
const ROW_HOVER_FLOOR = 1.03;

describe("the notification list's rows hover off the popover (#1208)", () => {
  // The list is a `PopoverContent`, so every row's container is `--popover`.
  // Rows are flat and transparent there (components.md § Chrome weight).

  it("lifts a row off the sheet with --card-hover", () => {
    expect(ratio(CARD_HOVER, SURFACE.popover)).toBeGreaterThan(
      INDISTINGUISHABLE,
    );
  });

  it("would have left a row on the sheet's own luminance with the accent tint", () => {
    // The accent tint separates by hue alone (§2 retired it for menu and table
    // rows on 2026-11-05 for that reason). On the sheet it lands within
    // 1.03:1 of `--popover` for several seeds (`#1F4E79` measured 1.000:1),
    // which is why the drawer's rows take the neutral lift instead.
    const worst = Math.min(
      ...SEEDS.map((seed) =>
        ratio(accentRolesFor(seed)["--accent-subtle"]!, SURFACE.popover),
      ),
    );
    expect(worst).toBeLessThan(ROW_HOVER_FLOOR);
  });
});

describe("an overlay's close control is text-toned (#1208)", () => {
  // `ui/dialog.tsx` and `ui/sheet.tsx` draw the same accessibly named "Close"
  // glyph on `--popover`. `--muted` missed the gate here (3.52:1) until the
  // 2026-11-09 text ladder (foundations.md §4, #3826); both tones now clear it.
  it("clears the text gate in --muted too", () => {
    expect(ratio(TEXT.muted, SURFACE.popover)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("clears the text gate in --muted-foreground", () => {
    expect(ratio(TEXT.mutedForeground, SURFACE.popover)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});
