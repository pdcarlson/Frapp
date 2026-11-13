/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { StyleSheet } from "react-native";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingCreateButton } from "@/components/floating-create-button";
import { GlassSurface } from "@/components/glass-surface";
import {
  FLOATING_ASK_BAR,
  FLOATING_TAB_BAR,
  floatingScreenLayout,
  floatingTabBarTop,
  setAskBarShown,
} from "@/lib/floating-chrome";
import { FrappThemeProvider } from "@/lib/theme";
import { UndoBar } from "./undo-bar";

/**
 * What floats over a tab screen sits above everything under it. Once a
 * member has the Ask Frapp bar (#4702) that is the tab bar and the Ask bar,
 * so the undo bar and the create button both rise by the Ask bar's room, and
 * neither moves on a screen pushed over the tabs, where no bar is drawn.
 */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#8B5CF6",
    accentPrimary: "#7C3AED",
    accentOnPrimary: "#FFFFFF",
  }),
}));

const LIFT = FLOATING_ASK_BAR.height + FLOATING_ASK_BAR.gap;
// The safe-area mock has no bottom inset.
const ABOVE_TAB_BAR = floatingTabBarTop(0) + FLOATING_TAB_BAR.gap;

/** How far off the screen's bottom edge the floating surface is drawn. */
function bottomOf(children: React.ReactNode, onATab: boolean): number {
  let tree!: ReturnType<typeof create>;
  const themed = <FrappThemeProvider>{children}</FrappThemeProvider>;
  act(() => {
    tree = create(
      onATab
        ? floatingScreenLayout({
            route: { name: "tasks" },
            navigation: { addListener: () => () => {} },
            children: themed,
          })
        : themed,
    );
  });
  const style = StyleSheet.flatten(
    tree.root.findByType(GlassSurface).props.style,
  ) as { bottom: number };
  return style.bottom;
}

const undo = <UndoBar message="Marked done" onUndo={() => undefined} />;
const createButton = (
  <FloatingCreateButton label="New task" onPress={() => undefined} />
);

afterEach(() => act(() => setAskBarShown(false)));

describe.each([
  ["the undo bar", undo],
  ["the create button", createButton],
])("%s over a tab screen", (_, surface) => {
  it("sits just above the tab bar for a member without Ask", () => {
    expect(bottomOf(surface, true)).toBe(ABOVE_TAB_BAR);
  });

  it("rises by the Ask bar's room for a member with it", () => {
    act(() => setAskBarShown(true));
    expect(bottomOf(surface, true)).toBe(ABOVE_TAB_BAR + LIFT);
  });

  it("does not move on a pushed screen, which draws neither bar", () => {
    const without = bottomOf(surface, false);
    act(() => setAskBarShown(true));
    expect(bottomOf(surface, false)).toBe(without);
  });
});
