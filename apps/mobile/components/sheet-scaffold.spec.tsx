/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { SheetHeader } from "./sheet-scaffold";

/**
 * Which sheets carry a Cancel: `spec/ui/design-system/components.md`
 * § Chrome weight. A form passes `onCancel`; a picker or read-only sheet
 * leaves it out and draws its title alone.
 */
function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

function buttons(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "button",
  );
}

describe("SheetHeader", () => {
  it("draws Cancel on a form", () => {
    const onCancel = vi.fn();
    const tree = render(<SheetHeader title="New task" onCancel={onCancel} />);
    const [cancel] = buttons(tree);
    expect(buttons(tree)).toHaveLength(1);
    act(() => cancel!.props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("draws the title alone on a picker", () => {
    const tree = render(<SheetHeader title="Study zone" />);
    expect(buttons(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain("Study zone");
  });
});
