import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHAT_DENSITY_STORAGE_KEY } from "@repo/chat-core/density";
import { FrappThemeProvider } from "@/lib/theme";
import { resetChatDensityForTests } from "@/lib/chat/chat-density";
import { ChatDensitySheet } from "./chat-density-sheet";

function renderSheet(): { tree: ReactTestRenderer; dismiss: () => void } {
  const dismiss = vi.fn();
  const ref = React.createRef<never>();
  let tree!: ReactTestRenderer;
  act(() => {
    // The modal is a host stand-in, so React hands the ref whatever the node
    // mock returns: a modal with only `dismiss`.
    tree = create(
      <FrappThemeProvider>
        <ChatDensitySheet ref={ref} />
      </FrappThemeProvider>,
      { createNodeMock: () => ({ dismiss }) },
    );
  });
  return { tree, dismiss };
}

const radios = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === "radio" &&
      typeof node.props.onPress === "function",
  );

describe("ChatDensitySheet", () => {
  beforeEach(() => {
    resetChatDensityForTests();
    vi.mocked(AsyncStorage.setItem).mockClear();
  });

  it("offers both densities, cozy checked by default", () => {
    const { tree } = renderSheet();
    const [cozy, compact] = radios(tree);
    expect(cozy!.props.accessibilityLabel).toBe("Cozy");
    expect(cozy!.props.accessibilityState).toEqual({ checked: true });
    expect(compact!.props.accessibilityLabel).toBe("Compact");
    expect(compact!.props.accessibilityState).toEqual({ checked: false });
  });

  it("saves a tap and closes", () => {
    const { tree, dismiss } = renderSheet();
    act(() => radios(tree)[1]!.props.onPress());
    expect(radios(tree)[1]!.props.accessibilityState).toEqual({
      checked: true,
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      CHAT_DENSITY_STORAGE_KEY,
      "compact",
    );
    expect(dismiss).toHaveBeenCalled();
  });
});
