/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: "Alpha Beta",
    textMark: null,
  }),
}));
vi.mock("@repo/hooks", () => ({ useChatBackground: () => ({ data: undefined }) }));

import { FrappThemeProvider } from "@/lib/theme";
import { ChatBackgroundSwatches } from "./chat-background-picker";

/**
 * The phone's background swatches (#4031), web's `ChatBackgroundPicker`
 * twin: the same choices in the same order, each drawn with the thread's own
 * paint, the stored one marked.
 */
function render(props: Partial<React.ComponentProps<typeof ChatBackgroundSwatches>>) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChatBackgroundSwatches
          value={null}
          allowInherit
          onPick={vi.fn()}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const radios = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "radio",
  );

describe("ChatBackgroundSwatches", () => {
  it("offers Chapter default, the five built-ins and Photo, with the stored one checked", () => {
    const tree = render({ value: "midnight" });
    expect(radios(tree).map((r) => r.props.accessibilityLabel)).toEqual([
      "Chapter default",
      "Plain",
      "Gold glow",
      "Midnight",
      "Game day",
      "Letters",
      "Photo",
    ]);
    expect(
      radios(tree)
        .filter((r) => r.props.accessibilityState.checked)
        .map((r) => r.props.accessibilityLabel),
    ).toEqual(["Midnight"]);
  });

  it("draws each built-in with the thread's own paint, and the default as what it would draw", () => {
    const tree = render({ inheritPreview: "game-day" });
    const paints = tree.root
      .findAll(
        (node) =>
          typeof node.type === "function" &&
          node.type.name === "ChatBackgroundPaint",
      )
      .map((node) => node.props.paintKey);
    expect(paints).toEqual([
      "game-day",
      "plain",
      "gold-glow",
      "midnight",
      "game-day",
      "letters",
    ]);
  });

  it("names a photo default, and leaves Chapter default out for the chapter's own picker", () => {
    expect(
      radios(render({ inheritPreview: "photo" }))[0]!.props.accessibilityLabel,
    ).toBe("Chapter default (photo)");
    expect(
      radios(render({ allowInherit: false, value: "plain" })).map(
        (r) => r.props.accessibilityLabel,
      )[0],
    ).toBe("Plain");
  });

  it("hands back null for Chapter default and the key otherwise, and nothing while disabled", () => {
    const onPick = vi.fn();
    const tree = render({ onPick });
    act(() => radios(tree)[0]!.props.onPress());
    act(() => radios(tree).at(-1)!.props.onPress());
    expect(onPick.mock.calls).toEqual([[null], ["photo"]]);

    const locked = render({ onPick: vi.fn(), disabled: true });
    expect(radios(locked).every((r) => r.props.disabled === true)).toBe(true);
  });
});
