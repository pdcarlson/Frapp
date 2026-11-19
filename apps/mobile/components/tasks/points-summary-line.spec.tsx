/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { StyleSheet, type TextStyle } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { PointsSummaryLine, pointsSummaryText } from "./points-summary-line";

// #5570: the board's points card became one muted line.
describe("pointsSummaryText", () => {
  it("says the balance and the rank on one line", () => {
    expect(pointsSummaryText({ balance: 1240 }, { rank: 3, of: 42 })).toBe(
      `${(1240).toLocaleString()} semester points · #3 of 42 in the house`,
    );
  });

  it("leaves out a half it doesn't know, and says nothing with neither", () => {
    expect(pointsSummaryText(null, { rank: 1, of: 5 })).toBe(
      "#1 of 5 in the house",
    );
    expect(pointsSummaryText({ balance: 1 }, null)).toBe("1 semester point");
    expect(pointsSummaryText(null, null)).toBeNull();
  });

  it("says a real zero", () => {
    expect(pointsSummaryText({ balance: 0 }, null)).toBe("0 semester points");
  });
});

describe("PointsSummaryLine", () => {
  function render(element: React.ReactElement): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
    });
    return tree;
  }

  // Quieter than a task's title (`label`, 14/600), in the muted text, so
  // the titles stay the loudest text on the board.
  it("draws one caption line in the muted text, under a title's size", () => {
    const tree = render(
      <PointsSummaryLine summary={{ balance: 40 }} rank={{ rank: 2, of: 9 }} />,
    );
    const [text] = tree.root.findAllByType("Text" as never);
    const style = StyleSheet.flatten(text!.props.style) as TextStyle;
    expect(style.color).toBe(signetDarkTokens.color.text.mutedForeground);
    expect(style.fontSize).toBe(signetDarkTokens.typography.role.caption.size);
    expect(Number(style.fontSize)).toBeLessThan(
      signetDarkTokens.typography.role.label.size,
    );
    expect(text!.props.accessibilityLabel).toBe(
      "40 semester points · Ranked 2 of 9 in the house",
    );
  });

  it("draws nothing with nothing to say", () => {
    const tree = render(<PointsSummaryLine summary={null} rank={null} />);
    expect(tree.toJSON()).toBeNull();
  });
});
