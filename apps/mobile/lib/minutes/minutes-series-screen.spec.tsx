/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  TASK_AUDIENCE_COPY,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * One repeating meeting's minutes (#5290). Renders
 * `app/(app)/minutes-series.tsx` from here, since a spec under `app/` ships
 * as a route module.
 */
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  open: undefined as unknown[] | undefined,
  openPending: false,
  openKey: null as string | null,
  refreshed: [] as unknown[],
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
  useSeriesOpenActionItems: (key: string | null) => {
    state.openKey = key;
    return {
      data: state.open,
      isPending: state.openPending,
      isError: !state.openPending && state.open === undefined,
    };
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
  useRefetchAll: (queries: unknown[]) => {
    state.refreshed = queries;
    return undefined;
  },
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
  state.open = [];
  state.openPending = false;
  state.openKey = null;
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

  it("lists the open action items the series read gives, newest first, with a task for everyone's progress (#5482)", () => {
    state.rows = [row("w1", 1), row("w9", 9)];
    state.open = [
      {
        meeting_id: "w1",
        event_start_time: daysAgo(8),
        items: [
          {
            index: 0,
            text: "Book the venue",
            owner_user_id: null,
            due_date: null,
            group: null,
          },
        ],
      },
      {
        meeting_id: "w9",
        event_start_time: daysAgo(64),
        items: [
          {
            index: 2,
            text: "Order the shirts",
            owner_user_id: null,
            due_date: null,
            group: { done: 3, total: 20 },
          },
        ],
      },
    ];
    const text = screenText(render());
    expect(state.openKey).toBe("head");
    expect(text).toContain(MEETING_LIST_COPY.seriesActions);
    expect(text.indexOf("Book the venue")).toBeLessThan(
      text.indexOf("Order the shirts"),
    );
    expect(text).toContain(TASK_AUDIENCE_COPY.progress(3, 20));
    expect(text).toContain(MEETING_LIST_COPY.noOwner);
    expect(text).not.toContain(MEETING_LIST_COPY.seriesActionsNone);
    // A pull refreshes the open items too, not only the minutes list.
    expect(state.refreshed).toHaveLength(2);
  });

  it("says nothing is open once the read finds none", () => {
    state.rows = [row("a", 0)];
    state.open = [];
    expect(screenText(render())).toContain(MEETING_LIST_COPY.seriesActionsNone);
  });

  it("holds a row's shape while the read is out, and says so when it fails", () => {
    state.rows = [row("a", 0)];
    state.open = undefined;
    state.openPending = true;
    let text = screenText(render());
    expect(text).not.toContain(MEETING_LIST_COPY.seriesActionsNone);
    expect(text).not.toContain(MEETING_LIST_COPY.loadFailedTitle);
    state.openPending = false;
    text = screenText(render());
    expect(text).toContain(MEETING_LIST_COPY.loadFailedTitle);
  });

  it("shows no action items section for a series whose minutes set none", () => {
    state.rows = [row("a", 0, { action_item_count: 0 })];
    expect(screenText(render())).not.toContain(MEETING_LIST_COPY.seriesActions);
  });

  it("says the series isn't here when none of its minutes are", () => {
    state.rows = [];
    expect(screenText(render())).toContain(MEETING_COPY.missingBody);
  });
});
