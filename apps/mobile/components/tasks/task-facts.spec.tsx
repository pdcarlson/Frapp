import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { toTaskRow } from "@/lib/tasks/board";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import { TaskRepeatFact } from "./task-facts";

/**
 * The task screen's Repeats line (#5119): how a copy of a live series
 * repeats and its next day, as web's task panel says it.
 */

function render(series: unknown): ReactTestRenderer {
  const row = toTaskRow({
    id: "t1",
    title: "Kitchen duty",
    status: "TODO",
    stored_status: "TODO",
    due_date: "2026-11-23",
    due_at: null,
    series,
  })!;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TaskRepeatFact row={row} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const SERIES = {
  recurrence_rule: "FREQ=WEEKLY;BYDAY=MO;TZID=America/New_York",
  next_due_date: "2026-11-30",
  ended: false,
};

describe("TaskRepeatFact", () => {
  it("says the pattern and the next copy's day", () => {
    const tree = render(SERIES);
    expect(
      tree.root.findAll(
        (node) =>
          node.props.accessibilityLabel ===
          "Repeats: Every Monday · next Nov 30",
      ).length,
    ).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it("draws nothing for a task that doesn't repeat, or a stopped series", () => {
    for (const series of [null, { ...SERIES, ended: true }]) {
      const tree = render(series);
      expect(tree.toJSON()).toBeNull();
      act(() => tree.unmount());
    }
  });
});
