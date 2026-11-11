import React from "react";
import { act } from "react";
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
    chapterName: null,
  }),
}));

import type { ChatChapterLevel } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { ChatLevelSheet } from "./chat-level-sheet";

function renderSheet(level: ChatChapterLevel | undefined) {
  const dismiss = vi.fn();
  const onPick = vi.fn();
  const ref = React.createRef<never>();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChatLevelSheet ref={ref} level={level} onPick={onPick} />
      </FrappThemeProvider>,
      { createNodeMock: () => ({ dismiss }) },
    );
  });
  const radios = tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === "radio" &&
      typeof node.props.onPress === "function",
  );
  return { radios, onPick, dismiss };
}

describe("ChatLevelSheet", () => {
  it("draws both levels and checks the current one", () => {
    const { radios } = renderSheet("mentions");
    expect(radios.map((r) => r.props.accessibilityLabel)).toEqual([
      "All messages",
      "Mentions and DMs only",
    ]);
    expect(radios.map((r) => r.props.accessibilityState.checked)).toEqual([
      false,
      true,
    ]);
  });

  it("saves a new level and closes", () => {
    const { radios, onPick, dismiss } = renderSheet("all");
    act(() => radios[1].props.onPress());
    expect(onPick).toHaveBeenCalledWith("mentions");
    expect(dismiss).toHaveBeenCalled();
  });

  it("closes without a write when the current level is tapped", () => {
    const { radios, onPick, dismiss } = renderSheet("all");
    act(() => radios[0].props.onPress());
    expect(onPick).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
  });
});
