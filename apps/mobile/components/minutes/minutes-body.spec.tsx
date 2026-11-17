/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { MeetingMinutes } from "@repo/hooks";
import { EMPTY_MEETING_CONTENT } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { MinutesBody } from "./minutes-body";

/**
 * The notes are an outline, topic over points (#5410, Paul 2026-11-17:
 * "break down the discussion into what topics were discussed"); the phone
 * draws them as web does.
 */
describe("MinutesBody notes", () => {
  it("draws each topic as a heading over its bullets", () => {
    const meeting = {
      sections: ["summary", "discussion_log"],
      attendees: null,
    } as unknown as MeetingMinutes;
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MinutesBody
            meeting={meeting}
            content={{
              ...EMPTY_MEETING_CONTENT,
              discussion_log:
                "Meeting transcripts\n- Separate voices and name them\n  - A stronger model if needed",
            }}
            nameFor={() => null}
          />
        </FrappThemeProvider>,
      );
    });
    const headers = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "header",
    );
    // The section's own heading, then the topic under it.
    expect(headers.map((node) => drawnText(node))).toEqual([
      "Notes",
      "Meeting transcripts",
    ]);
    const text = drawnText(tree.root);
    expect(text).toContain("•Separate voices and name them");
    expect(text).toContain("◦A stronger model if needed");
  });
});
