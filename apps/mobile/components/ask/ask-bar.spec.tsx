/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ASK_COPY } from "@repo/validation";
import { FrappCrest } from "@/components/frapp-crest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Ask Frapp's bar above the tab bar (#4702, Paul 2026-11-13: it should "show
 * up with the logo" and have "a little bit more character" than the words).
 */

// A purple chapter: the bar's crest, edge and arrow take the accent.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#8B5CF6" }),
}));
const haptics = vi.hoisted(() => ({ selectionHaptic: vi.fn() }));
vi.mock("@/lib/haptics", () => haptics);

import { ASK_BAR_HINT, AskBar } from "./ask-bar";

function render(onPress = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AskBar onPress={onPress} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const press = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "Pressable")[0];

describe("AskBar", () => {
  it("reads as the field it opens, which only asks (#5139), and nothing else", () => {
    expect(screenText(render())).toBe(ASK_COPY.placeholder);
  });

  it("is one button named Ask Frapp, which says what it is for", () => {
    const button = press(render());
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe(ASK_COPY.name);
    expect(button.props.accessibilityHint).toBe(ASK_BAR_HINT);
  });

  it("draws the crest, its edge and its arrow in the chapter's colour", () => {
    const tree = render();
    expect(tree.root.findByType(FrappCrest).props.color).toBe("#8B5CF6");
    // The capsule's edge is the accent, thinned.
    const edge = tree.root
      .findAll((node) => flat(node.props.style).borderWidth === 1)
      .map((node) => String(flat(node.props.style).borderColor));
    expect(edge.length).toBeGreaterThan(0);
    for (const color of edge) expect(color).toMatch(/139,\s*92,\s*246/);
    // The arrow's stroke.
    const strokes = tree.root
      .findAll((node) => node.props.stroke !== undefined)
      .map((node) => node.props.stroke);
    expect(strokes).toContain("#8B5CF6");
  });

  it("is a full touch target, filling the frame the tab bar gives it, never under the 48pt control step", () => {
    const tree = render();
    const capsule = flat(
      tree.root.findAll((node) => flat(node.props.style).borderWidth === 1)[0]
        .props.style,
    );
    // 48pt open, the row's 62pt folded (#4904): the tab bar sizes the frame.
    expect(capsule.flex).toBe(1);
    expect(capsule.minHeight).toBe(48);
  });

  it("drops its arrow when folded into the tab bar's row, keeping the words", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <AskBar onPress={() => undefined} folded />
        </FrappThemeProvider>,
      );
    });
    const strokes = tree.root
      .findAll((node) => node.props.stroke !== undefined)
      .map((node) => node.props.stroke);
    expect(strokes).toHaveLength(0);
    expect(screenText(tree)).toContain(ASK_COPY.placeholder);
  });

  it("opens the conversation on a tap, with the selection tick", () => {
    const onPress = vi.fn();
    const tree = render(onPress);
    act(() => press(tree).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.selectionHaptic).toHaveBeenCalledTimes(1);
  });
});
