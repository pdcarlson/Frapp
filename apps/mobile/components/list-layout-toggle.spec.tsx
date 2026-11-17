/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ListLayoutToggle } from "@/components/list-layout-toggle";
import { resetListLayoutsForTests } from "@/lib/list-layout";

const trees: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => trees.splice(0).forEach((tree) => tree.unmount()));
  resetListLayoutsForTests();
});

function render() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ListLayoutToggle screen="documents" />
      </FrappThemeProvider>,
    );
  });
  trees.push(tree);
  return () =>
    tree.root.find(
      (node) =>
        node.props.accessibilityRole === "button" &&
        typeof node.props.onPress === "function",
    );
}

describe("ListLayoutToggle: one button, no segmented control", () => {
  it("names the switch it makes and the layout it shows, and flips it", () => {
    const button = render();
    expect(button().props.accessibilityLabel).toBe("Show as grid");
    expect(button().props.accessibilityValue).toEqual({ text: "List" });

    act(() => button().props.onPress());
    expect(button().props.accessibilityLabel).toBe("Show as list");
    expect(button().props.accessibilityValue).toEqual({ text: "Grid" });

    act(() => button().props.onPress());
    expect(button().props.accessibilityValue).toEqual({ text: "List" });
  });
});
