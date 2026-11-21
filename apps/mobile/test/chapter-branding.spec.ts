import { describe, expect, it } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  chapterBrandingMock,
  MUTED_GOLD_BRANDING,
  PURPLE_BRANDING,
} from "./chapter-branding";

const gold = signetDarkTokens.color.gold;

describe("chapter branding fixtures", () => {
  // The purple chapter exists to catch a control that slips back to a house
  // gold token; it can only do that while none of its colours is one.
  it("keeps every purple colour off the house gold fallback", () => {
    expect(PURPLE_BRANDING.accent).not.toBe(gold.house);
    expect(PURPLE_BRANDING.accentPrimary).not.toBe(gold.house);
    expect(PURPLE_BRANDING.accentOnPrimary).not.toBe(gold.onHouse);
    expect(PURPLE_BRANDING.accentSubtle).not.toBe(gold.askFill);
    expect(PURPLE_BRANDING.accentBorder).not.toBe(gold.askBorder);
  });

  it("keeps the muted gold accent off house gold", () => {
    expect(MUTED_GOLD_BRANDING.accent).not.toBe(gold.house);
    expect(MUTED_GOLD_BRANDING.accentPrimary).not.toBe(gold.house);
  });

  it("keeps the two chapters apart", () => {
    expect(MUTED_GOLD_BRANDING.accent).not.toBe(PURPLE_BRANDING.accent);
    expect(MUTED_GOLD_BRANDING.accentPrimary).not.toBe(
      PURPLE_BRANDING.accentPrimary,
    );
  });

  it("hands back a fresh copy of the fixture on every call", () => {
    const { useChapterBranding } = chapterBrandingMock(PURPLE_BRANDING);
    const first = useChapterBranding();
    expect(first).toEqual(PURPLE_BRANDING);
    expect(first).not.toBe(PURPLE_BRANDING);
    expect(useChapterBranding()).not.toBe(first);
  });
});
