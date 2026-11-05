/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

// A purple chapter's accent, deliberately not house gold, so a glyph that
// slipped back to a `gold.*` token would show up in an assertion.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { expectRoundedRipple } from "@/test/pressable-row";
import {
  formatDueDate,
  formatEventTime,
  isDueUrgent,
  selectNextEvent,
  selectNextTask,
  UpNextStrip,
} from "./up-next-strip";

/**
 * The strip's whole job is picking the *one* right event and the *one* right
 * task out of two unfiltered lists, so the selectors carry all of the risk.
 *
 * Times are built from explicit local-time constructor args rather than ISO
 * strings, because the relative labels are calendar-day comparisons and an ISO
 * string with a `Z` would shift across the day boundary depending on the host's
 * zone.
 */

const NOW = new Date(2026, 7, 16, 12, 0, 0); // 2026-08-16, midday, local

function at(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(year, month, day, hour, minute).toISOString();
}

describe("selectNextEvent", () => {
  it("returns the soonest event still ahead of now", () => {
    const event = selectNextEvent(
      [
        { id: "c", name: "Later", start_time: at(2026, 7, 20), location: null },
        {
          id: "a",
          name: "Soonest",
          start_time: at(2026, 7, 16, 18),
          location: "Great Hall",
        },
        {
          id: "b",
          name: "Middle",
          start_time: at(2026, 7, 18),
          location: null,
        },
      ],
      NOW,
    );

    expect(event?.name).toBe("Soonest");
    expect(event?.location).toBe("Great Hall");
  });

  it("ignores events that have already started", () => {
    const event = selectNextEvent(
      [
        {
          id: "past",
          name: "This morning",
          start_time: at(2026, 7, 16, 8),
          location: null,
        },
        {
          id: "next",
          name: "Tonight",
          start_time: at(2026, 7, 16, 18),
          location: null,
        },
      ],
      NOW,
    );

    expect(event?.name).toBe("Tonight");
  });

  it("returns null when everything is in the past", () => {
    expect(
      selectNextEvent(
        [{ id: "a", name: "Old", start_time: at(2026, 6, 1), location: null }],
        NOW,
      ),
    ).toBeNull();
  });

  it("survives a non-array, a null, and rows missing required fields", () => {
    // `GET /v1/events` infers as `never` in the SDK, so this is fed whatever the
    // runtime actually returns — the selector must not throw on any of it.
    expect(selectNextEvent(undefined, NOW)).toBeNull();
    expect(selectNextEvent(null, NOW)).toBeNull();
    expect(selectNextEvent("not a list", NOW)).toBeNull();
    expect(selectNextEvent([null, 42, { id: "a" }], NOW)).toBeNull();
    expect(
      selectNextEvent(
        [{ id: "a", name: "No date", start_time: "banana" }],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("selectNextTask", () => {
  // Every fixture carries `assignee_id: VIEWER`, because the selector is
  // assignee-scoped: `GET /v1/tasks` widens for an admin, and this strip is
  // drawn as the viewer's own next task.
  const VIEWER = "viewer-1";

  it("returns the nearest due task", () => {
    const task = selectNextTask(
      [
        {
          id: "b",
          title: "Later",
          due_date: at(2026, 7, 25),
          status: "TODO",
          assignee_id: VIEWER,
        },
        {
          id: "a",
          title: "Sooner",
          due_date: at(2026, 7, 17),
          status: "TODO",
          assignee_id: VIEWER,
        },
      ],
      VIEWER,
    );

    expect(task?.title).toBe("Sooner");
  });

  it("excludes completed tasks", () => {
    const task = selectNextTask(
      [
        {
          id: "done",
          title: "Done",
          due_date: at(2026, 7, 16),
          status: "COMPLETED",
          assignee_id: VIEWER,
        },
        {
          id: "open",
          title: "Open",
          due_date: at(2026, 7, 20),
          status: "TODO",
          assignee_id: VIEWER,
        },
      ],
      VIEWER,
    );

    expect(task?.title).toBe("Open");
  });

  it("keeps overdue tasks — they are the most urgent thing the strip can say", () => {
    const task = selectNextTask(
      [
        {
          id: "late",
          title: "Overdue",
          due_date: at(2026, 6, 1),
          status: "OVERDUE",
          assignee_id: VIEWER,
        },
        {
          id: "soon",
          title: "Soon",
          due_date: at(2026, 7, 17),
          status: "TODO",
          assignee_id: VIEWER,
        },
      ],
      VIEWER,
    );

    expect(task?.title).toBe("Overdue");
  });

  it("ignores another member's task, even when it is due sooner", () => {
    // The officer case. An admin's `GET /v1/tasks` carries the whole chapter,
    // so without the assignee filter the strip headlines someone else's work in
    // the one slot — and tapping it lands on a board that is assignee-filtered,
    // where the task is not there.
    const task = selectNextTask(
      [
        {
          id: "theirs",
          title: "Book the DJ",
          due_date: at(2026, 6, 1),
          status: "OVERDUE",
          assignee_id: "someone-else",
        },
        {
          id: "mine",
          title: "Mine",
          due_date: at(2026, 7, 20),
          status: "TODO",
          assignee_id: VIEWER,
        },
      ],
      VIEWER,
    );

    expect(task?.title).toBe("Mine");
  });

  it("returns null when every open task belongs to someone else", () => {
    expect(
      selectNextTask(
        [
          {
            id: "theirs",
            title: "Theirs",
            due_date: at(2026, 7, 17),
            status: "TODO",
            assignee_id: "someone-else",
          },
        ],
        VIEWER,
      ),
    ).toBeNull();
  });

  it("returns null rather than an unfiltered task when the viewer is unknown", () => {
    expect(
      selectNextTask(
        [
          {
            id: "a",
            title: "Sooner",
            due_date: at(2026, 7, 17),
            status: "TODO",
            assignee_id: VIEWER,
          },
        ],
        null,
      ),
    ).toBeNull();
  });

  it("survives malformed input", () => {
    expect(selectNextTask(undefined, VIEWER)).toBeNull();
    expect(
      selectNextTask([{ id: "a", title: "No due date" }], VIEWER),
    ).toBeNull();
  });
});

describe("formatEventTime", () => {
  // These assert which *branch* was taken, never the exact clock rendering.
  // `toLocaleTimeString` is locale-dependent — the same instant is "6:00 PM"
  // under en-US and "18:00" under en-GB or de-DE — so pinning the digits would
  // make the suite fail on a runner whose locale changed, for no real defect.
  // The minutes are the one stable part across both 12h and 24h forms.
  it("shows a clock time for today", () => {
    const label = formatEventTime(at(2026, 7, 16, 18, 0), NOW);

    expect(label).toMatch(/:00/);
    expect(label).not.toMatch(/tmrw/);
  });

  it("labels tomorrow and keeps the clock time", () => {
    const label = formatEventTime(at(2026, 7, 17, 18, 0), NOW);

    expect(label).toMatch(/^tmrw /);
    expect(label).toMatch(/:00/);
  });

  it("uses a weekday inside the week and drops the clock beyond it", () => {
    expect(formatEventTime(at(2026, 7, 19, 18, 0), NOW)).not.toMatch(/tmrw/);
    // Past a week the label is a bare date, so it carries no time separator.
    expect(formatEventTime(at(2026, 8, 30, 18, 0), NOW)).not.toMatch(/:/);
  });

  it("returns an empty string rather than 'Invalid Date'", () => {
    expect(formatEventTime("banana", NOW)).toBe("");
  });
});

describe("formatDueDate", () => {
  it("names the near states explicitly", () => {
    expect(formatDueDate(at(2026, 6, 1), NOW)).toBe("overdue");
    expect(formatDueDate(at(2026, 7, 16, 23), NOW)).toBe("due today");
    expect(formatDueDate(at(2026, 7, 17, 9), NOW)).toBe("due tmrw");
  });

  it("compares calendar days, not elapsed hours", () => {
    // Due at 09:00 tomorrow is 21 hours away — under one 24h period, but a
    // different day, and "due today" would be wrong.
    expect(formatDueDate(at(2026, 7, 17, 9), NOW)).toBe("due tmrw");
  });

  it("returns an empty string on an unparseable date", () => {
    expect(formatDueDate("", NOW)).toBe("");
  });
});

describe("isDueUrgent", () => {
  it("is true for overdue, today, and tomorrow", () => {
    expect(isDueUrgent(at(2026, 6, 1), NOW)).toBe(true);
    expect(isDueUrgent(at(2026, 7, 16, 23), NOW)).toBe(true);
    expect(isDueUrgent(at(2026, 7, 17, 1), NOW)).toBe(true);
  });

  it("is false further out", () => {
    expect(isDueUrgent(at(2026, 7, 18), NOW)).toBe(false);
  });

  it("is false on an unparseable date rather than defaulting to alarm", () => {
    expect(isDueUrgent("banana", NOW)).toBe(false);
  });
});

describe("UpNextStrip rows", () => {
  const VIEWER = "viewer-1";

  function renderStrip(): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <UpNextStrip
            events={[
              {
                id: "e1",
                name: "Chapter meeting",
                location: "Great Hall",
                start_time: at(2026, 7, 16, 18),
              },
            ]}
            tasks={[
              {
                id: "t1",
                title: "Ride-share list",
                due_date: "2026-08-17",
                status: "TODO",
                assignee_id: VIEWER,
              },
            ]}
            viewerUserId={VIEWER}
            now={NOW}
          />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }

  function rows(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => (node.type as unknown as string) === "Pressable",
    );
  }

  it("leads the event with the accent calendar and the task with the muted check", () => {
    const [eventRow, taskRow] = rows(renderStrip());

    // The Events tab glyph is a Rect body; the Tasks one a Circle.
    const calendar = eventRow!.find(
      (node) => (node.type as unknown as string) === "Rect",
    );
    const check = taskRow!.find(
      (node) => (node.type as unknown as string) === "Circle",
    );
    expect(calendar.props.stroke).toBe("#CB9FFF");
    expect(check.props.stroke).toBe(signetDarkTokens.color.text.muted);
    for (const svg of [eventRow!, taskRow!].map((row) =>
      row.find((node) => (node.type as unknown as string) === "Svg"),
    )) {
      expect(svg.props.width).toBe(20);
    }
  });

  it("gives both rows the shared list-row press feedback", () => {
    for (const row of rows(renderStrip())) {
      expect(row.props.android_ripple?.color).toMatch(/^rgba\(/);
      // The suite's react-native stub runs as iOS.
      expect(row.props.style({ pressed: true })).toContainEqual({
        backgroundColor: signetDarkTokens.color.surface.card,
      });
      expect(row.props.style({ pressed: false })).toContain(null);
    }
  });

  // Each row pads itself by `sm` and bleeds it into the screen gutter, as
  // Chat home's channel rows do, so the glyph stays on the gutter line and the
  // press lift clears it. The bleed sits on the clip that rounds the ripple
  // (`PressableRow`), so the row is where it was.
  it("bleeds each row's padding into the screen gutter, inside a rounded clip", () => {
    const all = rows(renderStrip());
    expect(all).toHaveLength(2);
    for (const row of all) {
      const { clip, resting } = expectRoundedRipple(
        row,
        signetDarkTokens.radius.control,
      );
      expect(resting.paddingHorizontal).toBe(signetDarkTokens.spacing.sm);
      expect(clip.marginHorizontal).toBe(-signetDarkTokens.spacing.sm);
      expect(resting).not.toHaveProperty("marginHorizontal");
    }
  });
});
