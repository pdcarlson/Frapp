/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
// A purple stand-in, so a row painted house gold fails instead of passing.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

import {
  BACK_TO_CHAT,
  BACK_TO_EVENTS,
  BACK_TO_MORE,
  BackRow,
} from "./back-row";

/**
 * #3022. The row the board draws above the title on s07 and s10–s16. It goes
 * to a fixed destination, so a screen opened from a notification or a link,
 * with no history behind it, still lands where the label says.
 */

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BackRow (#3022)", () => {
  it.each([
    ["More", BACK_TO_MORE, "/more"],
    ["Events", BACK_TO_EVENTS, "/events"],
    ["Chat", BACK_TO_CHAT, "/"],
  ])("‹ %s goes to its tab", (label, target, href) => {
    const tree = render(<BackRow {...target} />);

    expectBackRow(tree, label, href);
  });

  it("draws in the chapter accent, not house gold", () => {
    const tree = render(<BackRow {...BACK_TO_MORE} />);
    const text = tree.root.findByType("Text" as unknown as React.ElementType);

    // The purple stand-in the mock returns: inside a chapter every back arrow
    // follows the accent (spec/behavior/branding.md, owner rule 2026-11-04).
    expect(text.props.style).toEqual(
      expect.objectContaining({ color: "#CB9FFF" }),
    );
  });
});

/**
 * Sign-in, join, setup and the chapter picker draw the same row, in house
 * gold (there is no chapter in `(auth)`), stepping back inside their own
 * route rather than opening a tab.
 */
describe("BackRow in (auth)", () => {
  const pressable = (tree: ReactTestRenderer) =>
    tree.root.findByType("Pressable" as unknown as React.ElementType);

  it("draws in house gold when asked, whatever the chapter's accent", () => {
    const tree = render(<BackRow house label="Back" onPress={vi.fn()} />);
    const text = tree.root.findByType("Text" as unknown as React.ElementType);

    // `gold.askText`, the board's `‹ Back` gold on s02, not the purple mock.
    expect(text.props.children).toBe("‹ Back");
    expect(text.props.style).toEqual(
      expect.objectContaining({ color: "#F4CB63" }),
    );
  });

  it("runs its own step back instead of navigating, under the label it's given", () => {
    const onPress = vi.fn();
    const tree = render(
      <BackRow
        house
        label="Back"
        accessibilityLabel="Back to the choices"
        onPress={onPress}
      />,
    );
    const row = pressable(tree);

    expect(row.props.accessibilityLabel).toBe("Back to the choices");
    act(() => {
      row.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useRouter)().navigate).not.toHaveBeenCalled();
  });

  it("dims and holds while disabled, as while a sign-in is in flight", () => {
    const tree = render(
      <BackRow house label="Back" onPress={vi.fn()} disabled />,
    );
    const row = pressable(tree);

    expect(row.props.disabled).toBe(true);
    expect(row.props.accessibilityState).toEqual({ disabled: true });
    expect(row.props.style({ pressed: false })).toEqual(
      expect.objectContaining({ opacity: 0.5 }),
    );
  });

  it("shows a press", () => {
    const tree = render(<BackRow {...BACK_TO_MORE} />);

    expect(pressable(tree).props.style({ pressed: true })).toEqual(
      expect.objectContaining({ opacity: 0.6 }),
    );
  });
});
