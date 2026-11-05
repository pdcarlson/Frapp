/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
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

  it("draws in the board's back-row gold, whatever the chapter's accent", () => {
    const tree = render(<BackRow {...BACK_TO_MORE} />);
    const text = tree.root.findByType("Text" as unknown as React.ElementType);

    // `gold.askText`, the board's `#F4CB63`, which s05's `‹` draws too.
    expect(text.props.style).toEqual(
      expect.objectContaining({ color: "#F4CB63" }),
    );
  });
});
