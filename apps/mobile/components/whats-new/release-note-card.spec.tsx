/** @vitest-environment jsdom */
import React, { act } from "react";
import { Pressable, Text } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { ReleaseNote } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { ReleaseNoteCard } from "./release-note-card";

// The switch takes the chapter accent; the chapter itself isn't this spec's.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

function mount(note: ReleaseNote): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ReleaseNoteCard note={note} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((node) => [node.props.children].flat().join(""));

const segment = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByType(Pressable)
    .find((node) => node.props.accessibilityLabel === label)!;

const SPLIT: ReleaseNote = {
  date: "2026-11-12",
  title: "A title",
  changes: ["Both."],
  web: ["Web one.", "Web two."],
  phone: ["Phone."],
};

describe("ReleaseNoteCard", () => {
  it("switches a split entry between Both, Web and Phone, opening on Phone", () => {
    const tree = mount(SPLIT);
    expect(texts(tree)).toEqual([
      "November 12, 2026",
      "A title",
      "Both 1",
      "Web 2",
      "Phone 1",
      "Phone.",
    ]);
    expect(segment(tree, "Phone 1").props.accessibilityState.checked).toBe(
      true,
    );
    act(() => segment(tree, "Web 2").props.onPress());
    expect(texts(tree).slice(-2)).toEqual(["Web one.", "Web two."]);
  });

  it("shows an entry from before the split as one list with no switch", () => {
    const tree = mount({
      date: "2026-11-07",
      title: "Old",
      changes: ["A.", "B."],
    });
    expect(texts(tree)).toEqual(["November 7, 2026", "Old", "A.", "B."]);
  });
});
