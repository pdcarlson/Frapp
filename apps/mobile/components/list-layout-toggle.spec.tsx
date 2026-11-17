/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ListLayoutToggle } from "@/components/list-layout-toggle";
import { GridGlyph, ListGlyph } from "@/components/control-glyphs";
import {
  resetListLayoutsForTests,
  type ListLayoutScreen,
} from "@/lib/list-layout";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const trees: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => trees.splice(0).forEach((tree) => tree.unmount()));
  resetListLayoutsForTests();
});

function render(screen: ListLayoutScreen) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ListLayoutToggle screen={screen} />
      </FrappThemeProvider>,
    );
  });
  trees.push(tree);
  const button = () =>
    tree.root.find(
      (node) =>
        node.props.accessibilityRole === "button" &&
        typeof node.props.onPress === "function",
    );
  return { tree, button };
}

describe("ListLayoutToggle: one round, no segmented control", () => {
  it("shows and names the layout a tap switches to, and says the current one", () => {
    const { tree, button } = render("documents");
    expect(button().props.accessibilityLabel).toBe("Show as grid");
    expect(button().props.accessibilityValue).toEqual({ text: "List" });
    expect(tree.root.findAllByType(GridGlyph)).toHaveLength(1);
    expect(tree.root.findAllByType(ListGlyph)).toHaveLength(0);

    act(() => button().props.onPress());
    expect(button().props.accessibilityLabel).toBe("Show as list");
    expect(button().props.accessibilityValue).toEqual({ text: "Grid" });
    expect(tree.root.findAllByType(ListGlyph)).toHaveLength(1);
    expect(tree.root.findAllByType(GridGlyph)).toHaveLength(0);
  });

  it("keeps the pick per screen", () => {
    const tasks = render("tasks");
    const documents = render("documents");
    act(() => tasks.button().props.onPress());
    expect(tasks.button().props.accessibilityValue).toEqual({ text: "Grid" });
    expect(documents.button().props.accessibilityValue).toEqual({
      text: "List",
    });
  });
});
