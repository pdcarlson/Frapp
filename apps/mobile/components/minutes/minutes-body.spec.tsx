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

function press(tree: ReactTestRenderer, label: string | RegExp) {
  const node = tree.root.find(
    (candidate) =>
      typeof candidate.props.onPress === "function" &&
      (typeof label === "string"
        ? candidate.props.accessibilityLabel === label ||
          drawnText(candidate) === label
        : label.test(String(candidate.props.accessibilityLabel ?? ""))),
  );
  act(() => node.props.onPress());
}

/**
 * The notes are an outline, topic over points (#5410, Paul 2026-11-17:
 * "break down the discussion into what topics were discussed"); since #5562
 * each topic is a row that opens in place, as on web.
 */
describe("MinutesBody notes", () => {
  it("draws each topic as a row that opens onto its bullets", () => {
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
    expect(drawnText(tree.root)).toContain("Meeting transcripts");
    expect(drawnText(tree.root)).not.toContain("Separate voices");
    press(tree, "Meeting transcripts, 2 points");
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

  it("reads the TL;DR first, as bullets, the Summary folded under it (#5562)", () => {
    const tree = render({
      tldr: "- Formal is December 5\n- Pay dues by Friday",
      summary: "The chapter met and planned formal.",
    });
    const text = screenText(tree);
    expect(text).toContain("TL;DR");
    expect(text).toContain("Formal is December 5");
    expect(text).toContain("Pay dues by Friday");
    expect(text).not.toContain("- Formal");
    // The gist is said once: the Summary waits behind its button.
    expect(text).not.toContain("The chapter met and planned formal.");
    press(tree, "Read the full summary");
    expect(screenText(tree)).toContain("The chapter met and planned formal.");
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

describe("MinutesBody scanning (#5562)", () => {
  function render(content: Partial<MeetingContent>, viewerId?: string) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MinutesBody
            meeting={
              {
                sections: [...DEFAULT_MEETING_SECTIONS],
                attendees: { present: ["u1", "u2"], late: [], excused: [] },
              } as unknown as MeetingMinutes
            }
            content={{ ...EMPTY_MEETING_CONTENT, ...content }}
            nameFor={(id) => (id === "u1" ? "Jake Ross" : "Sam Lee")}
            viewerId={viewerId}
          />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }

  it("draws Coming up as date tiles and leads a decision with its headline", () => {
    const text = screenText(
      render({
        dates: [{ date: "2026-11-28", text: "Officer installation" }],
        decisions: [
          {
            text: "Moved to spend $400 on the formal deposit",
            headline: "Formal deposit approved",
            vote: null,
          },
        ],
      }),
    );
    expect(text).toContain("Coming up");
    expect(text).toContain("NOV");
    expect(text).toContain("Officer installation");
    expect(text).toContain("Saturday");
    expect(text.indexOf("Formal deposit approved")).toBeLessThan(
      text.indexOf("Moved to spend $400"),
    );
  });

  it("lists the reader's own action items first, and the rest on All", () => {
    const tree = render(
      {
        action_items: [
          { text: "Order shirts", owner_user_id: null, due_date: null },
          {
            text: "Email alumni",
            owner_user_id: "11111111-1111-4111-8111-111111111111",
            due_date: null,
          },
        ],
      },
      "11111111-1111-4111-8111-111111111111",
    );
    expect(screenText(tree)).toContain("Email alumni");
    expect(screenText(tree)).not.toContain("Order shirts");
    press(tree, "All 2");
    expect(screenText(tree)).toContain("Order shirts");
  });

  it("shows the first few of a long list, then all on Show all", () => {
    const tree = render({
      decisions: Array.from({ length: 7 }, (_, at) => ({
        text: `Decision ${at + 1}`,
        vote: null,
      })),
    });
    expect(screenText(tree)).toContain("Decision 4");
    expect(screenText(tree)).not.toContain("Decision 5");
    press(tree, "Show all 7");
    expect(screenText(tree)).toContain("Decision 7");
  });

  it("puts attendance in a row with its count", () => {
    const tree = render({ summary: "Met." });
    expect(screenText(tree)).toContain("2 attended");
    press(tree, "Attendance, 2 attended");
    expect(screenText(tree)).toContain("Jake Ross, Sam Lee");
  });
});
