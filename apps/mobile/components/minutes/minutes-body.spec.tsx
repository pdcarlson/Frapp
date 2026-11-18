/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { MeetingMinutes } from "@repo/hooks";
import {
  DEFAULT_MEETING_SECTIONS,
  EMPTY_MEETING_CONTENT,
  type MeetingContent,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

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

/**
 * The TL;DR leads the phone's minutes (#5523): read before the Summary, its
 * "- " lines drawn as bullets, and absent from minutes written before it.
 */
describe("MinutesBody TL;DR", () => {
  function render(content: Partial<MeetingContent>) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MinutesBody
            meeting={
              {
                sections: [...DEFAULT_MEETING_SECTIONS],
                attendees: null,
              } as unknown as MeetingMinutes
            }
            content={{ ...EMPTY_MEETING_CONTENT, ...content }}
            nameFor={() => null}
          />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }

  it("reads the TL;DR first, as bullets, then the Summary", () => {
    const text = screenText(
      render({
        tldr: "- Formal is December 5\n- Pay dues by Friday",
        summary: "The chapter met and planned formal.",
      }),
    );
    expect(text.indexOf("TL;DR")).toBeLessThan(text.indexOf("Summary"));
    expect(text).toContain("Formal is December 5");
    expect(text).toContain("Pay dues by Friday");
    expect(text).not.toContain("- Formal");
  });

  it("shows no TL;DR on minutes written before it", () => {
    const text = screenText(render({ summary: "The chapter met." }));
    expect(text).not.toContain("TL;DR");
    expect(text).toContain("The chapter met.");
  });
});

describe("MinutesBody tabled (#5522)", () => {
  it("lists what was tabled, with a carried item's first date and count", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MinutesBody
            meeting={
              {
                sections: [...DEFAULT_MEETING_SECTIONS],
                attendees: null,
              } as unknown as MeetingMinutes
            }
            content={{
              ...EMPTY_MEETING_CONTENT,
              tabled: [
                {
                  text: "Rush shirts",
                  first_meeting_id: "33333333-3333-4333-8333-333333333333",
                  first_start_time: new Date(2026, 10, 3, 19).toISOString(),
                  times: 3,
                },
              ],
            }}
            nameFor={() => null}
          />
        </FrappThemeProvider>,
      );
    });
    const text = screenText(tree);
    expect(text).toContain("Tabled");
    expect(text).toContain("Rush shirts");
    expect(text).toContain("3rd time");
  });
});
