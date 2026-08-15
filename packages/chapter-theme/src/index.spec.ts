import { describe, expect, it } from "vitest";

import { derivePalette } from "./index.js";

/**
 * `derivePalette` had no tests at all until this file, and its contrast math was
 * just moved out into `@repo/color`. These values were captured by running the
 * pre-refactor implementation from `06247288` and the refactored one over all 50
 * chapter color pairs in `supabase/seed/chapter_directory.csv` plus five
 * adversarial inputs: all 55 produced byte-identical results. What is pinned
 * here is that verified behavior, so a future change to the shared math cannot
 * silently repaint stored chapter palettes.
 *
 * The palettes are persisted to `chapters.theme_palette` and read by
 * `apps/web/lib/hooks/use-chapter-theme.ts`, so these are live rendered values,
 * not internal detail.
 */
describe("derivePalette", () => {
  it("derives the full token map for a real chapter's colors", () => {
    // Crimson + light gold — the most common accent in the seed data.
    const result = derivePalette({ dark: "#8B0000", accent: "#C9A56F" });

    expect(result.palette).toEqual({
      "--side-bg": "#6B0806",
      "--side-accent": "#C9A56F",
      "--brand-band": "#F0E7D9",
      "--mention-bg": "#F1EADD",
      "--mention-fg": "#7A5A2F",
      "--chat-self-bubble": "#F3EDE2",
      "--reaction-active": "#7A5A2F",
      "--ring": "#7A5A2F",
    });
    expect(result.resolvedDark).toBe("#8B0000");
    expect(result.resolvedAccent).toBe("#C9A56F");
    expect(result.invalidInputs).toEqual({});
  });

  it("falls back per token, not wholesale, when a token fails AA", () => {
    // Light gold clears AA on the dark sidebar but not on bone, so
    // `--side-accent` keeps the chapter's color while the bone-backed text
    // tokens drop to bronze. That split is the whole design of this function.
    const { palette, fallbacks } = derivePalette({
      dark: "#8B0000",
      accent: "#C9A56F",
    });

    expect(palette["--side-accent"]).toBe("#C9A56F");
    expect(fallbacks).toEqual({
      "--mention-fg": true,
      "--reaction-active": true,
      "--ring": true,
    });
  });

  it("escalates past bronze when bronze itself is illegible", () => {
    // White sidebar + yellow accent: yellow fails on bone AND bronze fails on
    // the near-white sidebar, so `--side-accent` must land on something that
    // actually passes rather than on bronze.
    const { palette, fallbacks } = derivePalette({
      dark: "#FFFFFF",
      accent: "#FFFF00",
    });

    expect(fallbacks["--side-accent"]).toBe(true);
    expect(palette["--side-accent"]).toBe("#7A5A2F");
  });

  it("reports unparseable input instead of silently substituting bronze", () => {
    // The #840 regression: the seed CSV shipped 50 values without a leading `#`
    // and every one became bronze with nothing recording it.
    const result = derivePalette({ dark: "not-a-color", accent: "#8B0000" });

    expect(result.invalidInputs).toEqual({ dark: true });
    expect(result.resolvedDark).toBe("#7A5A2F");
    expect(result.resolvedAccent).toBe("#8B0000");
  });

  it("accepts shorthand hex and normalizes case", () => {
    const result = derivePalette({ dark: "#abc", accent: "#DEF" });
    expect(result.invalidInputs).toEqual({});
    expect(result.resolvedDark).toBe("#ABC");
  });

  it("never throws", () => {
    for (const input of [
      { dark: "", accent: "" },
      { dark: "☃", accent: "☃" },
    ]) {
      expect(() => derivePalette(input)).not.toThrow();
    }
  });
});
