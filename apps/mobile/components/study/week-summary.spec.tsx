/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accentPrimary: "#F4CB63" }),
}));

import { WeekSummary } from "./week-summary";

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

/** The count as a screen reader hears it, which is also what it reads. */
const spoken = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.accessibilityLabel === "string",
  ).props.accessibilityLabel as string;

const meter = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.testID === "week-summary-meter" &&
      typeof node.type === "string",
  );

/**
 * s10's THIS WEEK line (#1062): the week's real total, and, only when the
 * chapter sets the member a weekly goal, "of 6.0 hrs" with a meter.
 */
describe("the Study screen's week summary", () => {
  it("draws no meter and no goal when the chapter sets none", () => {
    const tree = render(<WeekSummary minutes={150} sessionCount={2} />);
    expect(spoken(tree)).toBe("2.5 hours this week across 2 sessions");
    expect(screenText(tree)).not.toContain("of");
    expect(meter(tree)).toHaveLength(0);
  });

  it("measures the week against the member's goal", () => {
    const tree = render(
      <WeekSummary minutes={270} sessionCount={3} goalMinutes={360} />,
    );
    expect(spoken(tree)).toBe(
      "4.5 of 6.0 study hours this week, across 3 sessions",
    );
    expect(screenText(tree)).toContain("of 6.0 hrs · 3 sessions");
    const [track] = meter(tree);
    const fill = track!.findAll(
      (node) => typeof node.type === "string" && node !== track,
    )[0]!;
    const style = [fill.props.style].flat(Infinity) as Record<
      string,
      unknown
    >[];
    expect(style.find((part) => part?.width)?.width).toBe("75%");
  });

  it("keeps the bar full past the goal", () => {
    const tree = render(
      <WeekSummary minutes={500} sessionCount={4} goalMinutes={360} />,
    );
    expect(spoken(tree)).toContain("8.3 of 6.0 study hours");
    const [track] = meter(tree);
    const fill = track!.findAll(
      (node) => typeof node.type === "string" && node !== track,
    )[0]!;
    const style = [fill.props.style].flat(Infinity) as Record<
      string,
      unknown
    >[];
    expect(style.find((part) => part?.width)?.width).toBe("100%");
  });
});
