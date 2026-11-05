/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

// A purple chapter's solid pair, deliberately not house gold, so a chip that
// slips back to `gold.*` or to the text-step accent fails an assertion.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
  }),
}));

import { FilterChips, ToggleChips } from "./filter-chips";

/**
 * The chip row s12 and s13 draw (the owner's design review, 2026-11-04): one
 * row that scrolls sideways on a screen that asks for it, compact chips with a
 * 44pt touch target, and the press feedback every list row has. Without the
 * ask the chips wrap, as the sheets want.
 */

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

const flatten = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity));

const chips = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "Pressable");

const FOLDERS = [
  { value: null, label: "All" },
  { value: "Minutes", label: "Minutes" },
  { value: "Bylaws", label: "Bylaws" },
];

describe("FilterChips", () => {
  it("scrolls one row sideways when asked, bleeding to the screen's edge", () => {
    const tree = render(
      <FilterChips chips={FOLDERS} selected={null} onSelect={vi.fn()} scroll />,
    );
    const scroller = tree.root.find(
      (node) => (node.type as unknown) === "ScrollView",
    );

    expect(scroller.props.horizontal).toBe(true);
    expect(scroller.props.showsHorizontalScrollIndicator).toBe(false);
    expect(flatten(scroller.props.style).marginHorizontal).toBe(
      -signetDarkTokens.spacing.lg,
    );
    expect(
      flatten(scroller.props.contentContainerStyle).paddingHorizontal,
    ).toBe(signetDarkTokens.spacing.lg);
  });

  // The sheets (s21's folder, the new-task sheet's due date) pass nothing
  // and keep the wrapping row, where a sideways scroll would fight the
  // sheet's own pan.
  it("wraps by default, for a sheet", () => {
    const tree = render(
      <FilterChips chips={FOLDERS} selected={null} onSelect={vi.fn()} />,
    );
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "ScrollView"),
    ).toHaveLength(0);
    const tablist = tree.root.find(
      (node) => node.props.accessibilityRole === "tablist",
    );
    expect(flatten(tablist.props.style).flexWrap).toBe("wrap");
  });

  // The board's chips are about 34pt; the touch target is still 44, through
  // `hitSlop`, and the row's own bounds include the slop so Android delivers
  // the touch.
  it("draws compact chips with a 44pt touch target", () => {
    const tree = render(
      <FilterChips chips={FOLDERS} selected={null} onSelect={vi.fn()} scroll />,
    );
    const { minimum } = signetDarkTokens.touch;
    for (const chip of chips(tree)) {
      const style = flatten(chip.props.style({ pressed: false }));
      const slop = chip.props.hitSlop as { top: number; bottom: number };
      expect(style.height).toBeLessThan(minimum);
      expect(Number(style.height) + slop.top + slop.bottom).toBe(minimum);
      expect(style.minWidth).toBe(minimum);
    }
    const scroller = tree.root.find(
      (node) => (node.type as unknown) === "ScrollView",
    );
    const { top: slop } = chips(tree)[0]!.props.hitSlop as { top: number };
    expect(flatten(scroller.props.contentContainerStyle).paddingVertical).toBe(
      slop,
    );
    expect(flatten(scroller.props.style).marginVertical).toBe(-slop);
  });

  it("paints the selected chip in the chapter's solid accent and the rest in the list tone", () => {
    const tree = render(
      <FilterChips chips={FOLDERS} selected="Minutes" onSelect={vi.fn()} />,
    );
    const [all, minutes] = chips(tree);
    const label = (chip: typeof all) =>
      flatten(
        chip!.find((node) => (node.type as unknown) === "Text").props.style,
      );

    expect(minutes!.props.accessibilityState).toEqual({ selected: true });
    expect(
      flatten(minutes!.props.style({ pressed: false })).backgroundColor,
    ).toBe("#8E4EC6");
    expect(label(minutes).color).toBe("#FFFFFF");
    expect(flatten(all!.props.style({ pressed: false })).backgroundColor).toBe(
      signetDarkTokens.color.surface.surface1,
    );
    expect(JSON.stringify(tree.toJSON())).not.toContain(
      signetDarkTokens.color.gold.onHouse,
    );
  });

  it("ripples on Android, lifts an idle chip on iOS, and calls back", () => {
    const onSelect = vi.fn();
    const tree = render(
      <FilterChips chips={FOLDERS} selected={null} onSelect={onSelect} />,
    );
    const [all, minutes] = chips(tree);

    expect(minutes!.props.android_ripple?.color).toMatch(/^rgba\(/);
    // The suite's react-native stub runs as iOS.
    expect(
      flatten(minutes!.props.style({ pressed: true })).backgroundColor,
    ).toBe(signetDarkTokens.color.surface.card);
    // The selected chip keeps its fill: the lift would paint over the state.
    expect(flatten(all!.props.style({ pressed: true })).backgroundColor).toBe(
      "#8E4EC6",
    );

    act(() => minutes!.props.onPress());
    expect(onSelect).toHaveBeenCalledWith("Minutes");
  });

  it("draws a trailing control after the tab list, outside it", () => {
    const tree = render(
      <FilterChips
        chips={FOLDERS}
        selected={null}
        onSelect={vi.fn()}
        accessibilityLabel="Filter by folder"
        trailing={<Text>Filters</Text>}
      />,
    );
    const tablist = tree.root.find(
      (node) => node.props.accessibilityRole === "tablist",
    );
    const filters = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "Filters",
    );

    expect(
      tablist.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "tab",
      ),
    ).toHaveLength(3);
    expect(tablist.findAll((node) => node === filters)).toHaveLength(0);
  });
});

describe("ToggleChips", () => {
  it("draws each switch on the shared chip", () => {
    const onToggle = vi.fn();
    const tree = render(
      <ToggleChips
        chips={[
          { key: "unread", label: "Unread only", on: true },
          { key: "muted", label: "Hide muted", on: false },
        ]}
        onToggle={onToggle}
      />,
    );
    const [unread, muted] = chips(tree);

    expect(unread!.props.accessibilityRole).toBe("switch");
    expect(unread!.props.accessibilityState).toEqual({ checked: true });
    expect(
      flatten(unread!.props.style({ pressed: false })).backgroundColor,
    ).toBe("#8E4EC6");
    act(() => muted!.props.onPress());
    expect(onToggle).toHaveBeenCalledWith("muted", true);
  });
});
