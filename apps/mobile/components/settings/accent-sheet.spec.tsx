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
  save: (() => Promise.resolve()) as (body: unknown) => Promise<unknown>,
  chapter: undefined as
    | { name: string; accent_color: string; branding: Record<string, unknown> }
    | undefined,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => ({ data: state.chapter, isError: false }),
  useUpdateChapter: () => ({ mutateAsync: state.save, isPending: false }),
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
import { AccentPicker } from "@/components/chapter/accent-picker";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
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

/**
 * A save can settle after the officer swiped the sheet away. gorhom 5.2's
 * `dismiss()` on a dismissed modal leaves it stuck, so the next open draws
 * nothing; and a sheet reopened since is a new visit the save must not close
 * (#3405, `useSheetVisit`).
 */
describe("AccentSheet closing after a save (#3405)", () => {
  const dismiss = vi.fn();

  function openWithPendingSave() {
    state.chapter = {
      name: "Beta Chapter",
      accent_color: "#4F2683",
      branding: {},
    };
    let land = () => {};
    state.save = () =>
      new Promise<void>((resolve) => {
        land = resolve;
      });
    dismiss.mockReset();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <AccentSheet ref={React.createRef()} />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            (element.type as unknown) === "BottomSheetModal"
              ? { dismiss, present: vi.fn() }
              : null,
        },
      );
    });
    const modal = tree.root.find(
      (node) => node.type === ("BottomSheetModal" as never),
    );
    act(() => modal.props.onAnimate(-1, 0)); // presented
    act(() => tree.root.findByType(AccentPicker).props.onChange("#2563EB"));
    const save = tree.root.findByType(SheetPrimaryButton);
    act(() => save.props.onPress());
    return { tree, modal, land: () => act(async () => land()) };
  }

  it("closes the sheet when the save lands", async () => {
    const { tree, land } = openWithPendingSave();
    await land();
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("doesn't dismiss a sheet already swiped away when the save lands", async () => {
    const { tree, modal, land } = openWithPendingSave();
    act(() => modal.props.onDismiss());
    await land();
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("leaves a sheet reopened mid-save open when the save lands", async () => {
    const { tree, modal, land } = openWithPendingSave();
    act(() => modal.props.onDismiss());
    act(() => modal.props.onAnimate(-1, 0)); // reopened
    await land();
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
