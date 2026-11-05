import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetModal: "BottomSheetModal",
  BottomSheetTextInput: "TextInput",
  BottomSheetView: "View",
}));

const state = vi.hoisted(() => ({
  chapter: undefined as
    | { name: string; accent_color: string; branding: Record<string, unknown> }
    | undefined,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: state.chapter, isError: false }),
  useUpdateChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { DEFAULT_CHAPTER_ACCENT } from "@repo/hooks/chapter-identity";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { AccentSheet, storedAccentOf } from "./accent-sheet";

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

describe("AccentSheet", () => {
  it("says the color changes the app for everyone in the chapter", () => {
    // Settings is otherwise personal preferences, and this save repaints
    // every member's app; the picker alone can't say that.
    state.chapter = {
      name: "Beta Chapter",
      accent_color: "#4F2683",
      branding: {},
    };
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <AccentSheet />
        </FrappThemeProvider>,
      );
    });

    expect(screenText(tree)).toContain(
      "Changes the color for everyone in the chapter.",
    );
    act(() => tree.unmount());
  });
});
