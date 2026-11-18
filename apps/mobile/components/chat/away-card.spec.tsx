/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import type { AwayRow } from "@/lib/chat/away-updates";
import { AwayCard } from "./away-card";

const ROWS: AwayRow[] = [
  {
    channelId: "exec",
    name: "exec",
    kind: "mention",
    count: 2,
    preview: "Jordan: Is the budget final?",
  },
  {
    channelId: "ann",
    name: "announcements",
    kind: "announcement",
    count: 1,
    preview: null,
  },
  {
    channelId: "gen",
    name: "general",
    kind: "busy",
    count: 140,
    preview: "Dev: who can sub Sunday",
  },
];

function render(onOpen = vi.fn(), onClose = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AwayCard
          rows={ROWS}
          sinceLabel="since yesterday 9:40 PM"
          onOpen={onOpen}
          onClose={onClose}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("AwayCard", () => {
  it("lists each channel with its real last message and its count", () => {
    const text = screenText(render());
    expect(text).toContain("While you were away");
    expect(text).toContain("since yesterday 9:40 PM");
    expect(text).toContain("#exec");
    expect(text).toContain("Jordan: Is the budget final?");
    expect(text).toContain("#announcements");
    expect(text).toContain("99+");
  });

  it("opens the channel a row names, and closes on its mark", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const tree = render(onOpen, onClose);
    act(() => {
      tree.root.findByProps({ testID: "chat-away-row-ann" }).props.onPress();
    });
    expect(onOpen).toHaveBeenCalledWith("ann");
    act(() => {
      tree.root.findByProps({ testID: "chat-away-close" }).props.onPress();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
