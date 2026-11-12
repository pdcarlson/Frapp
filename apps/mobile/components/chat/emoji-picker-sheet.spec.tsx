/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { EmojiPickerRow } from "@repo/chat-core/emoji";
import { FrappThemeProvider } from "@/lib/theme";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const recents = vi.hoisted(() => ({ list: ["🎉", "🔥"] as string[] }));
vi.mock("@/lib/chat/recent-emoji", () => ({
  useRecentEmoji: () => recents.list,
  recordRecentEmoji: vi.fn(),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentSubtle: "#251A33",
  }),
}));

import { EmojiPickerSheet } from "./emoji-picker-sheet";

function render(onPick = vi.fn()) {
  const ref = createRef<BottomSheetModal>();
  const element = () => (
    <FrappThemeProvider>
      <EmojiPickerSheet ref={ref} selected={[]} onPick={onPick} />
    </FrappThemeProvider>
  );
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element());
  });
  const rerender = () => act(() => tree.update(element()));
  return { tree, rerender };
}

function rows(tree: ReactTestRenderer): EmojiPickerRow[] {
  const list = tree.root.find(
    (node) => (node.type as unknown) === "BottomSheetFlatList",
  );
  return list.props.data as EmojiPickerRow[];
}

describe("EmojiPickerSheet", () => {
  it("opens on the member's recent emoji, under Recent", () => {
    const { tree } = render();
    const [heading, line] = rows(tree);
    expect(heading).toMatchObject({ kind: "heading", name: "Recent" });
    expect(line).toMatchObject({ kind: "emoji", emojis: ["🎉", "🔥"] });
  });

  it("holds the Recent row still from a pick until the sheet has closed", () => {
    const onPick = vi.fn();
    const { tree, rerender } = render(onPick);
    const list = tree.root.find(
      (node) => (node.type as unknown) === "BottomSheetFlatList",
    );
    const line = list.props.renderItem({ item: rows(tree)[1] }) as {
      props: { children: React.ReactElement<{ onPress: () => void }>[][] };
    };
    const fire = line.props.children[0]![1]!;
    act(() => fire.props.onPress());
    expect(onPick).toHaveBeenCalledWith("🔥", false);
    // The pick records itself, which reorders the live list.
    recents.list = ["🔥", "🎉"];
    rerender();
    expect(rows(tree)[1]).toMatchObject({ emojis: ["🎉", "🔥"] });
  });
});
