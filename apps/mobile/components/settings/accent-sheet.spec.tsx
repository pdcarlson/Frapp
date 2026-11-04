import { describe, expect, it, vi } from "vitest";

vi.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetModal: "BottomSheetModal",
  BottomSheetTextInput: "TextInput",
  BottomSheetView: "View",
}));

import { DEFAULT_CHAPTER_ACCENT } from "@repo/hooks/chapter-identity";
import { storedAccentOf } from "./accent-sheet";

describe("storedAccentOf", () => {
  it("reads branding.colors.accent first, since it is authoritative (#795)", () => {
    expect(
      storedAccentOf({
        accent_color: "#2563EB",
        branding: { colors: { accent: "#4f2683" } },
      }),
    ).toBe("#4F2683");
  });

  it("falls back to the accent_color mirror, then the house seed", () => {
    expect(storedAccentOf({ accent_color: "#c9a56f", branding: {} })).toBe(
      "#C9A56F",
    );
    expect(storedAccentOf({ accent_color: null })).toBe(DEFAULT_CHAPTER_ACCENT);
    expect(storedAccentOf(undefined)).toBe(DEFAULT_CHAPTER_ACCENT);
  });

  it("ignores a branding accent that is not a string", () => {
    expect(
      storedAccentOf({
        accent_color: "#8B0000",
        branding: { colors: { accent: 42 } },
      }),
    ).toBe("#8B0000");
  });
});
