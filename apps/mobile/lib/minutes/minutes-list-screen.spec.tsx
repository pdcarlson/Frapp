/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { MEETING_LIST_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * The phone's Minutes list (#5290). Renders `app/(app)/minutes.tsx` from
 * here, since a spec under `app/` ships as a route module.
 */
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  permissions: ["meetings:record"] as string[],
  createAction: null as null | { label: string; onPress: () => void },
  newMinutes: vi.fn(),
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
  useViewerUserId: () => "me",
  useMemberDisplayNames: () => ({ nameFor: () => "Sam" }),
  usePermissionList: () => state.permissions,
}));
vi.mock("@/components/screen-shell", () => ({
  ScreenShell: ({
    children,
    createAction,
  }: {
    children: React.ReactNode;
    createAction?: { label: string; onPress: () => void };
  }) => {
    state.createAction = createAction ?? null;
    return React.createElement("ScreenShell", null, children);
  },
}));
vi.mock("@/components/pull-to-refresh", () => ({
  useRefetchAll: () => undefined,
}));
vi.mock("@/components/quick-actions/meeting-actions", () => ({
  useMeetingQuickActions: () => ({
    newMinutes: state.newMinutes,
    sheets: null,
  }),
}));
vi.mock("@/lib/minutes/meetings-on", () => ({ useMeetingsOn: () => true }));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import MinutesScreen from "@/app/(app)/minutes";

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();
let next = 0;
function row(over: Record<string, unknown> = {}) {
  next += 1;
  return {
    id: `m${next}`,
    event_id: `e${next}`,
    event_name: "Chapter Meeting",
    event_start_time: daysAgo(1),
    meeting_type: "chapter",
    other_label: null,
    status: "posted",
    created_by: "me",
    posted_at: null,
    updated_at: daysAgo(1),
    series_key: null,
    series_rule: null,
    decision_count: 0,
    action_item_count: 0,
    recorded: false,
    ...over,
  };
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MinutesScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const tabs = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityRole === "tab",
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = ["meetings:record"];
  state.createAction = null;
});

describe("Minutes list", () => {
  it("shows a few minutes with their tags, by week, with no search or type chips", () => {
    state.rows = [
      row({ status: "draft", recorded: true, event_name: "Exec Meeting" }),
      row({ decision_count: 2, action_item_count: 1 }),
    ];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain(MEETING_LIST_COPY.drafts);
    expect(text).toContain("This week");
    expect(text).toContain(MEETING_LIST_COPY.recorded);
    expect(text).toContain(MEETING_LIST_COPY.decisions(2));
    expect(text).toContain(MEETING_LIST_COPY.actionItems(1));
    expect(tabs(tree)).toHaveLength(0);
  });

  it("past eight, offers type chips with counts and a Series row, and a type chip narrows the list", () => {
    state.rows = [
      ...Array.from({ length: 7 }, (_, i) =>
        row({
          series_key: "head",
          series_rule: "WEEKLY",
          event_start_time: daysAgo(i * 7 + 1),
        }),
      ),
      row({ meeting_type: "exec", event_name: "Exec Meeting" }),
      row({ meeting_type: "exec", event_name: "Exec Meeting" }),
    ];
    const tree = render();
    expect(screenText(tree)).toContain(MEETING_LIST_COPY.series);
    expect(screenText(tree)).toContain(MEETING_LIST_COPY.minutesCount(7));
    const exec = tabs(tree).find((tab) =>
      screenText({ root: tab } as unknown as ReactTestRenderer).includes(
        "Exec · 2",
      ),
    )!;
    act(() => exec.props.onPress());
    const text = screenText(tree);
    // Narrowed: the series folds away and only exec minutes are listed.
    expect(text).not.toContain(MEETING_LIST_COPY.series);
    expect(text).not.toContain("Chapter Meeting");
    expect(text).toContain("Exec Meeting");
  });

  it("opens a series' own list from its row", () => {
    state.rows = Array.from({ length: 9 }, (_, i) =>
      row({ series_key: "head", event_start_time: daysAgo(i * 7 + 1) }),
    );
    const tree = render();
    const seriesRow = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.onPress === "function" &&
        drawnText(node).includes(MEETING_LIST_COPY.minutesCount(9)),
    )[0];
    act(() => seriesRow.props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-series",
      params: { key: "head" },
    });
  });

  it("gives an officer who records minutes the floating New minutes, and nobody else", () => {
    state.rows = [row()];
    render();
    expect(state.createAction?.label).toBe(MEETING_LIST_COPY.newMinutes);
    state.createAction?.onPress();
    expect(state.newMinutes).toHaveBeenCalledTimes(1);
    state.permissions = [];
    render();
    expect(state.createAction).toBeNull();
  });
});
