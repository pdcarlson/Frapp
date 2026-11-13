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

// A purple chapter: the bar is the one Ask surface that takes the accent.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#8B5CF6" }),
}));
const haptics = vi.hoisted(() => ({ selectionHaptic: vi.fn() }));
vi.mock("@/lib/haptics", () => haptics);

import { AskBar } from "./ask-bar";

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
  it("reads as the field it opens: the conversation's own placeholder, and nothing else", () => {
    expect(screenText(render())).toBe(ASK_COPY.placeholder);
  });

  it("is one button named Ask Frapp, which says what it is for", () => {
    const button = press(render());
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe(ASK_COPY.name);
    expect(button.props.accessibilityHint).toBe(ASK_COPY.entry_label);
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

  it("is a full touch target", () => {
    const tree = render();
    const capsule = tree.root.findAll(
      (node) => flat(node.props.style).borderWidth === 1,
    )[0];
    expect(flat(capsule.props.style).height).toBeGreaterThanOrEqual(44);
  });

  it("opens the conversation on a tap, with the selection tick", () => {
    const onPress = vi.fn();
    const tree = render(onPress);
    act(() => press(tree).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.selectionHaptic).toHaveBeenCalledTimes(1);
  });
});
