/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { BackHandler } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { SheetBackToClose, SheetHeader, useSheetClose } from "./sheet-scaffold";

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

describe("a sheet's way out with no Cancel", () => {
  it("closes on Android back while it is up, and stops the press there", () => {
    const onClose = vi.fn();
    vi.mocked(BackHandler.addEventListener).mockClear();
    render(<SheetBackToClose onClose={onClose} />);
    const handler = vi
      .mocked(BackHandler.addEventListener)
      .mock.calls.at(-1)?.[1] as (() => boolean) | undefined;
    let handled: boolean | null | undefined;
    act(() => {
      handled = handler?.();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    // `true` keeps the navigator under the sheet from popping its screen.
    expect(handled).toBe(true);
  });

  it("closes the sheet it names, for VoiceOver's escape", () => {
    const dismiss = vi.fn();
    const sheet = { current: { dismiss } } as never;
    let close!: () => void;
    function Harness() {
      close = useSheetClose(sheet);
      return null;
    }
    render(<Harness />);
    act(() => close());
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
