import { describe, expect, it } from "vitest";

import {
  AA_NORMAL,
  applyAlpha,
  contrastRatio,
  meetsContrast,
  mixHex,
  normalizeHex,
  parseHex,
  pickAccessibleColor,
  relativeLuminance,
  roundRatio,
} from "./index";

const rgb = (hex: string) => {
  const parsed = parseHex(hex);
  if (!parsed) throw new Error(`test fixture is not a hex color: ${hex}`);
  return parsed;
};

describe("normalizeHex", () => {
  it("expands 3-digit hex and uppercases", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("#7a5a2f")).toBe("#7A5A2F");
    expect(normalizeHex("  #FFF  ")).toBe("#FFFFFF");
  });

  it("returns empty string for anything that is not a 3- or 6-digit hex", () => {
    // 4- and 5-digit inputs are the case #236 called out: a `{3,6}` quantifier
    // accepts them, and they are always a typo rather than a color.
    for (const input of ["#1234", "#12345", "#GGGGGG", "red", "", "1F1A15"]) {
      expect(normalizeHex(input)).toBe("");
    }
  });
});

describe("contrastRatio", () => {
  // Golden values, computed independently of this implementation. If the math
  // drifts these move, which is the point — they are not snapshots of intent.
  it.each([
    ["#000000", "#FFFFFF", 21],
    ["#7A5A2F", "#FFFFFF", 6.3],
    ["#D6B988", "#1F1A15", 9.17],
    ["#C9A56F", "#F7F3EC", 2.09],
  ])("%s on %s is %s:1", (foreground, background, expected) => {
    expect(roundRatio(contrastRatio(rgb(foreground), rgb(background)))).toBe(
      expected,
    );
  });

  it("is symmetric", () => {
    expect(contrastRatio(rgb("#123456"), rgb("#FEDCBA"))).toBeCloseTo(
      contrastRatio(rgb("#FEDCBA"), rgb("#123456")),
      12,
    );
  });

  it("returns the exact ratio, unrounded", () => {
    expect(contrastRatio(rgb("#006FFB"), rgb("#FFFFFF"))).toBeCloseTo(
      4.499888,
      5,
    );
  });
});

describe("meetsContrast", () => {
  /**
   * The regression lock for the rounding contract.
   *
   * `#006FFB` scores 4.499888 against white — below AA, but it rounds to 4.50.
   * `packages/theme`'s accent resolver has always compared the rounded value, so
   * this color and the ~9,000 others in the `[4.495, 4.5)` band render today on
   * the web dashboard and in the mobile app. Extracting the math here must not
   * quietly tighten that, so rounding is an explicit per-caller option.
   *
   * If either expectation below flips, live chapter accents repaint.
   */
  it("honors the rounding policy at the AA boundary", () => {
    const accent = rgb("#006FFB");
    const white = rgb("#FFFFFF");

    expect(meetsContrast(accent, white, { round: true })).toBe(true);
    expect(meetsContrast(accent, white, { round: false })).toBe(false);
  });

  it("compares exactly by default", () => {
    expect(meetsContrast(rgb("#006FFB"), rgb("#FFFFFF"))).toBe(false);
  });

  it("respects a custom minimum", () => {
    // 2.63:1 clears nothing at AA but is above a 2.0 floor.
    const pair = [rgb("#7A5A2F"), rgb("#221E18")] as const;
    expect(meetsContrast(...pair, { minimum: AA_NORMAL })).toBe(false);
    expect(meetsContrast(...pair, { minimum: 2 })).toBe(true);
  });
});

describe("pickAccessibleColor", () => {
  // The bronze/lighter-bronze/bone ladder `packages/chapter-theme` walks.
  const LADDER = ["#7A5A2F", "#C8A062", "#F7F3EC"] as const;

  it("returns the first candidate that clears the threshold", () => {
    // Bronze is legible on bone, so the ladder stops immediately.
    expect(pickAccessibleColor(LADDER, rgb("#F7F3EC"))).toBe("#7A5A2F");
  });

  /**
   * This is #797's defect, stated as a test.
   *
   * Bronze scores 2.63:1 on the dark card — worse than inputs it would be
   * substituted for. A resolver that emits its fallback unchecked would return
   * bronze here; escalating through the ladder returns a legible color instead.
   */
  it("escalates past a fallback that is itself illegible", () => {
    const onDarkCard = pickAccessibleColor(LADDER, rgb("#221E18"));

    expect(onDarkCard).not.toBe("#7A5A2F");
    expect(meetsContrast(rgb(onDarkCard), rgb("#221E18"))).toBe(true);
  });

  it("returns null when no candidate passes", () => {
    expect(pickAccessibleColor(["#FFFFFF", "#FEFEFE"], rgb("#FFFFFF"))).toBe(
      null,
    );
  });

  /**
   * A ladder anchored at ink and bone is not automatically safe. Mid-tone
   * backgrounds fail against both ends, which is why this returns null instead
   * of quietly emitting its last entry — the caller has to name a last resort.
   */
  it("runs dry on a mid-tone background", () => {
    expect(pickAccessibleColor(["#1F1A15", "#FAF7F2"], rgb("#767676"))).toBe(
      null,
    );
  });

  it("skips unparseable candidates rather than emitting them", () => {
    expect(pickAccessibleColor(["not-a-color", "#000000"], rgb("#FFFFFF"))).toBe(
      "#000000",
    );
  });
});

describe("mixHex / applyAlpha", () => {
  it("mixes at the endpoints and the midpoint", () => {
    expect(mixHex("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mixHex("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  it("flattens alpha over an opaque background", () => {
    expect(applyAlpha("#FFFFFF", 0, "#123456")).toBe("#123456");
    expect(applyAlpha("#FFFFFF", 1, "#123456")).toBe("#FFFFFF");
  });

  // Deliberately not asserted: the exact rounding of intermediate channel
  // values. Callers persist these as brand tokens, so the values are pinned by
  // the chapter-theme palette tests against real chapter colors rather than
  // here, where a hand-picked pair would only restate the arithmetic.
});

describe("relativeLuminance", () => {
  it("anchors at the ends of the range", () => {
    expect(relativeLuminance(rgb("#000000"))).toBe(0);
    expect(relativeLuminance(rgb("#FFFFFF"))).toBeCloseTo(1, 12);
  });
});
