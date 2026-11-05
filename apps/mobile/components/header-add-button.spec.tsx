/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { HeaderAddButton } from "./header-add-button";

/**
 * The "+" tile s08 draws for New task, shared with Service hours' Log service
 * hours so the two creation actions look and press the same.
 */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#B9A4FF",
    accentPrimary: "#7C5CFF",
    accentOnPrimary: "#FFFFFF",
  }),
}));

function render(onPress = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <HeaderAddButton label="Log service hours" onPress={onPress} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const tile = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "Pressable");

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity));

describe("HeaderAddButton", () => {
  it("names its action for a screen reader and runs it", () => {
    const onPress = vi.fn();
    const tree = render(onPress);

    expect(tile(tree).props.accessibilityRole).toBe("button");
    expect(tile(tree).props.accessibilityLabel).toBe("Log service hours");
    act(() => tile(tree).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fills with the solid accent and dims while pressed", () => {
    const tree = render();
    const style = tile(tree).props.style;

    expect(flat(style({ pressed: false }))).toEqual(
      expect.objectContaining({ backgroundColor: "#7C5CFF" }),
    );
    expect(flat(style({ pressed: false })).opacity).toBeUndefined();
    expect(flat(style({ pressed: true })).opacity).toBe(0.85);
  });

  it("inks the glyph with the accent's contrast-checked pair", () => {
    // Not the accent text step under house-gold ink, which nobody measured
    // against an arbitrary chapter accent.
    const tree = render();
    const glyph = tree.root.find(
      (node) => (node.type as unknown) === "Text" && node.props.children === "+",
    );
    expect(flat(glyph.props.style).color).toBe("#FFFFFF");
  });
});
