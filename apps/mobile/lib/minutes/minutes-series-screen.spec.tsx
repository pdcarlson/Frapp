/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { MEETING_COPY, MEETING_LIST_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * One repeating meeting's minutes (#5290). Renders
 * `app/(app)/minutes-series.tsx` from here, since a spec under `app/` ships
 * as a route module.
 */
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  meetings: new Map<string, unknown>(),
  asked: [] as string[],
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMeetings: () => ({
    data: state.rows,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useMeeting: (id: string) => {
    state.asked.push(id);
    const data = state.meetings.get(id);
    return { data, isPending: data === undefined, isError: false };
  },
  useMemberDisplayNames: () => ({ nameFor: () => "Sam" }),
}));
vi.mock("@/components/screen-shell", () => ({
  ScreenShell: ({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }) =>
    React.createElement(
      "ScreenShell",
      null,
      React.createElement("Text", null, title),
      subtitle ? React.createElement("Text", null, subtitle) : null,
      children,
    ),
}));
vi.mock("@/components/pull-to-refresh", () => ({
  useRefetchAll: () => undefined,
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import MinutesSeriesScreen from "@/app/(app)/minutes-series";

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();
function row(id: string, weeksAgo: number, over: Record<string, unknown> = {}) {
  return {
    id,
    event_id: `e-${id}`,
    event_name: "Chapter Meeting",
    event_start_time: daysAgo(weeksAgo * 7 + 1),
    meeting_type: "chapter",
    other_label: null,
    status: "posted",
    created_by: "me",
    posted_at: null,
    updated_at: daysAgo(1),
    series_key: "head",
    series_rule: "WEEKLY",
    decision_count: 0,
    action_item_count: 1,
    recorded: false,
    ...over,
  };
}
const minutesWith = (text: string) => ({
  id: "x",
  content: {
    action_items: [{ text, owner_user_id: null, due_date: null }],
  },
});

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MinutesSeriesScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.asked = [];
  state.meetings = new Map();
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({ key: "head" });
});

describe("Minutes series", () => {
  it("names the series, how it repeats and how many, then its minutes", () => {
    state.rows = [
      row("a", 0),
      row("b", 1),
      row("other", 0, { series_key: "x" }),
    ];
    const text = screenText(render());
    expect(text).toContain("Chapter Meeting");
    expect(text).toContain(MEETING_LIST_COPY.minutesCount(2));
    expect(text).toMatch(/Every \w+day/);
  });

  it("reads action items from the latest three posted minutes only, newest first", () => {
    state.rows = [
      row("draft", 0, { status: "draft" }),
      row("w1", 1),
      row("w2", 2, { action_item_count: 0 }),
      row("w3", 3),
      row("w4", 4),
    ];
    state.meetings.set("w1", minutesWith("Book the venue"));
    state.meetings.set("w3", minutesWith("Send the reminder"));
    const text = screenText(render());
    // w4 is the fourth posted minutes: not read. w2 has none: not read.
    expect(state.asked).toEqual(["w1", "w3"]);
    expect(text).toContain("Book the venue");
    expect(text).toContain(MEETING_LIST_COPY.noOwner);
  });

  it("says when the latest minutes set no action items", () => {
    state.rows = [row("a", 0, { action_item_count: 0 })];
    expect(screenText(render())).toContain(MEETING_LIST_COPY.seriesActionsNone);
  });

  it("says the series isn't here when none of its minutes are", () => {
    state.rows = [];
    expect(screenText(render())).toContain(MEETING_COPY.missingBody);
  });
});
